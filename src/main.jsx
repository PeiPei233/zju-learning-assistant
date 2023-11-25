import React from 'react'
import ReactDOM from 'react-dom/client'
import Index from './Index.jsx'
import { App, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN';

ReactDOM.createRoot(document.getElementById('root')).render(
  <ConfigProvider locale={zhCN}>
    <App>
      <Index />
    </App>
  </ConfigProvider>
)
