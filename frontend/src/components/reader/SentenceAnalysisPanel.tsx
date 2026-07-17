import { useCallback, useMemo } from 'react';
import { Typography, Button, Space, Spin, message, Empty, Tag, Divider } from 'antd';
import { BulbOutlined, ReloadOutlined, CloseOutlined } from '@ant-design/icons';
import { useReaderStore, type SentenceAnalysisResult } from '../../stores/readerStore';
import { analyzeSentence } from '../../services/translateApi';
import { getStoredApiKey } from '../common/ApiKeyModal';

const { Text } = Typography;

function AnalysisCard({ result }: { result: SentenceAnalysisResult }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-100 space-y-4">
      <div>
        <Text strong className="text-blue-600 text-sm">🔍 句子结构</Text>
        <div className="mt-1">
          <Text className="text-sm text-gray-700 leading-relaxed">
            {result.sentence_structure}
          </Text>
        </div>
      </div>

      <Divider className="!my-2" />

      <div>
        <Text strong className="text-green-600 text-sm">📖 语法讲解</Text>
        <div className="mt-1">
          <Text className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {result.grammar_explanation}
          </Text>
        </div>
      </div>

      {result.key_vocabulary && result.key_vocabulary.length > 0 && (
        <>
          <Divider className="!my-2" />
          <div>
            <Text strong className="text-orange-600 text-sm">🏷 重点词汇</Text>
            <div className="mt-2 space-y-2">
              {result.key_vocabulary.map((v, i) => (
                <div key={i} className="flex items-start gap-2 bg-white rounded p-2">
                  <Text strong className="text-sm text-gray-900 min-w-[80px]">
                    {v.word}
                  </Text>
                  <Tag className="!m-0 !text-xs" color="blue">{v.pos}</Tag>
                  <Text className="text-sm text-gray-600">{v.meaning}</Text>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <Divider className="!my-2" />
      <div>
        <Text strong className="text-purple-600 text-sm">🌐 中文翻译</Text>
        <div className="mt-1">
          <Text className="text-sm text-gray-700 leading-relaxed italic">
            {result.translation}
          </Text>
        </div>
      </div>
    </div>
  );
}

/** Truncate sentence text for tag display */
function truncateSentence(text: string, maxLen = 40): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

export default function SentenceAnalysisPanel() {
  const {
    selectedSentenceSpans,
    sentenceSpanData,
    selectedSentence,
    sentenceContext,
    sentenceAnalysisCache,
    analyzingSentence,
    setActiveSentenceSpan,
    toggleSentenceSpan,
    clearSentences,
    setAnalyzingSentence,
    setSentenceAnalysis,
  } = useReaderStore();

  const cacheKey = selectedSentence.trim().toLowerCase();
  const cachedResult = cacheKey ? sentenceAnalysisCache[cacheKey] : undefined;

  // Sort spans by paraIndex then position
  const orderedSpans = useMemo(() => {
    return [...selectedSentenceSpans].sort((a, b) => {
      const da = sentenceSpanData[a];
      const db = sentenceSpanData[b];
      if (!da || !db) return 0;
      if (da.paraIndex !== db.paraIndex) return da.paraIndex - db.paraIndex;
      // Extract sentence index from key "sent-paraIdx-sentIdx"
      const ai = parseInt(a.split('-').pop() || '0', 10);
      const bi = parseInt(b.split('-').pop() || '0', 10);
      return ai - bi;
    });
  }, [selectedSentenceSpans, sentenceSpanData]);

  const handleAnalyze = useCallback(async () => {
    if (!selectedSentence) return;

    const apiKey = getStoredApiKey();
    if (!apiKey) {
      message.warning('请先在首页配置 DeepSeek API Key');
      return;
    }

    setAnalyzingSentence(true);
    try {
      const result = await analyzeSentence(selectedSentence, sentenceContext, apiKey);
      setSentenceAnalysis(selectedSentence, result.analysis);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || '句子分析失败';
      message.error(detail);
      setAnalyzingSentence(false);
    }
  }, [selectedSentence, sentenceContext, setAnalyzingSentence, setSentenceAnalysis]);

  // Empty state
  if (selectedSentenceSpans.length === 0 && !selectedSentence) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 px-4">
        <Empty
          description="点击段落中句子之间的空白/标点区域即可选中整句（可选择多句）"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    );
  }

  // Active sentence from floating toolbar (not in spans)
  const isFloatingSelection = selectedSentence && !orderedSpans.some(
    (s) => sentenceSpanData[s]?.text === selectedSentence
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <Text strong className="text-sm">
          句子分析
          {selectedSentenceSpans.length > 0 && (
            <Text type="secondary" className="text-xs ml-1">
              ({selectedSentenceSpans.length})
            </Text>
          )}
        </Text>
        <Space size="small">
          {selectedSentence && (
            <Button
              type="primary"
              size="small"
              icon={<BulbOutlined />}
              onClick={handleAnalyze}
              loading={analyzingSentence}
            >
              {cachedResult ? '重新分析' : '分析'}
            </Button>
          )}
          {selectedSentenceSpans.length > 0 && (
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={clearSentences}
              title="清除全部句子"
            />
          )}
        </Space>
      </div>

      {/* Sentence tags */}
      {orderedSpans.length > 0 && (
        <div className="px-4 py-2 border-b border-gray-100 bg-gray-50">
          <div className="flex flex-wrap gap-2">
            {orderedSpans.map((spanKey) => {
              const data = sentenceSpanData[spanKey];
              if (!data) return null;
              const isActive = data.text === selectedSentence;
              return (
                <Tag
                  key={spanKey}
                  color={isActive ? 'blue' : 'default'}
                  closable
                  onClose={(e) => {
                    e.preventDefault();
                    toggleSentenceSpan(spanKey, data.text, data.paraIndex, data.context);
                  }}
                  onClick={() => setActiveSentenceSpan(spanKey)}
                  className={`!m-0 cursor-pointer text-xs max-w-[200px] truncate ${
                    isActive ? 'font-medium' : ''
                  }`}
                  title={data.text}
                >
                  {truncateSentence(data.text)}
                </Tag>
              );
            })}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Selected sentence */}
        {selectedSentence && (
          <div className={`rounded-lg p-3 border ${
            isFloatingSelection
              ? 'bg-purple-50 border-purple-200'
              : 'bg-blue-50 border-blue-100'
          }`}>
            <Text strong className="text-xs text-blue-600 block mb-1">
              📝 {isFloatingSelection ? '拖选文本' : '当前句子'}
            </Text>
            <Text className="text-sm text-gray-800 leading-relaxed">
              {selectedSentence}
            </Text>
          </div>
        )}

        {/* Loading */}
        {analyzingSentence && (
          <div className="flex justify-center py-8">
            <Spin tip="正在分析句子结构..." />
          </div>
        )}

        {/* Cached result */}
        {!analyzingSentence && cachedResult && (
          <AnalysisCard result={cachedResult} />
        )}

        {/* Not analyzed yet */}
        {!analyzingSentence && !cachedResult && selectedSentence && (
          <div className="text-center py-4">
            <Text type="secondary" className="text-sm">
              点击上方「分析」按钮开始 AI 语法分析
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}
