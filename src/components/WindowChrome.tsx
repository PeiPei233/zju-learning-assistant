import { useContext, useEffect, useState, useRef } from 'react';
import { Tooltip } from 'antd';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useDesktopApp } from '../context/NotificationContext';
import PanelIcon from './PanelIcon';
import { PanelContext } from '../context/PanelContext';

export const isMacDesktop = /Mac/.test(navigator.platform);
const isCustomDesktop = !isMacDesktop && /Win|Linux/.test(navigator.platform) && !/Android/.test(navigator.userAgent);
const hasNativeLinuxControls = /Linux/.test(navigator.platform) && !/Android/.test(navigator.userAgent) && isTauri();
if (hasNativeLinuxControls) document.documentElement.dataset.nativeLinuxChrome = 'true';
const hasNativeWindowsControls = /Win/.test(navigator.platform) && isTauri();
if (isMacDesktop || isCustomDesktop) {
  document.documentElement.dataset.platform = isMacDesktop ? 'macos' : /Win/.test(navigator.platform) ? 'windows' : 'linux';
  document.documentElement.dataset.windowChrome = 'true';
}
const resizeDirections = ['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'] as const;

export default function WindowChrome({ navigation = false, overlay = false }: { navigation?: boolean; overlay?: boolean }) {
  const { collapsed, toggle, peek } = useContext(PanelContext);
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const { notification } = useDesktopApp();
  const [maximized, setMaximized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [nativeTooltip, setNativeTooltip] = useState({ open: false, x: 26, bottom: -5 });
  const tooltipTimer = useRef<ReturnType<typeof setTimeout>>();
  const hideNativeTooltip = () => {
    clearTimeout(tooltipTimer.current);
    setNativeTooltip(previous => ({ ...previous, open: false }));
  };
  useEffect(() => {
    if (!hasNativeLinuxControls || !navigation) return;
    let disposed = false;
    const unlisten = listen<{ visible: boolean; x: number; bottom: number }>('native-sidebar-tooltip', ({ payload }) => {
      clearTimeout(tooltipTimer.current);
      if (disposed) return;
      if (!payload.visible) hideNativeTooltip();
      else tooltipTimer.current = setTimeout(() => {
        if (!disposed) setNativeTooltip({ open: true, x: payload.x, bottom: payload.bottom });
      }, 100);
    });
    const blur = getCurrentWindow().onFocusChanged(({ payload }) => { if (!payload) hideNativeTooltip(); });
    return () => {
      disposed = true;
      clearTimeout(tooltipTimer.current);
      void unlisten.then(stop => stop()).catch(console.error);
      void blur.then(stop => stop()).catch(console.error);
    };
  }, [navigation]);
  useEffect(() => {
    if (!isCustomDesktop || !isTauri()) return;
    const nativeWindow = getCurrentWindow();
    let disposed = false;
    const update = async () => {
      const [max, full] = await Promise.all([nativeWindow.isMaximized(), nativeWindow.isFullscreen()]);
      if (!disposed) {
        setMaximized(max); setFullscreen(full);
      }
    };
    const refresh = () => { void update().catch(console.error); };
    refresh();
    const unlisten = nativeWindow.onResized(refresh);
    return () => { disposed = true; void unlisten.then(fn => fn()).catch(console.error); };
  }, []);
  useEffect(() => {
    if (!hasNativeWindowsControls) return;
    let lastLayout = "";
    const update = () => {
      const drag = document.querySelector('.window-drag-space')?.getBoundingClientRect();
      if (!drag) return;
      const canvas = document.querySelector('.login-surface');
      const rgb = canvas ? getComputedStyle(canvas).backgroundColor.match(/\d+/g)?.map(Number) : null;
      const scale = window.devicePixelRatio;
      const layout = {
        left: Math.round(drag.left * scale), width: Math.round(drag.width * scale),
        height: Math.round(drag.bottom * scale), opaque: !navigation,
        color: rgb ? ((rgb[0] << 16) | (rgb[1] << 8) | rgb[2]) : 0xffffff,
      };
      const signature = JSON.stringify(layout);
      if (signature === lastLayout) return;
      lastLayout = signature;
      void invoke('set_window_chrome_layout', layout).catch(error => { lastLayout = ''; console.error(error); });
    };
    const resize = new ResizeObserver(update);
    const header = document.querySelector('.window-chrome');
    if (header) resize.observe(header);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    const frame = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); observer.disconnect(); window.removeEventListener('resize', update); };
  }, [navigation]);
  useEffect(() => {
    if (!hasNativeLinuxControls) return;
    void invoke('set_native_navigation', { visible: navigation, collapsed, peek: Boolean(peek) }).catch(console.error);
  }, [navigation, collapsed, peek]);
  useEffect(() => {
    if (!hasNativeLinuxControls || !navigation) return;
    let disposed = false;
    const unlisten = listen('native-toggle-sidebar', () => {
      if (disposed) return;
      hideNativeTooltip();
      toggleRef.current();
    });
    return () => { disposed = true; void unlisten.then(fn => fn()).catch(console.error); };
  }, [navigation]);
  const perform = (action: () => Promise<void>) => {
    if (!isTauri()) return;
    void action().catch(error => notification.error({ title: '窗口操作失败', description: String(error) }));
  };
  if (hasNativeLinuxControls) return navigation ? <Tooltip
    open={nativeTooltip.open} title={collapsed ? '展开侧栏' : '收起侧栏'}
    placement="bottomLeft" trigger={[]} autoAdjustOverflow>
    <span aria-hidden="true" className="native-sidebar-tooltip-anchor" style={{ left: Math.max(8, nativeTooltip.x - 14), top: nativeTooltip.bottom - 1 }} />
  </Tooltip> : null;
  if (!isMacDesktop && !isCustomDesktop) return null;
  return <><header className={`window-chrome${overlay ? ' window-chrome-overlay' : ''}${isCustomDesktop ? ' window-chrome-custom' : ''}`} data-tauri-drag-region={isMacDesktop || undefined}
    onMouseDown={event => {
      if (!isCustomDesktop || event.button !== 0 || !(event.target as HTMLElement).hasAttribute('data-window-drag')) return;
      event.preventDefault();
      perform(() => event.detail === 2 ? getCurrentWindow().toggleMaximize() : getCurrentWindow().startDragging());
    }} data-window-drag>
    {isMacDesktop && <div className="traffic-light-space" data-tauri-drag-region />}
    {navigation && <Tooltip title={collapsed ? '展开侧栏' : '收起侧栏'} trigger={['hover', 'focus']}><button className="icon-button" aria-label={collapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!collapsed} onClick={toggle}>
      <PanelIcon collapsed={collapsed && !peek} />
    </button></Tooltip>}
    <div className="window-drag-space" data-tauri-drag-region={isMacDesktop || undefined} data-window-drag />

    {hasNativeWindowsControls && !fullscreen && <div className="native-window-controls-space" aria-hidden="true" />}
    {isCustomDesktop && !hasNativeWindowsControls && <div className="window-controls" aria-label="窗口控制">
      <button aria-label="最小化窗口" title="最小化" onClick={() => perform(() => getCurrentWindow().minimize())}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6.5h10" /></svg></button>
      <button aria-label={maximized ? '还原窗口' : '最大化窗口'} title={maximized ? '还原' : '最大化'} onClick={() => perform(() => getCurrentWindow().toggleMaximize())}><svg viewBox="0 0 12 12" aria-hidden="true">{maximized ? <path d="M3.5 3.5v-2h7v7h-2m-7-5h7v7h-7z" /> : <rect x="1.5" y="1.5" width="9" height="9" />}</svg></button>
      <button className="window-close" aria-label="关闭窗口" title="关闭" onClick={() => perform(() => getCurrentWindow().close())}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m1.5 1.5 9 9m0-9-9 9" /></svg></button>
    </div>}
  </header>
    {isCustomDesktop && !hasNativeWindowsControls && isTauri() && !maximized && !fullscreen && <div className="window-resize-regions" aria-hidden="true">{resizeDirections.map(direction => <div key={direction} className={`window-resize-edge edge-${direction}`} onMouseDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      perform(() => getCurrentWindow().startResizeDragging(direction));
    }} />)}</div>}
  </>;
}
