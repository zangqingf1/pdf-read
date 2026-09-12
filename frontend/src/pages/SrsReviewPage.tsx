import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSrsStore } from '../stores/srsStore';
import { useReaderStore } from '../stores/readerStore';
import type { SrsCard, SrsRating } from '../services/srsApi';
import { parseVocabJson } from '../services/vocabularyApi';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import PhoneticWithSpeakers from '../components/reader/PhoneticWithSpeakers';
import ErrorBanner from '../components/reader/ErrorBanner';
import { ExamTagBadges } from '../components/reader/WordTags';
import { filterVisibleExamTags } from '../constants/examTags';

/** 跳转回原文定位段落（与单词本 docLinkPath 一致） */
function docLinkPath(documentId: string, paragraphIndex?: number | null, word?: string | null): string {
  const params = new URLSearchParams();
  if (paragraphIndex != null) params.set('paragraph', String(paragraphIndex));
  if (word) params.set('word', word);
  const qs = params.toString();
  return `/document/${documentId}${qs ? `?${qs}` : ''}`;
}

const RATING_LABELS: { rating: SrsRating; label: string; cls: string }[] = [
  { rating: 0, label: '忘了', cls: 'bg-error/10 text-error border-error/30 hover:bg-error/20' },
  { rating: 1, label: '困难', cls: 'bg-warning/10 text-warning border-warning/30 hover:bg-warning/20' },
  { rating: 2, label: '良好', cls: 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20' },
  { rating: 3, label: '简单', cls: 'bg-success/10 text-success border-success/30 hover:bg-success/20' },
];

export default function SrsReviewPage() {
  const { queue, counts, stats, reviewed, loading, submitting, error, fetchQueue, fetchStats, review, toggleMastered, clearError } = useSrsStore();
  const visibleExamTags = useReaderStore((s) => s.visibleExamTags);
  const [flipped, setFlipped] = useState(false);
  /** 刚复习完的卡短暂展示结果后滑出 */
  const [justRated, setJustRated] = useState<SrsRating | null>(null);

  useEffect(() => {
    fetchQueue();
    fetchStats();
  }, [fetchQueue, fetchStats]);

  const current = queue[0] ?? null;
  const finished = !loading && queue.length === 0;

  // 每换一张卡回到正面
  useEffect(() => {
    setFlipped(false);
    setJustRated(null);
  }, [current?.id]);

  const handleRate = useCallback(async (rating: SrsRating) => {
    if (!current || submitting || justRated !== null) return;
    setJustRated(rating);
    await review(current, rating);
  }, [current, submitting, justRated, review]);

  // 键盘：空格翻面，1-4 评分
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        void handleRate((Number(e.key) - 1) as SrsRating);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flipped, handleRate]);

  const examTagsOf = (card: SrsCard) =>
    filterVisibleExamTags(parseVocabJson(card.exam_tags, [] as string[]), visibleExamTags);

  const totalToday = (counts?.due_total ?? 0) + reviewed.length;
  const progress = totalToday > 0 ? reviewed.length / totalToday : 0;

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header */}
      <header
        className="sticky top-0 z-10 border-b border-hairline-soft backdrop-blur-md"
        style={{ backgroundColor: 'color-mix(in srgb, var(--canvas) 88%, transparent)' }}
      >
        <div className="px-4 md:px-6 h-[52px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/" className="inline-flex items-center gap-2 text-ink hover:text-primary transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              <span className="text-sm font-medium">返回</span>
            </Link>
            <h1 className="text-sm font-medium font-sans text-ink m-0 truncate">今日复习</h1>
            {counts && counts.due_total > 0 && (
              <Badge className="bg-primary/15 text-primary ring-1 ring-primary/20 shadow-none">{counts.due_total}</Badge>
            )}
          </div>
          <Link to="/vocabulary">
            <Button size="sm" variant="secondary">单词本</Button>
          </Link>
        </div>
      </header>

      <div className="max-w-xl mx-auto px-4 md:px-6 py-6">
        {/* 统计条 */}
        {stats && (
          <div className="flex items-center justify-center gap-6 mb-5 text-center">
            <div>
              <div className="text-lg font-semibold text-primary font-display">{counts?.due_total ?? stats.due_today}</div>
              <div className="text-[11px] text-muted-soft">待复习</div>
            </div>
            <div className="w-px h-8 bg-hairline-soft" />
            <div>
              <div className="text-lg font-semibold text-ink font-display">{stats.reviewed_today}</div>
              <div className="text-[11px] text-muted-soft">今日已复习</div>
            </div>
            <div className="w-px h-8 bg-hairline-soft" />
            <div>
              <div className="text-lg font-semibold text-ink font-display">{stats.mastered}</div>
              <div className="text-[11px] text-muted-soft">已掌握</div>
            </div>
          </div>
        )}

        {/* 进度条 */}
        {totalToday > 0 && (
          <div className="h-1 rounded-full bg-hairline-soft overflow-hidden mb-5">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}

        {error && (
          <ErrorBanner
            message={error}
            className="mb-4"
            action={
              <button onClick={clearError} className="text-xs text-error hover:underline whitespace-nowrap">
                知道了
              </button>
            }
          />
        )}

        {loading && queue.length === 0 ? (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        ) : finished ? (
          <EmptyState
            icon={
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            }
            title={reviewed.length > 0 ? '这一组复习完成！' : '今天没有待复习的单词'}
            description={
              reviewed.length > 0
                ? `刚才复习了 ${reviewed.length} 个词，记得明天再来看看`
                : '在阅读页解析单词并加入单词本后，这里会按记忆曲线安排复习'
            }
            action={
              <div className="flex items-center gap-2">
                <Link to="/"><Button size="sm" variant="secondary">返回首页</Button></Link>
                {reviewed.length > 0 && (
                  <Button size="sm" onClick={() => fetchQueue()}>再来一组</Button>
                )}
              </div>
            }
          />
        ) : current ? (
          <>
            {/* 翻转卡 */}
            <div
              onClick={() => setFlipped((f) => !f)}
              className="bg-surface-overlay border border-hairline-soft rounded-2xl shadow-soft p-8 min-h-[280px] flex flex-col items-center justify-center text-center cursor-pointer select-none transition-all duration-200 hover:border-hairline hover:shadow-elevated"
            >
              {!flipped ? (
                /* 正面：单词 */
                <div className="flex flex-col items-center gap-3">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-3xl font-bold text-ink font-reading">{current.word_original}</span>
                    {current.phonetic && (
                      <span className="text-lg" onClick={(e) => e.stopPropagation()}>
                        <PhoneticWithSpeakers word={current.word_original} phonetic={current.phonetic} />
                      </span>
                    )}
                  </div>
                  {current.pos && <span className="text-sm text-muted italic">{current.pos}</span>}
                  {examTagsOf(current).length > 0 && <ExamTagBadges tags={examTagsOf(current)} />}
                  <span className="mt-6 text-xs text-muted-soft animate-pulse">点击或按空格查看释义</span>
                </div>
              ) : (
                /* 背面：释义 */
                <div className="flex flex-col items-center gap-3 w-full">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-2xl font-bold text-ink font-reading">{current.word_original}</span>
                    {current.phonetic && (
                      <span className="text-lg" onClick={(e) => e.stopPropagation()}>
                        <PhoneticWithSpeakers word={current.word_original} phonetic={current.phonetic} />
                      </span>
                    )}
                  </div>
                  {current.translation ? (
                    <p className="text-base text-body-strong font-chinese m-0 leading-relaxed">{current.translation}</p>
                  ) : current.definition_zh ? (
                    <p className="text-base text-body-strong font-chinese m-0 leading-relaxed">{current.definition_zh}</p>
                  ) : current.definition_en ? (
                    <p className="text-sm text-body-strong m-0 leading-relaxed">{current.definition_en}</p>
                  ) : (
                    <p className="text-sm text-muted-soft m-0">暂无释义</p>
                  )}
                  {current.context_sentence && (
                    <p className="text-xs text-muted italic m-0 leading-relaxed line-clamp-3" title={current.context_sentence}>
                      “{current.context_sentence}”
                    </p>
                  )}
                  {current.source_document_id && (
                    <Link
                      to={docLinkPath(current.source_document_id, current.latest_paragraph_index, current.word)}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-primary hover:underline"
                    >
                      {current.source_document_title || '查看原文'} →
                    </Link>
                  )}
                </div>
              )}
            </div>

            {/* 操作区 */}
            <div className="mt-4">
              {!flipped ? (
                <Button className="w-full" onClick={() => setFlipped(true)}>
                  显示释义
                </Button>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {RATING_LABELS.map(({ rating, label, cls }) => (
                    <button
                      key={rating}
                      disabled={submitting || justRated !== null}
                      onClick={() => void handleRate(rating)}
                      className={`h-16 rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-all active:scale-[0.97] disabled:opacity-60 ${cls}`}
                    >
                      <span className="text-sm font-medium">{label}</span>
                      <span className="text-[10px] opacity-75">{current.srs_preview?.[String(rating)] ?? ''}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between mt-3">
                <span className="text-[11px] text-muted-soft">
                  {flipped ? '键盘 1-4 评分' : '空格翻面'}
                </span>
                <button
                  onClick={() => void toggleMastered(current, true)}
                  disabled={submitting}
                  className="text-[11px] text-muted-soft hover:text-success transition-colors disabled:opacity-50"
                >
                  已经很熟了，标记掌握
                </button>
              </div>
            </div>

            {/* 队列剩余提示 */}
            {queue.length > 1 && (
              <p className="text-center text-xs text-muted-soft mt-5">
                本组还有 {queue.length - 1} 个词
              </p>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
