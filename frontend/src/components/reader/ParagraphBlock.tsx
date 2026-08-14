import React, { useState, useCallback, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ParagraphResult } from '../../services/pdfApi';
import { useReaderStore, FONT_FAMILIES, LINE_HEIGHTS } from '../../stores/readerStore';
import { useDocumentStore } from '../../stores/documentStore';
import { triggerScrollToAnalysis } from './StudyPanel';
import { splitSentences, tokenizeWords, wordAnalysisKey, sentenceAnalysisKey } from '../../utils/textTokens';
import { useAudioPlayerStore } from '../../stores/audioPlayerStore';
import { playFromSentence } from '../../hooks/useParagraphAudioPlayer';
import { safeMarkdownComponents } from '../../utils/markdownComponents';

// ── Module-level callback: open focused analysis on mobile ──
let _onOpenFocusedAnalysis: ((type: 'word' | 'sentence', key: string) => void) | null = null;
export function setOnOpenFocusedAnalysis(
  cb: ((type: 'word' | 'sentence', key: string) => void) | null
) {
  _onOpenFocusedAnalysis = cb;
}

interface ParagraphBlockProps {
  paragraph: ParagraphResult;
  translation?: string;
  isTranslating?: boolean;
  isTouchDevice?: boolean;
}

/** A clickable word token. On mobile, long-press selects the parent sentence. */
function WordToken({
  text,
  word,
  paragraphIndex,
  sentenceIndex,
  sentenceText,
  wordIdx,
  isTtsActive,
  isTouchDevice,
}: {
  text: string;
  word: string;
  paragraphIndex: number;
  sentenceIndex: number;
  sentenceText: string;
  /** 句内词干序号（供朗读高亮定位） */
  wordIdx: number;
  /** 朗读卡拉OK高亮中（由父级按 activeWordIdx 计算，避免逐词订阅 store） */
  isTtsActive: boolean;
  isTouchDevice: boolean;
}) {
  const {
    selectedWords,
    wordAnalyses,
    sentenceAnalyses,
    toggleWordSelection,
    toggleSentenceSelection,
  } = useDocumentStore();
  const key = wordAnalysisKey(paragraphIndex, word);
  const isSelected = !!selectedWords[key];
  const hasAnalysis = !!wordAnalyses[key];
  const sentenceKey = sentenceAnalysisKey(paragraphIndex, sentenceIndex);
  const sentenceHasAnalysis = !!sentenceAnalyses[sentenceKey];

  // ── Long press → select sentence or open analysis (mobile only) ──
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>();
  const longPressFired = useRef(false);
  const [longPressActive, setLongPressActive] = useState(false);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = undefined;
    }
    setLongPressActive(false);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isTouchDevice) return;
    e.stopPropagation(); // prevent SentenceToken from also starting its timer
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setLongPressActive(true);
      try { navigator.vibrate?.(10); } catch { /* noop */ }
      if (sentenceHasAnalysis) {
        if (_onOpenFocusedAnalysis) {
          _onOpenFocusedAnalysis('sentence', sentenceKey);
        } else {
          triggerScrollToAnalysis(sentenceKey, 'sentences');
        }
      } else {
        toggleSentenceSelection(paragraphIndex, sentenceIndex, sentenceText);
      }
      // Reset visual after animation
      setTimeout(() => setLongPressActive(false), 600);
    }, 300);
  }, [isTouchDevice, paragraphIndex, sentenceIndex, sentenceText, sentenceKey, sentenceHasAnalysis, toggleSentenceSelection]);

  const handleTouchEnd = useCallback(() => {
    clearLongPress();
  }, [clearLongPress]);

  const handleTouchMove = useCallback(() => {
    clearLongPress();
  }, [clearLongPress]);

  // ── Click → select word ──
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // If long press just fired, skip the click (don't select word)
      if (longPressFired.current) {
        longPressFired.current = false;
        return;
      }
      if (hasAnalysis) {
        if (_onOpenFocusedAnalysis) {
          _onOpenFocusedAnalysis('word', key);
        } else {
          triggerScrollToAnalysis(key, 'words');
        }
      } else {
        toggleWordSelection(paragraphIndex, word.toLowerCase());
      }
    },
    [paragraphIndex, word, toggleWordSelection, hasAnalysis, key]
  );

  return (
    <span
      className={[
        'word-token',
        isSelected ? 'word-token-selected' : '',
        hasAnalysis && !isSelected ? 'word-token-has-analysis' : '',
        isTtsActive ? 'tts-current-word' : '',
        longPressActive ? 'long-press-active' : '',
      ].join(' ')}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
    >
      {text}
    </span>
  );
}

