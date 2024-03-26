import { useEffect, useState } from 'react'
import { FloatButton, ConfigProvider, theme, App } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { shell } from '@tauri-apps/api';
import { useMediaQuery } from 'react-responsive'
import { invoke } from '@tauri-apps/api'
import Login from './Login'
import Home from './Home'
dayjs.locale('zh-cn')

function Index() {

  const { message, modal, notification } = App.useApp()

  const [isLogin, setIsLogin] = useState(false)
  const [autoLoginUsername, setAutoLoginUsername] = useState('')
  const [autoLoginPassword, setAutoLoginPassword] = useState('')
  const isDarkMode = useMediaQuery({
    query: '(prefers-color-scheme: dark)'
  })

  useEffect(() => {
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
    if (import.meta.env.PROD) {
      // disable context menu
      const disableContextMenu = (e) => {
        e.preventDefault()
      }

      document.addEventListener('contextmenu', disableContextMenu)

      return () => {
        document.removeEventListener('contextmenu', disableContextMenu)
      }
    }
  }, [])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
      }}
    >
      <App>
        {isLogin ?
          <Home setIsLogin={setIsLogin} setAutoLoginUsername={setAutoLoginUsername} setAutoLoginPassword={setAutoLoginPassword} /> :
          <Login setIsLogin={setIsLogin} autoLoginUsername={autoLoginUsername} autoLoginPassword={autoLoginPassword} />
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
      </App>
    </ConfigProvider>
  )
}

export default Index
