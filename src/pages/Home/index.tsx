import { useScores } from '../../hooks/useScores';
import { useTodos } from '../../hooks/useTodos';
import Todo from '../Todo';
import { refreshedSelection } from '../../utils';
import PreviewMenu from "../../components/PreviewMenu";
import { useDesktopApp } from '../../context/NotificationContext';
import ModuleFrame from '../../components/ModuleFrame';
import PlatformIcon from '../../components/PlatformIcon';
import { getPreviewData, isPreview } from '../../previewMode';
import WindowChrome from '../../components/WindowChrome';
import { PanelContext } from '../../context/PanelContext';
import { QuestionCircleOutlined } from '@ant-design/icons';
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Tooltip, Badge } from 'antd';
import { invoke, listen, exit, shell } from '../../bridge';

import { LogoutOutlined, DownloadOutlined, SettingOutlined, FileSearchOutlined, UnorderedListOutlined } from '@ant-design/icons';
import Learning from '../Learning'
import Classroom from '../Classroom'
import Score from '../Score'
import Settings from '../../components/Settings'
import Downloads from '../../components/Downloads';
import { LearningTask } from '../../downloadManager';

import { Upload, VersionInfo } from '../../model';
import dayjs from 'dayjs'

import { useConfig } from '../../context/ConfigContext';
import { useDownloadList, useDownloadManager, useDownloadNavigation } from '../../context/DownloadContext';
import { isFileExtensionExcluded } from '../../utils';

interface HomeProps {
  setIsLogin: (isLogin: boolean) => void;
  setAutoLoginUsername: (username: string) => void;
  setAutoLoginPassword: (password: string) => void;
  currentVersion: string;
  latestVersionData: VersionInfo | null;
  setOpenVersionModal: (open: boolean) => void;
}



interface Course {
  id: number;
  name: string;
  semester_id: number;
  academic_year_id: number;
}

const getDefaultSelectedUploadKeys = (uploads: Upload[], excludedExtensions: readonly string[] = []): React.Key[] => (
  uploads
    .filter((item) => !isFileExtensionExcluded(item.file_name, excludedExtensions))
    .map((item) => item.reference_id)
)

