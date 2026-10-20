import PlatformIcon from '../../components/PlatformIcon';
import ConfigReadState from '../../components/ConfigReadState';
import { useDesktopApp } from '../../context/NotificationContext';
import FileTypeIcon from '../../components/FileTypeIcon';
import ActionButton from '../../components/ActionButton';
import Workspace from '../../components/Workspace';
import React, { useEffect, useState } from 'react'
import { Select, Switch } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { invoke } from '../../bridge'
import ResourceList from '../../components/ResourceList'
import { Upload } from '../../model';
import { bytesToSize } from '../../utils';
import { useConfig } from '../../context/ConfigContext';
import { LearningTask } from '../../downloadManager';
import { useAddDownloadTasks } from '../../hooks/useAddDownloadTasks';


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
  setUploadList: React.Dispatch<React.SetStateAction<Upload[]>>;
  handleSwitchSync: (checked: boolean) => void;
  updateUploadList: () => void;
  selectedUploadKeys: React.Key[];
  setSelectedUploadKeys: React.Dispatch<React.SetStateAction<React.Key[]>>;
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
  const { notification } = useDesktopApp()
  const { savedConfig: config, ready } = useConfig();
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


  useEffect(() => {
    setLoadingSemesterList(true)
    invoke<Semester[]>('get_semester_list').then((res) => {
      res.sort((a, b) => b.sort - a.sort)
      setSemesterList(res)
    }).catch((err) => {
      notification.error({
        title: '获取学期列表失败',
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
        title: '获取学年列表失败',
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
        title: '获取课程列表失败',
        description: String(err)
      })
    }).finally(() => {
      setLoadingCourseList(false)
    })

  }, [notification, setCourseList])

  const downloadUploads = async () => {
    const uploads = uploadList.filter((item) => selectedUploadKeys.includes(item.reference_id))
    if (uploads.length === 0) {
      notification.error({ title: '请选择课件' })
      return
    }
    const tasks = uploads.map((item) => new LearningTask(item))
    if (!await addDownloadTasks(tasks)) return
    const addedKeys = new Set(uploads.map(item => item.reference_id))
    setUploadList(current => current.filter(item => !addedKeys.has(item.reference_id)))
    setSelectedUploadKeys(current => current.filter(key => !addedKeys.has(key as number)))
  }

  const filterCourseList = (academicYearID: number | null, semesterID: number | null) => {
    const semester = semesterList.find((item) => item.id === semesterID)
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

  return <Workspace headerless title="学在浙大" panel={<>
    <div className="panel-heading"><h2>学在浙大</h2></div>
    <div className="panel-controls course-filters">
      <label>学年<Select aria-label="学年" placeholder="全部学年" allowClear showSearch optionFilterProp="label" value={selectedAcademicYear} onChange={onAcademicYearChange}
        options={academicYearList.map(item => ({ label: item.name, value: item.id }))} loading={loadingAcademicYearList} /></label>
      <label>学期<Select aria-label="学期" placeholder="全部学期" allowClear showSearch optionFilterProp="label" value={selectedSemester} onChange={onSemesterChange}
        options={semesterList.filter(item => !selectedAcademicYear || selectedAcademicYear === item.academic_year_id).map(item => ({ label: item.name, value: item.id }))} loading={loadingSemesterList} /></label>
    </div>
    <div className="panel-list"><ResourceList compact title="课程" items={selectedCourses} itemKey={course => course.key}
      selectedKeys={selectedCourseKeys} onSelectionChange={setSelectedCourseKeys} loading={loadingCourseList}
      fields={[{ label: '课程', value: course => course.name }]} renderItem={course => ({ title: course.name })} emptyIcon={<PlatformIcon platform="learning" />} emptyText="暂无课程" /></div>
    <div className="panel-bottom"><div className="setting-line"><span>自动同步</span><Switch disabled={!ready || loadingUploadList} checked={syncing} onChange={handleSwitchSync} /></div>
      <p>{autoDownload ? '新课件将自动下载，遵循文件排除设置。' : '新课件将添加到待下载列表。'}</p>
      <p>最后同步 · {lastSync || '未同步'}</p></div>
  </>}
    footer={<><span>已选 {selectedUploadKeys.length} 个文件 <span className="muted">· {bytesToSize(uploadList.filter(item => selectedUploadKeys.includes(item.reference_id)).reduce((sum, item) => sum + item.size, 0))}</span></span>
      <div className="footer-actions"><button className="text-button" onClick={() => setSelectedUploadKeys([])} disabled={!ready || loadingUploadList || !selectedUploadKeys.length}>取消选择</button><ActionButton variant="primary" onClick={downloadUploads} disabled={!ready || loadingUploadList || !selectedUploadKeys.length}><DownloadOutlined />下载所选课件</ActionButton></div></>}>
    {syncing && autoDownload && uploadList.length > 0 && <p className="muted">已按设置跳过 {uploadList.length} 个文件，可手动选择下载。</p>}
    {!ready ? <ConfigReadState icon={<PlatformIcon platform="learning" />} /> : <ResourceList<Upload> actions={<ActionButton variant="secondary" onClick={updateUploadList} disabled={!ready || loadingUploadList} aria-busy={loadingUploadList}><ReloadOutlined spin={loadingUploadList} />{loadingUploadList ? (syncing ? '正在同步' : '正在获取') : (syncing ? '立即同步' : '获取课件')}</ActionButton>} title="文件列表" items={uploadList} itemKey={item => item.reference_id}
      selectedKeys={selectedUploadKeys} onSelectionChange={setSelectedUploadKeys} loading={loadingUploadList}
      fields={[{ label: '文件名', value: item => item.file_name }, { label: '课程', value: item => item.course_name }]}
      sorts={[{ label: '大小升序', compare: (a, b) => a.size - b.size }, { label: '大小降序', compare: (a, b) => b.size - a.size }]}
      renderItem={item => ({ title: item.file_name, subtitle: item.course_name, icon: <FileTypeIcon name={item.file_name} />, meta: bytesToSize(item.size) })}
      emptyIcon={<PlatformIcon platform="learning" />} emptyText={syncing ? '暂无新的课件' : '选择课程后，点击“获取课件”'} />}
  </Workspace>
}
