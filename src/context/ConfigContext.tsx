import { useDesktopApp } from './NotificationContext';
import { createContext, useContext, useEffect, useState, useRef, useMemo, useCallback, ReactNode } from 'react';
import { invoke } from '../bridge';
import { Config } from '../model';

interface ConfigContextType {
  config: Config;
  savedConfig: Config;
  ready: boolean;
  loadError: string | null;
  loadingConfig: boolean;
  updateConfigField: (field: keyof Config, value: any) => Promise<boolean>;
  updateConfigBatch: (updates: Partial<Config>, onError?: (error: string) => void) => Promise<boolean>;
  isSaving: (field?: keyof Config) => boolean;
  refreshConfig: () => Promise<void>;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export const ConfigProvider = ({ children }: { children: ReactNode }) => {
  const [config, setConfigState] = useState<Config>(new Config());
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const loadFlight = useRef<Promise<void> | null>(null);
  const committed = useRef(config);
  const loaded = useRef(false);
  const [optimistic, setOptimistic] = useState<{ id: number; patch: Partial<Config> }[]>([]);
  const sequence = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [pending, setPending] = useState<Record<string, number>>({});
  const isSaving = (field?: keyof Config) => field ? !!pending[field] : Object.values(pending).some(Boolean);
  const { notification } = useDesktopApp();

  const refreshConfig = useCallback((): Promise<void> => {
    if (loadFlight.current) return loadFlight.current;
    setLoadingConfig(true);
    const operation = queue.current.then(async () => {
      try {
        const res = await invoke('get_config') as Partial<Config>;
        committed.current = new Config(res);
        setConfigState(committed.current);
        setLoadError(null);
        loaded.current = true;
        setReady(true);
      } catch (err) {
        // A disk error must not discard a usable runtime configuration. On first
        // load, get the complete backend defaults (including platform paths).
        if (!loaded.current) {
          try {
            const fallback = await invoke<Config>('get_runtime_config');
            if (!fallback) throw new Error('未获取到运行配置');
            committed.current = new Config(fallback);
            setConfigState(committed.current);
            loaded.current = true;
            setReady(true);
          } catch {
            // IPC/backend failure: no complete snapshot is available yet.
            setReady(false);
          }
        }
        setLoadError(String(err));
        notification.error({ title: '读取设置失败', description: loaded.current
          ? `${String(err)}。正在使用已有设置或默认设置，原配置文件未被修改。`
          : String(err) });
      } finally {
        setLoadingConfig(false);
        loadFlight.current = null;
      }
    });
    queue.current = operation;
    loadFlight.current = operation;
    return operation;
  }, [notification]);

  useEffect(() => {
    void refreshConfig();
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
    // Reads and writes share one queue, so a late read cannot replace a newer save.
    const operation = queue.current.then(async () => {
      try {
        if (!loaded.current) throw new Error('设置尚未读取成功，请重试读取设置后再修改。');
        const previous = committed.current;
        const next = new Config(await invoke('set_config', { patch: updates }) as Partial<Config>);
        committed.current = next;
        setConfigState(next);
        setLoadError(null);
        if (previous.llm_enabled && !next.llm_enabled && ['llm_api_base', 'llm_api_key', 'llm_model'].some(field => fields.includes(field))) notification.warning({
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
    <ConfigContext.Provider value={{ config: displayedConfig, savedConfig: config, ready, loadError, loadingConfig, updateConfigField, updateConfigBatch, refreshConfig, isSaving }}>
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
