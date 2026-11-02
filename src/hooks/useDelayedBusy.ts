import { useEffect, useState } from 'react';

/** Show feedback only for operations that outlast the shared 300 ms threshold. */
export function useDelayedBusy(busy: boolean) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!busy) { setVisible(false); return; }
    const timer = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(timer);
  }, [busy]);
  return busy && visible;
}
