import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getPDFResult, getPDFStatus } from '../services/pdfApi';
import { translateParagraphs } from '../services/translateApi';
import { analyzeWords as analyzeWordsApi } from '../services/wordAnalysisApi';
import type { WordEntry } from '../services/wordAnalysisApi';
import { analyzeSentences as analyzeSentencesApi } from '../services/sentenceAnalysisApi';
import type { SentenceEntry } from '../services/sentenceAnalysisApi';
import { getStoredDeepseekKey } from '../components/common/ApiKeyModal';
import ApiKeyModal from '../components/common/ApiKeyModal';
import { useDocumentStore } from '../stores/documentStore';
import { useReaderStore, BG_COLORS } from '../stores/readerStore';
import ReaderHeader from '../components/reader/ReaderHeader';
import ReadingArea from '../components/reader/ReadingArea';
import StudyPanel from '../components/reader/StudyPanel';
import Button from '../components/ui/Button';
import Spinner, { PageSpinner } from '../components/ui/Spinner';

export default function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [parseStatus, setParseStatus] = useState<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    setDocument,
    reset,
    paragraphs,
    documentId,
    translations,
    isTranslating,
    updateTranslations,
    setTranslating,
    setTranslationError,
    selectedWords,
    wordAnalyses,
    isAnalyzing,
    clearWordSelection,
    setWordAnalyses,
    setAnalyzing,
    setAnalysisError,
    selectedSentences,
    sentenceAnalyses,
    isAnalyzingSentences,
    clearSentenceSelection,
    setSentenceAnalyses,
    setAnalyzingSentences,
    setSentenceAnalysisError,
  } = useDocumentStore();

  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [translationTrigger, setTranslationTrigger] = useState(0);

  // ── Typography preferences ──
  const { bgColor } = useReaderStore();
  const bgColorValue = BG_COLORS.find(c => c.key === bgColor)?.value ?? BG_COLORS[0].value;

  // ── Split layout state (persisted) ──
  const SPLIT_WIDTH_KEY = 'reader_split_width';
  const [leftWidth, setLeftWidth] = useState(() => {
    const saved = localStorage.getItem(SPLIT_WIDTH_KEY);
    if (saved !== null) {
      const val = parseFloat(saved);
      if (!isNaN(val) && val >= 300 && val <= window.innerWidth - 320) return val;
    }
    return window.innerWidth * 0.55;
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const hasAnalyses = Object.keys(wordAnalyses).length > 0 || Object.keys(sentenceAnalyses).length > 0;
  const selectedWordCount = Object.keys(selectedWords).length;
  const selectedSentenceCount = Object.keys(selectedSentences).length;

  // Track parse status for polling
  const parseStatusRef = useRef<string>('');

  // ── Draggable divider ──
  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartX.current = e.clientX;
      dragStartWidth.current = leftWidth;
    },
    [leftWidth]
  );

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStartX.current;
      const newWidth = Math.max(300, Math.min(window.innerWidth - 320, dragStartWidth.current + delta));
      setLeftWidth(newWidth);
    };
    const handleMouseUp = () => setIsDragging(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Persist split width when dragging ends
  const prevDragging = useRef(false);
  useEffect(() => {
    if (prevDragging.current && !isDragging) {
      localStorage.setItem(SPLIT_WIDTH_KEY, String(Math.round(leftWidth)));
    }
    prevDragging.current = isDragging;
  }, [isDragging, leftWidth]);

  // ── Document loading ──
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const tryLoadDocument = async () => {
      try {
        const status = await getPDFStatus(id);
        if (cancelled) return;

        if (status.status === 'failed') {
          setError('PDF 解析失败，请返回重新上传');
          setLoading(false);
          return;
        }

        if (status.status !== 'completed') {
          setParseStatus(status.status);
          parseStatusRef.current = status.status;
          return;
        }

        const result = await getPDFResult(id);
        if (!cancelled) {
          setDocument(result);
          setParseStatus('completed');
          parseStatusRef.current = 'completed';
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          const status = err?.response?.status;
          if (status === 425) {
            setParseStatus('processing');
            parseStatusRef.current = 'processing';
          } else if (status === 404) {
            setError('文档不存在');
            setLoading(false);
          } else {
            setError(err?.response?.data?.detail || '加载失败');
            setLoading(false);
          }
        }
      }
    };

    tryLoadDocument();

    pollRef.current = setInterval(() => {
      if (parseStatusRef.current === 'completed' || error) {
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }
      tryLoadDocument();
    }, 2000);

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      reset();
    };
  }, [id]);

  // ── Auto-translate ──
  useEffect(() => {
    if (paragraphs.length === 0 || isTranslating) return;
    const apiKey = getStoredDeepseekKey();
    if (!apiKey) return;

    const untranslated = paragraphs.filter((p) => !translations[p.index]);
    if (untranslated.length === 0) return;

    setTranslating(true);
    setTranslationError(null);

    translateParagraphs(
      untranslated.map((p) => p.text),
      apiKey,
      documentId || undefined
    )
      .then((response) => {
        const items = untranslated.map((p, i) => ({
          index: p.index,
          text: response.translations[i] || '',
        }));
        updateTranslations(items);
      })
      .catch((err: any) => {
        const detail = err?.response?.data?.detail || err?.message || '翻译失败';
        setTranslationError(detail);
      })
      .finally(() => setTranslating(false));
  }, [documentId, paragraphs.length, translationTrigger]);

  // ── Analyze selected words ──
  const handleAnalyze = useCallback(async () => {
    const selectedKeys = Object.keys(selectedWords);
    if (selectedKeys.length === 0) return;

    const apiKey = getStoredDeepseekKey();
    if (!apiKey) { setShowApiKeyModal(true); return; }

    const newKeys = selectedKeys.filter((key) => !wordAnalyses[key]);
    if (newKeys.length === 0) return;

    const groupMap = new Map<number, string[]>();
    for (const key of newKeys) {
      const [paraIdxStr, word] = key.split(':');
      const paraIdx = parseInt(paraIdxStr, 10);
      if (!groupMap.has(paraIdx)) groupMap.set(paraIdx, []);
      groupMap.get(paraIdx)!.push(word);
    }

    const entries: WordEntry[] = [];
    for (const [paraIdx, words] of groupMap) {
      const paragraph = paragraphs.find((p) => p.index === paraIdx);
      if (!paragraph) continue;
      entries.push({
        paragraph_index: paraIdx,
        words,
        sentence: paragraph.text,
        sentence_translation: translations[paraIdx] || null,
      });
    }
    if (entries.length === 0) return;

    setAnalyzing(true);
    setAnalysisError(null);

    try {
      const response = await analyzeWordsApi(entries, documentId!, apiKey);
      setWordAnalyses(response.analyses);
      clearWordSelection();
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || '单词解析失败';
      setAnalysisError(detail);
    } finally { setAnalyzing(false); }
  }, [selectedWords, wordAnalyses, paragraphs, translations, documentId]);

  // ── Analyze selected sentences ──
  const handleAnalyzeSentences = useCallback(async () => {
    const selectedKeys = Object.keys(selectedSentences);
    if (selectedKeys.length === 0) return;

    const apiKey = getStoredDeepseekKey();
    if (!apiKey) { setShowApiKeyModal(true); return; }

    const newKeys = selectedKeys.filter((key) => !sentenceAnalyses[key]);
    if (newKeys.length === 0) return;

    const entries: SentenceEntry[] = [];
    for (const key of newKeys) {
      const [paraIdxStr, sentIdxStr] = key.split(':');
      const paraIdx = parseInt(paraIdxStr, 10);
      const sentIdx = parseInt(sentIdxStr, 10);
      const selection = selectedSentences[key];
      if (!selection) continue;
      entries.push({
        paragraph_index: paraIdx,
        sentence_index: sentIdx,
        sentence_text: selection.text,
        sentence_translation: translations[paraIdx] || null,
      });
    }
    if (entries.length === 0) return;
    if (!documentId) return;

    setAnalyzingSentences(true);
    setSentenceAnalysisError(null);

    try {
      const response = await analyzeSentencesApi(entries, documentId, apiKey);
      setSentenceAnalyses(response.analyses);
      clearSentenceSelection();
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || '句子解析失败';
      setSentenceAnalysisError(detail);
    } finally { setAnalyzingSentences(false); }
  }, [selectedSentences, sentenceAnalyses, translations, documentId]);

  // ── Loading / empty states ──
  if (loading && !parseStatus) {
    return <PageSpinner label="加载文档..." />;
  }

  if (parseStatus === 'pending' || parseStatus === 'processing') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4" style={{ backgroundColor: bgColorValue }}>
        <Spinner size="lg" />
        <p className="text-base text-muted">正在解析 PDF，请稍候...</p>
        <Button variant="ghost" onClick={() => navigate('/')}>返回首页</Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4" style={{ backgroundColor: bgColorValue }}>
        <div className="w-16 h-16 rounded-full bg-error/15 flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M15 9l-6 6M9 9l6 6" />
          </svg>
        </div>
        <h3 className="text-display-sm font-display text-ink">加载失败</h3>
        <p className="text-muted max-w-sm text-center">{error}</p>
        <div className="flex gap-3">
          <Button variant="primary" onClick={() => { setError(null); setLoading(true); setParseStatus(''); window.location.reload(); }}>
            重试
          </Button>
          <Button variant="secondary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        </div>
      </div>
    );
  }

  if (!loading && paragraphs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4" style={{ backgroundColor: bgColorValue }}>
        <div className="w-16 h-16 rounded-full bg-warning/15 flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h3 className="text-display-sm font-display text-ink">文档内容为空</h3>
        <p className="text-muted max-w-sm text-center">
          PDF 解析未提取到文本内容，可能是扫描版 PDF 或图片格式
        </p>
        <Button variant="primary" onClick={() => navigate('/')}>
          返回首页
        </Button>
      </div>
    );
  }

  // ── Main Reader ──
  const apiKey = getStoredDeepseekKey();
  const hasUntranslated = paragraphs.some((p) => !translations[p.index]);

  return (
    <div className="h-screen flex flex-col overflow-hidden transition-colors duration-300" style={{ backgroundColor: bgColorValue }}>
      <ReaderHeader />
      <div className="flex-1 min-h-0 flex overflow-hidden transition-colors duration-300" style={{ backgroundColor: bgColorValue }}>
        {/* Left: Reading area */}
        <div
          className="overflow-y-auto flex-shrink-0 min-h-0"
          style={{ width: hasAnalyses ? leftWidth : '100%', backgroundColor: bgColorValue }}
        >
          <div className={hasAnalyses ? 'px-6 py-6 max-w-none' : 'px-8 py-6 max-w-[950px] mx-auto'}>
            {/* API key prompt */}
            {!apiKey && hasUntranslated && (
              <div className="mb-6 p-4 bg-canvas-soft border border-hairline rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4M12 8h.01" />
                  </svg>
                  <span className="text-sm text-body-strong">配置 DeepSeek API Key 以启用段落翻译</span>
                </div>
                <Button variant="primary" size="sm" onClick={() => setShowApiKeyModal(true)}>
                  配置
                </Button>
              </div>
            )}
            <ReadingArea />
          </div>
        </div>

        {/* Resizable divider */}
        {hasAnalyses && (
          <div
            className={`resize-handle ${isDragging ? '!bg-primary' : ''}`}
            onMouseDown={handleDividerMouseDown}
          />
        )}

        {/* Right: Study panel */}
        {hasAnalyses && (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <StudyPanel />
          </div>
        )}
      </div>

      {/* Floating action bar */}
      {(selectedWordCount > 0 || selectedSentenceCount > 0) && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 shadow-float rounded-lg px-5 py-3 border border-hairline flex items-center gap-4" style={{ backgroundColor: bgColorValue }}>
          {selectedWordCount > 0 && (
            <>
              <span className="text-sm text-body">
                已选 <strong className="text-body-strong">{selectedWordCount}</strong> 个单词
              </span>
              <Button variant="primary" size="sm" loading={isAnalyzing} onClick={handleAnalyze}>
                解析
              </Button>
              <Button variant="ghost" size="sm" onClick={clearWordSelection}>
                清除
              </Button>
            </>
          )}
          {selectedWordCount > 0 && selectedSentenceCount > 0 && (
            <div className="w-px h-6 bg-hairline" />
          )}
          {selectedSentenceCount > 0 && (
            <>
              <span className="text-sm text-body">
                已选 <strong className="text-body-strong">{selectedSentenceCount}</strong> 个句子
              </span>
              <Button variant="primary" size="sm" loading={isAnalyzingSentences} onClick={handleAnalyzeSentences}>
                解析句子
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSentenceSelection}>
                清除
              </Button>
            </>
          )}
        </div>
      )}

      <ApiKeyModal
        open={showApiKeyModal}
        onClose={() => {
          setShowApiKeyModal(false);
          setTranslationTrigger((n) => n + 1);
        }}
      />
    </div>
  );
}
