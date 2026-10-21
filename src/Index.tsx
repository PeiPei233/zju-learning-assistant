import { useDesktopApp } from './context/NotificationContext';
import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal, Typography } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { getVersion, invoke, shell } from './bridge';

import Login from './pages/Login'
import Home from './pages/Home'
import Markdown from 'react-markdown';
import { convertUrlsToMarkdown } from './utils';

import { VersionInfo } from './model';
import ActionButton from './components/ActionButton';
dayjs.locale('zh-cn')

const { Paragraph, Text } = Typography

function Index() {

  const { notification } = useDesktopApp()

  const [isLogin, setLogin] = useState(false)
  const loginSession = useRef(0)
  const setIsLogin = useCallback((loggedIn: boolean) => {
    if (!loggedIn) loginSession.current += 1
    setLogin(loggedIn)
  }, [])
  const [autoLoginUsername, setAutoLoginUsername] = useState('')
  const [autoLoginPassword, setAutoLoginPassword] = useState('')
  const [currentVersion, setCurrentVersion] = useState('')
  const [latestVersionData, setLatestVersionData] = useState<VersionInfo | null>(null)
  const [openVersionModal, setOpenVersionModal] = useState(false)

  useEffect(() => {
    getVersion().then((v) => {
      setCurrentVersion('v' + v)
      invoke<VersionInfo | null>('get_latest_version_info').then((res) => {
        const data = res
        if (!data) throw new Error('获取最新版本信息失败')
        if (!data.version) throw new Error(JSON.stringify(data))
        if (data.version !== 'v' + v) {
          notification.info({
            title: '发现新版本',
            description: `当前版本：${'v' + v}，最新版本：${data.version}`
          })
        }
        setLatestVersionData(data)
      }).catch((err) => {
        console.log(err)
      })
    })
    invoke<[string, string] | null>('get_auto_login_info').then((res) => {
      if (res) {
        setAutoLoginUsername(res[0])
        setAutoLoginPassword(res[1])
      }
    })
    invoke('test_connection').catch((err) => {
      notification.error({
        title: '连接失败',
        description: String(err.message || err)
      })
    })
  }, [notification])

  return (
    <>
      {isLogin ?
        <Home
          setIsLogin={setIsLogin}
          setAutoLoginUsername={setAutoLoginUsername}
          setAutoLoginPassword={setAutoLoginPassword}
          currentVersion={currentVersion}
          latestVersionData={latestVersionData}
          setOpenVersionModal={setOpenVersionModal}
        /> :
        <Login
          setIsLogin={setIsLogin}
          loginSession={loginSession}
          autoLoginUsername={autoLoginUsername}
          autoLoginPassword={autoLoginPassword}
          currentVersion={currentVersion}
          latestVersionData={latestVersionData}
          setOpenVersionModal={setOpenVersionModal}
        />
      }

      <Modal
        className="desktop-modal version-modal"
        width={520}
        centered
        open={openVersionModal}
        onCancel={() => setOpenVersionModal(false)}
        footer={<ActionButton variant="primary" onClick={() => setOpenVersionModal(false)}>完成</ActionButton>}
        title="版本信息"
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
            !latestVersionData ? '当前已是最新版本' :
              latestVersionData.version === currentVersion ? (
                `当前已是最新版本：[${currentVersion}](${latestVersionData.url})\n\n` +
                `**更新日志：**\n\n` + `${convertUrlsToMarkdown(latestVersionData.notes)}`
              ) : (
                `发现新版：[${latestVersionData.version}](${latestVersionData.url})\n\n` +
                `**更新日志：**\n\n` + `${convertUrlsToMarkdown(latestVersionData.notes)}`
              )
          }
        </Markdown>
      </Modal>
    </>
  )
}

export default Index
