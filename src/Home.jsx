import { useEffect, useState, useRef } from 'react'
import { App, Menu, Layout, Tooltip, Progress, Drawer, List, Typography, Button, Badge, Switch, Input, Space, InputNumber, Select } from 'antd';
import { invoke } from '@tauri-apps/api/core'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { LogoutOutlined, DownloadOutlined, EditOutlined, CloseOutlined, FolderOutlined, ReloadOutlined, SettingOutlined, CheckOutlined, FileSearchOutlined, ArrowLeftOutlined, DeleteOutlined, SendOutlined } from '@ant-design/icons';
import Learning from './Learning'
import Classroom from './Classroom'
import Score from './Score'
import { DownloadManager } from './downloadManager';
import { LearningTask } from './downloadManager';
import { listen } from '@tauri-apps/api/event';
import {  } from '@tauri-apps/api';
import { exit } from '@tauri-apps/plugin-process';
import {  } from '@tauri-apps/api';
import { Config } from './model';
import dayjs from 'dayjs'
import LearningIcon from './assets/images/learning.ico'
import ClassroomIcon from './assets/images/classroom.png'
import * as dialog from "@tauri-apps/plugin-dialog"
import * as shell from "@tauri-apps/plugin-shell"

const { Header, Content, Footer, Sider } = Layout;
const { Text, Link } = Typography;

