import { setPreviewBackend } from '../bridge';
import { courses, uploads, subjects, classroomCourses, classroomSubjects, scores, makePreviewScores, makePreviewTodos, defaultConfig } from './fixtures';

/** Only installed by the dev-only bootstrap. Never falls through to the real backend. */
export function installPreview() {
  const failed = new Set<string>();
  let config = structuredClone(defaultConfig);
  let loggedIn = new URLSearchParams(window.location.search).get('page') !== 'login';
  const previewTodos = makePreviewTodos();
  const nearDeadline = new Date(Date.now() + 10 * 60000).toISOString();
  const downloads = new Map<string, () => void>();
  const listeners = new Map<string, Set<(event: any) => void>>();
  const emit = async (event: string, payload: unknown) => { listeners.get(event)?.forEach(handler => handler({ event, payload, id: 0 })); };
  const invoke = async (command: string, args: any = {}): Promise<any> => {
    // Every mock request has latency; ?delay=0 is useful for automated tests.
    const requestedDelay = new URLSearchParams(window.location.search).get('delay');
    const parsedDelay = requestedDelay === null ? 1000 : Number(requestedDelay);
    const delay = Number.isFinite(parsedDelay) ? Math.min(10000, Math.max(0, parsedDelay)) : 1000;
    if (delay) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    const scenario = new URLSearchParams(window.location.search).get('failure');
    const matches = scenario === 'save' ? command === 'set_config'
      : scenario === 'ding' ? (command === 'send_ding_notification' || command === 'notify_score')
      : scenario === 'ai' ? command === 'test_llm_connection'
        : scenario === 'download' ? command.startsWith('start_download_')
          : scenario === 'timeout' ? ['sync_todo_once', 'get_courses', 'get_undergraduate_score', 'get_graduate_score', 'search_courses', 'get_range_subs', 'get_uploads_list', 'get_course_all_sub_ppts'].includes(command)
            : false;
    if (matches && !failed.has(scenario!)) {
      failed.add(scenario!);
      if (scenario === 'timeout') await new Promise(resolve => setTimeout(resolve, 5000));
      throw new Error(scenario === 'timeout' ? '预览：请求超时，请重试。' : `预览：${({ save: '配置保存', ding: '钉钉通知（模拟签名或机器人校验错误）', ai: 'AI 连接', download: '下载' } as Record<string, string>)[scenario!]}失败，请重试。`);
    }
    switch (command) {
      case 'plugin:app|version': return '0.3.15';
      case 'get_latest_version_info': return new URLSearchParams(window.location.search).get('update') === 'none'
        ? { version: 'v0.3.15', notes: '预览模式：当前已是最新版本。', url: 'https://example.invalid' }
        : { version: 'v0.3.16-preview', notes: '这是用于检查更新提示样式的模拟版本，并非真实发布。\n\n- 优化侧栏状态标记\n- 改进加载与刷新体验', url: 'https://example.invalid' };
      case 'get_auto_login_info': return null;
      case 'check_login': return loggedIn;
      case 'login':
        if (args.username === 'error') throw new Error('示例：账号或密码不正确，请重新输入。');
        loggedIn = true; return null;
      case 'complete_login_setup': return null;
      case 'logout': loggedIn = false; return null;
      case 'test_connection': return true;
      case 'check_graduate_evaluation_done': return new URLSearchParams(window.location.search).get('graduateEvaluation') !== 'pending';
      case 'check_undergraduate_evaluation_done': return new URLSearchParams(window.location.search).get('evaluation') !== 'pending';
      case 'get_notification_scope': return 'preview';
      case 'send_ding_notification': return null;
      case 'get_runtime_config':
      case 'get_config': return structuredClone(config);
      case 'set_config': {
        const next = { ...config, ...structuredClone(args.patch) };
        if (!next.ding_url.trim()) { next.score_ding_notification = false; next.todo_ding_notification = false; }
        if (![next.llm_api_base, next.llm_api_key, next.llm_model].every(value => value?.trim())) next.llm_enabled = false;
        if (next.todo_reminder_minutes.some((value: number) => ![15, 30, 60, 120, 1440].includes(value))) throw new Error('无效的待办提前提醒时间');
        next.todo_reminder_minutes = [...new Set<number>(next.todo_reminder_minutes)].sort((a, b) => a - b);
        if (!Number.isFinite(next.llm_temperature) || next.llm_temperature < 0 || next.llm_temperature > 2) throw new Error('LLM 温度值必须在 0.0 到 2.0 之间');
        config = next;
        return structuredClone(config);
      }
      case 'get_courses': return structuredClone(courses);
      case 'get_academic_year_list': return [{ id: 1, name: '2026—2027', sort: 2 }, { id: 2, name: '2025—2026', sort: 1 }];
      case 'get_semester_list': return [{ id: 1, name: '秋冬', sort: 2, academic_year_id: 1 }, { id: 2, name: '春夏', sort: 1, academic_year_id: 1 }];
      case 'get_uploads_list': return structuredClone(uploads.filter(item => (args.courses || []).some((course: { name: string }) => course.name === item.course_name)));
      case 'get_undergraduate_score': {
        const count = Number(new URLSearchParams(window.location.search).get('scoreCount') ?? scores.length);
        return makePreviewScores(Number.isFinite(count) ? Math.max(0, Math.min(500, Math.floor(count))) : scores.length);
      }
      case 'get_graduate_score': return [];
      case 'sync_todo_once': {
        const scenario = new URLSearchParams(window.location.search).get('todos');
        return scenario === 'empty' ? [] : structuredClone(scenario === 'due' ? [{ ...previewTodos[0], end_time: nearDeadline }] : previewTodos);
      }
      case 'get_range_subs': return structuredClone(subjects.filter(item => item.sub_name.slice(0, 10) >= args.startAt && item.sub_name.slice(0, 10) <= args.endAt));
      case 'search_courses': return structuredClone(classroomCourses.filter(item => item.course_name.includes((args.courseName || '').trim()) && item.lecturer_name.includes((args.teacherName || '').trim())));
      case 'get_course_all_sub_ppts': return structuredClone([...subjects, ...classroomSubjects].filter(item => args.courseIds.includes(item.course_id)));
      case 'start_download_upload': case 'start_download_ppts': {
        downloads.get(args.id)?.();
        return new Promise<void>(resolve => {
          let step = 0;
          const size = args.upload?.size || args.subject?.ppt_image_urls.length || 1;
          const name = args.upload?.file_name || `${args.subject.course_name}-${args.subject.sub_name}`;
          const timer = setInterval(async () => {
            step++;
            await emit('download-progress', { id: args.id, status: step >= 6 ? 'done' : 'downloading', file_name: name, downloaded_size: Math.round(size * step / 6), total_size: size, msg: '' });
            if (step >= 6) { clearInterval(timer); downloads.delete(args.id); resolve(); }
          }, 600);
          downloads.set(args.id, () => { clearInterval(timer); downloads.delete(args.id); resolve(); });
        });
      }
      case 'cancel_download': downloads.get(args.id)?.(); return null;
      case 'plugin:dialog|open': return '/preview/Downloads/新目录';
      case 'plugin:notification|is_permission_granted': return true;
      case 'plugin:notification|request_permission': return 'granted';
      case 'test_llm_connection': return '预览模式：连接测试成功（未调用模型）';
      case 'export_todo': return '示例待办已导出';
      case 'export_todo_from_tray': return null;
      case 'notify_score': case 'open_file': case 'open_file_upload': case 'open_file_ppts': return null;
      default:
        if (command.startsWith('plugin:')) return null;
        throw new Error(`预览模式尚未实现接口：${command}`);
    }
  };
  setPreviewBackend({
    invoke, listen: async (event, handler) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return () => { listeners.get(event)?.delete(handler); };
    }
  });
  window.__ZJU_PREVIEW_DATA__ = { courses, uploads };
  return () => { downloads.forEach(cancel => cancel()); downloads.clear(); listeners.clear(); setPreviewBackend(); };
}
