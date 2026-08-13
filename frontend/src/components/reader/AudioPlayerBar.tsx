import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioPlayerStore } from '../../stores/audioPlayerStore';
import { togglePlay, stop, seek, setRate, setAccent } from '../../hooks/useParagraphAudioPlayer';

/** 倍速分组（二级菜单：一级=分组标题，二级=具体倍速） */
const SPEED_GROUPS: Array<{ label: string; speeds: number[] }> = [
  { label: '慢速', speeds: [0.5, 0.6, 0.7, 0.8, 0.9] },
  { label: '正常', speeds: [1.0] },
  { label: '快速', speeds: [1.1, 1.2, 1.3, 1.4, 1.5] },
];

/** 倍速 → edge-tts rate 字符串（如 1.0 → "+0%"，0.5 → "-50%"） */
function speedToRate(mult: number): string {
  const delta = Math.round((mult - 1) * 100);
  return `${delta >= 0 ? '+' : '-'}${Math.abs(delta)}%`;
}

/** edge-tts rate 字符串 → 倍速（如 "+0%" → 1.0，"-50%" → 0.5） */
function rateToSpeed(rate: string): number {
  return 1 + (parseInt(rate, 10) || 0) / 100;
}

function rateLabelOf(rate: string): string {
  return `${rateToSpeed(rate).toFixed(1)}x`;
}

function formatTime(ms: number): string {
  if (!ms || ms < 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function AudioPlayerBar() {
  const {
    status,
    activeParagraph,
    accent,
    rate,
    followScroll,
    currentTimeMs,
    durationMs,
    error,
    setFollowScroll,
  } = useAudioPlayerStore();

  const [rateMenuOpen, setRateMenuOpen] = useState(false);
  const rateRef = useRef<HTMLDivElement>(null);

  // 点击外部 / Esc 关闭倍速二级菜单
  useEffect(() => {
    if (!rateMenuOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rateRef.current && !rateRef.current.contains(e.target as Node)) {
        setRateMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRateMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [rateMenuOpen]);

  const handlePickRate = useCallback((r: string) => {
    setRate(r);
    setRateMenuOpen(false);
  }, []);

  const progress = durationMs > 0 ? Math.min(100, (currentTimeMs / durationMs) * 100) : 0;

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(ratio * (durationMs || 0));
  };

  return (
    <div
      className="fixed z-[60] shadow-float rounded-xl border border-hairline bg-surface-card px-3 py-2.5 md:px-4 flex items-center gap-3 md:gap-4"
      style={{
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 16,
        maxWidth: 'calc(100vw - 24px)',
        width: 560,
      }}
    >
      {/* Play / pause */}
      <button
        type="button"
        onClick={togglePlay}
        disabled={status === 'loading'}
        className="w-10 h-10 flex-shrink-0 rounded-full bg-primary text-on-primary hover:bg-primary-active active:bg-primary-active transition-colors flex items-center justify-center disabled:opacity-60"
        title={status === 'playing' ? '暂停' : '播放'}
        aria-label={status === 'playing' ? '暂停' : '播放'}
      >
        {status === 'loading' ? (
          <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
            <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" opacity="0.75" />
          </svg>
        ) : status === 'playing' ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Stop */}
      <button
        type="button"
        onClick={() => stop()}
        className="w-8 h-8 flex-shrink-0 rounded-full hover:bg-canvas-soft transition-colors flex items-center justify-center text-muted hover:text-ink"
        title="停止"
        aria-label="停止朗读"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="5" y="5" width="14" height="14" rx="1.5" />
        </svg>
      </button>

      {/* Progress */}
      <div className="flex-1 min-w-0">
        {error ? (
          <p className="text-xs text-error truncate">{error}</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-xs text-body truncate">
                {status === 'idle' ? '未在朗读' : `朗读 · 第 ${(activeParagraph ?? 0) + 1} 段`}
              </span>
              <span className="text-[11px] text-muted-soft flex-shrink-0 tabular-nums">
                {formatTime(currentTimeMs)} / {formatTime(durationMs)}
              </span>
            </div>
            <div
              className="h-1.5 rounded-full bg-canvas-soft cursor-pointer relative overflow-hidden"
              onClick={handleSeek}
              title="拖动定位"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
          </>
        )}
      </div>

      {/* Rate — 二级菜单（慢速/正常/快速 分组） */}
      <div className="relative flex-shrink-0" ref={rateRef}>
        <button
          type="button"
          onClick={() => setRateMenuOpen((v) => !v)}
          className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-canvas-soft text-muted hover:text-ink transition-colors"
          title="朗读倍速"
          aria-haspopup="menu"
          aria-expanded={rateMenuOpen}
        >
          <span className="tabular-nums">{rateLabelOf(rate)}</span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`transition-transform ${rateMenuOpen ? 'rotate-180' : ''}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {rateMenuOpen && (
          <div
            role="menu"
            className="absolute bottom-full right-0 mb-1.5 z-[70] bg-surface-card border border-hairline rounded-lg shadow-float p-1.5 w-[168px]"
          >
            {SPEED_GROUPS.map((g) => (
              <div key={g.label} className="mb-1 last:mb-0">
                <p className="px-1.5 py-0.5 text-[10px] text-muted-soft font-medium tracking-wide">
                  {g.label}
                </p>
                <div className="grid grid-cols-5 gap-0.5">
                  {g.speeds.map((sp) => {
                    const r = speedToRate(sp);
                    const active = rate === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        role="menuitem"
                        onClick={() => handlePickRate(r)}
                        className={[
                          'px-0.5 py-1 text-[11px] tabular-nums rounded transition-colors',
                          active
                            ? 'bg-primary text-on-primary font-medium'
                            : 'text-muted hover:bg-canvas-soft hover:text-ink',
                        ].join(' ')}
                        title={`倍速 ${sp.toFixed(1)}x`}
                      >
                        {sp.toFixed(1)}x
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Accent */}
      <button
        type="button"
        onClick={() => setAccent(accent === 'us' ? 'uk' : 'us')}
        className="flex-shrink-0 px-2 py-1 text-[11px] rounded bg-canvas-soft text-muted hover:text-ink transition-colors uppercase"
        title="切换美音/英音"
      >
        {accent}
      </button>

      {/* Follow scroll */}
      <button
        type="button"
        onClick={() => setFollowScroll(!followScroll)}
        className={[
          'flex-shrink-0 hidden md:flex w-8 h-8 items-center justify-center rounded transition-colors',
          followScroll ? 'text-primary' : 'text-muted hover:text-ink',
        ].join(' ')}
        title={followScroll ? '已开启跟随滚动' : '已关闭跟随滚动'}
        aria-label="跟随滚动"
      >
        {followScroll ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v18M6 15l6 6 6-6" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v18M18 9l-6-6-6 6" />
          </svg>
        )}
      </button>

      {/* Close */}
      <button
        type="button"
        onClick={() => stop()}
        className="flex-shrink-0 w-8 h-8 rounded hover:bg-canvas-soft transition-colors flex items-center justify-center text-muted hover:text-ink"
        title="关闭"
        aria-label="关闭朗读"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
