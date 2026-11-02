import EmptyState from '../../components/EmptyState';
import { useDesktopApp } from '../../context/NotificationContext';
import ActionButton from '../../components/ActionButton';
import { useState } from 'react';
import Workspace from '../../components/Workspace';
import PanelHeading from '../../components/PanelHeading';
import IconAction from '../../components/IconAction';
import FileTypeIcon from '../../components/FileTypeIcon';
import OverflowText from '../../components/OverflowText';
import { Progress } from 'antd';
import OpenActionButton from '../../components/OpenActionButton';
import { LoadingOutlined, FolderOpenOutlined, ReloadOutlined, CloseCircleOutlined, CloseOutlined, ClearOutlined, DownloadOutlined } from '@ant-design/icons';
import { ClassroomTask, DownloadManager, Task } from '../../downloadManager';

const statusLabels: Record<string, string> = { pending: '等待中', downloading: '下载中', writing: '写入中', done: '已完成', failed: '失败', canceling: '正在取消…', canceled: '已取消' };

interface DownloadProps {
  taskList: Task[];
  downloadManager: DownloadManager;
}

export default function Download({ taskList, downloadManager }: DownloadProps) {
  const { notification } = useDesktopApp();

  const [filter, setFilter] = useState('all');
  const filters = [
    { key: 'all', label: '全部任务', match: (_: Task) => true },
    { key: 'active', label: '进行中', match: (task: Task) => ['pending', 'downloading', 'writing', 'canceling'].includes(task.status) },
    { key: 'done', label: '已完成', match: (task: Task) => task.status === 'done' },
    { key: 'failed', label: '失败与取消', match: (task: Task) => ['failed', 'canceled'].includes(task.status) },
  ];
  const currentFilter = filters.find(item => item.key === filter)!;
  return (
    <Workspace title={currentFilter.label} panel={<>
      <PanelHeading><h2>下载列表</h2></PanelHeading>
      <nav className="context-navigation" aria-label="下载分类">{filters.map(item => <button key={item.key}
        className={filter === item.key ? 'active' : ''} aria-current={filter === item.key ? 'page' : undefined}
        onClick={() => setFilter(item.key)}>{item.label}<span>{taskList.filter(item.match).length}</span></button>)}</nav>
      <div className="panel-bottom">切换页面后，下载继续在后台运行。</div>
    </>} actions={<div className="download-batch-actions">
      <ActionButton variant="secondary" disabled={!taskList.length} onClick={() => downloadManager.reDownloadAllTasks()}><ReloadOutlined />全部重新开始</ActionButton>
      <ActionButton variant="secondary" disabled={!taskList.some(task => ['pending', 'downloading', 'writing', 'canceling'].includes(task.status))} onClick={() => downloadManager.cancelAllTasks()}><CloseCircleOutlined />全部取消</ActionButton>
      <ActionButton variant="secondary" disabled={!taskList.length} onClick={() => downloadManager.cleanUp()}><ClearOutlined />清空列表</ActionButton>
    </div>}>
      <div className="download-content">
        {taskList.filter(currentFilter.match).length === 0 && <EmptyState className="download-empty" icon={<DownloadOutlined aria-hidden="true" />}>{!taskList.length ? '暂无下载任务，可在课程页面选择课件下载' : filter === 'active' ? '暂无进行中的任务' : filter === 'done' ? '暂无已完成的任务' : '暂无失败或取消的任务'}</EmptyState>}
        <div className="download-task-list" role="list" aria-label={currentFilter.label}>
          {taskList.filter(currentFilter.match).map(item => {
            const Content = item.status === 'done' ? OpenActionButton : 'div';
            return <div className="download-task" role="listitem" key={item.id}>
              <Content className={`download-task-content ${item.status === 'done' ? 'download-task-open' : ''}`}
                type={item.status === 'done' ? 'button' : undefined}
                aria-label={item.status === 'done' ? `打开文件 ${item.name}` : undefined}
                onClick={item.status === 'done' ? () => { void downloadManager.openTask(item.id, false).catch(err => notification.error({ title: '打开文件失败', description: String(err) })); } : undefined}>
                <FileTypeIcon name={item.name} extension={item instanceof ClassroomTask ? (item.toPdf ? 'pdf' : 'png') : undefined} className="download-file-icon" />
                <span className="download-task-copy">
                  <OverflowText className="download-task-name" text={item.name} />
                  <span className={`download-task-detail ${item.status === 'failed' ? 'is-error' : ''}`}>
                    <span className="download-status">{item.status === 'canceling' || item.status === 'writing' || (item.status === 'downloading' && item.totalSize <= 0)
                      ? <><LoadingOutlined spin /> {['writing', 'canceling'].includes(item.status) ? item.getDescription() : (item.msg || (item.downloadedSize > 0 ? item.getDescription() : '正在准备下载'))}</>
                      : (statusLabels[item.status] || item.status)}</span>
                    {item.getDescription() !== statusLabels[item.status] && item.status !== 'done' && item.status !== 'writing' && item.status !== 'canceling' && !(item.status === 'downloading' && item.totalSize <= 0) && <span>{item.getDescription()}</span>}
                  </span>
                  {item.status === 'downloading' && item.totalSize > 0 && <Progress size="small" percent={Math.floor(item.progress * 100)} status="active" />}
                </span>
              </Content>
              <div className="download-task-actions">
                {['failed', 'canceled'].includes(item.status) && <IconAction label="重新下载" aria-label={`重新下载 ${item.name}`} onClick={() => downloadManager.reDownloadTask(item.id)}><ReloadOutlined /></IconAction>}
                {['pending', 'downloading', 'writing'].includes(item.status) && <IconAction label="取消下载" aria-label={`取消下载 ${item.name}`} onClick={() => downloadManager.cancelTask(item.id)}><CloseCircleOutlined /></IconAction>}
                {item.status === 'done' && <>
                  <IconAction label="打开文件夹" aria-label={`打开 ${item.name} 所在文件夹`} onClick={() => downloadManager.openTask(item.id, true).catch(err => notification.error({ title: '打开文件夹失败', description: String(err) }))}><FolderOpenOutlined /></IconAction>
                </>}
                {['done', 'failed', 'canceled'].includes(item.status) && <IconAction label="移除记录" aria-label={`移除 ${item.name} 的下载记录`} onClick={() => downloadManager.removeTask(item.id)}><CloseOutlined /></IconAction>}
              </div>
            </div>;
          })}
        </div>
      </div>
    </Workspace>
  );
}
