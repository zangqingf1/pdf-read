import { useState, useCallback } from 'react';
import { Typography, Button, Popconfirm, Empty, Spin, Alert, Tabs } from 'antd';
import {
  DeleteOutlined,
  SoundOutlined,
  BookOutlined,
  BulbOutlined,
  DownOutlined,
  RightOutlined,
  LoadingOutlined,
  TranslationOutlined,
  HighlightOutlined,
} from '@ant-design/icons';
import { useDocumentStore } from '../../stores/documentStore';
import { deleteWordAnalysis, WordAnalysisResult } from '../../services/wordAnalysisApi';
import { deleteSentenceAnalysis } from '../../services/sentenceAnalysisApi';
import type { SentenceAnalysisResult, StructureItem } from '../../services/sentenceAnalysisApi';

const { Title, Text } = Typography;

// ── Predefined color palette for sentence structure blocks ──
const STRUCTURE_COLORS = [
  { bg: '#E3F2FD', border: '#90CAF9' },  // 主语/主语从句 — 蓝
  { bg: '#FFF3E0', border: '#FFCC80' },  // 谓语 — 橙
  { bg: '#E8F5E9', border: '#A5D6A7' },  // 宾语/宾语从句 — 绿
  { bg: '#FCE4EC', border: '#F48FB1' },  // 定语/定语从句 — 粉
  { bg: '#F3E5F5', border: '#CE93D8' },  // 状语/状语从句 — 紫
  { bg: '#E0F7FA', border: '#80DEEA' },  // 补语/同位语 — 青
  { bg: '#FFF9C4', border: '#FFF176' },  // 表语 — 黄
  { bg: '#EFEBE9', border: '#BCAAA4' },  // 插入语/其他 — 棕
  { bg: '#E8EAF6', border: '#9FA8DA' },  // 连接词 — 靛蓝
  { bg: '#F1F8E9', border: '#C5E1A5' },  // 其他 — 浅绿
];

function getStructureColor(index: number) {
  return STRUCTURE_COLORS[index % STRUCTURE_COLORS.length];
}


