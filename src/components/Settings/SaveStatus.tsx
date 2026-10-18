import { useDelayedBusy } from '../../hooks/useDelayedBusy';

/** Avoid flashing a busy label for fast local saves. */
export default function SaveStatus({ saving, error, busyLabel = '正在保存…' }: { saving: boolean; error?: string; busyLabel?: string }) {
  const showSaving = useDelayedBusy(saving);

  return <span className="modal-save-note" role="status">
    {showSaving ? busyLabel : error || '修改后自动保存'}
  </span>;
}
