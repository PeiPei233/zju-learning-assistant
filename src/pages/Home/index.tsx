import React, { useEffect, useState, useRef } from 'react'
import { App, Menu, Layout, Tooltip, Badge, Typography } from 'antd';
import { invoke } from '@tauri-apps/api/core'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { LogoutOutlined, DownloadOutlined, SettingOutlined, FileSearchOutlined } from '@ant-design/icons';
import Learning from '../Learning'
import Classroom from '../Classroom'
import Score from '../Score'
import Settings from '../../components/Settings'
import DownloadDrawer from '../../components/DownloadDrawer';
import { LearningTask, Task } from '../../downloadManager';
import { listen } from '@tauri-apps/api/event';
import { exit } from '@tauri-apps/plugin-process';
import { Config, Upload, VersionInfo } from '../../model';
import dayjs from 'dayjs'
import LearningIcon from '../../assets/images/learning.ico'
import ClassroomIcon from '../../assets/images/classroom.png'
import * as shell from "@tauri-apps/plugin-shell"
import { useConfig } from '../../context/ConfigContext';
import { useDownloadList, useDownloadManager, useDownloadDrawer } from '../../context/DownloadContext';

const { Header, Content } = Layout;

interface HomeProps {
  setIsLogin: (isLogin: boolean) => void;
  setAutoLoginUsername: (username: string) => void;
  setAutoLoginPassword: (password: string) => void;
  currentVersion: string;
  latestVersionData: VersionInfo | null;
  setOpenVersionModal: (open: boolean) => void;
}

interface ScoreItem {
  xkkh: string;
  kcmc: string;
  cj: string;
  xf: string;
  jd: string;
  bkcj: string;
}

interface Course {
  id: number;
  name: string;
  semester_id: number;
  academic_year_id: number;
}

interface TodoItem {
  id: string;
  course_id: string;
  title: string;
  course_name: string;
  end_time: string;
}

