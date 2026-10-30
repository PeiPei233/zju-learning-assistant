import React from 'react';

/** Select visible results without discarding selections hidden by filters. */
export default function SelectionActions({ selectedKeys, visibleKeys, onChange, disabled = false, label = '全选当前结果', className }: {
  selectedKeys: React.Key[];
  visibleKeys: React.Key[];
  onChange: (keys: React.Key[]) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const selected = new Set(selectedKeys);
  const allSelected = visibleKeys.length > 0 && visibleKeys.every(key => selected.has(key));
  return <div className={className}>
    <button className="text-button" disabled={disabled || !visibleKeys.length || allSelected}
      onClick={() => onChange([...new Set([...selectedKeys, ...visibleKeys])])}>{label}</button>
    <button className="text-button" disabled={disabled || !selectedKeys.length} onClick={() => onChange([])}>清空</button>
  </div>;
}
