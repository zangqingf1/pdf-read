import api from './api';

export interface VocabularySource {
  document_id: string;
  document_title: string | null;
  added_at: string | null;
  paragraph_index: number | null;
  token_rank: number | null;
}

export interface VocabularyEntry {
  id: string;
  word: string;
  word_original: string;
  phonetic: string;
  pos: string;
  translation: string;
  definition_en: string;
  source_document_id: string | null;
  source_document_title: string | null;
  latest_paragraph_index: number | null;
  latest_token_rank: number | null;
  all_sources: VocabularySource[];
  context_sentence: string | null;
  // Rich analysis fields (raw JSON strings from WordAnalysis, optional for old data)
  definition_zh?: string;
  base_form?: string;
  plural_form?: string;
  synonyms_antonyms?: string;
  cognates?: string;
  collocations?: string;
  exam_tags?: string;
  // SRS 调度状态（简化 SM-2，后端 srs_service）
  srs_due_at?: string | null;
  srs_interval_days?: number;
  srs_ease?: number;
  srs_reps?: number;
  srs_lapses?: number;
  srs_status?: 'active' | 'mastered' | string;
  created_at: string | null;
  updated_at: string | null;
}

/** Parse a JSON-string vocabulary field, falling back on error/empty. */
export function parseVocabJson<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** Parse a raw JSON-string field into the rich structures the card needs. */
export function normalizeVocabRich(entry: VocabularyEntry) {
  return {
    definition_zh: entry.definition_zh || "",
    base_form: entry.base_form || "",
    plural_form: entry.plural_form || "",
    synonyms: parseVocabJson(entry.synonyms_antonyms, { synonyms: [] }).synonyms || [],
    cognates: parseVocabJson(entry.cognates, [] as { word: string; part_of_speech: string }[]),
    collocations: parseVocabJson(entry.collocations, [] as string[]),
    exam_tags: parseVocabJson(entry.exam_tags, [] as string[]),
  };
}

export interface VocabularyListParams {
  page?: number;
  page_size?: number;
  q?: string;
  sort_by?: 'created_at' | 'document_order';
  order?: 'asc' | 'desc';
}

export interface VocabularyListResponse {
  items: VocabularyEntry[];
  total: number;
  page: number;
  page_size: number;
  sort_by: string;
  order: string;
  /** 按添加日期（YYYY-MM-DD）统计的全量条数（跨页），用于日期分组标题 */
  day_counts?: Record<string, number>;
}

export interface BatchAddResponse {
  added: number;
  skipped: number;
  total: number;
  items: VocabularyEntry[];
}

export async function batchAddVocabulary(
  documentId: string,
  words?: string[],
): Promise<BatchAddResponse> {
  const { data } = await api.post<BatchAddResponse>(
    '/vocabulary/batch-add',
    {
      document_id: documentId,
      words: words && words.length > 0 ? words : undefined,
    },
    { timeout: 90000 },
  );
  return data;
}

export async function listVocabulary(params: VocabularyListParams = {}): Promise<VocabularyListResponse> {
  const { data } = await api.get<VocabularyListResponse>('/vocabulary/list', {
    params: {
      page: params.page ?? 1,
      page_size: params.page_size ?? 20,
      q: params.q || undefined,
      sort_by: params.sort_by ?? 'created_at',
      order: params.order ?? 'desc',
    },
  });
  return data;
}

export async function deleteVocabulary(entryId: string): Promise<void> {
  await api.delete(`/vocabulary/${entryId}`);
}

export async function batchDeleteVocabulary(ids: string[]): Promise<{ deleted: number }> {
  const { data } = await api.post<{ deleted: number }>('/vocabulary/batch-delete', { ids });
  return data;
}
