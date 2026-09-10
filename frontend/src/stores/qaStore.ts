import { create } from 'zustand';
import {
  fetchQaMessages,
  streamQaAnswer,
  clearQaMessages,
  type QaMessage,
  type QaPromptName,
} from '../services/qaApi';

/** 引用句：选中文本后「问 AI」带入面板的目标句 */
export interface QaQuote {
  paragraphIndex: number;
  /** 引用句在所在段落内的句子索引（精确跳句/落库用） */
  sentenceIndex: number;
  sentenceText: string;
}

interface QaState {
  /** 已加载会话的文档 id — 切文档时据此懒加载/重置 */
  loadedDocumentId: string | null;
  messages: QaMessage[];
  isLoadingHistory: boolean;
  isStreaming: boolean;
  error: string | null;
  /** 生成中的原始流式文本（最后一条 assistant 消息的实时内容） */
  streamingText: string;
  /** 下一条问题要引用的目标句（发送后清空） */
  pendingQuote: QaQuote | null;

  /** 切换文档时调用：重置状态并懒加载历史会话（仅拉取一次） */
  loadConversation: (documentId: string) => Promise<void>;
  /** 丢弃未持久化的内存状态（文档卸载时） */
  reset: () => void;
  setPendingQuote: (quote: QaQuote | null) => void;
  clearError: () => void;

  /**
   * 发送一问并流式接收回答（乐观追加 user 消息）。
   * quote 非空时覆盖 pendingQuote 作为本轮引用句。
   * 返回是否成功（用户 abort 视为成功——不报错）。
   */
  ask: (params: {
    documentId: string;
    question: string;
    promptName?: QaPromptName;
    quote?: QaQuote | null;
    apiKey?: string;
    provider?: 'deepseek';
  }) => Promise<boolean>;

  /** 清空对话（后端删除 + 内存重置） */
  clear: (documentId: string) => Promise<void>;
  /** 中止当前生成（已生成的部分文本保留在本地，未持久化） */
  stop: () => void;
}

/** 当前请求的 AbortController（同一时刻最多一个流式请求） */
let activeController: AbortController | null = null;

export const useQaStore = create<QaState>()((set, get) => ({
  loadedDocumentId: null,
  messages: [],
  isLoadingHistory: false,
  isStreaming: false,
  error: null,
  streamingText: '',
  pendingQuote: null,

  loadConversation: async (documentId: string) => {
    if (get().loadedDocumentId === documentId) return;
    set({
      loadedDocumentId: documentId,
      messages: [],
      isLoadingHistory: true,
      isStreaming: false,
      error: null,
      streamingText: '',
      pendingQuote: null,
    });
    try {
      const messages = await fetchQaMessages(documentId);
      // 懒加载竞态：响应回来时文档可能已切走
      if (get().loadedDocumentId !== documentId) return;
      set({ messages, isLoadingHistory: false });
    } catch (e: any) {
      if (get().loadedDocumentId !== documentId) return;
      set({
        isLoadingHistory: false,
        error: e?.message || '加载对话记录失败',
      });
    }
  },

  reset: () =>
    set({
      loadedDocumentId: null,
      messages: [],
      isLoadingHistory: false,
      isStreaming: false,
      error: null,
      streamingText: '',
      pendingQuote: null,
    }),

  setPendingQuote: (quote) => set({ pendingQuote: quote }),
  clearError: () => set({ error: null }),

  ask: async ({ documentId, question, promptName, quote, apiKey, provider }) => {
    if (get().isStreaming) return false;
    const trimmed = question.trim();
    if (!trimmed) return false;

    const activeQuote = quote !== undefined ? quote : get().pendingQuote;
    set((s) => ({
      isStreaming: true,
      error: null,
      streamingText: '',
      pendingQuote: null,
      messages: [
        ...s.messages,
        {
          id: -Date.now(), // 临时负 id，done 后由后端持久化的行替换会话
          role: 'user' as const,
          content: trimmed,
          paragraph_index: activeQuote?.paragraphIndex ?? null,
          sentence_index: activeQuote?.sentenceIndex ?? null,
          sentence_text: activeQuote?.sentenceText ?? null,
          created_at: '',
        },
      ],
    }));

    const controller = new AbortController();
    activeController = controller;
    try {
      await streamQaAnswer(
        {
          document_id: documentId,
          question: trimmed,
          prompt_name: promptName,
          target_paragraph_index: activeQuote?.paragraphIndex,
          target_sentence_index: activeQuote?.sentenceIndex,
          target_sentence: activeQuote?.sentenceText,
          api_key: apiKey,
          provider,
        },
        (text) => {
          set((s) => ({ streamingText: s.streamingText + text }));
        },
        controller.signal
      );
      // 成功：流式文本并入一条 assistant 消息（后端已持久化，前端本地对齐）
      set((s) => ({
        isStreaming: false,
        streamingText: '',
        messages: [
          ...s.messages,
          {
            id: -Date.now() - 1,
            role: 'assistant' as const,
            content: s.streamingText,
            prompt_name: promptName ?? 'doc_qa',
            created_at: '',
          },
        ],
      }));
      return true;
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        // 用户主动取消：保留已生成的部分文本为 assistant 消息（未持久化）
        set((s) => ({
          isStreaming: false,
          streamingText: '',
          messages: s.streamingText
            ? [
                ...s.messages,
                {
                  id: -Date.now() - 1,
                  role: 'assistant' as const,
                  content: s.streamingText,
                  prompt_name: promptName ?? 'doc_qa',
                  created_at: '',
                },
              ]
            : s.messages,
        }));
        return true;
      }
      set({
        isStreaming: false,
        streamingText: '',
        error: e?.message || '问答失败',
      });
      return false;
    } finally {
      activeController = null;
    }
  },

  clear: async (documentId: string) => {
    try {
      await clearQaMessages(documentId);
    } catch {
      // 后端清理失败不阻塞本地清空（下次 done 落库时以服务端为准）
    }
    set({ messages: [], error: null, streamingText: '', pendingQuote: null });
  },

  stop: () => {
    activeController?.abort();
    activeController = null;
  },
}));
