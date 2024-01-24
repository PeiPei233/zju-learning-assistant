import { useEffect, useState, useRef } from 'react'
import { Form, Button, Card, App, Row, Col, Progress, Tooltip, Typography, Switch, Radio } from 'antd';
import { invoke } from '@tauri-apps/api'
import { ReloadOutlined, DownloadOutlined, CloseCircleOutlined, EditOutlined, ExportOutlined } from '@ant-design/icons';
import { listen } from '@tauri-apps/api/event'
import { dialog, shell } from '@tauri-apps/api';
import { bytesToSize, formatTime } from './utils'
import SearchTable from './SearchTable'
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

dayjs.locale('zh-cn')

const { Text } = Typography

export default function LearningSync({ downloading, setDownloading }) {
  const { message, modal, notification } = App.useApp()

  const [courseList, setCourseList] = useState([])
  const [loadingCourseList, setLoadingCourseList] = useState(false)
  const [selectedCourses, setSelectedCourses] = useState([])
  const [selectedCourseKeys, setSelectedCourseKeys] = useState([])
  const [loadingUploadList, setLoadingUploadList] = useState(false)
  const [uploadList, setUploadList] = useState([])
  const [selectedUploadKeys, setSelectedUploadKeys] = useState([])
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
  const [speed, setSpeed] = useState(0)
  const [timeRemaining, setTimeRemaining] = useState(0)
  const [downloadedSize, setDownloadedSize] = useState(0)
  const [totalSize, setTotalSize] = useState(0)
  const [selectedSyncOption, setSelectedSyncOption] = useState('sync')
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [downloadingSync, setDownloadingSync] = useState(false)

  const syncTimer = useRef(null)
  const selectedCourseKeysRef = useRef(selectedCourseKeys)

  useEffect(() => {
    selectedCourseKeysRef.current = selectedCourseKeys
  }, [selectedCourseKeys])

  const courseColumns = [
    {
      title: '课程名称',
      dataIndex: 'name',
    },
  ]

  useEffect(() => {
    setLoadingCourseList(true)
    invoke('get_courses').then((res) => {
      // console.log(res)
      setCourseList(res)
      setSelectedCourses(res.map((item) => {
        return {
          key: item.id,
          name: item.name
        }
      }))
    }).catch((err) => {
      notification.error({
        message: '获取课程列表失败',
        description: err
      })
    }).finally(() => {
      setLoadingCourseList(false)
    })

    const unlisten = listen('download-progress', (res) => {
      const progress = res.payload
      latestProgress.current = progress
      setTotalSize(progress.total_size)
      setDownloadDescription(
        progress.status === 'downloading' ? `正在下载 ${progress.current}/${progress.total} | ${progress.file_name}` :
          progress.status === 'done' ? '下载完成' :
            progress.status === 'cancel' ? '下载已取消' : '下载进度'
      )
    })

    const updateProgress = setInterval(() => {
      const currentTime = Date.now()
      const elapsedTime = currentTime - startTime.current
      if (elapsedTime > 0) {
        const newSpeed = (latestProgress.current.downloaded_size - lastDownloadedSize.current) / elapsedTime * 1000
        const totalSpeed = latestProgress.current.downloaded_size / (currentTime - startDownloadTime.current) * 1000
        const newTimeRemaining = (latestProgress.current.total_size - latestProgress.current.downloaded_size) / totalSpeed
        const newDownloadPercent = latestProgress.current.downloaded_size / latestProgress.current.total_size * 100
        if (newSpeed && !isNaN(newSpeed)) {
          setSpeed(newSpeed)
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

  const downloadUploads = () => {
    let uploads = uploadList.filter((item) => selectedUploadKeys.includes(item.reference_id))
    if (uploads.length === 0) {
      notification.error({
        message: '请选择课件',
      })
      return
    }
    setDownloadingSync(true)
    setDownloadedSize(0)
    setTotalSize(0)
    startTime.current = Date.now()
    startDownloadTime.current = Date.now()
    lastDownloadedSize.current = 0
    setDownloadPercent(0)
    setSpeed(0)
    setTimeRemaining(0)
    setDownloadDescription('正在下载')
    invoke('download_uploads', { uploads, syncUpload: true }).then((res) => {
      // console.log(res)
      if (res.length === selectedUploadKeys.length) {
        notification.success({
          message: '下载完成',
        })
        setDownloadPercent(100)
      } else {
        notification.error({
          message: '部分课件下载失败',
        })
      }
      let haveDownloaded = res.map((item) => item.reference_id)
      setSelectedUploadKeys(selectedUploadKeys.filter((item) => !haveDownloaded.includes(item)))
      setUploadList(uploadList.filter((item) => !haveDownloaded.includes(item.reference_id)))
      latestProgress.current = {
        status: null,
        file_name: null,
        downloaded_size: 0,
        total_size: 0,
        current: 0,
        total: 0
      }
      lastDownloadedSize.current = 0
      setSpeed(0)
      setDownloadedSize(0)
      setTotalSize(0)
    }).catch((err) => {
      notification.error({
        message: '下载失败',
        description: err
      })
    }).finally(() => {
      setDownloadingSync(false)
    })
  }

  const onSelectChange = (newSelectedRowKeys) => {
    // console.log('selectedRowKeys changed: ', newSelectedRowKeys);
    setSelectedCourseKeys(newSelectedRowKeys)
  };

  const onUploadSelectChange = (newSelectedRowKeys) => {
    // console.log('selectedRowKeys changed: ', newSelectedRowKeys);
    setSelectedUploadKeys(newSelectedRowKeys)
  }

  const updateUploadList = () => {
    stopSync()
    startSync()
  }

  const cancelDownload = () => {
    invoke('cancel_download').then((res) => {
      // console.log(res)
      setDownloadingSync(false)
    }).catch((err) => {
      notification.error({
        message: '取消下载失败',
        description: err
      })
    })
  }

  const updatePath = () => {
    dialog.open({
      directory: true,
      multiple: false,
      message: '选择同步路径'
    }).then((res) => {
      if (res && res.length !== 0) {
        setUpdatingPath(true)
        invoke('update_path', { path: res, uploads: [] }).then((res) => {
          // console.log(res)
          notification.success({
            message: '同步路径修改成功',
          })
          setUploadList([])
          updateUploadList()
        }).catch((err) => {
          notification.error({
            message: '同步路径修改失败',
            description: err
          })
        }).finally(() => {
          setUpdatingPath(false)
        })
      }
    }).catch((err) => {
      notification.error({
        message: '同步路径修改失败',
        description: err
      })
    })
  }

  const openDownloadPath = () => {
    invoke('open_save_path').then((res) => {
    }).catch((err) => {
      notification.error({
        message: '打开同步路径失败',
        description: err
      })
    })
  }

  const startSync = () => {
    const syncFunc = () => {
      if (downloadingSync) return
      console.log(selectedCourseKeysRef.current)
      let courses = courseList.filter((item) => selectedCourseKeysRef.current.includes(item.id))
      setLoadingUploadList(true)
      invoke('get_uploads_list', { courses, syncUpload: true }).then((uploads) => {
        // console.log(uploads)
        if (selectedSyncOption === 'sync') {
          setUploadList(uploads)
          setSelectedUploadKeys(uploads.map((item) => item.reference_id))
        } else {
          setDownloadingSync(true)
          setDownloadedSize(0)
          setTotalSize(0)
          startTime.current = Date.now()
          startDownloadTime.current = Date.now()
          lastDownloadedSize.current = 0
          setDownloadPercent(0)
          setSpeed(0)
          setTimeRemaining(0)
          setDownloadDescription('正在下载')
          invoke('download_uploads', { uploads, syncUpload: true }).then((res) => {
            if (res.length === uploads.length) {
              notification.success({
                message: '下载完成',
              })
              setDownloadPercent(100)
            } else {
              notification.error({
                message: '部分课件下载失败',
              })
            }
            latestProgress.current = {
              status: null,
              file_name: null,
              downloaded_size: 0,
              total_size: 0,
              current: 0,
              total: 0
            }
            lastDownloadedSize.current = 0
            setSpeed(0)
            setDownloadedSize(0)
            setTotalSize(0)
            // extend uploadList with new downloaded reference_id
            const newDownloaded = res.filter((item) => !uploadList.map((item) => item.reference_id).includes(item.reference_id))
            setUploadList([...newDownloaded, ...uploadList])
          }).catch((err) => {
            notification.error({
              message: '下载失败',
              description: err
            })
          }).finally(() => {
            setDownloadingSync(false)
          })
        }
        setLastSync(dayjs().format('YYYY-MM-DD HH:mm:ss'))
      }).catch((err) => {
        notification.error({
          message: '获取课件列表失败',
          description: err
        })
      }).finally(() => {
        const nextSync = Math.floor(Math.random() * 120000) + 180000
        syncTimer.current = setTimeout(syncFunc, nextSync)
        setLoadingUploadList(false)
      })
    }
    syncFunc()
  }

  const stopSync = () => {
    clearTimeout(syncTimer.current)
    syncTimer.current = null
  }

  const uploadColumns = [
    {
      title: '文件名',
      dataIndex: 'file_name',
    },
    {
      title: '大小',
      dataIndex: 'size',
      render: (size) => {
        return bytesToSize(size)
      },
      searchable: false
    },
    {
      title: '同步路径',
      dataIndex: 'path',
    },
  ]

  const syncOptions = [
    { label: '自动下载', value: 'download' },
    { label: '同步至下载队列', value: 'sync' },
  ]

  const handleSwitch = (checked) => {
    setSyncing(checked)
    setDownloading(checked)
    if (checked) {
      startSync()
    } else {
      stopSync()
    }
  }

  const changeSyncOption = (e) => {
    setUploadList([])
    setSelectedSyncOption(e.target.value)
  }

  return (
    <div style={{ margin: 20 }}>
      <Card bodyStyle={{ padding: 15 }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }} >
          <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'row' }}>
            <Text style={{ minWidth: 70 }}>自动同步：</Text>
            <Switch checked={syncing} onChange={handleSwitch} disabled={downloadingSync}/>
            <Text style={{ minWidth: 105, marginLeft: 30 }}>检测到更新后：</Text>
            <Radio.Group
              options={syncOptions}
              onChange={changeSyncOption}
              value={selectedSyncOption}
              optionType="button"
              disabled={downloadingSync}
            />
          </div>
          {selectedSyncOption === 'sync' && <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'row', marginLeft: 20 }}>
            <Button
              type='primary'
              icon={downloadingSync ? <CloseCircleOutlined /> : <DownloadOutlined />}
              onClick={downloadingSync ? cancelDownload : downloadUploads}
              disabled={loadingUploadList}
            >{downloadingSync ? '取消下载' : '下载课件'}</Button>
          </div>}
        </div>
      </Card>
      <Row gutter={20} style={{ marginTop: 20 }}>
        <Col xs={10} md={9} lg={8}>
          <SearchTable
            rowSelection={{
              selectedRowKeys: selectedCourseKeys,
              onChange: onSelectChange,
            }}
            columns={courseColumns}
            dataSource={selectedCourses}
            loading={loadingCourseList}
            pagination={false}
            scroll={{ y: 'calc(100vh - 335px)' }}
            size='small'
            bordered
            footer={() => ''}
            title={() => `课程列表：已订阅 ${selectedCourseKeys.length} 门课程`}
          />
        </Col>
        <Col xs={14} md={15} lg={16}>
          <SearchTable
            rowSelection={selectedSyncOption === 'sync' && {
              selectedRowKeys: selectedUploadKeys,
              onChange: onUploadSelectChange,
            }}
            rowKey='reference_id'
            columns={uploadColumns}
            dataSource={uploadList}
            loading={loadingUploadList || updatingPath || (selectedSyncOption === 'sync' && downloadingSync)}
            pagination={false}
            scroll={{ y: 'calc(100vh - 357px)' }}
            size='small'
            bordered
            footer={() => `最后同步时间：${lastSync ? lastSync : '未同步'}`}
            title={() => {
              return (
                <>
                  {selectedSyncOption === 'sync' && uploadList && uploadList.length !== 0 && <Text ellipsis={{ rows: 1, expandable: false }} style={{ width: 'calc(100% - 80px)' }}>
                    下载队列：已选择 {selectedUploadKeys.length} 个文件 共 {bytesToSize(uploadList.filter((item) => selectedUploadKeys.includes(item.reference_id)).reduce((total, item) => {
                      return total + item.size
                    }, 0))}
                  </Text>}
                  {selectedSyncOption === 'sync' && (!uploadList || uploadList.length === 0) && '下载队列：暂无文件'}
                  {selectedSyncOption === 'download' && `已同步 ${uploadList.length} 个文件 共 ${bytesToSize(uploadList.reduce((total, item) => {
                    return total + item.size
                  }, 0))}`}
                  <div style={{ float: 'right' }}>
                    <Tooltip title='立即同步'>
                      <Button
                        type='text'
                        size='small'
                        icon={<ReloadOutlined />}
                        onClick={updateUploadList}
                        loading={loadingUploadList || downloadingSync}
                      />
                    </Tooltip>
                    <Tooltip title='修改同步路径'>
                      <Button
                        type='text'
                        size='small'
                        icon={<EditOutlined />}
                        onClick={updatePath}
                        disabled={loadingUploadList || updatingPath || downloadingSync}
                      />
                    </Tooltip>
                    <Tooltip title='打开同步路径'>
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
        }}>{downloading && totalSize !== 0 && !isNaN(totalSize) && speed === 0 ? `${bytesToSize(downloadedSize)} / ${bytesToSize(totalSize)} | 0 B/s` :
          downloading && totalSize !== 0 && !isNaN(totalSize) ? `${bytesToSize(downloadedSize)} / ${bytesToSize(totalSize)} | ${bytesToSize(speed)}/s 剩余 ${formatTime(timeRemaining)}` : ''}</Text>
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