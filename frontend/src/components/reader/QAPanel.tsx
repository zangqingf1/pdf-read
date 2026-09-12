/**
 * AI 问答对话面板 — 针对当前文档的多轮问答（外刊精读场景）。
 *
 * 桌面端与解析面板同容器 Tab 切换（ReaderPage 传入 onClose）；移动端
 * 由 StudySheet 提供外壳（mobile 隐藏自身头部）。会话由后端持久化，
 * 进入阅读页时通过 qaStore.loadConversation 懒加载。
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useShallow } from 'zustand/react/shallow';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import ErrorBanner from './ErrorBanner';
import { safeMarkdownComponents } from '../../utils/markdownComponents';
import { scrollToParagraph, scrollToSentence } from '../../utils/scrollToParagraph';
import { useReaderStore, BG_COLORS } from '../../stores/readerStore';
import { useQaStore, type QaQuote } from '../../stores/qaStore';
import PanelSwitch from './PanelSwitch';
import type { QaPromptName } from '../../services/qaApi';

interface QAPanelProps {
  onClose?: () => void;
  /** 切换到解析面板 */
  onSwitchToStudy?: () => void;
  mobile?: boolean;
  apiKey?: string;
  provider?: 'deepseek';
  onRequireApiKey?: () => void;
  /** 点击引用卡跳转到原文：由阅读页容器实现（移动端需先收起弹层露出正文）。
   *  sentenceIndex 为 null 时表示旧数据无句级信息，走整段定位。 */
  onJumpToQuote?: (paragraphIndex: number, sentenceIndex: number | null) => void;
}

/** 预填输入框的快捷问题（引用句存在时才显示前两个） */
const QUICK_QUESTIONS_WITH_QUOTE = [
  '这句话为什么用这个时态？',
  '作者这里的立场是什么？',
] as const;

/**
 * memo 化的 Markdown 回答渲染：content 未变时跳过 react-markdown 解析。
 * 流式期间面板每个 token 都会重渲染，历史问答必须能跳过重新解析，
 * 否则长会话下的成本随消息数线性叠加。
 */
const AnswerMarkdown = memo(function AnswerMarkdown({ content }: { content: string }) {
  return <ReactMarkdown components={safeMarkdownComponents}>{content}</ReactMarkdown>;
});

