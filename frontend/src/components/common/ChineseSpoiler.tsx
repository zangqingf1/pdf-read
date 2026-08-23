import { useState, type ReactNode } from 'react';

// 中文释义遮盖：默认模糊，单击揭示、再次单击恢复
export function ChineseSpoiler({ children, className = '' }: { children: ReactNode; className?: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      aria-pressed={revealed}
      title={revealed ? undefined : '点击显示中文'}
      onClick={(e) => { e.stopPropagation(); setRevealed((r) => !r); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setRevealed((r) => !r);
        }
      }}
      className={`zh-spoiler ${revealed ? '' : 'zh-spoiler-covered'} ${className}`}
    >
      {children}
    </span>
  );
}
