import type { ReactNode } from 'react';

interface MiniReaderFrameProps {
  title?: string;
  children: ReactNode;
  audio?: 'idle' | 'playing' | 'loading';
  progress?: number;
  time?: string;
  duration?: string;
}

function MiniAudioBar({
  status,
  progress,
  time,
  duration,
}: {
  status: 'idle' | 'playing' | 'loading';
  progress: number;
  time: string;
  duration: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-reader-line bg-reader-surface px-3 py-2 shadow-float ring-1 ring-reader-line-soft">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">
        {status === 'loading' ? (
          <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
            <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" opacity="0.75" />
          </svg>
        ) : status === 'playing' ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-xs text-body">
            {status === 'idle' ? '未在朗读' : '朗读 · 第 1 段'}
          </span>
          <span className="flex-shrink-0 text-[11px] tabular-nums text-muted-soft">
            {time} / {duration}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-reader-line-soft">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <span className="flex-shrink-0 rounded bg-reader-line-soft px-1.5 py-0.5 text-[11px] text-muted">
        1.0x
      </span>
      <span className="flex-shrink-0 rounded bg-reader-line-soft px-1.5 py-0.5 text-[11px] uppercase text-muted">
        us
      </span>
    </div>
  );
}

export default function MiniReaderFrame({
  title = 'The Economist',
  children,
  audio = 'idle',
  progress = 0,
  time = '0:00',
  duration = '0:12',
}: MiniReaderFrameProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-reader-surface shadow-elevated">
      <div className="sticky top-0 z-10 flex h-[44px] items-center gap-2 border-b border-reader-line-soft bg-reader-surface/90 px-3 backdrop-blur-md">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-soft"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </span>
        <span className="min-w-0 flex-1 truncate font-display text-sm font-medium text-ink">
          {title}
        </span>
        <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-soft">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16v16H4zM4 9h16M9 4v16" />
          </svg>
        </span>
        <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-soft">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8" />
          </svg>
        </span>
      </div>

      <div className="px-5 py-5">{children}</div>

      {audio !== 'idle' || progress > 0 ? (
        <div className="px-3 pb-3">
          <MiniAudioBar status={audio} progress={progress} time={time} duration={duration} />
        </div>
      ) : null}
    </div>
  );
}
