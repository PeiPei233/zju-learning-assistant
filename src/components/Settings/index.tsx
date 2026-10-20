import { useDesktopApp } from '../../context/NotificationContext';
import IconAction from '../IconAction';
import SettingsSwitch from './SettingsSwitch';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import Workspace from '../Workspace';
import { useState, useEffect } from 'react';
import { Card, Input, InputNumber, Select, Tooltip } from 'antd';
import ActionButton from '../ActionButton';
import { EditOutlined, SendOutlined, LoadingOutlined } from '@ant-design/icons';
import { invoke, dialog } from '../../bridge';

import { useConfig } from '../../context/ConfigContext';
import LlmSettingsModal from './LlmSettingsModal';
import SubtitleSettingsModal from './SubtitleSettingsModal';
import { VersionInfo } from '../../model';
import { useConfigAutosave } from '../../hooks/useConfigAutosave';
import { normalizeFileExtensions } from '../../utils';

import SettingField from './SettingField';
import type { ReactNode } from 'react';

function SettingsGroup({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="settings-group"><h2>{title}</h2>{description && <p className="settings-group-description">{description}</p>}<Card className="settings-card">{children}</Card></section>;
}

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
        actions: <ActionButton onClick={() => { notification.destroy('llm-config-required'); setSection('classroom'); requestAnimationFrame(() => document.getElementById('llm_api_base')?.focus()); }}>去配置</ActionButton>,
      });
      return;
    }
    updateConfigField('llm_enabled', checked);
  };

  return <Workspace title={sections.find(item => item.key === section)!.label} panel={<>
    <div className="panel-heading"><h2>设置</h2></div>
    <nav className="context-navigation" aria-label="设置分类">{sections.map(item => <button key={item.key}
      className={`settings-category ${section === item.key ? 'active' : ''}`} aria-current={section === item.key ? 'page' : undefined}
      onClick={() => setSection(item.key)}>{item.label}{item.key === 'app' && !!latestVersionData && latestVersionData.version !== currentVersion && <Tooltip title="有新版本"><span className="settings-update-dot" role="img" aria-label="有新版本" /></Tooltip>}</button>)}</nav>
    <div className="panel-bottom">设置修改后自动保存</div>
  </>}>
    <div className="settings-content settings-grouped">
      <div hidden={section !== 'downloads'}>
        <SettingsGroup title="下载">
          <SettingField label="保存位置" description={config.save_path}><IconAction disabled={savingSettings} label="修改下载/同步位置" onClick={updatePath}><EditOutlined /></IconAction></SettingField>
          <SettingField label="最大并行下载任务数" description="同时进行下载的最大任务数量。"><InputNumber aria-label="最大并行下载任务数" disabled={savingSettings} min={1} precision={0} step={1} value={config.max_concurrent_tasks} onChange={value => { const next = value || 1; if (Number.isInteger(next) && next >= 1) void updateConfigField('max_concurrent_tasks', next); }} /></SettingField>
          <SettingField label="添加任务后切换到下载页面" description="手动添加下载任务后跳转，后台自动下载不会打断当前页面。"><SettingsSwitch field="auto_open_download_list" aria-label="添加任务后切换到下载页面" checked={config.auto_open_download_list} onChange={value => updateConfigField('auto_open_download_list', value)} /></SettingField>
        </SettingsGroup>
        <SettingsGroup title="课件选择">
          <SettingField label="刷新课件后自动全选" description="适用于学在浙大和智云课堂。关闭后仅保留仍有效的已有选择。"><SettingsSwitch field="auto_select_all_courseware" aria-label="刷新课件后自动全选" checked={config.auto_select_all_courseware} onChange={value => updateConfigField('auto_select_all_courseware', value)} /></SettingField>
          <SettingField label="全选时排除文件类型" description="仅适用于学在浙大的自动全选和后台自动下载，仍可手动选择。"><Select className="settings-extension-control" aria-label="全选时排除文件类型" disabled={savingSettings} mode="tags" value={config.excluded_upload_extensions} placeholder="不排除" tokenSeparators={[',', '，', ' ']} maxTagCount="responsive" options={['mp4', 'mp3', 'mov', 'm4a', 'wav'].map(value => ({value, label:value}))} onChange={values => updateConfigField('excluded_upload_extensions', normalizeFileExtensions(values))} /></SettingField>
        </SettingsGroup>
        <SettingsGroup title="课件同步">
          <SettingField label="自动下载新课件" description="仅适用于学在浙大。开启页面内的自动同步后，新课件按排除规则自动下载；关闭则留在待下载列表。"><SettingsSwitch aria-label="自动下载新课件" field="auto_download" checked={config.auto_download} onChange={value => updateConfigField('auto_download', value)} /></SettingField>
        </SettingsGroup>
      </div>
      <div hidden={section !== 'classroom'}>
        <SettingsGroup title="课件导出"><SettingField label="自动导出为 PDF" description="将下载的课件图片合并为 PDF 文件。"><SettingsSwitch aria-label="自动导出为 PDF" field="to_pdf" checked={config.to_pdf} onChange={value => updateConfigField('to_pdf', value)} /></SettingField></SettingsGroup>
        <SettingsGroup title="语音识别文本">
          <SettingField label="下载语音识别文本" description="下载课件时，同时保存课程字幕。"><SettingsSwitch aria-label="下载语音识别文本" field="download_subtitle" checked={config.download_subtitle} onChange={value => updateConfigField('download_subtitle', value)} /></SettingField>
          <SubtitleSettingsModal inline open onCancel={() => {}} />
        </SettingsGroup>
        <SettingsGroup title="AI 课程总结">
          <SettingField label="生成课程总结" description="使用课程字幕生成总结，支持 OpenAI 兼容接口。"><SettingsSwitch aria-label="生成课程总结" field="llm_enabled" checked={config.llm_enabled} onChange={handleLlmSwitchChange} /></SettingField>
          <LlmSettingsModal inline open onCancel={() => {}} />
        </SettingsGroup>
      </div>
      <div hidden={section !== 'notifications'}><SettingsGroup title="钉钉通知">
        <SettingField className="settings-webhook-field" label="机器人 Webhook" htmlFor="ding-webhook" description="检测到成绩更新后发送通知，留空则不启用。">
          <div className="settings-webhook-input-row"><Input id="ding-webhook" disabled={testingDing || savingSettings} status={dingError ? 'error' : undefined} aria-describedby={dingError || dingSave.failed ? 'ding-save-status' : undefined} aria-label="钉钉机器人 Webhook" placeholder="输入完整的 Webhook 地址" value={dingUrlInput} onBlur={() => dingSave.save()} onChange={event => {setDingUrlInput(event.target.value); setDingError(''); dingSave.change({ding_url:event.target.value});}} />
          <IconAction label={testingDing ? '正在发送' : '发送测试消息'} disabled={testingDing || savingSettings || !dingUrlInput.trim() || !!validateDing(dingUrlInput)} aria-busy={testingDing} onClick={handleTestDing}>{testingDing ? <LoadingOutlined spin /> : <SendOutlined />}</IconAction></div>
          {(dingError || dingSave.failed) && <div id="ding-save-status" className="autosave-status" role="status">{dingError || dingSave.status}{dingSave.failed && <ActionButton onClick={() => dingSave.save()}>重试</ActionButton>}</div>}
        </SettingField>
      </SettingsGroup></div>
      <div hidden={section !== 'app'}>
        <SettingsGroup title="运行方式">
          <SettingField label="关闭应用后保持后台运行" description="关闭窗口后继续运行，并保留托盘图标。"><SettingsSwitch aria-label="关闭应用后保持后台运行" field="tray" checked={config.tray} onChange={value => updateConfigField('tray', value)} /></SettingField>
          <SettingField label="开机自启" description="登录系统时自动启动应用。"><SettingsSwitch aria-label="开机自启" field="auto_start" checked={config.auto_start} onChange={value => updateConfigField('auto_start', value)} /></SettingField>
        </SettingsGroup>
        <SettingsGroup title="关于">
          <SettingField label="应用版本"><ActionButton className="version-details" aria-label="查看版本更新详情" onClick={() => setOpenVersionModal(true)}><span>{currentVersion}</span>{!!latestVersionData && latestVersionData.version !== currentVersion && <><span className="version-arrow" aria-hidden="true">→</span><span className="version-latest">{latestVersionData.version}</span></>}</ActionButton></SettingField>
        </SettingsGroup>
        <div className="settings-about">Made by PeiPei<p>此软件仅供学习交流使用，严禁用于商业用途</p></div>
      </div>
    </div>
  </Workspace>;
}
