import PanelHeading from '../../components/PanelHeading';
import { useDesktopApp } from '../../context/NotificationContext';
import IconAction from '../../components/IconAction';
import EmptyState from '../../components/EmptyState';
import FetchState from '../../components/FetchState';
import SettingSwitch from './SettingSwitch';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import Workspace from '../../components/Workspace';
import { useState, useEffect } from 'react';
import { Card, Input, InputNumber, Select, Segmented, Tooltip } from 'antd';
import ActionButton from '../../components/ActionButton';
import { EditOutlined, SendOutlined, LoadingOutlined } from '@ant-design/icons';
import { invoke, dialog } from '../../bridge';

import { useConfig } from '../../context/ConfigContext';
import LlmSetting from './LlmSetting';
import SubtitleSetting from './SubtitleSetting';
import { VersionInfo } from '../../model';
import { useConfigAutosave } from '../../hooks/useConfigAutosave';
import dayjs from 'dayjs';
import { todoReminderMessage, reminderLabel, reminderOptions } from '../../reminders';
import { normalizeFileExtensions } from '../../utils';

import SettingField from './SettingField';
import CalDavSetting from './CalDavSetting';
import type { ReactNode } from 'react';

function SettingGroup({ id, title, description, children }: { id?: string; title: string; description?: string; children: ReactNode }) {
  return <section id={id} className="settings-group"><h2>{title}</h2>{description && <p className="settings-group-description">{description}</p>}<Card className="settings-card">{children}</Card></section>;
}

interface SettingProps {
  active: boolean;
  onOpen: () => void;
  caldavRequest?: number;
  currentVersion: string;
  latestVersionData: VersionInfo | null;
  setOpenVersionModal: (open: boolean) => void;
}

