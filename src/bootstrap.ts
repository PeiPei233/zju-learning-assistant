async function start() {
  if (import.meta.env.DEV && import.meta.env.VITE_UI_PREVIEW === 'true') {
    const { installPreview } = await import('./preview/install');
    installPreview();
  }
  await import('./main');
}
void start().catch(error => {
  console.error(error);
  const root = document.getElementById('root');
  if (root) { root.style.cssText = 'padding:64px 24px;color:#fff;background:#202020;white-space:pre-wrap'; root.textContent = `界面启动失败：${String(error)}`; }
});
