import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Config } from '../model';
import { App } from 'antd';

interface ConfigContextType {
  config: Config;
  updateConfigField: (field: keyof Config, value: any) => Promise<void>;
  updateConfigBatch: (updates: Partial<Config>) => Promise<void>;
  refreshConfig: () => Promise<void>;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export const ConfigProvider = ({ children }: { children: ReactNode }) => {
  const [config, setConfigState] = useState<Config>(new Config());
  const { notification } = App.useApp();

  const refreshConfig = async () => {
    try {
      const res = await invoke('get_config') as Partial<Config>;
      setConfigState(new Config(res));
    } catch (err) {
      notification.error({
        message: '获取设置失败',
        description: String(err)
      });
    }
  };

  useEffect(() => {
    refreshConfig();
  }, []);

  const updateConfigField = async (field: keyof Config, value: any) => {
    const newConfig = config.clone();
    // @ts-ignore
    newConfig[field] = value;
    try {
      await invoke('set_config', { config: newConfig });
      setConfigState(newConfig);
    } catch (err) {
      notification.error({
        message: '设置失败',
        description: String(err)
      });
      throw err;
    }
  };

  const updateConfigBatch = async (updates: Partial<Config>) => {
    const newConfig = config.clone();
    Object.assign(newConfig, updates);
    try {
      await invoke('set_config', { config: newConfig });
      setConfigState(newConfig);
    } catch (err) {
      notification.error({
        message: '设置失败',
        description: String(err)
      });
      throw err;
    }
  };

  return (
    <ConfigContext.Provider value={{ config, updateConfigField, updateConfigBatch, refreshConfig }}>
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
