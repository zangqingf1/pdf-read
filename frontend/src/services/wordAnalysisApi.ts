import api from './api';
import { getStoredToken } from './authApi';
import type { AIProvider } from './translateApi';

export interface WordEntry {
  paragraph_index: number;
  words: string[];
  sentence: string;
  sentence_translation?: string | null;
}

export interface WordAnalysisResult {
  id?: string | null;
  paragraph_index: number;
  word: string;
  phonetic: string;
  part_of_speech: string;
  definition: string;
  definition_zh: string;
  collocations: string[];
  example_sentence: string;
  cognates: Array<{ word: string; part_of_speech: string }>;
  synonyms_antonyms: {
    synonyms: Array<{ word: string; part_of_speech: string }>;
  };
  base_form: string;
  plural_form: string;
  /** Frontend-only flag: true while waiting for streaming result */
  _pending?: boolean;
}

export interface WordAnalysisRequest {
  entries: WordEntry[];
  api_key?: string;
  document_id: string;
  provider?: AIProvider;
}

export interface WordAnalysisResponse {
  analyses: WordAnalysisResult[];
}

export async function analyzeWords(
  entries: WordEntry[],
  documentId: string,
  apiKey?: string,
  provider?: AIProvider
): Promise<WordAnalysisResponse> {
  const { data } = await api.post<WordAnalysisResponse>(
    '/words/analyze',
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

/** SSE event from the streaming word analysis endpoint */
export interface WordAnalysisSSEEvent {
  type?: 'done' | 'error' | 'batch' | 'chunk' | 'incomplete' | 'heartbeat';
  analyses?: WordAnalysisResult[];
  /** Raw text delta from AI token streaming */
  text?: string;
  /** Which batch this chunk/result belongs to */
  batch_id?: number;
  /** chunk 事件: 本批单词; incomplete 事件: 缺失单词 [{para_index, word}] */
  words?: string[] | Array<{ para_index: number; word: string }>;
  /** Paragraph index for this batch */
  para_index?: number;
  code?: number;
  message?: string;
}

/** Callback for raw AI text streaming chunks */
export type OnChunkCallback = (chunk: { batch_id: number; text: string; words: string[]; para_index: number }) => void;

/**
 * Analyze words via SSE streaming — raw AI text arrives token-by-token
 * through `onChunk`, and completed batches arrive through `onProgress`.
 *
 * Returns the full analyses array on success, or throws on error.
 */
export async function analyzeWordsStream(
  entries: WordEntry[],
  documentId: string,
  onProgress: (analyses: WordAnalysisResult[]) => void,
  onChunk: OnChunkCallback,
  apiKey?: string,
  provider?: AIProvider,
  signal?: AbortSignal
): Promise<WordAnalysisResult[]> {
  const baseUrl = api.defaults.baseURL || '/api/v1';
  const url = `${baseUrl}/words/stream`;

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
    throw new Error(`单词解析失败 (${response.status}): ${text}`);
  }

  if (!response.body) {
    throw new Error('浏览器不支持流式读取');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const allResults: WordAnalysisResult[] = [];
  let buffer = '';

  // ── Per-read timeout: 300 s without data = connection likely dead ──
  // 后端慢批次时每 60s 发一次 heartbeat, 正常等待不会误杀;
  // 5 分钟无任何数据才判定连接死亡。
  const READ_TIMEOUT_MS = 300_000;

  // ── Chunk throttling: merge token deltas per batch, flush every ~80ms ──
  // 并发批次多时 token 级事件可达每秒数百次, 每条都触发 React 更新
  // 会拖垮渲染 (选中单词越多越明显)。合并后更新频率降到 ~12 次/秒。
  const CHUNK_FLUSH_MS = 80;
  const chunkBuffers = new Map<number, { text: string; words: string[]; paraIndex: number }>();
  const chunkTimers = new Map<number, ReturnType<typeof setTimeout>>();

  const flushChunkBuffer = (batchId: number) => {
    const buf = chunkBuffers.get(batchId);
    if (buf && buf.text) {
      onChunk({
        batch_id: batchId,
        text: buf.text,
        words: buf.words,
        para_index: buf.paraIndex,
      });
    }
    chunkBuffers.delete(batchId);
    chunkTimers.delete(batchId);
  };

  const scheduleChunkFlush = (batchId: number) => {
    if (chunkTimers.has(batchId)) return;
    chunkTimers.set(batchId, setTimeout(() => flushChunkBuffer(batchId), CHUNK_FLUSH_MS));
  };

  const flushAllChunks = () => {
    for (const batchId of [...chunkTimers.keys()]) flushChunkBuffer(batchId);
  };

  // ── Words that failed after backend compensation — surfaced on completion ──
  const incompleteWords: Array<{ para_index: number; word: string }> = [];

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

        // 仅 JSON 解析失败在此吞掉 — 业务错误 (error/incomplete/done)
        // 直接 throw, 不再依赖 message 匹配 (后端 401/429/504 的
        // 提示文案不含"单词解析", 旧实现会静默吞掉这些错误)
        let event: WordAnalysisSSEEvent;
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
          flushAllChunks();
          // 后端补偿后仍有失败单词 → 明确提示, 而不是静默丢失
          if (incompleteWords.length > 0) {
            const unique = [...new Set(incompleteWords.map((w) => w.word))];
            const names = unique.slice(0, 10).join(', ');
            const more = unique.length > 10 ? ` 等 ${unique.length} 个` : '';
            throw new Error(`以下单词未能解析${more}: ${names} — 可减少选中数量后重试`);
          }
          return allResults;
        }
        if (event.type === 'error') {
          flushAllChunks();
          throw new Error(event.message || '单词解析失败');
        }
        if (event.type === 'incomplete' && Array.isArray(event.words)) {
          incompleteWords.push(...(event.words as Array<{ para_index: number; word: string }>));
          continue;
        }
        if (event.type === 'chunk' && event.text && event.batch_id != null) {
          // Merge token deltas per batch — flush on a timer
          const batchId = event.batch_id;
          const existing = chunkBuffers.get(batchId);
          if (existing) {
            existing.text += event.text;
          } else {
            chunkBuffers.set(batchId, {
              text: event.text,
              words: (event.words as string[]) || [],
              paraIndex: event.para_index || 0,
            });
            scheduleChunkFlush(batchId);
          }
        }
        if (event.type === 'batch' && event.analyses) {
          allResults.push(...event.analyses);
          onProgress(event.analyses);
        }
      }
    }
  } catch (err: any) {
    flushAllChunks();
    // Distinguish timeout from user-initiated abort
    if (err.name === 'AbortError') {
      if (timedOut && !signal?.aborted) {
        throw new Error('单词解析超时，AI 服务响应过慢，请减少选中单词数量后重试');
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

export async function getWordAnalyses(
  documentId: string
): Promise<WordAnalysisResponse> {
  const { data } = await api.get<WordAnalysisResponse>(
    `/words/list/${documentId}`
  );
  return data;
}

export async function deleteWordAnalysis(
  analysisId: string
): Promise<void> {
  await api.delete(`/words/${analysisId}`);
}

export async function deleteAllWordAnalyses(
  documentId: string
): Promise<void> {
  // Use POST as primary method — some proxies don't forward DELETE reliably.
  // The backend accepts both DELETE and POST on this endpoint.
  try {
    await api.post(`/words/document/${documentId}`);
  } catch (postErr: any) {
    // Fallback to DELETE if POST fails (e.g., backend not updated yet)
    if (postErr?.response?.status === 405 || postErr?.response?.status === 404) {
      await api.delete(`/words/document/${documentId}`);
    } else {
      throw postErr;
    }
  }
}
