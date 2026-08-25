import React, { useState, useCallback, useMemo, useRef, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ParagraphResult } from '../../services/pdfApi';
import type { WordAnalysisResult } from '../../services/wordAnalysisApi';
import { useReaderStore, FONT_FAMILIES, LINE_HEIGHTS } from '../../stores/readerStore';
import { useDocumentStore } from '../../stores/documentStore';
import { triggerScrollToAnalysis } from './StudyPanel';
import { splitSentences, tokenizeWords, wordAnalysisKey, sentenceAnalysisKey } from '../../utils/textTokens';
import { useAudioPlayerStore } from '../../stores/audioPlayerStore';
import { playFromParagraph, togglePlay } from '../../hooks/useParagraphAudioPlayer';
import { safeMarkdownComponents } from '../../utils/markdownComponents';

// ── Module-level callback: open focused analysis on mobile ──
let _onOpenFocusedAnalysis: ((type: 'word' | 'sentence', key: string) => void) | null = null;
export function setOnOpenFocusedAnalysis(
  cb: ((type: 'word' | 'sentence', key: string) => void) | null
) {
  _onOpenFocusedAnalysis = cb;
}

/** 打开单词/句子的解析卡片（桌面跳转面板，移动端弹聚焦面板） */
function openAnalysis(type: 'word' | 'sentence', key: string) {
  if (_onOpenFocusedAnalysis) {
    _onOpenFocusedAnalysis(type, key);
  } else {
    triggerScrollToAnalysis(key, type === 'word' ? 'words' : 'sentences');
  }
}

/**
 * 只在句子确实包含 Markdown 行内语法时才走 ReactMarkdown。
 * 绝大多数 OCR 句子是纯文本，直接渲染可省去每次句级 markdown 解析开销。
 */
