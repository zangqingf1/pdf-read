import { create } from 'zustand';
import type { PDFResultResponse, ParagraphResult } from '../services/pdfApi';
import type { WordAnalysisResult } from '../services/wordAnalysisApi';
import type { SentenceAnalysisResult } from '../services/sentenceAnalysisApi';

interface DocumentState {
  // Document data
  documentId: string | null;
  title: string | null;
  source: string | null;
  paragraphs: ParagraphResult[];
  wordCount: number;
  paragraphCount: number;
  pageCount: number | null;
  selectedPages: number[] | null;
  isLoading: boolean;

  // Translation state
  translations: Record<number, string>; // paragraph index -> zh translation
  isTranslating: boolean;
  translationError: string | null;

  // Word selection state
  selectedWords: Record<string, boolean>; // "paragraphIndex:word" -> true

  // Word analysis state
  wordAnalyses: Record<string, WordAnalysisResult>; // "paragraphIndex:word" -> analysis
  isAnalyzing: boolean;
  analysisError: string | null;
  analysisProgress: { completed: number; total: number } | null;
  /** Raw AI streaming text per word key — shown while generation is in flight */
  streamingTexts: Record<string, string>;

  // Sentence selection state
  selectedSentences: Record<string, { text: string }>; // "paragraphIndex:sentenceIndex" -> { text }
  // Sentence analysis state
  sentenceAnalyses: Record<string, SentenceAnalysisResult>; // same key pattern
  isAnalyzingSentences: boolean;
  sentenceAnalysisError: string | null;
  /** Raw AI streaming text per sentence key — shown while generation is in flight */
  sentenceStreamingTexts: Record<string, string>;

  // Full-document summary state
  /** 持久化的总结文本（用户草稿或 AI 结果，恢复/展示来源） */
  summary: string | null;
  /** 输入框实时值（草稿） */
  summaryDraft: string;
  isSummarizing: boolean;
  summaryError: string | null;
  /** 生成中的原始流式文本 */
  summaryStreamingText: string;

  // Reverse navigation: highlight a specific analysis card in the panel
  highlightedAnalysisKey: string | null;
  highlightedAnalysisTab: 'words' | 'sentences' | null;

  // Actions
  setDocument: (data: PDFResultResponse) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
  updateTranslations: (items: Array<{ index: number; text: string }>) => void;
  setTranslating: (translating: boolean) => void;
  setTranslationError: (error: string | null) => void;

  // Word actions
  toggleWordSelection: (paragraphIndex: number, word: string) => void;
  clearWordSelection: () => void;
  setWordAnalyses: (results: WordAnalysisResult[]) => void;
  removeWordAnalysis: (paragraphIndex: number, word: string) => void;
  removePendingWordAnalyses: () => void;
  clearWordAnalyses: () => void;
  setAnalyzing: (analyzing: boolean) => void;
  setAnalysisError: (error: string | null) => void;
  setAnalysisProgress: (progress: { completed: number; total: number } | null) => void;
  appendStreamingText: (key: string, text: string) => void;
  clearStreamingTexts: () => void;

  // Sentence actions
  toggleSentenceSelection: (paragraphIndex: number, sentenceIndex: number, text: string) => void;
  clearSentenceSelection: () => void;
  setSentenceAnalyses: (results: SentenceAnalysisResult[]) => void;
  removeSentenceAnalysis: (paragraphIndex: number, sentenceIndex: number) => void;
  clearSentenceAnalyses: () => void;
  setAnalyzingSentences: (analyzing: boolean) => void;
  setSentenceAnalysisError: (error: string | null) => void;
  appendSentenceStreamingText: (key: string, text: string) => void;
  clearSentenceStreamingTexts: () => void;

  // Summary actions
  setSummary: (summary: string | null) => void;
  setSummaryDraft: (draft: string) => void;
  setSummarizing: (summarizing: boolean) => void;
  setSummaryError: (error: string | null) => void;
  appendSummaryStreamingText: (text: string) => void;
  clearSummaryStreamingText: () => void;

  // Reverse navigation
  setHighlightedAnalysis: (key: string | null, tab: 'words' | 'sentences' | null) => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  documentId: null,
  title: null,
  source: null,
  paragraphs: [],
  wordCount: 0,
  paragraphCount: 0,
  pageCount: null,
  selectedPages: null,
  isLoading: false,

