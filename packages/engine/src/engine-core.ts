import { createElement } from 'react';
import { render } from 'react-dom';
import { globalContext, Editor, engineConfig, EngineOptions } from '@alilc/lowcode-editor-core';
import {
  Designer,
  LowCodePluginManager,
  ILowCodePluginContext,
  PluginPreference,
  TransformStage,
} from '@alilc/lowcode-designer';
import {
  Skeleton as InnerSkeleton,
  SettingsPrimaryPane,
  registerDefaults,
} from '@alilc/lowcode-editor-skeleton';

import Outline, { OutlineBackupPane, getTreeMaster } from '@alilc/lowcode-plugin-outline-pane';
import DesignerPlugin from '@alilc/lowcode-plugin-designer';
import { Hotkey, Project, Skeleton, Setters, Material, Event } from '@alilc/lowcode-shell';
import { getLogger, isPlainObject } from '@alilc/lowcode-utils';
import './modules/live-editing';
import utils from './modules/utils';
import * as editorCabin from './modules/editor-cabin';
import getSkeletonCabin from './modules/skeleton-cabin';
import getDesignerCabin from './modules/designer-cabin';
import classes from './modules/classes';
import symbols from './modules/symbols';
export * from './modules/editor-types';
export * from './modules/skeleton-types';
export * from './modules/designer-types';
export * from './modules/lowcode-types';

registerDefaults();

// 暂时还不知道editor是干什么的（单例模式）
const editor = new Editor();
globalContext.register(editor, Editor);
globalContext.register(editor, 'editor');

// 根据传入的editor创建 Skeleton 的实例对象（初始化页面中各个区域）
const innerSkeleton = new InnerSkeleton(editor);
editor.set('skeleton' as any, innerSkeleton);

const designer = new Designer({ editor });
editor.set('designer' as any, designer);

// 插件管理器，会被导出在外面项目中使用（lowcode-demo）。
const plugins = new LowCodePluginManager(editor).toProxy();
editor.set('plugins' as any, plugins);

const { project: innerProject } = designer;
const skeletonCabin = getSkeletonCabin(innerSkeleton);
// 这里的 Workbench 是函数式组件
const { Workbench } = skeletonCabin;

const hotkey = new Hotkey();
const project = new Project(innerProject);
const skeleton = new Skeleton(innerSkeleton);
const setters = new Setters();
const material = new Material(editor);
const config = engineConfig;
const event = new Event(editor, { prefix: 'common' });
const logger = getLogger({ level: 'warn', bizName: 'common' });
const designerCabin = getDesignerCabin(editor);
const objects = {
  TransformStage,
};
const common = {
  utils,
  objects,
  editorCabin,
  designerCabin,
  skeletonCabin,
};

export {
  skeleton,
  plugins,
  project,
  setters,
  material,
  config,
  event,
  logger,
  hotkey,
  common,
  // 兼容原 editor 的事件功能
  event as editor,
};
// declare this is open-source version
export const isOpenSource = true;
export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = {
  symbols,
  classes,
};

// 注册一批内置插件
(async function registerPlugins() {
  // 处理 editor.set('assets')，将组件元数据创建好
  const componentMetaParser = (ctx: ILowCodePluginContext) => {
    return {
      init() {
        editor.onGot('assets', (assets: any) => {
          const { components = [] } = assets;
          designer.buildComponentMetasMap(components);
        });
      },
    };
  };
  componentMetaParser.pluginName = '___component_meta_parser___';
  await plugins.register(componentMetaParser);

  // 注册默认的 setters
  const setterRegistry = (ctx: ILowCodePluginContext) => {
    return {
      init() {
        if (engineConfig.get('disableDefaultSetters')) return;
        const builtinSetters = require('@alilc/lowcode-engine-ext')?.setters;
        if (builtinSetters) {
          ctx.setters.registerSetter(builtinSetters);
        }
      },
    };
  };
  setterRegistry.pluginName = '___setter_registry___';
  await plugins.register(setterRegistry);

  // 注册默认的面板
  const defaultPanelRegistry = (ctx: ILowCodePluginContext) => {
    return {
      init() {
        skeleton.add({
          area: 'mainArea',
          name: 'designer',
          type: 'Widget',
          content: DesignerPlugin,
        });
        if (!engineConfig.get('disableDefaultSettingPanel')) {
          skeleton.add({
            area: 'rightArea',
            name: 'settingsPane',
            type: 'Panel',
            content: SettingsPrimaryPane,
            props: {
              ignoreRoot: true,
            },
          });
        }

        // by default in float area;
        let isInFloatArea = true;
        const hasPreferenceForOutline = editor
          ?.getPreference()
          ?.contains('outline-pane-pinned-status-isFloat', 'skeleton');
        if (hasPreferenceForOutline) {
          isInFloatArea = editor
            ?.getPreference()
            ?.get('outline-pane-pinned-status-isFloat', 'skeleton');
        }

        skeleton.add({
          area: 'leftArea',
          name: 'outlinePane',
          type: 'PanelDock',
          content: Outline,
          panelProps: {
            area: isInFloatArea ? 'leftFloatArea' : 'leftFixedArea',
            keepVisibleWhileDragging: true,
            ...engineConfig.get('defaultOutlinePaneProps'),
          },
        });
        skeleton.add({
          area: 'rightArea',
          name: 'backupOutline',
          type: 'Panel',
          props: {
            condition: () => {
              return designer.dragon.dragging && !getTreeMaster(designer).hasVisibleTreeBoard();
            },
          },
          content: OutlineBackupPane,
        });
      },
    };
  };
  defaultPanelRegistry.pluginName = '___default_panel___';
  await plugins.register(defaultPanelRegistry);
})();

let engineInited = false;
// @ts-ignore webpack Define variable
export const version = VERSION_PLACEHOLDER;
engineConfig.set('ENGINE_VERSION', version);
/**
 * 初始化工作，挂载页面、注册插件、渲染页面
 * @param container 挂载的容器
 * @param options 配置项
 * @param pluginPreference 插件预配置
 * @returns 
 */
export async function init(
  container?: HTMLElement,
  options?: EngineOptions,
  pluginPreference?: PluginPreference,
  ) {
  if (engineInited) return;
  engineInited = true;
  let engineOptions = null;
  let engineContainer = null;
  if (isPlainObject(container)) {
    engineOptions = container;
    engineContainer = document.createElement('div');
    document.body.appendChild(engineContainer);
  } else {
    engineOptions = options;
    engineContainer = container;
    if (!container) {
      engineContainer = document.createElement('div');
      document.body.appendChild(engineContainer);
    }
  }
  engineContainer.id = 'engine';
  engineConfig.setEngineOptions(engineOptions as any);

  // 依次调用 plugins 数组里的插件进行初始化（packages/designer/src/plugin/plugin-manager.ts/init()）
  await plugins.init(pluginPreference as any);
  render(
    createElement(Workbench, {
      skeleton: innerSkeleton,
      className: 'engine-main',
      topAreaItemClassName: 'engine-actionitem',
    }),
    engineContainer,
  );
}
