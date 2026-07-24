import { useState, useRef, useCallback, useEffect } from 'react';

/** Reusable split pane hook: left panel + draggable divider + right panel. */
export function useSplitPane(defaultRatio: number = 0.55) {
  const [leftWidth, setLeftWidth] = useState(() => window.innerWidth * defaultRatio);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartX.current = e.clientX;
      dragStartWidth.current = leftWidth;
    },
    [leftWidth]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStartX.current;
      const newWidth = Math.max(
        300,
        Math.min(window.innerWidth - 320, dragStartWidth.current + delta)
      );
      setLeftWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return { leftWidth, isDragging, handleDividerMouseDown };
}
