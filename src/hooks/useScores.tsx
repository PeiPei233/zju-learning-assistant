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
  const generation = useRef(0);
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
        const rows = await invoke<ScoreItem[]>('get_score');
        if (run !== generation.current) return;
        const old = previous.current;
        previous.current = rows;
        if (!old || JSON.stringify(old) !== JSON.stringify(rows)) setScore(rows);
        setLastSync(dayjs().format('YYYY-MM-DD HH:mm:ss'));
        if (old) {
          const settings = configRef.current;
          const oldTotals = calculateScoreTotals(old), totals = calculateScoreTotals(rows);
          const byId = new Map(old.map(item => [item.xkkh, item]));
          if (settings.score_system_notification || (settings.score_ding_notification && settings.ding_url?.trim())) {
            for (const item of rows) {
              const before = byId.get(item.xkkh);
              if (!before || ['cj', 'bkcj', 'jd', 'xf'].some(key => before[key as keyof ScoreItem] !== item[key as keyof ScoreItem])) {
                void invoke('notify_score', { score: item, oldTotalGp: oldTotals.gp, oldTotalCredit: oldTotals.credit, totalGp: totals.gp, totalCredit: totals.credit,
                  dingUrl: settings.score_ding_notification ? settings.ding_url : '', dingSecret: settings.ding_secret, systemEnabled: settings.score_system_notification,
                }).catch(err => { if (run === generation.current) notification.error({ title: '发送成绩通知失败', description: String(err) }); });
              }
            }
          }
        }
        if (request.manual) {
          try {
            const done = await invoke<boolean>('check_evaluation_done');
            if (run !== generation.current) return;
            if (done) notification.success({ title: '成绩刷新成功' });
            else notification.warning({ key: 'evaluation-required', title: '教学评价未完成', description: '本学期尚未完成教学评价，请完成后重新刷新成绩。',
              actions: <ActionButton variant="secondary" onClick={() => shell.open('https://alt.zju.edu.cn/studentEvaluationBackend/list').catch(err => notification.error({ title: '打开教学评价失败', description: String(err) }))}>去评价</ActionButton> });
          } catch (err) { if (run === generation.current) notification.error({ title: '查询教学评价失败', description: String(err) }); }
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
    const poll = async () => {
      await refresh();
      if (run === generation.current) timer = setTimeout(() => void poll(), Math.floor(Math.random() * 60000) + 60000);
    };
    void poll();
    return () => { generation.current = run + 1; flight.current = null; clearTimeout(timer); };
  }, [refresh, ready]);
  const totals = calculateScoreTotals(score);
  return { score, loadingScore: ready ? loading : loadingConfig, scoreConfigError: !ready ? loadError : null, lastSyncScore: lastSync, totalGp: totals.gp, totalCredit: totals.credit, handleSyncScore: () => { void refresh(true); } };
}
