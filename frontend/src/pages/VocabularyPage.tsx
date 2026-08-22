import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useVocabularyStore } from '../stores/vocabularyStore';
import { type VocabularyEntry } from '../services/vocabularyApi';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import PhoneticWithSpeakers from '../components/reader/PhoneticWithSpeakers';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return iso;
  }
}

function formatDay(iso: string | null): string {
  if (!iso) return '未知日期';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
}

function dayKey(iso: string | null): string {
  if (!iso) return 'unknown';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

// Split an ECDICT-style Chinese translation (e.g. "n. 书 v. 预订 adj. ...")
// into one segment per part of speech, so the card can show each on its own line.
function parseTranslationByPos(raw: string): { pos: string; text: string }[] {
  if (!raw || !raw.trim()) return [];
  const re = /([a-zA-Z]{1,6}\.)\s+/g;
  const matches = [...raw.matchAll(re)];
  if (matches.length === 0) return [{ pos: "", text: raw.trim() }];
  const segs: { pos: string; text: string }[] = [];
  const firstStart = matches[0].index ?? 0;
  if (firstStart > 0) {
    const prefix = raw.slice(0, firstStart).trim();
    if (prefix) segs.push({ pos: "", text: prefix });
  }
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? raw.length : raw.length;
    const text = raw.slice(start, end).trim();
    if (text) segs.push({ pos: m[1], text });
  }
  return segs;
}

// Order words within a document group the same way the reader's study panel
// does: by paragraph index (appearance in the document), then by word as the
// within-paragraph tiebreaker. Matches words.py `.order_by(paragraph_index, word)`.
function docAppearanceCompare(a: VocabularyEntry, b: VocabularyEntry): number {
  const pa = a.latest_paragraph_index ?? Number.MAX_SAFE_INTEGER;
  const pb = b.latest_paragraph_index ?? Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;
  const wa = a.word || '';
  const wb = b.word || '';
  return wa < wb ? -1 : wa > wb ? 1 : 0;
}

// Most-recent activity of a document group = the latest updated_at among its words.
function docActivity(group: { items: VocabularyEntry[] }): number {
  let max = 0;
  for (const e of group.items) {
    if (e.updated_at) {
      const t = Date.parse(e.updated_at);
      if (t > max) max = t;
    }
  }
  return max;
}

/** 当前网格列数（与下方 grid 断点一致：默认 1 列，sm≥640 2 列，lg≥1024 3 列） */
function calcCols(): number {
  if (typeof window === 'undefined') return 3;
  if (window.matchMedia('(min-width: 1024px)').matches) return 3;
  if (window.matchMedia('(min-width: 640px)').matches) return 2;
  return 1;
}

