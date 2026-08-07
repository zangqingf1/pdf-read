import api from './api';
import { getStoredToken } from './authApi';
import type { AIProvider } from './translateApi';

export interface SentenceEntry {
  paragraph_index: number;
  sentence_index: number;
  sentence_text: string;
  sentence_translation?: string | null;
}

export interface SentenceAnalysisResult {
  id?: string | null;
  paragraph_index: number;
  sentence_index: number;
  sentence_text: string;
  /** Raw markdown from AI: 原文/主干/讲解/译文 */
  content: string;
  /** Frontend-only flag: true while waiting for streaming result */
  _pending?: boolean;
}

export interface SentenceAnalysisRequest {
  entries: SentenceEntry[];
  api_key?: string;
  document_id: string;
  provider?: AIProvider;
}

export interface SentenceAnalysisResponse {
  analyses: SentenceAnalysisResult[];
}

export async function analyzeSentences(
  entries: SentenceEntry[],
  documentId: string,
  apiKey?: string,
  provider?: AIProvider
): Promise<SentenceAnalysisResponse> {
  const { data } = await api.post<SentenceAnalysisResponse>(
    '/sentences/analyze',
    {
      entries,
      api_key: apiKey || undefined,
      document_id: documentId,
      provider: provider || undefined,
    },
    {
      timeout: 180000,
    }
  );
  return data;
}

/** SSE event from the streaming sentence analysis endpoint */
export interface SentenceAnalysisSSEEvent {
  type?: 'done' | 'error' | 'batch' | 'chunk' | 'heartbeat';
  analyses?: SentenceAnalysisResult[];
  /** Raw text delta from AI token streaming */
  text?: string;
  /** Which sentence this chunk/result belongs to */
  para_index?: number;
  sentence_index?: number;
  code?: number;
  message?: string;
}

/** Callback for raw AI text streaming chunks */
export type OnSentenceChunkCallback = (chunk: { text: string; para_index: number; sentence_index: number }) => void;

/**
 * Analyze sentences via SSE streaming — raw AI text arrives token-by-token
 * through `onChunk`, and completed results arrive through `onProgress`.
 *
 * Returns the full analyses array on success, or throws on error.
 */
export async function analyzeSentencesStream(
  entries: SentenceEntry[],
  documentId: string,
  onProgress: (analyses: SentenceAnalysisResult[]) => void,
  onChunk: OnSentenceChunkCallback,
  apiKey?: string,
  provider?: AIProvider,
  signal?: AbortSignal
): Promise<SentenceAnalysisResult[]> {
  const baseUrl = api.defaults.baseURL || '/api/v1';
  const url = `${baseUrl}/sentences/stream`;

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
        entries,
        api_key: apiKey || undefined,
        document_id: documentId,
        provider: provider || undefined,
      }),
      signal: combinedSignal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`句子解析失败 (${response.status}): ${text}`);
  }

  if (!response.body) {
    throw new Error('浏览器不支持流式读取');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const allResults: SentenceAnalysisResult[] = [];
  let buffer = '';

  // ── Per-read timeout: 300 s without data = connection likely dead ──
  // 后端慢批次时每 60s 发一次 heartbeat, 正常等待不会误杀。
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

        // 仅 JSON 解析失败在此吞掉 — 业务错误 (error/done) 直接 throw,
        // 不再依赖 message 匹配 (后端 401/429/504 提示文案不含"句子解析")
        let event: SentenceAnalysisSSEEvent;
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
          return allResults;
        }
        if (event.type === 'error') {
          throw new Error(event.message || '句子解析失败');
        }
        if (event.type === 'chunk' && event.text && event.para_index != null && event.sentence_index != null) {
          // Raw AI text token — forward to streaming display
          onChunk({
            text: event.text,
            para_index: event.para_index,
            sentence_index: event.sentence_index,
          });
        }
        if (event.type === 'batch' && event.analyses) {
          allResults.push(...event.analyses);
          onProgress(event.analyses);
        }
      }
    }
  } catch (err: any) {
    // Distinguish timeout from user-initiated abort
    if (err.name === 'AbortError') {
      if (timedOut && !signal?.aborted) {
        throw new Error('句子解析超时，AI 服务响应过慢，请减少选中句子数量后重试');
      }
      // User-initiated abort — re-throw so caller can ignore it
      throw err;
    }
    throw err;
  }

  return allResults;
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

export async function getSentenceAnalyses(
  documentId: string
): Promise<SentenceAnalysisResponse> {
  const { data } = await api.get<SentenceAnalysisResponse>(
    `/sentences/list/${documentId}`
  );
  return data;
}

export async function deleteSentenceAnalysis(
  analysisId: string
): Promise<void> {
  await api.delete(`/sentences/${analysisId}`);
}

export async function deleteAllSentenceAnalyses(
  documentId: string
): Promise<void> {
  // Use POST as primary method — some proxies don't forward DELETE reliably.
  // The backend accepts both DELETE and POST on this endpoint.
  try {
    await api.post(`/sentences/document/${documentId}`);
  } catch (postErr: any) {
    // Fallback to DELETE if POST fails (e.g., backend not updated yet)
    if (postErr?.response?.status === 405 || postErr?.response?.status === 404) {
      await api.delete(`/sentences/document/${documentId}`);
    } else {
      throw postErr;
    }
  }
}
