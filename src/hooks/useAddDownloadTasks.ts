import { App } from 'antd';
import { useRef } from 'react';
import { useDownloadManager, useDownloadNavigation } from '../context/DownloadContext';
import { Task } from '../downloadManager';
import { useConfig } from '../context/ConfigContext';

export function useAddDownloadTasks() {
  const { modal } = App.useApp();
  const downloadManager = useDownloadManager();
  const { requestDownloadPage } = useDownloadNavigation();
  const { savedConfig: config, ready } = useConfig();
  const latest = useRef({ config, ready }); latest.current = { config, ready };

  const addTasks = async (tasks: Task[]): Promise<boolean> => {
    if (!latest.current.ready || tasks.length === 0) return false;

    let exists = false;
    for (const task of tasks) {
      if (downloadManager.checkTaskExists(task)) {
        exists = true;
        break;
      }
    }

    const doAdd = (reDownload: boolean) => {
      if (!latest.current.ready) return false;
      tasks.forEach((task) => {
        downloadManager.addTask(task, reDownload);
      });

      if (latest.current.config.auto_open_download_list) {
        requestDownloadPage();
      }
      return true;
    };

    if (exists) {
      return new Promise<boolean>((resolve) => {
        const confirmation = modal.confirm({
          className: 'desktop-modal desktop-confirm',
          width: 400,
          centered: true,
          icon: null,
          title: '重新下载已有课件？',
          content: '部分课件已在下载列表中。可重新下载，或跳过已有课件，仅添加新课件。',
          okText: '重新下载',
          cancelText: '跳过已有课件',
          autoFocusButton: 'cancel',
          // Only this explicit action adds new tasks; Esc merely dismisses.
          cancelButtonProps: {
            autoInsertSpace: false,
            onClick: () => {
              resolve(doAdd(false));
              confirmation.destroy();
            },
          },
          onOk: () => { resolve(doAdd(true)); },
          onCancel: () => resolve(false),
          afterClose: () => resolve(false),
        });
      });
    } else {
      return doAdd(true);
    }
  };

  return addTasks;
}
