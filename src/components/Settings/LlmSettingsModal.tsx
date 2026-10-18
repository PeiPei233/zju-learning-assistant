import { Form, Input, Slider, InputNumber } from 'antd';
import { ApiOutlined, LoadingOutlined, ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useConfig } from '../../context/ConfigContext';
import { useEffect, useState, useRef } from 'react';
import { invoke } from '../../bridge';
import { Config } from '../../model';
import ActionButton from '../ActionButton';
import SettingsSwitch from './SettingsSwitch';
import AutosaveModal from './AutosaveModal';
import { useConfigAutosave } from '../../hooks/useConfigAutosave';

const { TextArea } = Input;
const defaultPrompt = "你是一个专业的课程助教。请根据提供的课程字幕内容，总结课程的核心知识点、重点和难点。输出格式要求清晰、结构化，使用 Markdown 格式。";

const TemperatureInput = ({ value, onChange }: { value?: number, onChange?: (value: number) => void }) => {
  const [empty, setEmpty] = useState(false);
  const temperature = value ?? 0.3;
  const change = (next: number | null) => {
    setEmpty(next === null);
    // Clearing is an editing state, not a configuration value to autosave.
    if (next !== null && Number.isFinite(next) && next >= 0 && next <= 2) onChange?.(next);
  };
  return (
    <div className="llm-temperature">
      <Slider min={0} max={2} step={0.1} value={temperature} onChange={change} ariaLabelForHandle="温度" />
      <InputNumber min={0} max={2} step={0.1} value={empty ? null : temperature} onChange={change}
        onBlur={() => setEmpty(false)} aria-label="温度数值" variant="filled" />
    </div>
  );
};

interface LlmSettingsModalProps {
  open: boolean;
  onCancel: () => void;
}

