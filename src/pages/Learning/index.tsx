import React, { useEffect, useState } from 'react'
import { App, Layout, Select, Button, Tooltip, Input, Row, Col, Switch, Card, Typography } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core'
import SearchTable from '../../components/SearchTable'
import { Upload } from '../../model';
import { bytesToSize } from '../../utils';
import dayjs from 'dayjs'
import { useConfig } from '../../context/ConfigContext';
import { LearningTask, Task } from '../../downloadManager';
import { useAddDownloadTasks } from '../../hooks/useAddDownloadTasks';
import { ColumnType } from 'antd/es/table';

const { Content } = Layout;
const { Text } = Typography;

interface Semester {
  id: number;
  name: string;
  sort: number;
  academic_year_id: number;
}

interface AcademicYear {
  id: number;
  name: string;
  sort: number;
}

interface Course {
  id: number;
  name: string;
  semester_id: number;
  academic_year_id: number;
}

interface LearningProps {
  syncing: boolean;
  lastSync: string | null;
  loadingUploadList: boolean;
  uploadList: Upload[];
  setUploadList: (uploads: Upload[]) => void;
  handleSwitchSync: (checked: boolean) => void;
  updateUploadList: () => void;
  selectedUploadKeys: React.Key[];
  setSelectedUploadKeys: (keys: React.Key[]) => void;
  selectedCourseKeys: React.Key[];
  setSelectedCourseKeys: (keys: React.Key[]) => void;
  courseList: Course[];
  setCourseList: (courses: Course[]) => void;
}

