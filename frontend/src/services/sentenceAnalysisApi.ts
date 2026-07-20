import api from './api';

export interface SentenceEntry {
  paragraph_index: number;
  sentence_index: number;
  sentence_text: string;
  sentence_translation?: string | null;
}

export interface StructureItem {
  text: string;
  label: string;
  explanation: string;
}

export interface SentenceAnalysisResult {
  id?: string | null;
  paragraph_index: number;
  sentence_index: number;
  sentence_text: string;
  structure: StructureItem[];
  idiomatic_translation: string;
}

export interface SentenceAnalysisRequest {
  entries: SentenceEntry[];
  api_key?: string;
  document_id: string;
}

export interface SentenceAnalysisResponse {
  analyses: SentenceAnalysisResult[];
}

export async function analyzeSentences(
  entries: SentenceEntry[],
  documentId: string,
  apiKey?: string
): Promise<SentenceAnalysisResponse> {
  const { data } = await api.post<SentenceAnalysisResponse>(
    '/sentences/analyze',
    {
      entries,
      api_key: apiKey || undefined,
      document_id: documentId,
    },
    {
      timeout: 180000,
    }
  );
  return data;
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