export default function QAPanel({
  onClose,
  onSwitchToStudy,
  mobile = false,
  apiKey,
  provider,
  onRequireApiKey,
  onJumpToQuote,
}: QAPanelProps) {
  const { bgColor } = useReaderStore();
  const bgColorValue = BG_COLORS.find(c => c.key === bgColor)?.value ?? BG_COLORS[0].value;

  const documentId = useQaStore(useShallow((s) => s.loadedDocumentId));
  const messages = useQaStore(useShallow((s) => s.messages));
  const isLoadingHistory = useQaStore(useShallow((s) => s.isLoadingHistory));
  const isStreaming = useQaStore(useShallow((s) => s.isStreaming));
  const streamingText = useQaStore(useShallow((s) => s.streamingText));
  const error = useQaStore(useShallow((s) => s.error));
  const pendingQuote = useQaStore(useShallow((s) => s.pendingQuote));
  const ask = useQaStore(useShallow((s) => s.ask));
  const stop = useQaStore(useShallow((s) => s.stop));
  const clear = useQaStore(useShallow((s) => s.clear));
  const clearError = useQaStore(useShallow((s) => s.clearError));

  const [input, setInput] = useState('');
  const [clearConfirming, setClearConfirming] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 新消息 / 流式输出时滚到底部（流式中跟随输出）
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streamingText, error]);

  const sendQuestion = useCallback(async (
    question: string,
    promptName: QaPromptName = 'doc_qa',
    quote?: QaQuote | null,
  ) => {
    const trimmed = question.trim();
    if (!trimmed || isStreaming) return;
    if (!documentId) return;
    if (!apiKey && onRequireApiKey) {
      onRequireApiKey();
      return;
    }
    setInput('');
    await ask({
      documentId,
      question: trimmed,
      promptName,
      quote,
      apiKey,
      provider,
    });
  }, [ask, documentId, apiKey, provider, onRequireApiKey, isStreaming]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void sendQuestion(input, 'doc_qa', pendingQuote);
    }
  }, [sendQuestion, input, pendingQuote]);

  const handleClear = useCallback(async () => {
    if (!documentId) return;
    await clear(documentId);
    setClearConfirming(false);
  }, [clear, documentId]);

  const hasMessages = messages.length > 0 || isStreaming;

  return (
    <div
      id="qa-panel"
      className="flex-1 min-h-0 flex flex-col border-l border-reader-line transition-colors duration-300"
      style={{ backgroundColor: bgColorValue }}
    >
      {/* Header — hidden on mobile (StudySheet provides its own header) */}
      {!mobile && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-reader-line flex-shrink-0">
          <div className="flex items-center gap-2">
            {onClose && (
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-card transition-colors text-muted-soft hover:text-ink"
                title="关闭面板"
                aria-label="关闭面板"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 17l5-5-5-5M13 17l5-5-5-5" />
                </svg>
              </button>
            )}
            {onSwitchToStudy && (
              <PanelSwitch
                active="qa"
                onChange={(v) => { if (v === 'study') onSwitchToStudy(); }}
              />
            )}
          </div>
          <div className="flex items-center gap-1">
            {hasMessages && (
              clearConfirming ? (
                <div className="flex items-center gap-1 ml-1">
                  <button
                    className="px-2 py-0.5 text-xs text-error hover:bg-error/10 rounded"
                    onClick={handleClear}
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
                  清空对话
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 qa-panel-content">
        {messages.length === 0 && !isStreaming && !isLoadingHistory && (
          <EmptyState
            icon={
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
            }
            title="问问这篇文章"
            description="选中正文任意句子后点「问 AI」，或直接在下方输入问题，例如语法、背景知识、作者立场。"
          />
        )}
        {isLoadingHistory && messages.length === 0 && (
          <div className="text-center text-xs text-muted py-6">正在加载对话记录...</div>
        )}

        {messages.map((msg) => (
          msg.role === 'user' ? (
            <div key={msg.id} className="flex flex-col items-end mb-4">
              {msg.paragraph_index != null && msg.paragraph_index >= 0 && (
                <QuoteChip
                  paragraphIndex={msg.paragraph_index}
                  sentenceIndex={msg.sentence_index}
                  sentenceText={msg.sentence_text}
                  onJump={onJumpToQuote}
                />
              )}
              <div className="max-w-[85%] px-3.5 py-2 rounded-2xl rounded-br-md bg-primary/10 border border-primary/20 text-sm text-ink whitespace-pre-wrap break-words">
                {msg.content}
              </div>
            </div>
          ) : (
            <div key={msg.id} className="mb-4">
              <div className="qa-answer prose-reader text-sm text-ink break-words [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:ml-4">
                <AnswerMarkdown content={msg.content} />
              </div>
            </div>
          )
        ))}

        {/* Streaming answer */}
        {isStreaming && (
          <div className="mb-4">
            <div className="qa-answer prose-reader text-sm text-ink break-words [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:ml-4">
              <ReactMarkdown components={safeMarkdownComponents}>
                {streamingText}
              </ReactMarkdown>
              <span className="inline-block w-[2px] h-4 align-middle bg-primary animate-pulse" aria-hidden="true" />
            </div>
            {!streamingText && (
              <div className="text-xs text-muted flex items-center gap-2">
                <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="var(--primary)" strokeWidth="4" opacity="0.25" />
                  <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="var(--primary)" opacity="0.75" />
                </svg>
                正在思考...
              </div>
            )}
          </div>
        )}

        {error && (
          <ErrorBanner
            message={error}
            className="mb-4"
            action={
              <button
                className="text-xs text-error hover:underline flex-shrink-0"
                onClick={clearError}
              >
                关闭
              </button>
            }
          />
        )}
      </div>

      {/* Quick prompts + input */}
      <div className="flex-shrink-0 border-t border-reader-line px-4 py-3">
        {/* Quick question chips */}
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {pendingQuote && (
            <div className="w-full mb-1">
              <QuoteChip
                paragraphIndex={pendingQuote.paragraphIndex}
                sentenceIndex={pendingQuote.sentenceIndex}
                sentenceText={pendingQuote.sentenceText}
                onJump={onJumpToQuote}
                onRemove={() => useQaStore.getState().setPendingQuote(null)}
              />
            </div>
          )}
            {pendingQuote &&
              QUICK_QUESTIONS_WITH_QUOTE.map((q) => (
                <button
                  key={q}
                  disabled={isStreaming}
                  onClick={() => void sendQuestion(q, 'doc_qa', pendingQuote)}
                  className="px-2.5 py-1 text-xs rounded-full border border-reader-line-soft bg-reader-surface text-body hover:border-primary hover:text-primary disabled:opacity-50 transition-colors"
                >
                  {q}
                </button>
              ))}
          <button
            disabled={isStreaming}
            onClick={() => void sendQuestion('请针对这篇文章出 3 道阅读理解题', 'doc_quiz', pendingQuote)}
            className="px-2.5 py-1 text-xs rounded-full border border-reader-line-soft bg-reader-surface text-body hover:border-primary hover:text-primary disabled:opacity-50 transition-colors"
          >
            出 3 道阅读理解题
          </button>
        </div>

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，Enter 发送，Shift+Enter 换行"
            rows={Math.min(4, Math.max(1, input.split('\n').length))}
            className="flex-1 min-h-[38px] max-h-24 px-3 py-2 rounded-lg border border-reader-line-soft bg-reader-surface text-sm text-ink placeholder:text-muted-soft resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)] transition-colors"
            disabled={isStreaming}
          />
          {isStreaming ? (
            <Button variant="secondary" size="sm" onClick={stop}>
              停止
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              disabled={!input.trim() || !documentId}
              onClick={() => void sendQuestion(input, 'doc_qa', pendingQuote)}
            >
              发送
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 引用句小卡：点击定位到原文（有句索引则精确跳到句子，否则整段定位） */
function QuoteChip({
  paragraphIndex,
  sentenceIndex,
  sentenceText,
  onRemove,
  onJump,
}: {
  paragraphIndex: number;
  sentenceIndex?: number | null;
  sentenceText?: string | null;
  onRemove?: () => void;
  onJump?: (paragraphIndex: number, sentenceIndex: number | null) => void;
}) {
  const handleClick = useCallback(() => {
    if (onJump) {
      onJump(paragraphIndex, sentenceIndex ?? null);
      return;
    }
    if (sentenceIndex != null) {
      scrollToSentence(paragraphIndex, sentenceIndex, { block: 'center', retries: 1 });
    } else {
      scrollToParagraph(paragraphIndex, { block: 'center', retries: 1 });
    }
  }, [paragraphIndex, sentenceIndex, onJump]);

  return (
    <div
      className="max-w-[85%] flex items-start gap-1.5 px-2.5 py-1.5 mb-1 rounded-lg border-l-2 border-primary bg-reader-surface text-xs text-muted cursor-pointer hover:brightness-[0.97] transition-all group"
      onClick={handleClick}
      title={sentenceIndex != null ? '点击定位到原文对应句子' : '点击定位到原文段落'}
    >
      <span className="flex-1 italic line-clamp-2 break-words">
        {sentenceText ? `「${sentenceText}」` : `第 ${paragraphIndex + 1} 段`}
      </span>
      {onRemove && (
        <button
          className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded text-muted-soft hover:text-error transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="移除引用"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
