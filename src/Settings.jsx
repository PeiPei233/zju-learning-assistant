import { useState, useEffect } from 'react';
import { App, Drawer, List, Typography, Button, Badge, Switch, Input, Space, InputNumber, Radio, Tooltip, Modal, Checkbox } from 'antd';
import { EditOutlined, CheckOutlined, SendOutlined, ArrowLeftOutlined, SettingOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import * as dialog from "@tauri-apps/plugin-dialog";

const { Text } = Typography;

export default function Settings({ 
  open, 
  onClose, 
  config, 
  updateConfigField, 
  currentVersion, 
  latestVersionData, 
  setOpenVersionModal 
}) {
  const { notification } = App.useApp();
  const [dingUrlInput, setDingUrlInput] = useState('');
  const [subtitleModalOpen, setSubtitleModalOpen] = useState(false);
  const subtitleLanguages = Array.isArray(config.subtitle_language) ? config.subtitle_language : ['zh'];

  // 当 Drawer 打开或配置更新时，同步钉钉 URL 到输入框
  useEffect(() => {
    if (open && config) {
      setDingUrlInput(config.ding_url || '');
    }
  }, [open, config]);

  const updatePath = () => {
    dialog.open({
      directory: true,
      multiple: false,
      title: '选择下载路径' // 修正：plugin-dialog v2 使用 title 而不是 message
    }).then((res) => {
      if (res) {
        // v2 plugin 可能返回 string 或 null (单选模式)
        updateConfigField('save_path', res);
      }
    }).catch((err) => {
      notification.error({
        message: '下载路径修改失败',
        description: err.toString()
      })
    })
  }

  const handleTestDing = () => {
    invoke('notify_score', {
      score: { xkkh: '测试课程', kcmc: '测试课程', cj: '100', jd: '5.0', xf: '3.0' },
      oldTotalGp: 5,
      oldTotalCredit: 37,
      totalGp: 5,
      totalCredit: 40,
      dingUrl: dingUrlInput
    }).catch((err) => {
      notification.error({
        message: '发送通知失败',
        description: err.toString()
      })
    })
  }

  const handleSaveDingUrl = () => {
    updateConfigField('ding_url', dingUrlInput);
    notification.success({ message: '钉钉 Webhook 已保存' });
  }

  return (
    <>
      <Drawer
        open={open}
        closeIcon={<ArrowLeftOutlined />}
        onClose={onClose}
        title='设置'
      >
        <List itemLayout='horizontal'>
          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>下载/同步位置</Text>}
              description={<div>
                <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>{config.save_path}</Text>
              </div>}
            />
            <Tooltip title='修改下载/同步位置'>
              <Button type='text' icon={<EditOutlined />} onClick={updatePath} />
            </Tooltip>
          </List.Item>

          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>自动导出为 PDF</Text>}
              description={<div>
                <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>开启后，从智云课堂下载的课件将自动导出为 PDF</Text>
              </div>}
            />
            <Switch checked={config.to_pdf} onChange={(checked) => updateConfigField('to_pdf', checked)} />
          </List.Item>

          <List.Item>
              <List.Item.Meta
                title={<Text style={{ fontWeight: 'normal' }}>自动下载字幕</Text>}
                description={
                  <div>
                    <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>
                      下载智云课堂课件时，自动下载语音识别文本。
                    </Text>
                    {config.auto_download_subtitle && (
                      <div style={{ marginTop: 5 }}>
                        <a onClick={() => setSubtitleModalOpen(true)} style={{ fontSize: 12 }}>
                          <SettingOutlined style={{ marginRight: 4 }} />
                          高级选项
                        </a>
                      </div>
                    )}
                  </div>
                }
              />
              <Switch
                checked={config.auto_download_subtitle}
                onChange={(checked) => updateConfigField('auto_download_subtitle', checked)}
              />
          </List.Item>

          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>课件更新时自动下载</Text>}
              description={<div>
                <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>开启学在浙大课件自动同步后，若开启该选项，则检测到新课件时会自动下载。否则仅会加入课件列表。</Text>
              </div>}
            />
            <Switch checked={config.auto_download} onChange={(checked) => updateConfigField('auto_download', checked)} />
          </List.Item>

          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>钉钉机器人 Webhook</Text>}
              description={
                <div>
                  <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>检测到成绩更新后，将使用以下钉钉机器人 Webhook 发送通知。若留空，则不使用钉钉机器人发送通知。</Text>
                  <Space.Compact style={{ marginTop: 10, width: '100%' }}>
                    <Input placeholder='输入完整的钉钉机器人 Webhook' value={dingUrlInput} onChange={(e) => setDingUrlInput(e.target.value)} />
                    <Button icon={<Tooltip title='发送测试消息'><SendOutlined /></Tooltip>} onClick={handleTestDing} />
                    <Button icon={<Tooltip title='保存'><CheckOutlined /></Tooltip>} onClick={handleSaveDingUrl} />
                  </Space.Compact>
                </div>
              }
            />
          </List.Item>

          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>下载开始时显示下载列表</Text>}
              description={<div>
                <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>关闭此设置会使人更难知道文件何时开始下载</Text>
              </div>}
            />
            <Switch checked={config.auto_open_download_list} onChange={(checked) => updateConfigField('auto_open_download_list', checked)} />
          </List.Item>

          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>最大并行下载任务数</Text>}
              description={<div>
                <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>同时进行下载的最大任务数量</Text>
              </div>}
            />
            <InputNumber min={1} value={config.max_concurrent_tasks} changeOnWheel
              onChange={(value) => {
                if (!value || value < 1) value = 1;
                updateConfigField('max_concurrent_tasks', value);
                // 注意：这里我们只更新 config，DownloadManager 的同步需要在父组件处理，或者通过监听 config 变化处理
              }}
            />
          </List.Item>

          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>关闭应用后保持后台运行</Text>}
              description={<div>
                <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>若开启，关闭应用窗口后应用会保持后台运行，并保留托盘图标。</Text>
              </div>}
            />
            <Switch checked={config.tray} onChange={(checked) => updateConfigField('tray', checked)} />
          </List.Item>

          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>开机自启</Text>}
              description={<div>
                <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>若开启，应用会在开机时自动启动。</Text>
              </div>}
            />
            <Switch checked={config.auto_start} onChange={(checked) => updateConfigField('auto_start', checked)} />
          </List.Item>

          <a onClick={() => setOpenVersionModal(true)}>
            <List.Item>
              <List.Item.Meta
                title={<Badge count={(!latestVersionData || (latestVersionData && latestVersionData.tag_name === currentVersion) ? 0 : 'New')} size='small'>
                  <Text style={{ fontWeight: 'normal' }}>应用版本</Text>
                </Badge>}
              />
              <Text>{currentVersion}</Text>
            </List.Item>
          </a>
        </List>
        
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', marginTop: 20 }}>
          <Text type='secondary' style={{ fontSize: 12 }}>Made by PeiPei</Text>
          <Text type='secondary' style={{ fontSize: 12 }}>此软件仅供学习交流使用，严禁用于商业用途</Text>
        </div>
      </Drawer>

      <Modal
        title="字幕下载高级选项"
        open={subtitleModalOpen}
        onOk={() => setSubtitleModalOpen(false)}
        onCancel={() => setSubtitleModalOpen(false)}
        footer={[
          <Button key="ok" type="primary" onClick={() => setSubtitleModalOpen(false)}>
            确定
          </Button>,
        ]}
      >
        <List>
          <List.Item>
            <List.Item.Meta 
              title="文件格式" 
              description="选择保存的字幕文件格式"
            />
            <Radio.Group 
              value={config.subtitle_format || 'srt'} 
              onChange={(e) => updateConfigField('subtitle_format', e.target.value)}
              buttonStyle="solid"
            >
              <Radio.Button value="srt">SRT</Radio.Button>
              <Radio.Button value="md">Markdown</Radio.Button>
              <Radio.Button value="txt">TXT</Radio.Button>
            </Radio.Group>
          </List.Item>

          <List.Item>
            <List.Item.Meta 
              title="语言" 
              description="选择下载的语音文本语言"
            />
            <Checkbox.Group 
              options={[
                { label: '中文', value: 'zh' },
                { label: 'English', value: 'en' },
                { label: '中英穿插', value: 'mixed' },
              ]}
              value={subtitleLanguages}
              onChange={(checkedValues) => updateConfigField('subtitle_language', checkedValues)}
            />
          </List.Item>

          <List.Item>
            <List.Item.Meta 
              title="包含时间戳" 
              description={config.subtitle_format === 'srt' ? "SRT 格式必须包含时间戳" : "在文本/Markdown中保留时间信息"}
            />
            <Switch 
              checked={config.subtitle_format === 'srt' ? true : config.subtitle_with_timestamps} 
              disabled={config.subtitle_format === 'srt'}
              onChange={(checked) => updateConfigField('subtitle_with_timestamps', checked)}
            />
          </List.Item>
        </List>
      </Modal>
    </>
  )
}