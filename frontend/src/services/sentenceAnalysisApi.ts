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
  type?: 'done' | 'error' | 'batch' | 'chunk';
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

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      entries,
      api_key: apiKey || undefined,
      document_id: documentId,
      provider: provider || undefined,
    }),
    signal,
  });

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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6);
      try {
        const event: SentenceAnalysisSSEEvent = JSON.parse(jsonStr);

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
      } catch (e) {
        if (e instanceof Error && e.message.includes('句子解析')) {
          throw e;
        }
        console.warn('SSE parse error:', e);
      }
    }
  }

  return allResults;
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
