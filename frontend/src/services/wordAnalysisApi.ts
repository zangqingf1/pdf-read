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
    antonyms: Array<{ word: string; part_of_speech: string }>;
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
  type?: 'done' | 'error' | 'batch' | 'chunk';
  analyses?: WordAnalysisResult[];
  /** Raw text delta from AI token streaming */
  text?: string;
  /** Which batch this chunk/result belongs to */
  batch_id?: number;
  /** Words in this batch */
  words?: string[];
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
    throw new Error(`单词解析失败 (${response.status}): ${text}`);
  }

  if (!response.body) {
    throw new Error('浏览器不支持流式读取');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const allResults: WordAnalysisResult[] = [];
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
        const event: WordAnalysisSSEEvent = JSON.parse(jsonStr);

        if (event.type === 'done') {
          return allResults;
        }
        if (event.type === 'error') {
          throw new Error(event.message || '单词解析失败');
        }
        if (event.type === 'chunk' && event.text && event.batch_id != null) {
          // Raw AI text token — forward to streaming display
          onChunk({
            batch_id: event.batch_id,
            text: event.text,
            words: event.words || [],
            para_index: event.para_index || 0,
          });
        }
        if (event.type === 'batch' && event.analyses) {
          allResults.push(...event.analyses);
          onProgress(event.analyses);
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('单词解析')) {
          throw e;
        }
        console.warn('SSE parse error:', e);
      }
    }
  }

  return allResults;
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
