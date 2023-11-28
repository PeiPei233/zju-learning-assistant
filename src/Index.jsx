import { useState } from 'react'
import { FloatButton, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { shell } from '@tauri-apps/api';
import { useMediaQuery } from 'react-responsive'
import Login from './Login'
import Home from './Home'

function Index() {

  const [isLogin, setIsLogin] = useState(false)
  const isDarkMode = useMediaQuery({
    query: '(prefers-color-scheme: dark)'
  })

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
      }}
    >
      {isLogin ? <Home setIsLogin={setIsLogin} /> : <Login setIsLogin={setIsLogin} />}
      <FloatButton
        icon={<QuestionCircleOutlined />}
        onClick={() => {
          shell.open('https://github.com/PeiPei233/zju-learning-assistant').catch((err) => {
            console.log(err)
          })
        }}
        tooltip='查看帮助'
        type='primary'
      />

    </ConfigProvider>
  )
}

export default Index
