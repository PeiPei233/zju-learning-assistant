import { useEffect, useState } from 'react'
import { FloatButton, ConfigProvider, theme, App } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { shell } from '@tauri-apps/api';
import { useMediaQuery } from 'react-responsive'
import { invoke } from '@tauri-apps/api'
import Login from './Login'
import Home from './Home'

function Index() {

  const { message, modal, notification } = App.useApp()

  const [isLogin, setIsLogin] = useState(false)
  const isDarkMode = useMediaQuery({
    query: '(prefers-color-scheme: dark)'
  })

  useEffect(() => {
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

    invoke('test_connection').catch((err) => {
      notification.error({
        message: '连接失败',
        description: err.message
      })
    })

  }, [])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
      }}
    >
      <App>
        {isLogin ? <Home setIsLogin={setIsLogin} /> : <Login setIsLogin={setIsLogin} />}
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
