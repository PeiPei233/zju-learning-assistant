// Build-time guard: the fixture module is never loaded in a production build.
export const isPreview = import.meta.env?.DEV && import.meta.env?.VITE_UI_PREVIEW === 'true';
export const getPreviewData = () => isPreview ? window.__ZJU_PREVIEW_DATA__ : undefined;