export default function Home({
  setIsLogin,
  setAutoLoginUsername,
  setAutoLoginPassword,
  currentVersion,
  latestVersionData,
  setOpenVersionModal
}: HomeProps) {

  const { modal, notification } = App.useApp()
  const { config } = useConfig();
  const downloadManager = useDownloadManager();

  // Destructure tasks and count here
  const { count: downloadingCount, tasks: downloadTasks } = useDownloadList();
  const { isDrawerOpen, openDrawer, closeDrawer } = useDownloadDrawer();

  const [current, setCurrent] = useState('learning')

  const [score, setScore] = useState<ScoreItem[]>([])
  const [loadingScore, setLoadingScore] = useState(false)
  const [notifyScore, setNotifyScore] = useState(false)
  const [lastSyncScore, setLastSyncScore] = useState<string | null>(null)
  const [totalGp, setTotalGp] = useState(0)
  const [totalCredit, setTotalCredit] = useState(0)

  const [openSettingDrawer, setOpenSettingDrawer] = useState(false)

  const [courseList, setCourseList] = useState<Course[]>([])
  const [selectedCourseKeys, setSelectedCourseKeys] = useState<React.Key[]>([])
  const [loadingUploadList, setLoadingUploadList] = useState(false)
  const [uploadList, setUploadList] = useState<Upload[]>([])
  const [selectedUploadKeys, setSelectedUploadKeys] = useState<React.Key[]>([])
  const [syncingUpload, setSyncingUpload] = useState(false)
  const [lastSyncUpload, setLastSyncUpload] = useState<string | null>(null)

  const syncScoreTimer = useRef<any>(null)
  const syncUploadTimer = useRef<any>(null)
  const selectedCourseKeysRef = useRef(selectedCourseKeys)
  const configRef = useRef(config)
  const notifiedTodo = useRef<Record<string, boolean>>({})
  const todoList = useRef<TodoItem[]>([])

  useEffect(() => {
    selectedCourseKeysRef.current = selectedCourseKeys
  }, [selectedCourseKeys])

  useEffect(() => {
    configRef.current = config
    downloadManager.maxConcurrentTasks = config.max_concurrent_tasks
  }, [config, downloadManager])

  function notifyUpdate(item: ScoreItem, oldTotalGp: number, oldTotalCredit: number, totalGp: number, totalCredit: number, dingUrl?: string) {
    if (!dingUrl) {
      dingUrl = config.ding_url
    }
    invoke('notify_score', {
      score: item,
      oldTotalGp,
      oldTotalCredit,
      totalGp,
      totalCredit,
      dingUrl
    }).catch((err) => {
      notification.error({
        message: '发送通知失败',
        description: String(err)
      })
    })
  }

  function updateScore(newScore: ScoreItem[]) {
    const oldScore = score
    setScore(newScore)
    setLastSyncScore(dayjs().format('YYYY-MM-DD HH:mm:ss'))

    let currentGp = 0
    let currentCredit = 0

    oldScore.forEach((item) => {
      if (item.cj !== '合格' && item.cj !== '不合格' && item.cj !== '弃修') {
        currentGp += parseFloat(item.jd) * parseFloat(item.xf)
        currentCredit += parseFloat(item.xf)
      }
    })

    newScore.forEach((item) => {
      const oldItem = oldScore.find((oi) => oi.xkkh === item.xkkh)
      if (oldItem) {
        if (oldItem.cj !== item.cj || oldItem.bkcj !== item.bkcj || oldItem.jd !== item.jd || oldItem.xf !== item.xf) {
          let oldTotalGp = currentGp
          let oldTotalCredit = currentCredit
          if (item.cj !== '合格' && item.cj !== '不合格' && item.cj !== '弃修') {
            currentGp += parseFloat(item.jd) * parseFloat(item.xf) - parseFloat(oldItem.jd) * parseFloat(oldItem.xf)
            currentCredit += parseFloat(item.xf) - parseFloat(oldItem.xf)
          }
          if (notifyScore) {
            notifyUpdate(item, oldTotalGp, oldTotalCredit, currentGp, currentCredit)
          }
        }
      } else {
        let oldTotalGp = currentGp
        let oldTotalCredit = currentCredit
        if (item.cj !== '合格' && item.cj !== '不合格' && item.cj !== '弃修') {
          currentGp += parseFloat(item.jd) * parseFloat(item.xf)
          currentCredit += parseFloat(item.xf)
        }
        if (notifyScore) {
          notifyUpdate(item, oldTotalGp, oldTotalCredit, currentGp, currentCredit)
        }
      }
    })

    setTotalGp(currentGp)
    setTotalCredit(currentCredit)
  }

  const startSyncScore = () => {
    const syncScoreTask = () => {
      setLoadingScore(true)
      invoke<ScoreItem[]>('get_score').then((res) => {
        updateScore(res)
      }).catch((err) => {
        notification.error({
          message: '成绩同步失败',
          description: String(err)
        })
      }).finally(() => {
        const nextSync = Math.floor(Math.random() * 60000) + 60000
        syncScoreTimer.current = setTimeout(syncScoreTask, nextSync)
        setLoadingScore(false)
      })
    }
    syncScoreTask()
  }

  const stopSyncScore = () => {
    clearTimeout(syncScoreTimer.current)
    syncScoreTimer.current = null
  }

  const handleSyncScore = () => {
    if (loadingScore) return
    setLoadingScore(true)
    invoke<ScoreItem[]>('get_score').then((res) => {
      updateScore(res)
      invoke<boolean>('check_evaluation_done').then((evalDone) => {
        if (!evalDone) {
          notification.warning({
            message: '教学评价未完成',
            description: '本学期尚未完成评价，无法查询最新成绩！',
            btn: <button onClick={() => shell.open('https://alt.zju.edu.cn/studentEvaluationBackend/list')}>去评价</button>
          })
        } else {
          notification.success({ message: '成绩同步成功' })
        }
      }).catch((err) => {
        notification.error({ message: '查询教学评价失败', description: String(err) })
      })
    }).catch((err) => {
      notification.error({ message: '成绩同步失败', description: String(err) })
    }).finally(() => {
      setLoadingScore(false)
    })
  }

  const handleSwitchSyncScore = (checked: boolean) => {
    setNotifyScore(checked)
    if (checked) startSyncScore()
    else stopSyncScore()
  }

  const syncTodoTask = () => {
    invoke<TodoItem[]>('sync_todo_once').then((res) => {
      if (res && res.length !== 0) {
        todoList.current = res
        res.forEach(async (item) => {
          if (item.end_time) {
            const key = `${item.course_id}-${item.id}-${item.end_time}`
            const diffTime = dayjs(item.end_time).diff(dayjs(), 'minute')
            if (!notifiedTodo.current[key] && diffTime <= 60 && diffTime > 0) {
              let permissionGranted = await isPermissionGranted();
              if (!permissionGranted) {
                const permission = await requestPermission();
                permissionGranted = permission === 'granted';
              }
              if (permissionGranted) {
                sendNotification({
                  title: `距离 ${item.title} 截止不足一个小时`,
                  body: `${item.course_name}-${item.title}: ${dayjs(item.end_time).format('YYYY-MM-DD HH:mm:ss')}`
                });
                notifiedTodo.current[key] = true
              }
            }
          }
        })
      }
    })
  }

  useEffect(() => {
    setAutoLoginUsername('')
    setAutoLoginPassword('')
    invoke<boolean>('check_login').then((res) => {
      if (!res) setIsLogin(false)
    }).catch(() => setIsLogin(false))

    // Download list polling is now handled by useDownloadList hook inside components that need it (like DownloadDrawer)
    // We only need the count here, which is provided by useDownloadList() called at the top.

    syncTodoTask()
    const syncTodoInterval = setInterval(syncTodoTask, 60000)

    const unlistenProgress = listen<any>('download-progress', (res) => {
      downloadManager.updateProgress(res.payload)
    })

    const unlistenClose = listen('close-requested', () => {
      if (!configRef.current.tray) exit(0)
    })

    const unlistenExportTodo = listen<string>('export-todo', (res) => {
      invoke('export_todo', { todoList: todoList.current, location: res.payload })
    })

    return () => {
      stopSyncScore()
      stopSyncUpload()
      // downloadManager.cleanUp() // Do NOT clean up on unmount, as manager is global singleton now
      clearInterval(syncTodoInterval)
      unlistenProgress.then((fn) => fn())
      unlistenClose.then((fn) => fn())
      unlistenExportTodo.then((fn) => fn())
    }
  }, [setAutoLoginPassword, setAutoLoginUsername, setIsLogin, downloadManager])

  const logout = () => {
    const doLogout = () => {
      downloadManager.cleanUp();
      invoke('logout').then(() => setIsLogin(false)).catch((err) => notification.error({ message: '退出登录失败', description: String(err) }));
    };
    if (downloadingCount > 0 || syncingUpload || notifyScore) {
      modal.confirm({
        title: '后台服务正在运行',
        content: '是否停止课件同步、成绩提醒、课件下载等后台服务并退出登录？',
        onOk: doLogout
      })
    } else doLogout()
  }

  const onMenuClick = ({ key }: { key: string }) => {
    if (key === 'logout') logout()
    else if (key === 'download') openDrawer() // Correctly call Context method
    else if (key === 'setting') setOpenSettingDrawer(true)
    else setCurrent(key)
  }

  const updateUploadList = () => {
    let courses = courseList.filter((item) => selectedCourseKeys.includes(item.id))
    if (courses.length === 0) {
      notification.error({ message: '请选择课程' })
      return
    }
    setLoadingUploadList(true)
    invoke<Upload[]>('get_uploads_list', { courses, syncUpload: syncingUpload }).then((res) => {
      if (syncingUpload) {
        setLastSyncUpload(dayjs().format('YYYY-MM-DD HH:mm:ss'))
        if (config.auto_download) {
          res.forEach((item) => downloadManager.addTask(new LearningTask(item, true), true))
          setUploadList([])
          setSelectedUploadKeys([])
        } else {
          setUploadList(res)
          setSelectedUploadKeys(res.map((item) => item.reference_id))
        }
      } else {
        setUploadList(res)
        setSelectedUploadKeys(res.map((item) => item.reference_id))
      }
    }).catch((err) => {
      notification.error({ message: '获取课件列表失败', description: String(err) })
    }).finally(() => setLoadingUploadList(false))
  }

  const startSyncUpload = () => {
    const syncUploadTask = () => {
      let courses = courseList.filter((item) => selectedCourseKeysRef.current.includes(item.id))
      setLoadingUploadList(true)
      invoke<Upload[]>('get_uploads_list', { courses, syncUpload: true }).then((uploads) => {
        if (configRef.current.auto_download) {
          uploads.forEach((item) => downloadManager.addTask(new LearningTask(item, true), true))
          setUploadList(uploads.filter((item) => !selectedUploadKeys.includes(item.reference_id)))
          setSelectedUploadKeys([])
        } else {
          setUploadList(uploads)
          setSelectedUploadKeys(uploads.map((item) => item.reference_id))
        }
        setLastSyncUpload(dayjs().format('YYYY-MM-DD HH:mm:ss'))
      }).catch((err) => {
        notification.error({ message: '同步课件失败', description: String(err) })
      }).finally(() => {
        const nextSync = Math.floor(Math.random() * 60000) + 60000
        syncUploadTimer.current = setTimeout(syncUploadTask, nextSync)
        setLoadingUploadList(false)
      })
    }
    syncUploadTask()
  }

  const stopSyncUpload = () => {
    clearTimeout(syncUploadTimer.current)
    syncUploadTimer.current = null
  }

  const handleSwitchSyncUpload = (checked: boolean) => {
    setSyncingUpload(checked)
    if (checked) startSyncUpload()
    else stopSyncUpload()
  }

  return (
    <Layout className='home-layout'>
      <Header className='home-layout' style={{ display: 'flex', alignItems: 'center', padding: '0 16px', height: 40, marginBottom: 10 }}>
        <Menu onClick={onMenuClick} selectedKeys={[current]} mode="horizontal" style={{ width: '100%', lineHeight: '40px' }}>
          <Menu.Item key='learning' icon={<img src={LearningIcon} style={{ width: 14 }} alt="learning" />}>
            <Tooltip title={syncingUpload ? `学在浙大课件同步正在运行 - 上次同步时间：${lastSyncUpload}` : ''}>
              <Badge dot={true} count={syncingUpload ? 1 : 0} color='green'>
                <span style={{ color: current === 'learning' ? '#1677ff' : undefined }}>学在浙大</span>
              </Badge>
            </Tooltip>
          </Menu.Item>
          <Menu.Item key='classroom' icon={<img src={ClassroomIcon} style={{ width: 14 }} alt="classroom" />}>智云课堂</Menu.Item>
          <Menu.Item key='score' icon={<FileSearchOutlined />}>
            <Tooltip title={notifyScore ? `成绩提醒正在运行 - 上次同步时间：${lastSyncScore}` : ''}>
              <Badge dot={true} count={notifyScore ? 1 : 0} color='green'>
                <span style={{ color: current === 'score' ? '#1677ff' : undefined }}>成绩查询</span>
              </Badge>
            </Tooltip>
          </Menu.Item>
        </Menu>
        <Menu onClick={onMenuClick} selectedKeys={[current]} mode="horizontal" style={{ float: 'right', lineHeight: '40px', minWidth: 46 * 3 }}>
          <Menu.Item key='download'>
            <Badge count={downloadingCount} size='small'>
              <Tooltip title='下载列表'><DownloadOutlined /></Tooltip>
            </Badge>
          </Menu.Item>
          <Menu.Item key='setting'>
            <Tooltip title='设置'>
              <Badge count={(!latestVersionData || (latestVersionData && latestVersionData.version === currentVersion) ? 0 : 1)} dot>
                <SettingOutlined />
              </Badge>
            </Tooltip>
          </Menu.Item>
          <Menu.Item key='logout'><Tooltip title='退出登录'><LogoutOutlined /></Tooltip></Menu.Item>
        </Menu>
      </Header>
      <Content>
        {current === 'learning' && <Learning
          syncing={syncingUpload}
          lastSync={lastSyncUpload}
          loadingUploadList={loadingUploadList}
          uploadList={uploadList}
          setUploadList={setUploadList}
          handleSwitchSync={handleSwitchSyncUpload}
          updateUploadList={updateUploadList}
          selectedUploadKeys={selectedUploadKeys}
          setSelectedUploadKeys={setSelectedUploadKeys}
          selectedCourseKeys={selectedCourseKeys}
          setSelectedCourseKeys={setSelectedCourseKeys}
          courseList={courseList}
          setCourseList={setCourseList}
        />}
        {current === 'classroom' && <Classroom />}
        {current === 'score' && <Score
          notify={notifyScore}
          lastSync={lastSyncScore}
          totalGp={totalGp}
          totalCredit={totalCredit}
          loading={loadingScore}
          score={score}
          handleSwitch={handleSwitchSyncScore}
          handleSync={handleSyncScore}
        />}
      </Content>
      {/* Updated: using downloadTasks from hook */}
      <DownloadDrawer
        open={isDrawerOpen}
        onClose={closeDrawer}
        taskList={downloadTasks}
        downloadManager={downloadManager}
      />
      <Settings
        open={openSettingDrawer}
        onClose={() => setOpenSettingDrawer(false)}
        currentVersion={currentVersion}
        latestVersionData={latestVersionData}
        setOpenVersionModal={setOpenVersionModal}
      />
    </Layout>
  )
}