  translations: {},
  isTranslating: false,
  translationError: null,

  selectedWords: {},
  wordAnalyses: {},
  isAnalyzing: false,
  analysisError: null,
  analysisProgress: null,
  streamingTexts: {},

  selectedSentences: {},
  sentenceAnalyses: {},
  isAnalyzingSentences: false,
  sentenceAnalysisError: null,
  sentenceStreamingTexts: {},

  summary: null,
  summaryDraft: '',
  isSummarizing: false,
  summaryError: null,
  summaryStreamingText: '',

  highlightedAnalysisKey: null,
  highlightedAnalysisTab: null,

  setDocument: (data) => {
    set((state) => {
      const translations = { ...state.translations };
      for (const p of data.paragraphs) {
        if (p.text_zh && !translations[p.index]) {
          translations[p.index] = p.text_zh;
        }
      }

      // Restore saved word analyses from DB (indexed by "paragraphIndex:word")
      const wordAnalyses: Record<string, WordAnalysisResult> = {};
      if (data.word_analyses) {
        for (const wa of data.word_analyses) {
          const key = `${wa.paragraph_index}:${wa.word.toLowerCase()}`;
          wordAnalyses[key] = {
            id: wa.id,
            paragraph_index: wa.paragraph_index,
            word: wa.word,
            phonetic: wa.phonetic,
            part_of_speech: wa.part_of_speech,
            definition: wa.definition,
            definition_zh: wa.definition_zh,
            collocations: wa.collocations || [],
            example_sentence: wa.example_sentence || '',
            cognates: wa.cognates,
            synonyms_antonyms: wa.synonyms_antonyms,
            base_form: wa.base_form,
            plural_form: wa.plural_form,
          };
        }
      }

      // Restore saved sentence analyses from DB (indexed by "paragraphIndex:sentenceIndex")
      const sentenceAnalyses: Record<string, SentenceAnalysisResult> = {};
      if (data.sentence_analyses) {
        for (const sa of data.sentence_analyses) {
          const key = `${sa.paragraph_index}:${sa.sentence_index}`;
          sentenceAnalyses[key] = {
            id: sa.id,
            paragraph_index: sa.paragraph_index,
            sentence_index: sa.sentence_index,
            sentence_text: sa.sentence_text || '',
            content: sa.content || '',
          };
        }
      }

      return {
        documentId: data.document_id,
        title: data.title || 'Untitled',
        source: data.source || null,
        paragraphs: data.paragraphs,
        wordCount: data.word_count,
        paragraphCount: data.paragraph_count,
        pageCount: data.page_count ?? null,
        selectedPages: data.selected_pages ?? null,
        translations,
        wordAnalyses,
        sentenceAnalyses,
        summary: data.summary ?? null,
        summaryDraft: data.summary ?? '',
        // Don't reset isTranslating or translationError on re-fetch
      };
    });
  },

  setLoading: (loading) => set({ isLoading: loading }),

  reset: () =>
    set({
      documentId: null,
      title: null,
      source: null,
      paragraphs: [],
      wordCount: 0,
      paragraphCount: 0,
      pageCount: null,
      selectedPages: null,
      isLoading: false,
      translations: {},
      isTranslating: false,
      translationError: null,
      selectedWords: {},
      wordAnalyses: {},
      isAnalyzing: false,
      analysisError: null,
      analysisProgress: null,
      streamingTexts: {},
      selectedSentences: {},
      sentenceAnalyses: {},
      isAnalyzingSentences: false,
      sentenceAnalysisError: null,
      sentenceStreamingTexts: {},
      summary: null,
      summaryDraft: '',
      isSummarizing: false,
      summaryError: null,
      summaryStreamingText: '',
      highlightedAnalysisKey: null,
      highlightedAnalysisTab: null,
    }),

  updateTranslations: (items) =>
    set((state) => {
      const newTranslations = { ...state.translations };
      for (const item of items) {
        newTranslations[item.index] = item.text;
      }
      return { translations: newTranslations };
    }),

  setTranslating: (translating) => set({ isTranslating: translating }),

  setTranslationError: (error) => set({ translationError: error }),

  // ── Word actions ────────────────────────────────────────────

