import React from 'react';
import { Modal, Form, Input, Button, Switch, Tooltip, Row, Col, Slider, InputNumber, App } from 'antd';
import { ApiOutlined, ThunderboltOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useConfig } from '../../context/ConfigContext';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Config } from '../../model';

const { TextArea } = Input;
const defaultPrompt = "你是一个专业的课程助教。请根据提供的课程字幕内容，总结课程的核心知识点、重点和难点。输出格式要求清晰、结构化，使用 Markdown 格式。";

const TemperatureInput = ({ value, onChange }: { value?: number, onChange?: (value: number | null) => void }) => {
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

interface LlmSettingsModalProps {
    open: boolean;
    onCancel: () => void;
    onOk: (values: Partial<Config>) => void;
    isEnabling: boolean;
}

export default function LlmSettingsModal({ open, onCancel, onOk, isEnabling }: LlmSettingsModalProps) {
    const { config } = useConfig();
    const { message } = App.useApp();
    const [form] = Form.useForm();
    const [showApiKey, setShowApiKey] = useState(false);
    const [testingLlm, setTestingLlm] = useState(false);

    useEffect(() => {
        if (open && config) {
            form.setFieldsValue({
                llm_api_base: config.llm_api_base,
                llm_api_key: config.llm_api_key,
                llm_model: config.llm_model,
                llm_temperature: config.llm_temperature,
                llm_hide_think_tag: config.llm_hide_think_tag,
                llm_prompt: config.llm_prompt,
            });
        }
    }, [open, config, form]);

    const handleOk = () => {
        form.validateFields().then(values => {
            onOk(values);
        }).catch(info => {
            console.log('Validate Failed:', info);
            message.error('请填写所有必填项');
        });
    };

    const handleTestLlm = () => {
        form.validateFields(['llm_api_base', 'llm_api_key', 'llm_model'])
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
            .catch(() => {
                message.warning('请先填写完整的 API 地址、Key 和模型名称');
            });
    };

    return (
        <Modal
            title="AI 课程总结配置"
            open={open}
            onOk={handleOk}
            onCancel={onCancel}
            maskClosable={!isEnabling}
            keyboard={!isEnabling}
            width={600}
        >
            <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 10 }}>
                <Form layout="vertical" form={form}>
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
                        <TemperatureInput />
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
                        <a onClick={() => form.setFieldsValue({ llm_prompt: defaultPrompt })} style={{ fontSize: 12 }}>恢复默认</a>
                    </div>
                </Form>
            </div>
        </Modal>
    );
}
