import { App } from 'antd';
import { useDownloadManager, useDownloadDrawer } from '../context/DownloadContext';
import { Task } from '../downloadManager';
import { useConfig } from '../context/ConfigContext';

export function useAddDownloadTasks() {
  const { modal } = App.useApp();
  const downloadManager = useDownloadManager();
  const { openDrawer } = useDownloadDrawer();
  const { config } = useConfig();

  const addTasks = (tasks: Task[]) => {
    if (tasks.length === 0) return;

    let exists = false;
    for (const task of tasks) {
      if (downloadManager.checkTaskExists(task)) {
        exists = true;
        break;
      }
    }

    const doAdd = (reDownload: boolean) => {
      tasks.forEach((task) => {
        downloadManager.addTask(task, reDownload);
      });
      
      if (config.auto_open_download_list) {
        openDrawer();
      }
    };

    if (exists) {
      modal.confirm({
        title: '下载确认',
        content: '部分课件已在下载列表中，是否重新下载？',
        onOk: () => doAdd(true),
        onCancel: () => doAdd(false),
      });
    } else {
      doAdd(true);
    }
  };

  return addTasks;
}
