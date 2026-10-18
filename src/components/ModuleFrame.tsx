import React, { useContext, useEffect, useState } from 'react';
import { PanelContext } from '../context/PanelContext';

/** Keep each module mounted while exposing only the hovered module's sidebar. */
export default function ModuleFrame({ name, current, children }: { name: string; current: string; children: React.ReactNode }) {
  const panel = useContext(PanelContext);
  const preview = panel.collapsed && panel.peek === name && current !== name;
  const [linger, setLinger] = useState(preview);
  useEffect(() => {
    if (preview) { setLinger(true); return; }
    const timer = setTimeout(() => setLinger(false), 220);
    return () => clearTimeout(timer);
  }, [preview]);
  const overlay = current !== name && (preview || linger);
  return <PanelContext.Provider value={{ ...panel, module: name }}>
    <div className={`module-page ${overlay ? 'module-peeking' : ''}`} hidden={current !== name && !overlay}>{children}</div>
  </PanelContext.Provider>;
}
