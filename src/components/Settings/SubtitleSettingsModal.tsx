import React from 'react';
import { Modal, List, Radio, Checkbox, Switch, Button } from 'antd';
import { useConfig } from '../../context/ConfigContext';

interface SubtitleSettingsModalProps {
    open: boolean;
    onCancel: () => void;
}

export default function SubtitleSettingsModal({ open, onCancel }: SubtitleSettingsModalProps) {
    const { config, updateConfigField } = useConfig();
    const subtitleLanguages = Array.isArray(config.subtitle_language) ? config.subtitle_language : ['zh'];

    return (
        <Modal
            title="字幕高级设置"
            open={open}
            onOk={onCancel}
            onCancel={onCancel}
            width={600}
            footer={[
                <Button key="confirm" type="primary" onClick={onCancel}>
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
    );
}
