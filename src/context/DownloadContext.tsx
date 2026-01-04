import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { DownloadManager, Task } from '../downloadManager';

interface DownloadContextType {
    manager: DownloadManager;
    isDrawerOpen: boolean;
    openDrawer: () => void;
    closeDrawer: () => void;
}

const DownloadContext = createContext<DownloadContextType | null>(null);

export const DownloadProvider = ({ children }: { children: ReactNode }) => {
    const managerRef = useRef(new DownloadManager());
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    const openDrawer = () => setIsDrawerOpen(true);
    const closeDrawer = () => setIsDrawerOpen(false);

    return (
        <DownloadContext.Provider value={{ 
            manager: managerRef.current, 
            isDrawerOpen, 
            openDrawer, 
            closeDrawer 
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

export const useDownloadDrawer = () => {
    const context = useContext(DownloadContext);
    if (!context) {
        throw new Error('useDownloadDrawer must be used within a DownloadProvider');
    }
    return {
        isDrawerOpen: context.isDrawerOpen,
        openDrawer: context.openDrawer,
        closeDrawer: context.closeDrawer
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
