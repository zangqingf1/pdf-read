/**
 * 导出 PDF 的类型与常量：纸张、字号范围、偏好设置。
 * 偏好持久化在 exportPreferencesStore（localStorage 'export-preferences'）。
 */

export type PaperSizeKey = 'a4' | 'a5' | 'letter';
export type ThemeKey = 'warm' | 'bw' | 'academic';

export interface PaperSizeDef {
  key: PaperSizeKey;
  label: string;
  /** 打印 @page size 值 */
  pageSize: 'A4' | 'A5' | 'Letter';
  /** 物理宽高（mm）—— 页 div 与 @page 用同一物理尺寸，规避 px 舍入空白页 */
  wMm: number;
  hMm: number;
  /** 屏幕预览宽度 px（@96dpi，仅预览 zoom 缩放用） */
  wPx: number;
  hPx: number;
}

export const PAPER_SIZES: Record<PaperSizeKey, PaperSizeDef> = {
  a4: { key: 'a4', label: 'A4', pageSize: 'A4', wMm: 210, hMm: 297, wPx: 794, hPx: 1123 },
  a5: { key: 'a5', label: 'A5', pageSize: 'A5', wMm: 148, hMm: 210, wPx: 559, hPx: 794 },
  letter: { key: 'letter', label: 'Letter', pageSize: 'Letter', wMm: 215.9, hMm: 279.4, wPx: 816, hPx: 1056 },
};

/** mm → px（96dpi：1mm = 96/25.4 px） */
export function mmToPx(mm: number): number {
  return (mm * 96) / 25.4;
}

/** 页内容区上下 padding（须与 .ep-page 的 padding 一致） */
export const PAGE_PADDING = 32;
/** 左右栏间距（须与 .ep-page-body 的 gap 一致） */
export const COL_GAP = 20;
/** 左栏块间距（段落 margin-bottom） */
export const GAP_LEFT = 14;
/** 句子卡碎片间距 */
export const FRAG_GAP = 7;
/** 「— 续」页眉与其后碎片的间距（须与 .ep-cont 的 margin-bottom 一致） */
export const CONT_GAP = 8;
/** 原文与译文间距（须与 .ep-zh 的 margin-top 一致） */
export const ZH_GAP = 6;

export const PAPER_SIZE_KEYS: PaperSizeKey[] = ['a4', 'a5', 'letter'];

/** 字号档位：min/max/步进 */
export interface FontSizeDef {
  min: number;
  max: number;
  step: number;
}

export const FONT_SIZE_TEXT: FontSizeDef = { min: 12, max: 20, step: 0.5 };
export const FONT_SIZE_TRANSLATION: FontSizeDef = { min: 11, max: 19, step: 0.5 };
export const FONT_SIZE_SUMMARY: FontSizeDef = { min: 12, max: 20, step: 0.5 };
export const FONT_SIZE_WORD: FontSizeDef = { min: 10, max: 18, step: 0.5 };
export const FONT_SIZE_SENTENCE: FontSizeDef = { min: 10, max: 18, step: 0.5 };

/** 导出偏好（全部可持久化） */
export interface ExportPreferences {
  paperSize: PaperSizeKey;
  theme: ThemeKey;
  /** 左栏（原文+译文+总结）宽度占比 0.4–0.7 */
  leftWidthRatio: number;
  // ── 五组字号（原文/译文/总结/单词解析/句子解析）──
  fontSizeText: number;
  fontSizeTranslation: number;
  fontSizeSummary: number;
  fontSizeWord: number;
  fontSizeSentence: number;
  // ── 内容选择 ──
  includeSummary: boolean;
  includeTranslation: boolean;
  includeWords: boolean;
  includeSentences: boolean;
  /** 句子卡小节：阅读线索 */
  includeReadingCues: boolean;
  /** 句子卡小节：地道翻译 */
  includeIdiomaticTranslation: boolean;
  includePhonetic: boolean;
  includeChineseDefinition: boolean;
  includeBaseForm: boolean;
  includeSynonyms: boolean;
  includeCognates: boolean;
  /** 单词卡考纲标签（配合阅读页「标签」显隐设置过滤） */
  includeExamTags: boolean;
  /** 单栏版式（打印兼容兜底：每段原文+译文后紧跟该段解析） */
  singleColumn: boolean;
  /** 双栏「同页对齐」：左栏可见的已解析单词/句子与其右栏解析卡尽量同页（以留白换同页，页数可能略增） */
  alignSamePage: boolean;
  /** 来源（显示在导出首页大标题下方；空=不显示） */
  source: string;
}

export const EXPORT_PREF_DEFAULTS: ExportPreferences = {
  paperSize: 'a4',
  theme: 'warm',
  leftWidthRatio: 0.55,
  fontSizeText: 14,
  fontSizeTranslation: 13,
  fontSizeSummary: 14,
  fontSizeWord: 11.5,
  fontSizeSentence: 11.5,
  includeSummary: true,
  includeTranslation: true,
  includeWords: true,
  includeSentences: true,
  includeReadingCues: true,
  includeIdiomaticTranslation: true,
  includePhonetic: true,
  includeChineseDefinition: true,
  includeBaseForm: true,
  includeSynonyms: true,
  includeCognates: true,
  includeExamTags: true,
  singleColumn: false,
  alignSamePage: true,
  source: '',
};
