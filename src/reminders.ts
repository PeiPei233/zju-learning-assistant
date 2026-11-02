import dayjs from 'dayjs';
import type { TodoItem } from './model';

export const reminderOptions = [15, 30, 60, 120, 1440];
export const reminderLabel = (minutes: number) => minutes >= 1440 ? `${minutes / 1440} 天` : minutes >= 60 ? `${minutes / 60} 小时` : `${minutes} 分钟`;
export function todoReminderMessage(item: Pick<TodoItem, 'course_name' | 'title' | 'end_time'>, point: number) {
  const title = `待办截止提醒 · ${reminderLabel(point)}`;
  const body = `${item.course_name} · ${item.title}\n截止：${dayjs(item.end_time).format('YYYY-MM-DD HH:mm')}`;
  return { title, body, text: `### ${title}\n${body}` };
}

export function dueReminder(item: TodoItem, minutes: readonly number[], now = Date.now()) {
  const deadline = item.end_time ? dayjs(item.end_time).valueOf() : NaN;
  const remaining = deadline - now;
  if (!Number.isFinite(deadline) || remaining <= 0) return null;
  const crossed = [...new Set(minutes)].filter(value => reminderOptions.includes(value) && remaining <= value * 60000).sort((a, b) => a - b);
  if (!crossed.length) return null;
  return { deadline, point: crossed[0], crossed };
}

export class ReminderLedger {
  private entries: Record<string, number> = {};
  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem'>, private scope = '') {
    try {
      const entries = JSON.parse(storage?.getItem(this.key) || '{}');
      if (entries && typeof entries === 'object') this.entries = Object.fromEntries(Object.entries(entries).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > Date.now()));
    } catch { /* A damaged or unavailable cache must not stop refreshing. */ }
  }
  private get key() { return `todo-reminders-v1:${this.scope}`; }
  private id(item: TodoItem, point: number, channel: string) { return JSON.stringify([item.course_id, item.id, item.end_time, point, channel]); }
  has(item: TodoItem, point: number, channel: string) { return !!this.entries[this.id(item, point, channel)]; }
  mark(item: TodoItem, points: number[], channel: string, deadline: number) {
    for (const point of points) this.entries[this.id(item, point, channel)] = deadline;
    this.entries = Object.fromEntries(Object.entries(this.entries).filter(([, expiry]) => expiry > Date.now()));
    try { this.storage?.setItem(this.key, JSON.stringify(this.entries)); } catch { /* Keep session deduplication if storage is unavailable. */ }
  }
}
