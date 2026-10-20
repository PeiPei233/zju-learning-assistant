import type { ReactNode } from 'react';

/** Shared layout for short settings and full-width text fields. */
export default function SettingField({ label, description, htmlFor, stacked = false, action, error, children, className = '' }: {
  className?: string; label: string; description?: ReactNode; htmlFor?: string; stacked?: boolean;
  action?: ReactNode; error?: string; children: ReactNode;
}) {
  return <div className={`setting-field${stacked ? ' setting-field-stacked' : ''} ${className}`}>
    <div className="setting-field-heading">
      <div className="setting-field-copy">
        <label htmlFor={htmlFor}>{label}</label>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
    <div className="setting-field-control">{children}
      {error && <p className="setting-field-error" id={htmlFor ? `${htmlFor}-error` : undefined} role="alert">{error}</p>}
    </div>
  </div>;
}