/** Example sentences section with a single toggle for all Chinese translations. */
function ExampleSentences({
  sentences,
  translations,
}: {
  sentences: string[];
  translations: string[];
}) {
  const [showZh, setShowZh] = useState(false);
  const hasAnyTranslation = translations.some((t) => !!t);

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between text-gray-500 text-xs mb-0.5">
        <div className="flex items-center gap-1">
          <BulbOutlined />
          <span>例句</span>
        </div>
        {hasAnyTranslation && (
          <span
            onClick={() => setShowZh(!showZh)}
            className="cursor-pointer text-gray-400 hover:text-gray-500 select-none inline-flex items-center gap-0.5"
          >
            {showZh ? <DownOutlined /> : <RightOutlined />}
            {showZh ? '隐藏翻译' : '展开翻译'}
          </span>
        )}
      </div>
      <ul className="list-disc list-inside space-y-1">
        {sentences.map((en, i: number) => (
          <li key={i}>
            <Text className="text-sm text-gray-700">{en}</Text>
            {showZh && translations[i] && (
              <div className="mt-0.5 text-gray-500 text-xs leading-relaxed ml-0">
                {translations[i]}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A single word analysis card. */
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

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      if (analysis.id) {
        await deleteWordAnalysis(analysis.id);
      }
      onDelete();
    } catch {
      onDelete();
    } finally {
      setDeleting(false);
    }
  }, [analysis.id, onDelete]);

  return (
    <div
      className="word-card bg-white border border-gray-200 rounded-lg p-3 mb-3 shadow-sm"
      data-paragraph-index={analysis.paragraph_index}
    >
      {/* Header: word + phonetic + delete */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className="font-bold text-gray-900 cursor-pointer hover:text-blue-600 transition-colors"
            onClick={() => onScrollToParagraph(analysis.paragraph_index)}
            title="点击定位到原文位置"
          >
            {analysis.word}
          </span>
          {analysis.phonetic && (
            <Text type="secondary" className="text-xs">
              <SoundOutlined className="mr-0.5" />
              {analysis.phonetic}
            </Text>
          )}
        </div>
        <Popconfirm
          title="确定删除此单词解析？"
          onConfirm={handleDelete}
          okText="删除"
          cancelText="取消"
          placement="left"
        >
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            loading={deleting}
            className="flex-shrink-0"
          />
        </Popconfirm>
      </div>

      {/* Definition */}
      {analysis.definition && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-gray-500 text-xs mb-0.5">
            <div className="flex items-center gap-1">
              <BookOutlined />
              <span>释义</span>
            </div>
            {analysis.definition_zh && (
              <span
                onClick={() => setShowDefZh(!showDefZh)}
                className="cursor-pointer text-gray-400 hover:text-gray-500 select-none inline-flex items-center gap-0.5"
              >
                {showDefZh ? <DownOutlined /> : <RightOutlined />}
                {showDefZh ? '隐藏中文' : '展开中文'}
              </span>
            )}
          </div>
          <Text className="text-sm text-gray-800">
            {analysis.part_of_speech && (
              <Text className="text-xs italic text-gray-500 mr-1">{analysis.part_of_speech}</Text>
            )}
            {analysis.definition}
          </Text>
          {showDefZh && analysis.definition_zh && (
            <div className="mt-0.5 text-gray-500 text-xs leading-relaxed">
              {analysis.definition_zh}
            </div>
          )}
        </div>
      )}

      {/* Example sentences */}
      {analysis.example_sentences && analysis.example_sentences.length > 0 && (
        <ExampleSentences
          sentences={analysis.example_sentences}
          translations={analysis.example_sentences_zh || []}
        />
      )}
    </div>
  );
}

// ── Sentence Analysis Card ──────────────────────────────────────

/** A single sentence analysis card. */
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

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      if (analysis.id) {
        await deleteSentenceAnalysis(analysis.id);
      }
      onDelete();
    } catch {
      onDelete();
    } finally {
      setDeleting(false);
    }
  }, [analysis.id, onDelete]);

  return (
    <div
      className="word-card bg-white border border-gray-200 rounded-lg p-3 mb-3 shadow-sm"
      data-paragraph-index={analysis.paragraph_index}
    >
      {/* Header: sentence text (truncated) + delete */}
      <div className="flex items-start justify-between mb-3">
        <span
          className="font-bold text-gray-900 cursor-pointer hover:text-blue-600 transition-colors text-sm leading-snug line-clamp-2"
          onClick={() => onScrollToParagraph(analysis.paragraph_index)}
          title="点击定位到原文位置"
        >
          {analysis.sentence_text}
        </span>
        <Popconfirm
          title="确定删除此句子解析？"
          onConfirm={handleDelete}
          okText="删除"
          cancelText="取消"
          placement="left"
        >
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            loading={deleting}
            className="flex-shrink-0 ml-2"
          />
        </Popconfirm>
      </div>

      {/* 1. Sentence structure colored blocks */}
      {analysis.structure && analysis.structure.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1 text-gray-500 text-xs mb-1.5">
            <HighlightOutlined />
            <span>句子结构</span>
          </div>
          {/* Colored blocks of the original sentence */}
          <div className="flex flex-wrap gap-0.5 mb-2 leading-relaxed">
            {analysis.structure.map((seg: StructureItem, i: number) => {
              const color = getStructureColor(i);
              return (
                <span
                  key={i}
                  className="sentence-structure-block"
                  style={{
                    backgroundColor: color.bg,
                    borderColor: color.border,
                  }}
                >
                  <span className="sentence-structure-text">{seg.text}</span>
                  <span
                    className="sentence-structure-label"
                    style={{ color: color.border }}
                  >
                    {seg.label}
                  </span>
                </span>
              );
            })}
          </div>
          {/* Explanation of each part */}
          <div className="space-y-1.5">
            {analysis.structure.map((seg: StructureItem, i: number) => {
              const color = getStructureColor(i);
              return (
                <div key={i} className="flex gap-1.5 text-xs">
                  <span
                    className="inline-block px-1.5 py-0 rounded text-xs font-medium flex-shrink-0"
                    style={{
                      backgroundColor: color.bg,
                      color: '#555',
                      border: `1px solid ${color.border}`,
                    }}
                  >
                    {seg.label}
                  </span>
                  <span className="text-gray-600">{seg.explanation}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. Idiomatic translation */}
      {analysis.idiomatic_translation && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-1 text-gray-500 text-xs mb-1">
            <TranslationOutlined />
            <span>地道翻译</span>
          </div>
          <Text className="text-sm text-gray-700 leading-relaxed italic">
            {analysis.idiomatic_translation}
          </Text>
        </div>
      )}
    </div>
  );
}

// ── Main Panel Component ────────────────────────────────────────

export default function WordPanel() {
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

  const [activeTab, setActiveTab] = useState<string>('words');

  const wordList = Object.values(wordAnalyses);
  wordList.sort((a, b) => a.paragraph_index - b.paragraph_index);

  const sentenceList = Object.values(sentenceAnalyses);
  sentenceList.sort((a, b) => a.paragraph_index - b.paragraph_index);

  const pendingWordCount = Object.keys(selectedWords).length;
  const pendingSentenceCount = Object.keys(selectedSentences).length;

  const hasAnyContent = wordList.length > 0 || sentenceList.length > 0;

  const handleScrollToParagraph = useCallback((paragraphIndex: number) => {
    const el = document.querySelector(`[data-paragraph-index="${paragraphIndex}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  const tabItems = [
    {
      key: 'words',
      label: (
        <span>
          单词
          {wordList.length > 0 && (
            <Text type="secondary" className="ml-1 text-xs">
              ({wordList.length})
            </Text>
          )}
        </span>
      ),
      children: (
        <div className="h-full overflow-y-auto px-3 py-3">
          {/* Loading state (initial) */}
          {isAnalyzing && wordList.length === 0 && (
            <div className="flex justify-center py-8">
              <Spin tip="解析中..." />
            </div>
          )}

          {/* Error state */}
          {analysisError && !isAnalyzing && (
            <Alert
              message={analysisError}
              type="error"
              showIcon
              closable
              className="mb-3"
            />
          )}

          {/* Empty state */}
          {wordList.length === 0 && !isAnalyzing && !analysisError && (
            <Empty
              description="选中原文单词后点击解析"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
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
        </div>
      ),
    },
    {
      key: 'sentences',
      label: (
        <span>
          句子
          {sentenceList.length > 0 && (
            <Text type="secondary" className="ml-1 text-xs">
              ({sentenceList.length})
            </Text>
          )}
        </span>
      ),
      children: (
        <div className="h-full overflow-y-auto px-3 py-3">
          {/* Loading state (initial) */}
          {isAnalyzingSentences && sentenceList.length === 0 && (
            <div className="flex justify-center py-8">
              <Spin tip="解析中..." />
            </div>
          )}

          {/* Error state */}
          {sentenceAnalysisError && !isAnalyzingSentences && (
            <Alert
              message={sentenceAnalysisError}
              type="error"
              showIcon
              closable
              className="mb-3"
            />
          )}

          {/* Empty state */}
          {sentenceList.length === 0 && !isAnalyzingSentences && !sentenceAnalysisError && (
            <Empty
              description="选中原文句子后点击解析"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
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
        </div>
      ),
    },
  ];

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
        <Title level={5} className="!mb-0">
          解析面板
        </Title>
        {hasAnyContent && (
          <Popconfirm
            title={activeTab === 'words' ? '确定清空所有单词解析？' : '确定清空所有句子解析？'}
            onConfirm={() => {
              if (activeTab === 'words') clearWordAnalyses();
              else clearSentenceAnalyses();
            }}
            okText="清空"
            cancelText="取消"
          >
            <Button size="small" type="text" danger>
              清空当前
            </Button>
          </Popconfirm>
        )}
      </div>

      {/* Progress indicators */}
      {isAnalyzing && pendingWordCount > 0 && (
        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2 flex-shrink-0">
          <LoadingOutlined className="text-blue-500" />
          <Text className="text-sm text-blue-600">
            正在解析 {pendingWordCount} 个单词...
          </Text>
        </div>
      )}
      {isAnalyzingSentences && pendingSentenceCount > 0 && (
        <div className="px-4 py-2 bg-green-50 border-b border-green-100 flex items-center gap-2 flex-shrink-0">
          <LoadingOutlined className="text-green-500" />
          <Text className="text-sm text-green-600">
            正在解析 {pendingSentenceCount} 个句子...
          </Text>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
        size="small"
        className="flex-1 flex flex-col sentence-panel-tabs"
        style={{ marginBottom: 0 }}
        tabBarStyle={{ paddingLeft: 16, paddingRight: 16, marginBottom: 0 }}
      />
    </div>
  );
}
