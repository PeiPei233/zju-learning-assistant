import { refreshedSelection } from '../../utils';
import SelectionCheck from '../../components/SelectionCheck';
import PlatformIcon from '../../components/PlatformIcon';
import ConfigReadState from '../../components/ConfigReadState';
import { useDesktopApp } from '../../context/NotificationContext';
import FileTypeIcon from '../../components/FileTypeIcon';
import ActionButton from '../../components/ActionButton';
import Workspace from '../../components/Workspace';
import React, { useState, useRef, useEffect } from 'react'
import { Input, Segmented, DatePicker, Dropdown } from 'antd';
import { invoke } from '../../bridge'
import { ReloadOutlined, DownloadOutlined, SearchOutlined, DownOutlined } from '@ant-design/icons';
import ResourceList from '../../components/ResourceList'
import dayjs, { Dayjs } from 'dayjs';
import 'dayjs/locale/zh-cn';
import { ClassroomTask } from '../../downloadManager';
import { useConfig } from '../../context/ConfigContext';
import { useAddDownloadTasks } from '../../hooks/useAddDownloadTasks';
import { Subject } from '../../model';

dayjs.locale('zh-cn')

const { RangePicker } = DatePicker;

export default function Classroom() {

  const { notification } = useDesktopApp()
  const { savedConfig: config, ready } = useConfig();
  const addDownloadTasks = useAddDownloadTasks();
  const toPdf = config.to_pdf;
  const configRef = useRef(config);
  configRef.current = config;

  const [selectedDateMethod, setSelectedDateMethod] = useState<'day' | 'week' | 'month'>('week')
  const [selectedCourseRange, setSelectedCourseRange] = useState<'my' | 'all'>('my')
  const [leftSubList, setLeftSubList] = useState<Subject[]>([])
  const [rightSubList, setRightSubList] = useState<Subject[]>([])
  const [selectedLeftKeys, setSelectedLeftKeys] = useState<React.Key[]>([])
  const [selectedRightKeys, setSelectedRightKeys] = useState<React.Key[]>([])
  const [loadingLeftSubList, setLoadingLeftSubList] = useState(false)
  const [loadingRightSubList, setLoadingRightSubList] = useState(false)
  const requestInFlight = useRef(false);
  const loadingConditions = !ready || loadingLeftSubList || loadingRightSubList;
  const [hasSearchedCourses, setHasSearchedCourses] = useState(false)
  const [searchCourseName, setSearchCourseName] = useState('')
  const [searchTeacherName, setSearchTeacherName] = useState('')
  const startAt = useRef(dayjs().startOf('week').format('YYYY-MM-DD'))
  const endAt = useRef(dayjs().endOf('week').format('YYYY-MM-DD'))
  const [dayRange, setDayRange] = useState<[Dayjs, Dayjs]>([dayjs(), dayjs()])
  const [weekValue, setWeekValue] = useState<Dayjs>(dayjs())
  const [monthValue, setMonthValue] = useState<Dayjs>(dayjs())

  const selectDateMethodOptions = [
    { label: '日', value: 'day' },
    { label: '周', value: 'week' },
    { label: '月', value: 'month' },
  ]

  const selectCourseRangeOptions = [
    { label: '我的课程', value: 'my', description: '按日期查看自己的课堂' },
    { label: '全部课程', value: 'all', description: '按课程名称或教师搜索' }
  ]

  const changeDateMethod = (value: 'day' | 'week' | 'month') => {
    if (!ready || requestInFlight.current) return;
    setSelectedDateMethod(value)
    setDayRange([dayjs(), dayjs()]); setWeekValue(dayjs()); setMonthValue(dayjs());
    if (value === 'day') {
      startAt.current = dayjs().format('YYYY-MM-DD')
      endAt.current = dayjs().format('YYYY-MM-DD')
    } else if (value === 'week') {
      startAt.current = dayjs().startOf('week').format('YYYY-MM-DD')
      endAt.current = dayjs().endOf('week').format('YYYY-MM-DD')
    } else {
      startAt.current = dayjs().startOf('month').format('YYYY-MM-DD')
      endAt.current = dayjs().endOf('month').format('YYYY-MM-DD')
    }
    updateMySubList()
  }

  const changeDateRange = (value: any) => {
    if (!ready || requestInFlight.current) return;
    if (!value || (Array.isArray(value) && (!value[0] || !value[1]))) return;
    if (selectedDateMethod === 'day') {
      setDayRange(value)
      startAt.current = value[0].format('YYYY-MM-DD')
      endAt.current = value[1].format('YYYY-MM-DD')
    } else if (selectedDateMethod === 'week') {
      setWeekValue(value)
      startAt.current = value.startOf('week').format('YYYY-MM-DD')
      endAt.current = value.endOf('week').format('YYYY-MM-DD')
    } else {
      setMonthValue(value)
      startAt.current = value.startOf('month').format('YYYY-MM-DD')
      endAt.current = value.endOf('month').format('YYYY-MM-DD')
    }
    updateMySubList()
  }

  const updateMySubList = () => {
    if (!ready || requestInFlight.current) return;
    requestInFlight.current = true;
    setLoadingRightSubList(true)
    invoke<Subject[]>('get_range_subs', { startAt: startAt.current, endAt: endAt.current }).then((res) => {
      setRightSubList(res)
      setSelectedRightKeys(previous => refreshedSelection(previous, res.map(item => item.sub_id), configRef.current.auto_select_all_courseware))
    }).catch((err) => {
      notification.error({
        title: '获取课程列表失败',
        description: String(err)
      })
    }).finally(() => {
      requestInFlight.current = false;
      setLoadingRightSubList(false)
    })
  }

  const updateAllSubList = () => {
    if (!ready || requestInFlight.current) return;
    const subs = leftSubList.filter((item) => selectedLeftKeys.includes(item.course_id))
    if (subs.length === 0) {
      notification.error({
        title: '请选择课程',
      })
      return
    }
    requestInFlight.current = true;
    const course_ids = subs.map((item) => item.course_id)
    setLoadingRightSubList(true)
    invoke<Subject[]>('get_course_all_sub_ppts', { courseIds: course_ids }).then((res) => {
      const subs = res.filter((item) => item.ppt_image_urls.length !== 0)
      setRightSubList(subs)
      setSelectedRightKeys(previous => refreshedSelection(previous, subs.map(item => item.sub_id), configRef.current.auto_select_all_courseware))
    }).catch((err) => {
      notification.error({
        title: '获取课件列表失败',
        description: String(err)
      })
    }).finally(() => {
      requestInFlight.current = false;
      setLoadingRightSubList(false)
    })
  }

  useEffect(() => {
    if (ready && selectedCourseRange === 'my') updateMySubList()
    // Load when configuration becomes available; changing the search fields must not trigger a request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  const downloadSubsPPT = async () => {
    const subs = rightSubList.filter((item) => selectedRightKeys.includes(item.sub_id))
    if (subs.length === 0) {
      notification.error({
        title: '请选择课件',
      })
      return
    }
    const tasks = subs.map((item) => new ClassroomTask(item, toPdf))
    if (!await addDownloadTasks(tasks)) return
    const addedKeys = new Set(subs.map(item => item.sub_id))
    setRightSubList(current => current.filter(item => !addedKeys.has(item.sub_id)))
    setSelectedRightKeys(current => current.filter(key => !addedKeys.has(key as number)))
  }

  const searchCourse = () => {
    if (!ready || requestInFlight.current) return;
    if (searchCourseName === '' && searchTeacherName === '') {
      notification.error({
        title: '请输入搜索关键字',
      })
      return
    }
    requestInFlight.current = true;
    setLoadingLeftSubList(true)
    invoke<Subject[]>('search_courses', { courseName: searchCourseName, teacherName: searchTeacherName }).then((res) => {
      setHasSearchedCourses(true)
      setLeftSubList(res)
      setSelectedLeftKeys([])
    }).catch((err) => {
      notification.error({
        title: '搜索课程失败',
        description: String(err)
      })
    }).finally(() => {
      requestInFlight.current = false;
      setLoadingLeftSubList(false)
    })
  }

  return <Workspace headerless title="智云课堂" panel={<>
    <div className="panel-heading course-range-heading">
      <Dropdown disabled={loadingConditions} trigger={['click']} placement="bottomLeft" overlayClassName="course-range-menu" menu={{
        selectable: true, selectedKeys: [selectedCourseRange],
        items: selectCourseRangeOptions.map(option => ({
          key: option.value, label: <div className="course-range-option">
            <span><span className="course-range-name">{option.label}</span><span className="course-range-description">{option.description}</span></span>
            <SelectionCheck selected={selectedCourseRange === option.value} />
          </div>
        })),
        onClick: ({ key }) => {
          if (requestInFlight.current || key === selectedCourseRange) return;
          setHasSearchedCourses(false);
          setLeftSubList([]); setSelectedLeftKeys([]); setRightSubList([]); setSelectedRightKeys([]);
          setSelectedCourseRange(key as 'my' | 'all'); if (key === 'my') updateMySubList();
        },
      }}>
        <ActionButton disabled={loadingConditions} className="course-range-trigger" aria-label={`智云课堂 · ${selectedCourseRange === 'my' ? '我的课程' : '全部课程'}，切换课程范围`}>
          <span className="course-range-label"><span className="course-range-title">智云课堂</span><span className="course-range-divider" aria-hidden="true">·</span><span className="course-range-current">{selectedCourseRange === 'my' ? '我的课程' : '全部课程'}</span></span><DownOutlined />
        </ActionButton>
      </Dropdown>
    </div>
    <div className="panel-controls">
      {selectedCourseRange === 'my' ? <>
        <label>日期范围<Segmented disabled={loadingConditions} block options={selectDateMethodOptions} value={selectedDateMethod} onChange={v => changeDateMethod(v as 'day' | 'week' | 'month')} /></label>
        {selectedDateMethod === 'day' ? <RangePicker allowClear={false} value={dayRange} onChange={changeDateRange} disabled={loadingConditions} /> :
          <DatePicker allowClear={false} value={selectedDateMethod === 'week' ? weekValue : monthValue} picker={selectedDateMethod} onChange={changeDateRange} disabled={loadingConditions} />}
      </> : <>
        <Input disabled={loadingConditions} aria-label="课程名称" placeholder="课程名称" value={searchCourseName} onChange={e => setSearchCourseName(e.target.value)} onPressEnter={searchCourse} />
        <Input disabled={loadingConditions} aria-label="教师名称" placeholder="教师名称" value={searchTeacherName} onChange={e => setSearchTeacherName(e.target.value)} onPressEnter={searchCourse} />
        <ActionButton variant="secondary" onClick={searchCourse} disabled={loadingConditions} aria-busy={loadingLeftSubList}>{loadingLeftSubList ? <ReloadOutlined spin /> : <SearchOutlined />}{loadingLeftSubList ? '正在搜索' : '搜索课程'}</ActionButton>
      </>}
    </div>
    {selectedCourseRange === 'all' && <div className="panel-list"><ResourceList<Subject> compact fieldFilters emptyIcon={<PlatformIcon platform="classroom" />} emptyText={hasSearchedCourses ? '未找到课程，请调整课程名称或教师后重试' : '输入课程名称或教师，搜索全部课程'} searchPlaceholder="筛选搜索结果…" title="课程" items={leftSubList} itemKey={item => item.course_id}
      selectedKeys={selectedLeftKeys} onSelectionChange={setSelectedLeftKeys} loading={loadingLeftSubList}
      fields={[{ label: '课程', value: item => item.course_name }, { label: '教师', value: item => item.lecturer_name }, { label: '时间', value: item => item.sub_name }]}
      renderItem={item => ({ title: item.course_name, subtitle: `${item.lecturer_name} · ${item.sub_name}` })} /></div>}
    <div className="panel-bottom"><p>下载格式 · {toPdf ? 'PDF' : '图片'}</p><p>字幕与 AI 处理选项可在设置中调整。</p></div>
  </>}
    footer={<><span>已选 {selectedRightKeys.length} 个课件 <span className="muted">· {rightSubList.filter(item => selectedRightKeys.includes(item.sub_id)).reduce((sum, item) => sum + item.ppt_image_urls.length, 0)} 页</span></span>
      <div className="footer-actions"><button className="text-button" onClick={() => setSelectedRightKeys([])} disabled={!ready || loadingRightSubList || !selectedRightKeys.length}>取消选择</button><ActionButton variant="primary" onClick={downloadSubsPPT} disabled={!ready || loadingRightSubList || !selectedRightKeys.length}><DownloadOutlined />下载所选课件</ActionButton></div></>}>
    {!ready ? <ConfigReadState icon={<PlatformIcon platform="classroom" />} /> : <ResourceList<Subject> actions={<ActionButton variant="secondary" onClick={selectedCourseRange === 'my' ? updateMySubList : updateAllSubList} disabled={loadingConditions} aria-busy={loadingRightSubList}><ReloadOutlined spin={loadingRightSubList} />{loadingRightSubList ? '正在获取' : '获取课件'}</ActionButton>} title="课堂课件" items={rightSubList} itemKey={item => item.sub_id} selectedKeys={selectedRightKeys} onSelectionChange={setSelectedRightKeys}
      loading={loadingRightSubList} fields={[{ label: '课程', value: item => item.course_name }, { label: '时间', value: item => item.sub_name }, { label: '教师', value: item => item.lecturer_name }]}
      sorts={[{ label: '课程升序', compare: (a, b) => a.course_name.localeCompare(b.course_name) }, { label: '课程降序', compare: (a, b) => b.course_name.localeCompare(a.course_name) },
      { label: '时间升序', compare: (a, b) => a.sub_name.localeCompare(b.sub_name) }, { label: '时间降序', compare: (a, b) => b.sub_name.localeCompare(a.sub_name) },
      { label: '页数升序', compare: (a, b) => a.ppt_image_urls.length - b.ppt_image_urls.length }, { label: '页数降序', compare: (a, b) => b.ppt_image_urls.length - a.ppt_image_urls.length }]}
      renderItem={item => ({ title: item.course_name, subtitle: `${item.sub_name} · ${item.lecturer_name}`, icon: <FileTypeIcon name={item.course_name} extension={toPdf ? 'pdf' : 'png'} />, meta: `${item.ppt_image_urls.length} 页` })}
      emptyIcon={<PlatformIcon platform="classroom" />} emptyText="当前范围内暂无课件，可调整范围后重新获取" />}
  </Workspace>
}
