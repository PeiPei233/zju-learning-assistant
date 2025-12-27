import { useState, useEffect } from 'react';
import { App, Drawer, List, Typography, Button, Badge, Switch, Input, Space, InputNumber, Radio, Tooltip, Modal, Checkbox, Divider, Form, Row, Col, Slider } from 'antd';
import { EditOutlined, CheckOutlined, SendOutlined, ArrowLeftOutlined, SettingOutlined, ApiOutlined, InfoCircleOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import * as dialog from "@tauri-apps/plugin-dialog";

const { Text } = Typography;
const { TextArea } = Input;
const defaultPrompt = "你是一个专业的课程助教。请根据提供的课程字幕内容，总结课程的核心知识点、重点和难点。输出格式要求清晰、结构化，使用 Markdown 格式。";

export default function Settings({
  open,
  onClose,
  config,
  updateConfigField,
  updateConfigBatch,
  currentVersion,
  latestVersionData,
  setOpenVersionModal
}) {
  const { notification, message } = App.useApp();
  const [dingUrlInput, setDingUrlInput] = useState('');
  const [subtitleModalOpen, setSubtitleModalOpen] = useState(false);
  const [llmModalOpen, setLlmModalOpen] = useState(false);
  const [isEnablingLlm, setIsEnablingLlm] = useState(false);
  const subtitleLanguages = Array.isArray(config.subtitle_language) ? config.subtitle_language : ['zh'];
  const [showApiKey, setShowApiKey] = useState(false);
  const [llmForm] = Form.useForm();
  const [testingLlm, setTestingLlm] = useState(false);

  // 监听 Modal 打开状态，将 config 数据回填到 Form 中
  useEffect(() => {
    if (llmModalOpen && config) {
      llmForm.setFieldsValue({
        llm_api_base: config.llm_api_base,
        llm_api_key: config.llm_api_key,
        llm_model: config.llm_model,
        llm_temperature: config.llm_temperature,
        llm_hide_think_tag: config.llm_hide_think_tag,
        llm_prompt: config.llm_prompt,
      });
    }
  }, [llmModalOpen, config, llmForm]);

  // 当 Drawer 打开或配置更新时，同步钉钉 URL 到输入框
  useEffect(() => {
    if (open && config) {
      setDingUrlInput(config.ding_url || '');
    }
  }, [open, config]);

  const updatePath = () => {
    dialog.open({
      directory: true,
      multiple: false,
      title: '选择下载路径'
    }).then((res) => {
      if (res) {
        // v2 plugin 可能返回 string 或 null (单选模式)
        updateConfigField('save_path', res);
      }
    }).catch((err) => {
      notification.error({
        message: '下载路径修改失败',
        description: err.toString()
      })
    })
  }

  const handleTestDing = () => {
    invoke('notify_score', {
      score: { xkkh: '测试课程', kcmc: '测试课程', cj: '100', jd: '5.0', xf: '3.0' },
      oldTotalGp: 5,
      oldTotalCredit: 37,
      totalGp: 5,
      totalCredit: 40,
      dingUrl: dingUrlInput
    }).catch((err) => {
      notification.error({
        message: '发送通知失败',
        description: err.toString()
      })
    })
  }

  const handleSaveDingUrl = () => {
    updateConfigField('ding_url', dingUrlInput);
    notification.success({ message: '钉钉 Webhook 已保存' });
  }

  const handleLlmSwitchChange = (checked) => {
    if (checked) {
      // 开启时，标记为正在开启，并弹出设置窗强制确认
      setIsEnablingLlm(true);
      setLlmModalOpen(true);
    } else {
      updateConfigField('llm_enabled', false);
    }
  };

  const handleLlmModalOk = () => {
    llmForm.validateFields().then(values => {
      // 验证通过
      const newEnabledState = isEnablingLlm ? true : config.llm_enabled;
      
      // 批量更新配置
      updateConfigBatch({
        ...values,
        llm_enabled: newEnabledState
      });

      setIsEnablingLlm(false);
      setLlmModalOpen(false);
      message.success(isEnablingLlm ? "AI 总结功能已启用" : "配置已保存");
    }).catch(info => {
      console.log('Validate Failed:', info);
      message.error('请填写所有必填项');
    });
  };

  const handleLlmModalCancel = () => {
    setLlmModalOpen(false);
    // 如果是在开启过程中取消，则回滚开关状态
    if (isEnablingLlm) {
      updateConfigField('llm_enabled', false);
      setIsEnablingLlm(false);
    }
  };

  const handleTestLlm = () => {
  // 获取当前表单中的值（即使未保存）
  llmForm.validateFields(['llm_api_base', 'llm_api_key', 'llm_model'])
    .then(values => {
      setTestingLlm(true);
      invoke('test_llm_connection', {
        apiBase: values.llm_api_base,
        apiKey: values.llm_api_key,
        model: values.llm_model
      })
      .then(() => {
        message.success('连接成功！配置有效。');
      })
      .catch(err => {
        message.error(`连接失败: ${err}`);
      })
      .finally(() => {
        setTestingLlm(false);
      });
    })
    .catch(errorInfo => {
      message.warning('请先填写完整的 API 地址、Key 和模型名称');
    });
};

  return (
    <>
      <Drawer
        open={open}
        closeIcon={<ArrowLeftOutlined />}
        onClose={onClose}
        title='设置'
      >
        <List itemLayout='horizontal'>
          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>下载/同步位置</Text>}
              description={<div>
                <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>{config.save_path}</Text>
              </div>}
            />
            <Tooltip title='修改下载/同步位置'>
              <Button type='text' icon={<EditOutlined />} onClick={updatePath} />
            </Tooltip>
          </List.Item>

          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>自动导出为 PDF</Text>}
              description={<div>
                <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>开启后，从智云课堂下载的课件将自动导出为 PDF</Text>
              </div>}
            />
            <Switch checked={config.to_pdf} onChange={(checked) => updateConfigField('to_pdf', checked)} />
          </List.Item>

          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>自动下载字幕</Text>}
              description={
                <div>
                  <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>
                    下载智云课堂课件时，自动下载语音识别文本。
                  </Text>
                  {config.auto_download_subtitle && (
                    <div style={{ marginTop: 5 }}>
                      <a onClick={() => setSubtitleModalOpen(true)} style={{ fontSize: 12 }}>
                        <SettingOutlined style={{ marginRight: 4 }} />
                        高级选项
                      </a>
                    </div>
                  )}
                </div>
              }
            />
            <Switch
              checked={config.auto_download_subtitle}
              onChange={(checked) => updateConfigField('auto_download_subtitle', checked)}
            />
          </List.Item>

          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>AI 课程总结</Text>}
              description={
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>调用大模型自动生成课程纪要</Text>
                  {config.llm_enabled && (
                    <div style={{ marginTop: 5 }}>
                      <a onClick={() => setLlmModalOpen(true)} style={{ fontSize: 12 }}>
                        <SettingOutlined style={{ marginRight: 4 }} />
                        模型参数配置
                      </a>
                    </div>
                  )}
                </div>
              }
            />
            <Switch
              checked={config.llm_enabled}
              onChange={handleLlmSwitchChange}
            />
          </List.Item>

          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>课件更新时自动下载</Text>}
              description={<div>
                <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>开启学在浙大课件自动同步后，若开启该选项，则检测到新课件时会自动下载。否则仅会加入课件列表。</Text>
              </div>}
            />
            <Switch checked={config.auto_download} onChange={(checked) => updateConfigField('auto_download', checked)} />
          </List.Item>

          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>钉钉机器人 Webhook</Text>}
              description={
                <div>
                  <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>检测到成绩更新后，将使用以下钉钉机器人 Webhook 发送通知。若留空，则不使用钉钉机器人发送通知。</Text>
                  <Space.Compact style={{ marginTop: 10, width: '100%' }}>
                    <Input placeholder='输入完整的钉钉机器人 Webhook' value={dingUrlInput} onChange={(e) => setDingUrlInput(e.target.value)} />
                    <Button icon={<Tooltip title='发送测试消息'><SendOutlined /></Tooltip>} onClick={handleTestDing} />
                    <Button icon={<Tooltip title='保存'><CheckOutlined /></Tooltip>} onClick={handleSaveDingUrl} />
                  </Space.Compact>
                </div>
              }
            />
          </List.Item>

          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>下载开始时显示下载列表</Text>}
              description={<div>
                <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>关闭此设置会使人更难知道文件何时开始下载</Text>
              </div>}
            />
            <Switch checked={config.auto_open_download_list} onChange={(checked) => updateConfigField('auto_open_download_list', checked)} />
          </List.Item>

          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>最大并行下载任务数</Text>}
              description={<div>
                <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>同时进行下载的最大任务数量</Text>
              </div>}
            />
            <InputNumber min={1} value={config.max_concurrent_tasks} changeOnWheel
              onChange={(value) => {
                if (!value || value < 1) value = 1;
                updateConfigField('max_concurrent_tasks', value);
              }}
            />
          </List.Item>

          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>关闭应用后保持后台运行</Text>}
              description={<div>
                <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>若开启，关闭应用窗口后应用会保持后台运行，并保留托盘图标。</Text>
              </div>}
            />
            <Switch checked={config.tray} onChange={(checked) => updateConfigField('tray', checked)} />
          </List.Item>

          <List.Item>
            <List.Item.Meta
              title={<Text style={{ fontWeight: 'normal' }}>开机自启</Text>}
              description={<div>
                <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>若开启，应用会在开机时自动启动。</Text>
              </div>}
            />
            <Switch checked={config.auto_start} onChange={(checked) => updateConfigField('auto_start', checked)} />
          </List.Item>

          <a onClick={() => setOpenVersionModal(true)}>
            <List.Item>
              <List.Item.Meta
                title={<Badge count={(!latestVersionData || (latestVersionData && latestVersionData.tag_name === currentVersion) ? 0 : 'New')} size='small'>
                  <Text style={{ fontWeight: 'normal' }}>应用版本</Text>
                </Badge>}
              />
              <Text>{currentVersion}</Text>
            </List.Item>
          </a>
        </List>

        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', marginTop: 20 }}>
          <Text type='secondary' style={{ fontSize: 12 }}>Made by PeiPei</Text>
          <Text type='secondary' style={{ fontSize: 12 }}>此软件仅供学习交流使用，严禁用于商业用途</Text>
        </div>
      </Drawer>

      <Modal
        title="字幕高级设置"
        open={subtitleModalOpen}
        onOk={() => setSubtitleModalOpen(false)}
        onCancel={() => setSubtitleModalOpen(false)}
        width={600}
        footer={[
          <Button key="confirm" type="primary" onClick={() => setSubtitleModalOpen(false)}>
            确定
          </Button>
        ]}
      >
        <List>
          <List.Item>
            <List.Item.Meta 
              title="文件格式" 
              description="选择保存的字幕文件格式"
            />
            <Radio.Group 
              value={config.subtitle_format || 'srt'} 
              onChange={(e) => updateConfigField('subtitle_format', e.target.value)}
              buttonStyle="solid"
            >
              <Radio.Button value="srt">SRT</Radio.Button>
              <Radio.Button value="md">Markdown</Radio.Button>
              <Radio.Button value="txt">TXT</Radio.Button>
            </Radio.Group>
          </List.Item>

          <List.Item>
            <List.Item.Meta 
              title="语言" 
              description="选择下载的语音文本语言"
            />
            <Checkbox.Group 
              options={[
                { label: '中文', value: 'zh' },
                { label: 'English', value: 'en' },
                { label: '中英穿插', value: 'mixed' },
              ]}
              value={subtitleLanguages}
              onChange={(checkedValues) => updateConfigField('subtitle_language', checkedValues)}
            />
          </List.Item>

          <List.Item>
            <List.Item.Meta 
              title="包含时间戳" 
              description={config.subtitle_format === 'srt' ? "SRT 格式必须包含时间戳" : "在文本/Markdown中保留时间信息"}
            />
            <Switch 
              checked={config.subtitle_format === 'srt' ? true : config.subtitle_with_timestamps} 
              disabled={config.subtitle_format === 'srt'}
              onChange={(checked) => updateConfigField('subtitle_with_timestamps', checked)}
            />
          </List.Item>
        </List>
      </Modal>

      <Modal
        title="AI 课程总结配置"
        open={llmModalOpen}
        onOk={handleLlmModalOk}
        onCancel={handleLlmModalCancel}
        maskClosable={!isEnablingLlm}
        keyboard={!isEnablingLlm}
        width={600}
      >
        <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 10 }}>
          <Form layout="vertical" form={llmForm}>
            <Form.Item 
              label="API 请求地址 (Base URL)" 
              name="llm_api_base"
              tooltip="OpenAI 格式接口地址，例如 https://api.deepseek.com"
              rules={[{ required: true, whitespace: true, message: '请输入 API 请求地址' }]}
            >
              <Input prefix={<ApiOutlined style={{ color: 'rgba(0,0,0,.25)' }} />} placeholder="例如 https://api.deepseek.com" />
            </Form.Item>

            <Form.Item 
              label="API Key" 
              name="llm_api_key"
              rules={[{ required: true, whitespace: true, message: '请输入 API Key' }]}
            >
              <Input.Password
                placeholder="sk-..."
                visibilityToggle={{ visible: showApiKey, onVisibleChange: setShowApiKey }}
              />
            </Form.Item>

            <Form.Item 
              label="模型名称" 
              name="llm_model"
              rules={[{ required: true, whitespace: true, message: '请输入模型名称' }]}
            >
              <Input prefix={<ThunderboltOutlined style={{ color: 'rgba(0,0,0,.25)' }} />} placeholder="例如 deepseek-chat" />
            </Form.Item>

            <div style={{ marginBottom: 24, marginLeft: 0 }}>
              <Button 
                type="dashed" 
                icon={<ApiOutlined />} 
                loading={testingLlm} 
                onClick={handleTestLlm}
                block
              >
                测试 LLM 连接
              </Button>
            </div>

            <Form.Item label="温度 (Temperature)" name="llm_temperature">
               {/* 使用 Render Props 或者简单的受控组件写法来同步 Form 内部状态 */}
               <TemperatureInput form={llmForm} />
            </Form.Item>

            <Form.Item 
              label={<span>隐藏 &lt;think&gt; 标签内容<Tooltip title="针对深度思考模型(如DeepSeek-R1)，过滤掉思维链内容"><InfoCircleOutlined style={{ marginLeft: 4 }} /></Tooltip></span>} 
              name="llm_hide_think_tag" 
              valuePropName="checked"
            >
              <Switch size="small" />
            </Form.Item>

            <Form.Item label="自定义提示词 (System Prompt)" name="llm_prompt">
              <TextArea rows={3} placeholder={defaultPrompt} style={{ resize: 'none', fontSize: 12 }} />
            </Form.Item>

            <div style={{ textAlign: 'right', marginTop: -20 }}>
              <a onClick={() => llmForm.setFieldsValue({ llm_prompt: defaultPrompt })} style={{ fontSize: 12 }}>恢复默认</a>
            </div>
          </Form>
        </div>
      </Modal>
    </>
  )
}

const TemperatureInput = ({ value, onChange }) => {
  return (
    <Row gutter={16}>
      <Col span={16}>
        <Slider 
          min={0} 
          max={2} 
          step={0.1} 
          value={typeof value === 'number' ? value : 0.3} 
          onChange={onChange} 
        />
      </Col>
      <Col span={8}>
        <InputNumber 
          min={0} 
          max={2} 
          step={0.1} 
          style={{ width: '100%' }} 
          value={typeof value === 'number' ? value : 0.3} 
          onChange={onChange} 
        />
      </Col>
    </Row>
  );
};