const INLINE_MARKDOWN_RE = /(\*\*|\*|__|_|~~|`|\[[^\]]*\]\([^)]*\))/;
function hasInlineMarkdown(text: string): boolean {
  return INLINE_MARKDOWN_RE.test(text);
}

// tokenize 结果缓存：store 每次更新时 selector 会对每个句子重算，
// 缓存避免对同一文本反复分词（有界，防长会话内存增长）。
const _TOKEN_CACHE_MAX = 5000;
const _tokenCache = new Map<string, ReturnType<typeof tokenizeWords>>();

function cachedTokenizeWords(text: string): ReturnType<typeof tokenizeWords> {
  let tokens = _tokenCache.get(text);
  if (!tokens) {
    tokens = tokenizeWords(text);
    if (_tokenCache.size >= _TOKEN_CACHE_MAX) {
      const oldest = _tokenCache.keys().next().value;
      if (oldest !== undefined) _tokenCache.delete(oldest);
    }
    _tokenCache.set(text, tokens);
  }
  return tokens;
}

interface ParagraphBlockProps {
  paragraph: ParagraphResult;
  translation?: string;
  isTranslating?: boolean;
  isTouchDevice?: boolean;
}

/**
 * 把一段文本渲染成“纯 DOM span”的单词 token，而不是每个单词一个 React 组件。
 * 点击/长按统一由 SentenceToken 容器做事件委托，单词本身不再订阅任何 store。
 */
function renderWordTokens(
  text: string,
  paragraphIndex: number,
  sentenceIndex: number,
  activeWordIdx: number | null,
  selectedWords: Record<string, boolean>,
  wordAnalyses: Record<string, WordAnalysisResult>,
  syllabusWords?: Set<string> | null,
): React.ReactNode[] {
  let wordIdx = 0;
  return tokenizeWords(text).map((token, i) => {
    if (!token.stem) {
      return token.raw;
    }
    const currentIdx = wordIdx;
    wordIdx += 1;
    const key = wordAnalysisKey(paragraphIndex, token.stem);
    const isSelected = !!selectedWords[key];
    const hasAnalysis = !!wordAnalyses[key];
    const inSyllabus = !!syllabusWords && syllabusWords.has(token.stem.toLowerCase());
    const className = [
      'word-token',
      isSelected ? 'word-token-selected' : '',
      hasAnalysis && !isSelected ? 'word-token-has-analysis' : '',
      inSyllabus ? 'word-token-syllabus' : '',
      activeWordIdx !== null && activeWordIdx === currentIdx ? 'tts-current-word' : '',
    ].filter(Boolean).join(' ');
    return (
      <span
        key={i}
        className={className}
        data-word-key={key}
        data-word={token.stem}
      >
        {token.raw}
      </span>
    );
  });
}

/** 递归处理 ReactMarkdown 子节点，为其中文本注入单词 token（仅 Markdown 快路径之外使用）。 */
function processChildren(
  children: React.ReactNode,
  paragraphIndex: number,
  sentenceIndex: number,
  activeWordIdx: number | null,
  selectedWords: Record<string, boolean>,
  wordAnalyses: Record<string, WordAnalysisResult>,
  syllabusWords?: Set<string> | null,
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return renderWordTokens(child, paragraphIndex, sentenceIndex, activeWordIdx, selectedWords, wordAnalyses, syllabusWords);
    }
    if (React.isValidElement(child)) {
      const childProps = (child.props as any) || {};
      if (childProps.children) {
        return React.cloneElement(child, {
          ...childProps,
          children: processChildren(childProps.children, paragraphIndex, sentenceIndex, activeWordIdx, selectedWords, wordAnalyses, syllabusWords),
        } as any);
      }
    }
    return child;
  });
}

interface SentenceTokenProps {
  sentence: { text: string; index: number };
  paragraphIndex: number;
  isTouchDevice: boolean;
}

/**
 * 句级组件（非词级）：
 * - 只订阅"本句相关状态"的签名（primitive string）。任意词/句在其他段落
 *   发生变化时签名不变 → Zustand 跳过重渲染，消除"选一个词全文重 tokenize"；
 * - 渲染时从 store 读取当前快照，单词 span 是零 hook 的普通 DOM。
 */
const SentenceToken = memo(function SentenceToken({
  sentence,
  paragraphIndex,
  isTouchDevice,
}: SentenceTokenProps) {
  const sentenceKey = useMemo(
    () => sentenceAnalysisKey(paragraphIndex, sentence.index),
    [paragraphIndex, sentence.index]
  );

  // 签名：本句内每个词的选中/已解析/考纲命中状态 + 本句选中/已解析状态。
  const stateSignature = useDocumentStore((s) => {
    const tokens = cachedTokenizeWords(sentence.text);
    let selectedBits = '';
    let analyzedBits = '';
    let syllabusBits = '';
    for (const token of tokens) {
      if (!token.stem) continue;
      const key = wordAnalysisKey(paragraphIndex, token.stem);
      selectedBits += s.selectedWords[key] ? '1' : '0';
      analyzedBits += s.wordAnalyses[key] ? '1' : '0';
      syllabusBits += s.syllabusWords?.has(token.stem.toLowerCase()) ? '1' : '0';
    }
    const sentenceSelected = s.selectedSentences[sentenceKey] ? '1' : '0';
    const sentenceAnalyzed = s.sentenceAnalyses[sentenceKey] ? '1' : '0';
    return `${selectedBits}|${analyzedBits}|${syllabusBits}|${sentenceSelected}${sentenceAnalyzed}|v${s.syllabusVersion}`;
  });

  // 本句签名变化时才重渲染；渲染时读取当前 store 快照（非响应式读取）。
  const {
    selectedWords,
    wordAnalyses,
    selectedSentences,
    sentenceAnalyses,
    toggleWordSelection,
    toggleSentenceSelection,
    syllabusWords,
  } = useDocumentStore.getState();

  // 仅当本句是当前朗读句时才订阅（返回词序号），避免全文逐词/逐句随 timeupdate 重渲染
  const activeWordIdx = useAudioPlayerStore((s) =>
    s.highlight &&
    s.highlight.paraIdx === paragraphIndex &&
    s.highlight.sentIdx === sentence.index
      ? s.highlight.wordIdx
      : null
  );

  const isSelected = !!selectedSentences[sentenceKey];
  const hasAnalysis = !!sentenceAnalyses[sentenceKey];
  const isTtsActive = activeWordIdx !== null;

  const sentenceRef = useRef<HTMLSpanElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const longPressEl = useRef<HTMLElement | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (longPressEl.current) {
      longPressEl.current.classList.remove('long-press-active');
      longPressEl.current = null;
    }
  }, []);

  // ── 长按（移动端）：单词或句子本身都触发整句选择/打开句子解析 ──
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLSpanElement>) => {
    if (!isTouchDevice) return;
    const wordEl = (e.target as HTMLElement).closest('.word-token') as HTMLElement | null;
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      const el = wordEl ?? sentenceRef.current;
      if (el) {
        el.classList.add('long-press-active');
        longPressEl.current = el;
        setTimeout(() => el.classList.remove('long-press-active'), 600);
      }
      try { navigator.vibrate?.(10); } catch { /* noop */ }
      if (hasAnalysis) {
        openAnalysis('sentence', sentenceKey);
      } else {
        toggleSentenceSelection(paragraphIndex, sentence.index, sentence.text);
      }
    }, 300);
  }, [isTouchDevice, hasAnalysis, sentenceKey, paragraphIndex, sentence.index, sentence.text, toggleSentenceSelection]);

  const handleTouchEnd = useCallback(() => clearLongPress(), [clearLongPress]);
  const handleTouchMove = useCallback(() => clearLongPress(), [clearLongPress]);

  // ── 事件委托：点单词 → 选词/打开解析；点句子空白 → 选句/打开解析 ──
  const handleTextClick = useCallback((e: React.MouseEvent<HTMLSpanElement>) => {
    const wordEl = (e.target as HTMLElement).closest('.word-token') as HTMLElement | null;
    if (wordEl) {
      // 长按刚触发过的 click 直接吞掉，不再重复选词
      if (longPressFired.current) {
        longPressFired.current = false;
        return;
      }
      const word = wordEl.dataset.word ?? '';
      const key = wordEl.dataset.wordKey ?? '';
      if (key && wordAnalyses[key]) {
        openAnalysis('word', key);
      } else if (word) {
        toggleWordSelection(paragraphIndex, word);
      }
      return;
    }

    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    if (hasAnalysis) {
      openAnalysis('sentence', sentenceKey);
    } else {
      toggleSentenceSelection(paragraphIndex, sentence.index, sentence.text);
    }
  }, [wordAnalyses, hasAnalysis, sentenceKey, paragraphIndex, sentence.index, sentence.text, toggleWordSelection, toggleSentenceSelection]);

  const needsMarkdown = useMemo(() => hasInlineMarkdown(sentence.text), [sentence.text]);

  // 纯文本句子：直接生成单词 span（复用上次结果，避免每次渲染重复 tokenize）
  const plainContent = useMemo(() => {
    if (needsMarkdown) return null;
    return renderWordTokens(
      sentence.text,
      paragraphIndex,
      sentence.index,
      activeWordIdx,
      selectedWords,
      wordAnalyses,
      syllabusWords
    );
  }, [needsMarkdown, sentence.text, paragraphIndex, sentence.index, activeWordIdx, stateSignature]);

  const components = useMemo(
    () => ({
      ...safeMarkdownComponents,
      p: ({ children, ...props }: any) => (
        <span {...props}>
          {processChildren(children, paragraphIndex, sentence.index, activeWordIdx, selectedWords, wordAnalyses, syllabusWords)}
        </span>
      ),
    }),
    [paragraphIndex, sentence.index, activeWordIdx, stateSignature]
  );

  const sentenceClassName = [
    'sentence-token',
    isSelected ? 'sentence-token-selected' : '',
    hasAnalysis && !isSelected ? 'sentence-token-has-analysis' : '',
    isTtsActive ? 'tts-current-sentence' : '',
  ].filter(Boolean).join(' ');

  return (
    <span
      ref={sentenceRef}
      className={sentenceClassName}
      onClick={handleTextClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      data-paragraph-index={paragraphIndex}
      data-sentence-index={sentence.index}
    >
      {needsMarkdown ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {sentence.text}
        </ReactMarkdown>
      ) : (
        plainContent
      )}
    </span>
  );
});

/**
 * 段落级 memo：翻译流式更新只让“译文真正变化”的段落重渲染，
 * 其余段落在 reconciliation 阶段被跳过。
 */
const ParagraphBlock = memo(function ParagraphBlock({
  paragraph,
  translation,
  isTranslating,
  isTouchDevice = false,
}: ParagraphBlockProps) {
  // 分别订阅三个排版字段，避免 readerStore 任一字段变化导致全文重渲染
  const fontSize = useReaderStore((s) => s.fontSize);
  const fontFamily = useReaderStore((s) => s.fontFamily);
  const lineHeight = useReaderStore((s) => s.lineHeight);
  const [showTranslation, setShowTranslation] = useState(false);

  // 仅本段处于播放/暂停时返回其状态，其余段落签名恒为 'idle' → 不随播放进度重渲染
  const playState = useAudioPlayerStore((s) =>
    s.activeParagraph === paragraph.index ? s.status : 'idle'
  );

  const handlePlayClick = useCallback(() => {
    if (playState === 'playing' || playState === 'paused') {
      togglePlay();
    } else {
      void playFromParagraph(paragraph.index);
    }
  }, [playState, paragraph.index]);

  const fontFamilyValue = FONT_FAMILIES.find(f => f.key === fontFamily)?.value ?? FONT_FAMILIES[0].value;
  const lineHeightValue = LINE_HEIGHTS.find(l => l.key === lineHeight)?.value ?? LINE_HEIGHTS[0].value;

  const sentences = useMemo(() => splitSentences(paragraph.text), [paragraph.text]);

  return (
    <div
      className="paragraph-block prose max-w-none"
      style={{ fontSize: `${fontSize}px`, fontFamily: fontFamilyValue, lineHeight: lineHeightValue }}
      data-paragraph-index={paragraph.index}
    >
      {/* Sentence-level rendering + 段尾展开翻译图标按钮 */}
      <p className={`text-ink !mb-0${paragraph.index === 0 ? ' paragraph-dropcap' : ' paragraph-indent'}`}>
        {sentences.map((sentence) => (
          <SentenceToken
            key={sentence.index}
            sentence={sentence}
            paragraphIndex={paragraph.index}
            isTouchDevice={isTouchDevice}
          />
        ))}{translation && (
          <button
            type="button"
            onClick={() => setShowTranslation(!showTranslation)}
            className="translate-toggle-btn"
            title={showTranslation ? '收起翻译' : '展开翻译'}
            aria-label={showTranslation ? '收起翻译' : '展开翻译'}
            aria-expanded={showTranslation}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" />
            </svg>
          </button>
        )}{(
          <button
            type="button"
            onClick={handlePlayClick}
            className={`paragraph-play-btn${playState === 'playing' ? ' paragraph-play-btn-active' : ''}`}
            title={playState === 'playing' ? '暂停朗读' : playState === 'paused' ? '继续朗读' : '从本段开始朗读'}
            aria-label={playState === 'playing' ? '暂停朗读' : playState === 'paused' ? '继续朗读' : '从本段开始朗读'}
          >
            {playState === 'playing' ? (
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        )}
      </p>

      {/* Translation section */}
      {showTranslation && translation && (
        <div className="not-prose mt-2" style={{ fontSize: `${Math.max(fontSize - 4, 12)}px` }}>
          <div className="p-3.5 bg-surface-card rounded-md text-body border-l-[3px] border-primary shadow-soft">
            <span className="font-chinese leading-relaxed">{translation}</span>
          </div>
        </div>
      )}
      {!translation && isTranslating ? (
        <div className="mt-1 not-prose text-xs text-muted-soft font-sans">
          <span className="inline-flex items-center gap-1">
            <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
              <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" opacity="0.75" />
            </svg>
            翻译中...
          </span>
        </div>
      ) : null}
    </div>
  );
});

export default ParagraphBlock;
