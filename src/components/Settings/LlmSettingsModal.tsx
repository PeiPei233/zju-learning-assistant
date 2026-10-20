import { Input, Slider, InputNumber } from 'antd';
import { ApiOutlined, LoadingOutlined, ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useConfig } from '../../context/ConfigContext';
import { useEffect, useState, useRef } from 'react';
import { invoke } from '../../bridge';
import { Config } from '../../model';
import ActionButton from '../ActionButton';
import SettingsSwitch from './SettingsSwitch';
import AutosaveModal from './AutosaveModal';
import SettingField from './SettingField';
import { useConfigAutosave } from '../../hooks/useConfigAutosave';

const { TextArea } = Input;
const defaultPrompt = "你是一个专业的课程助教。请根据提供的课程字幕内容，总结课程的核心知识点、重点和难点。输出格式要求清晰、结构化，使用 Markdown 格式。";

const TemperatureInput = ({ value, onChange, disabled }: { value?: number, onChange?: (value: number) => void, disabled?: boolean }) => {
  const [empty, setEmpty] = useState(false);
  const temperature = value ?? 0.3;
  const change = (next: number | null) => {
    setEmpty(next === null);
    // Clearing is an editing state, not a configuration value to autosave.
    if (next !== null && Number.isFinite(next) && next >= 0 && next <= 2) onChange?.(next);
  };
  return (
    <div className="llm-temperature">
      <Slider disabled={disabled} min={0} max={2} step={0.1} value={temperature} onChange={change} ariaLabelForHandle="温度" />
      <InputNumber disabled={disabled} min={0} max={2} step={0.1} value={empty ? null : temperature} onChange={change}
        onBlur={() => setEmpty(false)} aria-label="温度数值" variant="filled" />
    </div>
  );
};

interface LlmSettingsModalProps {
  inline?: boolean;
  open: boolean;
  onCancel: () => void;
}

