/**
 * 导出 PDF 的排版偏好与纸张尺寸定义。
 * 纯类型与常量，无依赖。
 */

export type PaperSizeKey = 'a4' | 'a5';
export type ThemeKey = 'warm' | 'bw' | 'academic';

export interface PaperSize {
  label: string;
  /** jsPDF pt 单位尺寸（1 CSS px = 0.75 pt，页面 div 像素 × 0.75 即精确 1:1） */
  wPt: number;
  hPt: number;
  /** 页面 div 的 CSS 像素尺寸 @96dpi */
  wPx: number;
  hPx: number;
}

export const PAPER_SIZES: Record<PaperSizeKey, PaperSize> = {
  a4: { label: 'A4', wPt: 595.5, hPt: 842.25, wPx: 794, hPx: 1123 },
  a5: { label: 'A5', wPt: 419.5, hPt: 595.5, wPx: 559, hPx: 794 },
};

export interface ExportPreferences {
  paperSize: PaperSizeKey;
  /** 基础字号 12–16px，默认 14 */
  fontSize: number;
  /** 左栏（原文）宽度比例，默认 0.55 */
  leftWidthRatio: number;
  /** 主题：暖色 / 黑白简约 / 蓝色学术 */
  theme: ThemeKey;
  includeSummary: boolean;
  includeTranslation: boolean;
  includePhonetic: boolean;
  /** 释义行的中文释义部分 */
  includeChineseDefinition: boolean;
  includeCognates: boolean;
  includeSynonyms: boolean;
  includeSentenceStructure: boolean;
}

export const EXPORT_PREF_DEFAULTS: ExportPreferences = {
  paperSize: 'a4',
  fontSize: 14,
  leftWidthRatio: 0.55,
  theme: 'warm',
  includeSummary: true,
  includeTranslation: true,
  includePhonetic: true,
  includeChineseDefinition: true,
  includeCognates: true,
  includeSynonyms: true,
  includeSentenceStructure: true,
};

export const LEFT_WIDTH_RATIOS = [0.5, 0.55, 0.6, 0.65] as const;
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 16;
export const FONT_SIZE_STEP = 1;

/** 版心常量（px，A4/A5 通用） */
export const PAGE_PADDING = 32; // 页面四边留白
export const FOOTER_HEIGHT = 22; // 页脚高度（含于版心内）
export const COL_GAP = 20; // 左右栏间距
/** 装箱安全边距：吸收 html2canvas 行高渲染偏差，防止每页最后一块底部被裁剪 */
export const PAGE_SAFETY = 12;
