import './design/typography.css';
import './design/settings-modal.css';
import { NotificationProvider } from './context/NotificationContext';
import './design/notifications.css';
import './pages/Login/login.css';
import { createControlTheme } from './design/theme';
import './design/controls.css';
import { useEffect, useLayoutEffect, useState, lazy, Suspense } from 'react'
import { isPreview } from './previewMode';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ConfigProvider, App } from 'antd'
import { createRoot } from 'react-dom/client'
import { useMediaQuery } from 'react-responsive'
import zhCN from 'antd/locale/zh_CN';
import Index from './Index'
import './global.css'
import './components/WindowChrome.css'
import './design/scrollbars.css'
import './components/ResourceList.css'
import './pages/Todo/todo.css'
import { ConfigProvider as AppConfigProvider } from './context/ConfigContext'
import { DownloadProvider } from './context/DownloadContext'

const ControlsPreview = import.meta.env.DEV && import.meta.env.VITE_UI_PREVIEW === 'true'
  ? lazy(() => import('./preview/ControlsPreview')) : null;

export function Main() {
  const nativeLinux = isTauri() && /Linux/.test(navigator.platform) && !/Android/.test(navigator.userAgent);
  const [nativeHeaderHeight, setNativeHeaderHeight] = useState(nativeLinux ? 38 : 0);
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--native-header-height', `${nativeHeaderHeight}px`);
  }, [nativeHeaderHeight]);
  useEffect(() => {
    if (!nativeLinux) return;
    let disposed = false;
    let receivedEvent = false;
    const unlisten = listen<number>('native-chrome-height', ({ payload }) => {
      receivedEvent = true;
      if (!disposed) setNativeHeaderHeight(Math.max(0, payload));
    });
    // Subscribe before reading so a resize cannot disappear between the two.
    void unlisten.then(() => invoke<number>('get_native_chrome_height')).then(height => {
      if (!disposed && !receivedEvent) setNativeHeaderHeight(Math.max(0, height));
    }).catch(console.error);
    return () => { disposed = true; void unlisten.then(stop => stop()).catch(console.error); };
  }, [nativeLinux]);


  const systemDarkMode = useMediaQuery({
    query: '(prefers-color-scheme: dark)'
  })
  const previewTheme = isPreview ? new URLSearchParams(location.search).get('theme') : null;
  const isDarkMode = previewTheme === 'dark' || (previewTheme !== 'light' && systemDarkMode);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = isDarkMode ? 'dark' : 'light';
  }, [isDarkMode]);

  useEffect(() => {
    // The translucent rail/titlebar reveal the native macOS material underneath.
    // Keep its appearance in sync with the preview override, including system reset.
    if (!isPreview || !isTauri()) return;
    const theme = previewTheme === 'light' || previewTheme === 'dark' ? previewTheme : null;
    getCurrentWindow().setTheme(theme).catch(error => console.error('Failed to update preview window theme', error));
  }, [previewTheme]);

  useEffect(() => {
    if (import.meta.env.PROD) {
      // disable context menu
      const disableContextMenu = (e: MouseEvent) => {
        e.preventDefault()
      }

      document.addEventListener('contextmenu', disableContextMenu)

      return () => {
        document.removeEventListener('contextmenu', disableContextMenu)
      }
    }
  }, [])

  useEffect(() => {
    if (!isTauri() || !/Win|Linux/.test(navigator.platform)) return;
    // Hidden WebViews may suspend requestAnimationFrame; React's effect already
    // runs after the DOM and theme have been committed.
    void invoke('set_window_chrome_theme', { dark: isDarkMode })
      .catch(console.error)
      .then(async () => {
        if (/Win/.test(navigator.platform)) {
          const available = await invoke<boolean>('has_native_backdrop');
          document.documentElement.dataset.nativeBackdrop = available ? 'true' : 'false';
        }
        await invoke('show_main_window');
      })
      .catch(console.error);
  }, [isDarkMode]);

  const controls = createControlTheme(isDarkMode);
  return (
    <ConfigProvider
      locale={zhCN}
      variant="filled"
      theme={controls.theme}
    >
      <style>{controls.css}</style>
      <App notification={{ placement: 'topRight', top: Math.max(12, 56 - nativeHeaderHeight), maxCount: 3, stack: false, duration: 6, pauseOnHover: true }}>
        <NotificationProvider>
          <AppConfigProvider>
            <DownloadProvider>
              {ControlsPreview && new URLSearchParams(location.search).has('controls')
                ? <Suspense fallback={null}><ControlsPreview /></Suspense> : <Index />}
            </DownloadProvider>
          </AppConfigProvider>
        </NotificationProvider>
      </App>
    </ConfigProvider>
  )
}

const container = document.getElementById('root');
if (container) {
  const root = import.meta.hot?.data.reactRoot ?? createRoot(container);
  if (import.meta.hot) import.meta.hot.data.reactRoot = root;
  root.render(
    <Main />
  )
}
