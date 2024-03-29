import { useEffect, useState } from 'react'
import { Form, Input, Button, Card, App, Typography, Badge, Modal, Checkbox } from 'antd';
import { invoke } from '@tauri-apps/api'
import { shell } from '@tauri-apps/api'
import { getVersion } from '@tauri-apps/api/app';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import Markdown from 'react-markdown';
import { listen } from '@tauri-apps/api/event';
import { exit } from '@tauri-apps/api/process';

const { Text, Paragraph } = Typography

function convertUrlsToMarkdown(text) {
  const markdownLinkRegex = /\[([^\]]*)\]\((http[s]?:\/\/[^\s\[\]()]+)\)/g;
  let placeholders = [];
  let currentIndex = 0;
  let newText = text.replace(markdownLinkRegex, (match) => {
    placeholders.push(match);
    return `<<${currentIndex++}>>`;
  });

  const urlRegex = /http[s]?:\/\/[^\s\[\]()]+/g;
  newText = newText.replace(urlRegex, (match) => `[${match}](${match})`);

  placeholders.forEach((placeholder, index) => {
    newText = newText.replace(`<<${index}>>`, placeholder);
  });

  return newText;
}

export default function Login({ setIsLogin, autoLoginUsername, autoLoginPassword }) {

  const [form] = Form.useForm()
  const { message, modal, notification } = App.useApp()
  const [currentVersion, setCurrentVersion] = useState('')
  const [latestVersionData, setLatestVersionData] = useState(null)
  const [openVersionModal, setOpenVersionModal] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    invoke('check_login').then((res) => {
      if (res) {
        setIsLogin(true)
      }
    }).catch((err) => { })
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
    }).catch((err) => { })

    const unlistenClose = listen('close-requested', () => {
      exit(0)
    })

    return () => {
      unlistenClose.then((fn) => fn())
    }
  }, [])

  useEffect(() => {
    if (autoLoginUsername && autoLoginPassword) {
      notification.info({
        message: `正在自动登录 ${autoLoginUsername}...`,
      })
      form.setFieldsValue({ username: autoLoginUsername, password: autoLoginPassword, remember: true })
      onFinish({ username: autoLoginUsername, password: autoLoginPassword, remember: true })
    }
  }, [autoLoginUsername, autoLoginPassword])

  const onFinish = async (values) => {
    setLoading(true)
    invoke('login', { username: values.username, password: values.password, autoLogin: values.remember })
      .then((res) => {
        setIsLogin(true)
      }).catch((err) => {
        notification.error({
          message: '登录失败',
          description: err
        })
      }).finally(() => {
        setLoading(false)
      })
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      flexDirection: 'column'
    }}>
      <h1>浙江大学统一身份认证登录</h1>
      <Card
        style={{
          width: 300,
          marginTop: 20
        }}
        styles={{ body: { padding: '24px 24px 0 24px' } }}
      >
        <Form
          name="normal_login"
          className="login-form"
          onFinish={onFinish}
          form={form}
          initialValues={{
            username: autoLoginUsername,
            password: autoLoginPassword,
            remember: true
          }}
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入学号!' }]}
          >
            <Input
              prefix={<UserOutlined className="site-form-item-icon" />}
              placeholder="学号"
            />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码!' }]}
          >
            <Input
              prefix={<LockOutlined className="site-form-item-icon" />}
              type="password"
              placeholder="密码"
            />
          </Form.Item>
          <Form.Item
            name="remember"
            valuePropName="checked"
          >
            <Checkbox>下次自动登录</Checkbox>
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              style={{ width: '100%' }}
            >
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
      <Text type='secondary' style={{ marginTop: 30 }}>Made by PeiPei</Text>
      <Text type='secondary'>此软件仅供学习交流使用，严禁用于商业用途</Text>
      <div style={{
        position: 'absolute',
        top: 20,
        right: 40
      }}>
        <a onClick={() => setOpenVersionModal(true)}>
          <Badge count={(!latestVersionData || (latestVersionData && latestVersionData.tag_name === currentVersion) ? 0 : 'New')} size='small'>
            <Text type='secondary'>当前版本：{currentVersion}</Text>
          </Badge>
        </a>
      </div>
      <Modal
        centered
        open={openVersionModal}
        onCancel={() => setOpenVersionModal(false)}
        footer={null}
        title={'ZJU Learning Assistant ' + currentVersion}
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
    </div>
  )
}