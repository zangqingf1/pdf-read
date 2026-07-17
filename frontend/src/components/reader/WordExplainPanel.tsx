import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Typography, Tag, Button, Space, Spin, message, Empty } from 'antd';
import { BulbOutlined, CloseOutlined } from '@ant-design/icons';
import {
  useReaderStore,
  sortedKeys,
} from '../../stores/readerStore';
import { explainWordsInBatches, type WordExplanationItem } from '../../services/translateApi';
import { getStoredApiKey } from '../common/ApiKeyModal';

const { Text } = Typography;

// ── Word Explanation Card ──────────────────────────────────────────

function WordExplanationCard({ item }: { item: WordExplanationItem }) {
  const [zhDefVisible, setZhDefVisible] = useState(false);
  const [ctxZhVisible, setCtxZhVisible] = useState(false);
  const [examplesZhVisible, setExamplesZhVisible] = useState(false);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {/* 1. 单词名称 + 音标 */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-blue-50 border-b border-blue-100">
        <Text strong className="text-base text-blue-800">
          {item.word}
        </Text>
        {item.phonetic && (
          <Text className="text-sm text-gray-400 font-mono">{item.phonetic}</Text>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* 2. 所处原文句子：英文直接显示，中文翻译点击展开 */}
        {item.context_sentence && (
          <div>
            <Text className="text-sm text-gray-700 italic block">
              "{item.context_sentence}"
            </Text>
            {item.context_sentence_zh && (
              <div>
                <Button
                  type="link"
                  size="small"
                  className="!p-0 !h-auto !text-xs !text-gray-400"
                  onClick={() => setCtxZhVisible(!ctxZhVisible)}
                >
                  {ctxZhVisible ? '隐藏翻译' : '查看中文翻译'}
                </Button>
                {ctxZhVisible && (
                  <div className="pl-3 py-1 border-l-2 border-green-300 bg-green-50/50 rounded-r">
                    <Text className="text-sm text-gray-500">{item.context_sentence_zh}</Text>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 3. 词性（英文简写）+ 英文释义 + 中文释义（点击显示） */}
        <div>
          <div className="flex items-start gap-2">
            {item.pos && (
              <Tag color="blue" className="!m-0 !text-xs flex-shrink-0">
                {item.pos}
              </Tag>
            )}
            {item.definition_en && (
              <Text className="text-sm text-gray-700 flex-1">{item.definition_en}</Text>
            )}
          </div>
          {item.definition_zh && (
            <div>
              <Button
                type="link"
                size="small"
                className="!p-0 !h-auto !text-xs !text-gray-400"
                onClick={() => setZhDefVisible(!zhDefVisible)}
              >
                {zhDefVisible ? '隐藏中文释义' : '中文释义'}
              </Button>
              {zhDefVisible && (
                <div className="pl-3 py-1 border-l-2 border-blue-300 bg-blue-50/50 rounded-r">
                  <Text className="text-sm text-gray-600">{item.definition_zh}</Text>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 4. 英文例句：英文直接显示，中文翻译点击展开 */}
        {item.examples.length > 0 && (
          <div>
            <div className="flex items-center gap-2">
              <Text className="text-xs text-gray-400">例句</Text>
              <Button
                type="link"
                size="small"
                className="!p-0 !h-auto !text-xs !text-gray-400"
                onClick={() => setExamplesZhVisible(!examplesZhVisible)}
              >
                {examplesZhVisible ? '隐藏翻译' : '查看翻译'}
              </Button>
            </div>
            <div className="space-y-2 mt-0.5">
              {item.examples.map((ex, i) => (
                <div key={i} className="space-y-0.5">
                  <Text className="text-sm text-gray-700 block">
                    {i + 1}. {ex.en}
                  </Text>
                  {examplesZhVisible && ex.zh && (
                    <div className="pl-3 py-1 border-l-2 border-orange-300 bg-orange-50/50 rounded-r">
                      <Text className="text-sm text-gray-500">{ex.zh}</Text>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────

export default function WordExplainPanel() {
  const {
    selectedKeys,
    selectedDisplay,
    wordPositions,
    selectedContext,
    explanationCache,
    explaining,
    toggleWord,
    clearSelection,
    setExplaining,
    mergeExplanation,
  } = useReaderStore();

  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });

  // ── Render timing instrumentation ──
  const cacheRef = useRef(explanationCache);
  const cacheKeysLen = Object.keys(explanationCache).length;

  // useLayoutEffect: fires after React commits DOM, BEFORE browser paint
  useLayoutEffect(() => {
    if (cacheKeysLen === 0) return;
    const mark = performance.getEntriesByName('store-merged').pop();
    if (mark) {
      const layoutTime = performance.now();
      const delta = layoutTime - mark.startTime;
      console.log(
        `[TIMING] React commit (useLayoutEffect): ${delta.toFixed(1)}ms ` +
        `after store merge (${cacheKeysLen} cached words)`
      );
      performance.mark('react-committed');
    }
  }, [cacheKeysLen]);

  // useEffect + double rAF: fires after browser paint
  useEffect(() => {
    if (cacheKeysLen === 0) return;
    const commitMark = performance.getEntriesByName('react-committed').pop();
    const mergeMark = performance.getEntriesByName('store-merged').pop();
    if (!commitMark) return;

    // Double rAF to ensure paint has completed
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const paintTime = performance.now();
        const fromMerge = mergeMark ? (paintTime - mergeMark.startTime) : 0;
        const fromCommit = paintTime - commitMark.startTime;
        console.log(
          `[TIMING] Browser paint complete (double rAF): ${paintTime.toFixed(1)}ms ` +
          `| +${fromCommit.toFixed(1)}ms since React commit | ` +
          `+${fromMerge.toFixed(1)}ms since store merge`
        );
        performance.clearMarks('store-merged');
        performance.clearMarks('react-committed');
      });
    });
  }, [cacheKeysLen]);

  // Keys sorted by document position
  const orderedKeys = useMemo(
    () => sortedKeys(selectedKeys, wordPositions),
    [selectedKeys, wordPositions]
  );

  const uncachedKeys = useMemo(
    () => orderedKeys.filter((k) => !explanationCache[k]),
    [orderedKeys, explanationCache]
  );

  const uncachedWords = useMemo(
    () => uncachedKeys.map((k) => selectedDisplay[k] || k),
    [uncachedKeys, selectedDisplay]
  );

  const handleExplain = useCallback(async () => {
    if (!uncachedKeys.length) return;

    const apiKey = getStoredApiKey();
    if (!apiKey) {
      message.warning('请先在首页配置 DeepSeek API Key');
      return;
    }

    const tClick = performance.now();
    console.log(`[TIMING] === Parse button clicked: ${uncachedWords.length} words ===`);

    setExplaining(true);
    setBatchProgress({ done: 0, total: 0 });

    try {
      const totalBatches = Math.ceil(uncachedWords.length / 5);
      setBatchProgress({ done: 0, total: totalBatches });

      await explainWordsInBatches(
        uncachedWords,
        selectedContext,
        apiKey,
        (result) => {
          // Incremental merge — each batch displayed as it completes
          mergeExplanation(result.words, result.explanations);
          setBatchProgress((prev) => ({ ...prev, done: prev.done + 1 }));
        }
      );

      const tEnd = performance.now();
      console.log(
        `[TIMING] === All batches + rendering complete: ${(tEnd - tClick).toFixed(0)}ms total from click ===`
      );
    } catch (err: any) {
      const detail = err?.response?.data?.detail || '解析失败';
      message.error(detail);
    } finally {
      setExplaining(false);
      setBatchProgress({ done: 0, total: 0 });
    }
  }, [uncachedKeys, uncachedWords, selectedContext, setExplaining, mergeExplanation]);

  if (!selectedKeys.length) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        <Empty description="点击左侧单词开始解析" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <Space wrap>
          <Text strong className="text-sm">
            单词解析 ({orderedKeys.length})
          </Text>
        </Space>
        <Space size="small">
          {uncachedKeys.length > 0 && (
            <Button
              type="primary"
              size="small"
              icon={<BulbOutlined />}
              onClick={handleExplain}
              loading={explaining}
            >
              解析{uncachedKeys.length < orderedKeys.length ? `(${uncachedKeys.length})` : ''}
            </Button>
          )}
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={clearSelection}
          />
        </Space>
      </div>

      {/* Selected word tags */}
      <div className="px-4 py-2 border-b border-gray-100 bg-gray-50">
        <Space wrap size={[4, 4]}>
          {orderedKeys.map((key) => {
            const display = selectedDisplay[key] || key;
            return (
              <Tag
                key={key}
                color={explanationCache[key] ? 'green' : 'gold'}
                closable
                onClose={() => toggleWord(display, '', wordPositions[key])}
                className="!m-0 !text-xs"
              >
                {display}
              </Tag>
            );
          })}
        </Space>
      </div>

      {/* Explanation list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {explaining && (
          <div className="flex justify-center py-8">
            <Spin
              tip={
                batchProgress.total > 1
                  ? `正在解析 (${batchProgress.done}/${batchProgress.total} 批)...`
                  : `正在解析 ${uncachedWords.join('、')}...`
              }
            />
          </div>
        )}

        {orderedKeys.map((key) => {
          const explanation = explanationCache[key];
          if (!explanation) return null;

          return <WordExplanationCard key={key} item={explanation} />;
        })}

        {!explaining && orderedKeys.some((k) => explanationCache[k]) && uncachedKeys.length > 0 && (
          <div className="text-center py-2">
            <Text type="secondary" className="text-xs">
              还有 {uncachedKeys.length} 个词未解析，点击上方按钮继续
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}
