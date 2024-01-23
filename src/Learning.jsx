import { useEffect, useState, useRef } from 'react'
import { Form, Button, Card, App, Row, Col, Select, Progress, Tooltip, Typography } from 'antd';
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

export default function Learning({ downloading, setDownloading }) {
  const { message, modal, notification } = App.useApp()
  const [form] = Form.useForm()

  const [semesterList, setSemesterList] = useState([])
  const [loadingSemesterList, setLoadingSemesterList] = useState(false)
  const [academicYearList, setAcademicYearList] = useState([])
  const [loadingAcademicYearList, setLoadingAcademicYearList] = useState(false)
  const [courseList, setCourseList] = useState([])
  const [loadingCourseList, setLoadingCourseList] = useState(false)
  const [selectedCourses, setSelectedCourses] = useState([])
  const [selectedAcademicYear, setSelectedAcademicYear] = useState(null)
  const [selectedSemester, setSelectedSemester] = useState(null)
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

  const courseColumns = [
    {
      title: '课程名称',
      dataIndex: 'name',
    },
  ]

  useEffect(() => {
    setLoadingSemesterList(true)
    invoke('get_semester_list').then((res) => {
      // console.log(res)
      res.sort((a, b) => {
        return b.sort - a.sort
      })
      setSemesterList(res)
    }).catch((err) => {
      notification.error({
        message: '获取学期列表失败',
        description: err
      })
    }).finally(() => {
      setLoadingSemesterList(false)
    })

    setLoadingAcademicYearList(true)
    invoke('get_academic_year_list').then((res) => {
      // console.log(res)
      res.sort((a, b) => {
        return b.sort - a.sort
      })
      setAcademicYearList(res)
    }).catch((err) => {
      notification.error({
        message: '获取学年列表失败',
        description: err
      })
    }).finally(() => {
      setLoadingAcademicYearList(false)
    })

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

  const downloadUploads = (values) => {
    let uploads = uploadList.filter((item) => selectedUploadKeys.includes(item.reference_id))
    if (uploads.length === 0) {
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
    setSpeed(0)
    setTimeRemaining(0)
    setDownloadDescription('正在下载')
    invoke('download_uploads', { uploads }).then((res) => {
      // console.log(res)
      if (res.length === selectedUploadKeys.length) {
        notification.success({
          message: '下载完成',
        })
        setDownloadPercent(100)
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
      setDownloading(false)
    })
  }

  const updateCourseList = (academicYearID, semesterID) => {
    let semester = semesterList.find((item) => item.id === semesterID)
    setSelectedCourses(courseList.filter((item) => {
      return (semesterID && (item.semester_id === semester.id || (item.semester_id === 0 && item.academic_year_id === semester.academic_year_id))) ||
        (!semesterID && academicYearID && item.academic_year_id === academicYearID) ||
        (!semesterID && !academicYearID)
    }).map((item) => {
      return {
        key: item.id,
        name: item.name
      }
    }))
  }

  const onAcademicYearChange = (value) => {
    // console.log(`selected academic year ${value}`);
    setSelectedAcademicYear(value)
    setSelectedSemester(null)
    updateCourseList(value)
    setSelectedCourseKeys([])
  };

  const onSemesterChange = (value) => {
    // console.log(`selected semester ${value}`);
    setSelectedSemester(value)
    updateCourseList(selectedAcademicYear, value)
    setSelectedCourseKeys([])
  };

  const filterOption = (input, option) =>
    (option?.label ?? '').toLowerCase().includes(input.toLowerCase());

  const onSelectChange = (newSelectedRowKeys) => {
    // console.log('selectedRowKeys changed: ', newSelectedRowKeys);
    setSelectedCourseKeys(newSelectedRowKeys)
  };

  const onUploadSelectChange = (newSelectedRowKeys) => {
    // console.log('selectedRowKeys changed: ', newSelectedRowKeys);
    setSelectedUploadKeys(newSelectedRowKeys)
  }

  const updateUploadList = () => {
    let courses = courseList.filter((item) => selectedCourseKeys.includes(item.id))
    // console.log(courses)
    if (courses.length === 0) {
      notification.error({
        message: '请选择课程',
      })
      return
    }
    setLoadingUploadList(true)
    invoke('get_uploads_list', { courses }).then((res) => {
      // console.log(res)
      setUploadList(res)
      setSelectedUploadKeys(res.map((item) => item.reference_id))
    }).catch((err) => {
      notification.error({
        message: '获取课件列表失败',
        description: err
      })
    }).finally(() => {
      setLoadingUploadList(false)
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

  const updatePath = () => {
    dialog.open({
      directory: true,
      multiple: false,
      message: '选择下载路径'
    }).then((res) => {
      if (res && res.length !== 0) {
        setUpdatingPath(true)
        invoke('update_path', { path: res, uploads: uploadList }).then((res) => {
          // console.log(res)
          notification.success({
            message: '下载路径修改成功',
          })
          setUploadList(res)
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

  const openDownloadPath = () => {
    invoke('open_save_path').then((res) => {
    }).catch((err) => {
      notification.error({
        message: '打开下载路径失败',
        description: err
      })
    })
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
      title: '下载路径',
      dataIndex: 'path',
    },
  ]

  return (
    <div style={{ margin: 20 }}>
      <Card bodyStyle={{ padding: 15 }}>
        <Form
          layout='horizontal'
          form={form}
        >
          <Row
            gutter={24}
            justify="space-between"
            align="middle"
          >
            <Col xs={9} md={10}>
              <Form.Item label='学年' name='academicYear' style={{ marginBottom: 0 }}>
                <Select
                  allowClear
                  showSearch
                  width='100%'
                  optionFilterProp="children"
                  value={selectedAcademicYear}
                  onChange={onAcademicYearChange}
                  filterOption={filterOption}
                  options={academicYearList.map((item) => {
                    return {
                      label: item.name,
                      value: item.id
                    }
                  })}
                  loading={loadingAcademicYearList}
                />
              </Form.Item>
            </Col>
            <Col xs={9} md={10}>
              <Form.Item label='学期' name='semester' style={{ marginBottom: 0 }}>
                <Select
                  allowClear
                  showSearch
                  width='100%'
                  optionFilterProp="children"
                  value={selectedSemester}
                  onChange={onSemesterChange}
                  filterOption={filterOption}
                  options={semesterList.map((item) => {
                    if (selectedAcademicYear && selectedAcademicYear !== item.academic_year_id) {
                      return null
                    } else {
                      return {
                        label: item.name,
                        value: item.id
                      }
                    }
                  }).filter((item) => item !== null)}
                  loading={loadingSemesterList}
                />
              </Form.Item>
            </Col>
            <Col xs={6} md={4}>
              <Form.Item style={{ marginBottom: 0 }}>
                <Button
                  type='primary'
                  icon={downloading ? <CloseCircleOutlined /> : <DownloadOutlined />}
                  onClick={downloading ? cancelDownload : downloadUploads}
                  disabled={loadingUploadList}
                >{downloading ? '取消下载' : '下载课件'}</Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
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
            title={() => `课程列表：已选择 ${selectedCourseKeys.length} 门课程`}
          />
        </Col>
        <Col xs={14} md={15} lg={16}>
          <SearchTable
            rowSelection={{
              selectedRowKeys: selectedUploadKeys,
              onChange: onUploadSelectChange,
            }}
            rowKey='reference_id'
            columns={uploadColumns}
            dataSource={uploadList}
            loading={loadingUploadList || downloading || updatingPath}
            pagination={false}
            scroll={{ y: 'calc(100vh - 335px)' }}
            size='small'
            bordered
            footer={() => ''}
            title={() => {
              return (
                <>
                  {uploadList && uploadList.length !== 0 && <Text ellipsis={{ rows: 1, expandable: false }} style={{ width: 'calc(100% - 80px)' }}>
                    课件列表：已选择 {selectedUploadKeys.length} 个文件 共 {bytesToSize(uploadList.filter((item) => selectedUploadKeys.includes(item.reference_id)).reduce((total, item) => {
                      return total + item.size
                    }, 0))}
                  </Text>}
                  {(!uploadList || uploadList.length === 0) && '课件列表为空  点击右侧刷新👉'}
                  <div style={{ float: 'right' }}>
                    <Tooltip title='刷新课件列表'>
                      <Button
                        type='text'
                        size='small'
                        icon={<ReloadOutlined />}
                        onClick={updateUploadList}
                        loading={loadingUploadList}
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