import React, { useContext, useEffect, useRef, useState } from 'react';
import { PanelContext } from '../context/PanelContext';

/** Keep each module mounted while exposing only the hovered module's sidebar. */
export default function ModuleFrame({ name, current, children }: { name: string; current: string; children: React.ReactNode }) {
  const panel = useContext(PanelContext);
  const preview = panel.collapsed && panel.peek === name && current !== name;
  const replaced = !!panel.peek && panel.peek !== name;
  const [linger, setLinger] = useState(preview);
  useEffect(() => {
    if (preview) { setLinger(true); return; }
    if (replaced) { setLinger(false); return; }
    const timer = setTimeout(() => setLinger(false), 220);
    return () => clearTimeout(timer);
  }, [preview, replaced]);
  const overlay = current !== name && (preview || (linger && !replaced));
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const content = host.current?.querySelector<HTMLElement>('.workspace-main');
    if (content) content.inert = overlay;
  }, [overlay]);
  return <PanelContext.Provider value={{ ...panel, module: name }}>
    <div ref={host} className={`module-page ${overlay ? 'module-peeking' : ''}`} hidden={current !== name && !overlay}>{children}</div>
  </PanelContext.Provider>;
}
