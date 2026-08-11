import { useState, useCallback, useEffect, useRef, isValidElement, Fragment } from 'react';
import { flushSync } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDocumentStore } from '../../stores/documentStore';
import { useReaderStore, WORD_PANEL_FONT_SIZE_MIN, WORD_PANEL_FONT_SIZE_MAX, BG_COLORS } from '../../stores/readerStore';
import { deleteWordAnalysis, deleteAllWordAnalyses, WordAnalysisResult } from '../../services/wordAnalysisApi';
import { deleteSentenceAnalysis, deleteAllSentenceAnalyses } from '../../services/sentenceAnalysisApi';
import type { SentenceAnalysisResult } from '../../services/sentenceAnalysisApi';
import { sentenceBodyMarkdown, sentenceBreakdownChunks } from '../../utils/sentenceSections';
import EmptyState from '../ui/EmptyState';
import Button from '../ui/Button';
import PhoneticWithSpeakers from './PhoneticWithSpeakers';

// ── Module-level callback for reverse navigation ──
let _scrollToAnalysis: ((key: string, tab: 'words' | 'sentences') => void) | null = null;
let _openPanel: (() => void) | null = null;
let _pendingScroll: { key: string; tab: 'words' | 'sentences' } | null = null;

export function setOnOpenPanel(cb: (() => void) | null) {
  _openPanel = cb;
}

export function triggerScrollToAnalysis(key: string, tab: 'words' | 'sentences') {
  if (_scrollToAnalysis) {
    // Panel is mounted — scroll immediately
    _scrollToAnalysis(key, tab);
  } else {
    // Panel is closed — request open + queue the scroll for after mount
    _pendingScroll = { key, tab };
    _openPanel?.();
  }
}

// ── Streaming Word Card (shows raw AI output as itʼs generated) ──────

function StreamingWordCard({
  word,
  paragraphIndex,
  rawText,
}: {
  word: string;
  paragraphIndex: number;
  rawText: string;
}) {
  const rawTextRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as text streams in
  useEffect(() => {
    if (rawTextRef.current) {
      rawTextRef.current.scrollTop = rawTextRef.current.scrollHeight;
    }
  }, [rawText]);

  return (
    <div
      className="bg-surface-card border border-primary/30 rounded-lg p-3.5 mb-3"
      data-word-key={`${paragraphIndex}:${word.toLowerCase()}`}
      data-paragraph-index={paragraphIndex}
      style={{ boxShadow: '0 0 0 1px rgba(204,120,92,0.15)' }}
    >
      {/* Word header with streaming indicator */}
      <div className="flex items-center gap-2 mb-2">
        <span className="font-bold text-ink text-base font-reading">{word}</span>
        <span className="inline-flex items-center gap-1 text-xs text-primary">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          AI 生成中...
        </span>
      </div>

      {/* Raw AI output — monospace, scrollable, typewriter feel */}
      <div
        ref={rawTextRef}
        className="bg-[#faf9f5] border border-hairline rounded-md p-2.5 max-h-[200px] overflow-y-auto"
      >
        <pre className="text-xs font-mono text-body-strong whitespace-pre-wrap break-words m-0 leading-relaxed">
          {rawText || (
            <span className="text-muted-soft animate-pulse">等待 AI 响应...</span>
          )}
        </pre>
      </div>
    </div>
  );
}

// ── Word Card ──────────────────────────────────────────────────────

