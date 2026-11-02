import React from 'react';
import { Tooltip } from 'antd';
import ActionButton from './ActionButton';

export default function IconAction({ label, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <Tooltip title={label} trigger={['hover', 'focus']}>
    <ActionButton {...props} iconOnly aria-label={props['aria-label'] || label}>{children}</ActionButton>
  </Tooltip>;
}
