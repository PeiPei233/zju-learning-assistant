import SettingsSwitch from './SettingsSwitch';
import AutosaveModal from './AutosaveModal';
import { useConfigAutosave } from '../../hooks/useConfigAutosave';
import { Config } from '../../model';
import MultiChoice from '../MultiChoice';
import { useState, useEffect, useRef } from 'react';
import { List, Segmented } from 'antd';
import { useConfig } from '../../context/ConfigContext';
import { useDesktopApp } from '../../context/NotificationContext';

interface SubtitleSettingsModalProps {
  open: boolean;
  onCancel: () => void;
}

export default function SubtitleSettingsModal({ open, onCancel }: SubtitleSettingsModalProps) {
  const { config } = useConfig();
  const [draft, setDraft] = useState(config);
  const { notification } = useDesktopApp();
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) setDraft(config);
    wasOpen.current = open;
  }, [open, config]);
  const autosave = useConfigAutosave(async () => true);
  const updateConfigField = (field: keyof Config, value: unknown) => {
    const patch = { [field]: value };
    setDraft(previous => Object.assign(previous.clone(), patch));
    autosave.change(patch, 0);
  };
  const subtitleLanguages = Array.isArray(draft.subtitle_language) ? draft.subtitle_language : ['zh'];

  return (
    <AutosaveModal title="字幕高级设置" className="subtitle-settings-modal" open={open}
      onClose={onCancel} autosave={autosave}>
      {locked => <List>
        <List.Item>
          <List.Item.Meta
            title="文件格式"
            description="选择保存的字幕文件格式"
          />
          <Segmented disabled={locked}
            aria-label="字幕文件格式"
            value={draft.subtitle_format || 'srt'}
            options={[{ label: 'SRT', value: 'srt' }, { label: 'Markdown', value: 'md' }, { label: 'TXT', value: 'txt' }]}
            onChange={value => updateConfigField('subtitle_format', value)}
          />
        </List.Item>

        <List.Item>
          <List.Item.Meta
            title="语言"
            description="选择下载的语音文本语言，可多选"
          />
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
        </List.Item>

        <List.Item>
          <List.Item.Meta
            title="包含时间戳"
            description={draft.subtitle_format === 'srt' ? "SRT 格式必须包含时间戳" : "在文本/Markdown中保留时间信息"}
          />
          <SettingsSwitch field="subtitle_with_timestamps"
            checked={draft.subtitle_format === 'srt' ? true : draft.subtitle_with_timestamps}
            disabled={locked || draft.subtitle_format === 'srt'}
            onChange={(checked) => updateConfigField('subtitle_with_timestamps', checked)}
          />
        </List.Item>
      </List>}
    </AutosaveModal>
  );
}
