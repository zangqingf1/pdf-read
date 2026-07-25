import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDocumentStore } from '../../stores/documentStore';
import { useReaderStore } from '../../stores/readerStore';
import { deleteWordAnalysis, type WordAnalysisResult } from '../../services/wordAnalysisApi';
import { deleteSentenceAnalysis, type SentenceAnalysisResult } from '../../services/sentenceAnalysisApi';

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
          {analysis.phonetic && (
            <span className="text-muted-soft text-sm">{analysis.phonetic}</span>
          )}
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
          <div className="flex items-center justify-between text-muted mb-0.5 text-xs">
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
            <p className="mt-1 text-muted leading-relaxed m-0 font-chinese text-sm">
              {analysis.definition_zh}
            </p>
          )}
        </div>
      )}

      {/* Base/Plural forms */}
      {(analysis.base_form || analysis.plural_form) && (
        <div className="mb-2 flex items-center gap-3 text-muted text-xs">
          {analysis.base_form && <span>原形：<strong className="text-body-strong">{analysis.base_form}</strong></span>}
          {analysis.plural_form && <span>复数：<strong className="text-body-strong">{analysis.plural_form}</strong></span>}
        </div>
      )}

      {/* Cognates */}
      {analysis.cognates && analysis.cognates.length > 0 && (
        <div className="mb-2">
          <span className="text-muted text-xs block mb-1">同根词</span>
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

      {/* Synonyms & Antonyms */}
      {((analysis.synonyms_antonyms?.synonyms?.length ?? 0) > 0 ||
        (analysis.synonyms_antonyms?.antonyms?.length ?? 0) > 0) && (
        <div className="mb-2">
          {analysis.synonyms_antonyms.synonyms.length > 0 && (
            <div className="mb-1.5">
              <span className="text-success text-xs block mb-1">近义词</span>
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
          {analysis.synonyms_antonyms.antonyms.length > 0 && (
            <div>
              <span className="text-error text-xs block mb-1">反义词</span>
              <div className="flex flex-wrap gap-1.5">
                {analysis.synonyms_antonyms.antonyms.map((a, i) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-[#fdf0f0] border border-[#f5c6c6] rounded px-2 py-0.5 text-xs">
                    <span className="text-muted-soft">{a.part_of_speech}</span>
                    <span className="font-medium text-body-strong">{a.word}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Collocations */}
      {analysis.collocations && analysis.collocations.length > 0 && (
        <div className="mb-2">
          <span className="text-muted text-xs block mb-1">常见搭配</span>
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
          <span className="text-muted text-xs block mb-1">例句</span>
          <p className="text-body leading-relaxed italic text-sm m-0 font-reading">
            {analysis.example_sentence}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Focused Sentence Card ──────────────────────────────────────────

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
              strong: ({ children, ...props }: any) => {
                const text = String(children);
                const headerMatch = text.match(/^(.+?)[：:]\s*/);
                if (headerMatch) {
                  const header = headerMatch[1].trim();
                  const after = text.slice(headerMatch[0].length);
                  const isCore = header.includes('主干');
                  const isExplain = header.includes('讲解');
                  return (
                    <span className="block mt-3 first:mt-0 mb-1.5">
                      <span className={[
                        'inline-block text-xs font-semibold px-2 py-0.5 rounded mr-1.5 align-middle',
                        isCore ? 'bg-[#fdf3ef] text-[#b85c3a] border border-[#e8b4a0]' :
                        isExplain ? 'bg-[#f0f7f1] text-[#4a7c59] border border-[#a3d4a8]' :
                        'bg-[#eef2f8] text-[#5a6d8a] border border-[#a8b8d4]',
                      ].join(' ')}>
                        {header}
                      </span>
                      {after && <span className="align-middle">{after}</span>}
                    </span>
                  );
                }
                return <strong {...props}>{children}</strong>;
              },
              p: ({ children, ...props }: any) => <p className="m-0 mb-1 last:mb-0" {...props}>{children}</p>,
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

  const hasData = type === 'word' ? !!wordAnalysis : !!sentenceAnalysis;

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Sheet */}
      <div className="max-h-[35vh] bg-canvas rounded-t-xl flex flex-col overflow-hidden shadow-modal animate-slide-up">
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
