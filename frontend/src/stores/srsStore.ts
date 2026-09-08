import { create } from 'zustand';
import {
  getSrsQueue,
  getSrsStats,
  resetSrsCard,
  setCardMastered,
  submitSrsReview,
  type SrsCard,
  type SrsCounts,
  type SrsRating,
  type SrsStats,
} from '../services/srsApi';

interface SrsState {
  /** 当前复习队列（本次 session 内逐个消费） */
  queue: SrsCard[];
  counts: SrsCounts | null;
  stats: SrsStats | null;
  /** 已复习的卡片（本次 session 内，含评分结果） */
  reviewed: SrsCard[];
  loading: boolean;
  submitting: boolean;
  error: string | null;

  fetchQueue: (limit?: number) => Promise<void>;
  fetchStats: () => Promise<void>;
  /** 对当前卡评分：成功后卡片移入 reviewed，队列前进 */
  review: (card: SrsCard, rating: SrsRating) => Promise<void>;
  toggleMastered: (card: SrsCard, mastered: boolean) => Promise<void>;
  reset: (entryId: string) => Promise<void>;
  clearError: () => void;
}

export const useSrsStore = create<SrsState>((set, get) => ({
  queue: [],
  counts: null,
  stats: null,
  reviewed: [],
  loading: false,
  submitting: false,
  error: null,

  fetchQueue: async (limit = 20) => {
    set({ loading: true, error: null });
    try {
      const res = await getSrsQueue(limit);
      set({ queue: res.items, counts: res.counts, reviewed: [] });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '加载复习队列失败';
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },

  fetchStats: async () => {
    try {
      const stats = await getSrsStats();
      set({ stats });
    } catch {
      // stats 属于锦上添花，失败不打扰主流程
    }
  },

  review: async (card, rating) => {
    set({ submitting: true, error: null });
    try {
      const updated = await submitSrsReview(card.id, rating);
      set((s) => ({
        queue: s.queue.filter((it) => it.id !== card.id),
        reviewed: [updated, ...s.reviewed],
        counts: s.counts
          ? { ...s.counts, due_total: Math.max(0, s.counts.due_total - 1) }
          : s.counts,
      }));
      // 静默刷新统计（今日已复习数）
      void get().fetchStats();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '提交评分失败';
      set({ error: message });
    } finally {
      set({ submitting: false });
    }
  },

  toggleMastered: async (card, mastered) => {
    try {
      const updated = await setCardMastered(card.id, mastered);
      set((s) => ({
        queue: s.queue.filter((it) => it.id !== card.id),
        reviewed: mastered ? [{ ...card, ...updated }, ...s.reviewed] : s.reviewed,
        counts: s.counts
          ? {
              ...s.counts,
              due_total: mastered
                ? Math.max(0, s.counts.due_total - 1)
                : s.counts.due_total,
              mastered_total: Math.max(0, s.counts.mastered_total + (mastered ? 1 : 0)),
            }
          : s.counts,
      }));
      void get().fetchStats();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '操作失败';
      set({ error: message });
    }
  },

  reset: async (entryId) => {
    try {
      await resetSrsCard(entryId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '重置失败';
      set({ error: message });
    }
  },

  clearError: () => set({ error: null }),
}));
