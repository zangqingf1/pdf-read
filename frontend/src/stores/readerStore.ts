import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ALL_EXAM_TAG_LABELS } from '../constants/examTags';

const FONT_SIZE_MIN = 14;
const FONT_SIZE_MAX = 28;
const FONT_SIZE_STEP = 2;
const FONT_SIZE_DEFAULT = 18;

const WORD_PANEL_FONT_SIZE_MIN = 12;
const WORD_PANEL_FONT_SIZE_MAX = 24;
const WORD_PANEL_FONT_SIZE_DEFAULT = 14;

// ── Typography presets ──
const BG_COLORS = [
  { key: 'warm-cream', label: '暖白', value: '#faf9f5' },
  { key: 'pure-white', label: '纯白', value: '#ffffff' },
  { key: 'sepia', label: '暖黄', value: '#f8f0e0' },
  { key: 'light-green', label: '淡绿', value: '#eef5f0' },
  { key: 'soft-gray', label: '浅灰', value: '#f0f0f0' },
] as const;

const FONT_FAMILIES = [
  { key: 'georgia', label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { key: 'inter', label: 'Inter', value: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  { key: 'lora', label: 'Lora', value: '"Lora", Georgia, "Times New Roman", serif' },
  { key: 'cormorant', label: 'Cormorant', value: '"Cormorant Garamond", Garamond, "Times New Roman", serif' },
] as const;

const LINE_HEIGHTS = [
  { key: 'compact', label: '紧凑', value: 1.5 },
  { key: 'normal', label: '标准', value: 1.75 },
  { key: 'relaxed', label: '宽松', value: 2.0 },
  { key: 'wide', label: '极宽', value: 2.5 },
] as const;

/** 发音口音（音标展示 + 单词发音 + 段落朗读统一使用） */
const ACCENTS = [
  { key: 'us', label: '美音 US' },
  { key: 'uk', label: '英音 UK' },
] as const;

type AccentKey = (typeof ACCENTS)[number]['key'];

const BG_COLOR_DEFAULT = 'warm-cream';
const FONT_FAMILY_DEFAULT = 'georgia';
const LINE_HEIGHT_DEFAULT = 'normal';
const ACCENT_DEFAULT: AccentKey = 'us';

interface ReaderState {
  fontSize: number;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
  wordPanelFontSize: number;
  increaseWordPanelFontSize: () => void;
  decreaseWordPanelFontSize: () => void;
  bgColor: string;
  setBgColor: (key: string) => void;
  fontFamily: string;
  setFontFamily: (key: string) => void;
  lineHeight: string;
  setLineHeight: (key: string) => void;
  accent: AccentKey;
  setAccent: (key: AccentKey) => void;
  /** 考纲标签显隐：仅展示勾选的标签（默认全选） */
  visibleExamTags: string[];
  toggleExamTag: (label: string) => void;
  setAllExamTagsVisible: (labels: string[]) => void;
}

export const useReaderStore = create<ReaderState>()(
  persist(
    (set, get) => ({
      fontSize: FONT_SIZE_DEFAULT,
      wordPanelFontSize: WORD_PANEL_FONT_SIZE_DEFAULT,
      bgColor: BG_COLOR_DEFAULT,
      fontFamily: FONT_FAMILY_DEFAULT,
      lineHeight: LINE_HEIGHT_DEFAULT,

      increaseFontSize: () => {
        const { fontSize } = get();
        if (fontSize < FONT_SIZE_MAX) {
          set({ fontSize: fontSize + FONT_SIZE_STEP });
        }
      },

      decreaseFontSize: () => {
        const { fontSize } = get();
        if (fontSize > FONT_SIZE_MIN) {
          set({ fontSize: fontSize - FONT_SIZE_STEP });
        }
      },

      increaseWordPanelFontSize: () => {
        const { wordPanelFontSize } = get();
        if (wordPanelFontSize < WORD_PANEL_FONT_SIZE_MAX) {
          set({ wordPanelFontSize: wordPanelFontSize + FONT_SIZE_STEP });
        }
      },

      decreaseWordPanelFontSize: () => {
        const { wordPanelFontSize } = get();
        if (wordPanelFontSize > WORD_PANEL_FONT_SIZE_MIN) {
          set({ wordPanelFontSize: wordPanelFontSize - FONT_SIZE_STEP });
        }
      },

      setBgColor: (key) => set({ bgColor: key }),
      setFontFamily: (key) => set({ fontFamily: key }),
      setLineHeight: (key) => set({ lineHeight: key }),
      accent: ACCENT_DEFAULT,
      setAccent: (key) => set({ accent: key }),
      visibleExamTags: [...ALL_EXAM_TAG_LABELS],
      toggleExamTag: (label) =>
        set((state) => {
          const has = state.visibleExamTags.includes(label);
          const next = has
            ? state.visibleExamTags.filter((t) => t !== label)
            : [...ALL_EXAM_TAG_LABELS.filter((t) => state.visibleExamTags.includes(t) || t === label)];
          return { visibleExamTags: next };
        }),
      setAllExamTagsVisible: (labels) => set({ visibleExamTags: [...labels] }),
    }),
    {
      name: 'reader-preferences',
      partialize: (state) => ({
        fontSize: state.fontSize,
        wordPanelFontSize: state.wordPanelFontSize,
        bgColor: state.bgColor,
        fontFamily: state.fontFamily,
        lineHeight: state.lineHeight,
        accent: state.accent,
        visibleExamTags: state.visibleExamTags,
      }),
    }
  )
);

export {
  FONT_SIZE_MIN, FONT_SIZE_MAX, WORD_PANEL_FONT_SIZE_MIN, WORD_PANEL_FONT_SIZE_MAX,
  BG_COLORS, FONT_FAMILIES, LINE_HEIGHTS, ACCENTS,
  BG_COLOR_DEFAULT, FONT_FAMILY_DEFAULT, LINE_HEIGHT_DEFAULT, ACCENT_DEFAULT,
};
export type { ReaderState, AccentKey };
