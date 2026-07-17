import { useCallback, useMemo, useState } from 'react';
import { Typography, Button } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import type { ParagraphResult } from '../../services/pdfApi';
import { useReaderStore, normalizeWord } from '../../stores/readerStore';

const { Text } = Typography;

interface ParagraphBlockProps {
  paragraph: ParagraphResult;
  translation?: string;
}

/** Split text into sentences, keeping delimiters attached. */
function splitSentences(text: string): { text: string; startPos: number }[] {
  const result: { text: string; startPos: number }[] = [];
  // Match: everything up to a sentence-ending punctuation + optional quotes + trailing whitespace
  const re = /[^.!?\n]+(?:[.!?]+["'»”)]*\s*)/g;
  let m: RegExpExecArray | null;
  let lastEnd = 0;

  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    // Capture any leading whitespace/gap between this sentence and the last
    result.push({ text: m[0], startPos: start });
    lastEnd = re.lastIndex;
  }

  // Any remaining text after the last match (fragment without ending punctuation)
  if (lastEnd < text.length) {
    const remaining = text.slice(lastEnd).trim();
    if (remaining.length >= 5) {
      result.push({ text: remaining, startPos: lastEnd });
    }
  }

  // If no sentences found, return the whole text as one
  if (result.length === 0 && text.trim().length > 0) {
    result.push({ text: text.trim(), startPos: 0 });
  }

  return result;
}

/** Tokenize a string into word and non-word segments with character positions. */
function tokenize(text: string): { text: string; isWord: boolean; charPos: number }[] {
  const tokens: { text: string; isWord: boolean; charPos: number }[] = [];
  const re = /([a-zA-Z0-9À-ɏ'’‘’\-]+)|([^a-zA-Z0-9À-ɏ'’‘’\-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) {
      tokens.push({ text: m[1], isWord: true, charPos: m.index });
    } else if (m[2] !== undefined) {
      tokens.push({ text: m[2], isWord: false, charPos: m.index });
    }
  }
  if (tokens.length === 0 && text.length > 0) {
    tokens.push({ text, isWord: false, charPos: 0 });
  }
  return tokens;
}

export default function ParagraphBlock({ paragraph, translation }: ParagraphBlockProps) {
  const [transExpanded, setTransExpanded] = useState(false);
  const {
    selectedKeys,
    toggleWord,
    selectedSentenceSpans,
    toggleSentenceSpan,
  } = useReaderStore();
  const paraIndex = paragraph.index;

  const sentences = useMemo(
    () => splitSentences(paragraph.text),
    [paragraph.text]
  );

  const handleWordClick = useCallback(
    (e: React.MouseEvent, rawWord: string, charPos: number) => {
      e.stopPropagation();
      toggleWord(rawWord, paragraph.text, { paraIndex, charPos });
    },
    [paragraph.text, paraIndex, toggleWord]
  );

  const handleSentenceClick = useCallback(
    (sentText: string, sentIndex: number) => {
      const spanKey = `sent-${paraIndex}-${sentIndex}`;
      toggleSentenceSpan(spanKey, sentText.trim(), paraIndex, paragraph.text);
    },
    [paraIndex, paragraph.text, toggleSentenceSpan]
  );

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const spansSet = useMemo(() => new Set(selectedSentenceSpans), [selectedSentenceSpans]);

  return (
    <div className="paragraph-block" data-para-index={paragraph.index}>
      <Text className="text-lg leading-8 text-gray-900 font-serif paragraph-text">
        {sentences.map((sent, si) => {
          const spanKey = `sent-${paraIndex}-${si}`;
          const isSentSelected = spansSet.has(spanKey);
          const tokens = tokenize(sent.text);

          return (
            <span
              key={si}
              onClick={() => handleSentenceClick(sent.text, si)}
              className={`sentence-span cursor-pointer transition-all duration-150 rounded-sm
                ${isSentSelected
                  ? 'border-b-2 border-dashed border-blue-500 bg-blue-50/50 pb-0.5'
                  : 'border-b-2 border-transparent hover:bg-gray-50 hover:border-gray-300 pb-0.5'
                }`}
              title="点击选中/取消整句（可选择多句）"
            >
              {tokens.map((tok, ti) => {
                const tokenKey = `${si}-${ti}`;
                if (!tok.isWord) {
                  return (
                    <span key={tokenKey}>{tok.text}</span>
                  );
                }

                const wordKey = normalizeWord(tok.text);
                const isWordSelected = selectedSet.has(wordKey);

                return (
                  <span
                    key={tokenKey}
                    onClick={(e) => handleWordClick(e, tok.text, tok.charPos)}
                    className={`cursor-pointer transition-colors px-0.5 rounded ${
                      isWordSelected
                        ? 'bg-yellow-300 outline outline-2 outline-yellow-400'
                        : 'hover:bg-gray-100'
                    }`}
                    title="点击选中/取消单词"
                  >
                    {tok.text}
                  </span>
                );
              })}
            </span>
          );
        })}
      </Text>

      {translation && (
        <div className="mt-1">
          <Button
            type="text"
            size="small"
            icon={transExpanded ? <DownOutlined /> : <RightOutlined />}
            onClick={() => setTransExpanded(!transExpanded)}
            className="!text-gray-400 !text-xs !px-1 !py-0 hover:!text-blue-500"
          >
            {transExpanded ? '收起翻译' : '展开翻译'}
          </Button>
          {transExpanded && (
            <div className="mt-1 pl-4 border-l-2 border-blue-400">
              <Text className="text-base text-gray-500 leading-7">
                {translation}
              </Text>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
