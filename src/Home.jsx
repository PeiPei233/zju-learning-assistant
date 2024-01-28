import { useEffect, useState, useRef } from 'react'
import { App, Menu, Layout, Tooltip, Progress, Drawer, List, Typography, Button, Badge, Switch, Input, Space } from 'antd';
import { invoke } from '@tauri-apps/api'
import { LogoutOutlined, DownloadOutlined, EditOutlined, CloseOutlined, FolderOutlined, ReloadOutlined, SettingOutlined, CheckOutlined } from '@ant-design/icons';
import Learning from './Learning'
import Classroom from './Classroom'
import Score from './Score'
import { DownloadManager } from './downloadManager';
import { LearningTask } from './downloadManager';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { listen } from '@tauri-apps/api/event';
import { dialog } from '@tauri-apps/api';
import { Config } from './model';

dayjs.locale('zh-cn')

const { Header, Content, Footer, Sider } = Layout;
const { Text, Link } = Typography;

export default function Home({ setIsLogin }) {

  const { message, modal, notification } = App.useApp()
  const [downloading, setDownloading] = useState(false)
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
  const downloadManager = useRef(null)
  const syncTimer = useRef(null)
  const selectedCourseKeysRef = useRef(selectedCourseKeys)
  const configRef = useRef(config)

  useEffect(() => {
    selectedCourseKeysRef.current = selectedCourseKeys
  }, [selectedCourseKeys])

  useEffect(() => {
    configRef.current = config
  }, [config])

  function notifyUpdate(item, oldTotalGp, oldTotalCredit, totalGp, totalCredit) {
    if (!notifyScore) {
      return
    }
    invoke('notify_score', {
      score: item,
      oldTotalGp,
      oldTotalCredit,
      totalGp,
      totalCredit,
      dingUrl: config.ding_url
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
          notifyUpdate(item, oldTotalGp, oldTotalCredit, totalGp, totalCredit)
        }
      } else {
        // if the course is not in oldScore
        let oldTotalGp = totalGp
        let oldTotalCredit = totalCredit
        if (item.cj !== '合格' && item.cj !== '不合格' && item.cj !== '弃修') {
          totalGp += parseFloat(item.jd) * parseFloat(item.xf)
          totalCredit += parseFloat(item.xf)
        }
        notifyUpdate(item, oldTotalGp, oldTotalCredit, totalGp, totalCredit)
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
      notification.success({
        message: '成绩同步成功',
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

  useEffect(() => {
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

    const unlisten = listen('download-progress', (res) => {
      downloadManager.current.updateProgress(res.payload)
    })

    return () => {
      stopSyncScore()
      downloadManager.current.cleanUp()
      clearInterval(updateDownloadList)
      unlisten.then((fn) => fn())
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


  const updatePath = () => {
    dialog.open({
      directory: true,
      multiple: false,
      message: '选择下载路径'
    }).then((res) => {
      if (res && res.length !== 0) {
        let new_config = config.clone()
        new_config.save_path = res
        invoke('set_config', { config: new_config }).then((res) => {
          setConfig(new_config)
        }).catch((err) => {
          notification.error({
            message: '下载路径修改失败',
            description: err
          })
        })
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
        syncTimer.current = setTimeout(syncUploadTask, nextSync)
        setLoadingUploadList(false)
      })
    }
    syncUploadTask()
  }

  const stopSyncUpload = () => {
    clearTimeout(syncTimer.current)
    syncTimer.current = null
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
          disabled={downloading}
        >
          <Menu.Item key='learning' icon={<img src='https://course.zju.edu.cn/static/favicon.ico' style={{ width: 14 }} />}>
            <Tooltip title={syncingUpload ? `学在浙大课件同步正在运行 - 上次同步时间：${lastSyncUpload}` : ''}>
              <Badge dot={true} count={syncingUpload ? 1 : 0} color='green'>
                <span className={current === 'learning' ? 'ant-menu-item-selected' : ''}>学在浙大</span>
              </Badge>
            </Tooltip>
          </Menu.Item>
          <Menu.Item key='classroom' icon={<img src='https://resource.cmc.zju.edu.cn/play/0/f18b8f4ee40bcd0765cfe987ca82046e/2022/08/31/fc9355e0290811ed97c77ab369543ec1.png' style={{ width: 14 }} />}>
            智云课堂
          </Menu.Item>
          <Menu.Item key='score' icon={<div style={{ width: 14 }} >💯</div>}>
            <Tooltip title={notifyScore ? `成绩提醒正在运行 - 上次同步时间：${lastSyncScore}` : ''}>
              <Badge dot={true} count={notifyScore ? 1 : 0} color='green'>
                <span className={current === 'score' ? 'ant-menu-item-selected' : ''}>成绩查询</span>
              </Badge>
            </Tooltip>
          </Menu.Item>
        </Menu>
        <Menu
          onClick={onMenuClick}
          selectedKeys={[current]}
          mode="horizontal"
          style={{ float: 'right', lineHeight: '40px', minWidth: 46 * 3 }}
          disabled={downloading}
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
              <SettingOutlined />
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
        title='下载列表'
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
              let new_config = config.clone()
              new_config.to_pdf = checked
              invoke('set_config', { config: new_config }).then((res) => {
                setConfig(new_config)
              }).catch((err) => {
                notification.error({
                  message: '设置失败',
                  description: err
                })
              })
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
              let new_config = config.clone()
              new_config.auto_download = checked
              invoke('set_config', { config: new_config }).then((res) => {
                setConfig(new_config)
              }).catch((err) => {
                notification.error({
                  message: '设置失败',
                  description: err
                })
              })
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
              let new_config = config.clone()
              new_config.auto_open_download_list = checked
              invoke('set_config', { config: new_config }).then((res) => {
                setConfig(new_config)
              }).catch((err) => {
                notification.error({
                  message: '设置失败',
                  description: err
                })
              })
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
                  <Space.Compact style={{ marginTop: 10 }}>
                    <Input placeholder='输入完整的钉钉机器人 Webhook' value={dingUrlInput} onChange={(e) => setDingUrlInput(e.target.value)} />
                    <Button icon={<Tooltip title='保存'><CheckOutlined /></Tooltip>} onClick={() => {
                      let new_config = config.clone()
                      new_config.ding_url = dingUrlInput
                      invoke('set_config', { config: new_config }).then((res) => {
                        setConfig(new_config)
                        notification.success({
                          message: '设置成功',
                        })
                      }).catch((err) => {
                        notification.error({
                          message: '设置失败',
                          description: err
                        })
                      })
                    }} />
                  </Space.Compact>
                </div>
              }
            />
          </List.Item>
        </List>
      </Drawer>
    </Layout>
  )
}