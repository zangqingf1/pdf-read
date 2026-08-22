import { create } from 'zustand';
import {
  batchAddVocabulary,
  batchDeleteVocabulary,
  deleteVocabulary,
  listVocabulary,
  type VocabularyEntry,
  type VocabularyListParams,
} from '../services/vocabularyApi';

interface VocabularyState {
  items: VocabularyEntry[];
  total: number;
  page: number;
  pageSize: number;
  /** 按添加日期（YYYY-MM-DD）统计的全量条数（跨页），来自后端 */
  dayCounts: Record<string, number>;
  query: string;
  sortBy: 'created_at' | 'document_order';
  order: 'asc' | 'desc';
  loading: boolean;
  error: string | null;

  fetchList: (params?: Partial<VocabularyListParams>) => Promise<void>;
  setQuery: (q: string) => void;
  setSort: (sortBy: 'created_at' | 'document_order', order: 'asc' | 'desc') => Promise<void>;
  batchAdd: (documentId: string, words?: string[]) => Promise<{ added: number; skipped: number }>;
  remove: (id: string) => Promise<void>;
  batchRemove: (ids: string[]) => Promise<void>;
}

export const useVocabularyStore = create<VocabularyState>((set, get) => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: 24,
  dayCounts: {},
  query: '',
  sortBy: 'created_at',
  order: 'desc',
  loading: false,
  error: null,

  fetchList: async (params: Partial<VocabularyListParams> = {}) => {
    const state = get();
    const nextPage = params.page ?? state.page;
    const nextQuery = params.q !== undefined ? params.q : state.query;
    const nextSortBy = (params.sort_by as VocabularyState['sortBy']) ?? state.sortBy;
    const nextOrder = (params.order as VocabularyState['order']) ?? state.order;
    const nextPageSize = params.page_size ?? state.pageSize;

    set({ loading: true, error: null });
    try {
      const res = await listVocabulary({
        page: nextPage,
        page_size: nextPageSize,
        q: nextQuery || undefined,
        sort_by: nextSortBy,
        order: nextOrder,
      });
      set({
        items: res.items,
        total: res.total,
        page: res.page,
        pageSize: res.page_size,
        dayCounts: res.day_counts ?? {},
        query: nextQuery,
        sortBy: res.sort_by as VocabularyState['sortBy'],
        order: res.order as VocabularyState['order'],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '加载失败';
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },

  setQuery: (q: string) => {
    set({ query: q, page: 1 });
  },

  setSort: async (sortBy, order) => {
    set({ sortBy, order, page: 1 });
    await get().fetchList({ sort_by: sortBy, order, page: 1 });
  },

  batchAdd: async (documentId, words) => {
    const res = await batchAddVocabulary(documentId, words);
    // Refresh list if we are on vocabulary page context
    return { added: res.added, skipped: res.skipped };
  },

  remove: async (id) => {
    await deleteVocabulary(id);
    set((s) => ({
      items: s.items.filter((it) => it.id !== id),
      total: Math.max(0, s.total - 1),
    }));
  },

  batchRemove: async (ids) => {
    const res = await batchDeleteVocabulary(ids);
    if (res.deleted > 0) {
      set((s) => ({
        items: s.items.filter((it) => !ids.includes(it.id)),
        total: Math.max(0, s.total - res.deleted),
      }));
    }
  },
}));