/** Render plain text with clickable word tokens. */
function renderTokenizedText(
  text: string,
  paragraphIndex: number,
  sentenceIndex: number,
  sentenceText: string,
  activeWordIdx: number | null,
  isTouchDevice: boolean,
): React.ReactNode {
  let wordIdx = 0;
  return tokenizeWords(text).map((token, i) => {
    if (token.stem) {
      const currentIdx = wordIdx;
      wordIdx += 1;
      return (
        <WordToken
          key={i}
          text={token.raw}
          word={token.stem}
          paragraphIndex={paragraphIndex}
          sentenceIndex={sentenceIndex}
          sentenceText={sentenceText}
          wordIdx={currentIdx}
          isTtsActive={activeWordIdx !== null && activeWordIdx >= 0 && activeWordIdx === currentIdx}
          isTouchDevice={isTouchDevice}
        />
      );
    }
    return token.raw;
  });
}

/** Recursively process React children for word tokens. */
function processChildren(
  children: React.ReactNode,
  paragraphIndex: number,
  sentenceIndex: number,
  sentenceText: string,
  activeWordIdx: number | null,
  isTouchDevice: boolean,
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return renderTokenizedText(child, paragraphIndex, sentenceIndex, sentenceText, activeWordIdx, isTouchDevice);
    }
    if (React.isValidElement(child)) {
      const childProps = (child.props as any) || {};
      if (childProps.children) {
        return React.cloneElement(child, {
          ...childProps,
          children: processChildren(childProps.children, paragraphIndex, sentenceIndex, sentenceText, activeWordIdx, isTouchDevice),
        } as any);
      }
    }
    return child;
  });
}

