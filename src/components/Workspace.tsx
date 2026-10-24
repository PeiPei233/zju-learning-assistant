import React, { useContext, useEffect, useRef, useState } from 'react';
import { Tooltip } from 'antd';
import type { TooltipRef } from 'antd/es/tooltip';
import PanelIcon from './PanelIcon';

import { PanelContext } from '../context/PanelContext';
export { PanelContext } from '../context/PanelContext';

export default function Workspace({ title, panel, children, actions, footer, headerless = false }: {
  title: string; panel: React.ReactNode; children: React.ReactNode;
  actions?: React.ReactNode; footer?: React.ReactNode; headerless?: boolean;
}) {
  const { collapsed, toggle, width = 280, setWidth, peek, module, keepPeek, dismissPeek, activateModule } = useContext(PanelContext);
  const floating = collapsed && !!module && peek === module;
  const visible = !collapsed || floating;
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => { if (panelRef.current) panelRef.current.inert = !visible; }, [visible]);
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [available, setAvailable] = useState(window.innerWidth - 56);
  const [resizing, setResizing] = useState(false);
  const [resizeTipOffset, setResizeTipOffset] = useState(0);
  const resizeTipRef = useRef<TooltipRef>(null);
  useEffect(() => { resizeTipRef.current?.forceAlign(); }, [resizeTipOffset]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const measured = entries[0].contentRect.width;
      if (measured > 0) setAvailable(measured);
    });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const maximum = Math.max(200, Math.min(420, available - 360));
  const panelWidth = Math.min(maximum, Math.max(200, width));
  const resize = (next: number) => setWidth?.(Math.round(Math.min(maximum, Math.max(200, next))));
  return <div ref={host} className={`workspace ${collapsed ? 'panel-collapsed' : ''} ${resizing ? 'is-resizing' : ''} ${floating ? 'panel-floating' : ''}`} style={{ '--panel-width': `${panelWidth}px` } as React.CSSProperties}>
    <aside ref={panelRef} className="context-panel" aria-hidden={!visible} aria-label={`${title}侧栏`}
      onPointerEnter={keepPeek} onPointerLeave={dismissPeek} onFocusCapture={keepPeek}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) dismissPeek?.(); }}
      onClickCapture={() => { if (floating && module) activateModule?.(module); }}>
      {panel}
      {floating && <Tooltip title="固定展开侧栏" trigger={['hover', 'focus']}><button className="panel-pin icon-button" aria-label="固定展开侧栏" onClick={toggle}><PanelIcon collapsed={false} /></button></Tooltip>}
    </aside>
    {!collapsed && setWidth && <Tooltip ref={resizeTipRef} title="拖动调整宽度，双击恢复默认" placement="right" arrow={false}
      align={{ offset: [8, resizeTipOffset] }} open={resizing ? false : undefined} mouseEnterDelay={0.5} trigger={['hover', 'focus']}><div className="panel-resizer" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical"
        aria-valuemin={200} aria-valuemax={maximum} aria-valuenow={panelWidth} tabIndex={0}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, width: panelWidth };
          setResizing(true);
        }}
        onPointerEnter={event => { const rect = event.currentTarget.getBoundingClientRect(); setResizeTipOffset(event.clientY - rect.top - rect.height / 2); }}
        onFocus={() => setResizeTipOffset(0)}
        onPointerMove={event => {
          if (drag.current) resize(drag.current.width + event.clientX - drag.current.x);
          else { const rect = event.currentTarget.getBoundingClientRect(); setResizeTipOffset(event.clientY - rect.top - rect.height / 2); }
        }}
        onPointerUp={event => { drag.current = null; setResizing(false); event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { drag.current = null; setResizing(false); }}
        onLostPointerCapture={() => { drag.current = null; setResizing(false); }}
        onDoubleClick={() => resize(280)}
        onKeyDown={event => {
          const next = event.key === 'ArrowLeft' ? panelWidth - 10 : event.key === 'ArrowRight' ? panelWidth + 10 : event.key === 'Home' ? 200 : event.key === 'End' ? maximum : null;
          if (next !== null) { event.preventDefault(); resize(next); }
        }} /></Tooltip>}
    <main className="workspace-main" aria-label={title}>
      <header className={`workspace-header ${headerless ? 'workspace-header-minimal' : ''}`}>
        <Tooltip title={collapsed ? '展开侧栏' : '收起侧栏'}>
          <button className="icon-button workspace-toggle" aria-label={collapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!collapsed}
            onClick={toggle}><PanelIcon collapsed={collapsed && !floating} /></button>
        </Tooltip>
        {!headerless && <h1>{title}</h1>}<div className="header-actions">{actions}</div>
      </header>
      <div className="workspace-body"><div className="workspace-content">{children}</div></div>
      {footer && <footer className="workspace-footer">{footer}</footer>}
    </main>
  </div>;
}
