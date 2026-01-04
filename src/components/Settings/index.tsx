import React, { useState, useEffect } from 'react';
import { App, Drawer, List, Typography, Button, Badge, Switch, Input, Space, InputNumber, Tooltip } from 'antd';
import { EditOutlined, CheckOutlined, SendOutlined, ArrowLeftOutlined, SettingOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import * as dialog from "@tauri-apps/plugin-dialog";
import { useConfig } from '../../context/ConfigContext';
import LlmSettingsModal from './LlmSettingsModal';
import SubtitleSettingsModal from './SubtitleSettingsModal';
import { Config } from '../../model';

const { Text } = Typography;

interface SettingsProps {
  open: boolean;
  onClose: () => void;
  currentVersion: string;
  latestVersionData: any;
  setOpenVersionModal: (open: boolean) => void;
}

export default function Settings({
  open,
  onClose,
  currentVersion,
  latestVersionData,
  setOpenVersionModal
}: SettingsProps) {
  const { config, updateConfigField, updateConfigBatch } = useConfig();
  const { notification } = App.useApp();
  const [dingUrlInput, setDingUrlInput] = useState('');
  const [subtitleModalOpen, setSubtitleModalOpen] = useState(false);
  const [llmModalOpen, setLlmModalOpen] = useState(false);
  const [isEnablingLlm, setIsEnablingLlm] = useState(false);

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
      title: '选择下载路径'
    }).then((res) => {
      if (res) {
        updateConfigField('save_path', res);
      }
    }).catch((err) => {
      notification.error({
        message: '下载路径修改失败',
        description: String(err)
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
        description: String(err)
      })
    })
  }

  const handleSaveDingUrl = () => {
    updateConfigField('ding_url', dingUrlInput);
    notification.success({ message: '钉钉 Webhook 已保存' });
  }

  const handleLlmSwitchChange = (checked: boolean) => {
    if (checked) {
      setIsEnablingLlm(true);
      setLlmModalOpen(true);
    } else {
      updateConfigField('llm_enabled', false);
    }
  };

  const handleLlmModalOk = (values: Partial<Config>) => {
    const newEnabledState = isEnablingLlm ? true : config.llm_enabled;

    updateConfigBatch({
      ...values,
      llm_enabled: newEnabledState
    });

    setIsEnablingLlm(false);
    setLlmModalOpen(false);
    notification.success({ message: isEnablingLlm ? "AI 总结功能已启用" : "配置已保存" });
  };

  const handleLlmModalCancel = () => {
    setLlmModalOpen(false);
    if (isEnablingLlm) {
      updateConfigField('llm_enabled', false);
      setIsEnablingLlm(false);
    }
  };

  return (
    <>
      <Drawer
        open={open}
        closeIcon={<ArrowLeftOutlined />}
        onClose={onClose}
        title='设置'
        resizable={true}
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
              title={<Text style={{ fontWeight: 'normal' }}>下载语音识别文本</Text>}
              description={
                <div>
                  <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>
                    下载智云课堂课件时，同时下载语音识别文本。
                  </Text>
                  {config.download_subtitle && (
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
              checked={config.download_subtitle}
              onChange={(checked) => updateConfigField('download_subtitle', checked)}
            />
          </List.Item>

          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>AI 课程总结</Text>}
              description={
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>调用大模型自动生成课程纪要</Text>
                  {config.llm_enabled && (
                    <div style={{ marginTop: 5 }}>
                      <a onClick={() => setLlmModalOpen(true)} style={{ fontSize: 12 }}>
                        <SettingOutlined style={{ marginRight: 4 }} />
                        模型参数配置
                      </a>
                    </div>
                  )}
                </div>
              }
            />
            <Switch
              checked={config.llm_enabled}
              onChange={handleLlmSwitchChange}
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

      <SubtitleSettingsModal open={subtitleModalOpen} onCancel={() => setSubtitleModalOpen(false)} />

      <LlmSettingsModal
        open={llmModalOpen}
        onCancel={handleLlmModalCancel}
        onOk={handleLlmModalOk}
        isEnabling={isEnablingLlm}
      />
    </>
  )
}