import api from './api';

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
  example_sentences: string[];
  example_sentences_zh: string[];
}

export interface WordAnalysisRequest {
  entries: WordEntry[];
  api_key?: string;
  document_id: string;
}

export interface WordAnalysisResponse {
  analyses: WordAnalysisResult[];
}

export async function analyzeWords(
  entries: WordEntry[],
  documentId: string,
  apiKey?: string
): Promise<WordAnalysisResponse> {
  const { data } = await api.post<WordAnalysisResponse>(
    '/words/analyze',
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
