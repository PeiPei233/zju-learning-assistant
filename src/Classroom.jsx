import { useEffect, useState, useRef } from 'react'
import { Button, Card, App, Row, Col, Progress, Tooltip, Typography, Menu, Layout, Radio, DatePicker, Checkbox } from 'antd';
import { invoke } from '@tauri-apps/api'
import { ReloadOutlined, DownloadOutlined, CloseCircleOutlined, EditOutlined, ExportOutlined, LogoutOutlined } from '@ant-design/icons';
import { listen } from '@tauri-apps/api/event'
import { dialog, shell } from '@tauri-apps/api';
import { formatTime } from './utils'
import SearchTable from './SearchTable'
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

dayjs.locale('zh-cn')

const { Text } = Typography
const { Header, Content, Footer, Sider } = Layout;
const { RangePicker } = DatePicker;

export default function Classroom({ downloading, setDownloading }) {

  const { message, modal, notification } = App.useApp()

  const [selectedDateMethod, setSelectedDateMethod] = useState('week')
  const [printPDF, setPrintPDF] = useState(true)
  const [leftSubList, setLeftSubList] = useState([])
  const [rightSubList, setRightSubList] = useState([])
  const [selectedLeftKeys, setSelectedLeftKeys] = useState([])
  const [selectedRightKeys, setSelectedRightKeys] = useState([])
  const [loadingLeftSubList, setLoadingLeftSubList] = useState(false)
  const [loadingRightSubList, setLoadingRightSubList] = useState(false)
  const [updatingPath, setUpdatingPath] = useState(false)
  const latestProgress = useRef({
    status: null,
    file_name: null,
    downloaded_size: 0,
    total_size: 0,
    current: 0,
    total: 0
  })
  const startTime = useRef(Date.now())
  const lastDownloadedSize = useRef(0)
  const startDownloadTime = useRef(0)
  const [downloadDescription, setDownloadDescription] = useState('下载进度')
  const [downloadPercent, setDownloadPercent] = useState(0)
  const [timeRemaining, setTimeRemaining] = useState(0)
  const [downloadedSize, setDownloadedSize] = useState(0)
  const [totalSize, setTotalSize] = useState(0)

  useEffect(() => {
    const unlisten = listen('download-progress', (res) => {
      // console.log(res.payload)
      const progress = res.payload
      latestProgress.current = progress
      setTotalSize(progress.total_size)
      setDownloadDescription(
        progress.status === 'downloading' ? `正在下载 ${progress.current}/${progress.total} | ${progress.file_name}` :
          progress.status === 'done' ? '下载完成' :
            progress.status === 'cancel' ? '下载已取消' :
              progress.status === 'writing' ? `正在导出 PDF ${progress.current}/${progress.total} | ${progress.file_name}` : '下载进度'
      )
    })

    const updateProgress = setInterval(() => {
      const currentTime = Date.now()
      const elapsedTime = currentTime - startTime.current
      if (elapsedTime > 0) {
        const totalSpeed = latestProgress.current.downloaded_size / (currentTime - startDownloadTime.current) * 1000
        const newTimeRemaining = (latestProgress.current.total_size - latestProgress.current.downloaded_size) / totalSpeed
        const newDownloadPercent = latestProgress.current.downloaded_size / latestProgress.current.total_size * 100
        if (!isNaN(totalSpeed) && isFinite(newTimeRemaining)) {
          setTimeRemaining(newTimeRemaining)
          setDownloadPercent(newDownloadPercent)
          setDownloadedSize(latestProgress.current.downloaded_size)
          startTime.current = currentTime
          lastDownloadedSize.current = latestProgress.current.downloaded_size
        }
      }
    }, 1000);

    return () => {
      unlisten.then((fn) => fn())
      clearInterval(updateProgress)
    }

  }, [])

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
      console.log(res)
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

  const changePrintPDF = (value) => {
    // console.log(value)
    setPrintPDF(value.target.checked)
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

  const updatePath = () => {
    dialog.open({
      directory: true,
      multiple: false,
      message: '选择下载路径'
    }).then((res) => {
      if (res && res.length !== 0) {
        setUpdatingPath(true)
        invoke('update_path', { path: res, uploads: rightSubList }).then((res) => {
          // console.log(res)
          notification.success({
            message: '下载路径修改成功',
          })
          setRightSubList(res)
        }).catch((err) => {
          notification.error({
            message: '下载路径修改失败',
            description: err
          })
        }).finally(() => {
          setUpdatingPath(false)
        })
      }
    }).catch((err) => {
      notification.error({
        message: '下载路径修改失败',
        description: err
      })
    })
  }

  const cancelDownload = () => {
    invoke('cancel_download').then((res) => {
      // console.log(res)
      setDownloading(false)
    }).catch((err) => {
      notification.error({
        message: '取消下载失败',
        description: err
      })
    })
  }

  const downloadSubsPPT = () => {
    let subs = rightSubList.filter((item) => selectedRightKeys.includes(item.sub_id))
    if (subs.length === 0) {
      notification.error({
        message: '请选择课件',
      })
      return
    }
    setDownloading(true)
    setDownloadedSize(0)
    setTotalSize(0)
    startTime.current = Date.now()
    startDownloadTime.current = Date.now()
    lastDownloadedSize.current = 0
    setDownloadPercent(0)
    setTimeRemaining(Infinity)
    setDownloadDescription('正在下载')
    invoke('download_ppts', { subs: subs, toPdf: printPDF }).then((res) => {
      // console.log(res)
      if (res.length === selectedRightKeys.length) {
        notification.success({
          message: '下载完成',
        })
        setDownloadPercent(100)
      }
      let haveDownloaded = res.map((item) => item.sub_id)
      setSelectedRightKeys(selectedRightKeys.filter((item) => !haveDownloaded.includes(item)))
      setRightSubList(rightSubList.filter((item) => !haveDownloaded.includes(item.sub_id)))
      latestProgress.current = {
        status: null,
        file_name: null,
        downloaded_size: 0,
        total_size: 0,
        current: 0,
        total: 0
      }
      lastDownloadedSize.current = 0
      setDownloadedSize(0)
      setTotalSize(0)
    }).catch((err) => {
      notification.error({
        message: '下载失败',
        description: err
      })
      setDownloadDescription(`下载失败：${err}`)
    }).finally(() => {
      setDownloading(false)
    })
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
              <Checkbox style={{ marginRight: 10 }} onChange={changePrintPDF} checked={printPDF} disabled={downloading}>导出为 PDF</Checkbox>
              <Button
                type='primary'
                icon={downloading ? <CloseCircleOutlined /> : <DownloadOutlined />}
                onClick={downloading ? cancelDownload : downloadSubsPPT}
                disabled={loadingRightSubList}
              >{downloading ? '取消下载' : '下载课件'}</Button>
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
            scroll={{ y: 'calc(100vh - 335px)' }}
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
            scroll={{ y: '100vh' }}
            size='small'
            bordered
            footer={() => ''}
            loading={loadingRightSubList || downloading || updatingPath}
            title={() => {
              return (
                <>
                  {rightSubList && rightSubList.length !== 0 && <Text ellipsis={{ rows: 1, expandable: false }} style={{ width: 'calc(100% - 80px)' }}>
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
                        disabled={downloading}
                      />
                    </Tooltip>
                    <Tooltip title='修改下载路径'>
                      <Button
                        type='text'
                        size='small'
                        icon={<EditOutlined />}
                        onClick={updatePath}
                      />
                    </Tooltip>
                    <Tooltip title='打开下载路径'>
                      <Button
                        type='text'
                        size='small'
                        icon={<ExportOutlined />}
                        onClick={openDownloadPath}
                      />
                    </Tooltip>
                  </div>
                </>
              )
            }}
          />
        </Col>
      </Row>
      <Text
        ellipsis={{
          rows: 1,
          expandable: false,
        }}
        style={{
          position: 'absolute',
          left: 20,
          bottom: 40,
          width: 'calc(50% - 20px)'
        }}>{downloadDescription}</Text>
      <Text
        ellipsis={{
          rows: 1,
          expandable: false,
        }}
        style={{
          position: 'absolute',
          right: 70,
          bottom: 40,
          width: 'calc(50% - 70px)',
          textAlign: 'right'
        }}>{downloading && totalSize && totalSize !== 0 && !isNaN(totalSize) && !isNaN(timeRemaining) && isFinite(timeRemaining) ? `PPTs: ${downloadedSize}/${totalSize} | 预计剩余 ${formatTime(timeRemaining)}` : ''}</Text>
      <Progress percent={downloadPercent}
        format={(percent) => Math.floor(percent) + '%'}
        style={{
          position: 'absolute',
          bottom: 10,
          left: 20,
          width: 'calc(100% - 40px)'
        }} />
    </div>
  )
}