export default function Setting({
  active,
  onOpen,
  caldavRequest = 0,
  currentVersion,
  latestVersionData,
  setOpenVersionModal
}: SettingProps) {
  const { config, updateConfigField, isSaving, ready, loadError, loadingConfig, refreshConfig } = useConfig();
  const savingSettings = useDelayedBusy(isSaving());
  const { notification } = useDesktopApp();
  const [dingUrlInput, setDingUrlInput] = useState('');
  const [dingSecretInput, setDingSecretInput] = useState('');
  const secretSave = useConfigAutosave(async () => true);

  const [testingDingKind, setTestingDingKind] = useState<'score' | 'todo' | null>(null);
  const testingDing = testingDingKind !== null;
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
  useEffect(() => {
    if (caldavRequest) {
      setSection('downloads');
      requestAnimationFrame(() => document.getElementById('caldav-settings')?.scrollIntoView({ block: 'start' }));
    }
  }, [caldavRequest]);
  const sections = [
    { key: 'downloads', label: '下载与同步' },
    { key: 'classroom', label: '智云课堂处理' },
    { key: 'notifications', label: '通知' },
    { key: 'app', label: '应用与版本' },
  ];
  useEffect(() => { if (!dingSave.hasDraft('ding_url')) setDingUrlInput(config.ding_url || ''); }, [config.ding_url, dingSave]);
  useEffect(() => { if (!secretSave.hasDraft('ding_secret')) setDingSecretInput(config.ding_secret || ''); }, [config.ding_secret, secretSave]);

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

  const showDingConfigRequired = () => {
    notification.warning({
      key: 'ding-config-required',
      title: '请先配置钉钉机器人',
      description: '填写机器人 Webhook 后即可开启或发送测试通知。',
      actions: <ActionButton onClick={() => { notification.destroy('ding-config-required'); onOpen(); setSection('notifications'); requestAnimationFrame(() => document.getElementById('ding-webhook')?.focus()); }}>去配置</ActionButton>,
    });
  };

  const handleTestDing = async (kind: 'score' | 'todo') => {
    if (testingDing) return;
    if (!dingUrlInput.trim() || validateDing(dingUrlInput)) {
      showDingConfigRequired();
      return;
    }
    setTestingDingKind(kind);
    try {
      if (kind === 'score') {
        await invoke('notify_score', {
          score: { course_id: '测试课程', course_name: '测试课程', grade: '100', grade_point: '5.0', credits: '3.0' },
          oldTotalGp: 148, oldTotalCredit: 37, totalGp: 163, totalCredit: 40,
          dingUrl: dingUrlInput, dingSecret: dingSecretInput, systemEnabled: false,
        });
      } else {
        const message = todoReminderMessage({ course_name: '测试课程', title: '测试待办', end_time: dayjs().add(1, 'hour').format('YYYY-MM-DD HH:mm:ss') }, 60);
        await invoke('send_ding_notification', { dingUrl: dingUrlInput, dingSecret: dingSecretInput, title: message.title, text: message.text });
      }
      notification.destroy(`ding-test-error:${kind}`);
      notification.success({ title: `${kind === 'score' ? '成绩' : '待办'}测试通知已发送` });
    } catch (err) {
      notification.error({ key: `ding-test-error:${kind}`, title: '发送通知失败', description: String(err) });
    } finally { setTestingDingKind(null); }
  };

  const handleDingSwitchChange = (field: 'score_ding_notification' | 'todo_ding_notification', checked: boolean) => {
    if (checked && (!config.ding_url?.trim() || validateDing(config.ding_url))) {
      showDingConfigRequired();
      return;
    }
    updateConfigField(field, checked);
  };

  const handleLlmSwitchChange = (checked: boolean) => {
    if (checked && (!config.llm_api_base?.trim() || !config.llm_api_key?.trim() || !config.llm_model?.trim())) {
      notification.warning({
        key: 'llm-config-required',
        title: '请先完成 AI 总结配置',
        description: '填写 API 地址、API Key 和模型名称后即可开启。',
        actions: <ActionButton onClick={() => { notification.destroy('llm-config-required'); onOpen(); setSection('classroom'); requestAnimationFrame(() => document.getElementById('llm_api_base')?.focus()); }}>去配置</ActionButton>,
      });
      return;
    }
    updateConfigField('llm_enabled', checked);
  };

  return <Workspace title={sections.find(item => item.key === section)!.label} panel={<>
    <PanelHeading><h2>设置</h2></PanelHeading>
    <nav className="context-navigation" aria-label="设置分类">{sections.map(item => <button key={item.key}
      className={`settings-category ${section === item.key ? 'active' : ''}`} aria-current={section === item.key ? 'page' : undefined}
      onClick={() => setSection(item.key)}>{item.label}{item.key === 'app' && !!latestVersionData && latestVersionData.version !== currentVersion && <Tooltip title="有新版本"><span className="settings-update-dot" role="img" aria-label="有新版本" /></Tooltip>}</button>)}</nav>
    <div className="panel-bottom">设置修改后自动保存</div>
  </>}>
    {!ready ? (loadingConfig ? <FetchState label="正在读取设置…" /> : <EmptyState icon={<EditOutlined />} action={<ActionButton onClick={refreshConfig}>重试读取设置</ActionButton>}>读取设置失败：{loadError}</EmptyState>) : <div className="settings-content settings-grouped">
      {loadError && <SettingGroup title="读取设置失败" description="正在使用已有设置或默认设置，原配置文件未被修改。">
        <SettingField label="重新读取设置" description={loadError}>{descriptionId => <><ActionButton disabled={loadingConfig} onClick={refreshConfig} aria-describedby={descriptionId}>{loadingConfig ? '正在读取' : '重试'}</ActionButton></>}</SettingField>
      </SettingGroup>}
      <div hidden={section !== 'downloads'}>
        <SettingGroup title="下载">
          <SettingField label="保存位置" description={config.save_path}>{descriptionId => <><IconAction disabled={savingSettings} label="修改下载/同步位置" onClick={updatePath} aria-describedby={descriptionId}><EditOutlined /></IconAction></>}</SettingField>
          <SettingField label="最大并行下载任务数"><InputNumber aria-label="最大并行下载任务数" disabled={savingSettings} min={1} precision={0} step={1} value={config.max_concurrent_tasks} onChange={value => { const next = value || 1; if (Number.isInteger(next) && next >= 1) void updateConfigField('max_concurrent_tasks', next); }} /></SettingField>
          <SettingField label="添加任务后切换到下载页面" description="手动添加下载任务后跳转，后台自动下载不会打断当前页面。">{descriptionId => <><SettingSwitch field="auto_open_download_list" aria-label="添加任务后切换到下载页面" checked={config.auto_open_download_list} onChange={value => updateConfigField('auto_open_download_list', value)} aria-describedby={descriptionId} /></>}</SettingField>
        </SettingGroup>
        <SettingGroup title="课件选择">
          <SettingField label="刷新课件后自动全选" description="适用于学在浙大和智云课堂。关闭后仅保留仍有效的已有选择。">{descriptionId => <><SettingSwitch field="auto_select_all_courseware" aria-label="刷新课件后自动全选" checked={config.auto_select_all_courseware} onChange={value => updateConfigField('auto_select_all_courseware', value)} aria-describedby={descriptionId} /></>}</SettingField>
          <SettingField label="全选时排除文件类型" description="仅适用于学在浙大的自动全选和后台自动下载，仍可手动选择。">{descriptionId => <><Select className="settings-extension-control" aria-label="全选时排除文件类型" disabled={savingSettings} mode="tags" value={config.excluded_upload_extensions} placeholder="不排除" tokenSeparators={[',', '，', ' ']} maxTagCount="responsive" options={['mp4', 'mp3', 'mov', 'm4a', 'wav'].map(value => ({ value, label: value }))} onChange={values => updateConfigField('excluded_upload_extensions', normalizeFileExtensions(values))} aria-describedby={descriptionId} /></>}</SettingField>
        </SettingGroup>
        <SettingGroup title="同步">
          <SettingField label="自动下载新课件" description="同步学在浙大课件时，自动下载新文件，跳过已排除的文件类型。">{descriptionId => <><SettingSwitch aria-label="自动下载新课件" field="auto_download" checked={config.auto_download} onChange={value => updateConfigField('auto_download', value)} aria-describedby={descriptionId} /></>}</SettingField>
          <SettingField label="自动同步成绩"><SettingSwitch aria-label="自动同步成绩" field="score_auto_sync" checked={config.score_auto_sync} onChange={value => updateConfigField('score_auto_sync', value)} /></SettingField>
          <SettingField label="自动同步待办" description="关闭自动同步不影响截止提醒。">{descriptionId => <><SettingSwitch aria-label="自动同步待办" field="todo_auto_sync" checked={config.todo_auto_sync} onChange={value => updateConfigField('todo_auto_sync', value)} aria-describedby={descriptionId} /></>}</SettingField>
        </SettingGroup>
        <SettingGroup id="caldav-settings" title="CalDAV" description="将待办导出到你使用的日历或待办应用。配置后，可在待办页或托盘菜单中导出。"><CalDavSetting active={active && section === 'downloads'} /></SettingGroup>
      </div>
      <div hidden={section !== 'classroom'}>
        <SettingGroup title="课件导出"><SettingField label="自动导出为 PDF" description="将下载的课件图片合并为 PDF 文件。">{descriptionId => <><SettingSwitch aria-label="自动导出为 PDF" field="to_pdf" checked={config.to_pdf} onChange={value => updateConfigField('to_pdf', value)} aria-describedby={descriptionId} /></>}</SettingField></SettingGroup>
        <SettingGroup title="语音识别文本">
          <SettingField label="下载语音识别文本" description="下载课件时，同时保存课程字幕。">{descriptionId => <><SettingSwitch aria-label="下载语音识别文本" field="download_subtitle" checked={config.download_subtitle} onChange={value => updateConfigField('download_subtitle', value)} aria-describedby={descriptionId} /></>}</SettingField>
          <SubtitleSetting />
        </SettingGroup>
        <SettingGroup title="AI 课程总结">
          <SettingField label="生成课程总结" description="使用课程字幕生成总结，支持 OpenAI 兼容接口。">{descriptionId => <><SettingSwitch aria-label="生成课程总结" field="llm_enabled" checked={config.llm_enabled} onChange={handleLlmSwitchChange} aria-describedby={descriptionId} /></>}</SettingField>
          <LlmSetting />
        </SettingGroup>
      </div>
      <div hidden={section !== 'notifications'}>
        <SettingGroup title="成绩更新">
          <SettingField label="系统通知"><SettingSwitch aria-label="成绩更新系统通知" field="score_system_notification" checked={config.score_system_notification} onChange={value => updateConfigField('score_system_notification', value)} /></SettingField>
          <SettingField label="钉钉通知"><div className="settings-control-group"><IconAction label={testingDingKind === 'score' ? '正在发送' : '发送成绩测试通知'} disabled={testingDing || savingSettings} aria-busy={testingDingKind === 'score'} onClick={() => void handleTestDing('score')}>{testingDingKind === 'score' ? <LoadingOutlined spin /> : <SendOutlined />}</IconAction><SettingSwitch aria-label="成绩更新钉钉通知" field="score_ding_notification" checked={config.score_ding_notification} onChange={value => handleDingSwitchChange('score_ding_notification', value)} /></div></SettingField>
        </SettingGroup>
        <SettingGroup title="待办截止提醒">
          <SettingField label="提前提醒" description="请保持应用运行以接收提醒。">{descriptionId => <><Select className="settings-extension-control" aria-label="待办提前提醒时间" mode="multiple" disabled={savingSettings} value={config.todo_reminder_minutes} placeholder="不提醒" maxTagCount="responsive" options={reminderOptions.map(value => ({ value, label: reminderLabel(value) }))} onChange={values => updateConfigField('todo_reminder_minutes', values)} aria-describedby={descriptionId} /></>}</SettingField>
          <SettingField label="系统通知"><SettingSwitch aria-label="待办截止系统通知" field="todo_system_notification" checked={config.todo_system_notification} onChange={value => updateConfigField('todo_system_notification', value)} /></SettingField>
          <SettingField label="钉钉通知"><div className="settings-control-group"><IconAction label={testingDingKind === 'todo' ? '正在发送' : '发送待办测试通知'} disabled={testingDing || savingSettings} aria-busy={testingDingKind === 'todo'} onClick={() => void handleTestDing('todo')}>{testingDingKind === 'todo' ? <LoadingOutlined spin /> : <SendOutlined />}</IconAction><SettingSwitch aria-label="待办截止钉钉通知" field="todo_ding_notification" checked={config.todo_ding_notification} onChange={value => handleDingSwitchChange('todo_ding_notification', value)} /></div></SettingField>
        </SettingGroup>
        <SettingGroup title="钉钉机器人">
          <SettingField className="settings-webhook-field" label="机器人 Webhook" htmlFor="ding-webhook" error={dingError} description="用于接收成绩和待办通知。清空后将关闭钉钉通知。">{descriptionId => <>
            <div className="settings-webhook-input-row"><Input id="ding-webhook" disabled={testingDing || savingSettings} status={dingError ? 'error' : undefined} aria-describedby={[descriptionId, dingError ? 'ding-webhook-error' : undefined].filter(Boolean).join(' ')} aria-label="钉钉机器人 Webhook" placeholder="请输入 Webhook 地址" value={dingUrlInput} onBlur={() => dingSave.save()} onChange={event => { setDingUrlInput(event.target.value); setDingError(''); dingSave.change({ ding_url: event.target.value }); }} />
            </div>
          </>}</SettingField>
          <SettingField className="settings-webhook-field" label="加签密钥 Secret" htmlFor="ding-secret" description="如果机器人的安全设置启用了加签，请填写对应密钥。">{descriptionId => <>
            <Input.Password id="ding-secret" aria-label="钉钉加签密钥 Secret" autoComplete="off" disabled={testingDing || savingSettings} value={dingSecretInput} placeholder="请输入加签密钥" onChange={event => { setDingSecretInput(event.target.value); secretSave.change({ ding_secret: event.target.value }); }} onBlur={() => secretSave.save()} aria-describedby={descriptionId} />
          </>}</SettingField>
        </SettingGroup></div>
      <div hidden={section !== 'app'}>
        <SettingGroup title="外观">
          <SettingField label="外观模式"><Segmented aria-label="外观模式" disabled={savingSettings} value={config.theme}
            options={[{ label: '浅色', value: 'light' }, { label: '深色', value: 'dark' }, { label: '跟随系统', value: 'system' }]}
            onChange={value => void updateConfigField('theme', value)} /></SettingField>
        </SettingGroup>
        <SettingGroup title="运行方式">
          <SettingField label="关闭应用后保持后台运行" description="关闭窗口后继续运行，并保留托盘图标。">{descriptionId => <><SettingSwitch aria-label="关闭应用后保持后台运行" field="tray" checked={config.tray} onChange={value => updateConfigField('tray', value)} aria-describedby={descriptionId} /></>}</SettingField>
          <SettingField label="开机自启" description="登录系统时自动启动应用。">{descriptionId => <><SettingSwitch aria-label="开机自启" field="auto_start" checked={config.auto_start} onChange={value => updateConfigField('auto_start', value)} aria-describedby={descriptionId} /></>}</SettingField>
        </SettingGroup>
        <SettingGroup title="关于">
          <SettingField label="应用版本"><ActionButton className="version-details" aria-label="查看版本更新详情" onClick={() => setOpenVersionModal(true)}><span>{currentVersion || '版本信息'}</span>{!!latestVersionData && latestVersionData.version !== currentVersion && <><span className="version-arrow" aria-hidden="true">→</span><span className="version-latest">{latestVersionData.version}</span></>}</ActionButton></SettingField>
        </SettingGroup>
        <div className="settings-about">Made by PeiPei<p>此软件仅供学习交流使用，严禁用于商业用途</p></div>
      </div>
    </div>}
  </Workspace>;
}