export default function Home({ setIsLogin, setAutoLoginUsername, setAutoLoginPassword, currentVersion, latestVersionData, setOpenVersionModal }) {

  const { message, modal, notification } = App.useApp()
  const [current, setCurrent] = useState('learning')

  const [score, setScore] = useState([])
  const [loadingScore, setLoadingScore] = useState(false)
  const [notifyScore, setNotifyScore] = useState(false)
  const [lastSyncScore, setLastSyncScore] = useState(null)
  const [totalGp, setTotalGp] = useState(0)
  const [totalCredit, setTotalCredit] = useState(0)
  const [config, setConfig] = useState(new Config())

  const [taskList, setTaskList] = useState([])
  const [downloadingCount, setDownloadingCount] = useState(0)
  const [openDownloadDrawer, setOpenDownloadDrawer] = useState(false)
  const [openSettingDrawer, setOpenSettingDrawer] = useState(false)

  const [dingUrlInput, setDingUrlInput] = useState('')

  const [courseList, setCourseList] = useState([])
  const [selectedCourseKeys, setSelectedCourseKeys] = useState([])
  const [loadingUploadList, setLoadingUploadList] = useState(false)
  const [uploadList, setUploadList] = useState([])
  const [selectedUploadKeys, setSelectedUploadKeys] = useState([])
  const [syncingUpload, setSyncingUpload] = useState(false)
  const [lastSyncUpload, setLastSyncUpload] = useState(null)

  const syncScoreTimer = useRef(null)
  const syncUploadTimer = useRef(null)
  const downloadManager = useRef(null)
  const selectedCourseKeysRef = useRef(selectedCourseKeys)
  const configRef = useRef(config)
  const notifiedTodo = useRef({})
  const todoList = useRef([])

  useEffect(() => {
    selectedCourseKeysRef.current = selectedCourseKeys
  }, [selectedCourseKeys])

  useEffect(() => {
    configRef.current = config
  }, [config])

  function notifyUpdate(item, oldTotalGp, oldTotalCredit, totalGp, totalCredit, dingUrl) {
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
        description: err
      })
    })
  }

  function updateScore(newScore) {
    const oldScore = score
    setScore(newScore)
    setLastSyncScore(dayjs().format('YYYY-MM-DD HH:mm:ss'))

    let totalGp = 0
    let totalCredit = 0

    // calculate totalGp and totalCredit of oldScore
    oldScore.forEach((item) => {
      if (item.cj !== '合格' && item.cj !== '不合格' && item.cj !== '弃修') {
        totalGp += parseFloat(item.jd) * parseFloat(item.xf)
        totalCredit += parseFloat(item.xf)
      }
    })

    // enumerate newScore to find new score
    newScore.forEach((item) => {
      const oldItem = oldScore.find((oldItem) => oldItem.xkkh === item.xkkh)
      if (oldItem) {
        if (oldItem.cj !== item.cj || oldItem.bkcj !== item.bkcj || oldItem.jd !== item.jd || oldItem.xf !== item.xf) {
          // if the course is in oldScore and the score has changed
          let oldTotalGp = totalGp
          let oldTotalCredit = totalCredit
          if (item.cj !== '合格' && item.cj !== '不合格' && item.cj !== '弃修') {
            totalGp += parseFloat(item.jd) * parseFloat(item.xf) - parseFloat(oldItem.jd) * parseFloat(oldItem.xf)
            totalCredit += parseFloat(item.xf) - parseFloat(oldItem.xf)
          }
          if (notifyScore) {
            notifyUpdate(item, oldTotalGp, oldTotalCredit, totalGp, totalCredit)
          }
        }
      } else {
        // if the course is not in oldScore
        let oldTotalGp = totalGp
        let oldTotalCredit = totalCredit
        if (item.cj !== '合格' && item.cj !== '不合格' && item.cj !== '弃修') {
          totalGp += parseFloat(item.jd) * parseFloat(item.xf)
          totalCredit += parseFloat(item.xf)
        }
        if (notifyScore) {
          notifyUpdate(item, oldTotalGp, oldTotalCredit, totalGp, totalCredit)
        }
      }
    })

    setTotalGp(totalGp)
    setTotalCredit(totalCredit)
  }

  // sync every 3 to 5 minutes
  const startSyncScore = () => {
    const syncScoreTask = () => {
      setLoadingScore(true)
      invoke('get_score').then((res) => {
        updateScore(res)
      }).catch((err) => {
        notification.error({
          message: '成绩同步失败',
          description: err
        })
      }).finally(() => {
        const nextSync = Math.floor(Math.random() * 60000) + 60000
        // const nextSync = Math.floor(Math.random() * 120000) + 180000
        console.log(`sync score: current time: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}, next time: ${dayjs().add(nextSync, 'ms').format('YYYY-MM-DD HH:mm:ss')}`)
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
    if (loadingScore) {
      return
    }
    setLoadingScore(true)
    invoke('get_score').then((res) => {
      updateScore(res)
      invoke('check_evaluation_done').then((res) => {
        if (!res) {
          notification.warning({
            message: '教学评价未完成',
            description: '本学期尚未完成评价，无法查询最新成绩！',
            btn: <Button type='primary' onClick={() => {
              shell.open('https://alt.zju.edu.cn/studentEvaluationBackend/list').catch((err) => {
                notification.error({
                  message: '打开教学评价页面失败',
                  description: err.message
                })
              })
            }}>去评价</Button>
          })
        } else {
          notification.success({
            message: '成绩同步成功',
          })
        }
      }).catch((err) => {
        notification.error({
          message: '查询教学评价失败',
          description: err
        })
      })
    }).catch((err) => {
      notification.error({
        message: '成绩同步失败',
        description: err
      })
    }).finally(() => {
      setLoadingScore(false)
    })
  }

  const handleSwitchSyncScore = (checked) => {
    setNotifyScore(checked)
    if (checked) {
      startSyncScore()
    } else {
      stopSyncScore()
    }
  }

  const syncTodoTask = () => {
    invoke('sync_todo_once').then((res) => {
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
    console.log(`sync todo: current time: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}`)
  }

  useEffect(() => {
    setAutoLoginUsername('')
    setAutoLoginPassword('')
    invoke('check_login').then((res) => {
      if (!res) {
        setIsLogin(false)
      }
    }).catch((err) => {
      setIsLogin(false)
    })

    invoke('get_config').then((res) => {
      console.log(res)
      setConfig(new Config(res))
      setDingUrlInput(res.ding_url)
    }).catch((err) => {
      notification.error({
        message: '获取设置失败',
        description: err
      })
    })

    downloadManager.current = new DownloadManager()

    const updateDownloadList = setInterval(() => {
      setTaskList([...downloadManager.current.getTasks()].reverse())
      setDownloadingCount(downloadManager.current.getDownloadingCount())
    }, 1000)

    // sync todo every minute
    syncTodoTask()
    const syncTodo = setInterval(syncTodoTask, 60000)

    const unlisten = listen('download-progress', (res) => {
      downloadManager.current.updateProgress(res.payload)
    })

    const unlistenClose = listen('close-requested', () => {
      if (!configRef.current.tray) {
        exit(0)
      }
    })

    const unlistenExportTodo = listen('export-todo', (res) => {
      console.log(res)
      invoke('export_todo', { todoList: todoList.current, location: res.payload })
    })

    return () => {
      stopSyncScore()
      stopSyncUpload()
      downloadManager.current.cleanUp()
      clearInterval(updateDownloadList)
      clearInterval(syncTodo)
      unlisten.then((fn) => fn())
      unlistenClose.then((fn) => fn())
      unlistenExportTodo.then((fn) => fn())
    }
  }, [])

  const logout = () => {
    if (downloadManager.current.getDownloadingCount() > 0 || syncingUpload || notifyScore) {
      modal.confirm({
        title: '后台服务正在运行',
        content: '是否停止课件同步、成绩提醒、课件下载等后台服务并退出登录？',
        onOk: () => {
          invoke('logout').then((res) => {
            setIsLogin(false)
          }).catch((err) => {
            notification.error({
              message: '退出登录失败',
              description: err
            })
          })
        }
      })
    } else {
      invoke('logout').then((res) => {
        setIsLogin(false)
      }).catch((err) => {
        notification.error({
          message: '退出登录失败',
          description: err
        })
      })
    }
  }

  const onMenuClick = ({ key }) => {
    // console.log(key)
    if (key === 'logout') {
      logout()
      return
    } else if (key === 'download') {
      setOpenDownloadDrawer(true)
      return
    } else if (key === 'setting') {
      setOpenSettingDrawer(true)
      return
    }
    setCurrent(key)
  }

  function addDownloadTasks(tasks) {
    let exists = false
    for (let i = 0; i < tasks.length; i++) {
      if (downloadManager.current.checkTaskExists(tasks[i])) {
        exists = true
        break
      }
    }
    if (exists) {
      modal.confirm({
        title: '下载确认',
        content: '部分课件已在下载列表中，是否重新下载？',
        onOk: () => {
          tasks.forEach((task) => {
            downloadManager.current.addTask(task, true)
          })
        },
        onCancel: () => {
          tasks.forEach((task) => {
            downloadManager.current.addTask(task, false)
          })
        }
      })
    } else {
      tasks.forEach((task) => {
        downloadManager.current.addTask(task, true)
      })
    }
    if (config.auto_open_download_list && tasks.length !== 0) {
      setOpenDownloadDrawer(true)
    }
  }

  const updateConfigField = (field, value) => {
    let new_config = config.clone()
    new_config[field] = value
    invoke('set_config', { config: new_config }).then((res) => {
      setConfig(new_config)
    }).catch((err) => {
      notification.error({
        message: '设置失败',
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
        updateConfigField('save_path', res)
      }
    }).catch((err) => {
      notification.error({
        message: '下载路径修改失败',
        description: err
      })
    })
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
    invoke('get_uploads_list', { courses, syncUpload: syncingUpload }).then((res) => {
      if (syncingUpload) {
        setLastSyncUpload(dayjs().format('YYYY-MM-DD HH:mm:ss'))
        if (config.auto_download) {
          let tasks = res.map((item) => new LearningTask(item, true))
          addDownloadTasks(tasks)
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
      notification.error({
        message: '获取课件列表失败',
        description: err
      })
    }).finally(() => {
      setLoadingUploadList(false)
    })
  }

  const startSyncUpload = () => {
    const syncUploadTask = () => {
      let courses = courseList.filter((item) => selectedCourseKeysRef.current.includes(item.id))
      setLoadingUploadList(true)
      invoke('get_uploads_list', { courses, syncUpload: true }).then((uploads) => {
        if (configRef.current.auto_download) {
          uploads.forEach((item) => {
            downloadManager.current.addTask(new LearningTask(item, true), true)
          })
          setUploadList(uploads.filter((item) => !selectedUploadKeys.includes(item.reference_id)))
          setSelectedUploadKeys([])
        } else {
          setUploadList(uploads)
          setSelectedUploadKeys(uploads.map((item) => item.reference_id))
        }
        setLastSyncUpload(dayjs().format('YYYY-MM-DD HH:mm:ss'))
      }).catch((err) => {
        notification.error({
          message: '同步课件失败',
          description: err
        })
      }).finally(() => {
        const nextSync = Math.floor(Math.random() * 60000) + 60000
        // const nextSync = Math.floor(Math.random() * 120000) + 180000
        console.log(`sync upload: current time: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}, next sync time: ${dayjs().add(nextSync, 'ms').format('YYYY-MM-DD HH:mm:ss')}`)
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

  const handleSwitchSyncUpload = (checked) => {
    setSyncingUpload(checked)
    if (checked) {
      startSyncUpload()
    } else {
      stopSyncUpload()
    }
  }

  return (
    <Layout className='home-layout'>
      <Header className='home-layout' style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        height: 40,
        marginBottom: 10
      }}>
        <Menu
          onClick={onMenuClick}
          selectedKeys={[current]}
          mode="horizontal"
          style={{ width: '100%', lineHeight: '40px' }}
        >
          <Menu.Item key='learning' icon={<img src={LearningIcon} style={{ width: 14 }} />}>
            <Tooltip title={syncingUpload ? `学在浙大课件同步正在运行 - 上次同步时间：${lastSyncUpload}` : ''}>
              <Badge dot={true} count={syncingUpload ? `学在浙大课件同步正在运行 - 上次同步时间：${lastSyncUpload}` : 0} color='green'>
                <span style={{ color: current === 'learning' ? '#1677ff' : null }}>学在浙大</span>
              </Badge>
            </Tooltip>
          </Menu.Item>
          <Menu.Item key='classroom' icon={<img src={ClassroomIcon} style={{ width: 14 }} />}>
            智云课堂
          </Menu.Item>
          <Menu.Item key='score' icon={<FileSearchOutlined />}>
            <Tooltip title={notifyScore ? `成绩提醒正在运行 - 上次同步时间：${lastSyncScore}` : ''}>
              <Badge dot={true} count={notifyScore ? `成绩提醒正在运行 - 上次同步时间：${lastSyncScore}` : 0} color='green'>
                <span style={{ color: current === 'score' ? '#1677ff' : null }}>成绩查询</span>
              </Badge>
            </Tooltip>
          </Menu.Item>
        </Menu>
        <Menu
          onClick={onMenuClick}
          selectedKeys={[current]}
          mode="horizontal"
          style={{ float: 'right', lineHeight: '40px', minWidth: 46 * 3 }}
        >
          <Menu.Item key='download'>
            <Badge count={downloadingCount} size='small'>
              <Tooltip title='下载列表'>
                <DownloadOutlined />
              </Tooltip>
            </Badge>
          </Menu.Item>
          <Menu.Item key='setting'>
            <Tooltip title='设置'>
              <Badge count={(!latestVersionData || (latestVersionData && latestVersionData.tag_name === currentVersion) ? 0 : `发现新版本：${latestVersionData.tag_name}`)} dot>
                <SettingOutlined />
              </Badge>
            </Tooltip>
          </Menu.Item>
          <Menu.Item key='logout'>
            <Tooltip title='退出登录'>
              <LogoutOutlined />
            </Tooltip>
          </Menu.Item>
        </Menu>
      </Header>
      <Content>
        {current === 'learning' && <Learning
          addDownloadTasks={addDownloadTasks}
          syncing={syncingUpload}
          autoDownload={config.auto_download}
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
        {current === 'classroom' && <Classroom addDownloadTasks={addDownloadTasks} toPdf={config.to_pdf} />}
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
      <Drawer
        open={openDownloadDrawer}
        onClose={() => setOpenDownloadDrawer(false)}
        closeIcon={<ArrowLeftOutlined />}
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignContent: 'center' }}>
            <div>下载列表</div>
            <div style={{ float: 'right' }}>
              <Tooltip title='全部重新开始'>
                <Button
                  type='text'
                  icon={<ReloadOutlined />}
                  size='small'
                  onClick={() => {
                    downloadManager.current.reDownloadAllTasks()
                  }}
                />
              </Tooltip>
              <Tooltip title='全部取消'>
                <Button
                  type='text'
                  icon={<CloseOutlined />}
                  size='small'
                  onClick={() => {
                    downloadManager.current.cancelAllTasks()
                  }}
                />
              </Tooltip>
              <Tooltip title='清空下载列表'>
                <Button
                  type='text'
                  icon={<DeleteOutlined />}
                  size='small'
                  onClick={() => {
                    downloadManager.current.cleanUp()
                  }}
                />
              </Tooltip>
            </div>
          </div>
        }
      >
        <List
          itemLayout='horizontal'
          dataSource={taskList}
          renderItem={item => (
            <List.Item>
              <List.Item.Meta
                title={<Text
                  ellipsis={{
                    rows: 1,
                    expandable: false,
                    tooltip: true
                  }}
                  style={{
                    fontWeight: 'normal',
                  }}>{item.name}</Text>}
                description={<div>
                  {item.status !== 'failed' && item.status !== 'done' && <Text type="secondary" style={{
                    fontWeight: 'normal',
                    fontSize: 12
                  }}>{item.getDescription()}</Text>}
                  {item.status === 'done' && <Link
                    onClick={() => {
                      downloadManager.current.openTask(item.id, false).catch((err) => {
                        notification.error({
                          message: '打开文件失败',
                          description: err
                        })
                      })
                    }}
                    style={{
                      fontWeight: 'normal',
                      fontSize: 12
                    }}>打开文件</Link>}
                  {item.status === 'failed' && <Text type="danger" style={{
                    fontWeight: 'normal',
                    fontSize: 12
                  }}>{item.getDescription()}</Text>}
                  {item.status === 'downloading' &&
                    <Progress
                      size='small'
                      percent={item.progress * 100}
                      status={item.status === 'failed' ? 'exception' : item.status === 'done' ? 'success' : 'active'}
                      format={(percent) => Math.floor(percent) + '%'}
                    />}
                </div>}
              />
              {(item.status === 'canceled' || item.status === 'failed') && <Tooltip title='重新下载'><Button icon={<ReloadOutlined />} type='text'
                onClick={() => {
                  downloadManager.current.reDownloadTask(item.id)
                }} /></Tooltip>}
              {(item.status === 'downloading' || item.status === 'pending') && <Tooltip title='取消下载'><Button icon={<CloseOutlined />} type='text'
                onClick={() => {
                  downloadManager.current.cancelTask(item.id)
                }} /></Tooltip>}
              {item.status === 'done' && <Tooltip title='打开文件夹'><Button icon={<FolderOutlined />} type='text'
                onClick={() => {
                  downloadManager.current.openTask(item.id, true).catch((err) => {
                    notification.error({
                      message: '打开文件夹失败',
                      description: err
                    })
                  })
                }} /></Tooltip>}
            </List.Item>
          )}
        />
      </Drawer>
      <Drawer
        open={openSettingDrawer}
        closeIcon={<ArrowLeftOutlined />}
        onClose={() => {
          setDingUrlInput(config.ding_url)
          setOpenSettingDrawer(false)
        }}
        title='设置'
      >
        <List
          itemLayout='horizontal'
        >
          <List.Item>
            <List.Item.Meta
              title={<Text
                style={{
                  fontWeight: 'normal',
                }}>下载/同步位置</Text>}
              description={<div>
                <Text type="secondary" style={{
                  fontWeight: 'normal',
                  fontSize: 12
                }}>{config.save_path}</Text>
              </div>}
            />
            <Tooltip title='修改下载/同步位置'>
              <Button type='text' icon={<EditOutlined />} onClick={updatePath} />
            </Tooltip>
          </List.Item>
          <List.Item>
            <List.Item.Meta
              title={<Text
                style={{
                  fontWeight: 'normal',
                }}>自动导出为 PDF</Text>}
              description={<div>
                <Text type="secondary" style={{
                  fontWeight: 'normal',
                  fontSize: 12
                }}>开启后，从智云课堂下载的课件将自动导出为 PDF</Text>
              </div>}
            />
            <Switch checked={config.to_pdf} onChange={(checked) => {
              updateConfigField('to_pdf', checked)
            }} />
          </List.Item>
          <List.Item>
            <List.Item.Meta
              title={<Text
                style={{
                  fontWeight: 'normal',
                }}>课件更新时自动下载</Text>}
              description={<div>
                <Text type="secondary" style={{
                  fontWeight: 'normal',
                  fontSize: 12
                }}>开启学在浙大课件自动同步后，若开启该选项，则检测到新课件时会自动下载。否则仅会加入课件列表。</Text>
              </div>}
            />
            <Switch checked={config.auto_download} onChange={(checked) => {
              updateConfigField('auto_download', checked)
            }} />
          </List.Item>
          <List.Item>
            <List.Item.Meta
              title={<Text
                style={{
                  fontWeight: 'normal',
                }}>下载开始时显示下载列表</Text>}
              description={<div>
                <Text type="secondary" style={{
                  fontWeight: 'normal',
                  fontSize: 12
                }}>关闭此设置会使人更难知道文件何时开始下载</Text>
              </div>}
            />
            <Switch checked={config.auto_open_download_list} onChange={(checked) => {
              updateConfigField('auto_open_download_list', checked)
            }} />
          </List.Item>
          <List.Item>
            <List.Item.Meta
              title={<Text
                style={{
                  fontWeight: 'normal',
                }}>钉钉机器人 Webhook</Text>}
              description={
                <div>
                  <Text type="secondary" style={{
                    fontWeight: 'normal',
                    fontSize: 12
                  }}>检测到成绩更新后，将使用以下钉钉机器人 Webhook 发送通知。若留空，则不使用钉钉机器人发送通知。</Text>
                  <Space.Compact style={{ marginTop: 10, width: '100%' }}>
                    <Input placeholder='输入完整的钉钉机器人 Webhook' value={dingUrlInput} onChange={(e) => setDingUrlInput(e.target.value)} />
                    <Button icon={<Tooltip title='发送测试消息'><SendOutlined /></Tooltip>} onClick={() => {
                      notifyUpdate({ xkkh: '测试课程', kcmc: '测试课程', cj: '100', jd: '5.0', xf: '3.0' }, 5., 37., 5., 40., dingUrlInput)
                    }} />
                    <Button icon={<Tooltip title='保存'><CheckOutlined /></Tooltip>} onClick={() => {
                      updateConfigField('ding_url', dingUrlInput)
                    }} />
                  </Space.Compact>
                </div>
              }
            />
          </List.Item>
          <List.Item>
            <List.Item.Meta
              title={<Text
                style={{
                  fontWeight: 'normal',
                }}>关闭应用后保持后台运行</Text>}
              description={<div>
                <Text type="secondary" style={{
                  fontWeight: 'normal',
                  fontSize: 12
                }}>若开启，关闭应用窗口后应用会保持后台运行，并保留托盘图标。</Text>
              </div>}
            />
            <Switch checked={config.tray} onChange={(checked) => {
              updateConfigField('tray', checked)
            }} />
          </List.Item>
          <a onClick={() => setOpenVersionModal(true)}>
            <List.Item>
              <List.Item.Meta
                title={<Badge count={(!latestVersionData || (latestVersionData && latestVersionData.tag_name === currentVersion) ? 0 : 'New')} size='small'>
                  <Text
                    style={{
                      fontWeight: 'normal',
                    }}>应用版本</Text>
                </Badge>}
              />
              <Text>{currentVersion}</Text>
            </List.Item>
          </a>
        </List>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
          <Text type='secondary' style={{ fontSize: 12 }}>Made by PeiPei</Text>
          <Text type='secondary' style={{ fontSize: 12 }}>此软件仅供学习交流使用，严禁用于商业用途</Text>
        </div>
      </Drawer>
    </Layout>
  )
}