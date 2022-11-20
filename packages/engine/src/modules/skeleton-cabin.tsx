import {
  Skeleton as InnerSkeleton,
  createSettingFieldView,
  PopupContext,
  PopupPipe,
  Workbench as InnerWorkbench,
} from '@alilc/lowcode-editor-skeleton';

/**
 * 根据传入的 skeleton 属性返回新的组件
 * @param skeleton 
 * @returns 
 */
export default function getSkeletonCabin(skeleton: InnerSkeleton) {
  return {
    createSettingFieldView,
    PopupContext,
    PopupPipe,
    Workbench: (props: any) => <InnerWorkbench {...props} skeleton={skeleton} />, // hijack skeleton
  };
}