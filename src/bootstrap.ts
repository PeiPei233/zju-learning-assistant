async function start() {
  if (import.meta.env.DEV && import.meta.env.VITE_UI_PREVIEW === 'true') {
    const { installPreview } = await import('./preview/install');
    installPreview();
  }
  await import('./main');
}
void start().catch(async error => {
  console.error(error);
  const root = document.getElementById('root');
  if (root) { root.style.cssText = 'padding:64px 24px;color:#fff;background:#202020;white-space:pre-wrap'; root.textContent = `界面启动失败：${String(error)}`; }
  // A startup exception must still be visible when the native window is hidden.
  const { invoke, isTauri } = await import('@tauri-apps/api/core');
  if (isTauri()) await invoke('show_main_window').catch(console.error);
});
