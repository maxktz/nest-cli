import chalk from 'chalk';
import { join } from 'path';
import webpack = require('webpack');
import { Input } from '../commands';
import { AssetsManager } from '../lib/compiler/assets-manager';
import { Compiler } from '../lib/compiler/compiler';
import { getValueOrDefault } from '../lib/compiler/helpers/get-value-or-default';
import { TsConfigProvider } from '../lib/compiler/helpers/tsconfig-provider';
import { PluginsLoader } from '../lib/compiler/plugins-loader';
import { WatchCompiler } from '../lib/compiler/watch-compiler';
import { WebpackCompiler } from '../lib/compiler/webpack-compiler';
import { WorkspaceUtils } from '../lib/compiler/workspace-utils';
import {
  ConfigurationLoader,
  NestConfigurationLoader,
} from '../lib/configuration';
import { defaultOutDir } from '../lib/configuration/defaults';
import { FileSystemReader } from '../lib/readers';
import { ERROR_PREFIX } from '../lib/ui';
import { AbstractAction } from './abstract.action';

export class BuildAction extends AbstractAction {
  protected readonly pluginsLoader = new PluginsLoader();
  protected readonly tsConfigProvider = new TsConfigProvider();
  protected readonly compiler = new Compiler(
    this.pluginsLoader,
    this.tsConfigProvider,
  );
  protected readonly webpackCompiler = new WebpackCompiler(this.pluginsLoader);
  protected readonly watchCompiler = new WatchCompiler(
    this.pluginsLoader,
    this.tsConfigProvider,
  );
  protected readonly fileSystemReader = new FileSystemReader(process.cwd());
  protected readonly loader: ConfigurationLoader = new NestConfigurationLoader(
    this.fileSystemReader,
  );
  protected readonly assetsManager = new AssetsManager();
  protected readonly workspaceUtils = new WorkspaceUtils();

  public async handle(inputs: Input[], options: Input[]) {
    try {
      const watchModeOption = options.find(option => option.name === 'watch');
      const watchMode = !!(watchModeOption && watchModeOption.value);
      await this.runBuild(inputs, options, watchMode);
    } catch (err) {
      if (err instanceof Error) {
        console.log(`\n${ERROR_PREFIX} ${err.message}\n`);
      } else {
        console.error(`\n${chalk.red(err)}\n`);
      }
    }
  }

  public async runBuild(
    inputs: Input[],
    options: Input[],
    watchMode: boolean,
    isDebugEnabled = false,
    onSuccess?: () => void,
  ) {
    const configFileName = options.find( option => option.name === 'config')!.value as string;
    const configuration = await this.loader.load(configFileName);
    const appName = inputs.find(input => input.name === 'app')!.value as string;

    const pathToTsconfig = getValueOrDefault<string>(
      configuration,
      'compilerOptions.tsConfigPath',
      appName,
      'path',
      options,
    );
    const { options: tsOptions } = this.tsConfigProvider.getByConfigFilename(
      pathToTsconfig,
    );
    const outDir = tsOptions.outDir || defaultOutDir;
    const isWebpackEnabled = getValueOrDefault<boolean>(
      configuration,
      'compilerOptions.webpack',
      appName,
      'webpack',
      options,
    );
    await this.workspaceUtils.deleteOutDirIfEnabled(
      configuration,
      appName,
      outDir,
    );
    await this.assetsManager.copyAssets(configuration, appName, outDir);

    if (isWebpackEnabled) {
      const webpackPath = getValueOrDefault<string>(
        configuration,
        'compilerOptions.webpackConfigPath',
        appName,
        'webpackPath',
        options,
      );

      const webpackConfigFactoryOrConfig = this.getWebpackConfigFactoryByPath(
        webpackPath,
        configuration.compilerOptions!.webpackConfigPath!,
      );
      return this.webpackCompiler.run(
        configuration,
        webpackConfigFactoryOrConfig,
        pathToTsconfig,
        appName,
        isDebugEnabled,
        watchMode,
        onSuccess,
      );
    }

    if (watchMode) {
      this.watchCompiler.run(configuration, pathToTsconfig, appName, onSuccess);
    } else {
      this.compiler.run(configuration, pathToTsconfig, appName, onSuccess);
    }
  }

  private getWebpackConfigFactoryByPath(
    webpackPath: string,
    defaultPath: string,
  ): (
    config: webpack.Configuration,
  ) => webpack.Configuration | webpack.Configuration {
    const pathToWebpackFile = join(process.cwd(), webpackPath);
    try {
      return require(pathToWebpackFile);
    } catch (err) {
      if (webpackPath !== defaultPath) {
        throw err;
      }
      return ({}) => ({});
    }
  }
}
