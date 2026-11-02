import { LoadingOutlined, ReloadOutlined } from '@ant-design/icons';

export default function FetchState({ label, inline = false, onRetry }: { label: string; inline?: boolean; onRetry?: () => void }) {
  if (onRetry) return <button type="button" className="fetch-state fetch-state-retry" onClick={onRetry}>
    <ReloadOutlined aria-hidden="true" /><span>{label}</span>
  </button>;
  return <div className={`fetch-state ${inline ? 'fetch-state-inline' : ''}`} role="status" aria-live="polite">
    <LoadingOutlined spin aria-hidden="true" /><span>{label}</span>
  </div>;
}
