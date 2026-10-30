import { useState, type ButtonHTMLAttributes, type MouseEvent } from 'react';
import { Tooltip } from 'antd';

export default function OpenActionButton({ hint = '打开文件', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { hint?: string }) {
  const [showOpenHint, setShowOpenHint] = useState(true);
  const [offset, setOffset] = useState<[number, number]>([0, 8]);
  const measure = (event: MouseEvent<HTMLButtonElement>) => {
    const label = event.target instanceof Element ? event.target.closest<HTMLElement>('.overflow-text') : null;
    setShowOpenHint(!(label && label.scrollWidth > label.clientWidth));
    const rect = event.currentTarget.getBoundingClientRect();
    setOffset([event.clientX - rect.left + 12, event.clientY - rect.bottom + 16]);
  };
  return <Tooltip title={showOpenHint && !props.disabled ? hint : null} placement="bottomLeft" align={{ offset }} arrow={false} mouseEnterDelay={0.8} trigger={['hover', 'focus']}>
    <button {...props} onMouseEnter={measure} onMouseMove={measure}
      onFocus={() => { setShowOpenHint(true); setOffset([0, 8]); }} />
  </Tooltip>;
}
