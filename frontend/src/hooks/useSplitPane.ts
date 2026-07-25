import { useState, useRef, useCallback, useEffect } from 'react';

/** Reusable split pane hook: left panel + draggable divider + right panel. */
export function useSplitPane(defaultRatio: number = 0.55) {
  const [leftWidth, setLeftWidth] = useState(() => window.innerWidth * defaultRatio);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const getClientX = useCallback((e: MouseEvent | TouchEvent): number => {
    if ('touches' in e) {
      return e.touches[0].clientX;
    }
    return e.clientX;
  }, []);

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartX.current = e.clientX;
      dragStartWidth.current = leftWidth;
    },
    [leftWidth]
  );

  const handleDividerTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartX.current = e.touches[0].clientX;
      dragStartWidth.current = leftWidth;
    },
    [leftWidth]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const delta = getClientX(e) - dragStartX.current;
      const newWidth = Math.max(
        300,
        Math.min(window.innerWidth - 320, dragStartWidth.current + delta)
      );
      setLeftWidth(newWidth);
    };

    const handleEnd = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, getClientX]);

  return { leftWidth, isDragging, handleDividerMouseDown, handleDividerTouchStart };
}
