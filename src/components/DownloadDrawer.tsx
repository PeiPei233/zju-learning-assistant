import React from 'react';
import { Drawer, List, Typography, Button, Tooltip, Progress, App } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, CloseOutlined, DeleteOutlined, FolderOutlined } from '@ant-design/icons';
import { DownloadManager, Task } from '../downloadManager';

const { Text, Link } = Typography;

interface DownloadDrawerProps {
  open: boolean;
  onClose: () => void;
  taskList: Task[];
  downloadManager: DownloadManager;
}

export default function DownloadDrawer({ open, onClose, taskList, downloadManager }: DownloadDrawerProps) {
  const { notification } = App.useApp();

  return (
    <Drawer
      open={open}
      onClose={onClose}
      closeIcon={<ArrowLeftOutlined />}
      resizable={true}
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignContent: 'center' }}>
          <div>下载列表</div>
          <div style={{ float: 'right' }}>
            <Tooltip title='全部重新开始'>
              <Button
                type='text'
                icon={<ReloadOutlined />}
                size='small'
                onClick={() => {
                  downloadManager.reDownloadAllTasks()
                }}
              />
            </Tooltip>
            <Tooltip title='全部取消'>
              <Button
                type='text'
                icon={<CloseOutlined />}
                size='small'
                onClick={() => {
                  downloadManager.cancelAllTasks()
                }}
              />
            </Tooltip>
            <Tooltip title='清空下载列表'>
              <Button
                type='text'
                icon={<DeleteOutlined />}
                size='small'
                onClick={() => {
                  downloadManager.cleanUp()
                }}
              />
            </Tooltip>
          </div>
        </div>
      }
    >
      <List
        itemLayout='horizontal'
        dataSource={taskList}
        renderItem={item => (
          <List.Item>
            <List.Item.Meta
              title={<Text
                ellipsis={{
                  rows: 1,
                  expandable: false,
                  tooltip: true
                }}
                style={{
                  fontWeight: 'normal',
                }}>{item.name}</Text>}
              description={<div>
                {item.status !== 'failed' && item.status !== 'done' && <Text type="secondary" style={{
                  fontWeight: 'normal',
                  fontSize: 12
                }}>{item.getDescription()}</Text>}
                {item.status === 'done' && <Link
                  onClick={() => {
                    downloadManager.openTask(item.id, false).catch((err) => {
                      notification.error({
                        message: '打开文件失败',
                        description: String(err)
                      })
                    })
                  }}
                  style={{
                    fontWeight: 'normal',
                    fontSize: 12
                  }}>打开文件</Link>}
                {item.status === 'failed' && <Text type="danger" style={{
                  fontWeight: 'normal',
                  fontSize: 12
                }}>{item.getDescription()}</Text>}
                {item.status === 'downloading' &&
                  <Progress
                    size='small'
                    percent={item.progress * 100}
                    status={item.status === 'failed' ? 'exception' : item.status === 'done' ? 'success' : 'active'}
                    format={(percent) => Math.floor(percent || 0) + '%'}
                  />}
              </div>}
            />
            {(item.status === 'canceled' || item.status === 'failed') && <Tooltip title='重新下载'><Button icon={<ReloadOutlined />} type='text'
              onClick={() => {
                downloadManager.reDownloadTask(item.id)
              }} /></Tooltip>}
            {(item.status === 'downloading' || item.status === 'pending') && <Tooltip title='取消下载'><Button icon={<CloseOutlined />} type='text'
              onClick={() => {
                downloadManager.cancelTask(item.id)
              }} /></Tooltip>}
            {item.status === 'done' && <Tooltip title='打开文件夹'><Button icon={<FolderOutlined />} type='text'
              onClick={() => {
                downloadManager.openTask(item.id, true).catch((err) => {
                  notification.error({
                    message: '打开文件夹失败',
                    description: String(err)
                  })
                })
              }} /></Tooltip>}
          </List.Item>
        )}
      />
    </Drawer>
  );
}
