import React, { useEffect, useState } from 'react'
import { Form, Input, Button, Card, App, Typography, Badge, Checkbox, theme } from 'antd';
import { invoke } from '@tauri-apps/api/core'
import { UserOutlined, LockOutlined, LoadingOutlined } from '@ant-design/icons';
import { listen } from '@tauri-apps/api/event';
import { exit } from '@tauri-apps/plugin-process';

const { Text } = Typography

interface LoginProps {
  setIsLogin: (isLogin: boolean) => void;
  autoLoginUsername?: string;
  autoLoginPassword?: string;
  currentVersion: string;
  latestVersionData: any;
  setOpenVersionModal: (open: boolean) => void;
}

export default function Login({ 
  setIsLogin, 
  autoLoginUsername, 
  autoLoginPassword, 
  currentVersion, 
  latestVersionData, 
  setOpenVersionModal 
}: LoginProps) {

  const { token } = theme.useToken()
  const { notification } = App.useApp()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [autoLogin, setAutoLogin] = useState(false)

  useEffect(() => {
    invoke<boolean>('check_login').then((res) => {
      if (res) {
        setIsLogin(true)
      }
    }).catch(() => { })

    const unlistenClose = listen('close-requested', () => {
      exit(0)
    })

    return () => {
      unlistenClose.then((fn) => fn())
    }
  }, [setIsLogin])

  useEffect(() => {
    if (autoLoginUsername && autoLoginPassword) {
      setAutoLogin(true)
      invoke('login', { username: autoLoginUsername, password: autoLoginPassword, autoLogin: true })
        .then(() => {
          setIsLogin(true)
        }).catch((err) => {
          notification.error({
            message: '自动登录失败',
            description: String(err)
          })
        }).finally(() => {
          setAutoLogin(false)
        })
    }
  }, [autoLoginUsername, autoLoginPassword, setIsLogin, notification])

  const onFinish = async (values: any) => {
    setLoading(true)
    invoke('login', { username: values.username, password: values.password, autoLogin: values.remember })
      .then(() => {
        setIsLogin(true)
      }).catch((err) => {
        notification.error({
          message: '登录失败',
          description: String(err)
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
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: token.colorBgContainer,
          borderRadius: 8,
          display: autoLogin ? 'flex' : 'none',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <LoadingOutlined style={{ fontSize: 36, color: token.colorPrimary }} />
          <Text style={{ marginTop: 24 }}>正在自动登录 {autoLoginUsername} ...</Text>
        </div>
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
    </div>
  )
}