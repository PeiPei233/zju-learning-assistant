import { useDesktopApp } from '../context/NotificationContext';
import MultiChoice from '../components/MultiChoice';
import React, { useState } from 'react';
import { Checkbox, DatePicker, Input, InputNumber, Segmented, Select, Switch } from 'antd';
import { ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import ActionButton from '../components/ActionButton';
import IconAction from '../components/IconAction';
import ResourceList from '../components/ResourceList';

export default function ControlsPreview() {
  const { notification } = useDesktopApp();
  const [languages, setLanguages] = useState(['zh']);
  const [selected, setSelected] = useState<React.Key[]>([1]);
  const options = [{ value: 'spring', label: '春学期' }, { value: 'summer', label: '夏学期' }];
  return <main className="controls-preview">
    <h1>控件检查</h1><p>开发预览 · 检查鼠标悬停、键盘焦点、深浅色及窗口缩放</p>
    <section><h2>通知</h2><div className="control-examples">
      <ActionButton onClick={() => notification.success({ title: '下载完成', description: '已保存 3 个文件 · 6.94 MB' })}>成功通知</ActionButton>
      <ActionButton onClick={() => notification.error({ title: '获取课件失败', description: '网络连接中断，请稍后重试。' })}>失败通知</ActionButton>
      <ActionButton onClick={() => notification.warning({ title: '登录已失效', description: '重新登录后即可继续获取课件。' })}>警告通知</ActionButton>
      <ActionButton onClick={() => notification.error({ key: 'preview-retry', title: '1 个文件下载失败', description: '实验指导与参考资料.zip', actions: <ActionButton onClick={() => { notification.destroy('preview-retry'); notification.success({ title: '重试成功', description: '通知操作回调已执行。' }); }}>重试</ActionButton> })}>带操作通知</ActionButton>
      <ActionButton onClick={() => notification.destroy()}>清除通知</ActionButton>
    </div></section>
    <section><h2>操作</h2><div className="control-examples">
      <ActionButton>轻量操作</ActionButton><ActionButton variant="secondary"><ReloadOutlined />获取课件</ActionButton><ActionButton variant="primary"><DownloadOutlined />下载所选课件</ActionButton>
      <IconAction label="重新下载"><ReloadOutlined /></IconAction><ActionButton disabled>不可用操作</ActionButton>
      <ActionButton variant="secondary" disabled><ReloadOutlined spin />正在获取</ActionButton>
    </div></section>
    <section><h2>输入与选择</h2><div className="control-examples control-examples-fields">
      <Input aria-label="普通输入" placeholder="输入课程名称" allowClear />
      <Input.Password aria-label="密码输入" placeholder="输入密码" />
      <Select aria-label="单选学期" placeholder="选择学期" options={options} allowClear />
      <Select aria-label="多选学期" mode="multiple" defaultValue={['spring']} options={options} />
      <DatePicker aria-label="日期" placeholder="选择日期" />
      <InputNumber aria-label="并行下载数" min={1} defaultValue={3} />
      <Input aria-label="禁用输入" disabled value="不可编辑" />
      <Select aria-label="加载学期" loading placeholder="加载学期" options={[]} />
      <Input aria-label="错误输入" status="error" defaultValue="示例错误状态" />
      <DatePicker.RangePicker aria-label="日期范围" />
    </div></section>
    <section><h2>开关与复选</h2><div className="control-examples">
      <Switch aria-label="已开启" defaultChecked /><Switch aria-label="未开启" /><Switch aria-label="禁用开关" disabled />
      <Switch aria-label="加载开关" loading defaultChecked />
      <Checkbox defaultChecked>已选择</Checkbox><Checkbox>未选择</Checkbox><Checkbox indeterminate>部分选择</Checkbox><Checkbox disabled>不可选</Checkbox>
    </div></section>
    <section><h2>多选选项</h2><MultiChoice label="字幕语言" options={[{ label: '中文', value: 'zh' }, { label: 'English', value: 'en' }, { label: '中英穿插', value: 'mixed' }]} value={languages} onChange={setLanguages} /></section>
    <section><h2>分段选择</h2><Segmented options={['日', '周', '月']} defaultValue="周" /></section>
    <section className="control-examples-list"><ResourceList title="课程文件" items={[{ id: 1, name: '课程导论.pdf' }, { id: 2, name: '实验指导.pdf' }]}
      itemKey={item => item.id} fields={[{ label: '文件名', value: item => item.name }, { label: '课程', value: () => '计算机网络' }]}
      sorts={[{ label: '名称排序', compare: (a, b) => a.name.localeCompare(b.name) }]} selectedKeys={selected} onSelectionChange={setSelected}
      renderItem={item => ({ title: item.name, titleField: '文件名', subtitle: [{ text: '计算机网络', field: '课程' }] })} /></section>
  </main>;
}
