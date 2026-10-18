import { useRef, useState, type ReactNode } from 'react';
import { Modal } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import ActionButton from '../ActionButton';
import SaveStatus from './SaveStatus';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import { useConfig } from '../../context/ConfigContext';
import { useConfigAutosave } from '../../hooks/useConfigAutosave';

type Props = {
  open: boolean; title: string; className: string; onClose: () => void;
  autosave: ReturnType<typeof useConfigAutosave>;
  busy?: boolean; onInvalid?: () => void;
  children: (locked: boolean) => ReactNode;
};

export default function AutosaveModal({ open, title, className, onClose, autosave, busy = false, onInvalid, children }: Props) {
  const { isSaving } = useConfig();
  const savingSettings = useDelayedBusy(isSaving());
  const [closing, setClosing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const retryRef = useRef(false);
  const showRetrying = useDelayedBusy(retrying);
  const retry = async () => {
    if (retryRef.current || autosave.saving) return;
    retryRef.current = true;
    setRetrying(true);
    try { await autosave.save(); }
    finally { retryRef.current = false; setRetrying(false); }
  };
  const closingRef = useRef(false);
  const close = async () => {
    if (busy || closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    try {
      if (await autosave.save()) onClose();
      else onInvalid?.();
    } finally { closingRef.current = false; setClosing(false); }
  };
  const locked = busy || closing || retrying;
  return <Modal open={open} title={title} className={`desktop-modal autosave-modal ${className}`} centered width={560}
    onCancel={close} closable={{ disabled: locked }} keyboard={!locked} maskClosable={!locked}
    footer={<div className="modal-actions autosave-modal-actions">
      <SaveStatus saving={autosave.saving || retrying} busyLabel={retrying ? '正在重试…' : '正在保存…'} error={autosave.failed ? '保存失败，修改已保留' : autosave.invalid ? '请检查输入，修改尚未保存' : undefined} />
      {(autosave.failed || autosave.invalid) && <ActionButton disabled={locked || autosave.saving} onClick={() => { autosave.discard(); onClose(); }}>放弃未保存修改</ActionButton>}
      {autosave.failed && <ActionButton disabled={locked || autosave.saving} aria-busy={retrying} onClick={retry}>{showRetrying && <LoadingOutlined spin />}{showRetrying ? '正在重试' : '重试'}</ActionButton>}
      <ActionButton variant="primary" disabled={locked} onClick={close}>完成</ActionButton>
    </div>}>
    {autosave.failed && <details className="autosave-error-details" open>
      <summary>错误详情</summary><pre>{autosave.errorDetails}</pre>
    </details>}
    {children(locked || savingSettings)}
  </Modal>;
}
