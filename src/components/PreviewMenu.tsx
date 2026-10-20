import { Dropdown, Tooltip } from "antd";
import { isPreview } from "../previewMode";

export default function PreviewMenu({ navigation = false }: { navigation?: boolean }) {
  const params = new URLSearchParams(window.location.search);
  if (!isPreview) return null;
  return <Tooltip title="切换预览场景" trigger={['hover', 'focus']}><Dropdown placement={navigation ? 'topRight' : 'bottomRight'} trigger={['click']} menu={{
    selectable: true,
    selectedKeys: [`failure-${params.get('failure') || 'none'}`, navigation ? 'session-main' : 'session-login', params.get('evaluation') === 'pending' ? 'pending' : 'normal', params.get('update') === 'none' ? 'update-none' : 'update-available', `theme-${params.get('theme') || 'system'}`, `todos-${params.get('todos') || 'normal'}`, `scores-${params.get('scoreCount') || '6'}`],
    style: { maxHeight: 'min(440px, 60dvh)', overflowY: 'auto' },
    items: [
      {
        type: 'group', label: '异常场景（首次失败，重试恢复）', children: [
          { key: 'failure-none', label: '正常请求' }, { key: 'failure-save', label: '配置保存失败' },
          { key: 'failure-ai', label: 'AI 连接失败' }, { key: 'failure-download', label: '下载失败' },
          { key: 'failure-timeout', label: '数据请求超时（5 秒）' },
        ]
      },
      { type: 'divider' },
      { type: 'group', label: '登录状态', children: [{ key: 'session-login', label: '登录页' }, { key: 'session-main', label: '已登录' }] },
      { type: 'divider' },
      { type: 'group', label: '成绩同步', children: [{ key: 'normal', label: '正常示例数据' }, { key: 'pending', label: '教学评价未完成' }] },
      { type: 'divider' },
      { type: 'group', label: '成绩条数', children: [0, 6, 30, 100, 300].map(count => ({ key: `scores-${count}`, label: `${count} 条${count === 6 ? '（默认）' : ''}` })) },
      { type: 'divider' },
      { type: 'group', label: '待办事项', children: [{ key: 'todos-normal', label: '正常待办' }, { key: 'todos-empty', label: '暂无待办' }] },
      { type: 'divider' },
      { type: 'group', label: '版本更新', children: [{ key: 'update-available', label: '有新版本' }, { key: 'update-none', label: '已是最新版本' }] },
      { type: 'divider' },
      { type: 'group', label: '外观', children: [{ key: 'theme-system', label: '跟随系统' }, { key: 'theme-light', label: '浅色' }, { key: 'theme-dark', label: '深色' }] },
    ],
    onClick: ({ key }) => {
      const params = new URLSearchParams(window.location.search);
      // Keep the actual login state after a successful preview login or logout.
      if (!navigation) params.set('page', 'login');
      else if (params.get('page') === 'login') params.set('page', 'learning');
      if (key.startsWith('failure-')) params.set('failure', key.slice(8));
      else if (key === 'session-login') params.set('page', 'login');
      else if (key === 'session-main') params.set('page', params.get('evaluation') === 'pending' ? 'score' : 'learning');
      else if (key === 'pending') { params.set('evaluation', 'pending'); params.set('page', 'score'); }
      else if (key === 'normal') params.delete('evaluation');
      else if (key.startsWith('todos-')) { params.set('todos', key.slice(6)); params.set('page', 'todo'); }
      else if (key.startsWith('scores-')) { params.set('scoreCount', key.slice(7)); params.set('page', 'score'); }
      else if (key.startsWith('update-')) params.set('update', key === 'update-none' ? 'none' : 'available');
      else if (key.startsWith('theme-')) params.set('theme', key.slice(6));
      window.location.search = params.toString();
    },
  }}><button className={navigation ? "rail-button preview-rail-button" : "preview-scenario"} aria-label="切换预览场景">{navigation ? "预览" : "UI 预览 · 示例数据"}</button></Dropdown></Tooltip>;
}
