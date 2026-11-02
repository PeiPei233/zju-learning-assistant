import React from 'react';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'secondary';
  iconOnly?: boolean;
};

/** Shared controls for page toolbars, task actions and footer actions. */
const ActionButton = React.forwardRef<HTMLButtonElement, Props>(function ActionButton({ variant = 'default', iconOnly = false, className = '', ...props }, ref) {
  return <button ref={ref} {...props} type={props.type || 'button'} className={`action-button ${variant === 'primary' ? 'primary-button' : variant === 'secondary' ? 'tool-button secondary-button' : 'tool-button'} ${iconOnly ? 'action-button-icon' : ''} ${className}`} />;
});

export default ActionButton;
