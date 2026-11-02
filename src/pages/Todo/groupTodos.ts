import dayjs from 'dayjs';
import type { TodoItem } from '../../model';

export function todoDeadline(item: TodoItem) {
  const date = item.end_time ? dayjs(item.end_time) : null;
  return date?.isValid() ? date : null;
}

export function groupTodos(items: TodoItem[], now = dayjs()) {
  const groups = ['已截止', '今天', '未来 7 天', '更晚', '未设截止时间'].map(label => ({ label, items: [] as TodoItem[] }));
  const today = now.startOf('day');
  for (const item of [...items].sort((a, b) => (todoDeadline(a)?.valueOf() ?? Infinity) - (todoDeadline(b)?.valueOf() ?? Infinity))) {
    const date = todoDeadline(item);
    const group = !date ? 4 : date.isBefore(today) ? 0 : date.isBefore(today.add(1, 'day')) ? 1 : date.isBefore(today.add(8, 'day')) ? 2 : 3;
    groups[group].items.push(item);
  }
  return groups.filter(group => group.items.length);
}
