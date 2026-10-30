import { useEffect, useRef, useState } from 'react';
import { Button, Input, Select, Tooltip } from 'antd';
import { LoadingOutlined, ReloadOutlined } from '@ant-design/icons';
import { invoke } from '../../bridge';
import { useConfig } from '../../context/ConfigContext';
import { useDesktopApp } from '../../context/NotificationContext';
import { useConfigAutosave } from '../../hooks/useConfigAutosave';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import type { CalDavCalendar, Config } from '../../model';
import SettingField from './SettingField';

export default function CalDavSetting({ active }: { active: boolean }) {
  const { config, savedConfig, ready, isSaving, updateConfigField, updateConfigBatch } = useConfig();
  const savingSettings = useDelayedBusy(isSaving());
  const { notification } = useDesktopApp();
  const [draft, setDraft] = useState<Pick<Config, 'caldav_server' | 'caldav_username' | 'caldav_password' | 'caldav_calendar' | 'caldav_task_list'>>(config);
  const [calendars, setCalendars] = useState<CalDavCalendar[] | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [openList, setOpenList] = useState<'caldav_calendar' | 'caldav_task_list' | null>(null);
  const [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dismiss = (event: Event) => {
      if (!(event.target instanceof Element) || event.target.closest('.caldav-select-popup')) return;
      const select = event.target.closest('.ant-select');
      if (!select || !container.current?.contains(select)) setOpenList(null);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
    };
  }, []);
  const flight = useRef(false);
  const requestId = useRef(0);
  const attemptedCredentials = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const autosave = useConfigAutosave(async () => true);
  const saveRef = useRef(autosave); saveRef.current = autosave;
  useEffect(() => { setDraft(previous => ({ ...previous, ...Object.fromEntries(Object.entries(config).filter(([key]) => key.startsWith('caldav_') && !saveRef.current.hasDraft(key as keyof Config))) })); }, [config]);
  const change = (patch: Partial<Config>, credentials = false) => {
    const next = { ...draft, ...patch, ...(credentials ? { caldav_calendar: '', caldav_task_list: '' } : {}) };
    setDraft(next);
    if (credentials) {
      requestId.current += 1; flight.current = false; attemptedCredentials.current = null;
      setConnecting(false); setCalendars(null); setError(''); setOpenList(null);
      notification.destroy('caldav-connect-error');
    }
    autosave.change({ ...patch, ...(credentials ? { caldav_calendar: '', caldav_task_list: '' } : {}) });
  };
  const connect = async () => {
    if (flight.current) return;
    const id = ++requestId.current;
    const current = () => mounted.current && requestId.current === id;
    flight.current = true; setConnecting(true);
    try {
      const saved = await autosave.save();
      if (!current()) return;
      if (!saved) return;
      attemptedCredentials.current = JSON.stringify([draft.caldav_server, draft.caldav_username, draft.caldav_password]);
      const result = await invoke<CalDavCalendar[]>('connect_caldav', { server: draft.caldav_server, username: draft.caldav_username, password: draft.caldav_password });
      if (!current()) return;
      setCalendars(result); setError('');
      notification.destroy('caldav-connect-error');
      const calendar = result.some(c => c.url === draft.caldav_calendar && c.components.includes('VEVENT')) ? draft.caldav_calendar : '';
      const task_list = result.some(c => c.url === draft.caldav_task_list && c.components.includes('VTODO')) ? draft.caldav_task_list : '';
      if (calendar !== draft.caldav_calendar || task_list !== draft.caldav_task_list) {
        await updateConfigBatch({ caldav_calendar: calendar, caldav_task_list: task_list });
      }
    } catch (err) {
      if (current()) {
        setError(String(err));
        notification.error({ key: 'caldav-connect-error', title: '获取日历列表失败', description: String(err) });
      }
    }
    finally { if (current()) { flight.current = false; setConnecting(false); } }
  };
  const connectRef = useRef(connect); connectRef.current = connect;
  useEffect(() => {
    if (!active) {
      attemptedCredentials.current = null;
      setOpenList(null);
      return;
    }
    if (!ready || connecting || autosave.saving) return;
    const credentials = [savedConfig.caldav_server, savedConfig.caldav_username, savedConfig.caldav_password];
    if (!credentials.every(value => value.trim())) return;
    if (['caldav_server', 'caldav_username', 'caldav_password'].some(key => saveRef.current.hasDraft(key as keyof Config))) return;
    const key = JSON.stringify(credentials);
    if (key !== JSON.stringify([draft.caldav_server, draft.caldav_username, draft.caldav_password])
      || attemptedCredentials.current === key) return;
    attemptedCredentials.current = key;
    void connectRef.current();
  }, [active, ready, connecting, autosave.saving, savedConfig.caldav_server, savedConfig.caldav_username, savedConfig.caldav_password,
    draft.caldav_server, draft.caldav_username, draft.caldav_password]);
  return <div className="caldav-settings" ref={container}>
    <SettingField label="服务器地址" htmlFor="caldav-server" description="填写日历服务提供的 CalDAV 地址。">{descriptionId => <><Input id="caldav-server" placeholder="请输入服务器地址" autoComplete="off" value={draft.caldav_server} onChange={event => change({ caldav_server: event.target.value }, true)} onBlur={() => void autosave.save()} aria-describedby={descriptionId} /></>}</SettingField>
    <SettingField label="用户名" htmlFor="caldav-username"><Input id="caldav-username" placeholder="请输入用户名" autoComplete="off" value={draft.caldav_username} onChange={event => change({ caldav_username: event.target.value }, true)} onBlur={() => void autosave.save()} /></SettingField>
    <SettingField label="密码／授权码" htmlFor="caldav-password" description="部分服务需要单独生成日历授权码。">{descriptionId => <><Input.Password id="caldav-password" placeholder="请输入密码或授权码" autoComplete="new-password" value={draft.caldav_password} onChange={event => change({ caldav_password: event.target.value }, true)} onBlur={() => void autosave.save()} aria-describedby={descriptionId} /></>}</SettingField>
    {(['caldav_calendar', 'caldav_task_list'] as const).map(key => {
      const credentialsPending = (['caldav_server', 'caldav_username', 'caldav_password'] as const).some(field => autosave.hasDraft(field));
      const selected = credentialsPending ? '' : config[key];
      const component = key === 'caldav_calendar' ? 'VEVENT' : 'VTODO';
      const choices = calendars?.filter(c => c.components.includes(component));
      const unsupported = choices?.length === 0;
      const options = choices?.map(c => ({ value: c.url, label: c.name })) ?? (selected ? [{ value: selected, label: connecting ? '正在获取…' : '已选择，展开可更换' }] : []);
      return <SettingField key={key} label={key === 'caldav_calendar' ? '日历' : '待办列表'} description={unsupported ? `此服务未提供可用的${key === 'caldav_calendar' ? '日历' : '待办列表'}。` : key === 'caldav_calendar' ? '用于导出有截止时间的待办。' : '用于导出全部待办，包括没有截止时间的事项。'}>{descriptionId => <>
        {error ? <Tooltip title={connecting ? null : `点击重新获取${key === 'caldav_calendar' ? '日历' : '待办列表'}`} trigger={['hover', 'focus']}>
          <Button className="course-filter-retry" disabled={connecting} aria-busy={connecting}
            aria-label={`重新获取${key === 'caldav_calendar' ? '日历' : '待办列表'}`} onClick={() => void connect()} aria-describedby={descriptionId}>
            <span className="course-filter-status">{choices?.find(c => c.url === selected)?.name || (connecting ? '正在获取…' : '加载失败')}</span>
            {connecting ? <LoadingOutlined spin aria-hidden="true" /> : <ReloadOutlined aria-hidden="true" />}
          </Button>
        </Tooltip> : <Select classNames={{ popup: { root: 'caldav-select-popup' } }} aria-label={`CalDAV ${key === 'caldav_calendar' ? '日历' : '待办列表'}`} disabled={connecting || savingSettings || credentialsPending || !draft.caldav_server.trim() || !draft.caldav_username.trim() || !draft.caldav_password} loading={connecting} allowClear={!connecting} placeholder="请选择导出位置" open={openList === key && !connecting && (calendars !== null || !!error)} onOpenChange={open => {
          setOpenList(open ? key : null);
          if (open && calendars === null) void connect();
        }} onInputKeyDown={event => { if (event.key === 'Escape') setOpenList(null); }} notFoundContent={unsupported ? '暂无可用列表' : '展开以获取列表'} value={selected || undefined} options={options} onChange={value => { if (flight.current || credentialsPending) return; void updateConfigField(key, value || ''); }} aria-describedby={descriptionId} />}
      </>}</SettingField>;
    })}
  </div>;
}
