import { useConfig } from '../context/ConfigContext';
import { dueReminder, ReminderLedger, todoReminderMessage } from '../reminders';
import { useCallback, useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { invoke, listen, isPermissionGranted, requestPermission, sendNotification } from '../bridge';
import { useDesktopApp } from '../context/NotificationContext';
import type { TodoItem } from '../model';

function todoSnapshot(items: TodoItem[]) {
  return JSON.stringify(items.map(item => JSON.stringify([
    String(item.course_id), String(item.id), item.title, item.course_name, item.end_time,
  ])).sort());
}

/** Shared by the page, tray exports and existing one-minute reminder polling. */
export function useTodos() {
  const { notification } = useDesktopApp();
  const { savedConfig: config, ready, loadError, loadingConfig, refreshConfig } = useConfig();
  const configState = useRef({ ready, refreshConfig }); configState.current = { ready, refreshConfig };
  const configRef = useRef(config); configRef.current = config;
  const [items, setItems] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const latest = useRef<TodoItem[]>([]);
  const snapshot = useRef<string | null>(null);
  const inFlight = useRef<{ manual: boolean; foreground: boolean } | null>(null);
  const exportInFlight = useRef(false);
  const exportGeneration = useRef(0);
  useEffect(() => () => { exportGeneration.current += 1; }, []);
  const generation = useRef(0);
  const ledger = useRef(new ReminderLedger());

  const reminderFlights = useRef(new Set<string>());

  const reminderErrors = useRef(new Map<string, string>());
  const checkReminders = useCallback(() => {
    if (!configState.current.ready) return;
    const run = generation.current;
    const settings = configRef.current;
    const activeLedger = ledger.current;
    for (const item of latest.current) {
      const due = dueReminder(item, settings.todo_reminder_minutes);
      if (!due) continue;
      for (const channel of ['system', 'ding'] as const) {
        const enabled = channel === 'system' ? settings.todo_system_notification : settings.todo_ding_notification && settings.ding_url?.trim();
        const key = JSON.stringify([run, item.course_id, item.id, item.end_time, channel]);
        if (!enabled || activeLedger.has(item, due.point, channel) || reminderFlights.current.has(key)) continue;
        reminderFlights.current.add(key);
        void (async () => {
          try {
            if (channel === 'system') {
              const granted = await isPermissionGranted() || await requestPermission() === 'granted';
              if (!granted) return;
            }
            if (run !== generation.current) return;
            const currentSettings = configRef.current;
            const currentItem = latest.current.find(candidate => String(candidate.course_id) === String(item.course_id)
              && String(candidate.id) === String(item.id) && candidate.end_time === item.end_time);
            if (!currentItem) return;
            const currentDue = dueReminder(currentItem, currentSettings.todo_reminder_minutes);
            if (!currentDue || activeLedger.has(currentItem, currentDue.point, channel)) return;
            const { title, body, text } = todoReminderMessage(currentItem, currentDue.point);
            if (channel === 'system') {
              if (!currentSettings.todo_system_notification) return;
              await sendNotification({ title, body });
            } else {
              if (!currentSettings.todo_ding_notification || !currentSettings.ding_url?.trim()) return;
              await invoke('send_ding_notification', { dingUrl: currentSettings.ding_url, dingSecret: currentSettings.ding_secret, title, text });
            }
            if (run === generation.current) {
              activeLedger.mark(currentItem, currentDue.crossed, channel, currentDue.deadline);
              reminderErrors.current.delete(key);
            }
          } catch (err) {
            if (run === generation.current && reminderErrors.current.get(key) !== String(err)) {
              reminderErrors.current.set(key, String(err));
              notification.error({ title: `发送待办${channel === 'system' ? '系统' : '钉钉'}通知失败`, description: String(err) });
            }
          } finally { reminderFlights.current.delete(key); }
        })();
      }
    }
  }, [notification]);

  const refresh = useCallback(async (manual = false) => {
    if (!configState.current.ready) { await configState.current.refreshConfig(); return; }
    if (inFlight.current) {
      if (manual) {
        inFlight.current.manual = true;
        inFlight.current.foreground = true;
        setLoading(true);
      }
      return;
    }
    if (exportInFlight.current) return;
    const request = { manual, foreground: manual || snapshot.current === null };
    inFlight.current = request;
    const run = generation.current;
    if (request.foreground) setLoading(true);
    try {
      const result = await invoke<TodoItem[]>('sync_todo_once');
      if (run !== generation.current) return;
      const nextSnapshot = todoSnapshot(result);
      const changed = snapshot.current !== nextSnapshot;
      const notifyChange = !request.manual && snapshot.current !== null && changed;
      snapshot.current = nextSnapshot;
      if (changed) {
        latest.current = result;
        setItems(result);
      }
      setError(null);
      notification.destroy('todo-refresh-error');
      setLastSync(dayjs().format('YYYY-MM-DD HH:mm:ss'));
      if (notifyChange) notification.info({ title: '待办有更新', description: `当前共 ${result.length} 项待办。` });
      checkReminders();
      if (run === generation.current && request.manual) notification.success({ title: '待办刷新成功' });
    } catch (err) {
      if (run !== generation.current) return;
      if (request.foreground) setError(String(err));
      if (request.manual) notification.error({ key: 'todo-refresh-error', title: '待办刷新失败', description: String(err) });
    } finally {
      if (run === generation.current) {
        inFlight.current = null;
        if (request.foreground) setLoading(false);
      }
    }
  }, [notification, checkReminders]);

  const exportTodos = useCallback(async (location: string, selection = latest.current, fromTray = false) => {
    if (exportInFlight.current) return;
    exportInFlight.current = true;
    const run = exportGeneration.current;
    setExporting(true);
    try {
      const message = await invoke<string | null>(fromTray ? 'export_todo_from_tray' : 'export_todo', { todoList: selection, location });
      if (run === exportGeneration.current) notification.destroy('todo-export-error');
      if (run === exportGeneration.current && !fromTray && message) notification.success({ title: '导出待办成功', description: message });
    }
    catch (err) {
      if (run === exportGeneration.current) notification.error({ key: 'todo-export-error', title: '导出待办失败', description: String(err) });
    }
    finally {
      if (run === exportGeneration.current) { exportInFlight.current = false; setExporting(false); }
    }
  }, [notification]);

  useEffect(() => {
    if (!ready) return;
    const run = ++generation.current;
    let timer: ReturnType<typeof setInterval> | undefined;
    let reminderTimer: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      try {
        const scope = await invoke<string>('get_notification_scope');
        if (run !== generation.current) return;
        ledger.current = new ReminderLedger(typeof localStorage === 'undefined' ? undefined : localStorage, scope || 'preview');
      } catch { /* Keep session deduplication if the account scope cannot be read. */ }
      if (run !== generation.current) return;
      void refresh();
      timer = setInterval(() => { if (configRef.current.todo_auto_sync) void refresh(); }, 60000);
      reminderTimer = setInterval(checkReminders, 60000);
    })();
    const unlisten = listen<string>('export-todo', event => { void exportTodos(event.payload, latest.current, true); });
    return () => {
      generation.current = run + 1;
      inFlight.current = null;
      clearInterval(timer);
      clearInterval(reminderTimer);
      void unlisten.then(stop => stop()).catch(console.error);
    };
  }, [refresh, exportTodos, checkReminders, ready]);

  return { items, loading: ready ? loading : loadingConfig, exporting, error, configError: !ready ? loadError : null, lastSync, refresh, exportTodos };
}
