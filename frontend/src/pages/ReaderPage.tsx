import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout, Spin, Result, Button, Typography, Alert, message } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { getPDFResult, getPDFStatus } from '../services/pdfApi';
import { translateParagraphs } from '../services/translateApi';
import { analyzeWords as analyzeWordsApi } from '../services/wordAnalysisApi';
import type { WordEntry } from '../services/wordAnalysisApi';
import { analyzeSentences as analyzeSentencesApi } from '../services/sentenceAnalysisApi';
import type { SentenceEntry } from '../services/sentenceAnalysisApi';
import { getStoredDeepseekKey } from '../components/common/ApiKeyModal';
import ApiKeyModal from '../components/common/ApiKeyModal';
import { useDocumentStore } from '../stores/documentStore';
import DocumentHeader from '../components/reader/DocumentHeader';
import ArticleView from '../components/reader/ArticleView';
import WordPanel from '../components/reader/WordPanel';

const { Text } = Typography;

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
    // Word analysis
    selectedWords,
    wordAnalyses,
    isAnalyzing,
    clearWordSelection,
    setWordAnalyses,
    setAnalyzing,
    setAnalysisError,
    // Sentence analysis
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

  // ── Split layout state ──────────────────────────────────────────
  const [leftWidth, setLeftWidth] = useState(() => window.innerWidth * 0.55);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const hasAnalyses = Object.keys(wordAnalyses).length > 0 || Object.keys(sentenceAnalyses).length > 0;
  const selectedWordCount = Object.keys(selectedWords).length;
  const selectedSentenceCount = Object.keys(selectedSentences).length;

  // Ref to track parse status for the polling interval (avoids stale closure)
  const parseStatusRef = useRef<string>('');

  // ── Draggable divider handlers ───────────────────────────────────
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

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // ── Document loading ────────────────────────────────────────────
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

  // ── Auto-translate after document loads ──────────────────────────
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
        message.error(detail);
      })
      .finally(() => {
        setTranslating(false);
      });
  }, [documentId, paragraphs.length, translationTrigger]);

  // ── Analyze selected words ───────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    const selectedKeys = Object.keys(selectedWords);
    if (selectedKeys.length === 0) return;

    const apiKey = getStoredDeepseekKey();
    if (!apiKey) {
      setShowApiKeyModal(true);
      return;
    }

    // Filter out words that already have analysis results
    const newKeys = selectedKeys.filter((key) => !wordAnalyses[key]);
    if (newKeys.length === 0) {
      message.info('选中的单词都已解析过');
      return;
    }

    // Group by paragraph_index and build entries
    const groupMap = new Map<number, string[]>();
    for (const key of newKeys) {
      const [paraIdxStr, word] = key.split(':');
      const paraIdx = parseInt(paraIdxStr, 10);
      if (!groupMap.has(paraIdx)) {
        groupMap.set(paraIdx, []);
      }
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
      message.error(detail);
    } finally {
      setAnalyzing(false);
    }
  }, [
    selectedWords,
    wordAnalyses,
    paragraphs,
    translations,
    documentId,
    setAnalyzing,
    setAnalysisError,
    setWordAnalyses,
    clearWordSelection,
  ]);

  // ── Analyze selected sentences ─────────────────────────────────────
  const handleAnalyzeSentences = useCallback(async () => {
    const selectedKeys = Object.keys(selectedSentences);
    if (selectedKeys.length === 0) return;

    const apiKey = getStoredDeepseekKey();
    if (!apiKey) {
      setShowApiKeyModal(true);
      return;
    }

    // Filter out sentences that already have analysis results
    const newKeys = selectedKeys.filter((key) => !sentenceAnalyses[key]);
    if (newKeys.length === 0) {
      message.info('选中的句子都已解析过');
      return;
    }

    // Build entries
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

    if (!documentId) {
      message.error('文档尚未加载完成，请稍后重试');
      return;
    }

    setAnalyzingSentences(true);
    setSentenceAnalysisError(null);

    try {
      const response = await analyzeSentencesApi(entries, documentId, apiKey);
      setSentenceAnalyses(response.analyses);
      clearSentenceSelection();
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || '句子解析失败';
      setSentenceAnalysisError(detail);
      message.error(detail);
    } finally {
      setAnalyzingSentences(false);
    }
  }, [
    selectedSentences,
    sentenceAnalyses,
    translations,
    documentId,
    setAnalyzingSentences,
    setSentenceAnalysisError,
    setSentenceAnalyses,
    clearSentenceSelection,
  ]);

  // ── Loading state ────────────────────────────────────────────────
  if (loading && !parseStatus) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spin size="large" tip="加载文档..." />
      </div>
    );
  }

  // ── Still parsing ────────────────────────────────────────────────
  if (parseStatus === 'pending' || parseStatus === 'processing') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <Spin size="large" />
        <Text type="secondary" className="text-lg">
          正在解析 PDF，请稍候...
        </Text>
        <Button onClick={() => navigate('/')}>返回首页</Button>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Result
        status="error"
        title="加载失败"
        subTitle={error}
        extra={[
          <Button
            key="retry"
            type="primary"
            icon={<ReloadOutlined />}
            onClick={() => {
              setError(null);
              setLoading(true);
              setParseStatus('');
              window.location.reload();
            }}
          >
            重试
          </Button>,
          <Button
            key="back"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/')}
          >
            返回首页
          </Button>,
        ]}
      />
    );
  }

  // Empty document
  if (!loading && paragraphs.length === 0) {
    return (
      <Result
        status="warning"
        title="文档内容为空"
        subTitle="PDF 解析未提取到文本内容，可能是扫描版 PDF 或图片格式"
        extra={
          <Button
            type="primary"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/')}
          >
            返回首页
          </Button>
        }
      />
    );
  }

  // ── Document loaded — main reader ────────────────────────────────
  const apiKey = getStoredDeepseekKey();
  const hasUntranslated = paragraphs.some((p) => !translations[p.index]);

  return (
    <Layout className="min-h-screen bg-white">
      <DocumentHeader />
      <div className="flex h-[calc(100vh-64px)] overflow-hidden">
        {/* Left: Article */}
        <div
          className="overflow-y-auto flex-shrink-0"
          style={{ width: hasAnalyses ? leftWidth : '100%' }}
        >
          <article
            className={`mx-auto px-8 py-6 ${hasAnalyses ? 'max-w-none' : 'max-w-3xl'}`}
          >
            {/* API key prompt */}
            {!apiKey && hasUntranslated && (
              <Alert
                message="配置 DeepSeek API Key 以启用段落翻译"
                type="info"
                showIcon
                action={
                  <Button size="small" onClick={() => setShowApiKeyModal(true)}>
                    配置
                  </Button>
                }
                className="mb-4"
              />
            )}
            <ArticleView />
          </article>
        </div>

        {/* Resizable divider — only when analyses panel is visible */}
        {hasAnalyses && (
          <div
            className={`w-1.5 cursor-col-resize flex-shrink-0 transition-colors ${
              isDragging ? 'bg-blue-400' : 'bg-gray-200 hover:bg-blue-400'
            }`}
            onMouseDown={handleDividerMouseDown}
            style={{ userSelect: 'none' }}
          />
        )}

        {/* Right: Word analysis panel */}
        {hasAnalyses && (
          <div className="flex-1 overflow-hidden">
            <WordPanel />
          </div>
        )}
      </div>

      {/* Floating action bar — words and sentences side by side */}
      {(selectedWordCount > 0 || selectedSentenceCount > 0) && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 bg-white shadow-lg rounded-lg px-4 py-3 border border-gray-200 flex items-center gap-3">
          {selectedWordCount > 0 && (
            <>
              <Text>
                已选 <Text strong>{selectedWordCount}</Text> 个单词
              </Text>
              <Button
                type="primary"
                loading={isAnalyzing}
                onClick={handleAnalyze}
              >
                解析
              </Button>
              <Button onClick={clearWordSelection}>清除</Button>
            </>
          )}
          {selectedWordCount > 0 && selectedSentenceCount > 0 && (
            <div className="w-px h-6 bg-gray-300 mx-1" />
          )}
          {selectedSentenceCount > 0 && (
            <>
              <Text>
                已选 <Text strong>{selectedSentenceCount}</Text> 个句子
              </Text>
              <Button
                type="primary"
                loading={isAnalyzingSentences}
                onClick={handleAnalyzeSentences}
                style={{ backgroundColor: '#722ed1', borderColor: '#722ed1' }}
              >
                解析句子
              </Button>
              <Button onClick={clearSentenceSelection}>清除</Button>
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
    </Layout>
  );
}
