import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout, Spin, Result, Button, Typography, Progress, message } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, TranslationOutlined } from '@ant-design/icons';
import { getPDFResult, getPDFStatus } from '../services/pdfApi';
import { translateParagraphs } from '../services/translateApi';
import { getStoredApiKey } from '../components/common/ApiKeyModal';
import { useDocumentStore } from '../stores/documentStore';
import DocumentHeader from '../components/reader/DocumentHeader';
import ArticleView from '../components/reader/ArticleView';
import AnalysisPanel from '../components/reader/AnalysisPanel';
import SentenceAnalyzer from '../components/reader/SentenceAnalyzer';

const { Text } = Typography;

export default function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [parseStatus, setParseStatus] = useState<string>('');
  const [translating, setTranslating] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const articleRef = useRef<HTMLDivElement | null>(null);

  const { setDocument, reset, paragraphs, setTranslations, setIsTranslating } =
    useDocumentStore();

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
          return;
        }

        const result = await getPDFResult(id);
        if (!cancelled) {
          setDocument(result);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          const status = err?.response?.status;
          if (status === 425) {
            setParseStatus('processing');
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
      if (parseStatus === 'completed' || error) {
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
    if (loading || !paragraphs.length) return;

    // Check if translations already exist (loaded from DB)
    const hasTranslations = paragraphs.some((p) => p.text_zh);
    if (hasTranslations) return; // Already translated — skip

    const apiKey = getStoredApiKey();
    if (!apiKey) return; // No key configured — skip auto-translate

    let cancelled = false;

    const autoTranslate = async () => {
      setTranslating(true);
      setIsTranslating(true);

      try {
        const texts = paragraphs.map((p) => p.text);
        const result = await translateParagraphs(texts, apiKey, id);

        if (cancelled) return;

        const map: Record<number, string> = {};
        result.translations.forEach((zh, i) => {
          map[paragraphs[i].index] = zh;
        });
        setTranslations(map);
        message.success('AI 翻译完成，请开始阅读');
      } catch (err: any) {
        if (cancelled) return;
        const detail = err?.response?.data?.detail || '翻译失败';
        message.warning(`自动翻译失败: ${detail}`);
      } finally {
        if (!cancelled) {
          setTranslating(false);
          setIsTranslating(false);
        }
      }
    };

    autoTranslate();

    return () => {
      cancelled = true;
    };
  }, [loading, paragraphs.length]);

  // ── Translating state ────────────────────────────────────────────
  if (translating) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6">
        <Spin size="large" />
        <div className="text-center">
          <Text strong className="text-lg block mb-2">
            <TranslationOutlined className="mr-2" />
            正在 AI 翻译...
          </Text>
          <Text type="secondary" className="block">
            正在调用 DeepSeek 逐段翻译，请稍候
          </Text>
        </div>
        <Progress percent={99} status="active" strokeColor="#2563eb" style={{ width: 300 }} />
      </div>
    );
  }

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
        <Text type="secondary" className="text-sm">
          系统正在提取正文内容，完成后自动翻译
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

  // Document loaded with translations — show reader
  return (
    <Layout className="min-h-screen bg-white">
      <DocumentHeader />
      <div className="flex h-[calc(100vh-64px)]">
        {/* Left: article */}
        <div className="flex-1 overflow-y-auto" ref={articleRef}>
          <article className="max-w-3xl mx-auto px-8 py-6">
            <ArticleView />
          </article>
        </div>

        {/* Right: analysis panel (tabs: word + sentence) */}
        <div className="w-[420px] border-l border-gray-200 bg-white overflow-y-auto">
          <AnalysisPanel />
        </div>
      </div>

      {/* Floating sentence analyzer toolbar */}
      <SentenceAnalyzer containerRef={articleRef} />
    </Layout>
  );
}