  toggleWordSelection: (paragraphIndex, word) =>
    set((state) => {
      const key = `${paragraphIndex}:${word.toLowerCase()}`;
      const selectedWords = { ...state.selectedWords };
      if (selectedWords[key]) {
        delete selectedWords[key];
      } else {
        selectedWords[key] = true;
      }
      return { selectedWords };
    }),

  clearWordSelection: () => set({ selectedWords: {} }),

  setWordAnalyses: (results) =>
    set((state) => {
      const wordAnalyses = { ...state.wordAnalyses };
      for (const r of results) {
        const key = `${r.paragraph_index}:${r.word.toLowerCase()}`;
        wordAnalyses[key] = r;
      }
      return { wordAnalyses };
    }),

  removeWordAnalysis: (paragraphIndex, word) =>
    set((state) => {
      const key = `${paragraphIndex}:${word.toLowerCase()}`;
      const wordAnalyses = { ...state.wordAnalyses };
      delete wordAnalyses[key];
      return { wordAnalyses };
    }),

  removePendingWordAnalyses: () =>
    set((state) => {
      const wordAnalyses = { ...state.wordAnalyses };
      for (const key of Object.keys(wordAnalyses)) {
        if (wordAnalyses[key]._pending) {
          delete wordAnalyses[key];
        }
      }
      return { wordAnalyses };
    }),

  clearWordAnalyses: () => set({ wordAnalyses: {} }),

  setAnalyzing: (analyzing) => set({ isAnalyzing: analyzing }),

  setAnalysisError: (error) => set({ analysisError: error }),

  setAnalysisProgress: (progress) => set({ analysisProgress: progress }),

  appendStreamingText: (key, text) =>
    set((state) => ({
      streamingTexts: {
        ...state.streamingTexts,
        [key]: (state.streamingTexts[key] || '') + text,
      },
    })),

  clearStreamingTexts: () => set({ streamingTexts: {} }),

  // ── Sentence actions ──────────────────────────────────────────

  toggleSentenceSelection: (paragraphIndex, sentenceIndex, text) =>
    set((state) => {
      const key = `${paragraphIndex}:${sentenceIndex}`;
      const selectedSentences = { ...state.selectedSentences };
      if (selectedSentences[key]) {
        delete selectedSentences[key];
      } else {
        selectedSentences[key] = { text };
      }
      return { selectedSentences };
    }),

  clearSentenceSelection: () => set({ selectedSentences: {} }),

  setSentenceAnalyses: (results) =>
    set((state) => {
      const sentenceAnalyses = { ...state.sentenceAnalyses };
      for (const r of results) {
        const key = `${r.paragraph_index}:${r.sentence_index}`;
        sentenceAnalyses[key] = r;
      }
      return { sentenceAnalyses };
    }),

  removeSentenceAnalysis: (paragraphIndex, sentenceIndex) =>
    set((state) => {
      const key = `${paragraphIndex}:${sentenceIndex}`;
      const sentenceAnalyses = { ...state.sentenceAnalyses };
      delete sentenceAnalyses[key];
      return { sentenceAnalyses };
    }),

  clearSentenceAnalyses: () => set({ sentenceAnalyses: {} }),

  setAnalyzingSentences: (analyzing) => set({ isAnalyzingSentences: analyzing }),

  setSentenceAnalysisError: (error) => set({ sentenceAnalysisError: error }),

  appendSentenceStreamingText: (key, text) =>
    set((state) => ({
      sentenceStreamingTexts: {
        ...state.sentenceStreamingTexts,
        [key]: (state.sentenceStreamingTexts[key] || '') + text,
      },
    })),

  clearSentenceStreamingTexts: () => set({ sentenceStreamingTexts: {} }),

  // ── Summary actions ─────────────────────────────────────────

  setSummary: (summary) => set({ summary }),

  setSummaryDraft: (draft) => set({ summaryDraft: draft }),

  setSummarizing: (summarizing) => set({ isSummarizing: summarizing }),

  setSummaryError: (error) => set({ summaryError: error }),

  appendSummaryStreamingText: (text) =>
    set((state) => ({
      summaryStreamingText: state.summaryStreamingText + text,
    })),

  clearSummaryStreamingText: () => set({ summaryStreamingText: '' }),

  // ── Reverse navigation ──────────────────────────────────────

  setHighlightedAnalysis: (key, tab) => set({ highlightedAnalysisKey: key, highlightedAnalysisTab: tab }),
}));
