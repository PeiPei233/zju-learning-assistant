import { useEffect, useState } from 'react'
import { Form, Input, Button, Card, App, Typography } from 'antd';
import { invoke } from '@tauri-apps/api'
import { UserOutlined, LockOutlined } from '@ant-design/icons';

const { Text } = Typography

export default function Login({ setIsLogin }) {

  const [form] = Form.useForm()
  const { message, modal, notification } = App.useApp()

  const [loading, setLoading] = useState(false)

  useEffect(() => {
    invoke('check_login').then((res) => {
      if (res) {
        setIsLogin(true)
      }
    }).catch((err) => {

    })
  })

  const onFinish = async (values) => {
    setLoading(true)
    invoke('login', { username: values.username, password: values.password })
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
      height: '90vh',
      flexDirection: 'column'
    }}>
      <h1>浙江大学统一身份认证登录</h1>
      <Card style={{
        width: 300,
        marginTop: 20
      }}>
        <Form
          name="normal_login"
          className="login-form"
          initialValues={{ remember: true }}
          onFinish={onFinish}
          form={form}
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入学号!' }]}
          >
            <Input prefix={<UserOutlined className="site-form-item-icon" />} placeholder="学号" />
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

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              style={{
                width: '100%'
              }}
            >
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
      <Text type='secondary' style={{
        marginTop: 20
      }}>Made by PeiPei</Text>
      <Text type='secondary'>此软件仅供学习交流使用，严禁用于商业用途</Text>
    </div>
  )
}