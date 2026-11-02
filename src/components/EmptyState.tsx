import React from 'react';

/** Shared empty-state markup; callers retain their icons, copy and actions. */
export default function EmptyState({ icon, children, action, className = '' }: {
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return <div className={className ? `${className} resource-empty` : 'resource-empty'}>{icon}<p>{children}</p>{action}</div>;
}
