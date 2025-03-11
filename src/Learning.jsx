import { useEffect, useState } from 'react'
import { Button, Card, App, Row, Col, Select, Tooltip, Typography, Switch } from 'antd';
import { invoke } from '@tauri-apps/api/core'
import { ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import { bytesToSize } from './utils'
import { LearningTask } from './downloadManager';
import SearchTable from './SearchTable'
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

dayjs.locale('zh-cn')

const { Text } = Typography

export default function Learning({
  addDownloadTasks,
  syncing,
  autoDownload,
  lastSync,
  loadingUploadList,
  uploadList,
  setUploadList,
  handleSwitchSync,
  updateUploadList,
  selectedUploadKeys,
  setSelectedUploadKeys,
  selectedCourseKeys,
  setSelectedCourseKeys,
  courseList,
  setCourseList,
}) {
  const { message, modal, notification } = App.useApp()

  const [semesterList, setSemesterList] = useState([])
  const [loadingSemesterList, setLoadingSemesterList] = useState(false)
  const [academicYearList, setAcademicYearList] = useState([])
  const [loadingAcademicYearList, setLoadingAcademicYearList] = useState(false)
  const [loadingCourseList, setLoadingCourseList] = useState(false)
  const [selectedCourses, setSelectedCourses] = useState([])
  const [selectedAcademicYear, setSelectedAcademicYear] = useState(null)
  const [selectedSemester, setSelectedSemester] = useState(null)

  const [windowWidth, setWindowWidth] = useState(window.innerWidth)

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

    const handleResize = () => {
      setWindowWidth(window.innerWidth)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
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
    let tasks = uploads.map((item) => new LearningTask(item))
    addDownloadTasks(tasks)
    setUploadList(uploadList.filter((item) => !selectedUploadKeys.includes(item.reference_id)))
    setSelectedUploadKeys([])
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

  const uploadColumns = [
    {
      title: '课程名称',
      dataIndex: 'course_name',
    },
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
      searchable: false,
      sorter: (a, b) => a.size - b.size
    },
  ]

  return (
    <div style={{ margin: 20 }}>
      <Card styles={{ body: { padding: 15 } }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }} >
          <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'row' }}>
            <Text style={{ minWidth: 75 }}>自动同步：</Text>
            <Tooltip title={syncing ? (autoDownload ? '自动同步已开启，将自动下载已选课程的课件' : '自动同步已开启，将自动添加已选课程的未下载课件至课件列表') : '开启后，将自动检测学在浙大是否有课件更新'}>
              <Switch checked={syncing} onChange={handleSwitchSync} />
            </Tooltip>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'row', marginLeft: 20 }}>
            <Text style={{ minWidth: 50 }}>学年：</Text>
            <Select
              allowClear
              showSearch
              style={{ minWidth: 110 }}
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
            <Text style={{ minWidth: 50, marginLeft: 25 }}>学期：</Text>
            <Select
              allowClear
              showSearch
              style={{ minWidth: 140 }}
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
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'row', marginLeft: 20 }}>
            <Tooltip title={windowWidth > 712 ? '' : '下载课件'}>
              <Button
                type='primary'
                icon={<DownloadOutlined />}
                onClick={downloadUploads}
                disabled={loadingUploadList}
              >{windowWidth > 712 ? '下载课件' : ''}</Button>
            </Tooltip>
          </div>
        </div>
      </Card>
      <Row gutter={20} style={{ marginTop: 20 }}>
        <Col xs={10} md={9} lg={8}>
          <SearchTable
            rowSelection={{
              selectedRowKeys: selectedCourseKeys,
              onChange: setSelectedCourseKeys,
            }}
            columns={courseColumns}
            dataSource={selectedCourses}
            loading={loadingCourseList}
            pagination={false}
            scroll={{ y: 'calc(100vh - 270px)' }}
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
              onChange: setSelectedUploadKeys,
            }}
            rowKey='reference_id'
            columns={uploadColumns}
            dataSource={syncing && autoDownload ? [] : uploadList}
            loading={loadingUploadList}
            pagination={false}
            scroll={{ y: syncing ? 'calc(100vh - 292px)' : 'calc(100vh - 270px)' }}
            size='small'
            bordered
            footer={() => syncing ? `最后同步时间：${lastSync ? lastSync : '未同步'}` : ''}
            title={() => {
              return (
                <>
                  {uploadList && uploadList.length !== 0 && (syncing && autoDownload ? '检测到新课件后将会自动下载 点击右侧立即同步👉' : <Text ellipsis={{ rows: 1, expandable: false, tooltip: true }} style={{ width: 'calc(100% - 30px)' }}>
                    课件列表：已选择 {selectedUploadKeys.length} 个文件 共 {bytesToSize(uploadList.filter((item) => selectedUploadKeys.includes(item.reference_id)).reduce((total, item) => {
                      return total + item.size
                    }, 0))}
                  </Text>)}
                  {(!uploadList || uploadList.length === 0) && (syncing ? (autoDownload ? '检测到新课件后将会自动下载 点击右侧立即同步👉' : '待下载更新课件列表为空  点击右侧立即同步👉') : '课件列表为空  点击右侧刷新👉')}
                  <div style={{ float: 'right' }}>
                    <Tooltip title={syncing ? '立即同步' : '刷新课件列表'}>
                      <Button
                        type='text'
                        size='small'
                        icon={<ReloadOutlined />}
                        onClick={updateUploadList}
                        loading={loadingUploadList}
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