export default function Learning({
  syncing,
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
  setCourseList
}: LearningProps) {
  const { notification } = App.useApp()
  const { config } = useConfig();
  const addDownloadTasks = useAddDownloadTasks();
  const autoDownload = config.auto_download;

  const [semesterList, setSemesterList] = useState<Semester[]>([])
  const [loadingSemesterList, setLoadingSemesterList] = useState(false)
  const [academicYearList, setAcademicYearList] = useState<AcademicYear[]>([])
  const [loadingAcademicYearList, setLoadingAcademicYearList] = useState(false)
  const [loadingCourseList, setLoadingCourseList] = useState(false)
  const [selectedCourses, setSelectedCourses] = useState<{ key: number, name: string }[]>([])
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<number | null>(null)
  const [selectedSemester, setSelectedSemester] = useState<number | null>(null)

  const [windowWidth, setWindowWidth] = useState(window.innerWidth)

  const courseColumns: ColumnType<{ key: number, name: string }>[] = [
    {
      title: '课程名称',
      dataIndex: 'name',
    },
  ]

  useEffect(() => {
    setLoadingSemesterList(true)
    invoke<Semester[]>('get_semester_list').then((res) => {
      res.sort((a, b) => b.sort - a.sort)
      setSemesterList(res)
    }).catch((err) => {
      notification.error({
        message: '获取学期列表失败',
        description: String(err)
      })
    }).finally(() => {
      setLoadingSemesterList(false)
    })

    setLoadingAcademicYearList(true)
    invoke<AcademicYear[]>('get_academic_year_list').then((res) => {
      res.sort((a, b) => b.sort - a.sort)
      setAcademicYearList(res)
    }).catch((err) => {
      notification.error({
        message: '获取学年列表失败',
        description: String(err)
      })
    }).finally(() => {
      setLoadingAcademicYearList(false)
    })

    setLoadingCourseList(true)
    invoke<Course[]>('get_courses').then((res) => {
      setCourseList(res)
      setSelectedCourses(res.map((item) => ({
        key: item.id,
        name: item.name
      })))
    }).catch((err) => {
      notification.error({
        message: '获取课程列表失败',
        description: String(err)
      })
    }).finally(() => {
      setLoadingCourseList(false)
    })

    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [notification, setCourseList])

  const downloadUploads = () => {
    let uploads = uploadList.filter((item) => selectedUploadKeys.includes(item.reference_id))
    if (uploads.length === 0) {
      notification.error({ message: '请选择课件' })
      return
    }
    let tasks = uploads.map((item) => new LearningTask(item))
    addDownloadTasks(tasks)
    setUploadList(uploadList.filter((item) => !selectedUploadKeys.includes(item.reference_id)))
    setSelectedUploadKeys([])
  }

  const filterCourseList = (academicYearID: number | null, semesterID: number | null) => {
    let semester = semesterList.find((item) => item.id === semesterID)
    setSelectedCourses(courseList.filter((item) => {
      return (semesterID && semester && (item.semester_id === semester.id || (item.semester_id === 0 && item.academic_year_id === semester.academic_year_id))) ||
        (!semesterID && academicYearID && item.academic_year_id === academicYearID) ||
        (!semesterID && !academicYearID)
    }).map((item) => ({
      key: item.id,
      name: item.name
    })))
  }

  const onAcademicYearChange = (value: number | null) => {
    setSelectedAcademicYear(value)
    setSelectedSemester(null)
    filterCourseList(value, null)
    setSelectedCourseKeys([])
  };

  const onSemesterChange = (value: number | null) => {
    setSelectedSemester(value)
    filterCourseList(selectedAcademicYear, value)
    setSelectedCourseKeys([])
  };

  const uploadColumns: ColumnType<Upload>[] = [
    { title: '课程名称', dataIndex: 'course_name' },
    { title: '文件名', dataIndex: 'file_name' },
    {
      title: '大小',
      dataIndex: 'size',
      render: (size: number) => bytesToSize(size),
      // @ts-ignore
      searchable: false,
      sorter: (a, b) => a.size - b.size
    },
  ]

  return (
    <div style={{ margin: 20 }}>
      <Card styles={{ body: { padding: 15 } }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} >
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
              value={selectedAcademicYear}
              onChange={onAcademicYearChange}
              options={academicYearList.map((item) => ({
                label: item.name,
                value: item.id
              }))}
              loading={loadingAcademicYearList}
            />
            <Text style={{ minWidth: 50, marginLeft: 25 }}>学期：</Text>
            <Select
              allowClear
              showSearch
              style={{ minWidth: 140 }}
              value={selectedSemester}
              onChange={onSemesterChange}
              options={semesterList.map((item) => {
                if (selectedAcademicYear && selectedAcademicYear !== item.academic_year_id) {
                  return null
                } else {
                  return { label: item.name, value: item.id }
                }
              }).filter((item): item is { label: string, value: number } => item !== null)}
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
          <SearchTable<{ key: number, name: string }>
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
            title={() => `课程列表：已选择 ${selectedCourseKeys.length} 门课程`}
          />
        </Col>
        <Col xs={14} md={15} lg={16}>
          <SearchTable<Upload>
            rowSelection={{
              selectedRowKeys: selectedUploadKeys,
              onChange: setSelectedUploadKeys,
            }}
            rowKey='reference_id'
            columns={uploadColumns}
            dataSource={uploadList}
            loading={loadingUploadList}
            pagination={false}
            scroll={{ y: syncing ? 'calc(100vh - 292px)' : 'calc(100vh - 270px)' }}
            size='small'
            bordered
            footer={() => syncing ? `最后同步时间：${lastSync ? lastSync : '未同步'}` : ''}
            title={() => (
              <>
                {uploadList && uploadList.length !== 0 && <Text ellipsis={{ rows: 1, expandable: false, tooltip: true }} style={{ width: 'calc(100% - 30px)' }}>
                  {syncing && autoDownload ? `已按设置跳过 ${uploadList.length} 个文件；` : '课件列表：'}已选择 {selectedUploadKeys.length} 个文件 共 {bytesToSize(uploadList.filter((item) => selectedUploadKeys.includes(item.reference_id)).reduce((total, item) => total + item.size, 0))}
                </Text>}
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
            )}
          />
        </Col>
      </Row>
    </div>
  )
}
