import api from './api';

export interface TranslateRequest {
  paragraphs: string[];
  api_key?: string;
  document_id?: string;
}

export interface TranslateResponse {
  translations: string[];
}

export async function translateParagraphs(
  paragraphs: string[],
  apiKey?: string,
  documentId?: string
): Promise<TranslateResponse> {
  const { data } = await api.post<TranslateResponse>(
    '/translate',
    {
      paragraphs,
      api_key: apiKey || undefined,
      document_id: documentId || undefined,
    },
    {
      timeout: 180000, // 3 minutes for long articles
    }
  );
  return data;
}
