import { Editor, engineConfig } from '@alilc/lowcode-editor-core';
import { getLogger } from '@alilc/lowcode-utils';
import {
  ILowCodePlugin,
  ILowCodePluginConfig,
  ILowCodePluginManager,
  ILowCodePluginContext,
  ILowCodeRegisterOptions,
  IPluginContextOptions,
  PreferenceValueType,
  ILowCodePluginConfigMeta,
  PluginPreference,
  ILowCodePluginPreferenceDeclaration,
  isLowCodeRegisterOptions,
} from './plugin-types';
import { filterValidOptions } from './plugin-utils';
import { LowCodePlugin } from './plugin';
import LowCodePluginContext from './plugin-context';
import { invariant } from '../utils';
import sequencify from './sequencify';
import semverSatisfies from 'semver/functions/satisfies';

const logger = getLogger({ level: 'warn', bizName: 'designer:pluginManager' });

export class LowCodePluginManager implements ILowCodePluginManager {
  private plugins: ILowCodePlugin[] = [];

  private pluginsMap: Map<string, ILowCodePlugin> = new Map();

  private pluginPreference?: PluginPreference = new Map();
  private editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  private _getLowCodePluginContext(options: IPluginContextOptions) {
    return new LowCodePluginContext(this, options);
  }

  isEngineVersionMatched(versionExp: string): boolean {
    const engineVersion = engineConfig.get('ENGINE_VERSION');
    // ref: https://github.com/npm/node-semver#functions
    // 1.0.1-beta should match '^1.0.0'
    return semverSatisfies(engineVersion, versionExp, { includePrerelease: true });
  }

  /**
   * 注册新的插件
   * @param pluginConfigCreator - 返回插件配置项的函数
   * @param options - the plugin options 插件配置项
   * @param registerOptions - the plugin register options 插件注册器配置
   */
  async register(
    pluginConfigCreator: (ctx: ILowCodePluginContext, options: any) => ILowCodePluginConfig,
    options?: any,
    registerOptions?: ILowCodeRegisterOptions,
  ): Promise<void> {
    // registerOptions maybe in the second place
    // 校验传入的 options 参数
    if (isLowCodeRegisterOptions(options)) {
      registerOptions = options;
      options = {};
    }
    let { pluginName, meta = {} } = pluginConfigCreator as any;
    const { preferenceDeclaration, engines } = meta as ILowCodePluginConfigMeta;
    const ctx = this._getLowCodePluginContext({ pluginName });
    const customFilterValidOptions = engineConfig.get('customPluginFilterOptions', filterValidOptions);
    // 执行 pluginConfigCreator 函数，返回配置项（将ctx传入到函数中，这样在函数中可以直接修改ctx的值）
    const config = pluginConfigCreator(ctx, customFilterValidOptions(options, preferenceDeclaration!));
    // compat the legacy way to declare pluginName
    // @ts-ignore
    pluginName = pluginName || config.name;
    invariant(
      pluginName,
      'pluginConfigCreator.pluginName required',
      config,
    );

    ctx.setPreference(pluginName, (preferenceDeclaration as ILowCodePluginPreferenceDeclaration));

    const allowOverride = registerOptions?.override === true;

    // 处理已存在的情况
    if (this.pluginsMap.has(pluginName)) {
      if (!allowOverride) {
        throw new Error(`Plugin with name ${pluginName} exists`);
      } else {
        // clear existing plugin
        const originalPlugin = this.pluginsMap.get(pluginName);
        logger.log(
          'plugin override, originalPlugin with name ',
          pluginName,
          ' will be destroyed, config:',
          originalPlugin?.config,
        );
        originalPlugin?.destroy();
        this.pluginsMap.delete(pluginName);
      }
    }

    const engineVersionExp = engines && engines.lowcodeEngine;
    if (engineVersionExp && !this.isEngineVersionMatched(engineVersionExp)) {
      throw new Error(`plugin ${pluginName} skipped, engine check failed, current engine version is ${engineConfig.get('ENGINE_VERSION')}, meta.engines.lowcodeEngine is ${engineVersionExp}`);
    }

    // 创建一个新的插件实例
    const plugin = new LowCodePlugin(pluginName, this, config, meta);
    // support initialization of those plugins which registered after normal initialization by plugin-manager
    // 支持插件自动初始化（即自动调用插件的init方法）
    if (registerOptions?.autoInit) {
      await plugin.init();
    }
    // 把它加入到plugins数组中
    this.plugins.push(plugin);
    this.pluginsMap.set(pluginName, plugin);
    logger.log(`plugin registered with pluginName: ${pluginName}, config: ${config}, meta: ${meta}`);
  }

  get(pluginName: string): ILowCodePlugin | undefined {
    return this.pluginsMap.get(pluginName);
  }

  getAll(): ILowCodePlugin[] {
    return this.plugins;
  }

  has(pluginName: string): boolean {
    return this.pluginsMap.has(pluginName);
  }

  async delete(pluginName: string): Promise<boolean> {
    const idx = this.plugins.findIndex((plugin) => plugin.name === pluginName);
    if (idx === -1) return false;
    const plugin = this.plugins[idx];
    await plugin.destroy();

    this.plugins.splice(idx, 1);
    return this.pluginsMap.delete(pluginName);
  }

  // 依次初始化插件
  async init(pluginPreference?: PluginPreference) {
    const pluginNames: string[] = [];
    const pluginObj: { [name: string]: ILowCodePlugin } = {};
    this.pluginPreference = pluginPreference;
    this.plugins.forEach((plugin) => {
      pluginNames.push(plugin.name);
      pluginObj[plugin.name] = plugin;
    });
    // 序列化插件名与其内容，如果不能一一对应，插件列表会清空不让注册。
    const { missingTasks, sequence } = sequencify(pluginObj, pluginNames);
    invariant(!missingTasks.length, 'plugin dependency missing', missingTasks);
    logger.log('load plugin sequence:', sequence);

    for (const pluginName of sequence) {
      try {
        await this.pluginsMap.get(pluginName)!.init();
      } catch (e) /* istanbul ignore next */ {
        logger.error(
          `Failed to init plugin:${pluginName}, it maybe affect those plugins which depend on this.`,
        );
        logger.error(e);
      }
    }
  }

  async destroy() {
    for (const plugin of this.plugins) {
      await plugin.destroy();
    }
  }

  get size() {
    return this.pluginsMap.size;
  }

  getPluginPreference(pluginName: string): Record<string, PreferenceValueType> | null | undefined {
    if (!this.pluginPreference) {
      return null;
    }
    return this.pluginPreference.get(pluginName);
  }

  // 转成proxy
  toProxy() {
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (target.pluginsMap.has(prop as string)) {
          // 禁用态的插件，直接返回 undefined
          if (target.pluginsMap.get(prop as string)!.disabled) {
            return undefined;
          }
          return target.pluginsMap.get(prop as string)?.toProxy();
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  /* istanbul ignore next */
  setDisabled(pluginName: string, flag = true) {
    logger.warn(`plugin:${pluginName} has been set disable:${flag}`);
    this.pluginsMap.get(pluginName)?.setDisabled(flag);
  }

  async dispose() {
    await this.destroy();
    this.plugins = [];
    this.pluginsMap.clear();
  }
}
