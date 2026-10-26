import { useConfig } from '../../context/ConfigContext';
import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Dropdown, Input, Tooltip } from 'antd';
import { CloseOutlined, DownloadOutlined, ExportOutlined, LoadingOutlined, ReloadOutlined, SearchOutlined, UnorderedListOutlined } from '@ant-design/icons';
import Workspace from '../../components/Workspace';
import ActionButton from '../../components/ActionButton';
import EmptyState from '../../components/EmptyState';
import FetchState from '../../components/FetchState';
import OverflowText from '../../components/OverflowText';
import OpenActionButton from '../../components/OpenActionButton';
import { shell } from '../../bridge';
import { useDesktopApp } from '../../context/NotificationContext';
import type { useTodos } from '../../hooks/useTodos';
import { groupTodos, todoDeadline } from './groupTodos';

export default function Todo({ items, loading, exporting, error, configError, lastSync, refresh, exportTodos, onOpenCalDav }: ReturnType<typeof useTodos> & { onOpenCalDav: () => void }) {
  const { savedConfig: config } = useConfig();
  const { notification } = useDesktopApp();
  const [course, setCourse] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [today, setToday] = useState(() => dayjs().startOf('day'));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const updateDay = () => {
      clearTimeout(timer);
      const now = dayjs();
      const day = now.startOf('day');
      setToday(previous => previous.isSame(day) ? previous : day);
      timer = setTimeout(updateDay, day.add(1, 'day').diff(now) + 50);
    };
    // Refresh after sleep or returning to the app, even when syncing is disabled.
    const onVisible = () => { if (document.visibilityState === 'visible') updateDay(); };
    updateDay();
    window.addEventListener('focus', updateDay);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', updateDay);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  const courses = Array.from(new Map(items.map(item => [String(item.course_id), item.course_name])).entries());
  // If a course disappears after a sync, return to the complete current result.
  const activeCourse = courses.some(([id]) => id === course) ? course : null;
  const normalized = query.trim().toLocaleLowerCase();
  const visible = items.filter(item => (!activeCourse || String(item.course_id) === activeCourse) &&
    (!normalized || `${item.title}\n${item.course_name}`.toLocaleLowerCase().includes(normalized)));
  const busy = loading || exporting;
  const exportable = visible.filter(item => todoDeadline(item));
  const open = (url: string) => shell.open(url).catch(err => notification.error({ title: '打开学在浙大失败', description: String(err) }));
  const mac = document.documentElement.dataset.platform === 'macos';
  const exportDisabled = busy || !visible.length;
  const exportMenu = [
    { key: 'ics', label: '导出为 iCalendar 文件', disabled: !exportable.length },
    { key: 'caldav_calendar', label: '导出到 CalDAV 日历', disabled: !exportable.length },
    { key: 'caldav_tasks', label: '导出到 CalDAV 待办事项', disabled: !visible.length },
    ...(mac ? [{ key: 'calendar', label: '添加至日历 App', disabled: !exportable.length }, { key: 'reminder', label: '添加至提醒事项 App', disabled: !visible.length }] : []),
  ];
  const handleExport = (key: string) => {
    if (key.startsWith('caldav_') && (!config.caldav_server || !config.caldav_username || !config.caldav_password || !(key === 'caldav_calendar' ? config.caldav_calendar : config.caldav_task_list))) {
      notification.warning({ key: 'caldav-config-required', title: '请先配置 CalDAV', description: '填写 CalDAV 连接信息并选择导出位置后，即可导出待办。', actions: <ActionButton onClick={() => { notification.destroy('caldav-config-required'); onOpenCalDav(); }}>前往设置</ActionButton> });
      return;
    }
    void exportTodos(key, key === 'reminder' || key === 'caldav_tasks' ? visible : exportable);
  };
  return <Workspace headerless title="待办事项" panel={<>
    <div className="panel-heading"><h2>待办事项</h2></div>
    <div className="panel-list todo-course-list resource-list resource-list-compact">
      <p className="resource-hint">课程</p>
      <div className="resource-rows">
        {[{ id: null, name: '全部课程', count: items.length }, ...courses.map(([id, name]) => ({ id, name, count: items.filter(item => String(item.course_id) === id).length }))].map(item =>
          <button key={item.id ?? 'all'} className={`resource-row todo-course ${activeCourse === item.id ? 'is-selected' : ''}`} aria-pressed={activeCourse === item.id} disabled={busy} onClick={() => setCourse(item.id)}>
            <OverflowText className="resource-name" text={item.name} /><span className="resource-meta">{item.count}</span>
          </button>)}
      </div>
    </div>
    <div className="panel-bottom"><p>{config.todo_auto_sync ? '待办自动更新，同步与通知可在设置中调整。' : '自动同步已关闭，已有待办仍会按设置提醒。'}</p><p>最后更新 · {lastSync || '尚未更新'}</p></div>
  </>} footer={<><span className="muted">共 {visible.length} 项待办 · 来源：学在浙大</span><button className="text-button" onClick={() => void open('https://courses.zju.edu.cn')}>打开学在浙大 <ExportOutlined /></button></>}>
    <section className="resource-list todo-list" aria-label="待办列表" aria-busy={loading}>
      <div className="resource-toolbar">
        <div className="resource-heading"><h2>待办列表</h2><span>{activeCourse || normalized ? `${visible.length} / ${items.length}` : items.length}</span></div>
        <Input className="resource-search" aria-label="搜索待办或课程" placeholder="搜索待办或课程…" prefix={<SearchOutlined />} disabled={busy} value={query} onChange={event => setQuery(event.target.value)}
          suffix={query ? <Tooltip title="清除搜索" trigger={['hover', 'focus']}><button className="icon-button" aria-label="清除搜索" disabled={busy} onClick={() => setQuery('')}><CloseOutlined /></button></Tooltip> : null} />
        <div className="resource-toolbar-actions todo-actions">
          <ActionButton variant="secondary" disabled={busy} aria-busy={loading} onClick={() => void refresh(true)}><ReloadOutlined spin={loading} />{loading ? '正在刷新' : '立即刷新'}</ActionButton>
          <Tooltip title="日历和 iCalendar 文件仅包含有截止时间的待办；待办事项包含全部当前结果" trigger={['hover', 'focus']}><Dropdown trigger={['click']} disabled={exportDisabled} menu={{ items: exportMenu, onClick: ({ key }) => handleExport(key) }}>
            <ActionButton aria-label="导出当前结果" variant="secondary" disabled={exportDisabled} aria-busy={exporting}>{exporting ? <LoadingOutlined spin /> : <DownloadOutlined />}导出当前结果</ActionButton>
          </Dropdown></Tooltip>
        </div>
      </div>
      <div className="resource-selection">{loading && items.length ? <FetchState inline label="正在更新待办…" /> : <span>点击待办前往学在浙大</span>}</div>
      {error && items.length > 0 && <p className="resource-hint" role="status">上次刷新失败，当前显示上次获取的待办。</p>}
      <div className="resource-rows">
        {loading && !items.length ? <FetchState label="正在获取待办…" /> : !visible.length ? <EmptyState icon={normalized || activeCourse ? <SearchOutlined /> : <UnorderedListOutlined />} action={configError ? <button className="text-button" onClick={() => void refresh(true)}>重试读取设置</button> : error ? <button className="text-button" onClick={() => void refresh(true)}>重试</button> : (normalized || activeCourse) ? <button className="text-button" onClick={() => { setQuery(''); setCourse(null); }}>清除筛选</button> : undefined}>
          {configError ? `读取设置失败：${configError}` : error ? `获取待办失败：${error}` : items.length ? '没有匹配的结果' : '暂无待办事项'}
        </EmptyState> : groupTodos(visible, today).map(group => <section key={group.label} className="todo-group" aria-label={group.label}>
          <h3>{group.label}</h3>
          {group.items.map(item => {
            const due = todoDeadline(item);
            return <OpenActionButton hint="打开待办页面" key={`${item.course_id}-${item.id}`} className="resource-row todo-row" disabled={busy} onClick={() => void open(`https://courses.zju.edu.cn/course/${encodeURIComponent(item.course_id)}/learning-activity#/${encodeURIComponent(item.id)}?view=scores`)} aria-label={`${item.title}，前往学在浙大`}>
              <span className="resource-copy"><OverflowText className="resource-name" text={item.title} /><OverflowText className="resource-description" text={item.course_name} /></span>
              <span className="resource-meta todo-deadline">{due ? due.isSame(today, 'day') ? '今天' : due.format('YYYY-MM-DD') : '未设截止时间'}{due && <span>{due.format('HH:mm')}</span>}</span>
            </OpenActionButton>;
          })}
        </section>)}
      </div>
    </section>
  </Workspace>;
}
