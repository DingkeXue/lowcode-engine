import baseRendererFactory from './base';
import { IBaseRendererProps, IBaseRenderComponent } from '../types';

export default function pageRendererFactory(): IBaseRenderComponent {
  const BaseRenderer = baseRendererFactory();
  return class PageRenderer extends BaseRenderer {
    static dislayName = 'page-renderer';

    __namespace = 'page';

    __afterInit(props: IBaseRendererProps, ...rest: unknown[]) {
      this.__generateCtx({
        page: this,
      });
      const schema = props.__schema || {};
      this.state = this.__parseData(schema.state || {});
      // 初始化数据源
      this.__initDataSource(props);
      // 执行constructor构造函数
      this.__excuteLifeCycleMethod('constructor', [props, ...rest]);
    }

    // didupdate的时候去更新state值
    async componentDidUpdate(prevProps: IBaseRendererProps, _prevState: {}, snapshot: unknown) {
      const { __ctx } = this.props;
      const prevState = this.__parseData(prevProps.__schema.state, __ctx);
      const newState = this.__parseData(this.props.__schema.state, __ctx);
      // 当编排的时候修改schema.state值，需要将最新schema.state值setState
      if (JSON.stringify(newState) != JSON.stringify(prevState)) {
        this.setState(newState);
      }

      super.componentDidUpdate?.(prevProps, _prevState, snapshot);
    }

    render() {
      const { __schema, __components } = this.props;
      if (this.__checkSchema(__schema)) {
        return '页面schema结构异常！';
      }
      this.__debug(`${PageRenderer.dislayName} render - ${__schema.fileName}`);

      this.__bindCustomMethods(this.props);
      this.__initDataSource(this.props);

      // this.__excuteLifeCycleMethod('constructor', arguments);

      this.__generateCtx({
        page: this,
      });
      // 执行BaseRenderer的render函数
      // 1.执行render生命周期 2.注入css样式 3.重新加载数据源
      this.__render();


      // 生成组件，渲染页面
      const { Page } = __components;
      if (Page) {
        return this.__renderComp(Page, { pageContext: this });
      }

      return this.__renderContent(this.__renderContextProvider({ pageContext: this }));
    }
  };
}