export default function VocabularyPage() {
  const { items, total, page, pageSize, dayCounts, query, sortBy, order, loading, error, fetchList, setQuery, setSort, remove } = useVocabularyStore();
  const [searchInput, setSearchInput] = useState(query);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /** 每页固定排满 PAGE_ROWS 排：按当前列数换算每页条数 */
  const PAGE_ROWS = 8;
  const [cols, setCols] = useState(calcCols);
  const wantedPageSize = cols * PAGE_ROWS;

  // Initial load + 视口变化（列数变化）时按新每页条数重取
  useEffect(() => {
    fetchList({ page: 1, page_size: wantedPageSize });
  }, [fetchList, wantedPageSize]);

  useEffect(() => {
    const queries = [
      window.matchMedia('(min-width: 640px)'),
      window.matchMedia('(min-width: 1024px)'),
    ];
    const onChange = () => setCols(calcCols());
    for (const q of queries) q.addEventListener('change', onChange);
    return () => {
      for (const q of queries) q.removeEventListener('change', onChange);
    };
  }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== query) {
        setQuery(searchInput);
        fetchList({ q: searchInput, page: 1 });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, query, setQuery, fetchList]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleDelete = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await remove(id);
    } finally {
      setDeletingId(null);
    }
  }, [remove]);

  const handleSortBy = (next: 'created_at' | 'document_order') => {
    if (next === sortBy) {
      const nextOrder = order === 'asc' ? 'desc' : 'asc';
      setSort(next, nextOrder);
    } else {
      // Default: created_at desc, document_order asc (原文顺序)
      const defOrder = next === 'document_order' ? 'asc' : 'desc';
      setSort(next, defOrder);
    }
  };

  const handlePage = (p: number) => {
    fetchList({ page: p });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-canvas border-b border-hairline">
        <div className="max-w-4xl mx-auto px-4 md:px-6 h-[52px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="inline-flex items-center gap-2 text-ink hover:text-primary transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              <span className="text-sm font-medium">返回</span>
            </Link>
            <span className="text-hairline">|</span>
            <h1 className="text-base font-display font-medium text-ink m-0">单词本</h1>
            <Badge variant="coral">{total}</Badge>
          </div>
          <div className="flex items-center gap-2" />
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 md:px-6 py-6">
        {/* Toolbar: search + sort */}
        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <div className="flex-1 relative">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="搜索单词 / 释义..."
              className="w-full h-10 pl-10 pr-4 bg-surface-card border border-hairline rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-soft" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted whitespace-nowrap">排序：</span>
            <button
              onClick={() => handleSortBy('created_at')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${sortBy === 'created_at' ? 'bg-primary text-on-primary border-primary' : 'bg-surface-card text-muted border-hairline hover:border-primary/40'}`}
            >
              时间 {sortBy === 'created_at' && (order === 'asc' ? '↑' : '↓')}
            </button>
            <button
              onClick={() => handleSortBy('document_order')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${sortBy === 'document_order' ? 'bg-primary text-on-primary border-primary' : 'bg-surface-card text-muted border-hairline hover:border-primary/40'}`}
            >
              文档顺序 {sortBy === 'document_order' && (order === 'asc' ? '↑' : '↓')}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-md text-sm text-error">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && items.length === 0 ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title={query ? `未找到 “${query}”` : '单词本还是空的'}
            description={query ? '试试其他关键词' : '去阅读页解析单词后，一键加入单词本'}
            action={!query ? <Link to="/"><Button size="sm">去阅读</Button></Link> : undefined}
          />
        ) : (
          <>
             {/* Grouped list: day (created_at) for 时间 mode, pure document for 文档顺序 mode */}
            {(() => {
              // In 文档顺序 mode group purely by document (one complete block per
              // document, no day fragmentation) so a document is shown whole
              // before the next one appears. 时间 mode keeps the day grouping.
              const groupByDay = sortBy !== 'document_order';
              const dayOrder: string[] = [];
              const dayMap = new Map<string, { label: string; docs: Map<string, { docId: string | null; title: string; items: typeof items }> }>();
              for (const entry of items) {
                const dk = groupByDay ? dayKey(entry.created_at) : '__all__';
                const label = groupByDay ? formatDay(entry.created_at) : '';
                if (!dayMap.has(dk)) {
                  dayMap.set(dk, { label, docs: new Map() });
                  dayOrder.push(dk);
                }
                const g = dayMap.get(dk)!;
                const docId = entry.source_document_id;
                const docTitle = entry.source_document_title || '未命名文档';
                const docKey = `${docId || 'unknown'}::${docTitle}`;
                if (!g.docs.has(docKey)) {
                  g.docs.set(docKey, { docId, title: docTitle, items: [] });
                }
                g.docs.get(docKey)!.items.push(entry);
              }
              return (
                <div className="flex flex-col gap-6">
                  {dayOrder.map((dk) => {
                    const group = dayMap.get(dk)!;
                    return (
                      <div key={dk}>
                        {groupByDay && (
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-sm font-medium text-ink">{group.label}</span>
                            <span className="text-xs text-muted">({dayCounts[dk] ?? [...group.docs.values()].reduce((s, d) => s + d.items.length, 0)} 词)</span>
                            <div className="flex-1 h-px bg-hairline/60 ml-2" />
                          </div>
                        )}
                         <div className="flex flex-col gap-4">
                           {[...group.docs.values()]
                             .sort((a, b) => docActivity(b) - docActivity(a))
                             .map((docGroup) => (
                            <div key={`${dk}-${docGroup.docId || docGroup.title}`}>
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-medium text-primary truncate">
                                  {docGroup.docId ? (
                                    <Link to={`/document/${docGroup.docId}`} className="hover:underline" title={docGroup.title}>
                                      {docGroup.title}
                                    </Link>
                                  ) : (
                                    docGroup.title
                                  )}
                                </span>
                                <span className="text-xs text-muted-soft">· {docGroup.items.length} 词</span>
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {[...docGroup.items]
                                  .sort(docAppearanceCompare)
                                   .map((entry) => (
                                  <div key={entry.id} className="bg-surface-card border border-hairline rounded-lg p-4 shadow-soft">
                                    <div className="flex flex-col gap-2.5">
                                      {/* Row 1: 单词原文 | 音标 —— 删除按钮 */}
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                          <span className="font-bold text-ink text-[15px] font-reading break-words">{entry.word_original}</span>
                                          {entry.phonetic ? (
                                            <PhoneticWithSpeakers word={entry.word_original} phonetic={entry.phonetic} />
                                          ) : (
                                            <span className="text-xs text-muted-soft">暂无音标</span>
                                          )}
                                        </div>
                                        <button
                                          onClick={() => handleDelete(entry.id)}
                                          disabled={deletingId === entry.id}
                                          className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-soft hover:text-error hover:bg-error/5 disabled:opacity-50 transition-colors"
                                          title="删除"
                                          aria-label="删除"
                                        >
                                          {deletingId === entry.id ? (
                                            <span className="text-[11px]">...</span>
                                          ) : (
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                            </svg>
                                          )}
                                        </button>
                                      </div>

                                      {/* Part 2: 词典源释义（不同词性换行显示） */}
                                      <div className="flex flex-col gap-1">
                                        {(() => {
                                          const segs = parseTranslationByPos(entry.translation);
                                          if (segs.length > 0) {
                                            return segs.map((s, i) => (
                                              <div key={i} className="flex items-start gap-2 text-sm leading-relaxed">
                                                {s.pos && (
                                                  <span className="flex-shrink-0 text-muted text-xs mt-0.5 font-reading">{s.pos}</span>
                                                )}
                                                <span className="text-body-strong font-chinese">{s.text}</span>
                                              </div>
                                            ));
                                          }
                                          if (entry.definition_en) {
                                            return (
                                              <p className="text-sm text-body-strong font-chinese m-0 leading-relaxed">
                                                <span className="text-xs text-muted-soft mr-1">[英]</span>{entry.definition_en}
                                              </p>
                                            );
                                          }
                                          return <p className="text-sm text-muted-soft m-0">暂无词典释义</p>;
                                        })()}
                                      </div>

                                      {/* Part 3: 来源文档（每个文档各占一行）+ 加入日期（仅到日） */}
                                      <div className="flex flex-col gap-1.5 border-t border-hairline/60 pt-2.5">
                                        <span className="text-xs text-muted-soft">来源</span>
                                        {(() => {
                                          const sources =
                                            entry.all_sources && entry.all_sources.length > 0
                                              ? Array.from(
                                                  new Map(
                                                    entry.all_sources.map((s) => [s.document_id, s]),
                                                  ).values(),
                                                ).sort(
                                                  (a, b) =>
                                                    (a.document_id === entry.source_document_id ? 0 : 1) -
                                                    (b.document_id === entry.source_document_id ? 0 : 1),
                                                )
                                              : [];
                                          const list =
                                            sources.length > 0
                                              ? sources
                                              : entry.source_document_id
                                                ? [{ document_id: entry.source_document_id, document_title: entry.source_document_title, added_at: null }]
                                                : [];
                                          if (list.length === 0) {
                                            return <span className="text-xs text-muted-soft">来源已删除</span>;
                                          }
                                          return (
                                            <div className="flex flex-col gap-1">
                                              {list.map((s, i) => (
                                                <div key={s.document_id || i} className="flex items-center justify-between gap-2 text-xs min-w-0">
                                                  {s.document_id ? (
                                                    <Link
                                                      to={`/document/${s.document_id}`}
                                                      className="text-primary hover:underline truncate"
                                                      title={s.document_title || undefined}
                                                    >
                                                      {s.document_title || '未命名文档'}
                                                    </Link>
                                                  ) : (
                                                    <span className="text-muted-soft truncate">
                                                      {s.document_title || '未命名文档'}
                                                    </span>
                                                  )}
                                                  <span className="flex-shrink-0 text-muted-soft">
                                                    {formatDate(s.added_at ?? entry.created_at)}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          );
                                        })()}
                                      </div>
                                     </div>
                                   </div>
                                 ))}
                                 {/* 末行自动补位：隐形占位卡对齐网格 */}
                                 {(() => {
                                   const remainder = docGroup.items.length % cols;
                                   const pad = remainder > 0 ? cols - remainder : 0;
                                   return Array.from({ length: pad }, (_, i) => (
                                     <div key={`pad-${i}`} aria-hidden="true" className="pointer-events-none invisible rounded-lg" />
                                   ));
                                 })()}
                               </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-1 mt-6 flex-wrap">
                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => handlePage(page - 1)}>上一页</Button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let p: number;
                  if (totalPages <= 7) p = i + 1;
                  else if (page <= 4) p = i + 1;
                  else if (page >= totalPages - 3) p = totalPages - 6 + i;
                  else p = page - 3 + i;
                  return (
                    <button
                      key={p}
                      onClick={() => handlePage(p)}
                      className={`w-8 h-8 rounded-md text-sm font-medium transition-colors ${p === page ? 'bg-primary text-on-primary' : 'bg-surface-card border border-hairline hover:border-primary/40'}`}
                    >
                      {p}
                    </button>
                  );
                })}
                <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => handlePage(page + 1)}>下一页</Button>
                <span className="text-xs text-muted ml-2">共 {total} 个 · 第 {page}/{totalPages} 页</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
