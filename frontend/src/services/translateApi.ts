import api from './api';
import { getStoredToken } from './authApi';

export type AIProvider = 'deepseek';

export interface TranslateRequest {
  paragraphs: string[];
  /** 大标题原文，随段落一并翻译并持久化到 documents.title_zh */
  title?: string;
  api_key?: string;
  document_id?: string;
  indices?: number[];
  provider?: AIProvider;
}

export interface TranslateResponse {
  translations: string[];
  /** 大标题中文翻译（请求带 title 时返回） */
  title_translation?: string;
}

export async function translateParagraphs(
  paragraphs: string[],
  apiKey?: string,
  documentId?: string,
  provider?: AIProvider,
  indices?: number[],
  title?: string
): Promise<TranslateResponse> {
  const { data } = await api.post<TranslateResponse>(
    '/translate',
    {
      paragraphs,
      title: title || undefined,
      api_key: apiKey || undefined,
      document_id: documentId || undefined,
      indices: indices || undefined,
      provider: provider || undefined,
    },
    {
      timeout: 180000, // 3 minutes for long articles
    }
  );
  return data;
}

/** SSE event from the streaming translate endpoint */
export interface TranslateSSEEvent {
  type?: 'done' | 'error' | 'title';
  index?: number;
  translation?: string;
  code?: number;
  message?: string;
}

/**
 * Translate paragraphs via SSE streaming — each translation arrives
 * progressively through the `onProgress` callback as it completes.
 *
 * Returns the full translations array on success, or throws on error.
 */
export async function translateParagraphsStream(
  paragraphs: string[],
  onProgress: (index: number, translation: string) => void,
  apiKey?: string,
  documentId?: string,
  provider?: AIProvider,
  indices?: number[],
  signal?: AbortSignal,
  title?: string,
  onTitle?: (translation: string) => void
): Promise<string[]> {
  const baseUrl = api.defaults.baseURL || '/api/v1';
  const url = `${baseUrl}/translate/stream`;

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
      paragraphs,
      title: title || undefined,
      api_key: apiKey || undefined,
      document_id: documentId || undefined,
      indices: indices || undefined,
      provider: provider || undefined,
    }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`翻译请求失败 (${response.status}): ${text}`);
  }

  if (!response.body) {
    throw new Error('浏览器不支持流式读取');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const translations: string[] = new Array(paragraphs.length).fill('');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // Keep the last potentially incomplete line in the buffer
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6);
      try {
        const event: TranslateSSEEvent = JSON.parse(jsonStr);

        if (event.type === 'done') {
          return translations;
        }
        if (event.type === 'error') {
          throw new Error(event.message || '翻译失败');
        }
        // 大标题翻译事件（先于段落事件到达）
        if (event.type === 'title' && event.translation !== undefined) {
          onTitle?.(event.translation);
          continue;
        }
        if (event.index !== undefined && event.translation !== undefined) {
          translations[event.index] = event.translation;
          onProgress(event.index, event.translation);
        }
      } catch (e) {
        // If it's our own error throw, re-throw it
        if (e instanceof Error && e.message.includes('翻译')) {
          throw e;
        }
        // Otherwise skip malformed events
        console.warn('SSE parse error:', e);
      }
    }
  }

  return translations;
}
