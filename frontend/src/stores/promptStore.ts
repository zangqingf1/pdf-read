import { create } from 'zustand';
import type { PromptTemplate, PromptTemplateUpdateRequest } from '../services/promptApi';
import {
  getPromptTemplates,
  updatePromptTemplate,
  resetPromptTemplate,
  resetAllPromptTemplates,
} from '../services/promptApi';

interface PromptStoreState {
  templates: PromptTemplate[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  fetchTemplates: () => Promise<void>;
  updateTemplate: (name: string, body: PromptTemplateUpdateRequest) => Promise<void>;
  resetTemplate: (name: string) => Promise<void>;
  resetAllTemplates: () => Promise<void>;
  clearError: () => void;
}

export const usePromptStore = create<PromptStoreState>((set, get) => ({
  templates: [],
  isLoading: false,
  isSaving: false,
  error: null,

  fetchTemplates: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await getPromptTemplates();
      set({ templates: data.templates, isLoading: false });
    } catch (e: any) {
      set({
        isLoading: false,
        error: e?.response?.data?.detail || e?.message || 'Failed to fetch templates',
      });
    }
  },

  updateTemplate: async (name: string, body: PromptTemplateUpdateRequest) => {
    set({ isSaving: true, error: null });
    try {
      const updated = await updatePromptTemplate(name, body);
      const templates = get().templates.map((t) =>
        t.name === name ? updated : t
      );
      set({ templates, isSaving: false });
    } catch (e: any) {
      set({
        isSaving: false,
        error: e?.response?.data?.detail || e?.message || 'Failed to save template',
      });
    }
  },

  resetTemplate: async (name: string) => {
    set({ isSaving: true, error: null });
    try {
      const reset = await resetPromptTemplate(name);
      const templates = get().templates.map((t) =>
        t.name === name ? reset : t
      );
      set({ templates, isSaving: false });
    } catch (e: any) {
      set({
        isSaving: false,
        error: e?.response?.data?.detail || e?.message || 'Failed to reset template',
      });
    }
  },

  resetAllTemplates: async () => {
    set({ isSaving: true, error: null });
    try {
      const data = await resetAllPromptTemplates();
      set({ templates: data.templates, isSaving: false });
    } catch (e: any) {
      set({
        isSaving: false,
        error: e?.response?.data?.detail || e?.message || 'Failed to reset templates',
      });
    }
  },

  clearError: () => set({ error: null }),
}));
