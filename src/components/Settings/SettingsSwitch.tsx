import { Switch, type SwitchProps } from 'antd';
import { useConfig } from '../../context/ConfigContext';
import { useDelayedBusy } from '../../hooks/useDelayedBusy';
import type { Config } from '../../model';

export default function SettingsSwitch({ field, disabled, ...props }: SwitchProps & { field: keyof Config }) {
  const { isSaving } = useConfig();
  const busy = useDelayedBusy(isSaving(field));
  const savingSettings = useDelayedBusy(isSaving());
  return <Switch {...props} disabled={disabled || savingSettings} loading={busy} />;
}
