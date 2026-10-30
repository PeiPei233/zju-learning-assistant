import { useContext, type ReactNode } from 'react';
import { Tooltip } from 'antd';
import { PanelContext } from '../context/PanelContext';
import PanelIcon from './PanelIcon';

export default function PanelHeading({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { collapsed, toggle } = useContext(PanelContext);
  return <div className={`panel-heading ${className}`}>
    {children}
    {collapsed && <Tooltip title="固定展开侧栏" trigger={['hover', 'focus']}>
      <button className="panel-pin icon-button" aria-label="固定展开侧栏" onClick={toggle}><PanelIcon collapsed={false} /></button>
    </Tooltip>}
  </div>;
}
