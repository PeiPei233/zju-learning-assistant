import { useState, useEffect } from 'react'
import { Button, Card, App, Typography, Table, Tag, Space, Dropdown, Switch, Tooltip } from 'antd';
import { SyncOutlined, ExportOutlined, DownOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';

const { Text } = Typography

export default function Todo({
    todos,
    loading,
    lastSync,
    handleSync,
    syncing,
    handleSwitch,
    config,
}) {

    const { message, modal, notification } = App.useApp()

    const columns = [
        {
            title: '课程名称',
            dataIndex: 'course_name',
            key: 'course_name',
            width: '30%',
        },
        {
            title: '任务名称',
            dataIndex: 'title',
            key: 'title',
            width: '40%',
            render: (text, record) => (
                <a onClick={() => {
                    const url = `https://courses.zju.edu.cn/course/${record.course_id}/learning-activity#/${record.id}?view=scores`
                    open(url).catch((err) => {
                        notification.error({
                            message: '打开链接失败',
                            description: err.message || err
                        })
                    })
                }}>{text}</a>
            )
        },
        {
            title: '截止时间',
            dataIndex: 'end_time',
            key: 'end_time',
            width: '30%',
            sorter: (a, b) => {
                if (!a.end_time) return 1;
                if (!b.end_time) return -1;
                return dayjs(a.end_time).diff(dayjs(b.end_time))
            },
            render: (text) => {
                if (!text) {
                    return <Tag color="success">无截止时间</Tag>
                }
                const diff = dayjs(text).diff(dayjs(), 'hour')
                let color = 'green'
                if (diff < 24) {
                    color = 'red'
                } else if (diff < 72) {
                    color = 'orange'
                }
                return <Tag color={color}>{dayjs(text).format('YYYY-MM-DD HH:mm')}</Tag>
            }
        },
    ]

    const exportItems = [
        {
            key: 'ics',
            label: '导出为 iCalendar 文件',
        },
        {
            key: 'mail',
            label: '发送至邮箱',
            disabled: !config.mail_notifications,
        },
        {
            key: 'calendar',
            label: '添加至日历 App (macOS)',
            disabled: !window.navigator.userAgent.includes('Mac')
        },
        {
            key: 'reminder',
            label: '添加至提醒事项 App (macOS)',
            disabled: !window.navigator.userAgent.includes('Mac')
        },
    ];

    const handleExport = ({ key }) => {
        switch (key) {
            case 'ics' || 'calendar' || 'reminder':
                invoke('export_todo', { todoList: todos, location: key }).catch((err) => {
                    notification.error({
                        message: '导出失败',
                        description: err
                    })
                })
                break;
            case 'mail':
                invoke('mail_todo', {
                    todoList: todos,
                    smtpHost: config.smtp_host,
                    smtpPort: config.smtp_port,
                    smtpUsername: config.smtp_username,
                    smtpPassword: config.smtp_password,
                    mailRecipient: config.mail_recipient,
                }).catch((err) => {
                    notification.error({
                        message: '发送邮件失败',
                        description: err
                    })
                })
                break;
        }
    }

    return (
        <div style={{ margin: 20 }}>
            <Card styles={{ body: { padding: 15 } }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }} >
                    <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'row' }}>
                        <Text style={{ minWidth: 115 }}>自动同步并提醒：</Text>
                        <Tooltip title={syncing ? '待办事项同步已开启，将自动同步最新待办事项并在截止前提醒' : '待办事项同步已关闭，开启后将自动同步最新待办事项并在截止前提醒'}>
                            <Switch loading={loading} checked={syncing} onChange={handleSwitch} />
                        </Tooltip>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'row', marginLeft: 20 }}>
                        <Dropdown menu={{ items: exportItems, onClick: handleExport }}>
                            <Button icon={<ExportOutlined />} style={{ marginRight: 10 }}>
                                导出 <DownOutlined />
                            </Button>
                        </Dropdown>
                        <Button type='primary' icon={<SyncOutlined />} loading={loading} onClick={handleSync}>{loading ? '正在同步' : '立即同步'}</Button>
                    </div>
                </div>
            </Card>
            <Table
                columns={columns}
                dataSource={todos}
                rowKey={(record) => `${record.course_id}-${record.id}`}
                pagination={false}
                scroll={{ y: 'calc(100vh - 255px)' }}
                size='small'
                bordered
                footer={() => `最后同步时间：${lastSync ? lastSync : '未同步'}，共 ${todos.length} 条待办事项`}
                style={{ marginTop: 20 }}
                loading={loading}
            />
        </div>
    )
}
