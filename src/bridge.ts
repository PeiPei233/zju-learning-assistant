import { invoke as nativeInvoke } from '@tauri-apps/api/core';
import { listen as nativeListen, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event';
import { getVersion as nativeGetVersion } from '@tauri-apps/api/app';
import * as nativeShell from '@tauri-apps/plugin-shell';
import * as nativeDialog from '@tauri-apps/plugin-dialog';
import * as nativeNotification from '@tauri-apps/plugin-notification';
import { exit as nativeExit } from '@tauri-apps/plugin-process';

export interface PreviewBackend {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T>(event: string, handler: EventCallback<T>) => Promise<UnlistenFn>;
}
let preview: PreviewBackend | undefined;
// Called only by the dynamically imported development preview entry point.
export function setPreviewBackend(backend?: PreviewBackend) { preview = backend; }
const activeOperations = new Set<object>();
let installingUpdate = false;
const needsUpdateGuard = (command: string) => command.startsWith('start_download_')
  || ['export_todo', 'export_caldav', 'export_todo_from_tray', 'set_config', 'get_uploads_list', 'login', 'complete_login_setup'].includes(command);

export function beginUpdateInstallation() {
  if (installingUpdate) throw new Error('正在安装更新');
  if (activeOperations.size) throw new Error('请等待正在进行的下载、导出或保存操作完成后再安装更新。');
  installingUpdate = true;
}
export function endUpdateInstallation() { installingUpdate = false; }

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const guarded = needsUpdateGuard(command);
  if (guarded && installingUpdate) throw new Error('正在安装更新，请稍候。');
  const operation = {};
  if (guarded) activeOperations.add(operation);
  try { return await (preview ? preview.invoke<T>(command, args) : nativeInvoke<T>(command, args)); }
  finally { activeOperations.delete(operation); }
}
export function listen<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  return preview ? preview.listen(event, handler) : nativeListen(event, handler);
}
export const getVersion = () => preview ? invoke<string>('plugin:app|version') : nativeGetVersion();
export const shell = { open: (path: string) => preview ? invoke<void>('plugin:shell|open', { path }) : nativeShell.open(path) };
export const dialog = { open: (options: nativeDialog.OpenDialogOptions) => preview ? invoke<string | null>('plugin:dialog|open', { options }) : nativeDialog.open(options) };
export const isPermissionGranted = () => preview ? invoke<boolean>('plugin:notification|is_permission_granted') : nativeNotification.isPermissionGranted();
export const requestPermission = () => preview ? invoke<NotificationPermission>('plugin:notification|request_permission') : nativeNotification.requestPermission();
export const sendNotification = (options: nativeNotification.Options) => preview ? invoke<void>('plugin:notification|notify', { options }) : nativeNotification.sendNotification(options);
export const exit = (code = 0) => preview ? invoke<void>('plugin:process|exit', { code }) : nativeExit(code);
