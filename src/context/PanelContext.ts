import { createContext } from 'react';

export const PanelContext = createContext<{
  collapsed: boolean;
  toggle: () => void;
  width?: number;
  setWidth?: (width: number) => void;
  peek?: string | null;
  module?: string;
  keepPeek?: () => void;
  dismissPeek?: () => void;
  activateModule?: (page: string) => void;
}>({ collapsed: false, toggle: () => { } });
