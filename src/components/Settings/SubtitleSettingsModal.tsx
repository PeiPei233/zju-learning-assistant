import SettingsSwitch from './SettingsSwitch';
import AutosaveModal from './AutosaveModal';
import SettingField from './SettingField';
import { useConfigAutosave } from '../../hooks/useConfigAutosave';
import { Config } from '../../model';
import MultiChoice from '../MultiChoice';
import { useState, useEffect, useRef } from 'react';
import { Segmented } from 'antd';
import { useConfig } from '../../context/ConfigContext';
import { useDesktopApp } from '../../context/NotificationContext';

interface SubtitleSettingsModalProps {
  inline?: boolean;
  open: boolean;
  onCancel: () => void;
}

export default function SubtitleSettingsModal({ open, onCancel, inline = false }: SubtitleSettingsModalProps) {
  const { config } = useConfig();
  const [draft, setDraft] = useState(config);
  const { notification } = useDesktopApp();
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && (!wasOpen.current || inline)) setDraft(previous => {
      const next = config.clone();
      if (inline) for (const field of Object.keys(previous) as (keyof Config)[]) {
        if (autosave.hasDraft(field)) Object.assign(next, { [field]: previous[field] });
      }
      return next;
    });
    wasOpen.current = open;
  // Preserve unsaved selections while unrelated settings are committed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config, inline]);
  const autosave = useConfigAutosave(async () => true);
  const updateConfigField = (field: keyof Config, value: unknown) => {
    const patch = { [field]: value };
    setDraft(previous => Object.assign(previous.clone(), patch));
    autosave.change(patch, 0);
  };
  const subtitleLanguages = Array.isArray(draft.subtitle_language) ? draft.subtitle_language : ['zh'];

  return (
    <AutosaveModal inline={inline} title="字幕高级设置" className="subtitle-settings-modal" open={open}
      onClose={() => inline ? setDraft(config) : onCancel()} autosave={autosave}>
      {locked => <div className="subtitle-settings-body">
        <SettingField label="文件格式" description="选择保存的字幕文件格式">
          <Segmented disabled={locked}
            aria-label="字幕文件格式"
            value={draft.subtitle_format || 'srt'}
            options={[{ label: 'SRT', value: 'srt' }, { label: 'Markdown', value: 'md' }, { label: 'TXT', value: 'txt' }]}
            onChange={value => updateConfigField('subtitle_format', value)}
          />
        </SettingField>

        <SettingField label="语言" description="选择下载的语音文本语言，可多选">
          <MultiChoice disabled={locked}
            label="字幕语言"
            options={[
              { label: '中文', value: 'zh' },
              { label: 'English', value: 'en' },
              { label: '中英穿插', value: 'mixed' },
            ]}
            value={subtitleLanguages}
            onChange={(checkedValues) => {
              if (!checkedValues.length) {
                notification.warning({ key: 'subtitle-language-required', title: '至少保留一种字幕语言', duration: 3 });
                return;
              }
              updateConfigField('subtitle_language', checkedValues);
            }}
          />
        </SettingField>

        <SettingField label="包含时间戳" description={draft.subtitle_format === 'srt' ? "SRT 格式必须包含时间戳" : "在文本 / Markdown 中保留时间信息"}>
          <SettingsSwitch field="subtitle_with_timestamps"
            checked={draft.subtitle_format === 'srt' ? true : draft.subtitle_with_timestamps}
            disabled={locked || draft.subtitle_format === 'srt'}
            onChange={(checked) => updateConfigField('subtitle_with_timestamps', checked)}
          />
        </SettingField>
      </div>}
    </AutosaveModal>
  );
}
