import { Input, Slider, InputNumber } from 'antd';
import { ApiOutlined, LoadingOutlined, ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useConfig } from '../../context/ConfigContext';
import { useEffect, useState, useRef } from 'react';
import { invoke } from '../../bridge';
import { Config } from '../../model';
import ActionButton from '../../components/ActionButton';
import SettingSwitch from './SettingSwitch';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import SettingField from './SettingField';
import { useConfigAutosave } from '../../hooks/useConfigAutosave';

const { TextArea } = Input;
const defaultPrompt = "你是一个专业的课程助教。请根据提供的课程字幕内容，总结课程的核心知识点、重点和难点。输出格式要求清晰、结构化，使用 Markdown 格式。";

const TemperatureInput = ({ value, onChange, disabled, descriptionId }: { descriptionId?: string, value?: number, onChange?: (value: number) => void, disabled?: boolean }) => {
  const [empty, setEmpty] = useState(false);
  const [temperature, setTemperature] = useState(value ?? 0.3);
  useEffect(() => { setTemperature(value ?? 0.3); }, [value]);
  const change = (next: number | null) => {
    setEmpty(next === null);
    // Clearing is an editing state, not a configuration value to autosave.
    if (next !== null && Number.isFinite(next) && next >= 0 && next <= 2) setTemperature(next);
  };
  return (
    <div className="llm-temperature" role="group" aria-label="温度" aria-describedby={descriptionId}>
      <Slider disabled={disabled} min={0} max={2} step={0.1} value={temperature} onChange={change} onChangeComplete={next => onChange?.(next)} ariaLabelForHandle="温度" />
      <InputNumber disabled={disabled} min={0} max={2} step={0.1} value={empty ? null : temperature} onChange={change}
        onBlur={() => { setEmpty(false); if (temperature !== (value ?? 0.3)) onChange?.(temperature); }} aria-label="温度数值" aria-describedby={descriptionId} variant="filled" />
    </div>
  );
};

export default function LlmSetting() {
  const { config, isSaving, updateConfigField } = useConfig();
  const savingSettings = useDelayedBusy(isSaving());
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
  useEffect(() => {
    const next = config.clone();
    for (const field of Object.keys(draftRef.current) as (keyof Config)[]) {
      if (autosave.hasDraft(field)) Object.assign(next, { [field]: draftRef.current[field] });
    }
    draftRef.current = next;
    setDraft(next);
    // Draft fields survive configuration updates from other controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

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

  const locked = testingLlm || savingSettings;
  return (
    <div className="settings-inline llm-settings">
      <div className="llm-settings-body" ref={bodyRef}>
        <section className="llm-section" aria-label="连接配置">
          <SettingField label="API 地址" htmlFor="llm_api_base" description="填写服务提供的完整 API 地址，包含 http 或 https。" error={errors.llm_api_base}>{descriptionId => <>
            <Input {...inputProps('llm_api_base')} disabled={locked} variant="filled" placeholder="请输入 API 地址" aria-describedby={[descriptionId, inputProps('llm_api_base')['aria-describedby']].filter(Boolean).join(' ')} />
          </>}</SettingField>
          <SettingField label="API Key" htmlFor="llm_api_key" error={errors.llm_api_key}>
            <Input.Password {...inputProps('llm_api_key')} disabled={locked} variant="filled" placeholder="请输入 API Key" autoComplete="off"
              visibilityToggle={{ visible: showApiKey, onVisibleChange: setShowApiKey }} />
          </SettingField>
          <SettingField label="模型名称" htmlFor="llm_model" error={errors.llm_model}>
            <div className="llm-model-control">
              <Input {...inputProps('llm_model')} disabled={locked} variant="filled" placeholder="请输入模型名称" />
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
          <SettingField label="温度" description="较低的值让总结更稳定，较高的值让表达更多样。">{descriptionId => <>
            <TemperatureInput disabled={locked} value={config.llm_temperature} onChange={value => updateConfigField('llm_temperature', value)} descriptionId={descriptionId} />
          </>}</SettingField>
          <SettingField label="隐藏思考过程" htmlFor="llm_hide_think_tag" description="过滤模型输出的 <think> 标签及其内容。">{descriptionId => <>
            <SettingSwitch field="llm_hide_think_tag" checked={config.llm_hide_think_tag} onChange={value => updateConfigField('llm_hide_think_tag', value)} disabled={locked} id="llm_hide_think_tag" aria-label="隐藏思考过程" aria-describedby={descriptionId} />
          </>}</SettingField>
          <SettingField label="总结提示词" htmlFor="llm_prompt" stacked action={
            <ActionButton disabled={locked} onClick={() => change('llm_prompt', defaultPrompt, 0)}><ReloadOutlined />恢复默认</ActionButton>
          }>
            <TextArea id="llm_prompt" disabled={locked} value={draft.llm_prompt ?? ''} onChange={event => change('llm_prompt', event.target.value, 800)} onBlur={() => { void autosave.save(['llm_prompt']); }} variant="filled" rows={4} placeholder="请输入总结提示词" />
          </SettingField>
        </section>
      </div>
    </div>
  );
}
