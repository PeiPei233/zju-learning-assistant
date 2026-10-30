import { useDesktopApp } from './context/NotificationContext';
import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal, Progress, Typography } from 'antd';
import { CloseCircleOutlined, DownloadOutlined, LoadingOutlined, ReloadOutlined } from '@ant-design/icons';
import { useAppUpdate } from './hooks/useAppUpdate';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { getVersion, invoke, shell } from './bridge';

import Login from './pages/Login'
import Home from './pages/Home'
import Markdown from 'react-markdown';
import { convertUrlsToMarkdown } from './utils';

import ActionButton from './components/ActionButton';
import IconAction from './components/IconAction';
dayjs.locale('zh-cn')

const { Paragraph, Text } = Typography

function App() {

  const { notification } = useDesktopApp()

  const [isLogin, setLogin] = useState(false)
  const loginSession = useRef(0)
  const loggedIn = useRef(false)
  const setIsLogin = useCallback((value: boolean) => {
    loggedIn.current = value
    if (!value) {
      loginSession.current += 1
      notification.destroy('login-setup-error')
      notification.destroy('evaluation-required-check_zdbk_evaluation_done')
      notification.destroy('evaluation-required-check_yjsy_evaluation_done')
    }
    else notification.destroy('startup-read-error')
    setLogin(value)
  }, [notification])
  const [autoLoginUsername, setAutoLoginUsername] = useState('')
  const [autoLoginPassword, setAutoLoginPassword] = useState('')
  const [readingCredentials, setReadingCredentials] = useState(true)
  const [currentVersion, setCurrentVersion] = useState('')
  const [openVersionModal, setOpenVersionModal] = useState(false)
  const showVersionModal = useCallback(() => setOpenVersionModal(true), [])
  const update = useAppUpdate(showVersionModal, openVersionModal)
  const latestVersionData = update.info?.update_available ? update.info : null
  const { check: checkUpdate } = update

  const startupFlight = useRef(false)
  const versionLoaded = useRef(false)
  const credentialsLoaded = useRef(false)
  const startupErrors = useRef({ version: '', credentials: '' })
  const readStartupInfo = useCallback(async (versionOnly = false) => {
    if (startupFlight.current) return
    startupFlight.current = true
    const session = loginSession.current
    await Promise.all([
      versionLoaded.current ? Promise.resolve() : getVersion().then(v => {
        setCurrentVersion('v' + v)
        versionLoaded.current = true
        startupErrors.current.version = ''
      }).catch(err => { startupErrors.current.version = `读取版本信息失败：${String(err)}` }),
      versionOnly || credentialsLoaded.current || loggedIn.current ? Promise.resolve() : invoke<[string, string] | null>('get_auto_login_info').then(res => {
        credentialsLoaded.current = true
        startupErrors.current.credentials = ''
        if (res && !loggedIn.current && session === loginSession.current) {
          setAutoLoginUsername(res[0])
          setAutoLoginPassword(res[1])
        }
      }).catch(err => { startupErrors.current.credentials = `读取自动登录信息失败：${String(err)}` })
        .finally(() => setReadingCredentials(false)),
    ])
    startupFlight.current = false
    if (session !== loginSession.current) return
    if (loggedIn.current) startupErrors.current.credentials = ''
    const errors = Object.values(startupErrors.current).filter(Boolean)
    if (errors.length) notification.error({
      key: 'startup-read-error', title: '部分信息未能读取', description: errors.join('；'),
      actions: <ActionButton onClick={() => void readStartupInfo()}>重试</ActionButton>,
    })
    else notification.destroy('startup-read-error')
  }, [notification])

  useEffect(() => { void readStartupInfo() }, [readStartupInfo])
  useEffect(() => {
    if (openVersionModal) void readStartupInfo(true)
  }, [openVersionModal, readStartupInfo])

  useEffect(() => { void checkUpdate(); }, [checkUpdate]);
  const updateBusy = ['checking', 'downloading', 'installing'].includes(update.stage);
  const openReleasePage = () => {
    if (update.info?.url) void shell.open(update.info.url).catch(err =>
      notification.error({ title: '打开发布页失败', description: String(err) }));
  };
  const percent = update.progress.total && update.progress.total > 0
    ? Math.min(100, Math.floor(update.progress.downloaded / update.progress.total * 100)) : undefined;

  const updateIndicator = {
    downloading: update.stage === 'downloading',
    percent,
    label: update.stage === 'downloading' ? `正在下载更新${percent === undefined ? '' : ` · ${percent}%`}` :
      update.stage === 'ready' ? '更新已就绪' : update.error && latestVersionData ? '更新失败，点击查看' : '有新版本，点击查看',
  };

  return (
    <>
      {isLogin ?
        <Home
          setIsLogin={setIsLogin}
          setAutoLoginUsername={setAutoLoginUsername}
          setAutoLoginPassword={setAutoLoginPassword}
          currentVersion={currentVersion}
          latestVersionData={latestVersionData}
          updateIndicator={updateIndicator}
          setOpenVersionModal={setOpenVersionModal}
        /> :
        <Login
          setIsLogin={setIsLogin}
          loginSession={loginSession}
          readingCredentials={readingCredentials}
          autoLoginUsername={autoLoginUsername}
          autoLoginPassword={autoLoginPassword}
          currentVersion={currentVersion}
          latestVersionData={latestVersionData}
          updateIndicator={updateIndicator}
          setOpenVersionModal={setOpenVersionModal}
        />
      }

      <Modal
        className="desktop-modal version-modal"
        width={520}
        centered
        open={openVersionModal}
        onCancel={() => { if (update.stage !== 'installing') setOpenVersionModal(false); }}
        closable={update.stage !== 'installing'}
        keyboard={update.stage !== 'installing'}
        maskClosable={update.stage !== 'installing'}
        footer={update.stage === 'downloading' ? <div className="version-download" role="status">
          <div className="version-download-copy">
            <div className="version-download-label">
              <span>正在下载更新</span>
              <span>{(update.progress.downloaded / 1024 / 1024).toFixed(1)} MB{update.progress.total ? ` / ${(update.progress.total / 1024 / 1024).toFixed(1)} MB` : ''}</span>
            </div>
            <Progress size="small" percent={percent ?? 0} showInfo={false} status="active" />
          </div>
          <IconAction label={update.cancelling ? '正在取消' : '取消下载'} disabled={update.cancelling} onClick={() => void update.cancelDownload()}><CloseCircleOutlined /></IconAction>
        </div> : <div className="version-actions">
          {update.info?.url && <button type="button" className="text-button version-release-link" disabled={update.stage === 'installing'} onClick={openReleasePage}>查看发布页</button>}
          {!latestVersionData ? <ActionButton variant="primary" disabled={updateBusy} onClick={() => void update.check(true)}>
            {update.stage === 'checking' ? <LoadingOutlined spin /> : <ReloadOutlined />}检查更新
          </ActionButton> : <>
            {latestVersionData.prepare_error && <ActionButton variant="primary" disabled={updateBusy} onClick={() => void update.check(true)}>
              {update.stage === 'checking' ? <LoadingOutlined spin /> : <ReloadOutlined />}重新尝试
            </ActionButton>}
            {latestVersionData.can_install && <ActionButton variant="primary" disabled={updateBusy}
              onClick={() => void (update.stage === 'ready' ? update.install() : update.download())}>
              {update.stage === 'installing' ? <LoadingOutlined spin /> : <DownloadOutlined />}
              {update.stage === 'ready' ? '安装并重启' : update.stage === 'installing' ? '正在安装' : update.error ? '重试下载' : '下载更新'}
            </ActionButton>}
          </>}
        </div>}
        title={latestVersionData ? `发现新版本 ${latestVersionData.version}` : `版本信息${update.info ? ` ${update.info.version}` : ''}`}
        zIndex={1001}
      >
        <Markdown components={{
          a({ node: _node, href, ...props }) {
            return <a
              {...props}
              onClick={(e) => {
                e.preventDefault();
                if (href) {
                  shell.open(href).catch((err) => {
                    notification.error({
                      title: '打开链接失败',
                      description: String(err)
                    })
                  })
                }
              }}
            />
          },
          pre({ node: _node, ...props }) {
            return <Paragraph>
              <pre {...props} />
            </Paragraph>
          },
          code({ node: _node, ...props }) {
            return <Text code {...props} />
          }
        }}>
          {
            update.info ? convertUrlsToMarkdown(update.info.notes.trim() || update.info.notes_error || '暂无版本说明') :
              update.stage === 'checking' ? '正在检查更新…' : update.error ? '暂时无法检查更新，请重试。' : update.checked ? '暂无可用更新' : '尚未检查更新'
          }
        </Markdown>
        {update.error && update.info && <p className="version-error" role="alert">{update.error}</p>}
      </Modal>
    </>
  )
}

export default App
