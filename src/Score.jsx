import { useEffect, useState, useRef } from 'react'
import { Button, Card, App, Row, Col, Progress, Tooltip, Typography, Menu, Layout, Radio, DatePicker, Checkbox, Input, Switch, Table } from 'antd';
import { invoke } from '@tauri-apps/api'
import { ReloadOutlined } from '@ant-design/icons';
import { listen } from '@tauri-apps/api/event'
import { dialog, shell } from '@tauri-apps/api';
import { formatTime } from './utils'
import SearchTable from './SearchTable'
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

dayjs.locale('zh-cn')

const { Text } = Typography
const { RangePicker } = DatePicker;

export default function Score({ downloading, setDownloading }) {

  const { message, modal, notification } = App.useApp()

  const [score, setScore] = useState([])
  const [loading, setLoading] = useState(true)
  const [dingUrl, setDingUrl] = useState('')
  const [notify, setNotify] = useState(false)
  const [lastSync, setLastSync] = useState(null)

  const syncTimer = useRef(null)

  function notifyUpdate(item, oldTotalGp, oldTotalCredit, totalGp, totalCredit) {
    // if (!notify) {
    //   return
    // }
    invoke('notify_score', {
      score: item,
      oldTotalGp,
      oldTotalCredit,
      totalGp,
      totalCredit,
      dingUrl
    }).catch((err) => {
      notification.error({
        message: '发送通知失败',
        description: err
      })
    })
  }

  function handleScoreChange(oldScore, newScore) {
    // if (!notify) {
    //   return
    // }

    let totalGp = 0
    let totalCredit = 0

    // calculate totalGp and totalCredit of oldScore
    oldScore.forEach((item) => {
      if (item.cj !== '合格' && item.cj !== '不合格' && item.cj !== '弃修') {
        totalGp += parseFloat(item.jd) * parseFloat(item.xf)
        totalCredit += parseFloat(item.xf)
      }
    })

    // enumerate newScore to find new score
    newScore.forEach((item) => {
      const oldItem = oldScore.find((oldItem) => oldItem.xkkh === item.xkkh)
      if (oldItem) {
        if (oldItem.cj !== item.cj || oldItem.bkcj !== item.bkcj || oldItem.jd !== item.jd || oldItem.xf !== item.xf) {
          // if the course is in oldScore and the score has changed
          let oldTotalGp = totalGp
          let oldTotalCredit = totalCredit
          if (item.cj !== '合格' && item.cj !== '不合格' && item.cj !== '弃修') {
            totalGp += parseFloat(item.jd) * parseFloat(item.xf) - parseFloat(oldItem.jd) * parseFloat(oldItem.xf)
            totalCredit += parseFloat(item.xf) - parseFloat(oldItem.xf)
          }
          notifyUpdate(item, oldTotalGp, oldTotalCredit, totalGp, totalCredit)
        }
      } else {
        // if the course is not in oldScore
        let oldTotalGp = totalGp
        let oldTotalCredit = totalCredit
        if (item.cj !== '合格' && item.cj !== '不合格' && item.cj !== '弃修') {
          totalGp += parseFloat(item.jd) * parseFloat(item.xf)
          totalCredit += parseFloat(item.xf)
        }
        notifyUpdate(item, oldTotalGp, oldTotalCredit, totalGp, totalCredit)
      }
    })
  }

  // sync every 3 to 5 minutes
  const startSync = () => {
    const syncFunc = () => {
      setLoading(true)
      invoke('get_score').then((res) => {
        const oldScore = score
        setScore(res)
        handleScoreChange(oldScore, res)
        setLastSync(dayjs().format('YYYY-MM-DD HH:mm:ss'))
      }).catch((err) => {
        notification.error({
          message: '成绩同步失败',
          description: err
        })
      }).finally(() => {
        const nextSync = Math.floor(Math.random() * 120000) + 180000
        syncTimer.current = setTimeout(syncFunc, nextSync)
        setLoading(false)
      })
    }
    syncFunc()
  }

  const stopSync = () => {
    clearTimeout(syncTimer.current)
    syncTimer.current = null
  }


  useEffect(() => {
    invoke('get_score').then((res) => {
      const oldScore = score
      setScore(res)
      handleScoreChange(oldScore, res)
      setLastSync(dayjs().format('YYYY-MM-DD HH:mm:ss'))
    }).catch((err) => {
      notification.error({
        message: '获取成绩失败',
        description: err
      })
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const handleSync = () => {
    setLoading(true)
    invoke('get_score').then((res) => {
      const oldScore = score
      setScore(res)
      handleScoreChange(oldScore, res)
      setLastSync(dayjs().format('YYYY-MM-DD HH:mm:ss'))
      notification.success({
        message: '成绩同步成功',
      })
    }).catch((err) => {
      notification.error({
        message: '成绩同步失败',
        description: err
      })
    }).finally(() => {
      setLoading(false)
    })
  }

  const handleSwitch = (checked) => {
    setNotify(checked)
    if (checked) {
      startSync()
    } else {
      stopSync()
    }
  }

  const columns = [
    {
      title: '选课课号',
      dataIndex: 'xkkh',
      width: '39%',
      sorter: (a, b) => a.xkkh.localeCompare(b.xkkh),
    },
    {
      title: '课程名称',
      dataIndex: 'kcmc',
      sorter: (a, b) => a.kcmc.localeCompare(b.kcmc),
    },
    {
      title: '成绩',
      dataIndex: 'cj',
      width: 65,
      searchable: false,
      sorter: (a, b) => a.cj.localeCompare(b.cj),
    },
    {
      title: '学分',
      dataIndex: 'xf',
      width: 65,
      searchable: false,
      sorter: (a, b) => a.cj.localeCompare(b.cj),
    },
    {
      title: '绩点',
      dataIndex: 'jd',
      width: 65,
      searchable: false,
      sorter: (a, b) => a.cj.localeCompare(b.cj),
    },
    {
      title: '补考成绩',
      dataIndex: 'bkcj',
      width: 80,
      searchable: false
    },
  ]

  return (
    <div style={{ margin: 20 }}>
      <Card bodyStyle={{ padding: 15 }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',

        }}
        >
          <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'row' }}>
            <Text style={{ minWidth: 115 }}>钉钉 Webhook：</Text>
            <Input value={dingUrl} onChange={(e) => setDingUrl(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'row', marginLeft: 20 }}>
            <Text style={{ minWidth: 115 }}>自动同步并提醒：</Text>
            <Switch loading={loading} checked={notify} onChange={handleSwitch} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'row', marginLeft: 20 }}>
            <Button type='primary' icon={<ReloadOutlined />} loading={loading} onClick={handleSync}>立即同步</Button>
          </div>
        </div>
      </Card>
      <SearchTable
        columns={columns}
        dataSource={score}
        rowKey='xkkh'
        pagination={false}
        scroll={{ y: 'calc(100vh - 255px)' }}
        size='small'
        bordered
        footer={() => `最后同步时间：${lastSync ? lastSync : '未同步'}，共 ${score.length} 条记录`}
        style={{ marginTop: 20 }}
        loading={loading}
      />
    </div>
  )
}