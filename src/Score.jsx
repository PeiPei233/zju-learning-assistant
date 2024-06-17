import { useState, useEffect } from 'react'
import { useMediaQuery } from 'react-responsive';
import { Button, Card, App, Typography, Input, Switch, Tooltip } from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import SearchTable from './SearchTable'
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

dayjs.locale('zh-cn')

const { Text } = Typography

export default function Score({
  notify,
  lastSync,
  totalGp,
  totalCredit,
  loading,
  score,
  handleSwitch,
  handleSync
}) {

  const { message, modal, notification } = App.useApp()

  const [selectedXkkh, setSelectedXkkh] = useState([])
  const [selectedTotalGp, setSelectedTotalGp] = useState(0)
  const [selectedTotalCredit, setSelectedTotalCredit] = useState(0)
  const max770 = useMediaQuery({ query: '(max-width: 770px)' })

  useEffect(() => {
    handleSync()
  }, [])

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
      width: max770 ? 113 : undefined,
      sorter: (a, b) => a.kcmc.localeCompare(b.kcmc),
    },
    {
      title: '成绩',
      dataIndex: 'cj',
      width: 65,
      searchable: false,
      sorter: (a, b) => {
        if (isNaN(parseInt(a.cj)) || isNaN(parseInt(b.cj))) {
          return a.cj.localeCompare(b.cj)
        }
        return parseInt(a.cj) - parseInt(b.cj)
      }
    },
    {
      title: '学分',
      dataIndex: 'xf',
      width: 65,
      searchable: false,
      sorter: (a, b) => {
        if (isNaN(parseFloat(a.xf)) || isNaN(parseFloat(b.xf))) {
          return a.xf.localeCompare(b.xf)
        }
        return parseFloat(a.xf) - parseFloat(b.xf)
      }
    },
    {
      title: '绩点',
      dataIndex: 'jd',
      width: 65,
      searchable: false,
      sorter: (a, b) => {
        if (isNaN(parseFloat(a.jd)) || isNaN(parseFloat(b.jd))) {
          return a.jd.localeCompare(b.jd)
        }
        return parseFloat(a.jd) - parseFloat(b.jd)
      }
    },
    {
      title: '补考成绩',
      dataIndex: 'bkcj',
      width: 80,
      searchable: false
    },
  ]

  const onSelectChange = (selectedRowKeys, selectedRows) => {
    setSelectedXkkh(selectedRowKeys)
    let totalGp = 0
    let totalCredit = 0
    selectedRows.forEach(row => {
      if (row.cj !== '合格' && row.cj !== '不合格' && row.cj !== '弃修') {
        totalGp += parseFloat(row.jd) * parseFloat(row.xf)
        totalCredit += parseFloat(row.xf)
      }
    })
    setSelectedTotalGp(totalGp)
    setSelectedTotalCredit(totalCredit)
  }

  return (
    <div style={{ margin: 20 }}>
      <Card styles={{ body: { padding: 15 } }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }} >
          <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'row' }}>
            <Text style={{ minWidth: 115 }}>自动同步并提醒：</Text>
            <Tooltip title={notify ? '成绩推送已开启，将自动同步最新成绩并在成绩更新时提醒' : '成绩推送已关闭，开启后将自动同步最新成绩并在成绩更新时提醒'}>
              <Switch loading={loading} checked={notify} onChange={handleSwitch} />
            </Tooltip>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'row', marginLeft: 20 }}>
            <Button type='primary' icon={<SyncOutlined />} loading={loading} onClick={handleSync}>{loading ? '正在同步' : '立即同步'}</Button>
          </div>
        </div>
      </Card>
      <SearchTable
        rowSelection={{
          selectedRowKeys: selectedXkkh,
          onChange: onSelectChange,
        }}
        columns={columns}
        dataSource={score}
        rowKey='xkkh'
        pagination={false}
        scroll={{ y: 'calc(100vh - 255px)' }}
        size='small'
        bordered
        footer={() => selectedXkkh.length ? `最后同步时间：${lastSync ? lastSync : '未同步'}，已选 ${selectedXkkh.length} 条记录，已选总绩点 ${(
          selectedTotalCredit === 0 ? 0 : selectedTotalGp / selectedTotalCredit
        ).toFixed(2)}，已选总学分 ${selectedTotalCredit.toFixed(2)}` :
          `最后同步时间：${lastSync ? lastSync : '未同步'}，共 ${score.length} 条记录，总绩点 ${(
            totalCredit === 0 ? 0 : totalGp / totalCredit
          ).toFixed(2)}，总学分 ${totalCredit.toFixed(2)}`}
        style={{ marginTop: 20 }}
        loading={loading}
      />
    </div>
  )
}