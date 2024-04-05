import { useEffect, useState } from 'react'
import { FloatButton, Modal, App, Typography } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { shell } from '@tauri-apps/api';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api'
import Login from './Login'
import Home from './Home'
import Markdown from 'react-markdown';
import { convertUrlsToMarkdown } from './utils';
dayjs.locale('zh-cn')

function Index() {

  const { message, modal, notification } = App.useApp()
  const { Paragraph, Text } = Typography

  const [isLogin, setIsLogin] = useState(false)
  const [autoLoginUsername, setAutoLoginUsername] = useState('')
  const [autoLoginPassword, setAutoLoginPassword] = useState('')
  const [currentVersion, setCurrentVersion] = useState('')
  const [latestVersionData, setLatestVersionData] = useState(null)
  const [openVersionModal, setOpenVersionModal] = useState(false)

  useEffect(() => {
    getVersion().then((current) => {
      setCurrentVersion('v' + current)
      invoke('get_latest_version_info').then((res) => {
        // console.log(res)
        const data = res
        if (!data) throw new Error('获取最新版本信息失败')
        if (!data.tag_name) throw new Error(JSON.stringify(data))
        if (data.tag_name !== 'v' + current) {
          notification.info({
            message: '发现新版本',
            description: `当前版本：${'v' + current}，最新版本：${data.tag_name}`
          })
        }
        setLatestVersionData(data)
      }).catch((err) => {
        console.log(err)
      })
    })
    invoke('get_auto_login_info').then((res) => {
      if (res) {
        setAutoLoginUsername(res[0])
        setAutoLoginPassword(res[1])
      }
    })
    invoke('test_connection').catch((err) => {
      notification.error({
        message: '连接失败',
        description: err.message
      })
    })
  }, [])

  return (
    <>
      {isLogin ?
        <Home setIsLogin={setIsLogin} setAutoLoginUsername={setAutoLoginUsername} setAutoLoginPassword={setAutoLoginPassword} currentVersion={currentVersion} latestVersionData={latestVersionData} setOpenVersionModal={setOpenVersionModal} /> :
        <Login setIsLogin={setIsLogin} autoLoginUsername={autoLoginUsername} autoLoginPassword={autoLoginPassword} currentVersion={currentVersion} latestVersionData={latestVersionData} setOpenVersionModal={setOpenVersionModal} />
      }
      <FloatButton
        icon={<QuestionCircleOutlined />}
        onClick={() => {
          shell.open('https://github.com/PeiPei233/zju-learning-assistant').catch((err) => {
            notification.error({
              message: '打开帮助失败',
              description: err.message
            })
          })
        }}
        tooltip='查看帮助'
        type='primary'
      />

      <Modal
        centered
        open={openVersionModal}
        onCancel={() => setOpenVersionModal(false)}
        footer={null}
        title={'ZJU Learning Assistant ' + currentVersion}
        zIndex={1001}
      >
        <Markdown components={{
          a({ node, href, ...props }) {
            return <a
              {...props}
              onClick={() => {
                shell.open(href).catch((err) => {
                  notification.error({
                    message: '打开链接失败',
                    description: err
                  })
                })
              }}
            />
          },
          pre({ node, ...props }) {
            return <Paragraph>
              <pre {...props} />
            </Paragraph>
          },
          code({ node, ...props }) {
            return <Text code {...props} />
          }
        }}>
          {
            !latestVersionData ? '当前已是最新版本' :
              latestVersionData.tag_name === currentVersion ? (
                `当前已是最新版本：[${currentVersion}](${latestVersionData.html_url})\n\n` +
                `**更新日志：**\n\n` + `${convertUrlsToMarkdown(latestVersionData.body)}`
              ) : (
                `发现新版：[${latestVersionData.tag_name}](${latestVersionData.html_url})\n\n` +
                `**更新日志：**\n\n` + `${convertUrlsToMarkdown(latestVersionData.body)}`
              )
          }
        </Markdown>
      </Modal>
    </>
  )
}

export default Index
