import { createElement, useEffect, useId, useRef, useState } from 'react';
import { Config } from '../model';
import { useConfig } from '../context/ConfigContext';
import { useDesktopApp } from '../context/NotificationContext';
import ActionButton from '../components/ActionButton';

/** Keep unsaved drafts separate from committed config, including edits made during a save. */
export function useConfigAutosave(validate: (fields: (keyof Config)[]) => Promise<boolean>) {
  const { notification } = useDesktopApp();
  const noticeKey = useId();
  useEffect(() => () => notification.destroy(noticeKey), [notification, noticeKey]);
  const { updateConfigBatch, setDraftPending } = useConfig();
  const draftOwner = useRef({});
  const mounted = useRef(true);
  const dirty = useRef<Partial<Config>>({});
  const timers = useRef(new Map<keyof Config, ReturnType<typeof setTimeout>>());
  const flight = useRef<Promise<boolean> | null>(null);
  const errors = useRef(new Map<keyof Config, string>());
  const markDraftPending = () => {
    if (mounted.current) setDraftPending(draftOwner.current, Object.keys(dirty.current).length > 0);
  };
  const [saving, setSaving] = useState(false);
  const latest = useRef({ validate, updateConfigBatch });
  latest.current = { validate, updateConfigBatch };
  useEffect(() => {
    mounted.current = true;
    const owner = draftOwner.current;
    const pendingTimers = timers.current;
    setDraftPending(owner, Object.keys(dirty.current).length > 0);
    return () => {
      mounted.current = false;
      pendingTimers.forEach(clearTimeout);
      setDraftPending(owner, false);
    };
  }, [setDraftPending]);

  const save = (fields?: (keyof Config)[]): Promise<boolean> => {
    const keys = fields ?? Object.keys(dirty.current) as (keyof Config)[];
    keys.forEach(key => { clearTimeout(timers.current.get(key)); timers.current.delete(key); });
    const operation = (flight.current ?? Promise.resolve(true)).then(async () => {
      if (!mounted.current) return false;
      const pending = keys.filter(key => Object.prototype.hasOwnProperty.call(dirty.current, key));
      if (!pending.length) return true;
      if (!await latest.current.validate(pending) || !mounted.current) return false;
      const patch = Object.fromEntries(pending.map(key => [key, dirty.current[key]])) as Partial<Config>;
      setSaving(true);
      markDraftPending();
      let error = '';
      const ok = await latest.current.updateConfigBatch(patch, message => { error = message; });
      pending.forEach(key => {
        if (ok) {
          if (dirty.current[key] === patch[key]) { delete dirty.current[key]; errors.current.delete(key); }
        } else errors.current.set(key, error);
      });
      setSaving(false);
      markDraftPending();
      if (mounted.current) {
        if (!errors.current.size) notification.destroy(noticeKey);
        else if (!ok) notification.error({
          key: noticeKey, title: '设置失败', description: error,
          actions: createElement(ActionButton, { onClick: () => { if (mounted.current) void save(); } }, '重试保存'),
        });
      }
      return ok;
    });
    flight.current = operation;
    return operation;
  };
  const change = (values: Partial<Config>, delay?: number) => {
    Object.assign(dirty.current, values);
    markDraftPending();
    for (const key of Object.keys(values) as (keyof Config)[]) {
      clearTimeout(timers.current.get(key));
      if (delay !== undefined) timers.current.set(key, setTimeout(() => { void save([key]); }, delay));
    }
  };
  return { change, save, saving, hasDraft: (key: keyof Config) => Object.prototype.hasOwnProperty.call(dirty.current, key) };
}
