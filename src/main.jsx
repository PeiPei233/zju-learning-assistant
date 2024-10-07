import { useEffect } from 'react'
import { ConfigProvider, App, theme } from 'antd'
import { createRoot } from 'react-dom/client'
import { useMediaQuery } from 'react-responsive'
import zhCN from 'antd/locale/zh_CN';
import Index from './Index.jsx'
import './global.css'

export function Main() {

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
  }, [])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          fontFamily: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'"
        },
        components: {
          Radio: {
            buttonPaddingInline: 10
          }
        }
      }}
    >
      <App>
        <Index />
      </App>
    </ConfigProvider>
  )
}

createRoot(document.getElementById('root')).render(
  <Main />
)
