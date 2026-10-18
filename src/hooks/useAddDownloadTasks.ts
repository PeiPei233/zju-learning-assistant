import { App } from 'antd';
import { useDownloadManager, useDownloadNavigation } from '../context/DownloadContext';
import { Task } from '../downloadManager';
import { useConfig } from '../context/ConfigContext';

export function useAddDownloadTasks() {
  const { modal } = App.useApp();
  const downloadManager = useDownloadManager();
  const { requestDownloadPage } = useDownloadNavigation();
  const { config } = useConfig();

  const addTasks = async (tasks: Task[]): Promise<boolean> => {
    if (tasks.length === 0) return false;

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
        requestDownloadPage();
      }
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
              doAdd(false);
              resolve(true);
              confirmation.destroy();
            },
          },
          onOk: () => { doAdd(true); resolve(true); },
          onCancel: () => resolve(false),
          afterClose: () => resolve(false),
        });
      });
    } else {
      doAdd(true);
      return true;
    }
  };

  return addTasks;
}