export default function LlmSettingsModal({ open, onCancel }: LlmSettingsModalProps) {
  const { config } = useConfig();
  const [form] = Form.useForm();
  const [showApiKey, setShowApiKey] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);

  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const autosave = useConfigAutosave(async fields => {
    try { await form.validateFields(fields); return true; }
    catch { return false; }
  });
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setShowApiKey(false);
      setTestResult(null);
      form.resetFields();
      form.setFieldsValue({
        llm_api_base: config.llm_api_base,
        llm_api_key: config.llm_api_key,
        llm_model: config.llm_model,
        llm_temperature: config.llm_temperature,
        llm_hide_think_tag: config.llm_hide_think_tag,
        llm_prompt: config.llm_prompt,
      });
    }
    wasOpen.current = open;
  }, [open, config, form]);

  const handleChange = (values: Partial<Config>) => {
    setTestResult(null);
    const field = Object.keys(values)[0];
    autosave.change(values, field === 'llm_hide_think_tag' ? 0 :
      field === 'llm_prompt' || field === 'llm_temperature' ? 800 : undefined);
  };

  const handleTestLlm = () => {
    if (testingLlm) return;
    const required = [
      ['llm_api_base', '请输入 API 请求地址'], ['llm_api_key', '请输入 API Key'], ['llm_model', '请输入模型名称'],
    ];
    const missing = required.filter(([name]) => !form.getFieldValue(name)?.trim());
    if (missing.length) {
      form.setFields(missing.map(([name, message]) => ({ name, errors: [message] })));
      form.scrollToField(missing[0][0], { focus: true });
      return;
    }
    form.validateFields(['llm_api_base', 'llm_api_key', 'llm_model'])
      .then(values => {
        setTestingLlm(true);
        setTestResult(null);
        invoke('test_llm_connection', {
          apiBase: values.llm_api_base,
          apiKey: values.llm_api_key,
          model: values.llm_model
        })
          .then(() => {
            setTestResult({ ok: true, text: '连接成功，配置可用' });
          })
          .catch(err => {
            setTestResult({ ok: false, text: String(err) });
          })
          .finally(() => {
            setTestingLlm(false);
          });
      })
      .catch(() => {
        const first = form.getFieldsError().find(field => field.errors.length);
        if (first) form.scrollToField(first.name, { focus: true });
      });
  };

  return (
    <AutosaveModal title="AI 课程总结配置" className="llm-settings-modal" open={open}
      onClose={onCancel} autosave={autosave} busy={testingLlm} onInvalid={() => {
        const first = form.getFieldsError().find(field => field.errors.length);
        if (first) form.scrollToField(first.name, { focus: true });
      }}>
      {locked => <div className="llm-settings-body">
        <p className="llm-intro">使用课程字幕生成总结，支持 OpenAI 兼容接口。</p>
        <Form disabled={locked} layout="vertical" form={form} requiredMark={false} onValuesChange={handleChange}>
          <section className="llm-section" aria-labelledby="llm-connection-heading">
            <div className="llm-section-heading">
              <h3 id="llm-connection-heading">连接</h3>
              <ActionButton disabled={locked} aria-busy={testingLlm} onClick={handleTestLlm}>
                {testingLlm ? <LoadingOutlined /> : <ApiOutlined />}<span>{testingLlm ? '正在测试…' : '测试连接'}</span>
              </ActionButton>
            </div>
            <Form.Item label="API 地址" name="llm_api_base"
              rules={[{ validator: (_, value) => { if (!value?.trim()) return Promise.resolve(); try { if (!/^https?:$/.test(new URL(value).protocol)) throw new Error(); return Promise.resolve(); } catch { return Promise.reject(new Error('请输入完整的 http 或 https 地址')); } } }]}>
              <Input variant="filled" placeholder="https://api.openai.com/v1" onBlur={() => autosave.save(['llm_api_base'])} />
            </Form.Item>
            <Form.Item label="API Key" name="llm_api_key">
              <Input.Password variant="filled" placeholder="sk-..." autoComplete="off" onBlur={() => autosave.save(['llm_api_key'])}
                visibilityToggle={{ visible: showApiKey, onVisibleChange: setShowApiKey }} />
            </Form.Item>
            <Form.Item label="模型名称" name="llm_model">
              <Input variant="filled" placeholder="填写服务商提供的模型名称" onBlur={() => autosave.save(['llm_model'])} />
            </Form.Item>
            <div className="llm-test-result" role="status" aria-live="polite">
              {testResult && <>{testResult.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}<span>{testResult.text}</span></>}
            </div>
          </section>
          <section className="llm-section" aria-labelledby="llm-output-heading">
            <h3 id="llm-output-heading">总结输出</h3>
            <Form.Item label="温度" name="llm_temperature" extra="较低的值让总结更稳定，较高的值让表达更多样。">
              <TemperatureInput />
            </Form.Item>
            <div className="llm-switch-row">
              <div><label htmlFor="llm_hide_think_tag">隐藏思考过程</label><p>过滤模型输出的 &lt;think&gt; 标签及其内容。</p></div>
              <Form.Item name="llm_hide_think_tag" valuePropName="checked" noStyle>
                <SettingsSwitch field="llm_hide_think_tag" disabled={locked} id="llm_hide_think_tag" aria-label="隐藏思考过程" />
              </Form.Item>
            </div>
            <div className="llm-prompt-heading">
              <label htmlFor="llm_prompt">总结提示词</label>
              <ActionButton disabled={locked} onClick={() => { form.setFieldsValue({ llm_prompt: defaultPrompt }); autosave.change({ llm_prompt: defaultPrompt }, 0); }}><ReloadOutlined />恢复默认</ActionButton>
            </div>
            <Form.Item name="llm_prompt">
              <TextArea id="llm_prompt" variant="filled" rows={4} placeholder={defaultPrompt} />
            </Form.Item>
          </section>
        </Form>
      </div>}
    </AutosaveModal>
  );
}
