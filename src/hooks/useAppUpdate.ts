import ActionButton from '../components/ActionButton';
import { createElement, Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { beginUpdateInstallation, endUpdateInstallation, invoke, listen } from '../bridge';
import { useConfig } from '../context/ConfigContext';
import { useDownloadManager } from '../context/DownloadContext';
import { useDesktopApp } from '../context/NotificationContext';
import type { VersionInfo } from '../model';
import { isPreview } from '../previewMode';

type Stage = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing';
interface Progress { downloaded: number; total: number | null }

export function useAppUpdate(onShowUpdate?: () => void, modalOpen = false) {
  const { notification } = useDesktopApp();
  const manager = useDownloadManager();
  const { isSaving, hasPendingDrafts } = useConfig();
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<Progress>({ downloaded: 0, total: null });
  const busy = useRef(false);
  const ready = useRef(false);
  const installAction = useRef<(() => Promise<void>) | null>(null);
  const downloadAction = useRef<(() => Promise<void>) | null>(null);
  const showUpdate = useRef(onShowUpdate);
  const modalVisible = useRef(modalOpen);
  useEffect(() => { modalVisible.current = modalOpen; }, [modalOpen]);
  const cancelled = useRef(false);
  const downloadStarted = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const check = useCallback(async (manual = false) => {
    if (busy.current || ready.current) return;
    busy.current = true;
    notification.destroy('app-update-check-error');
    setStage('checking'); setError('');
    try {
      const next = await invoke<VersionInfo | null>('get_latest_version_info');
      if (!mounted.current) return;
      setInfo(next); setChecked(true); setStage(next ? 'available' : 'idle');
      setError(next?.prepare_error ?? '');
      if (next && !manual) notification.info({
        key: 'app-update-available', title: '发现新版本', description: `新版本 ${next.version} 已发布。`,
        actions: createElement(Fragment, null,
          createElement(ActionButton, { onClick: () => { notification.destroy('app-update-available'); showUpdate.current?.(); } }, '查看详情'),
          next.can_install ? createElement(ActionButton, { variant: 'primary', onClick: () => { notification.destroy('app-update-available'); void downloadAction.current?.(); } }, '下载更新') : null),
      });
    } catch (err) {
      if (!mounted.current) return;
      console.error('Update check failed', err);
      setError('检查更新失败，请稍后重试'); setStage('idle');
      if (manual) notification.error({ key: 'app-update-check-error', title: '检查更新失败，请稍后重试' });
    } finally { busy.current = false; }
  }, [notification]);

  const download = async () => {
    if (busy.current || !info?.can_install) return;
    if (ready.current) { onShowUpdate?.(); return; }
    cancelled.current = false;
    busy.current = true;
    notification.destroy('app-update-download-error');
    notification.destroy('app-update-cancel-error');
    notification.destroy('app-update-available');
    setStage('downloading'); setError(''); setProgress({ downloaded: 0, total: null });
    let stop: (() => void) | undefined;
    try {
      stop = await listen<Progress>('app-update-progress', event => {
        if (mounted.current) setProgress(event.payload);
      });
      if (cancelled.current) { setStage('available'); return; }
      downloadStarted.current = true;
      const downloaded = await invoke<boolean>('download_app_update');
      if (downloaded === false) { notification.destroy('app-update-cancel-error'); setStage('available'); return; }
      notification.destroy('app-update-cancel-error');
      ready.current = true;
      if (mounted.current) {
        setStage('ready');
        if (!modalVisible.current) notification.success({ key: 'app-update-ready', title: '更新已下载', description: '可安装并重启应用。', actions: createElement(ActionButton, { onClick: () => void installAction.current?.() }, '安装并重启') });
      }
    } catch (err) {
      if (mounted.current) {
        setError(String(err)); setStage('available');
        notification.error({ key: 'app-update-download-error', title: '更新下载失败', description: '请重试或手动下载更新。', actions: onShowUpdate ? createElement(ActionButton, { onClick: () => { notification.destroy('app-update-download-error'); onShowUpdate(); } }, '查看更新') : undefined });
      }
    } finally { stop?.(); busy.current = false; downloadStarted.current = false; setCancelling(false); }
  };

  const cancelDownload = async () => {
    if (stage !== 'downloading' || cancelling) return;
    cancelled.current = true;
    notification.destroy('app-update-cancel-error');
    setCancelling(true);
    try { if (downloadStarted.current) await invoke('cancel_app_update_download'); }
    catch (err) { setCancelling(false); notification.error({ key: 'app-update-cancel-error', title: '取消下载失败', description: String(err) }); }
  };

  const install = async () => {
    if (busy.current || !ready.current) return;
    if (hasPendingDrafts()) {
      notification.info({ title: '暂时无法安装更新', description: '还有设置未保存，请先完成保存或放弃修改。' });
      return;
    }
    if (isSaving() || manager.getDownloadingCount() > 0) {
      notification.info({ title: '暂时无法安装更新', description: '请等待正在进行的下载或保存完成，或先停止下载任务。' });
      return;
    }
    try { beginUpdateInstallation(); }
    catch (err) { notification.info({ title: '暂时无法安装更新', description: String(err) }); return; }
    busy.current = true;
    notification.destroy('app-update-ready');
    notification.destroy('app-update-install-error');
    setError(''); setStage('installing');
    try {
      await invoke('install_app_update');
      if (isPreview) notification.info({ title: '预览模式：未执行安装或重启' });
    } catch (err) {
      if (mounted.current) {
        setError(String(err));
        if (!modalVisible.current) notification.error({
          key: 'app-update-install-error', title: '更新安装失败', description: String(err),
          actions: createElement(ActionButton, { onClick: () => void installAction.current?.() }, '重试安装'),
        });
      }
    } finally {
      endUpdateInstallation(); busy.current = false;
      if (mounted.current) setStage('ready');
    }
  };

  useEffect(() => { installAction.current = install; downloadAction.current = download; showUpdate.current = onShowUpdate; });

  return { info, stage, checked, error, progress, check, download, install, cancelDownload, cancelling };
}
