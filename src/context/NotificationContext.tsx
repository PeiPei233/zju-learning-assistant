import React, { createContext, useContext, useMemo, useRef } from 'react';
import { App } from 'antd';
import { CheckOutlined, ExclamationCircleOutlined, InfoCircleOutlined, WarningOutlined, CloseOutlined } from '@ant-design/icons';
import type { ArgsProps, NotificationInstance } from 'antd/es/notification/interface';

const NotificationContext = createContext<NotificationInstance | null>(null);
const icons = { success: <CheckOutlined />, error: <ExclamationCircleOutlined />, warning: <WarningOutlined />, info: <InfoCircleOutlined /> };

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { notification } = App.useApp();
  const entries = useRef(new Map<React.Key, number>());
  const sequence = useRef(0);
  const api = useMemo<NotificationInstance>(() => {
    const open = (args: ArgsProps, type = args.type ?? 'info') => {
      const title = args.title ?? args.message;
      // Only coalesce plain notices. Distinct actionable notices retain their callbacks.
      const merge = args.key == null && typeof title === 'string' && (!args.description || typeof args.description === 'string') && !args.actions && !args.btn && !args.onClick;
      const key = args.key ?? (merge ? JSON.stringify([type, title, args.description]) : `notice-${++sequence.current}`);
      const count = merge ? (entries.current.get(key) ?? 0) + 1 : 1;
      if (!entries.current.has(key) && entries.current.size >= 3) {
        const oldest = entries.current.keys().next().value!;
        entries.current.delete(oldest);
        notification.destroy(oldest);
      }
      entries.current.set(key, count);
      const { message: _message, btn: _btn, ...noticeArgs } = args;
      notification.open({
        ...noticeArgs, key, type,
        title: <>{title}{count > 1 && <span className="desktop-notice-count">×{count}</span>}</>,
        actions: args.actions ?? args.btn,
        className: `desktop-notice desktop-notice-${type} ${args.className ?? ''}`,
        icon: args.icon ?? icons[type], closeIcon: args.closeIcon ?? <CloseOutlined />,
        duration: args.duration ?? (type === 'error' || type === 'warning' ? 0 : 6),
        pauseOnHover: true,
        role: args.role ?? (type === 'error' || type === 'warning' ? 'alert' : 'status'),
        onClose: () => { entries.current.delete(key); args.onClose?.(); },
      });
    };
    return {
      open,
      success: args => open(args, 'success'), error: args => open(args, 'error'),
      warning: args => open(args, 'warning'), info: args => open(args, 'info'),
      destroy: key => { if (key === undefined) entries.current.clear(); else entries.current.delete(key); notification.destroy(key); },
    };
  }, [notification]);
  return <NotificationContext.Provider value={api}>{children}</NotificationContext.Provider>;
}

export function useDesktopApp() {
  const app = App.useApp();
  const notification = useContext(NotificationContext);
  return { ...app, notification: notification ?? app.notification };
}