/** A clickable sentence with selection/analysis states. */
function SentenceToken({
  sentence,
  paragraphIndex,
  isTouchDevice,
}: {
  sentence: { text: string; index: number };
  paragraphIndex: number;
  isTouchDevice: boolean;
}) {
  const {
    selectedSentences,
    sentenceAnalyses,
    toggleSentenceSelection,
  } = useDocumentStore();
  // 仅当本句是当前朗读句时才订阅（返回词序号），避免全文逐词/逐句随 timeupdate 重渲染
  const activeWordIdx = useAudioPlayerStore((s) =>
    s.highlight &&
    s.highlight.paraIdx === paragraphIndex &&
    s.highlight.sentIdx === sentence.index
      ? s.highlight.wordIdx
      : null
  );
  const key = sentenceAnalysisKey(paragraphIndex, sentence.index);
  const isSelected = !!selectedSentences[key];
  const hasAnalysis = !!sentenceAnalyses[key];
  const isTtsActive = activeWordIdx !== null;

  // ── Long press detection (mobile: reliable fallback for inline spans) ──
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>();
  const longPressFired = useRef(false);
  const [longPressActive, setLongPressActive] = useState(false);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = undefined;
    }
    setLongPressActive(false);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isTouchDevice) return;
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setLongPressActive(true);
      try { navigator.vibrate?.(10); } catch { /* noop */ }
      if (hasAnalysis) {
        if (_onOpenFocusedAnalysis) {
          _onOpenFocusedAnalysis('sentence', key);
        } else {
          triggerScrollToAnalysis(key, 'sentences');
        }
      } else {
        toggleSentenceSelection(paragraphIndex, sentence.index, sentence.text);
      }
      setTimeout(() => setLongPressActive(false), 600);
    }, 300);
  }, [isTouchDevice, hasAnalysis, key, paragraphIndex, sentence, toggleSentenceSelection]);

  const handleTouchEnd = useCallback(() => clearLongPress(), [clearLongPress]);
  const handleTouchMove = useCallback(() => clearLongPress(), [clearLongPress]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // If long press just fired, skip click
      if (longPressFired.current) {
        longPressFired.current = false;
        return;
      }
      if (hasAnalysis) {
        if (_onOpenFocusedAnalysis) {
          _onOpenFocusedAnalysis('sentence', key);
        } else {
          triggerScrollToAnalysis(key, 'sentences');
        }
      } else {
        toggleSentenceSelection(paragraphIndex, sentence.index, sentence.text);
      }
    },
    [paragraphIndex, sentence, toggleSentenceSelection, hasAnalysis, key]
  );

  const components = useMemo(
    () => ({
      ...safeMarkdownComponents,
      p: ({ children, ...props }: any) => (
        <span {...props}>
          {processChildren(children, paragraphIndex, sentence.index, sentence.text, activeWordIdx, isTouchDevice)}
        </span>
      ),
    }),
    [paragraphIndex, sentence.index, sentence.text, activeWordIdx, isTouchDevice]
  );

  return (
    <span
      className={`sentence-token ${isSelected ? 'sentence-token-selected' : ''} ${hasAnalysis && !isSelected ? 'sentence-token-has-analysis' : ''} ${isTtsActive ? 'tts-current-sentence' : ''} ${longPressActive ? 'long-press-active' : ''}`}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      data-paragraph-index={paragraphIndex}
      data-sentence-index={sentence.index}
    >
      <button
        type="button"
        className="sentence-play-btn"
        title="从这句开始朗读"
        aria-label="从这句开始朗读"
        onClick={(e) => {
          e.stopPropagation();
          void playFromSentence(paragraphIndex, sentence.index);
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {sentence.text}
      </ReactMarkdown>
    </span>
  );
}

export default function ParagraphBlock({
  paragraph,
  translation,
  isTranslating,
  isTouchDevice = false,
}: ParagraphBlockProps) {
  const { fontSize, fontFamily, lineHeight } = useReaderStore();
  const [showTranslation, setShowTranslation] = useState(false);

  const fontFamilyValue = FONT_FAMILIES.find(f => f.key === fontFamily)?.value ?? FONT_FAMILIES[0].value;
  const lineHeightValue = LINE_HEIGHTS.find(l => l.key === lineHeight)?.value ?? LINE_HEIGHTS[0].value;

  const sentences = useMemo(() => splitSentences(paragraph.text), [paragraph.text]);

  return (
    <div
      className="paragraph-block prose max-w-none"
      style={{ fontSize: `${fontSize}px`, fontFamily: fontFamilyValue, lineHeight: lineHeightValue }}
      data-paragraph-index={paragraph.index}
    >
      {/* Sentence-level rendering */}
      <p className="text-ink !mb-0">
        {sentences.map((sentence) => (
          <SentenceToken
            key={sentence.index}
            sentence={sentence}
            paragraphIndex={paragraph.index}
            isTouchDevice={isTouchDevice}
          />
        ))}{' '}
      </p>

      {/* Translation section */}
      {translation ? (
        <div className="not-prose mt-1" style={{ fontSize: `${Math.max(fontSize - 4, 12)}px` }}>
          <button
            onClick={() => setShowTranslation(!showTranslation)}
            className="inline-flex items-center gap-1.5 cursor-pointer select-none text-primary/80 hover:text-primary transition-colors text-xs font-sans"
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
              className={showTranslation ? '' : 'opacity-60'}
            >
              {showTranslation ? (
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M14.12 14.12a3 3 0 11-4.24-4.24" />
              ) : (
                <>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </>
              )}
            </svg>
            {showTranslation ? '隐藏翻译' : '查看翻译'}
          </button>
          {showTranslation && (
            <div className="mt-2 p-3.5 bg-surface-card rounded-md text-body border-l-[3px] border-primary shadow-soft">
              <span className="font-chinese leading-relaxed">{translation}</span>
            </div>
          )}
        </div>
      ) : isTranslating ? (
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
}
