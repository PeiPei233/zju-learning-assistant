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
  const [items, setItems] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const latest = useRef<TodoItem[]>([]);
  const snapshot = useRef<string | null>(null);
  const inFlight = useRef<{ manual: boolean; foreground: boolean } | null>(null);
  const exportInFlight = useRef(false);
  const generation = useRef(0);
  const notified = useRef(new Set<string>());

  const refresh = useCallback(async (manual = false) => {
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
      setLastSync(dayjs().format('YYYY-MM-DD HH:mm:ss'));
      if (notifyChange) notification.info({ title: '待办有更新', description: `当前共 ${result.length} 项待办。` });
      const due = result.filter(item => {
        const minutes = item.end_time ? dayjs(item.end_time).diff(dayjs(), 'minute') : NaN;
        return minutes > 0 && minutes <= 60 && !notified.current.has(`${item.course_id}-${item.id}-${item.end_time}`);
      });
      if (due.length) {
        // Notification permission failures must not invalidate a successful list refresh.
        try {
          const granted = await isPermissionGranted() || await requestPermission() === 'granted';
          if (granted && run === generation.current) for (const item of due) {
            sendNotification({ title: `距离 ${item.title} 截止不足一个小时`, body: `${item.course_name}-${item.title}: ${dayjs(item.end_time).format('YYYY-MM-DD HH:mm:ss')}` });
            notified.current.add(`${item.course_id}-${item.id}-${item.end_time}`);
          }
        } catch { /* The list remains available when system notifications are unavailable. */ }
      }
    } catch (err) {
      if (run !== generation.current) return;
      if (request.foreground) setError(String(err));
      if (request.manual) notification.error({ title: '获取待办失败', description: String(err) });
    } finally {
      if (run === generation.current) {
        inFlight.current = null;
        if (request.foreground) setLoading(false);
      }
    }
  }, [notification]);

  const exportTodos = useCallback(async (location: string, selection = latest.current) => {
    if (exportInFlight.current) return;
    exportInFlight.current = true;
    setExporting(true);
    try { await invoke('export_todo', { todoList: selection, location }); }
    catch (err) { notification.error({ title: '导出待办失败', description: String(err) }); }
    finally { exportInFlight.current = false; setExporting(false); }
  }, [notification]);

  useEffect(() => {
    const run = ++generation.current;
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    const unlisten = listen<string>('export-todo', event => { void exportTodos(event.payload); });
    return () => {
      generation.current = run + 1;
      inFlight.current = null;
      clearInterval(timer);
      void unlisten.then(stop => stop()).catch(console.error);
    };
  }, [refresh, exportTodos]);

  return { items, loading, exporting, error, lastSync, refresh, exportTodos };
}
