import { create } from 'zustand';
import type { PDFResultResponse, ParagraphResult } from '../services/pdfApi';

interface DocumentState {
  // Document data
  documentId: string | null;
  title: string | null;
  source: string | null;
  paragraphs: ParagraphResult[];
  wordCount: number;
  paragraphCount: number;
  isLoading: boolean;

  // Translations
  translations: Record<number, string>; // paragraph index → Chinese translation
  isTranslating: boolean;

  // Actions
  setDocument: (data: PDFResultResponse) => void;
  setLoading: (loading: boolean) => void;
  setTranslations: (translations: Record<number, string>) => void;
  setIsTranslating: (v: boolean) => void;
  reset: () => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  documentId: null,
  title: null,
  source: null,
  paragraphs: [],
  wordCount: 0,
  paragraphCount: 0,
  isLoading: false,
  translations: {},
  isTranslating: false,

  setDocument: (data) => {
    // Restore translations from stored paragraph data
    const translations: Record<number, string> = {};
    data.paragraphs.forEach((p) => {
      if (p.text_zh) {
        translations[p.index] = p.text_zh;
      }
    });
    set({
      documentId: data.document_id,
      title: data.title || 'Untitled',
      source: data.source || null,
      paragraphs: data.paragraphs,
      wordCount: data.word_count,
      paragraphCount: data.paragraph_count,
      translations,
    });
  },

  setLoading: (loading) => set({ isLoading: loading }),

  setTranslations: (translations) => set({ translations }),

  setIsTranslating: (v) => set({ isTranslating: v }),

  reset: () =>
    set({
      documentId: null,
      title: null,
      source: null,
      paragraphs: [],
      wordCount: 0,
      paragraphCount: 0,
      isLoading: false,
      translations: {},
      isTranslating: false,
    }),
}));
