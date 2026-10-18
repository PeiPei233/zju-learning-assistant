import { useEffect, useRef, useState } from 'react';
import { Config } from '../model';
import { useConfig } from '../context/ConfigContext';

/** Keep unsaved drafts separate from committed config, including edits made during a save. */
export function useConfigAutosave(validate: (fields: (keyof Config)[]) => Promise<boolean>) {
  const { updateConfigBatch } = useConfig();
  const dirty = useRef<Partial<Config>>({});
  const timers = useRef(new Map<keyof Config, ReturnType<typeof setTimeout>>());
  const flight = useRef<Promise<boolean> | null>(null);
  const [status, setStatus] = useState('修改后自动保存');
  const [failed, setFailed] = useState(false);
  const [errorDetails, setErrorDetails] = useState('');
  const [invalid, setInvalid] = useState(false);
  const errors = useRef(new Map<keyof Config, string>());
  const invalidFields = useRef(new Set<keyof Config>());
  const generation = useRef(0);
  const refreshStatus = () => {
    setFailed(errors.current.size > 0);
    setErrorDetails([...new Set(errors.current.values())].join('\n\n'));
    setInvalid(invalidFields.current.size > 0);
    setStatus(errors.current.size ? `保存失败，修改已保留：${[...new Set(errors.current.values())].join('；')}`
      : invalidFields.current.size ? '请检查输入，修改尚未保存'
        : Object.keys(dirty.current).length ? '有修改尚未保存' : '修改后自动保存');
  };
  const [saving, setSaving] = useState(false);
  const latest = useRef({ validate, updateConfigBatch });
  latest.current = { validate, updateConfigBatch };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const save = (fields?: (keyof Config)[]): Promise<boolean> => {
    const revision = generation.current;
    const keys = fields ?? Object.keys(dirty.current) as (keyof Config)[];
    keys.forEach(key => { clearTimeout(timers.current.get(key)); timers.current.delete(key); });
    const operation = (flight.current ?? Promise.resolve(true)).then(async () => {
      if (revision !== generation.current) return false;
      const pending = keys.filter(key => Object.prototype.hasOwnProperty.call(dirty.current, key));
      if (!pending.length) return true;
      if (!await latest.current.validate(pending)) { pending.forEach(key => invalidFields.current.add(key)); refreshStatus(); return false; }
      if (revision !== generation.current) return false;
      pending.forEach(key => invalidFields.current.delete(key));
      const patch = Object.fromEntries(pending.map(key => [key, dirty.current[key]])) as Partial<Config>;
      setSaving(true);
      refreshStatus();
      let error = '';
      const ok = await latest.current.updateConfigBatch(patch, message => { error = message; });
      pending.forEach(key => {
        if (ok) {
          if (dirty.current[key] === patch[key]) { delete dirty.current[key]; errors.current.delete(key); }
        } else errors.current.set(key, error);
      });
      setSaving(false);
      refreshStatus();
      return ok;
    });
    flight.current = operation;
    return operation;
  };
  const change = (values: Partial<Config>, delay?: number) => {
    Object.assign(dirty.current, values);
    refreshStatus();
    for (const key of Object.keys(values) as (keyof Config)[]) {
      clearTimeout(timers.current.get(key));
      if (delay !== undefined) timers.current.set(key, setTimeout(() => { void save([key]); }, delay));
    }
  };
  const discard = () => {
    generation.current++;
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    dirty.current = {};
    errors.current.clear();
    invalidFields.current.clear();
    refreshStatus();
  };
  return { change, save, discard, status, errorDetails, failed, invalid, saving, hasDraft: (key: keyof Config) => Object.prototype.hasOwnProperty.call(dirty.current, key) };
}
