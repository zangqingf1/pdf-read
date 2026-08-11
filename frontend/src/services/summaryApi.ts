import api from './api';
import { getStoredToken } from './authApi';
import type { AIProvider } from './translateApi';

export interface SummaryStreamRequest {
  document_id: string;
  mode: 'generate' | 'revise';
  /** 用户总结草稿 — mode=revise 时必填 */
  user_summary?: string;
  api_key?: string;
  provider?: AIProvider;
}

/** SSE event from the streaming summary endpoint */
export interface SummarySSEEvent {
  type?: 'chunk' | 'done' | 'error' | 'heartbeat';
  /** chunk 事件: 原始文本增量 */
  text?: string;
  /** done 事件: 完整总结 */
  summary?: string;
  code?: number;
  message?: string;
}

/**
 * Generate (or revise) a full-document summary via SSE streaming —
 * raw AI text arrives token-by-token through `onChunk`.
 *
 * Returns the full summary on success, or throws on error.
 */
export async function generateSummaryStream(
  body: SummaryStreamRequest,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const baseUrl = api.defaults.baseURL || '/api/v1';
  const url = `${baseUrl}/summary/stream`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getStoredToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // ── Timeout: abort if the stream hasn't finished within 5 minutes ──
  const STREAM_TIMEOUT_MS = 5 * 60 * 1000; // 5 min
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), STREAM_TIMEOUT_MS);
  let timedOut = false;
  timeoutController.signal.addEventListener('abort', () => { timedOut = true; });

  // Combine the external signal (user cancel) with our timeout signal
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
        mode: body.mode,
        user_summary: body.mode === 'revise' ? body.user_summary : undefined,
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
    throw new Error(`总结失败 (${response.status}): ${text}`);
  }

  if (!response.body) {
    throw new Error('浏览器不支持流式读取');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // ── Per-read timeout: 300 s without data = connection likely dead ──
  // 后端慢生成时每 60s 发一次 heartbeat, 正常等待不会误杀。
  const READ_TIMEOUT_MS = 300_000;

  try {
    while (true) {
      // Re-arm timeout controller for each read
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

        let event: SummarySSEEvent;
        try {
          event = JSON.parse(jsonStr);
        } catch (e) {
          console.warn('SSE parse error:', e);
          continue;
        }

        if (event.type === 'heartbeat') {
          // 保活信号 — 收到即重置读超时计时, 无需其他处理
          continue;
        }
        if (event.type === 'done') {
          return event.summary || '';
        }
        if (event.type === 'error') {
          throw new Error(event.message || '总结失败');
        }
        if (event.type === 'chunk' && event.text) {
          onChunk(event.text);
        }
      }
    }
  } catch (err: any) {
    // Distinguish timeout from user-initiated abort
    if (err.name === 'AbortError') {
      if (timedOut && !signal?.aborted) {
        throw new Error('总结生成超时，AI 服务响应过慢，请稍后重试');
      }
      // User-initiated abort — re-throw so caller can ignore it
      throw err;
    }
    throw err;
  }

  return '';
}

/** Persist the current summary text (user draft or latest AI result). */
export async function saveSummaryDraft(
  documentId: string,
  summary: string
): Promise<void> {
  await api.put('/summary/draft', {
    document_id: documentId,
    summary,
  });
}

/** Combine two AbortSignals — when either fires, the combined signal fires. */
function combineAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  // If either is already aborted, fire immediately
  if (a.aborted || b.aborted) controller.abort();
  return controller.signal;
}
