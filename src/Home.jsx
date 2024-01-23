import { useEffect, useState } from 'react'
import { App, Menu, Layout } from 'antd';
import { invoke } from '@tauri-apps/api'
import { LogoutOutlined } from '@ant-design/icons';
import Learning from './Learning'
import Classroom from './Classroom'
import Score from './Score'
import LearningSync from './LearningSync'
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

dayjs.locale('zh-cn')

const { Header, Content, Footer, Sider } = Layout;

export default function Home({ setIsLogin }) {

  const { message, modal, notification } = App.useApp()
  const [downloading, setDownloading] = useState(false)
  const [current, setCurrent] = useState('learning-ppt')

  useEffect(() => {
    invoke('check_login').then((res) => {
      if (!res) {
        setIsLogin(false)
      }
    }).catch((err) => {
      setIsLogin(false)
    })
  }, [])

  const logout = () => {
    invoke('logout').then((res) => {
      setIsLogin(false)
    }).catch((err) => {
      notification.error({
        message: '退出登录失败',
        description: err
      })
    })
  }

  const menuItems = [
    {
      key: 'learning',
      label: '学在浙大',
      icon: <img src='https://course.zju.edu.cn/static/favicon.ico' style={{ width: 14 }} />,
      children: [
        {
          key: 'learning-ppt',
          label: '课件下载',
        },
        {
          key: 'learning-sync',
          label: '课件同步',
        }
      ]
    },
    {
      key: 'classroom',
      label: '智云课堂',
      icon: <img src='https://resource.cmc.zju.edu.cn/play/0/f18b8f4ee40bcd0765cfe987ca82046e/2022/08/31/fc9355e0290811ed97c77ab369543ec1.png' style={{ width: 14 }} />
    },
    {
      key: 'score',
      label: '成绩查询',
      icon: <img src='http://zdbk.zju.edu.cn/zftal-ui-v5-1.0.2-zjdx/assets/images/zjdx_ico/icon_dbxxck.png' style={{ width: 14 }} />
    }
  ]

  const logoutItem = [
    {
      key: 'logout',
      label: '退出登录',
      icon: <LogoutOutlined />
    }
  ]

  const onMenuClick = ({ key }) => {
    console.log(key)
    setCurrent(key)
  }

  return (
    <Layout className='home-layout'>
      <Header className='home-layout' style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        height: 40,
        marginBottom: 10
      }}>
        <Menu
          onClick={onMenuClick}
          selectedKeys={[current]}
          mode="horizontal"
          items={menuItems}
          style={{ width: '100%', lineHeight: '40px' }}
          disabled={downloading}
        />
        <Menu
          onClick={logout}
          mode="horizontal"
          style={{ float: 'right', lineHeight: '40px', minWidth: 112 }}
          disabled={downloading}
        >
          <Menu.Item key='logout' icon={<LogoutOutlined />}>
            退出登录
          </Menu.Item>
        </Menu>
      </Header>
      <Content>
        {current === 'learning-ppt' && <Learning downloading={downloading} setDownloading={setDownloading} />}
        {current === 'classroom' && <Classroom downloading={downloading} setDownloading={setDownloading} />}
        {current === 'score' && <Score downloading={downloading} setDownloading={setDownloading} />}
        {current === 'learning-sync' && <LearningSync downloading={downloading} setDownloading={setDownloading} />}
      </Content>
    </Layout>
  )
}