function WordCard({
  analysis,
  onScrollToParagraph,
  onDelete,
}: {
  analysis: WordAnalysisResult;
  onScrollToParagraph: (index: number) => void;
  onDelete: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [showDefZh, setShowDefZh] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      if (analysis.id) await deleteWordAnalysis(analysis.id);
      onDelete();
    } catch {
      // Keep card visible if API call fails — user can retry
    }
    finally { setDeleting(false); setConfirming(false); }
  }, [analysis.id, onDelete]);

  return (
    <div
      className="bg-surface-card border border-hairline rounded-lg p-3.5 mb-3"
      data-word-key={`${analysis.paragraph_index}:${analysis.word.toLowerCase()}`}
      data-paragraph-index={analysis.paragraph_index}
    >
      {/* Header: word + phonetic + delete */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className="font-bold text-ink cursor-pointer hover:text-primary transition-colors text-base font-reading"
            onClick={() => onScrollToParagraph(analysis.paragraph_index)}
            title="点击定位到原文位置"
          >
            {analysis.word}
          </span>
          <PhoneticWithSpeakers word={analysis.word} phonetic={analysis.phonetic} />
        </div>

        {confirming ? (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              className="px-2 py-0.5 text-xs font-medium text-error hover:bg-error/10 rounded"
              onClick={handleDelete}
              disabled={deleting}
            >
              删除
            </button>
            <button
              className="px-2 py-0.5 text-xs text-muted hover:bg-surface-card rounded"
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-soft hover:text-error hover:bg-error/5 transition-colors flex-shrink-0"
            title="删除"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        )}
      </div>

      {/* Definition */}
      {analysis.definition && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-muted mb-0.5" style={{ fontSize: '0.75em' }}>
            <span>释义</span>
            {analysis.definition_zh && (
              <button
                onClick={() => setShowDefZh(!showDefZh)}
                className="cursor-pointer text-muted-soft hover:text-muted select-none inline-flex items-center gap-0.5 text-xs"
              >
                {showDefZh ? '隐藏中文' : '展开中文'}
              </button>
            )}
          </div>
          <p className="text-body-strong m-0 font-reading">
            {analysis.part_of_speech && (
              <span className="italic text-muted mr-1" style={{ fontSize: '0.85em' }}>{analysis.part_of_speech}</span>
            )}
            {analysis.definition}
          </p>
          {showDefZh && analysis.definition_zh && (
            <p className="mt-0.5 text-muted leading-relaxed m-0 font-chinese" style={{ fontSize: '0.75em' }}>
              {analysis.definition_zh}
            </p>
          )}
        </div>
      )}

      {/* Base/Plural forms */}
      {(analysis.base_form || analysis.plural_form) && (
        <div className="mb-2 flex items-center gap-3 text-muted text-[0.75em]">
          {analysis.base_form && (
            <span>原形：<strong className="text-body-strong">{analysis.base_form}</strong></span>
          )}
          {analysis.plural_form && (
            <span>复数：<strong className="text-body-strong">{analysis.plural_form}</strong></span>
          )}
        </div>
      )}

      {/* Synonyms */}
      {(analysis.synonyms_antonyms?.synonyms?.length ?? 0) > 0 && (
        <div className="mb-2">
          <span className="text-success text-[0.75em] block mb-1">同义词</span>
          <div className="flex flex-wrap gap-1.5">
            {analysis.synonyms_antonyms.synonyms.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1 bg-[#f0f7f1] border border-[#c8e6c9] rounded px-2 py-0.5 text-xs">
                <span className="text-muted-soft">{s.part_of_speech}</span>
                <span className="font-medium text-body-strong">{s.word}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Cognates */}
      {analysis.cognates && analysis.cognates.length > 0 && (
        <div className="mb-2">
          <span className="text-muted text-[0.75em] block mb-1">同根词</span>
          <div className="flex flex-wrap gap-1.5">
            {analysis.cognates.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1 bg-surface-cream-strong rounded px-2 py-0.5 text-xs">
                <span className="text-muted-soft">{c.part_of_speech}</span>
                <span className="font-medium text-body-strong">{c.word}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Collocations */}
      {analysis.collocations && analysis.collocations.length > 0 && (
        <div className="mb-2">
          <span className="text-muted text-[0.75em] block mb-1">常见搭配</span>
          <div className="flex flex-wrap gap-1.5">
            {analysis.collocations.map((c, i) => (
              <span key={i} className="inline-flex items-center bg-[#eef4fa] border border-[#c8ddf0] rounded px-2 py-0.5 text-xs font-reading">
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Example Sentence */}
      {analysis.example_sentence && (
        <div className="mb-2 pt-2 border-t border-hairline">
          <span className="text-muted text-[0.75em] block mb-1">例句</span>
          <p className="text-body leading-relaxed italic text-xs m-0 font-reading">
            {analysis.example_sentence}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Streaming Sentence Card (shows raw AI output as itʼs generated) ──

function StreamingSentenceCard({
  sentenceText,
  paragraphIndex,
  sentenceIndex,
  rawText,
}: {
  sentenceText: string;
  paragraphIndex: number;
  sentenceIndex: number;
  rawText: string;
}) {
  const rawTextRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as text streams in
  useEffect(() => {
    if (rawTextRef.current) {
      rawTextRef.current.scrollTop = rawTextRef.current.scrollHeight;
    }
  }, [rawText]);

  return (
    <div
      className="bg-surface-card border border-primary/30 rounded-lg p-3.5 mb-3"
      data-sentence-key={`${paragraphIndex}:${sentenceIndex}`}
      data-paragraph-index={paragraphIndex}
      style={{ boxShadow: '0 0 0 1px rgba(204,120,92,0.15)' }}
    >
      {/* Sentence header with streaming indicator */}
      <div className="flex items-center gap-2 mb-2">
        <span className="font-semibold text-ink leading-snug text-sm line-clamp-2 font-reading">
          {sentenceText}
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-primary flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          AI 生成中...
        </span>
      </div>

      {/* Raw AI output — monospace, scrollable, typewriter feel */}
      <div
        ref={rawTextRef}
        className="bg-[#faf9f5] border border-hairline rounded-md p-2.5 max-h-[200px] overflow-y-auto"
      >
        <pre className="text-xs font-mono text-body-strong whitespace-pre-wrap break-words m-0 leading-relaxed">
          {rawText || (
            <span className="text-muted-soft animate-pulse">等待 AI 响应...</span>
          )}
        </pre>
      </div>
    </div>
  );
}

// ── Sentence Card ──────────────────────────────────────────────────

// Section header label styles for sentence-analysis markdown (标题名 → 标签配色)
const SENTENCE_HEADER_STYLES: Record<string, string> = {
  原句拆解: 'bg-[#fdf3ef] text-[#b85c3a] border border-[#e8b4a0]',
  理解拆解: 'bg-[#f0f7f1] text-[#4a7c59] border border-[#a3d4a8]',
  阅读线索: 'bg-[#eef2f8] text-[#5a6d8a] border border-[#a8b8d4]',
  地道翻译: 'bg-[#fdf6e3] text-[#8a6d3b] border border-[#e6d5a0]',
  // 旧数据兼容
  原文: 'bg-[#eef2f8] text-[#5a6d8a] border border-[#a8b8d4]',
  主干: 'bg-[#fdf3ef] text-[#b85c3a] border border-[#e8b4a0]',
  讲解: 'bg-[#f0f7f1] text-[#4a7c59] border border-[#a3d4a8]',
  译文: 'bg-[#eef2f8] text-[#5a6d8a] border border-[#a8b8d4]',
};

/** Render AI analysis content using react-markdown with styled section headers. */
function SentenceContent({ content }: { content: string }) {
  if (!content) return null;

  return (
    <div className="sentence-content text-body leading-relaxed text-sm font-chinese">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Style sentence-analysis section headers (**原句拆解**：, **理解拆解**：, etc.)
          strong: ({ children, ...props }) => {
            const text = String(children);
            // 兼容旧数据：**主干：**content —— 冒号在 strong 内部
            const colonMatch = text.match(/^(.+?)[：:]\s*/);
            if (colonMatch && SENTENCE_HEADER_STYLES[colonMatch[1].trim()]) {
              const header = colonMatch[1].trim();
              const after = text.slice(colonMatch[0].length);
              return (
                <span className="inline-block">
                  <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded mr-1.5 align-middle ${SENTENCE_HEADER_STYLES[header]}`}>
                    {header}
                  </span>
                  {after && <span className="align-middle">{after}</span>}
                </span>
              );
            }
            return <strong {...props}>{children}</strong>;
          },
          // Style paragraphs. **原句拆解**：content 中冒号在 <strong> 外，
          // 因此在 p 层识别「已知标题 strong + 前导冒号文本」并渲染为彩色标签 + 内容。
          p: ({ children }) => {
            const arr = Array.isArray(children) ? children : [children];
            const first = arr[0];
            const firstChildren =
              isValidElement(first) ? (first.props as { children?: unknown }).children : undefined;
            const headerName = typeof firstChildren === 'string' ? firstChildren.trim() : '';
            const style = SENTENCE_HEADER_STYLES[headerName];
            if (style && typeof arr[1] === 'string') {
              const after = arr[1].replace(/^[：:]\s*/, '');
              // 标签与内容同为 <p> 的内联子节点：句子含 markdown 强调等产生额外子节点时，
              // 也会与标签同行，不会因 block 包装被推到下一行。
              return (
                <p className="m-0 mb-1.5 last:mb-0">
                  <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded mr-1.5 align-middle ${style}`}>
                    {headerName}
                  </span>
                  {after && <span className="align-middle">{after}</span>}
                  {arr.slice(2)}
                </p>
              );
            }
            return <p className="m-0 mb-1 last:mb-0">{children}</p>;
          },
          // Style list items
          li: ({ children, ...props }) => (
            <li className="mb-0.5 last:mb-0 text-body" {...props}>{children}</li>
          ),
          ul: ({ children, ...props }) => (
            <ul className="m-0 mb-1 pl-4 list-disc" {...props}>{children}</ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="m-0 mb-1 pl-4 list-decimal" {...props}>{children}</ol>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** 句子卡标题：原句拆解直接作为标题（语块间高亮 / 分隔，完整显示）；旧数据回退原句纯文本 */
function SentenceTitle({ analysis }: { analysis: SentenceAnalysisResult }) {
  const chunks = sentenceBreakdownChunks(analysis.content);
  if (!chunks) return <>{analysis.sentence_text}</>;
  return (
    <>
      {chunks.map((chunk, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-primary font-bold mx-0.5"> / </span>}
          {chunk}
        </Fragment>
      ))}
    </>
  );
}

function SentenceCard({
  analysis,
  onScrollToParagraph,
  onDelete,
}: {
  analysis: SentenceAnalysisResult;
  onScrollToParagraph: (index: number) => void;
  onDelete: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      if (analysis.id) await deleteSentenceAnalysis(analysis.id);
      onDelete();
    } catch {
      // Keep card visible if API call fails — user can retry
    }
    finally { setDeleting(false); setConfirming(false); }
  }, [analysis.id, onDelete]);

  return (
    <div
      className="bg-surface-card border border-hairline rounded-lg p-3.5 mb-3"
      data-sentence-key={`${analysis.paragraph_index}:${analysis.sentence_index}`}
      data-paragraph-index={analysis.paragraph_index}
    >
      {/* Header: sentence text + delete */}
      <div className="flex items-start justify-between mb-3">
        <span
          className="font-semibold text-ink cursor-pointer hover:text-primary transition-colors leading-snug text-sm font-reading"
          onClick={() => onScrollToParagraph(analysis.paragraph_index)}
          title="点击定位到原文位置"
        >
          <SentenceTitle analysis={analysis} />
        </span>

        {confirming ? (
          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
            <button
              className="px-2 py-0.5 text-xs font-medium text-error hover:bg-error/10 rounded"
              onClick={handleDelete}
              disabled={deleting}
            >
              删除
            </button>
            <button
              className="px-2 py-0.5 text-xs text-muted hover:bg-surface-card rounded"
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-soft hover:text-error hover:bg-error/5 transition-colors flex-shrink-0 ml-2"
            title="删除"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        )}
      </div>

      {/* Content: 理解拆解/阅读线索/地道翻译（原句拆解已上移标题） */}
      <SentenceContent content={sentenceBodyMarkdown(analysis.content)} />
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────

export default function StudyPanel({
  onClose,
  mobile = false,
}: {
  onClose?: () => void;
  /** Mobile bottom-sheet mode: the sheet covers the lower viewport, so the
   *  located paragraph must scroll to the top of the reading area */
  mobile?: boolean;
}) {
  const {
    documentId,
    wordAnalyses,
    sentenceAnalyses,
    removeWordAnalysis,
    removeSentenceAnalysis,
    clearWordAnalyses,
    clearSentenceAnalyses,
    isAnalyzing,
    isAnalyzingSentences,
    analysisError,
    sentenceAnalysisError,
    analysisProgress,
    streamingTexts,
    sentenceStreamingTexts,
    selectedWords,
    selectedSentences,
  } = useDocumentStore();

  const {
    wordPanelFontSize,
    increaseWordPanelFontSize,
    decreaseWordPanelFontSize,
    bgColor,
  } = useReaderStore();
  const bgColorValue = BG_COLORS.find(c => c.key === bgColor)?.value ?? BG_COLORS[0].value;

  const [activeTab, setActiveTab] = useState<'words' | 'sentences'>('words');
  const [clearConfirming, setClearConfirming] = useState(false);

  const wordList = Object.values(wordAnalyses);
  wordList.sort((a, b) => a.paragraph_index - b.paragraph_index);

  const sentenceList = Object.values(sentenceAnalyses);
  sentenceList.sort((a, b) => a.paragraph_index - b.paragraph_index);

  const pendingWordCount = Object.keys(selectedWords).length;
  const pendingSentenceCount = Object.keys(selectedSentences).length;

  const hasAnyContent = wordList.length > 0 || sentenceList.length > 0;

  // Register module-level callback for reverse navigation
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  useEffect(() => {
    _scrollToAnalysis = (key: string, tab: 'words' | 'sentences') => {
      if (activeTabRef.current !== tab) {
        flushSync(() => setActiveTab(tab));
      }
      const selector = tab === 'words'
        ? `[data-word-key="${key}"]`
        : `[data-sentence-key="${key}"]`;
      const el = document.querySelector(selector);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const flashClass = tab === 'words' ? 'word-card-flash' : 'sentence-card-flash';
        el.classList.add(flashClass);
        setTimeout(() => el.classList.remove(flashClass), 1500);
      }
    };

    // Execute pending scroll if panel was opened via click on analyzed word/sentence
    if (_pendingScroll) {
      const { key, tab } = _pendingScroll;
      _pendingScroll = null;
      setTimeout(() => _scrollToAnalysis?.(key, tab), 150);
    }

    return () => { _scrollToAnalysis = null; };
  }, []);

  const handleScrollToParagraph = useCallback((paragraphIndex: number) => {
    const el = document.querySelector(`[data-paragraph-index="${paragraphIndex}"]`);
    if (el) {
      // Mobile: the bottom sheet covers the lower viewport, so align the
      // paragraph to the top of the reading area instead of centering it
      el.scrollIntoView({ behavior: 'smooth', block: mobile ? 'start' : 'center' });
      el.classList.add('paragraph-flash');
      setTimeout(() => el.classList.remove('paragraph-flash'), 1500);
    }
  }, [mobile]);

  const handleDeleteWord = useCallback(
    (analysis: WordAnalysisResult) => {
      removeWordAnalysis(analysis.paragraph_index, analysis.word);
    },
    [removeWordAnalysis]
  );

  const handleDeleteSentence = useCallback(
    (analysis: SentenceAnalysisResult) => {
      removeSentenceAnalysis(analysis.paragraph_index, analysis.sentence_index);
    },
    [removeSentenceAnalysis]
  );

  const [clearError, setClearError] = useState<string | null>(null);

  const handleClearCurrent = useCallback(async () => {
    if (!documentId) {
      setClearError('文档 ID 不存在，无法清空');
      setClearConfirming(false);
      return;
    }
    setClearError(null);
    try {
      if (activeTab === 'words') {
        await deleteAllWordAnalyses(documentId);
        clearWordAnalyses();
      } else {
        await deleteAllSentenceAnalyses(documentId);
        clearSentenceAnalyses();
      }
    } catch (e: any) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail || '';
      const message = e?.message || '';
      console.error('清空解析记录失败:', { status, detail, message, documentId, url: e?.config?.url });
      // Build a meaningful error message
      if (status === 404) {
        setClearError(`删除接口未找到 (404) — 请确认后端服务已启动且路由正确。文档ID: ${documentId.slice(0, 8)}...`);
      } else if (status) {
        setClearError(`清空失败 (HTTP ${status}): ${detail || message}`);
      } else if (message) {
        setClearError(`网络错误: ${message}`);
      } else {
        setClearError('清空失败，请稍后重试');
      }
      // Do NOT clear locally — let user retry after the API succeeds
    }
    setClearConfirming(false);
  }, [activeTab, documentId, clearWordAnalyses, clearSentenceAnalyses]);

  return (
    <div className="flex-1 min-h-0 flex flex-col border-l border-hairline transition-colors duration-300" style={{ backgroundColor: bgColorValue }}>
      {/* Header — hidden on mobile (StudySheet provides its own header) */}
      <div className="hidden md:flex items-center justify-between px-4 py-3 border-b border-hairline flex-shrink-0">
        <h3 className="text-sm font-display font-medium text-ink m-0">解析面板</h3>
        <div className="flex items-center gap-1">
          {/* Close panel button */}
          {onClose && (
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-card transition-colors text-muted-soft hover:text-ink"
              title="关闭面板"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
          {/* Font size controls */}
          <button
            onClick={decreaseWordPanelFontSize}
            disabled={wordPanelFontSize <= WORD_PANEL_FONT_SIZE_MIN}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-card disabled:opacity-30 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14" />
            </svg>
          </button>
          <span className="text-xs text-muted min-w-[28px] text-center">{wordPanelFontSize}px</span>
          <button
            onClick={increaseWordPanelFontSize}
            disabled={wordPanelFontSize >= WORD_PANEL_FONT_SIZE_MAX}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-card disabled:opacity-30 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>

          {hasAnyContent && (
            clearConfirming ? (
              <div className="flex items-center gap-1 ml-1">
                <button
                  className="px-2 py-0.5 text-xs text-error hover:bg-error/10 rounded"
                  onClick={handleClearCurrent}
                >
                  清空
                </button>
                <button
                  className="px-2 py-0.5 text-xs text-muted hover:bg-surface-card rounded"
                  onClick={() => setClearConfirming(false)}
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                className="ml-1 px-1.5 py-0.5 text-xs text-muted-soft hover:text-error transition-colors rounded"
                onClick={() => setClearConfirming(true)}
              >
                清空
              </button>
            )
          )}
        </div>
      </div>

      {/* Progress indicator with live count */}
      {isAnalyzing && analysisProgress && (
        <div className="px-4 py-2 bg-surface-card border-b border-hairline flex-shrink-0">
          <div className="flex items-center gap-2 mb-1.5">
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="var(--primary)" strokeWidth="4" opacity="0.25" />
              <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="var(--primary)" opacity="0.75" />
            </svg>
            <span className="text-xs text-body">
              已完成 {analysisProgress.completed}/{analysisProgress.total} 个单词
            </span>
          </div>
          {/* Mini progress bar */}
          <div className="w-full h-1 bg-surface-cream-strong rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
              style={{ width: `${(analysisProgress.completed / analysisProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}
      {/* Fallback: old-style indicator when progress tracking not available */}
      {isAnalyzing && !analysisProgress && pendingWordCount > 0 && (
        <div className="px-4 py-2 bg-surface-card border-b border-hairline flex items-center gap-2 flex-shrink-0">
          <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="var(--primary)" strokeWidth="4" opacity="0.25" />
            <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="var(--primary)" opacity="0.75" />
          </svg>
          <span className="text-xs text-body">正在解析 {pendingWordCount} 个单词...</span>
        </div>
      )}
      {isAnalyzingSentences && pendingSentenceCount > 0 && (
        <div className="px-4 py-2 bg-surface-card border-b border-hairline flex items-center gap-2 flex-shrink-0">
          <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="var(--primary)" strokeWidth="4" opacity="0.25" />
            <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="var(--primary)" opacity="0.75" />
          </svg>
          <span className="text-xs text-body">正在解析 {pendingSentenceCount} 个句子...</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-hairline flex-shrink-0 px-4">
        <button
          onClick={() => setActiveTab('words')}
          className={[
            'px-3 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px]',
            activeTab === 'words'
              ? 'border-primary text-ink'
              : 'border-transparent text-muted hover:text-body-strong',
          ].join(' ')}
        >
          单词{wordList.length > 0 && ` (${wordList.length})`}
        </button>
        <button
          onClick={() => setActiveTab('sentences')}
          className={[
            'px-3 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px]',
            activeTab === 'sentences'
              ? 'border-primary text-ink'
              : 'border-transparent text-muted hover:text-body-strong',
          ].join(' ')}
        >
          句子{sentenceList.length > 0 && ` (${sentenceList.length})`}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3 study-panel-content" style={{ fontSize: wordPanelFontSize }}>
        {activeTab === 'words' && (
          <>
            {/* Loading */}
            {isAnalyzing && wordList.length === 0 && (
              <div className="flex justify-center py-12">
                <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            )}

            {/* Error */}
            {analysisError && !isAnalyzing && (
              <div className="mb-3 p-3 bg-error/10 border border-error/20 rounded-md text-sm text-error">
                {analysisError}
              </div>
            )}

            {/* Clear error */}
            {clearError && activeTab === 'words' && (
              <div className="mb-3 p-3 bg-error/10 border border-error/20 rounded-md text-sm text-error flex items-center justify-between">
                <span>{clearError}</span>
                <button
                  className="text-xs text-error underline hover:no-underline ml-2 flex-shrink-0"
                  onClick={() => setClearError(null)}
                >
                  关闭
                </button>
              </div>
            )}

            {/* Empty */}
            {wordList.length === 0 && !isAnalyzing && !analysisError && !clearError && (
              <EmptyState
                title="选中原文单词后点击解析"
                description="点击文章中的任意单词，然后点击底部「解析」按钮获取详细释义"
              />
            )}

            {/* Word cards — streaming text while pending, full card when done */}
            {wordList.map((analysis) => {
              const key = `${analysis.paragraph_index}:${analysis.word.toLowerCase()}`;
              if (analysis._pending) {
                return (
                  <StreamingWordCard
                    key={key}
                    word={analysis.word}
                    paragraphIndex={analysis.paragraph_index}
                    rawText={streamingTexts[key] || ''}
                  />
                );
              }
              return (
                <WordCard
                  key={key}
                  analysis={analysis}
                  onScrollToParagraph={handleScrollToParagraph}
                  onDelete={() => handleDeleteWord(analysis)}
                />
              );
            })}
          </>
        )}

        {activeTab === 'sentences' && (
          <>
            {/* Loading */}
            {isAnalyzingSentences && sentenceList.length === 0 && (
              <div className="flex justify-center py-12">
                <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            )}

            {/* Error */}
            {sentenceAnalysisError && !isAnalyzingSentences && (
              <div className="mb-3 p-3 bg-error/10 border border-error/20 rounded-md text-sm text-error">
                {sentenceAnalysisError}
              </div>
            )}

            {/* Clear error */}
            {clearError && activeTab === 'sentences' && (
              <div className="mb-3 p-3 bg-error/10 border border-error/20 rounded-md text-sm text-error flex items-center justify-between">
                <span>{clearError}</span>
                <button
                  className="text-xs text-error underline hover:no-underline ml-2 flex-shrink-0"
                  onClick={() => setClearError(null)}
                >
                  关闭
                </button>
              </div>
            )}

            {/* Empty */}
            {sentenceList.length === 0 && !isAnalyzingSentences && !sentenceAnalysisError && !clearError && (
              <EmptyState
                title="选中原文句子后点击解析"
                description="点击文章中的任意句子，然后点击底部「解析句子」按钮获取语意块拆分"
              />
            )}

            {/* Sentence cards — streaming text while pending, full card when done */}
            {sentenceList.map((analysis) => {
              const key = `${analysis.paragraph_index}:${analysis.sentence_index}`;
              if (analysis._pending) {
                return (
                  <StreamingSentenceCard
                    key={key}
                    sentenceText={analysis.sentence_text}
                    paragraphIndex={analysis.paragraph_index}
                    sentenceIndex={analysis.sentence_index}
                    rawText={sentenceStreamingTexts[key] || ''}
                  />
                );
              }
              return (
                <SentenceCard
                  key={key}
                  analysis={analysis}
                  onScrollToParagraph={handleScrollToParagraph}
                  onDelete={() => handleDeleteSentence(analysis)}
                />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
