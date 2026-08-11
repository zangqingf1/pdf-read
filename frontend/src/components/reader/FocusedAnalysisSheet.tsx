import { useState, useCallback, useEffect, isValidElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDocumentStore } from '../../stores/documentStore';
import { useReaderStore } from '../../stores/readerStore';
import { deleteWordAnalysis, type WordAnalysisResult } from '../../services/wordAnalysisApi';
import { deleteSentenceAnalysis, type SentenceAnalysisResult } from '../../services/sentenceAnalysisApi';
import PhoneticWithSpeakers from './PhoneticWithSpeakers';
import { prefetchSpeak } from '../../utils/speak';

interface FocusedAnalysisSheetProps {
  type: 'word' | 'sentence';
  analysisKey: string;
  onClose: () => void;
}

// ── Focused Word Card ──────────────────────────────────────────────

function FocusedWordCard({
  analysis,
  analysisKey,
}: {
  analysis: WordAnalysisResult;
  analysisKey: string;
}) {
  const { removeWordAnalysis } = useDocumentStore();
  const [showDefZh, setShowDefZh] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      if (analysis.id) await deleteWordAnalysis(analysis.id);
      removeWordAnalysis(analysis.paragraph_index, analysis.word);
    } catch { /* keep card on error */ }
    finally { setDeleting(false); setConfirming(false); }
  }, [analysis, removeWordAnalysis]);

  return (
    <div className="bg-surface-card border border-hairline rounded-lg p-4">
      {/* Header: word + phonetic + delete */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-bold text-ink text-lg font-reading">{analysis.word}</span>
          <PhoneticWithSpeakers word={analysis.word} phonetic={analysis.phonetic} size="md" />
        </div>
        {confirming ? (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              className="px-2 py-0.5 text-xs font-medium text-error hover:bg-error/10 rounded touch-area"
              onClick={handleDelete}
              disabled={deleting}
            >删除</button>
            <button
              className="px-2 py-0.5 text-xs text-muted hover:bg-surface-card rounded touch-area"
              onClick={() => setConfirming(false)}
            >取消</button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="w-8 h-8 flex items-center justify-center rounded-md text-muted-soft hover:text-error hover:bg-error/5 transition-colors flex-shrink-0 touch-area"
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
        <div className="mb-3">
          <div className="flex items-center justify-between text-muted mb-0.5 text-[0.75em]">
            <span>释义</span>
            {analysis.definition_zh && (
              <button
                onClick={() => setShowDefZh(!showDefZh)}
                className="text-muted-soft hover:text-muted select-none text-xs touch-area"
              >
                {showDefZh ? '隐藏中文' : '展开中文'}
              </button>
            )}
          </div>
          <p className="text-body-strong m-0 text-base font-reading">
            {analysis.part_of_speech && (
              <span className="italic text-muted mr-1 text-sm">{analysis.part_of_speech}</span>
            )}
            {analysis.definition}
          </p>
          {showDefZh && analysis.definition_zh && (
            <p className="mt-1 text-muted leading-relaxed m-0 font-chinese text-[0.75em]">
              {analysis.definition_zh}
            </p>
          )}
        </div>
      )}

      {/* Base/Plural forms */}
      {(analysis.base_form || analysis.plural_form) && (
        <div className="mb-2 flex items-center gap-3 text-muted text-[0.75em]">
          {analysis.base_form && <span>原形：<strong className="text-body-strong">{analysis.base_form}</strong></span>}
          {analysis.plural_form && <span>复数：<strong className="text-body-strong">{analysis.plural_form}</strong></span>}
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
              <span key={i} className="inline-flex items-center gap-1 bg-[#f5f0e8] rounded px-2 py-0.5 text-xs">
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
        <div className="pt-2 border-t border-hairline">
          <span className="text-muted text-[0.75em] block mb-1">例句</span>
          <p className="text-body leading-relaxed italic text-sm m-0 font-reading">
            {analysis.example_sentence}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Focused Sentence Card ──────────────────────────────────────────

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

function FocusedSentenceCard({
  analysis,
}: {
  analysis: SentenceAnalysisResult;
  analysisKey: string;
}) {
  const { removeSentenceAnalysis } = useDocumentStore();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      if (analysis.id) await deleteSentenceAnalysis(analysis.id);
      removeSentenceAnalysis(analysis.paragraph_index, analysis.sentence_index);
    } catch { /* keep card on error */ }
    finally { setDeleting(false); setConfirming(false); }
  }, [analysis, removeSentenceAnalysis]);

  return (
    <div className="bg-surface-card border border-hairline rounded-lg p-4">
      {/* Header: sentence text + delete */}
      <div className="flex items-start justify-between mb-3">
        <span className="font-semibold text-ink leading-snug text-base line-clamp-3 font-reading">
          {analysis.sentence_text}
        </span>
        {confirming ? (
          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
            <button
              className="px-2 py-0.5 text-xs font-medium text-error hover:bg-error/10 rounded touch-area"
              onClick={handleDelete}
              disabled={deleting}
            >删除</button>
            <button
              className="px-2 py-0.5 text-xs text-muted hover:bg-surface-card rounded touch-area"
              onClick={() => setConfirming(false)}
            >取消</button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="w-8 h-8 flex items-center justify-center rounded-md text-muted-soft hover:text-error hover:bg-error/5 transition-colors flex-shrink-0 ml-2 touch-area"
            title="删除"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        )}
      </div>

      {/* Content: AI analysis markdown */}
      {analysis.content && (
        <div className="sentence-content text-body leading-relaxed text-sm font-chinese">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Style sentence-analysis section headers (**原句拆解**：, **理解拆解**：, etc.)
              strong: ({ children, ...props }: any) => {
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
              // **原句拆解**：content 中冒号在 <strong> 外，在 p 层识别「已知标题 strong + 前导冒号文本」
              p: ({ children }: any) => {
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
              li: ({ children, ...props }: any) => <li className="mb-0.5 last:mb-0 text-body" {...props}>{children}</li>,
              ul: ({ children, ...props }: any) => <ul className="m-0 mb-1 pl-4 list-disc" {...props}>{children}</ul>,
              ol: ({ children, ...props }: any) => <ol className="m-0 mb-1 pl-4 list-decimal" {...props}>{children}</ol>,
            }}
          >
            {analysis.content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

// ── Main Sheet ─────────────────────────────────────────────────────

export default function FocusedAnalysisSheet({
  type,
  analysisKey,
  onClose,
}: FocusedAnalysisSheetProps) {
  const { wordAnalyses, sentenceAnalyses } = useDocumentStore();
  const { wordPanelFontSize } = useReaderStore();

  const wordAnalysis = type === 'word' ? wordAnalyses[analysisKey] : null;
  const sentenceAnalysis = type === 'sentence' ? sentenceAnalyses[analysisKey] : null;

  // 打开单词详情即预取双音色，点击喇叭时命中缓存零延迟播放
  useEffect(() => {
    if (type === 'word' && wordAnalysis?.word) {
      prefetchSpeak(wordAnalysis.word, 'us');
      prefetchSpeak(wordAnalysis.word, 'uk');
    }
  }, [type, wordAnalysis]);

  const hasData = type === 'word' ? !!wordAnalysis : !!sentenceAnalysis;

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Sheet */}
      <div className="max-h-[45vh] bg-canvas rounded-t-2xl flex flex-col overflow-hidden shadow-modal animate-slide-up">
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 study-panel-content" style={{ fontSize: wordPanelFontSize }}>
          {!hasData && (
            <p className="text-muted text-sm text-center py-12">解析数据不存在，可能已被删除</p>
          )}
          {type === 'word' && wordAnalysis && (
            <FocusedWordCard analysis={wordAnalysis} analysisKey={analysisKey} />
          )}
          {type === 'sentence' && sentenceAnalysis && (
            <FocusedSentenceCard analysis={sentenceAnalysis} analysisKey={analysisKey} />
          )}
        </div>
      </div>
    </div>
  );
}
