import type { ReactNode } from 'react';
import { useConfig } from '../context/ConfigContext';
import EmptyState from './EmptyState';
import FetchState from './FetchState';
import ActionButton from './ActionButton';

export default function ConfigReadState({ icon }: { icon: ReactNode }) {
  const { loadingConfig, loadError, refreshConfig } = useConfig();
  return loadingConfig ? <FetchState label="正在读取设置…" /> :
    <EmptyState icon={icon} action={<ActionButton onClick={refreshConfig}>重试读取设置</ActionButton>}>
      读取设置失败：{loadError}
    </EmptyState>;
}