export default function LlmSettingsModal({ open, onCancel, inline = false }: LlmSettingsModalProps) {
  const { config } = useConfig();
  const [draft, setDraft] = useState(config);
  const draftRef = useRef(draft);
  const [errors, setErrors] = useState<Partial<Record<keyof Config, string>>>({});
  const errorsRef = useRef(errors);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  const testingRef = useRef(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const setFieldErrors = (next: typeof errors) => { errorsRef.current = next; setErrors(next); };
  const focusError = () => {
    const field = Object.keys(errorsRef.current).find(key => errorsRef.current[key as keyof Config]);
    const input = field ? bodyRef.current?.querySelector<HTMLElement>(`#${field}`) : null;
    input?.focus();
    input?.scrollIntoView?.({ block: 'nearest' });
  };
  const validate = (fields: (keyof Config)[], required = false) => {
    const next = { ...errorsRef.current };
    for (const field of fields) delete next[field];
    const value = draftRef.current;
    if (fields.includes('llm_api_base') && value.llm_api_base?.trim()) {
      try { if (!/^https?:$/.test(new URL(value.llm_api_base).protocol)) throw new Error(); }
      catch { next.llm_api_base = '请输入完整的 http 或 https 地址'; }
    }
    if (required) {
      const requiredFields = { llm_api_base: '请输入 API 请求地址', llm_api_key: '请输入 API Key', llm_model: '请输入模型名称' } as const;
      for (const field of Object.keys(requiredFields) as (keyof typeof requiredFields)[]) {
        if (!value[field]?.trim()) next[field] = requiredFields[field];
      }
    }
    setFieldErrors(next);
    return !fields.some(field => next[field]);
  };
  const autosave = useConfigAutosave(async fields => validate(fields));
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && (!wasOpen.current || inline)) {
      const next = config.clone();
      if (inline) for (const field of Object.keys(draftRef.current) as (keyof Config)[]) {
        if (autosave.hasDraft(field)) Object.assign(next, { [field]: draftRef.current[field] });
      }
      draftRef.current = next;
      setDraft(next);
      if (!wasOpen.current) {
        errorsRef.current = {}; setErrors({}); setShowApiKey(false); setTestResult(null);
      }
    }
    wasOpen.current = open;
  // Draft fields survive configuration updates from other controls.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config, inline]);

  const change = <K extends keyof Config>(field: K, value: Config[K], delay?: number) => {
    const patch = { [field]: value };
    const next = Object.assign(draftRef.current.clone(), patch);
    draftRef.current = next;
    setDraft(next);
    const nextErrors = { ...errorsRef.current };
    delete nextErrors[field];
    setFieldErrors(nextErrors);
    setTestResult(null);
    autosave.change(patch, delay);
  };
  const handleTestLlm = async () => {
    if (testingRef.current) return;
    if (!validate(['llm_api_base', 'llm_api_key', 'llm_model'], true)) { focusError(); return; }
    testingRef.current = true;
    setTestingLlm(true);
    setTestResult(null);
    const values = draftRef.current;
    try {
      await invoke('test_llm_connection', { apiBase: values.llm_api_base, apiKey: values.llm_api_key, model: values.llm_model });
      setTestResult({ ok: true, text: '连接成功，配置可用' });
    } catch (err) { setTestResult({ ok: false, text: String(err) }); }
    finally { testingRef.current = false; setTestingLlm(false); }
  };
  const inputProps = (field: 'llm_api_base' | 'llm_api_key' | 'llm_model') => ({
    id: field, value: draft[field] ?? '', status: errors[field] ? 'error' as const : undefined,
    'aria-invalid': !!errors[field], 'aria-describedby': errors[field] ? `${field}-error` : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => change(field, event.target.value),
    onBlur: () => { void autosave.save([field]); },
  });

  return (
    <AutosaveModal inline={inline} title="AI 课程总结配置" className="llm-settings-modal" open={open}
      onClose={() => { if (inline) { draftRef.current = config; setDraft(config); setFieldErrors({}); setTestResult(null); } else onCancel(); }} autosave={autosave} busy={testingLlm} onInvalid={focusError}>
      {locked => <div className="llm-settings-body" ref={bodyRef}>
          <section className="llm-section" aria-label="连接配置">
            <SettingField label="API 地址" htmlFor="llm_api_base" error={errors.llm_api_base}>
              <Input {...inputProps('llm_api_base')} disabled={locked} variant="filled" placeholder="https://api.openai.com/v1" />
            </SettingField>
            <SettingField label="API Key" htmlFor="llm_api_key" error={errors.llm_api_key}>
              <Input.Password {...inputProps('llm_api_key')} disabled={locked} variant="filled" placeholder="sk-..." autoComplete="off"
                visibilityToggle={{ visible: showApiKey, onVisibleChange: setShowApiKey }} />
            </SettingField>
            <SettingField label="模型名称" htmlFor="llm_model" error={errors.llm_model}>
              <div className="llm-model-control">
                <Input {...inputProps('llm_model')} disabled={locked} variant="filled" placeholder="填写模型名称" />
                <ActionButton disabled={locked} aria-busy={testingLlm} onClick={handleTestLlm}>
                  {testingLlm ? <LoadingOutlined spin /> : <ApiOutlined />}<span>{testingLlm ? '正在测试…' : '测试连接'}</span>
                </ActionButton>
              </div>
              <div className="llm-test-result" role="status" aria-live="polite">
                {testResult && <>{testResult.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}<span>{testResult.text}</span></>}
              </div>
            </SettingField>
          </section>
          <section className="llm-section" aria-label="总结输出">
            <SettingField label="温度" description="较低的值让总结更稳定，较高的值让表达更多样。">
              <TemperatureInput key={String(open)} disabled={locked} value={draft.llm_temperature} onChange={value => change('llm_temperature', value, 800)} />
            </SettingField>
            <SettingField label="隐藏思考过程" htmlFor="llm_hide_think_tag" description="过滤模型输出的 <think> 标签及其内容。">
              <SettingsSwitch field="llm_hide_think_tag" checked={draft.llm_hide_think_tag} onChange={value => change('llm_hide_think_tag', value, 0)} disabled={locked} id="llm_hide_think_tag" aria-label="隐藏思考过程" />
            </SettingField>
            <SettingField label="总结提示词" htmlFor="llm_prompt" stacked action={
              <ActionButton disabled={locked} onClick={() => change('llm_prompt', defaultPrompt, 0)}><ReloadOutlined />恢复默认</ActionButton>
            }>
              <TextArea id="llm_prompt" disabled={locked} value={draft.llm_prompt ?? ''} onChange={event => change('llm_prompt', event.target.value, 800)} variant="filled" rows={4} placeholder={defaultPrompt} />
            </SettingField>
          </section>
      </div>}
    </AutosaveModal>
  );
}
