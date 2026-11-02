import SettingSwitch from './SettingSwitch';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import SettingField from './SettingField';
import MultiChoice from '../../components/MultiChoice';
import { Segmented } from 'antd';
import { useConfig } from '../../context/ConfigContext';
import { useDesktopApp } from '../../context/NotificationContext';

export default function SubtitleSetting() {
  const { config, isSaving, updateConfigField } = useConfig();
  const locked = useDelayedBusy(isSaving());
  const { notification } = useDesktopApp();
  const subtitleLanguages = Array.isArray(config.subtitle_language) ? config.subtitle_language : ['zh'];

  return (
    <div className="settings-inline subtitle-settings">
      <div className="subtitle-settings-body">
        <SettingField label="文件格式">
          <Segmented disabled={locked}
            aria-label="字幕文件格式"
            value={config.subtitle_format || 'srt'}
            options={[{ label: 'SRT', value: 'srt' }, { label: 'Markdown', value: 'md' }, { label: 'TXT', value: 'txt' }]}
            onChange={value => updateConfigField('subtitle_format', value)}
          />
        </SettingField>

        <SettingField label="语言">
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

        <SettingField label="包含时间戳" description={config.subtitle_format === 'srt' ? "SRT 格式必须包含时间戳" : undefined}>{descriptionId => <>
          <SettingSwitch aria-label="包含时间戳" field="subtitle_with_timestamps"
            checked={config.subtitle_format === 'srt' ? true : config.subtitle_with_timestamps}
            disabled={locked || config.subtitle_format === 'srt'}
            onChange={(checked) => updateConfigField('subtitle_with_timestamps', checked)} aria-describedby={descriptionId}
          />
        </>}</SettingField>
      </div>
    </div>
  );
}
