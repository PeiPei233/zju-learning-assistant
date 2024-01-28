import { useState } from 'react'
import { Button, Card, App, Row, Col, Tooltip, Typography, Layout, Radio, DatePicker } from 'antd';
import { invoke } from '@tauri-apps/api'
import { ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import SearchTable from './SearchTable'
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { ClassroomTask } from './downloadManager';

dayjs.locale('zh-cn')

const { Text } = Typography
const { RangePicker } = DatePicker;

export default function Classroom({ addDownloadTasks, toPdf }) {

  const { message, modal, notification } = App.useApp()

  const [selectedDateMethod, setSelectedDateMethod] = useState('week')
  const [leftSubList, setLeftSubList] = useState([])
  const [rightSubList, setRightSubList] = useState([])
  const [selectedLeftKeys, setSelectedLeftKeys] = useState([])
  const [selectedRightKeys, setSelectedRightKeys] = useState([])
  const [loadingLeftSubList, setLoadingLeftSubList] = useState(false)
  const [loadingRightSubList, setLoadingRightSubList] = useState(false)
  const [updatingPath, setUpdatingPath] = useState(false)

  const selectDateMethodOptions = [
    {
      label: '日',
      value: 'day'
    },
    {
      label: '周',
      value: 'week'
    },
    {
      label: '月',
      value: 'month'
    },
  ]

  const changeDateMethod = (value) => {
    setSelectedDateMethod(value.target.value)
  }

  const changeDateRange = (value) => {
    const startAt = selectedDateMethod === 'day' ? value[0].format('YYYY-MM-DD') :
      selectedDateMethod === 'week' ? value.startOf('week').format('YYYY-MM-DD') :
        value.startOf('month').format('YYYY-MM-DD')
    const endAt = selectedDateMethod === 'day' ? value[1].format('YYYY-MM-DD') :
      selectedDateMethod === 'week' ? value.endOf('week').format('YYYY-MM-DD') :
        value.endOf('month').format('YYYY-MM-DD')
    setLoadingLeftSubList(true)
    invoke('get_range_subs', { startAt, endAt }).then((res) => {
      // console.log(res)
      setLeftSubList(res)
      setSelectedLeftKeys([])
    }).catch((err) => {
      notification.error({
        message: '获取课程列表失败',
        description: err
      })
    }).finally(() => {
      setLoadingLeftSubList(false)
    })
  }

  const updateRightSubList = () => {
    let subs = leftSubList.filter((item) => selectedLeftKeys.includes(item.sub_id))
    if (subs.length === 0) {
      notification.error({
        message: '请选择课程',
      })
      return
    }
    setLoadingRightSubList(true)
    invoke('get_sub_ppt_urls', { subs }).then((res) => {
      // console.log(res)
      const subs = res.filter((item) => item.ppt_image_urls.length !== 0)
      if (subs.length === 0) {
        notification.error({
          message: '没有发现智云 PPT',
        })
      }
      setRightSubList(subs)
      setSelectedRightKeys(subs.map((item) => item.sub_id))
    }).catch((err) => {
      notification.error({
        message: '获取课件列表失败',
        description: err
      })
    }).finally(() => {
      setLoadingRightSubList(false)
    })
  }

  const openDownloadPath = () => {
    invoke('open_save_path').then((res) => {
    }).catch((err) => {
      notification.error({
        message: '打开下载路径失败',
        description: err
      })
    })
  }

  const leftColumns = [
    {
      dataIndex: 'course_name',
      title: '课程名称',
    },
    {
      dataIndex: 'sub_name',
      title: '上课时间',
    },
  ];

  const rightColumns = [
    {
      dataIndex: 'sub_name',
      title: '上课时间',
    },
    {
      dataIndex: 'ppt_image_urls',
      title: '页数',
      render: (urls) => {
        return urls.length
      },
      searchable: false
    },
    {
      title: '下载路径',
      dataIndex: 'path',
    }
  ];

  const downloadSubsPPT = () => {
    let subs = rightSubList.filter((item) => selectedRightKeys.includes(item.sub_id))
    if (subs.length === 0) {
      notification.error({
        message: '请选择课件',
      })
      return
    }
    let tasks = subs.map((item) => new ClassroomTask(item, toPdf))
    addDownloadTasks(tasks)
    setRightSubList(rightSubList.filter((item) => !selectedRightKeys.includes(item.sub_id)))
    setSelectedRightKeys([])
  }

  return (
    <div style={{ margin: 20 }}>
      <Card bodyStyle={{ padding: 15 }}>
        <Row align='middle' justify='space-between' gutter={20}>
          <Col xs={12} md={14}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'start',
              flexDirection: 'row'
            }}>
              <Radio.Group
                options={selectDateMethodOptions}
                onChange={changeDateMethod}
                value={selectedDateMethod}
                optionType="button"
                buttonStyle="solid"
                size='small'
                style={{ minWidth: 100 }}
              />
              {selectedDateMethod === 'day' && <RangePicker
                size='small'
                onChange={changeDateRange}
                disabled={loadingLeftSubList}
              />}
              {selectedDateMethod === 'week' && <DatePicker
                picker='week'
                size='small'
                onChange={changeDateRange}
                disabled={loadingLeftSubList}
              />}
              {selectedDateMethod === 'month' && <DatePicker
                picker='month'
                size='small'
                onChange={changeDateRange}
                disabled={loadingLeftSubList}
              />}
            </div>
          </Col>
          <Col xs={12} md={10}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'end',
              flexDirection: 'row'
            }}>
              <Button
                type='primary'
                icon={<DownloadOutlined />}
                onClick={downloadSubsPPT}
                disabled={loadingRightSubList}
              >{'下载课件'}</Button>
            </div>
          </Col>
        </Row>
      </Card>
      <Row gutter={20} style={{ marginTop: 20 }}>
        <Col xs={10} md={9} lg={8}>
          <SearchTable
            rowSelection={{
              selectedRowKeys: selectedLeftKeys,
              onChange: setSelectedLeftKeys,
            }}
            rowKey='sub_id'
            columns={leftColumns}
            dataSource={leftSubList}
            pagination={false}
            scroll={{ y: 'calc(100vh - 270px)' }}
            size='small'
            bordered
            footer={() => ''}
            title={() => `课程列表：已选择 ${selectedLeftKeys.length} 门课程`}
            loading={loadingLeftSubList}
          />
        </Col>
        <Col xs={14} md={15} lg={16}>
          <SearchTable
            rowSelection={{
              selectedRowKeys: selectedRightKeys,
              onChange: setSelectedRightKeys,
            }}
            rowKey='sub_id'
            columns={rightColumns}
            dataSource={rightSubList}
            pagination={false}
            scroll={{ y: 'calc(100vh - 270px)' }}
            size='small'
            bordered
            footer={() => ''}
            loading={loadingRightSubList || updatingPath}
            title={() => {
              return (
                <>
                  {rightSubList && rightSubList.length !== 0 && <Text ellipsis={{ rows: 1, expandable: false, tooltip: true }} style={{ width: 'calc(100% - 80px)' }}>
                    课件列表：已选择 {selectedRightKeys.length} 个课件 共 {rightSubList.filter((item) => selectedRightKeys.includes(item.sub_id)).reduce((total, item) => {
                      return total + item.ppt_image_urls.length
                    }, 0)} 页</Text>}
                  {(rightSubList && rightSubList.length === 0) && '课件列表为空  点击右侧刷新👉'}
                  <div style={{ float: 'right' }}>
                    <Tooltip title='刷新课件列表'>
                      <Button
                        type='text'
                        size='small'
                        icon={<ReloadOutlined />}
                        onClick={updateRightSubList}
                        loading={loadingRightSubList}
                      />
                    </Tooltip>
                  </div>
                </>
              )
            }}
          />
        </Col>
      </Row>
    </div>
  )
}