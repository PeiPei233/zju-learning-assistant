import { LoadingOutlined } from '@ant-design/icons';

export default function FetchState({ label, inline = false }: { label: string; inline?: boolean }) {
  return <div className={`fetch-state ${inline ? 'fetch-state-inline' : ''}`} role="status" aria-live="polite">
    <LoadingOutlined spin aria-hidden="true" /><span>{label}</span>
  </div>;
}
