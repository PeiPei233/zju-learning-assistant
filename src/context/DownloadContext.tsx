import { getPreviewData } from '../previewMode';
import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import { DownloadManager, Task, LearningTask } from '../downloadManager';

interface DownloadContextType {
  manager: DownloadManager;
  pageRequested: boolean;
  requestDownloadPage: () => void;
  consumePageRequest: () => void;
}

const DownloadContext = createContext<DownloadContextType | null>(null);

export const DownloadProvider = ({ children }: { children: ReactNode }) => {
  const managerRef = useRef<DownloadManager | null>(null);
  if (!managerRef.current) {
    managerRef.current = new DownloadManager();
    const preview = getPreviewData();
    if (preview) managerRef.current.tasks = preview.uploads.map((upload, index) => {
      const task = new LearningTask(upload);
      task.status = ['done', 'failed', 'canceled'][index % 3];
      task.progress = index % 3 === 0 ? 1 : 0;
      task.errorMessage = index % 3 === 1 ? '模拟网络错误，可点击重试' : '';
      return task;
    });
  }
  const [pageRequested, setPageRequested] = useState(false);

  const requestDownloadPage = useCallback(() => setPageRequested(true), []);
  const consumePageRequest = useCallback(() => setPageRequested(false), []);

  return (
    <DownloadContext.Provider value={{
      manager: managerRef.current,
      pageRequested,
      requestDownloadPage,
      consumePageRequest
    }}>
      {children}
    </DownloadContext.Provider>
  );
};

export const useDownloadManager = () => {
  const context = useContext(DownloadContext);
  if (!context) {
    throw new Error('useDownloadManager must be used within a DownloadProvider');
  }
  return context.manager;
};

export const useDownloadNavigation = () => {
  const context = useContext(DownloadContext);
  if (!context) {
    throw new Error('useDownloadNavigation must be used within a DownloadProvider');
  }
  return {
    pageRequested: context.pageRequested,
    requestDownloadPage: context.requestDownloadPage,
    consumePageRequest: context.consumePageRequest
  };
}

// 封装轮询逻辑，让 UI 组件傻瓜式使用
export const useDownloadList = () => {
  const manager = useDownloadManager();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const update = () => {
      setTasks([...manager.getTasks()].reverse());
      setCount(manager.getDownloadingCount());
    };

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [manager]);

  return { tasks, count, manager };
};
