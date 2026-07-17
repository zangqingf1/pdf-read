import { create } from 'zustand';
import type { WordExplanationItem } from '../services/translateApi';

/**
 * Normalize a word to its canonical form for lookup.
 * Preserves apostrophes and hyphens inside the word.
 */
export function normalizeWord(w: string): string {
  return w
    .replace(/^[^a-zA-Z0-9À-ɏ'’-]+/, '')
    .replace(/[^a-zA-Z0-9À-ɏ'’-]+$/, '')
    .toLowerCase();
}

export interface WordPosition {
  paraIndex: number;
  charPos: number; // character offset within paragraph text
}

export interface SentenceAnalysisResult {
  sentence_structure: string;
  grammar_explanation: string;
  key_vocabulary: Array<{ word: string; pos: string; meaning: string }>;
  translation: string;
}

interface ReaderState {
  /** Canonical keys, in order they appear in the document */
  selectedKeys: string[];
  /** Canonical key → original display form */
  selectedDisplay: Record<string, string>;
  /** Canonical key → position in document */
  wordPositions: Record<string, WordPosition>;
  selectedContext: string;
  /** Canonical key → structured word explanation */
  explanationCache: Record<string, WordExplanationItem>;
  explaining: boolean;

  toggleWord: (rawWord: string, context: string, pos?: WordPosition) => void;
  clearSelection: () => void;
  setExplaining: (v: boolean) => void;
  mergeExplanation: (words: string[], explanations: WordExplanationItem[]) => void;

  // ── Sentence analysis state ──
  /** All selected sentence span keys: "sent-{paraIndex}-{sentIndex}" */
  selectedSentenceSpans: string[];
  /** Span key → { text, paraIndex, context } */
  sentenceSpanData: Record<string, { text: string; paraIndex: number; context: string }>;
  /** Currently active sentence text for analysis */
  selectedSentence: string;
  /** Paragraph text for the active sentence context */
  sentenceContext: string;
  /** Canonicalized sentence → analysis result cache */
  sentenceAnalysisCache: Record<string, SentenceAnalysisResult>;
  /** Loading flag for sentence analysis */
  analyzingSentence: boolean;

  toggleSentenceSpan: (spanKey: string, text: string, paraIndex: number, context: string) => void;
  setActiveSentenceSpan: (spanKey: string) => void;
  setSelectedSentenceText: (text: string, context: string) => void;
  clearSentences: () => void;
  setAnalyzingSentence: (v: boolean) => void;
  setSentenceAnalysis: (sentence: string, result: SentenceAnalysisResult) => void;
}

/** Sort keys by document position */
export function sortedKeys(
  keys: string[],
  positions: Record<string, WordPosition>
): string[] {
  return [...keys].sort((a, b) => {
    const pa = positions[a];
    const pb = positions[b];
    if (!pa && !pb) return 0;
    if (!pa) return 1;
    if (!pb) return -1;
    if (pa.paraIndex !== pb.paraIndex) return pa.paraIndex - pb.paraIndex;
    return pa.charPos - pb.charPos;
  });
}

export const useReaderStore = create<ReaderState>((set) => ({
  selectedKeys: [],
  selectedDisplay: {},
  wordPositions: {},
  selectedContext: '',
  explanationCache: {},
  explaining: false,

  // ── Sentence initial state ──
  selectedSentenceSpans: [],
  sentenceSpanData: {},
  selectedSentence: '',
  sentenceContext: '',
  sentenceAnalysisCache: {},
  analyzingSentence: false,

  toggleWord: (rawWord, context, pos) =>
    set((state) => {
      const key = normalizeWord(rawWord);
      const idx = state.selectedKeys.indexOf(key);
      if (idx >= 0) {
        // Remove
        const newKeys = [...state.selectedKeys];
        newKeys.splice(idx, 1);
        const newDisplay = { ...state.selectedDisplay };
        delete newDisplay[key];
        const newPos = { ...state.wordPositions };
        delete newPos[key];
        const newCache = { ...state.explanationCache };
        delete newCache[key];
        return {
          selectedKeys: newKeys,
          selectedDisplay: newDisplay,
          wordPositions: newPos,
          explanationCache: newCache,
        };
      }
      // Add — insert in position order
      const newPos = { ...state.wordPositions };
      if (pos) newPos[key] = pos;
      const newDisplay = { ...state.selectedDisplay, [key]: rawWord };
      // Insert sorted by position
      const newKeys = sortedKeys([...state.selectedKeys, key], { ...state.wordPositions, ...newPos });
      return {
        selectedKeys: newKeys,
        selectedDisplay: newDisplay,
        wordPositions: newPos,
        selectedContext: context,
      };
    }),

  clearSelection: () =>
    set({
      selectedKeys: [],
      selectedDisplay: {},
      wordPositions: {},
      selectedContext: '',
      explanationCache: {},
    }),

  setExplaining: (v) => set({ explaining: v }),

  mergeExplanation: (words, explanations) => {
    const t0 = performance.now();
    return set((state) => {
      if (!Array.isArray(explanations) || !Array.isArray(words)) {
        console.error('mergeExplanation: invalid arguments', { words, explanations });
        return {};
      }
      const t1 = performance.now();
      const newCache = { ...state.explanationCache };
      for (let i = 0; i < explanations.length; i++) {
        const item = explanations[i];
        // Use the word from the explanation, or fall back to the input word
        const wordText = item?.word || words[i] || '';
        const key = normalizeWord(wordText);
        // Only cache if the word is in the selected set (or matches an input word)
        if (
          key &&
          (state.selectedKeys.includes(key) ||
            words.some((w) => normalizeWord(w) === key))
        ) {
          newCache[key] = item;
        }
      }
      const t2 = performance.now();
      console.log(
        `[TIMING] mergeExplanation store-update: ${(t2 - t1).toFixed(1)}ms ` +
        `(${explanations.length} words)`
      );
      // Post a mark so the component can measure render time
      performance.mark('store-merged');
      return { explanationCache: newCache };
    });
  },

  // ── Sentence actions ──
  toggleSentenceSpan: (spanKey, text, paraIndex, context) =>
    set((state) => {
      const idx = state.selectedSentenceSpans.indexOf(spanKey);
      if (idx >= 0) {
        // Deselect
        const newSpans = [...state.selectedSentenceSpans];
        newSpans.splice(idx, 1);
        const newData = { ...state.sentenceSpanData };
        delete newData[spanKey];
        const wasActive = state.selectedSentence === text;
        return {
          selectedSentenceSpans: newSpans,
          sentenceSpanData: newData,
          selectedSentence: wasActive ? '' : state.selectedSentence,
          sentenceContext: wasActive ? '' : state.sentenceContext,
        };
      }
      // Add to selection
      const newData = { ...state.sentenceSpanData, [spanKey]: { text, paraIndex, context } };
      const newSpans = [...state.selectedSentenceSpans, spanKey];
      return {
        selectedSentenceSpans: newSpans,
        sentenceSpanData: newData,
        // Make this the active sentence for analysis
        selectedSentence: text,
        sentenceContext: context,
      };
    }),

  setActiveSentenceSpan: (spanKey) =>
    set((state) => {
      const data = state.sentenceSpanData[spanKey];
      if (!data) return {};
      return {
        selectedSentence: data.text,
        sentenceContext: data.context,
      };
    }),

  clearSentences: () =>
    set({
      selectedSentenceSpans: [],
      sentenceSpanData: {},
      selectedSentence: '',
      sentenceContext: '',
    }),

  setSelectedSentenceText: (text, context) =>
    set({
      selectedSentence: text,
      sentenceContext: context,
    }),

  setAnalyzingSentence: (v) => set({ analyzingSentence: v }),

  setSentenceAnalysis: (sentence, result) =>
    set((state) => {
      const key = sentence.trim().toLowerCase();
      return {
        sentenceAnalysisCache: { ...state.sentenceAnalysisCache, [key]: result },
        analyzingSentence: false,
      };
    }),
}));
