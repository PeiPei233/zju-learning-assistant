import { useEffect, useState } from 'react'
import { Form, Input, Button, Card, App, Row, Col, Select, Table, Progress } from 'antd';
import { invoke } from '@tauri-apps/api'
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { listen } from '@tauri-apps/api/event'

function Login({ setIsLogin }) {

  const [form] = Form.useForm()
  const { message, modal, notification } = App.useApp()

  const [loading, setLoading] = useState(false)

  useEffect(() => {
    invoke('check_login').then((res) => {
      if (res) {
        setIsLogin(true)
      }
    }).catch((err) => {

    })
  })

  const onFinish = async (values) => {
    console.log('Received values of form: ', values.username);
    setLoading(true)
    invoke('login', { username: values.username, password: values.password })
      .then((res) => {
        console.log(res)
        setIsLogin(true)
      }).catch((err) => {
        notification.error({
          message: '登录失败',
          description: err
        })
      }).finally(() => {
        setLoading(false)
      })
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '80vh',
      flexDirection: 'column'
    }}>
      <h1>浙江大学统一身份认证登录</h1>
      <Card style={{
        width: 300
      }}>
        <Form
          name="normal_login"
          className="login-form"
          initialValues={{ remember: true }}
          onFinish={onFinish}
          form={form}
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入学号!' }]}
          >
            <Input prefix={<UserOutlined className="site-form-item-icon" />} placeholder="学号" />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码!' }]}
          >
            <Input
              prefix={<LockOutlined className="site-form-item-icon" />}
              type="password"
              placeholder="密码"
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              style={{
                width: '100%'
              }}
            >
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}

function Home({ setIsLogin }) {
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
  const [progress, setProgress] = useState({
    progress: 0,
    status: ''
  })

  const courseColumns = [
    {
      title: '课程名称',
      dataIndex: 'name',
    },
  ]

  useEffect(() => {
    invoke('check_login').then((res) => {
      if (!res) {
        setIsLogin(false)
      }
    }).catch((err) => {
      setIsLogin(false)
    })

    setLoadingSemesterList(true)
    invoke('get_semester_list').then((res) => {
      console.log(res)
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
      console.log(res)
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
      console.log(res)
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

    const listener = listen('download-progress', (progress) => {
      console.log(progress)
      setProgress(progress.payload)
    })

    return () => {
      listener.then((fn) => fn())
    }

  }, [])

  const onFinish = (values) => {
    let courses = courseList.filter((item) => selectedCourseKeys.includes(item.id))
    console.log(courses)
    if (courses.length === 0) {
      notification.error({
        message: '请选择课程',
        description: '请选择课程'
      })
      return
    }
    invoke('download_courses_upload', { courses }).then((res) => {
      console.log(res)
      notification.success({
        message: '下载成功',
        description: '下载成功'
      })
    }).catch((err) => {
      notification.error({
        message: '下载失败',
        description: err
      })
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
    console.log(`selected academic year ${value}`);
    setSelectedAcademicYear(value)
    setSelectedSemester(null)
    updateCourseList(value)
    setSelectedCourseKeys([])
  };

  const onSemesterChange = (value) => {
    console.log(`selected semester ${value}`);
    setSelectedSemester(value)
    updateCourseList(selectedAcademicYear, value)
    setSelectedCourseKeys([])
  };

  const filterOption = (input, option) =>
    (option?.label ?? '').toLowerCase().includes(input.toLowerCase());

  const onSelectChange = (newSelectedRowKeys) => {
    console.log('selectedRowKeys changed: ', newSelectedRowKeys);
    setSelectedCourseKeys(newSelectedRowKeys)
  };

  return (
    <div style={{
      margin: 20
    }}>
      <h1>Home</h1>
      <Button
        type='primary'
        style={{
          position: 'absolute',
          right: 30,
          top: 30
        }}
        onClick={() => {
          invoke('logout').then((res) => {
            setIsLogin(false)
          }).catch((err) => {
            notification.error({
              message: '退出登录失败',
              description: err
            })
          })
        }}
      >退出登录</Button>
      <Card
      style={{
        height: 80
      }}
      >
        <Form
          layout='horizontal'
          form={form}
          onFinish={onFinish}
        >
          <Row
            gutter={24}
            justify="space-between"
            align="middle"
          >
            <Col xs={24} md={10}>
              <Form.Item label='学年' name='academicYear'>
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
            <Col xs={24} md={10}>
              <Form.Item label='学期' name='semester'>
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
            <Col xs={24} md={4}>
              <Form.Item>
                <Button
                  type='primary'
                  htmlType='submit'
                  style={{
                    width: '100%'
                  }}
                >下载所选</Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>
      <Row
        style={{
          marginTop: 20
        }}
        gutter={20}
      >
        <Col xs={24} md={12}>
          <Table
            rowSelection={{
              selectedRowKeys: selectedCourseKeys,
              onChange: onSelectChange,
            }}
            columns={courseColumns}
            dataSource={selectedCourses}
            loading={loadingCourseList}
            pagination={false}
            scroll={{ y: 'calc(100vh - 300px)' }}
            size='small'
            bordered
            title={() => `课程列表：已选择 ${selectedCourseKeys.length} 门课程`}
          />
        </Col>
        <Col xs={24} md={12}>
          <Card>
            <h3>下载进度</h3>
            <Progress percent={Math.round(progress.progress * 100)}/>
            <p>{progress.status}</p>
          </Card>
        </Col>
      </Row>
    </div>
  )
}

function Index() {

  const [isLogin, setIsLogin] = useState(false)

  return (
    <div>
      {isLogin ? <Home setIsLogin={setIsLogin} /> : <Login setIsLogin={setIsLogin} />}
    </div>
  )
}

export default Index
