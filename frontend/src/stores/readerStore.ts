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

/**
 * 阅读页随背景联动的配套色（滚动条 + 线条/分隔线 + 弹层底色），
 * 与背景同色系加深；未指定时回退全局默认（暖白系）。
 */
interface BgAdaptiveColors {
  /** 滚动条滑块 */
  thumb: string;
  thumbHover: string;
  /** 主分隔线 / 边框 */
  line: string;
  /** 软分隔线 */
  lineSoft: string;
  /** 弹层/卡片底色 */
  surface: string;
}

// ── Typography presets ──
const BG_COLORS: readonly { key: string; label: string; value: string; adaptive?: BgAdaptiveColors }[] = [
  { key: 'warm-cream', label: '暖白', value: '#faf9f5' },
  {
    key: 'pure-white', label: '纯白', value: '#ffffff',
    adaptive: { thumb: '#d9d9d6', thumbHover: '#a8a8a4', line: '#dededd', lineSoft: '#ececea', surface: '#fbfbfa' },
  },
  {
    key: 'sepia', label: '暖黄', value: '#f8f0e0',
    adaptive: { thumb: '#e3d5ba', thumbHover: '#c8b58f', line: '#e0d3b8', lineSoft: '#eadfc8', surface: '#fdf7ea' },
  },
  {
    key: 'light-green', label: '淡绿', value: '#eef5f0',
    adaptive: { thumb: '#d3e0d7', thumbHover: '#a9bfaf', line: '#d3e0d8', lineSoft: '#e0eae3', surface: '#f7fbf8' },
  },
  {
    key: 'soft-gray', label: '浅灰', value: '#f0f0f0',
    adaptive: { thumb: '#d4d4d2', thumbHover: '#a6a6a3', line: '#d6d6d4', lineSoft: '#e4e4e2', surface: '#f9f9f8' },
  },
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

/** 正文对齐方式（两端对齐仅拉伸占满的行，末行保持左对齐，为 CSS 原生语义） */
const TEXT_ALIGNS = [
  { key: 'left', label: '左对齐' },
  { key: 'justify', label: '两端对齐' },
] as const;

type AccentKey = (typeof ACCENTS)[number]['key'];

const BG_COLOR_DEFAULT = 'warm-cream';
const FONT_FAMILY_DEFAULT = 'georgia';
const LINE_HEIGHT_DEFAULT = 'normal';
const ACCENT_DEFAULT: AccentKey = 'us';
const TEXT_ALIGN_DEFAULT = 'left';

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
  /** 正文对齐方式：left 左对齐 / justify 两端对齐 */
  textAlign: string;
  setTextAlign: (key: string) => void;
  /** 考纲标签显隐：仅展示勾选的标签（默认全选） */
  visibleExamTags: string[];
  toggleExamTag: (label: string) => void;
  setAllExamTagsVisible: (labels: string[]) => void;
  /** 阅读页考纲标注：选中的考纲（多选，与 visibleExamTags 显隐过滤相互独立） */
  syllabusTags: string[];
  toggleSyllabusTag: (label: string) => void;
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
      textAlign: TEXT_ALIGN_DEFAULT,
      setTextAlign: (key) => set({ textAlign: key }),
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
      syllabusTags: [],
      toggleSyllabusTag: (label) =>
        set((state) => {
          const has = state.syllabusTags.includes(label);
          return {
            syllabusTags: has
              ? state.syllabusTags.filter((t) => t !== label)
              : [...state.syllabusTags, label],
          };
        }),
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
        textAlign: state.textAlign,
        visibleExamTags: state.visibleExamTags,
        syllabusTags: state.syllabusTags,
      }),
    }
  )
);

export {
  FONT_SIZE_MIN, FONT_SIZE_MAX, WORD_PANEL_FONT_SIZE_MIN, WORD_PANEL_FONT_SIZE_MAX,
  BG_COLORS, FONT_FAMILIES, LINE_HEIGHTS, ACCENTS, TEXT_ALIGNS,
  BG_COLOR_DEFAULT, FONT_FAMILY_DEFAULT, LINE_HEIGHT_DEFAULT, ACCENT_DEFAULT, TEXT_ALIGN_DEFAULT,
};
export type { ReaderState, AccentKey };
