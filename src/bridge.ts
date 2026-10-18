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
export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return preview ? preview.invoke<T>(command, args) : nativeInvoke<T>(command, args);
}
export function listen<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  return preview ? preview.listen(event, handler) : nativeListen(event, handler);
}
export const getVersion = () => preview ? invoke<string>('plugin:app|version') : nativeGetVersion();
export const shell = { open: (path: string) => preview ? invoke<void>('plugin:shell|open', { path }) : nativeShell.open(path) };
export const dialog = { open: (options: nativeDialog.OpenDialogOptions) => preview ? invoke<string | null>('plugin:dialog|open', { options }) : nativeDialog.open(options) };
export const isPermissionGranted = () => preview ? invoke<boolean>('plugin:notification|is_permission_granted') : nativeNotification.isPermissionGranted();
export const requestPermission = () => preview ? invoke<NotificationPermission>('plugin:notification|request_permission') : nativeNotification.requestPermission();
export const sendNotification = (options: nativeNotification.Options) => { if (preview) void invoke('plugin:notification|notify', { options }); else nativeNotification.sendNotification(options); };
export const exit = (code = 0) => preview ? invoke<void>('plugin:process|exit', { code }) : nativeExit(code);
