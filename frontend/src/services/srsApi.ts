import api from './api';
import type { VocabularyEntry } from './vocabularyApi';

/** 复习评分：0=忘了 1=困难 2=良好 3=简单 */
export type SrsRating = 0 | 1 | 2 | 3;

export interface SrsCard extends VocabularyEntry {
  srs_due_at: string | null;
  srs_interval_days: number;
  srs_ease: number;
  srs_reps: number;
  srs_lapses: number;
  srs_status: 'active' | 'mastered' | string;
  srs_is_learning: boolean;
  /** rating(0-3) → 人性化下次间隔预览（如 "10 分钟" / "2.5 天"），仅展示用 */
  srs_preview: Record<string, string>;
}

export interface SrsCounts {
  new: number;
  learning: number;
  review: number;
  due_total: number;
  mastered_total: number;
}

export interface SrsQueueResponse {
  items: SrsCard[];
  counts: SrsCounts;
}

export interface SrsForecastItem {
  date: string;
  count: number;
}

export interface SrsStats {
  total: number;
  active: number;
  mastered: number;
  due_today: number;
  reviewed_today: number;
  forecast: SrsForecastItem[];
}

export async function getSrsQueue(limit = 20): Promise<SrsQueueResponse> {
  const { data } = await api.get<SrsQueueResponse>('/srs/queue', { params: { limit } });
  return data;
}

export async function submitSrsReview(entryId: string, rating: SrsRating): Promise<SrsCard> {
  const { data } = await api.post<{ entry: SrsCard }>('/srs/review', {
    entry_id: entryId,
    rating,
  });
  return data.entry;
}

export async function setCardMastered(entryId: string, mastered: boolean): Promise<SrsCard> {
  const { data } = await api.post<{ entry: SrsCard }>(`/srs/${entryId}/mastered`, { mastered });
  return data.entry;
}

export async function resetSrsCard(entryId: string): Promise<SrsCard> {
  const { data } = await api.post<{ entry: SrsCard }>(`/srs/${entryId}/reset`);
  return data.entry;
}

export async function getSrsStats(): Promise<SrsStats> {
  const { data } = await api.get<SrsStats>('/srs/stats');
  return data;
}
