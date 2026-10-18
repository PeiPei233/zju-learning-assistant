import { useLayoutEffect, useRef, useState } from 'react';
import { Tooltip } from 'antd';

/** Show the full text only when its visible label is actually truncated. */
export default function OverflowText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  const measure = () => {
    const node = ref.current;
    setTruncated(!!node && node.scrollWidth > node.clientWidth);
  };
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [text]);
  return <Tooltip title={truncated ? text : null} placement="topLeft" arrow={false} mouseEnterDelay={0.4}>
    <span ref={ref} className={`overflow-text ${className || ''}`} onMouseEnter={measure}>{text}</span>
  </Tooltip>;
}
