import { CheckOutlined } from '@ant-design/icons';
import ActionButton from './ActionButton';

export default function MultiChoice({ label, options, value, onChange, disabled = false }: {
  label: string;
  disabled?: boolean;
  options: { label: string; value: string }[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return <div className="multi-choice" role="group" aria-label={label}>
    {options.map(option => {
      const selected = value.includes(option.value);
      return <ActionButton disabled={disabled} key={option.value} className={`choice-button ${selected ? 'is-active' : ''}`}
        aria-pressed={selected} onClick={() => onChange(selected ? value.filter(item => item !== option.value) : [...value, option.value])}>
        {option.label}<span className="choice-check" aria-hidden="true"><CheckOutlined /></span>
      </ActionButton>;
    })}
  </div>;
}
