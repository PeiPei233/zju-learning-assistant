import { Progress } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

export interface UpdateIndicatorState {
  downloading: boolean;
  percent?: number;
  label: string;
}

export default function UpdateIndicator({ state }: { state?: UpdateIndicatorState }) {
  return <span className="update-indicator" aria-hidden="true">
    {state?.downloading ? state.percent === undefined ? <LoadingOutlined spin /> :
      <Progress type="circle" size={12} strokeWidth={14} percent={state.percent} showInfo={false} strokeColor="var(--status-accent)" /> :
      <span className="update-indicator-dot" />}
  </span>;
}
