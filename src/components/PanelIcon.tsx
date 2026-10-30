
export default function PanelIcon({ collapsed }: { collapsed: boolean }) {
  return <svg className={`panel-state-icon ${collapsed ? 'is-collapsed' : 'is-expanded'}`} width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="2" y="3" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.4" />
    <path className="panel-icon-divider" d="M8 3v14" stroke="currentColor" strokeWidth="1.4" />
    <path className="panel-icon-fill" d="M5 6v8" stroke="currentColor" strokeWidth="2" />
  </svg>;
}
