import PanelHeading from '../../components/PanelHeading';
import FetchState from '../../components/FetchState';
import PlatformIcon from '../../components/PlatformIcon';
import ConfigReadState from '../../components/ConfigReadState';
import { useDesktopApp } from '../../context/NotificationContext';
import FileTypeIcon from '../../components/FileTypeIcon';
import ActionButton from '../../components/ActionButton';
import Workspace from '../../components/Workspace';
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Select, Switch, Tooltip } from 'antd';
import { DownloadOutlined, LoadingOutlined, ReloadOutlined } from '@ant-design/icons';
import { invoke } from '../../bridge'
import ResourceList from '../../components/ResourceList'
import { LearningCourse, Upload } from '../../model';
import { bytesToSize } from '../../utils';
import { useConfig } from '../../context/ConfigContext';
import { LearningTask } from '../../downloadManager';
import { useAddDownloadTasks } from '../../hooks/useAddDownloadTasks';


type CourseInfo = 'courses' | 'years' | 'semesters';

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
  courseList: LearningCourse[];
  setCourseList: (courses: LearningCourse[]) => void;
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
  const [academicYearList, setAcademicYearList] = useState<AcademicYear[]>([])
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<number | null>(null)
  const [selectedSemester, setSelectedSemester] = useState<number | null>(null)


  const [loading, setLoading] = useState({ courses: false, years: false, semesters: false });
  const [loadErrors, setLoadErrors] = useState({ courses: '', years: '', semesters: '' });
  const requests = useRef<Partial<Record<CourseInfo, symbol>>>({});
  const mounted = useRef(false);
  const loadCourses = useCallback(async (kind: CourseInfo = 'courses') => {
    if (!mounted.current || requests.current[kind]) return;
    const request = Symbol();
    requests.current[kind] = request;
    const isCurrent = () => mounted.current && requests.current[kind] === request;
    setLoading(current => ({ ...current, [kind]: true }));
    try {
      if (kind === 'courses') {
        const courses = await invoke<LearningCourse[]>('get_courses');
        if (isCurrent()) setCourseList(courses);
      } else if (kind === 'years') {
        const years = await invoke<AcademicYear[]>('get_academic_year_list');
        if (isCurrent()) setAcademicYearList(years.sort((a, b) => b.sort - a.sort));
      } else {
        const semesters = await invoke<Semester[]>('get_semester_list');
        if (isCurrent()) setSemesterList(semesters.sort((a, b) => b.sort - a.sort));
      }
      if (isCurrent()) {
        setLoadErrors(current => ({ ...current, [kind]: '' }));
        notification.destroy(`learning-${kind}-error`);
      }
    } catch (error) {
      if (!isCurrent()) return;
      setLoadErrors(current => ({ ...current, [kind]: String(error) }));
      const label = { courses: '课程', years: '学年', semesters: '学期' }[kind];
      notification.error({ key: `learning-${kind}-error`, title: `获取${label}列表失败`, description: String(error) });
    } finally {
      if (isCurrent()) {
        delete requests.current[kind];
        setLoading(current => ({ ...current, [kind]: false }));
      }
    }
  }, [notification, setCourseList]);

  useEffect(() => {
    mounted.current = true;
    void loadCourses('semesters');
    void loadCourses('years');
    void loadCourses();
    return () => { mounted.current = false; requests.current = {}; };
  }, [loadCourses]);

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

  const courseDetails = new Map(courseList.map(item => [item.id, {
    teachers: [...new Set((item.instructors ?? []).map(teacher => teacher.name?.trim()).filter(Boolean))].join('、'),
    term: semesterList.find(semester => semester.id === item.semester_id)?.name
      || academicYearList.find(year => year.id === item.academic_year_id)?.name || '',
  }]));
  const semester = semesterList.find(item => item.id === selectedSemester);
  const selectedCourses = courseList.filter(item => (
    (selectedSemester && semester && (item.semester_id === semester.id || (item.semester_id === 0 && item.academic_year_id === semester.academic_year_id))) ||
    (!selectedSemester && selectedAcademicYear && item.academic_year_id === selectedAcademicYear) ||
    (!selectedSemester && !selectedAcademicYear)
  )).map(item => ({ key: item.id, name: item.name, ...courseDetails.get(item.id)! }));
  const uploadsWithDetails = uploadList.map(item => ({
    ...item,
    teachers: courseDetails.get(item.course_id)?.teachers || '',
    term: courseDetails.get(item.course_id)?.term || '',
  }));

  const onAcademicYearChange = (value: number | null) => {
    setSelectedAcademicYear(value)
    setSelectedSemester(null)
    setSelectedCourseKeys([])
  };

  const onSemesterChange = (value: number | null) => {
    setSelectedSemester(value)
    setSelectedCourseKeys([])
  };

  const retryControl = (kind: 'years' | 'semesters', selectedName?: string) => <Tooltip
    title={loading[kind] ? null : `点击重新获取${kind === 'years' ? '学年' : '学期'}`} trigger={['hover', 'focus']}>
    <Button className="course-filter-retry" disabled={loading[kind]} aria-busy={loading[kind]}
      aria-label={`重新获取${kind === 'years' ? '学年' : '学期'}`} onClick={() => void loadCourses(kind)}>
      <span className="course-filter-status">{selectedName || (loading[kind] ? '正在获取…' : '加载失败')}</span>
      {loading[kind] ? <LoadingOutlined spin aria-hidden="true" /> : <ReloadOutlined aria-hidden="true" />}
    </Button>
  </Tooltip>;

  return <Workspace headerless title="学在浙大" panel={<>
    <PanelHeading><h2>学在浙大</h2></PanelHeading>
    <div className="panel-controls course-filters">
      <label>学年{loadErrors.years ? retryControl('years', academicYearList.find(item => item.id === selectedAcademicYear)?.name) : <Select popupMatchSelectWidth={false} aria-label="学年" placeholder={loading.years ? '正在获取…' : '全部学年'} allowClear showSearch optionFilterProp="label" value={selectedAcademicYear} onChange={onAcademicYearChange}
        options={academicYearList.map(item => ({ label: item.name, value: item.id }))} loading={loading.years} disabled={loading.years}
      />}</label>
      <label>学期{loadErrors.semesters ? retryControl('semesters', semesterList.find(item => item.id === selectedSemester)?.name) : <Select popupMatchSelectWidth={false} aria-label="学期" placeholder={loading.semesters ? '正在获取…' : '全部学期'} allowClear showSearch optionFilterProp="label" value={selectedSemester} onChange={onSemesterChange}
        options={semesterList.filter(item => !selectedAcademicYear || selectedAcademicYear === item.academic_year_id).map(item => ({ label: item.name, value: item.id }))} loading={loading.semesters} disabled={loading.semesters}
      />}</label>
    </div>
    <div className="panel-list"><ResourceList compact title="课程" items={loadErrors.courses ? [] : selectedCourses} itemKey={course => course.key}
      selectedKeys={loadErrors.courses ? [] : selectedCourseKeys} onSelectionChange={setSelectedCourseKeys} loading={loading.courses}
      emptyContent={loadErrors.courses ? <FetchState label="重新获取课程" onRetry={() => void loadCourses()} /> : undefined}
      fields={[{ label: '课程', value: course => course.name }, { label: '教师', value: course => course.teachers }, { label: '学期', value: course => course.term }]}
      renderItem={course => ({ title: course.name, titleField: '课程', subtitle: [{ text: course.teachers, field: '教师' }, { text: course.term, field: '学期' }] })} emptyIcon={<PlatformIcon platform="learning" />} emptyText="暂无课程" /></div>
    <div className="panel-bottom"><div className="setting-line"><span>自动同步</span><Switch aria-label="自动同步课件" disabled={!ready || loadingUploadList} checked={syncing} onChange={handleSwitchSync} /></div>
      <p>{autoDownload ? '新课件将自动下载，遵循文件排除设置。' : '新课件将添加到待下载列表。'}</p>
      <p>最后同步 · {lastSync || '未同步'}</p></div>
  </>}
    footer={<><span>已选 {selectedUploadKeys.length} 个文件 <span className="muted">· {bytesToSize(uploadList.filter(item => selectedUploadKeys.includes(item.reference_id)).reduce((sum, item) => sum + item.size, 0))}</span></span>
      <div className="footer-actions"><button className="text-button" onClick={() => setSelectedUploadKeys([])} disabled={!ready || loadingUploadList || !selectedUploadKeys.length}>取消选择</button><ActionButton variant="primary" onClick={downloadUploads} disabled={!ready || loadingUploadList || !selectedUploadKeys.length}><DownloadOutlined />下载所选课件</ActionButton></div></>}>
    {syncing && autoDownload && uploadList.length > 0 && <p className="muted">已按设置跳过 {uploadList.length} 个文件，可手动选择下载。</p>}
    {!ready ? <ConfigReadState icon={<PlatformIcon platform="learning" />} /> : <ResourceList actions={<ActionButton variant="secondary" onClick={updateUploadList} disabled={!ready || loadingUploadList} aria-busy={loadingUploadList}><ReloadOutlined spin={loadingUploadList} />{loadingUploadList ? (syncing ? '正在同步' : '正在获取') : (syncing ? '立即同步' : '获取课件')}</ActionButton>} title="文件列表" items={uploadsWithDetails} itemKey={item => item.reference_id}
      selectedKeys={selectedUploadKeys} onSelectionChange={setSelectedUploadKeys} loading={loadingUploadList}
      fields={[{ label: '文件名', value: item => item.file_name }, { label: '课程', value: item => item.course_name }, { label: '教师', value: item => item.teachers }, { label: '学期', value: item => item.term }]}
      sorts={[{ label: '大小升序', compare: (a, b) => a.size - b.size }, { label: '大小降序', compare: (a, b) => b.size - a.size }]}
      renderItem={item => ({ title: item.file_name, titleField: '文件名', subtitle: [{ text: item.course_name, field: '课程' }, { text: item.teachers, field: '教师' }, { text: item.term, field: '学期' }], icon: <FileTypeIcon name={item.file_name} />, meta: bytesToSize(item.size) })}
      emptyIcon={<PlatformIcon platform="learning" />} emptyText={syncing ? '暂无新的课件' : '选择课程后，点击“获取课件”'} />}
  </Workspace>
}
