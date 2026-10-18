import { useDesktopApp } from '../../context/NotificationContext';
import IconAction from '../IconAction';
import SettingsSwitch from './SettingsSwitch';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import Workspace from '../Workspace';
import { useState, useEffect } from 'react';
import { List, Typography, Input, InputNumber, Select, Tooltip } from 'antd';
import ActionButton from '../ActionButton';
import { EditOutlined, SendOutlined, SettingOutlined, LoadingOutlined } from '@ant-design/icons';
import { invoke, dialog } from '../../bridge';

import { useConfig } from '../../context/ConfigContext';
import LlmSettingsModal from './LlmSettingsModal';
import SubtitleSettingsModal from './SubtitleSettingsModal';
import { VersionInfo } from '../../model';
import { useConfigAutosave } from '../../hooks/useConfigAutosave';
import { normalizeFileExtensions } from '../../utils';

const { Text } = Typography;

interface SettingsProps {
  currentVersion: string;
  latestVersionData: VersionInfo | null;
  setOpenVersionModal: (open: boolean) => void;
}

export default function Settings({
  currentVersion,
  latestVersionData,
  setOpenVersionModal
}: SettingsProps) {
  const { config, updateConfigField, isSaving } = useConfig();
  const savingSettings = useDelayedBusy(isSaving());
  const { notification } = useDesktopApp();
  const [dingUrlInput, setDingUrlInput] = useState('');
  const [subtitleModalOpen, setSubtitleModalOpen] = useState(false);
  const [llmModalOpen, setLlmModalOpen] = useState(false);

  const [testingDing, setTestingDing] = useState(false);
  const [dingError, setDingError] = useState('');
  const validateDing = (value: string) => {
    if (!value.trim()) return '';
    try { if (/^https?:$/.test(new URL(value.trim()).protocol)) return ''; } catch { /* Invalid URLs are reported inline below. */ }
    return '请输入完整的 http 或 https Webhook 地址';
  };
  const dingSave = useConfigAutosave(async () => {
    const error = validateDing(dingUrlInput);
    setDingError(error);
    return !error;
  });
  const [section, setSection] = useState('downloads');
  const sections = [
    { key: 'downloads', label: '下载与同步' },
    { key: 'classroom', label: '智云课堂处理' },
    { key: 'notifications', label: '通知' },
    { key: 'app', label: '应用与版本' },
  ];
  useEffect(() => { if (!dingSave.hasDraft('ding_url')) setDingUrlInput(config.ding_url || ''); }, [config.ding_url, dingSave]);

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
        title: '下载路径修改失败',
        description: String(err)
      })
    })
  }

  const handleTestDing = () => {
    if (testingDing || !dingUrlInput.trim()) return;
    const error = validateDing(dingUrlInput);
    if (error) { setDingError(error); return; }
    setTestingDing(true);
    invoke('notify_score', {
      score: { xkkh: '测试课程', kcmc: '测试课程', cj: '100', jd: '5.0', xf: '3.0' },
      oldTotalGp: 5,
      oldTotalCredit: 37,
      totalGp: 5,
      totalCredit: 40,
      dingUrl: dingUrlInput
    }).then(() => notification.success({ title: '测试消息已发送' })).catch((err) => {
      notification.error({
        title: '发送通知失败',
        description: String(err)
      })
    }).finally(() => setTestingDing(false))
  }

  const handleLlmSwitchChange = (checked: boolean) => {
    if (checked && (!config.llm_api_base?.trim() || !config.llm_api_key?.trim() || !config.llm_model?.trim())) {
      notification.warning({
        key: 'llm-config-required',
        title: '请先完成 AI 总结配置',
        description: '填写 API 地址、API Key 和模型名称后即可开启。',
        actions: <ActionButton onClick={() => { notification.destroy('llm-config-required'); setLlmModalOpen(true); }}>去配置</ActionButton>,
      });
      return;
    }
    updateConfigField('llm_enabled', checked);
  };

  const handleLlmModalCancel = () => setLlmModalOpen(false);

  return (
    <>
      <Workspace title={sections.find(item => item.key === section)!.label} panel={<>
        <div className="panel-heading"><h2>设置</h2></div>
        <nav className="context-navigation" aria-label="设置分类">{sections.map(item => <button key={item.key}
          className={`settings-category ${section === item.key ? 'active' : ''}`} aria-current={section === item.key ? 'page' : undefined}
          onClick={() => setSection(item.key)}>{item.label}{item.key === 'app' && !!latestVersionData && latestVersionData.version !== currentVersion && <Tooltip title="有新版本"><span className="settings-update-dot" role="img" aria-label="有新版本" /></Tooltip>}</button>)}</nav>
        <div className="panel-bottom">设置修改后自动保存</div>
      </>}>
        <div className="settings-content">
          {section === 'downloads' && <List itemLayout='horizontal'><List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>下载/同步位置</Text>}
              description={<div>
                <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>{config.save_path}</Text>
              </div>}
            />
            <IconAction disabled={savingSettings} label="修改下载/同步位置" onClick={updatePath}><EditOutlined /></IconAction>
          </List.Item>
            <List.Item>
              <List.Item.Meta
                title={<Text style={{ fontWeight: 'normal' }}>课件更新时自动下载</Text>}
                description={<div>
                  <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>开启学在浙大课件自动同步后，若开启该选项，则检测到新课件时会自动下载。否则仅会加入课件列表。</Text>
                </div>}
              />
              <SettingsSwitch field="auto_download" checked={config.auto_download} onChange={(checked) => updateConfigField('auto_download', checked)} />
            </List.Item>
            <List.Item className="settings-field-row">
              <List.Item.Meta
                title={<Text style={{ fontWeight: 'normal' }}>批量下载排除文件类型</Text>}
                description={<div>
                  <Text type="secondary" style={{ display: 'block', fontWeight: 'normal', fontSize: 12 }}>匹配的文件不会被默认选中，也不会自动下载；仍可在课件列表中手动勾选。</Text>

                </div>}
              />
              <Select disabled={savingSettings}
                mode="tags"
                value={config.excluded_upload_extensions}
                placeholder="不排除"
                tokenSeparators={[',', '，', ' ']}
                maxTagCount="responsive"
                className="settings-extension-control"
                aria-label="批量下载排除文件类型"
                options={['mp4', 'mp3', 'mov', 'm4a', 'wav'].map((extension) => ({
                  label: extension,
                  value: extension
                }))}
                onChange={(extensions) => updateConfigField(
                  'excluded_upload_extensions',
                  normalizeFileExtensions(extensions)
                )}
              />
            </List.Item>
            <List.Item>
              <List.Item.Meta
                title={<Text style={{ fontWeight: 'normal' }}>下载开始时切换到下载页面</Text>}
                description={<div>
                  <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>开启后，添加下载任务时自动进入下载页面</Text>
                </div>}
              />
              <SettingsSwitch field="auto_open_download_list" checked={config.auto_open_download_list} onChange={(checked) => updateConfigField('auto_open_download_list', checked)} />
            </List.Item>
            <List.Item>
              <List.Item.Meta
                title={<Text style={{ fontWeight: 'normal' }}>最大并行下载任务数</Text>}
                description={<div>
                  <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>同时进行下载的最大任务数量</Text>
                </div>}
              />
              <InputNumber disabled={savingSettings} min={1} precision={0} step={1} value={config.max_concurrent_tasks} changeOnWheel
                onChange={(value) => {
                  if (!value || value < 1) value = 1;
                  // InputNumber can emit a fractional draft before applying precision on blur.
                  if (!Number.isInteger(value)) return;
                  updateConfigField('max_concurrent_tasks', value);
                }}
              />
            </List.Item></List>}
          {section === 'classroom' && <List itemLayout='horizontal'><List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>自动导出为 PDF</Text>}
              description={<div>
                <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>开启后，从智云课堂下载的课件将自动导出为 PDF</Text>
              </div>}
            />
            <SettingsSwitch field="to_pdf" checked={config.to_pdf} onChange={(checked) => updateConfigField('to_pdf', checked)} />
          </List.Item>
            <List.Item>
              <List.Item.Meta
                title={<Text style={{ fontWeight: 'normal' }}>下载语音识别文本</Text>}
                description={
                  <div>
                    <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>
                      下载智云课堂课件时，同时下载语音识别文本。
                    </Text>

                  </div>
                }
              />
              <div className="settings-control-group">
                <IconAction disabled={savingSettings} label="字幕高级设置" onClick={() => setSubtitleModalOpen(true)}><SettingOutlined /></IconAction>
                <SettingsSwitch field="download_subtitle"
                  checked={config.download_subtitle}
                  onChange={(checked) => updateConfigField('download_subtitle', checked)}
                />
              </div>
            </List.Item>
            <List.Item>
              <List.Item.Meta
                title={<Text style={{ fontWeight: 'normal' }}>AI 课程总结</Text>}
                description={
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>调用大模型自动生成课程纪要</Text>

                  </div>
                }
              />
              <div className="settings-control-group">
                <IconAction disabled={savingSettings} label="AI 总结配置" onClick={() => setLlmModalOpen(true)}><SettingOutlined /></IconAction>
                <SettingsSwitch field="llm_enabled"
                  checked={config.llm_enabled}
                  onChange={handleLlmSwitchChange}
                />
              </div>
            </List.Item></List>}
          {section === 'notifications' && <List itemLayout='horizontal'><List.Item className="settings-field-row settings-webhook-row">
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>钉钉机器人 Webhook</Text>}
              description="检测到成绩更新后，通过钉钉机器人 Webhook 发送通知。留空则不启用钉钉通知。"
            />
            <div className="settings-webhook-control"><div className="settings-webhook-input-row">
              <Input disabled={testingDing || savingSettings} status={dingError ? 'error' : undefined} aria-describedby={dingError || dingSave.failed ? "ding-save-status" : undefined} aria-label="钉钉机器人 Webhook" placeholder="输入完整的 Webhook 地址" value={dingUrlInput} onBlur={() => dingSave.save()} onChange={(e) => { setDingUrlInput(e.target.value); setDingError(''); dingSave.change({ ding_url: e.target.value }); }} />
              <div className="settings-webhook-actions">
                <IconAction label={testingDing ? "正在发送" : "发送测试消息"} disabled={testingDing || savingSettings || !dingUrlInput.trim() || !!validateDing(dingUrlInput)} aria-busy={testingDing} onClick={handleTestDing}>{testingDing ? <LoadingOutlined spin /> : <SendOutlined />}</IconAction>

              </div></div>
              {(dingError || dingSave.failed) && <div id="ding-save-status" className="autosave-status" role="status">{dingError || dingSave.status}
                {dingSave.failed && <ActionButton onClick={() => dingSave.save()}>重试</ActionButton>}
              </div>}
            </div>
          </List.Item></List>}
          {section === 'app' && <List itemLayout='horizontal'><List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>关闭应用后保持后台运行</Text>}
              description={<div>
                <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>若开启，关闭应用窗口后应用会保持后台运行，并保留托盘图标。</Text>
              </div>}
            />
            <SettingsSwitch field="tray" checked={config.tray} onChange={(checked) => updateConfigField('tray', checked)} />
          </List.Item>
            <List.Item>
              <List.Item.Meta
                title={<Text style={{ fontWeight: 'normal' }}>开机自启</Text>}
                description={<div>
                  <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>若开启，应用会在开机时自动启动。</Text>
                </div>}
              />
              <SettingsSwitch field="auto_start" checked={config.auto_start} onChange={(checked) => updateConfigField('auto_start', checked)} />
            </List.Item>
            <List.Item>
              <List.Item.Meta
                title={<Text style={{ fontWeight: 'normal' }}>应用版本</Text>}
              />
              <ActionButton className="version-details" aria-label="查看版本更新详情" onClick={() => setOpenVersionModal(true)}>
                <span>{currentVersion}</span>
                {!!latestVersionData && latestVersionData.version !== currentVersion && <><span className="version-arrow" aria-hidden="true">→</span><span className="version-latest">{latestVersionData.version}</span></>}
              </ActionButton>
            </List.Item></List>}

          {section === 'app' && <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', marginTop: 20 }}>
            <Text type='secondary' style={{ fontSize: 12 }}>Made by PeiPei</Text>
            <Text type='secondary' style={{ fontSize: 12 }}>此软件仅供学习交流使用，严禁用于商业用途</Text>
          </div>}
        </div>
      </Workspace>

      <SubtitleSettingsModal open={subtitleModalOpen} onCancel={() => setSubtitleModalOpen(false)} />

      <LlmSettingsModal
        open={llmModalOpen}
        onCancel={handleLlmModalCancel}
      />
    </>
  )
}
