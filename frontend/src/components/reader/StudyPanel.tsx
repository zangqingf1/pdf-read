import { useState, useCallback, useEffect, useMemo, useRef, isValidElement, Fragment } from 'react';
import { flushSync } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeMarkdownComponents } from '../../utils/markdownComponents';
import { useDocumentStore } from '../../stores/documentStore';
import { useShallow } from 'zustand/react/shallow';
import { useReaderStore, WORD_PANEL_FONT_SIZE_MIN, WORD_PANEL_FONT_SIZE_MAX, BG_COLORS } from '../../stores/readerStore';
import { deleteWordAnalysis, deleteAllWordAnalyses, WordAnalysisResult } from '../../services/wordAnalysisApi';
import { batchAddVocabulary } from '../../services/vocabularyApi';
import { WordRichTags, ExamTagBadges } from './WordTags';
import { filterVisibleExamTags } from '../../constants/examTags';
import { SENTENCE_HEADER_STYLES } from '../../constants/sentenceHeaderStyles';
import ExamTagFilterPopover from '../common/ExamTagFilterPopover';
import { deleteSentenceAnalysis, deleteAllSentenceAnalyses } from '../../services/sentenceAnalysisApi';
import type { SentenceAnalysisResult } from '../../services/sentenceAnalysisApi';
import { sentenceBodyMarkdown, sentenceBreakdownChunks } from '../../utils/sentenceSections';
import { wordPositionMap } from '../../utils/textTokens';
import { scrollToParagraph } from '../../utils/scrollToParagraph';
import EmptyState from '../ui/EmptyState';
import Button from '../ui/Button';
import ErrorBanner from './ErrorBanner';
import { ChineseSpoiler } from '../common/ChineseSpoiler';
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
      className="bg-surface-overlay border border-primary/25 rounded-lg p-3.5 mb-3 shadow-pop"
      data-word-key={`${paragraphIndex}:${word.toLowerCase()}`}
      data-paragraph-index={paragraphIndex}
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
        className="bg-canvas border border-hairline rounded-md p-2.5 max-h-[200px] overflow-y-auto"
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
  const [confirming, setConfirming] = useState(false);
  const visibleExamTags = useReaderStore((s) => s.visibleExamTags);
  const examTags = filterVisibleExamTags(analysis.exam_tags, visibleExamTags);

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
      className="bg-surface-overlay border border-hairline-soft rounded-lg p-3.5 mb-3 shadow-soft"
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
          <p className="text-body-strong m-0 font-reading">
            {analysis.part_of_speech && (
              <span className="italic text-muted mr-1" style={{ fontSize: '0.85em' }}>{analysis.part_of_speech}</span>
            )}
            {analysis.definition}
          </p>
          {analysis.definition_zh && (
            <p className="mt-0.5 text-muted leading-relaxed m-0 font-chinese" style={{ fontSize: '0.75em' }}>
              <ChineseSpoiler>{analysis.definition_zh}</ChineseSpoiler>
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

      {/* Synonyms / Cognates / Collocations (shared with word book) */}
      <WordRichTags
        synonyms={analysis.synonyms_antonyms?.synonyms || []}
        cognates={analysis.cognates || []}
        collocations={analysis.collocations || []}
      />

      {/* Example Sentence */}
      {analysis.example_sentence && (
        <div className="mb-2 pt-2 border-t border-hairline">
          <span className="text-muted text-[0.75em] block mb-1">例句</span>
          <p className="text-body leading-relaxed italic text-xs m-0 font-reading">
            {analysis.example_sentence}
          </p>
        </div>
      )}

      {/* Exam tags (card bottom) */}
      {examTags.length > 0 && <ExamTagBadges tags={examTags} />}
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
      className="bg-surface-overlay border border-primary/25 rounded-lg p-3.5 mb-3 shadow-pop"
      data-sentence-key={`${paragraphIndex}:${sentenceIndex}`}
      data-paragraph-index={paragraphIndex}
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
        className="bg-canvas border border-hairline rounded-md p-2.5 max-h-[200px] overflow-y-auto"
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

/** Render AI analysis content using react-markdown with styled section headers. */
function SentenceContent({ content }: { content: string }) {
  if (!content) return null;

  return (
    <div className="sentence-content text-body leading-relaxed text-sm font-chinese">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          ...safeMarkdownComponents,
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
      className="bg-surface-overlay border border-hairline-soft rounded-lg p-3.5 mb-3 shadow-soft"
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
    paragraphs,
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
  } = useDocumentStore(useShallow((s) => ({
    documentId: s.documentId,
    paragraphs: s.paragraphs,
    wordAnalyses: s.wordAnalyses,
    sentenceAnalyses: s.sentenceAnalyses,
    removeWordAnalysis: s.removeWordAnalysis,
    removeSentenceAnalysis: s.removeSentenceAnalysis,
    clearWordAnalyses: s.clearWordAnalyses,
    clearSentenceAnalyses: s.clearSentenceAnalyses,
    isAnalyzing: s.isAnalyzing,
    isAnalyzingSentences: s.isAnalyzingSentences,
    analysisError: s.analysisError,
    sentenceAnalysisError: s.sentenceAnalysisError,
    analysisProgress: s.analysisProgress,
    streamingTexts: s.streamingTexts,
    sentenceStreamingTexts: s.sentenceStreamingTexts,
    selectedWords: s.selectedWords,
    selectedSentences: s.selectedSentences,
  })));

  const {
    wordPanelFontSize,
    increaseWordPanelFontSize,
    decreaseWordPanelFontSize,
    bgColor,
  } = useReaderStore(useShallow((s) => ({
    wordPanelFontSize: s.wordPanelFontSize,
    increaseWordPanelFontSize: s.increaseWordPanelFontSize,
    decreaseWordPanelFontSize: s.decreaseWordPanelFontSize,
    bgColor: s.bgColor,
  })));
  const bgColorValue = BG_COLORS.find(c => c.key === bgColor)?.value ?? BG_COLORS[0].value;

  const [activeTab, setActiveTab] = useState<'words' | 'sentences'>('words');
  const [clearConfirming, setClearConfirming] = useState(false);
  const [vocabAdding, setVocabAdding] = useState(false);
  const [vocabMsg, setVocabMsg] = useState<string | null>(null);
  const [vocabMsgError, setVocabMsgError] = useState(false);

  // 段落 index → 英文原文（单词卡片按原文出现顺序定位的依据）
  const paragraphTextByIdx = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of paragraphs) m.set(p.index, p.text);
    return m;
  }, [paragraphs]);

  // 段落 index → 词干位置表：只在段落文本变化时重算一次，
  // 流式解析/翻译写 store 时不再反复 tokenize 全文
  const wordPositionCache = useMemo(() => {
    const cache = new Map<number, Map<string, number>>();
    for (const [pi, text] of paragraphTextByIdx) {
      cache.set(pi, wordPositionMap(text));
    }
    return cache;
  }, [paragraphTextByIdx]);

  // 单词卡：先按段落，段内按词干在原文 token 流中的首次出现下标（原文顺序）
  const wordList = useMemo(() => {
    const list = Object.values(wordAnalyses);
    const rank = (pi: number, word: string): number => {
      const m = wordPositionCache.get(pi);
      // 词不在段内 / 段不存在 → 排末尾（稳定兜底，不抖动）
      return m?.get(word.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    };
    list.sort((a, b) =>
      a.paragraph_index !== b.paragraph_index
        ? a.paragraph_index - b.paragraph_index
        : rank(a.paragraph_index, a.word) - rank(b.paragraph_index, b.word)
    );
    return list;
  }, [wordAnalyses, wordPositionCache]);

  // 句子卡：先按段落，段内按 sentence_index（原文句子顺序）
  const sentenceList = useMemo(() => {
    const list = Object.values(sentenceAnalyses);
    list.sort((a, b) =>
      a.paragraph_index !== b.paragraph_index
        ? a.paragraph_index - b.paragraph_index
        : a.sentence_index - b.sentence_index
    );
    return list;
  }, [sentenceAnalyses]);

  const pendingWordCount = Object.keys(selectedWords).length;
  const pendingSentenceCount = Object.keys(selectedSentences).length;

  const hasAnyContent = wordList.length > 0 || sentenceList.length > 0;

  // Register module-level callback for reverse navigation
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  useEffect(() => {
    let cancelled = false;
    _scrollToAnalysis = (key: string, tab: 'words' | 'sentences') => {
      if (activeTabRef.current !== tab) {
        flushSync(() => setActiveTab(tab));
      }
      // 限定在解析面板内查找：正文 token 也带 data-word-key，且 DOM 顺序在前，
      // 不加作用域会命中正文单词而非面板卡片
      const selector = (tab === 'words'
        ? `[data-word-key="${key}"]`
        : `[data-sentence-key="${key}"]`);
      const scopedSelector = `#study-panel ${selector}`;
      // 卡片可能尚未渲染（外部跳转/数据刚加载）：有界重试 ~1.5s
      let attempts = 0;
      const tryScroll = () => {
        if (cancelled) return;
        const el = document.querySelector(scopedSelector);
        if (!el && attempts < 10) {
          attempts += 1;
          setTimeout(tryScroll, 150);
          return;
        }
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const flashClass = tab === 'words' ? 'word-card-flash' : 'sentence-card-flash';
          el.classList.add(flashClass);
          setTimeout(() => el.classList.remove(flashClass), 1500);
        }
      };
      tryScroll();
    };

    // Execute pending scroll if panel was opened via click on analyzed word/sentence
    if (_pendingScroll) {
      const { key, tab } = _pendingScroll;
      _pendingScroll = null;
      setTimeout(() => _scrollToAnalysis?.(key, tab), 150);
    }

    return () => { cancelled = true; _scrollToAnalysis = null; };
  }, []);

  const handleScrollToParagraph = useCallback((paragraphIndex: number) => {
    // Mobile: the bottom sheet covers the lower viewport, so align the
    // paragraph to the top of the reading area instead of centering it
    scrollToParagraph(paragraphIndex, { block: mobile ? 'start' : 'center', retries: 1 });
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

  const handleBatchAdd = useCallback(async () => {
    if (!documentId) {
      setVocabMsg('文档 ID 不存在');
      setVocabMsgError(true);
      return;
    }
    if (wordList.length === 0) {
      setVocabMsg('暂无可加入的单词');
      setVocabMsgError(true);
      return;
    }
    // Pass the current parsed words (already excludes any the user deleted this
    // session). Relying on the server's WordAnalysis query alone would re-add
    // words whose delete hasn't been persisted (e.g. backend not reloaded).
    const words = wordList
      .filter((a) => !a._pending)
      .map((a) => a.word)
      .filter((w): w is string => !!w && w.trim().length > 0);
    if (words.length === 0) {
      setVocabMsg('暂无可加入的单词');
      setVocabMsgError(true);
      return;
    }
    setVocabAdding(true);
    setVocabMsg(null);
    try {
      const res = await batchAddVocabulary(documentId, words);
      const msg = res.added > 0
        ? `已加入 ${res.added} 个，跳过 ${res.skipped} 个（已在单词本）`
        : `全部 ${res.total} 个已在单词本中`;
      setVocabMsg(msg);
      setVocabMsgError(false);
      setTimeout(() => setVocabMsg(null), 3000);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || (e as Error)?.message || '加入失败';
      setVocabMsg(detail);
      setVocabMsgError(true);
    } finally {
      setVocabAdding(false);
    }
  }, [documentId, wordList]);

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
    <div id="study-panel" className="flex-1 min-h-0 flex flex-col border-l border-hairline transition-colors duration-300" style={{ backgroundColor: bgColorValue }}>
      {/* Header — hidden on mobile (StudySheet provides its own header) */}
      <div className="hidden md:flex items-center justify-between px-4 py-3 border-b border-hairline flex-shrink-0">
        <div className="flex items-center gap-2">
          {/* Close panel button — 左侧双箭头 */}
          {onClose && (
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-card transition-colors text-muted-soft hover:text-ink"
              title="关闭面板"
              aria-label="关闭面板"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 17l5-5-5-5M13 17l5-5-5-5" />
              </svg>
            </button>
          )}
          <h3 className="text-sm font-display font-medium text-ink m-0">解析面板</h3>
        </div>
        <div className="flex items-center gap-1">
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

          {/* Exam tag visibility */}
          {activeTab === 'words' && <ExamTagFilterPopover align="right" />}

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
              <ErrorBanner message={analysisError} className="mb-3" />
            )}

            {/* Clear error */}
            {clearError && activeTab === 'words' && (
              <ErrorBanner
                message={clearError}
                className="mb-3"
                action={
                  <button
                    className="text-xs text-error underline hover:no-underline ml-2 flex-shrink-0"
                    onClick={() => setClearError(null)}
                  >
                    关闭
                  </button>
                }
              />
            )}

            {/* Batch add to vocabulary */}
            {wordList.length > 0 && (
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs text-muted">已解析 {wordList.length} 个单词</span>
                <Button size="sm" onClick={handleBatchAdd} loading={vocabAdding}>
                  一键加入单词本 ({wordList.length})
                </Button>
              </div>
            )}
            {vocabMsg && (
              <div className={`mb-3 p-2.5 rounded-md text-xs ${vocabMsgError ? 'bg-error/10 border border-error/20 text-error' : 'bg-success/10 border border-success/20 text-success'}`}>
                {vocabMsg}
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
              <ErrorBanner message={sentenceAnalysisError} className="mb-3" />
            )}

            {/* Clear error */}
            {clearError && activeTab === 'sentences' && (
              <ErrorBanner
                message={clearError}
                className="mb-3"
                action={
                  <button
                    className="text-xs text-error underline hover:no-underline ml-2 flex-shrink-0"
                    onClick={() => setClearError(null)}
                  >
                    关闭
                  </button>
                }
              />
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
