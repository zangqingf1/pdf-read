import { useEffect, useState } from 'react';
import { getDailyQuote, type DailyQuote as DailyQuoteData } from '../../services/quoteApi';

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function Skeleton() {
  return (
    <div className="min-h-[200px] md:min-h-[240px] rounded-xl border border-hairline-soft shadow-soft bg-gradient-to-br from-[#fdf4ec] via-[#faf1e6] to-[#f6e8d7] p-6 md:p-8 relative overflow-hidden">
      <div className="w-28 h-3 bg-primary/10 rounded animate-pulse mb-6" />
      <div className="w-3/4 h-6 bg-primary/10 rounded animate-pulse mb-2.5" />
      <div className="w-2/3 h-6 bg-primary/10 rounded animate-pulse mb-5" />
      <div className="w-1/2 h-3.5 bg-primary/10 rounded animate-pulse" />
      <div className="w-24 h-3 bg-primary/10 rounded animate-pulse mt-5 ml-auto" />
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

  // 最小高度占位：骨架屏与卡片同高，加载完成不引起下方内容跳动；内容超出时卡片自然撑开，不裁切
  return (
    <div className="mb-6">
      {!loaded ? (
        <Skeleton />
      ) : quote ? (
        <div className="min-h-[200px] md:min-h-[240px] overflow-hidden rounded-xl border border-hairline-soft shadow-soft bg-gradient-to-br from-[#fdf4ec] via-[#faf1e6] to-[#f5e6d3] px-6 py-5 md:px-10 md:py-7 relative animate-slide-up flex flex-col">
          {/* 装饰大引号 */}
          <svg
            className="absolute top-4 right-4 w-12 h-auto pointer-events-none sm:w-14 md:top-8 md:right-12 md:w-[84px]"
            viewBox="0 0 110 82"
            fill="#eeddc8"
            aria-hidden="true"
          >
            <path d="M30.2 2C15.9 8.6 7 20.4 7 35.4c0 11.2 6.9 19 16.2 19 8.4 0 14.8-6.3 14.8-14.6 0-7.8-5.5-13.6-13.2-13.6-1.5 0-3.4.3-4 .5C22.5 18 29 9.8 37.2 4.9L30.2 2zm56 0C71.9 8.6 63 20.4 63 35.4c0 11.2 6.9 19 16.2 19 8.4 0 14.8-6.3 14.8-14.6 0-7.8-5.5-13.6-13.2-13.6-1.5 0-3.4.3-4 .5C78.5 18 85 9.8 93.2 4.9L86.2 2z" transform="translate(0 22)" />
          </svg>

          {/* 标签行：每日一句 — 日期 */}
          <div className="flex items-center gap-3 mb-auto">
            <span className="text-[13px] font-semibold text-primary tracking-wide">
              每日一句
            </span>
            <span className="h-px w-12 bg-primary/25" />
            <span className="text-xs text-muted">{formatDate(quote.date)}</span>
          </div>

          {/* 英文引句 */}
          <p className="font-display italic text-ink leading-[1.35] text-[clamp(1.15rem,1.8vw,1.5rem)] my-3 pr-16 sm:pr-20 md:pr-40">
            {quote.en}
          </p>

          {/* 中文译文 */}
          <p className="flex items-start gap-2.5 text-chinese text-[13px] text-muted mb-auto md:pr-40">
            <span className="flex-shrink-0 self-stretch w-[3px] rounded-full bg-primary/60" />
            <span>{quote.zh}</span>
          </p>

          {/* 作者 */}
          <p className="text-[13px] text-muted text-right mt-4">
            — {quote.author}
          </p>
        </div>
      ) : null}
    </div>
  );
}
