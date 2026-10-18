import { useDesktopApp } from './NotificationContext';
import { createContext, useContext, useEffect, useState, useRef, useMemo, ReactNode } from 'react';
import { invoke } from '../bridge';
import { Config } from '../model';

interface ConfigContextType {
  config: Config;
  updateConfigField: (field: keyof Config, value: any) => Promise<boolean>;
  updateConfigBatch: (updates: Partial<Config>, onError?: (error: string) => void) => Promise<boolean>;
  isSaving: (field?: keyof Config) => boolean;
  refreshConfig: () => Promise<void>;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export const ConfigProvider = ({ children }: { children: ReactNode }) => {
  const [config, setConfigState] = useState<Config>(new Config());
  const committed = useRef(config);
  const [optimistic, setOptimistic] = useState<{ id: number; patch: Partial<Config> }[]>([]);
  const sequence = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [pending, setPending] = useState<Record<string, number>>({});
  const isSaving = (field?: keyof Config) => field ? !!pending[field] : Object.values(pending).some(Boolean);
  const { notification } = useDesktopApp();

  const refreshConfig = async () => {
    try {
      const res = await invoke('get_config') as Partial<Config>;
      committed.current = new Config(res);
      setConfigState(committed.current);
    } catch (err) {
      notification.error({
        title: '获取设置失败',
        description: String(err)
      });
    }
  };

  useEffect(() => {
    queue.current = refreshConfig();
    // Initialize the save queue once; a save must not trigger another config fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateConfigBatch = (updates: Partial<Config>, onError?: (error: string) => void): Promise<boolean> => {
    const id = ++sequence.current;
    setOptimistic(previous => [...previous, { id, patch: updates }]);
    const fields = Object.keys(updates);
    const markPending = (delta: number) => setPending(previous => {
      const next = { ...previous };
      fields.forEach(field => { next[field] = Math.max(0, (next[field] || 0) + delta); });
      return next;
    });
    markPending(1);
    // Merge each patch into the latest successful save, not a stale render snapshot.
    const operation = queue.current.then(async () => {
      const next = committed.current.clone();
      Object.assign(next, updates);
      const connectionFields = ['llm_api_base', 'llm_api_key', 'llm_model'] as const;
      const disableIncompleteAi = next.llm_enabled && connectionFields.some(field => fields.includes(field))
        && connectionFields.some(field => !next[field]?.trim());
      if (disableIncompleteAi) next.llm_enabled = false;
      try {
        await invoke('set_config', { config: next });
        committed.current = next;
        setConfigState(next);
        if (disableIncompleteAi) notification.warning({
          key: 'llm-config-incomplete', title: 'AI 总结配置未完成，已关闭', duration: 6,
        });
        return true;
      } catch (err) {
        if (onError) onError(String(err));
        else notification.error({ title: '设置失败', description: String(err) });
        return false;
      } finally {
        setOptimistic(previous => previous.filter(item => item.id !== id));
        markPending(-1);
      }
    });
    queue.current = operation;
    return operation;
  };
  const updateConfigField = (field: keyof Config, value: any) => updateConfigBatch({ [field]: value });

  const displayedConfig = useMemo(() => Object.assign(config.clone(), ...optimistic.map(item => item.patch)), [config, optimistic]);
  return (
    <ConfigContext.Provider value={{ config: displayedConfig, updateConfigField, updateConfigBatch, refreshConfig, isSaving }}>
      {children}
    </ConfigContext.Provider>
  );
};

export const useConfig = () => {
  const context = useContext(ConfigContext);
  if (!context) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
};
