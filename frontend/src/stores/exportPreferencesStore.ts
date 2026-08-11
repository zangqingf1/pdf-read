/**
 * 导出 PDF 排版偏好（persist → localStorage 'export-preferences'）。
 * 新字段由 persist 浅合并默认值兜底（旧存储无字段时落到 EXPORT_PREF_DEFAULTS）。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ExportPreferences, PaperSizeKey, ThemeKey } from '../export/exportTypes';
import { EXPORT_PREF_DEFAULTS } from '../export/exportTypes';

/** 可开关的内容字段（ToggleKey = ExportPreferences 中所有 boolean 键） */
export type ToggleKey =
  | 'includeSummary'
  | 'includeTranslation'
  | 'includeWords'
  | 'includeSentences'
  | 'includeReadingCues'
  | 'includeIdiomaticTranslation'
  | 'includePhonetic'
  | 'includeChineseDefinition'
  | 'includeBaseForm'
  | 'includeSynonyms'
  | 'includeCognates'
  | 'singleColumn';

const PREF_KEYS = [
  'paperSize',
  'theme',
  'leftWidthRatio',
  'fontSizeText',
  'fontSizeTranslation',
  'fontSizeSummary',
  'fontSizeWord',
  'fontSizeSentence',
  'includeSummary',
  'includeTranslation',
  'includeWords',
  'includeSentences',
  'includeReadingCues',
  'includeIdiomaticTranslation',
  'includePhonetic',
  'includeChineseDefinition',
  'includeBaseForm',
  'includeSynonyms',
  'includeCognates',
  'singleColumn',
  'source',
] as const;

/** 从 store 状态提取纯偏好对象（预览/导出共用） */
export function pickExportPrefs(s: ExportPreferencesStore): ExportPreferences {
  const prefs: Record<string, unknown> = {};
  for (const key of PREF_KEYS) prefs[key] = s[key];
  return prefs as unknown as ExportPreferences;
}

interface ExportPreferencesStore {
  paperSize: PaperSizeKey;
  theme: ThemeKey;
  leftWidthRatio: number;
  fontSizeText: number;
  fontSizeTranslation: number;
  fontSizeSummary: number;
  fontSizeWord: number;
  fontSizeSentence: number;
  includeSummary: boolean;
  includeTranslation: boolean;
  includeWords: boolean;
  includeSentences: boolean;
  includeReadingCues: boolean;
  includeIdiomaticTranslation: boolean;
  includePhonetic: boolean;
  includeChineseDefinition: boolean;
  includeBaseForm: boolean;
  includeSynonyms: boolean;
  includeCognates: boolean;
  singleColumn: boolean;
  source: string;
  /** 曾输入过的来源（最近优先，去重，最多 10 条；供输入框下拉选择） */
  sourceHistory: string[];
  setPaperSize: (v: PaperSizeKey) => void;
  setTheme: (v: ThemeKey) => void;
  setLeftWidthRatio: (v: number) => void;
  setFontSizeText: (v: number) => void;
  setFontSizeTranslation: (v: number) => void;
  setFontSizeSummary: (v: number) => void;
  setFontSizeWord: (v: number) => void;
  setFontSizeSentence: (v: number) => void;
  toggle: (key: ToggleKey) => void;
  /** 记录当前来源到历史（失焦/回车时提交，避免逐字入史） */
  commitSourceHistory: () => void;
  setSource: (v: string) => void;
  resetAll: () => void;
}

export const useExportPreferences = create<ExportPreferencesStore>()(
  persist(
    (set) => ({
      ...EXPORT_PREF_DEFAULTS,
      sourceHistory: [],
      setPaperSize: (v) => set({ paperSize: v }),
      setTheme: (v) => set({ theme: v }),
      setLeftWidthRatio: (v) => set({ leftWidthRatio: v }),
      setFontSizeText: (v) => set({ fontSizeText: v }),
      setFontSizeTranslation: (v) => set({ fontSizeTranslation: v }),
      setFontSizeSummary: (v) => set({ fontSizeSummary: v }),
      setFontSizeWord: (v) => set({ fontSizeWord: v }),
      setFontSizeSentence: (v) => set({ fontSizeSentence: v }),
      toggle: (key) =>
        set((s) => ({ [key]: !s[key] }) as unknown as Pick<ExportPreferencesStore, ToggleKey>),
      setSource: (v) => set({ source: v }),
      commitSourceHistory: () =>
        set((s) => {
          const v = s.source.trim();
          if (!v || s.sourceHistory[0] === v) return {};
          return {
            sourceHistory: [v, ...s.sourceHistory.filter((x) => x !== v)].slice(0, 10),
          };
        }),
      resetAll: () => set({ ...EXPORT_PREF_DEFAULTS }),
    }),
    {
      name: 'export-preferences',
      partialize: (s) => {
        const out: Record<string, unknown> = {};
        for (const key of PREF_KEYS) out[key] = s[key];
        out.sourceHistory = s.sourceHistory;
        return out;
      },
    }
  )
);
