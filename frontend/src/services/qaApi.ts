import api from './api';
import { getStoredToken } from './authApi';
import type { AIProvider } from './translateApi';

export type QaPromptName = 'doc_qa' | 'doc_quiz';

/** 一条已持久化的问答消息（后端 qa_messages 表） */
export interface QaMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  prompt_name?: string | null;
  paragraph_index?: number | null;
  /** 引用句在所在段落内的句子索引（user 行持久化，旧数据可能缺失） */
  sentence_index?: number | null;
  /** 引用句原文（user 行持久化；旧历史数据无此字段） */
  sentence_text?: string | null;
  created_at: string;
}

export interface QaStreamRequestBody {
  document_id: string;
  question: string;
  /** 出题批改轮次走 doc_quiz 模板；默认普通问答 */
  prompt_name?: QaPromptName;
  /** 引用句所在段落（可选） */
  target_paragraph_index?: number;
  /** 引用句在段内的句子索引（可选） */
  target_sentence_index?: number;
  /** 引用句原文（可选） */
  target_sentence?: string;
  api_key?: string;
  provider?: AIProvider;
}

/** SSE event from the streaming QA endpoint */
export interface QaSSEEvent {
  type?: 'chunk' | 'done' | 'error' | 'heartbeat';
  /** chunk 事件: 原始文本增量 */
  text?: string;
  code?: number;
  message?: string;
}

/**
 * Ask one QA turn via SSE streaming — raw AI text arrives token-by-token
 * through `onChunk`.  Conversation history is replayed server-side and both
 * turns are persisted there on completion.
 *
 * Resolves on done, or throws on error / user abort.
 */
export async function streamQaAnswer(
  body: QaStreamRequestBody,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const baseUrl = api.defaults.baseURL || '/api/v1';
  const url = `${baseUrl}/qa/stream`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getStoredToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // ── Timeout: abort if the stream hasn't finished within 5 minutes ──
  const STREAM_TIMEOUT_MS = 5 * 60 * 1000;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), STREAM_TIMEOUT_MS);
  let timedOut = false;
  timeoutController.signal.addEventListener('abort', () => { timedOut = true; });

  const combinedSignal = signal
    ? combineAbortSignals(signal, timeoutController.signal)
    : timeoutController.signal;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        document_id: body.document_id,
        question: body.question,
        prompt_name: body.prompt_name || undefined,
        target_paragraph_index: body.target_paragraph_index ?? undefined,
        target_sentence_index: body.target_sentence_index ?? undefined,
        target_sentence: body.target_sentence || undefined,
        api_key: body.api_key || undefined,
        provider: body.provider || undefined,
      }),
      signal: combinedSignal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`问答失败 (${response.status}): ${text}`);
  }

  if (!response.body) {
    throw new Error('浏览器不支持流式读取');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // ── Chunk throttling: merge token deltas, flush every ~80ms ──
  const CHUNK_FLUSH_MS = 80;
  let chunkBuffer = '';
  let chunkTimer: ReturnType<typeof setTimeout> | null = null;

  const flushChunk = () => {
    if (chunkBuffer) {
      onChunk(chunkBuffer);
      chunkBuffer = '';
    }
    if (chunkTimer) {
      clearTimeout(chunkTimer);
      chunkTimer = null;
    }
  };

  const scheduleChunkFlush = () => {
    if (chunkTimer) return;
    chunkTimer = setTimeout(flushChunk, CHUNK_FLUSH_MS);
  };

  // ── Per-read timeout: 300 s without data = connection likely dead ──
  const READ_TIMEOUT_MS = 300_000;

  try {
    while (true) {
      const readTimeoutId = setTimeout(() => timeoutController.abort(), READ_TIMEOUT_MS);
      let done: boolean;
      let value: Uint8Array;
      try {
        const readResult = await reader.read();
        done = readResult.done;
        value = readResult.value || new Uint8Array(0);
      } finally {
        clearTimeout(readTimeoutId);
      }
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6);

        let event: QaSSEEvent;
        try {
          event = JSON.parse(jsonStr);
        } catch (e) {
          console.warn('SSE parse error:', e);
          continue;
        }

        if (event.type === 'heartbeat') {
          continue;
        }
        if (event.type === 'done') {
          flushChunk();
          return;
        }
        if (event.type === 'error') {
          flushChunk();
          throw new Error(event.message || '问答失败');
        }
        if (event.type === 'chunk' && event.text) {
          chunkBuffer += event.text;
          scheduleChunkFlush();
        }
      }
    }
  } catch (err: any) {
    flushChunk();
    if (err.name === 'AbortError') {
      if (timedOut && !signal?.aborted) {
        throw new Error('回答生成超时，AI 服务响应过慢，请稍后重试');
      }
      throw err;
    }
    throw err;
  }
}

/** Load the persisted conversation for a document (oldest first). */
export async function fetchQaMessages(documentId: string): Promise<QaMessage[]> {
  const resp = await api.get<{ document_id: string; messages: QaMessage[] }>(
    `/qa/messages/${documentId}`
  );
  return resp.data.messages;
}

/** Delete the whole conversation for a document. */
export async function clearQaMessages(documentId: string): Promise<number> {
  const resp = await api.delete<{ document_id: string; deleted: number }>(
    `/qa/messages/${documentId}`
  );
  return resp.data.deleted;
}

/** Combine two AbortSignals — when either fires, the combined signal fires. */
function combineAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  if (a.aborted || b.aborted) controller.abort();
  return controller.signal;
}
