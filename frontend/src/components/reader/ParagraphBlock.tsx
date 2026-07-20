import React, { useState, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Typography } from 'antd';
import { EyeOutlined, EyeInvisibleOutlined, LoadingOutlined } from '@ant-design/icons';
import type { ParagraphResult } from '../../services/pdfApi';
import { useReaderStore } from '../../stores/readerStore';
import { useDocumentStore } from '../../stores/documentStore';

const { Text } = Typography;

interface ParagraphBlockProps {
  paragraph: ParagraphResult;
  translation?: string;
  isTranslating?: boolean;
}

/** Split text into sentences, preserving leading whitespace. */
function splitSentences(text: string): { text: string; index: number }[] {
  // Split on .!? followed by whitespace + capital letter / quote
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z"'])/g);
  return parts
    .map((s, i) => ({ text: s.trim(), index: i }))
    .filter(s => s.text.length > 0);
}

/** A single clickable word token with selection & analysis state. */
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
      toggleWordSelection(paragraphIndex, word.toLowerCase());
    },
    [paragraphIndex, word, toggleWordSelection]
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

/** Render a plain text string with clickable word tokens. */
function renderTokenizedText(text: string, paragraphIndex: number): React.ReactNode {
  const parts = text.split(/(\s+)/g);
  return parts.map((part, i) => {
    if (/^\s+$/.test(part)) return part;
    if (/[a-zA-Z]/.test(part)) {
      const word = part.replace(/[^a-zA-Z'-]/g, '');
      if (word.length > 0) {
        return (
          <WordToken key={i} text={part} word={word} paragraphIndex={paragraphIndex} />
        );
      }
    }
    return part;
  });
}

/** Recursively process React children, replacing text nodes with clickable word tokens. */
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

/** A single clickable sentence with selection & analysis state. */
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
      toggleSentenceSelection(paragraphIndex, sentence.index, sentence.text);
    },
    [paragraphIndex, sentence, toggleSentenceSelection]
  );

  // Word-token-enabled markdown components for this sentence
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
      className={`sentence-selectable ${isSelected ? 'sentence-selected' : ''} ${hasAnalysis && !isSelected ? 'sentence-has-analysis' : ''}`}
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
  const { fontSize } = useReaderStore();
  const [showTranslation, setShowTranslation] = useState(false);

  // Split the paragraph into sentences for sentence-level selection
  const sentences = useMemo(() => splitSentences(paragraph.text), [paragraph.text]);

  return (
    <div
      className="paragraph-block prose max-w-none text-gray-900 font-serif [&_p]:mb-0"
      style={{ fontSize: `${fontSize}px` }}
      data-paragraph-index={paragraph.index}
    >
      {/* Sentence-level rendering with clickable sentences */}
      <p>
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
        <div className="not-prose" style={{ fontSize: `${fontSize - 4}px`, marginTop: 4 }}>
          <span
            onClick={() => setShowTranslation(!showTranslation)}
            className="inline-flex items-center gap-1 cursor-pointer select-none"
            style={{ color: '#9ca3af' }}
          >
            {showTranslation ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            {showTranslation ? '隐藏翻译' : '查看翻译'}
          </span>
          {showTranslation && (
            <div className="mt-1 p-3 bg-blue-50 rounded-md text-gray-600 border-l-2 border-blue-300">
              {translation}
            </div>
          )}
        </div>
      ) : isTranslating ? (
        <div className="mt-1 not-prose">
          <Text type="secondary" className="text-xs">
            <LoadingOutlined className="mr-1" />
            翻译中...
          </Text>
        </div>
      ) : null}
    </div>
  );
}
