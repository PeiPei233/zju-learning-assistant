import mark from '../../src-tauri/icons/icon-monochrome.svg?raw';

/** Bundled monochrome vector inherits the surrounding text color. */
export default function AppIcon({ className = '' }: { className?: string }) {
  return <span className={`app-icon ${className}`} role="img" aria-label="ZJU Learning Assistant" dangerouslySetInnerHTML={{ __html: mark }} />;
}
