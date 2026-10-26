import UpdateIndicator, { type UpdateIndicatorState } from '../../components/UpdateIndicator';
import PreviewMenu from "../../components/PreviewMenu";
import { useDesktopApp } from '../../context/NotificationContext';
import AppIcon from '../../components/AppIcon';
import WindowChrome from '../../components/WindowChrome';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Form, Input, Switch, Tooltip } from 'antd';
import ActionButton from '../../components/ActionButton';
import { shell, invoke, listen, exit } from '../../bridge';
import { isPreview } from '../../previewMode';

import { UserOutlined, LockOutlined, LoadingOutlined, QuestionCircleOutlined } from '@ant-design/icons';

import { VersionInfo } from '../../model';

interface LoginProps {
  setIsLogin: (isLogin: boolean) => void;
  loginSession: MutableRefObject<number>;
  autoLoginUsername?: string;
  autoLoginPassword?: string;
  currentVersion: string;
  latestVersionData: VersionInfo | null;
  updateIndicator?: UpdateIndicatorState;
  setOpenVersionModal: (open: boolean) => void;
}

export default function Login({
  setIsLogin,
  loginSession,
  autoLoginUsername,
  autoLoginPassword,
  currentVersion,
  latestVersionData,
  updateIndicator,
  setOpenVersionModal
}: LoginProps) {

  const { notification } = useDesktopApp()
  const [form] = Form.useForm()

  const [loading, setLoading] = useState(false)
  const [autoLogin, setAutoLogin] = useState(false)
  const loginInFlight = useRef(false)
  const manualLoginStarted = useRef(false)

  useEffect(() => {
    invoke<boolean>('check_login').then((res) => {
      if (res) {
        setIsLogin(true)
      }
    }).catch(() => { })

    const unlistenClose = listen('close-requested', () => {
      exit(0)
    })

    return () => { unlistenClose.then(fn => fn()); };
  }, [setIsLogin]);

  const completeLoginSetup = useCallback((username: string, remember: boolean) => {
    const session = loginSession.current;
    let pending = false;
    const save = async () => {
      if (pending || session !== loginSession.current) return;
      pending = true;
      try {
        await invoke('complete_login_setup', { username, autoLogin: remember });
        if (session === loginSession.current) notification.destroy('login-setup-error');
      } catch (err) {
        if (session === loginSession.current) notification.warning({
          key: 'login-setup-error', title: remember ? '无法保存自动登录信息' : '无法清除自动登录信息',
          description: String(err), actions: <ActionButton onClick={() => void save()}>重试</ActionButton>,
        });
      } finally { pending = false; }
    };
    void save();
  }, [loginSession, notification]);

  useEffect(() => {
    if (!autoLoginUsername || !autoLoginPassword || manualLoginStarted.current || loginInFlight.current) return;
    loginInFlight.current = true;
    setAutoLogin(true);
    notification.destroy('login-error');
    invoke('login', { username: autoLoginUsername, password: autoLoginPassword })
      .then(() => {
        setIsLogin(true);
        completeLoginSetup(autoLoginUsername, true);
      })
      .catch(err => notification.error({ key: 'login-error', title: '自动登录失败', description: String(err) }))
      .finally(() => { loginInFlight.current = false; setAutoLogin(false); });
  }, [autoLoginUsername, autoLoginPassword, setIsLogin, notification, completeLoginSetup]);

  const onFinish = (values: { username: string; password: string; remember: boolean }) => {
    manualLoginStarted.current = true;
    if (loginInFlight.current) return;
    loginInFlight.current = true;
    notification.destroy('login-error');
    setLoading(true);
    invoke('login', { username: values.username, password: values.password })
      .then(() => {
        setIsLogin(true);
        completeLoginSetup(values.username, values.remember);
      })
      .catch(err => notification.error({ key: 'login-error', title: '登录失败', description: String(err) }))
      .finally(() => { loginInFlight.current = false; setLoading(false); });
  };

  const busy = loading || autoLogin;
  return <>
    <WindowChrome overlay />
    <main className="login-surface">
      <div className="login-main">
        <div className="login-content">
          <AppIcon className="login-app-icon" />
          <h1>ZJU Learning Assistant</h1>
          <p className="login-description">使用浙江大学统一身份认证登录</p>
          <Form name="normal_login" className="login-form" layout="vertical" requiredMark={false}
            onFinish={onFinish} onValuesChange={() => notification.destroy('login-error')} form={form} disabled={busy} scrollToFirstError
            initialValues={{ username: autoLoginUsername, password: autoLoginPassword, remember: true }}>
            <Form.Item label="学号 / 工号" name="username" rules={[{ required: true, whitespace: true, message: '请输入学号或工号' }]}>
              <Input prefix={<UserOutlined />} placeholder="输入学号或工号" autoComplete="username" autoCapitalize="none" spellCheck={false} />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入统一身份认证密码' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="输入统一身份认证密码" autoComplete="current-password" />
            </Form.Item>
            <div className="login-remember"><label htmlFor="normal_login_remember">下次自动登录</label>
              <Form.Item name="remember" valuePropName="checked" noStyle><Switch aria-label="下次自动登录" /></Form.Item>
            </div>
            <ActionButton className="login-submit" variant="primary" type="submit" disabled={busy} aria-busy={busy}>
              {busy && <LoadingOutlined spin />}{autoLogin ? '正在自动登录' : loading ? '正在登录' : '登录'}
            </ActionButton>
            {autoLogin && <p className="login-status" role="status">正在登录 {autoLoginUsername}</p>}
          </Form>
          {isPreview && <p className="login-preview-note">预览模式 · 任意填写可登录，学号 error 可测试失败。</p>}
        </div>
      </div>
      <footer className="login-footer">
        <div><span>Made by PeiPei</span><span>仅供学习交流，严禁用于商业用途</span></div>
        <div className="login-footer-actions">
          <PreviewMenu />
          <ActionButton onClick={() => shell.open('https://github.com/PeiPei233/zju-learning-assistant').catch(err => notification.error({ title: '打开帮助失败', description: String(err) }))}><QuestionCircleOutlined />帮助</ActionButton>
          <Tooltip title={latestVersionData && latestVersionData.version !== currentVersion ? updateIndicator?.label ?? '有新版本，点击查看' : '查看版本信息'}>
            <ActionButton className="login-version" aria-label={`版本信息 ${currentVersion}${latestVersionData && latestVersionData.version !== currentVersion ? ` · ${updateIndicator?.label ?? '有新版本'}` : ''}`} onClick={() => setOpenVersionModal(true)}>
              <span>{currentVersion || '版本信息'}</span>
              <span className={`version-update-slot${latestVersionData && latestVersionData.version !== currentVersion ? ' is-visible' : ''}`} aria-hidden="true"><UpdateIndicator state={updateIndicator} /></span>
            </ActionButton>
          </Tooltip>
        </div>
      </footer>
    </main>
  </>;
}
