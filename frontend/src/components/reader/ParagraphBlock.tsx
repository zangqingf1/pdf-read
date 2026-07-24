import React, { useState, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ParagraphResult } from '../../services/pdfApi';
import { useReaderStore, FONT_FAMILIES, LINE_HEIGHTS } from '../../stores/readerStore';
import { useDocumentStore } from '../../stores/documentStore';
import { triggerScrollToAnalysis } from './StudyPanel';

interface ParagraphBlockProps {
  paragraph: ParagraphResult;
  translation?: string;
  isTranslating?: boolean;
}

/** Split text into sentences. */
function splitSentences(text: string): { text: string; index: number }[] {
  const parts = text.split(/(?<=[.!?]["']?)\s+(?=[A-Z"'])/g);
  return parts
    .map((s, i) => ({ text: s.trim(), index: i }))
    .filter((s) => s.text.length > 0);
}

/** A clickable word token. */
function WordToken({
  text,
  word,
  paragraphIndex,
}: {
  text: string;
  word: string;
  paragraphIndex: number;
}) {
  const { selectedWords, wordAnalyses, toggleWordSelection } = useDocumentStore();
  const key = `${paragraphIndex}:${word.toLowerCase()}`;
  const isSelected = !!selectedWords[key];
  const hasAnalysis = !!wordAnalyses[key];

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (hasAnalysis) {
        triggerScrollToAnalysis(key, 'words');
      } else {
        toggleWordSelection(paragraphIndex, word.toLowerCase());
      }
    },
    [paragraphIndex, word, toggleWordSelection, hasAnalysis, key]
  );

  return (
    <span
      className={`word-token ${isSelected ? 'word-token-selected' : ''} ${hasAnalysis && !isSelected ? 'word-token-has-analysis' : ''}`}
      onClick={handleClick}
    >
      {text}
    </span>
  );
}

/** Render plain text with clickable word tokens. */
function renderTokenizedText(text: string, paragraphIndex: number): React.ReactNode {
  const parts = text.split(/(\s+)/g);
  return parts.map((part, i) => {
    if (/^\s+$/.test(part)) return part;
    if (/[a-zA-Z]/.test(part)) {
      const word = part.replace(/[^a-zA-Z'-]/g, '');
      if (word.length > 0) {
        return <WordToken key={i} text={part} word={word} paragraphIndex={paragraphIndex} />;
      }
    }
    return part;
  });
}

/** Recursively process React children for word tokens. */
function processChildren(children: React.ReactNode, paragraphIndex: number): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return renderTokenizedText(child, paragraphIndex);
    }
    if (React.isValidElement(child)) {
      const childProps = (child.props as any) || {};
      if (childProps.children) {
        return React.cloneElement(child, {
          ...childProps,
          children: processChildren(childProps.children, paragraphIndex),
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
}: {
  sentence: { text: string; index: number };
  paragraphIndex: number;
}) {
  const {
    selectedSentences,
    sentenceAnalyses,
    toggleSentenceSelection,
  } = useDocumentStore();
  const key = `${paragraphIndex}:${sentence.index}`;
  const isSelected = !!selectedSentences[key];
  const hasAnalysis = !!sentenceAnalyses[key];

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (hasAnalysis) {
        triggerScrollToAnalysis(key, 'sentences');
      } else {
        toggleSentenceSelection(paragraphIndex, sentence.index, sentence.text);
      }
    },
    [paragraphIndex, sentence, toggleSentenceSelection, hasAnalysis, key]
  );

  const components = useMemo(
    () => ({
      p: ({ children, ...props }: any) => (
        <span {...props}>{processChildren(children, paragraphIndex)}</span>
      ),
    }),
    [paragraphIndex]
  );

  return (
    <span
      className={`sentence-token ${isSelected ? 'sentence-token-selected' : ''} ${hasAnalysis && !isSelected ? 'sentence-token-has-analysis' : ''}`}
      onClick={handleClick}
      data-paragraph-index={paragraphIndex}
      data-sentence-index={sentence.index}
    >
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
          />
        ))}{' '}
      </p>

      {/* Translation section */}
      {translation ? (
        <div className="not-prose mt-1" style={{ fontSize: `${Math.max(fontSize - 4, 12)}px` }}>
          <button
            onClick={() => setShowTranslation(!showTranslation)}
            className="inline-flex items-center gap-1.5 cursor-pointer select-none text-muted hover:text-ink transition-colors text-xs font-sans"
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
            <div className="mt-2 p-3.5 bg-surface-card rounded-md text-body border-l-2 border-primary">
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
