import { useEffect, useState } from 'react';
import { getDailyQuote, type DailyQuote as DailyQuoteData } from '../../services/quoteApi';

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function Skeleton() {
  return (
    <div className="h-full bg-surface-card border border-hairline shadow-soft rounded-lg p-6 md:p-8 relative overflow-hidden">
      <div className="w-24 h-3 bg-canvas-soft rounded animate-pulse mb-6" />
      <div className="w-3/4 h-5 bg-canvas-soft rounded animate-pulse mb-2" />
      <div className="w-2/3 h-5 bg-canvas-soft rounded animate-pulse mb-5" />
      <div className="w-1/2 h-4 bg-canvas-soft rounded animate-pulse" />
      <div className="w-16 h-3 bg-canvas-soft rounded animate-pulse mt-5" />
    </div>
  );
}

export default function DailyQuote() {
  const [quote, setQuote] = useState<DailyQuoteData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDailyQuote()
      .then((data) => {
        if (cancelled) return;
        setQuote(data);
      })
      .catch(() => { /* 拉取失败静默隐藏，不阻塞页面 */ })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 固定高度占位：骨架屏与卡片同高，加载完成不引起下方内容跳动
  return (
    <div className="mb-12 h-[300px] md:h-[250px]">
      {!loaded ? (
        <Skeleton />
      ) : quote ? (
        <div className="h-full overflow-hidden bg-surface-card border border-hairline shadow-soft rounded-lg p-6 md:p-8 relative animate-slide-up">
          {/* 装饰引号 */}
          <svg
            className="absolute -top-2 -right-3 md:-top-4 md:-right-4 text-primary/10 pointer-events-none"
            width="96"
            height="96"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M9.6 5C6.4 6.4 4.6 8.9 4.6 12.3c0 2.3 1.4 3.9 3.3 3.9 1.7 0 3-1.3 3-3 0-1.6-1.1-2.8-2.7-2.8-.3 0-.7.1-.8.1.3-1.5 1.5-3.1 3.1-4.1L9.6 5zm9.7 0c-3.2 1.4-5 3.9-5 7.3 0 2.3 1.4 3.9 3.3 3.9 1.7 0 3-1.3 3-3 0-1.6-1.1-2.8-2.7-2.8-.3 0-.7.1-.8.1.3-1.5 1.5-3.1 3.1-4.1L19.3 5z" />
          </svg>

          <div className="flex items-center gap-2 mb-5">
            <span className="text-[11px] font-medium text-primary tracking-widest uppercase">
              每日一句
            </span>
            <span className="h-px flex-1 max-w-[80px] bg-primary/20" />
            <span className="text-[11px] text-muted-soft">{formatDate(quote.date)}</span>
          </div>

          <p className="text-[clamp(1.25rem,2vw,1.5rem)] font-display italic text-ink leading-snug mb-3 md:pr-24">
            {quote.en}
          </p>

          <p className="flex items-start gap-2 text-chinese text-sm text-muted mb-4 md:pr-24">
            <span className="flex-shrink-0 self-stretch w-0.5 rounded-full bg-primary/40" />
            <span>{quote.zh}</span>
          </p>

          <p className="text-[13px] text-muted-soft text-right">
            —— {quote.author}
          </p>
        </div>
      ) : null}
    </div>
  );
}
