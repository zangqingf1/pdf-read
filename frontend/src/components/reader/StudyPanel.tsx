import { useState, useCallback, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useDocumentStore } from '../../stores/documentStore';
import { useReaderStore, WORD_PANEL_FONT_SIZE_MIN, WORD_PANEL_FONT_SIZE_MAX, BG_COLORS } from '../../stores/readerStore';
import { deleteWordAnalysis, WordAnalysisResult } from '../../services/wordAnalysisApi';
import { deleteSentenceAnalysis } from '../../services/sentenceAnalysisApi';
import type { SentenceAnalysisResult, StructureItem } from '../../services/sentenceAnalysisApi';
import EmptyState from '../ui/EmptyState';
import Button from '../ui/Button';

// ── Structure color palette ──
const STRUCTURE_COLORS = [
  { bg: '#fdf3ef', border: '#e8b4a0' },
  { bg: '#fdf8ed', border: '#e8d5a0' },
  { bg: '#f0f7f1', border: '#a3d4a8' },
  { bg: '#f5f0e8', border: '#d4c9b8' },
  { bg: '#f3eef8', border: '#c4b8d4' },
  { bg: '#eef6f3', border: '#a0c8bc' },
  { bg: '#fef8ed', border: '#e8d08a' },
  { bg: '#f1efe8', border: '#c4bfb0' },
  { bg: '#eef2f8', border: '#a8b8d4' },
  { bg: '#eff5ed', border: '#b0c8a5' },
];

function getStructureColor(index: number) {
  return STRUCTURE_COLORS[index % STRUCTURE_COLORS.length];
}

// ── Module-level callback for reverse navigation ──
let _scrollToAnalysis: ((key: string, tab: 'words' | 'sentences') => void) | null = null;

export function triggerScrollToAnalysis(key: string, tab: 'words' | 'sentences') {
  _scrollToAnalysis?.(key, tab);
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
    } catch { onDelete(); }
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
          {analysis.phonetic && (
            <span className="text-muted-soft" style={{ fontSize: '0.85em' }}>
              {analysis.phonetic}
            </span>
          )}
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
          <div className="flex items-center justify-between text-muted mb-0.5" style={{ fontSize: '0.85em' }}>
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
            <p className="mt-0.5 text-muted leading-relaxed m-0 font-chinese" style={{ fontSize: '0.85em' }}>
              {analysis.definition_zh}
            </p>
          )}
        </div>
      )}

      {/* Base/Plural forms */}
      {(analysis.base_form || analysis.plural_form) && (
        <div className="mb-2 flex items-center gap-3 text-muted text-xs">
          {analysis.base_form && (
            <span>原形：<strong className="text-body-strong">{analysis.base_form}</strong></span>
          )}
          {analysis.plural_form && (
            <span>复数：<strong className="text-body-strong">{analysis.plural_form}</strong></span>
          )}
        </div>
      )}

      {/* Cognates */}
      {analysis.cognates && analysis.cognates.length > 0 && (
        <div className="mb-2">
          <span className="text-muted text-xs block mb-1">同根词</span>
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
    </div>
  );
}

// ── Sentence Card ──────────────────────────────────────────────────

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
    } catch { onDelete(); }
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
          className="font-semibold text-ink cursor-pointer hover:text-primary transition-colors leading-snug text-sm line-clamp-2 font-reading"
          onClick={() => onScrollToParagraph(analysis.paragraph_index)}
          title="点击定位到原文位置"
        >
          {analysis.sentence_text}
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

      {/* Structure */}
      {analysis.structure && analysis.structure.length > 0 && (
        <div className="mb-3">
          <span className="text-muted text-xs block mb-1.5">句子结构</span>
          <div className="flex flex-wrap gap-0.5 mb-2 leading-relaxed">
            {analysis.structure.map((seg: StructureItem, i: number) => {
              const color = getStructureColor(i);
              return (
                <span
                  key={i}
                  className="sentence-structure-block"
                  style={{ backgroundColor: color.bg, borderColor: color.border }}
                >
                  <span className="sentence-structure-text">{seg.text}</span>
                  <span className="sentence-structure-label" style={{ color: color.border }}>
                    {seg.label}
                  </span>
                </span>
              );
            })}
          </div>
          <div className="space-y-1.5">
            {analysis.structure.map((seg: StructureItem, i: number) => {
              const color = getStructureColor(i);
              return (
                <div key={i} className="flex gap-1.5 text-xs">
                  <span
                    className="inline-block px-1.5 py-0 rounded font-medium flex-shrink-0"
                    style={{ backgroundColor: color.bg, color: '#555', border: `1px solid ${color.border}` }}
                  >
                    {seg.label}
                  </span>
                  <span className="text-body">{seg.explanation}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Idiomatic translation */}
      {analysis.idiomatic_translation && (
        <div className="mt-2 pt-2 border-t border-hairline">
          <span className="text-muted text-xs block mb-1">地道翻译</span>
          <p className="text-body leading-relaxed italic text-sm m-0 font-chinese">
            {analysis.idiomatic_translation}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────

export default function StudyPanel() {
  const {
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
    return () => { _scrollToAnalysis = null; };
  }, []);

  const handleScrollToParagraph = useCallback((paragraphIndex: number) => {
    const el = document.querySelector(`[data-paragraph-index="${paragraphIndex}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('paragraph-flash');
      setTimeout(() => el.classList.remove('paragraph-flash'), 1500);
    }
  }, []);

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

  const handleClearCurrent = useCallback(() => {
    if (activeTab === 'words') clearWordAnalyses();
    else clearSentenceAnalyses();
    setClearConfirming(false);
  }, [activeTab, clearWordAnalyses, clearSentenceAnalyses]);

  return (
    <div className="flex-1 min-h-0 flex flex-col border-l border-hairline transition-colors duration-300" style={{ backgroundColor: bgColorValue }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-hairline flex-shrink-0">
        <h3 className="text-sm font-display font-medium text-ink m-0">解析面板</h3>
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

      {/* Progress indicators */}
      {isAnalyzing && pendingWordCount > 0 && (
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

            {/* Empty */}
            {wordList.length === 0 && !isAnalyzing && !analysisError && (
              <EmptyState
                title="选中原文单词后点击解析"
                description="点击文章中的任意单词，然后点击底部「解析」按钮获取详细释义"
              />
            )}

            {/* Word cards */}
            {wordList.map((analysis) => (
              <WordCard
                key={`${analysis.paragraph_index}:${analysis.word}`}
                analysis={analysis}
                onScrollToParagraph={handleScrollToParagraph}
                onDelete={() => handleDeleteWord(analysis)}
              />
            ))}
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

            {/* Empty */}
            {sentenceList.length === 0 && !isAnalyzingSentences && !sentenceAnalysisError && (
              <EmptyState
                title="选中原文句子后点击解析"
                description="点击文章中的任意句子，然后点击底部「解析句子」按钮获取结构拆解和翻译"
              />
            )}

            {/* Sentence cards */}
            {sentenceList.map((analysis) => (
              <SentenceCard
                key={`${analysis.paragraph_index}:${analysis.sentence_index}`}
                analysis={analysis}
                onScrollToParagraph={handleScrollToParagraph}
                onDelete={() => handleDeleteSentence(analysis)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