export default function Home({
  setIsLogin,
  setAutoLoginUsername,
  setAutoLoginPassword,
  currentVersion,
  latestVersionData,
  setOpenVersionModal
}: HomeProps) {

  const { modal, notification } = useDesktopApp()
  const { savedConfig: config, ready } = useConfig();
  const configReady = useRef(ready); configReady.current = ready;
  const downloadManager = useDownloadManager();

  // Destructure tasks and count here
  const { count: downloadingCount, tasks: downloadTasks } = useDownloadList();
  const { pageRequested, consumePageRequest } = useDownloadNavigation();

  const [panelCollapsed, setPanelCollapsed] = useState(() => localStorage.getItem('context-panel-collapsed') === 'true');
  const [panelWidth, setPanelWidth] = useState(() => {
    const stored = Number(localStorage.getItem('context-panel-width'));
    return stored >= 200 && stored <= 420 ? stored : 250;
  });
  const resizePanel = (width: number) => { setPanelWidth(width); localStorage.setItem('context-panel-width', String(width)); };
  const togglePanel = () => {
    clearTimeout(peekTimer.current);
    if (peek) setCurrent(peek);
    setPeek(null);
    setPanelCollapsed(value => { localStorage.setItem('context-panel-collapsed', String(!value)); return !value; });
  };
  const [current, setCurrent] = useState(() => {
    const page = isPreview ? new URLSearchParams(location.search).get('page') : null;
    return page && ['learning', 'classroom', 'score', 'todo', 'download', 'setting'].includes(page) ? page : 'learning';
  })
  const [visited, setVisited] = useState([current]);
  const [peek, setPeek] = useState<string | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout>>();
  const keepPeek = () => clearTimeout(peekTimer.current);
  const dismissPeek = () => {
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => {
      // Select menus live in a portal; keep the sidebar available while using one.
      if (document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden), .ant-picker-dropdown:not(.ant-picker-dropdown-hidden)')) return;
      setPeek(null);
    }, 240);
  };
  const hoverModule = (page: string) => {
    if (!panelCollapsed) return;
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => {
      setVisited(pages => pages.includes(page) ? pages : [...pages, page]);
      setPeek(page);
    }, 160);
  };
  const railPreview = (page: string) => ({
    'data-module': page,
    'aria-expanded': panelCollapsed ? peek === page : current === page,
    onPointerEnter: (event: React.PointerEvent) => { if (event.pointerType !== 'touch') hoverModule(page); },
    onPointerLeave: dismissPeek,
    onFocus: () => hoverModule(page),
    onBlur: dismissPeek,
  });
  useEffect(() => () => clearTimeout(peekTimer.current), []);
  useEffect(() => {
    if (!peek) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element).closest('.context-panel, .navigation-rail, .ant-select-dropdown, .ant-picker-dropdown, .ant-modal-root')) {
        clearTimeout(peekTimer.current); setPeek(null);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearTimeout(peekTimer.current); setPeek(null);
        // Avoid focus-trigger reopening after Escape.
        (document.activeElement as HTMLElement)?.blur?.();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [peek]);
  const navigate = useCallback((page: string) => {
    setVisited(pages => pages.includes(page) ? pages : [...pages, page]);
    setCurrent(page);
    clearTimeout(peekTimer.current);
    setPeek(null);
  }, []);
  useEffect(() => {
    if (pageRequested) { navigate('download'); consumePageRequest(); }
  }, [pageRequested, consumePageRequest, navigate]);

  const { score, loadingScore, scoreConfigError, lastSyncScore, totalGp, totalCredit, handleSyncScore } = useScores();

  const [courseList, setCourseList] = useState<Course[]>(() => getPreviewData()?.courses || [])
  const [selectedCourseKeys, setSelectedCourseKeys] = useState<React.Key[]>(() => getPreviewData()?.courses.map(item => item.id) || [])
  const [loadingUploadList, setLoadingUploadList] = useState(false)
  const [uploadList, setUploadList] = useState<Upload[]>(() => getPreviewData()?.uploads || [])
  const [selectedUploadKeys, setSelectedUploadKeys] = useState<React.Key[]>(() => getPreviewData()?.uploads.slice(0, 3).map(item => item.reference_id) || [])
  const [syncingUpload, setSyncingUpload] = useState(false)
  const [lastSyncUpload, setLastSyncUpload] = useState<string | null>(null)

  const syncUploadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const uploadRequestInFlight = useRef(false)
  const uploadRun = useRef(0)
  const courseListRef = useRef(courseList)
  courseListRef.current = courseList
  const selectedCourseKeysRef = useRef(selectedCourseKeys)
  const configRef = useRef(config)
  const todos = useTodos();

  useEffect(() => {
    selectedCourseKeysRef.current = selectedCourseKeys
  }, [selectedCourseKeys])

  useEffect(() => {
    configRef.current = config
    if (ready) downloadManager.maxConcurrentTasks = config.max_concurrent_tasks
  }, [config, ready, downloadManager])

  useEffect(() => {
    setAutoLoginUsername('')
    setAutoLoginPassword('')
    invoke<boolean>('check_login').then((res) => {
      if (!res) setIsLogin(false)
    }).catch(() => setIsLogin(false))

    // DownloadManager publishes list and count changes through useDownloadList.


    const unlistenProgress = listen<any>('download-progress', (res) => {
      downloadManager.updateProgress(res.payload)
    })

    const unlistenClose = listen('close-requested', () => {
      if (!configRef.current.tray) exit(0)
    })

    return () => {
      stopSyncUpload()
      // downloadManager.cleanUp() // Do NOT clean up on unmount, as manager is global singleton now
      unlistenProgress.then((fn) => fn())
      unlistenClose.then((fn) => fn())
    }
  }, [setAutoLoginPassword, setAutoLoginUsername, setIsLogin, downloadManager])

  const logoutInFlight = useRef(false);
  const logout = () => {
    if (logoutInFlight.current) return;
    const doLogout = async () => {
      if (logoutInFlight.current) return;
      logoutInFlight.current = true;
      try {
        if (!await downloadManager.cleanUp()) {
          notification.error({ title: '退出登录失败', description: '下载任务尚未全部停止，请在下载列表查看任务状态后重试。' });
          return;
        }
        await invoke('logout');
        setIsLogin(false);
      } catch (err) {
        notification.error({ title: '退出登录失败', description: String(err) });
      } finally {
        logoutInFlight.current = false;
      }
    };
    if (downloadingCount > 0 || syncingUpload) {
      modal.confirm({
        className: 'desktop-modal desktop-confirm',
        width: 400,
        centered: true,
        icon: null,
        title: '停止后台任务并退出登录？',
        content: `退出后将停止${[syncingUpload && '课件同步', downloadingCount > 0 && `${downloadingCount} 项下载任务`].filter(Boolean).join('、')}。`,
        okText: '停止并退出',
        cancelText: '取消',
        cancelButtonProps: { autoInsertSpace: false },
        autoFocusButton: 'cancel',
        onOk: doLogout
      })
    } else doLogout()
  }

  const onMenuClick = ({ key }: { key: string }) => {
    if (key === 'logout') logout()
    else navigate(key)
  }

  const updateUploadList = () => {
    if (!configReady.current || uploadRequestInFlight.current) return
    const courses = courseList.filter((item) => selectedCourseKeys.includes(item.id))
    if (courses.length === 0) {
      notification.error({ title: '请选择课程' })
      return
    }
    uploadRequestInFlight.current = true
    setLoadingUploadList(true)
    invoke<Upload[]>('get_uploads_list', { courses, syncUpload: syncingUpload }).then((res) => {
      if (!configReady.current) return
      const selectedKeys = getDefaultSelectedUploadKeys(res, configRef.current.excluded_upload_extensions)
      if (syncingUpload) {
        setLastSyncUpload(dayjs().format('YYYY-MM-DD HH:mm:ss'))
        if (configRef.current.auto_download) {
          res.filter((item) => selectedKeys.includes(item.reference_id))
            .forEach((item) => downloadManager.addTask(new LearningTask(item, true), true))
          const remaining = res.filter(item => !selectedKeys.includes(item.reference_id))
          setUploadList(remaining)
          setSelectedUploadKeys(previous => refreshedSelection(previous, remaining.map(item => item.reference_id), configRef.current.auto_select_all_courseware, []))
        } else {
          setUploadList(res)
          setSelectedUploadKeys(previous => refreshedSelection(previous, res.map(item => item.reference_id), configRef.current.auto_select_all_courseware, selectedKeys))
        }
      } else {
        setUploadList(res)
        setSelectedUploadKeys(previous => refreshedSelection(previous, res.map(item => item.reference_id), configRef.current.auto_select_all_courseware, selectedKeys))
      }
    }).catch((err) => {
      notification.error({ title: '获取课件列表失败', description: String(err) })
    }).finally(() => {
      uploadRequestInFlight.current = false
      setLoadingUploadList(false)
    })
  }

  const startSyncUpload = () => {
    clearTimeout(syncUploadTimer.current)
    const run = ++uploadRun.current
    const scheduleNext = () => {
      syncUploadTimer.current = setTimeout(syncUploadTask, Math.floor(Math.random() * 60000) + 60000)
    }
    const syncUploadTask = () => {
      if (run !== uploadRun.current) return
      // Manual refresh takes priority: skip this tick rather than queueing a request.
      if (!configReady.current || uploadRequestInFlight.current) { scheduleNext(); return }
      uploadRequestInFlight.current = true
      const courses = courseListRef.current.filter((item) => selectedCourseKeysRef.current.includes(item.id))
      setLoadingUploadList(true)
      invoke<Upload[]>('get_uploads_list', { courses, syncUpload: true }).then((uploads) => {
        if (run !== uploadRun.current || !configReady.current) return
        const selectedKeys = getDefaultSelectedUploadKeys(uploads, configRef.current.excluded_upload_extensions)
        if (configRef.current.auto_download) {
          uploads.filter((item) => selectedKeys.includes(item.reference_id))
            .forEach((item) => downloadManager.addTask(new LearningTask(item, true), true))
          const remaining = uploads.filter(item => !selectedKeys.includes(item.reference_id))
          setUploadList(remaining)
          setSelectedUploadKeys(previous => refreshedSelection(previous, remaining.map(item => item.reference_id), configRef.current.auto_select_all_courseware, []))
        } else {
          setUploadList(uploads)
          setSelectedUploadKeys(previous => refreshedSelection(previous, uploads.map(item => item.reference_id), configRef.current.auto_select_all_courseware, selectedKeys))
        }
        setLastSyncUpload(dayjs().format('YYYY-MM-DD HH:mm:ss'))
      }).catch((err) => {
        if (run !== uploadRun.current || !configReady.current) return
        notification.error({ title: '同步课件失败', description: String(err) })
      }).finally(() => {
        uploadRequestInFlight.current = false
        if (run !== uploadRun.current) return
        scheduleNext()
        setLoadingUploadList(false)
      })
    }
    syncUploadTask()
  }

  const stopSyncUpload = () => {
    uploadRun.current++
    clearTimeout(syncUploadTimer.current)
    syncUploadTimer.current = undefined
  }

  const handleSwitchSyncUpload = (checked: boolean) => {
    if (checked && !configReady.current) return
    setSyncingUpload(checked)
    if (checked) startSyncUpload()
    else stopSyncUpload()
  }

  return (
    <PanelContext.Provider value={{ collapsed: panelCollapsed, toggle: togglePanel, width: panelWidth, setWidth: resizePanel, peek, keepPeek, dismissPeek, activateModule: setCurrent }}>
      <WindowChrome navigation />
      <div className="desktop-shell">
        <nav className="navigation-rail" aria-label="主导航">

          {[
            { key: 'learning', label: '学在浙大', icon: <PlatformIcon platform="learning" />, active: syncingUpload },
            { key: 'classroom', label: '智云课堂', icon: <PlatformIcon platform="classroom" />, active: false },
            { key: 'score', label: '成绩查询', icon: <FileSearchOutlined />, active: false },
            { key: 'todo', label: '待办事项', icon: <UnorderedListOutlined />, active: false },
          ].map(item => <Tooltip key={item.key} title={panelCollapsed ? null : `${item.label}${item.active ? ' · 自动同步已开启' : ''}`} placement="right">
            <button {...railPreview(item.key)} className={`rail-button ${current === item.key ? 'active' : ''}`} aria-label={`${item.label}${item.active ? ' · 自动同步已开启' : ''}`}
              aria-current={current === item.key ? 'page' : undefined} onClick={() => navigate(item.key)}>
              <Badge className="status-badge" dot={item.active}>{item.icon}</Badge>
            </button>
          </Tooltip>)}
          <div className="rail-spacer" />
          <PreviewMenu navigation />
          <Tooltip title="帮助" placement="right"><button className="rail-button" aria-label="帮助" onClick={() => shell.open('https://github.com/PeiPei233/zju-learning-assistant').catch(err => notification.error({ title: '打开帮助失败', description: String(err) }))}><QuestionCircleOutlined /></button></Tooltip>
          <Tooltip title={panelCollapsed ? null : `下载列表${downloadingCount ? ` · ${downloadingCount} 项进行中` : ''}`} placement="right"><button {...railPreview('download')} className={`rail-button ${current === 'download' ? 'active' : ''}`} aria-current={current === 'download' ? 'page' : undefined} aria-label={`下载列表${downloadingCount ? ` · ${downloadingCount} 项进行中` : ''}`} onClick={() => navigate('download')}><Badge className="status-badge" count={downloadingCount} size="small"><DownloadOutlined /></Badge></button></Tooltip>
          <Tooltip title={panelCollapsed ? null : `设置${latestVersionData && latestVersionData.version !== currentVersion ? ' · 有新版本' : ''}`} placement="right"><button {...railPreview('setting')} className={`rail-button ${current === 'setting' ? 'active' : ''}`} aria-current={current === 'setting' ? 'page' : undefined} aria-label={`设置${latestVersionData && latestVersionData.version !== currentVersion ? ' · 有新版本' : ''}`} onClick={() => navigate('setting')}><Badge className="status-badge" dot={!!latestVersionData && latestVersionData.version !== currentVersion}><SettingOutlined /></Badge></button></Tooltip>
          <Tooltip title="退出登录" placement="right"><button className="rail-button" aria-label="退出登录" onClick={() => onMenuClick({ key: 'logout' })}><LogoutOutlined /></button></Tooltip>
        </nav>
        <div className="module-host">
          {visited.includes('learning') && <ModuleFrame name="learning" current={current}><Learning
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
          /></ModuleFrame>}
          {visited.includes('classroom') && <ModuleFrame name="classroom" current={current}><Classroom /></ModuleFrame>}
          {visited.includes('score') && <ModuleFrame name="score" current={current}><Score
            lastSync={lastSyncScore}
            totalGp={totalGp}
            totalCredit={totalCredit}
            loading={loadingScore}
            configError={scoreConfigError}
            score={score}
            handleSync={handleSyncScore}
          /></ModuleFrame>}
          {visited.includes('todo') && <ModuleFrame name="todo" current={current}><Todo {...todos} /></ModuleFrame>}
          {visited.includes('download') && <ModuleFrame name="download" current={current}>
            <Downloads taskList={downloadTasks} downloadManager={downloadManager} />
          </ModuleFrame>}
          {visited.includes('setting') && <ModuleFrame name="setting" current={current}>
            <Settings currentVersion={currentVersion} latestVersionData={latestVersionData} setOpenVersionModal={setOpenVersionModal} />
          </ModuleFrame>}
        </div>
      </div>
    </PanelContext.Provider>
  )
}
