/**
 * 导出 PDF 排版偏好（persist → localStorage 'export-preferences'）。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ExportPreferences, PaperSizeKey, ThemeKey } from '../export/types';
import { EXPORT_PREF_DEFAULTS } from '../export/types';

/** 从 store 状态提取纯偏好对象（预览/导出共用） */
export function pickExportPrefs(s: ExportPreferencesStore): ExportPreferences {
  return {
    paperSize: s.paperSize,
    fontSize: s.fontSize,
    leftWidthRatio: s.leftWidthRatio,
    theme: s.theme,
    includeSummary: s.includeSummary,
    includeTranslation: s.includeTranslation,
    includePhonetic: s.includePhonetic,
    includeChineseDefinition: s.includeChineseDefinition,
    includeCognates: s.includeCognates,
    includeSynonyms: s.includeSynonyms,
    includeSentenceStructure: s.includeSentenceStructure,
  };
}

const PREF_KEYS = [
  'paperSize',
  'fontSize',
  'leftWidthRatio',
  'theme',
  'includeSummary',
  'includeTranslation',
  'includePhonetic',
  'includeChineseDefinition',
  'includeCognates',
  'includeSynonyms',
  'includeSentenceStructure',
] as const;

export type ToggleKey = (typeof PREF_KEYS)[number];

interface ExportPreferencesStore {
  paperSize: PaperSizeKey;
  fontSize: number;
  leftWidthRatio: number;
  theme: ThemeKey;
  includeSummary: boolean;
  includeTranslation: boolean;
  includePhonetic: boolean;
  includeChineseDefinition: boolean;
  includeCognates: boolean;
  includeSynonyms: boolean;
  includeSentenceStructure: boolean;
  setPaperSize: (v: PaperSizeKey) => void;
  setFontSize: (v: number) => void;
  setLeftWidthRatio: (v: number) => void;
  setTheme: (v: ThemeKey) => void;
  toggle: (key: ToggleKey) => void;
  resetAll: () => void;
}

export const useExportPreferences = create<ExportPreferencesStore>()(
  persist(
    (set) => ({
      ...EXPORT_PREF_DEFAULTS,
      setPaperSize: (v) => set({ paperSize: v }),
      setFontSize: (v) => set({ fontSize: v }),
      setLeftWidthRatio: (v) => set({ leftWidthRatio: v }),
      setTheme: (v) => set({ theme: v }),
      toggle: (key) =>
        set((s) => ({ [key]: !s[key] }) as unknown as Pick<ExportPreferencesStore, ToggleKey>),
      resetAll: () => set({ ...EXPORT_PREF_DEFAULTS }),
    }),
    {
      name: 'export-preferences',
      partialize: (s) => {
        const out: Record<string, unknown> = {};
        for (const key of PREF_KEYS) out[key] = s[key];
        return out;
      },
    }
  )
);
