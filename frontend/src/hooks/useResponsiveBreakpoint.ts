import { useState, useEffect } from 'react';

/**
 * Responsive breakpoint hook using matchMedia.
 * - `isMobile`: viewport < 768px (layout decisions)
 * - `isTouchDevice`: coarse pointer (touch interaction decisions, includes tablets)
 */
export function useResponsiveBreakpoint() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined'
      ? !window.matchMedia('(min-width: 768px)').matches
      : false
  );
  const [isTouchDevice, setIsTouchDevice] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(pointer: coarse)').matches
      : false
  );

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(!e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const mql = window.matchMedia('(pointer: coarse)');
    const handler = (e: MediaQueryListEvent) => setIsTouchDevice(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return { isMobile, isTouchDevice };
}
