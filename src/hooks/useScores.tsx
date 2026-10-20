import { useCallback, useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { invoke, shell } from '../bridge';
import { useConfig } from '../context/ConfigContext';
import { useDesktopApp } from '../context/NotificationContext';
import { calculateScoreTotals } from '../utils';
import type { ScoreItem } from '../model';
import ActionButton from '../components/ActionButton';

export function useScores() {
  const { savedConfig: config, ready, loadError, loadingConfig, refreshConfig } = useConfig();
  const configState = useRef({ ready, refreshConfig }); configState.current = { ready, refreshConfig };
  const configRef = useRef(config); configRef.current = config;
  const { notification } = useDesktopApp();
  const [score, setScore] = useState<ScoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const previous = useRef<ScoreItem[] | null>(null);
  const previousParts = useRef<{ undergraduate: ScoreItem[] | null; graduate: ScoreItem[] | null }>({ undergraduate: null, graduate: null });
  const generation = useRef(0);
  const checkedEvaluations = useRef(new Set<string>());
  const failedEvaluations = useRef(new Set<string>());
  const flight = useRef<{ manual: boolean; foreground: boolean; promise?: Promise<void> } | null>(null);
  const refresh = useCallback((manual = false): Promise<void> => {
    if (!configState.current.ready) return configState.current.refreshConfig();
    if (flight.current) {
      if (manual) { flight.current.manual = true; flight.current.foreground = true; setLoading(true); }
      return flight.current.promise!;
    }
    const run = generation.current;
    const request = { manual, foreground: manual || previous.current === null, promise: undefined as Promise<void> | undefined };
    flight.current = request;
    if (request.foreground) setLoading(true);
    request.promise = (async () => {
      try {
        const [undergraduate, graduate] = await Promise.allSettled([
          invoke<ScoreItem[]>('get_undergraduate_score'),
          invoke<ScoreItem[]>('get_graduate_score'),
        ]);
        const response = {
          undergraduate: undergraduate.status === 'fulfilled' ? undergraduate.value : null,
          graduate: graduate.status === 'fulfilled' ? graduate.value : null,
        };
        const errors = [
          undergraduate.status === 'rejected' ? `本科成绩：${String(undergraduate.reason)}` : null,
          graduate.status === 'rejected' ? `研究生成绩：${String(graduate.reason)}` : null,
        ].filter((error): error is string => error !== null);
        if (run !== generation.current) return;
        if (response.undergraduate === null && response.graduate === null) {
          throw new Error(errors.join('\n') || '成绩获取失败');
        }
        const parts = previousParts.current;
        // A failed source retains its last successful result; an empty array clears it.
        // A source's first successful response establishes its notification baseline.
        const changedRows = (['undergraduate', 'graduate'] as const).flatMap(key =>
          response[key] !== null && parts[key] !== null ? response[key]! : []);
        const nextParts = {
          undergraduate: response.undergraduate ?? parts.undergraduate,
          graduate: response.graduate ?? parts.graduate,
        };
        previousParts.current = nextParts;
        const rows = [...(nextParts.undergraduate ?? []), ...(nextParts.graduate ?? [])];
        const old = previous.current;
        previous.current = rows;
        if (!old || JSON.stringify(old) !== JSON.stringify(rows)) setScore(rows);
        if (!errors.length) setLastSync(dayjs().format('YYYY-MM-DD HH:mm:ss'));
        if (old) {
          const settings = configRef.current;
          const oldTotals = calculateScoreTotals(old), totals = calculateScoreTotals(rows);
          const byId = new Map(old.map(item => [item.course_id, item]));
          if (settings.score_system_notification || (settings.score_ding_notification && settings.ding_url?.trim())) {
            for (const item of changedRows) {
              const before = byId.get(item.course_id);
              if (!before || ['grade', 'makeup_grade', 'grade_point', 'credits'].some(key => before[key as keyof ScoreItem] !== item[key as keyof ScoreItem])) {
                void invoke('notify_score', { score: item, oldTotalGp: oldTotals.gp, oldTotalCredit: oldTotals.credit, totalGp: totals.gp, totalCredit: totals.credit,
                  dingUrl: settings.score_ding_notification ? settings.ding_url : '', dingSecret: settings.ding_secret, systemEnabled: settings.score_system_notification,
                }).catch(err => { if (run === generation.current) notification.error({ title: '发送成绩通知失败', description: String(err) }); });
              }
            }
          }
        }
        if (errors.length && request.foreground) notification.warning({
          title: '部分成绩刷新失败',
          description: `${errors.join('\n')}\n已更新获取成功的成绩，失败部分保留上次结果。`,
        });
        {
          const checks = [
            { available: response.undergraduate !== null, command: 'check_undergraduate_evaluation_done', label: '本科', url: 'https://alt.zju.edu.cn/studentEvaluationBackend/list' },
            { available: response.graduate !== null, command: 'check_graduate_evaluation_done', label: '研究生', url: 'https://yjsy.zju.edu.cn/dashboard/workplace?dm=py_xsxk&mode=2&role=1&back=dashboard' },
          ].filter(check => check.available && (request.manual || !checkedEvaluations.current.has(check.command)));
          const results = await Promise.allSettled(checks.map(check => invoke<boolean>(check.command)));
          if (run !== generation.current) return;
          const pending = checks.filter((_, index) => results[index].status === 'fulfilled' && results[index].value === false);
          const failed = results.some(result => result.status === 'rejected');
          results.forEach((result, index) => {
            const check = checks[index];
            const errorKey = `evaluation-error-${check.command}`;
            if (result.status !== 'fulfilled') {
              checkedEvaluations.current.delete(check.command);
              if (request.manual || !failedEvaluations.current.has(check.command)) {
                notification.error({ key: errorKey, title: `查询${check.label}教学评价失败`, description: String(result.reason) });
              }
              failedEvaluations.current.add(check.command);
              return;
            }
            failedEvaluations.current.delete(check.command);
            notification.destroy(errorKey);
            checkedEvaluations.current.add(check.command);
            const key = `evaluation-required-${check.command}`;
            if (result.value) notification.destroy(key);
            else notification.warning({
              key, title: `${check.label}教学评价未完成`,
              description: '部分课程需完成评价后才能查看成绩，请完成后重新刷新。',
              actions: <ActionButton variant="secondary"
                onClick={() => shell.open(check.url).catch(err => notification.error({ title: '打开教学评价失败', description: String(err) }))}>
                去评价
              </ActionButton>,
            });
          });
          if (!pending.length && !failed && !errors.length && request.manual) {
            notification.success({ title: '成绩刷新成功' });
          }
        }
      } catch (err) {
        if (run === generation.current && request.foreground) notification.error({ title: '成绩刷新失败', description: String(err) });
      } finally {
        if (run === generation.current) { flight.current = null; if (request.foreground) setLoading(false); }
      }
    })();
    return request.promise;
  }, [notification]);
  useEffect(() => {
    if (!ready) return;
    const run = ++generation.current;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (initial = false) => {
      if (initial || configRef.current.score_auto_sync) await refresh();
      if (run === generation.current) timer = setTimeout(() => void poll(), Math.floor(Math.random() * 60000) + 60000);
    };
    void poll(true);
    return () => { generation.current = run + 1; flight.current = null; clearTimeout(timer); };
  }, [refresh, ready]);
  const totals = calculateScoreTotals(score);
  return { score, loadingScore: ready ? loading : loadingConfig, scoreConfigError: !ready ? loadError : null, lastSyncScore: lastSync, totalGp: totals.gp, totalCredit: totals.credit, handleSyncScore: () => { void refresh(true); } };
}
