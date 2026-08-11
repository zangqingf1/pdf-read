/**
 * 导出 PDF 设置弹窗：左侧实时预览 + 右侧排版设置，
 * 点击「导出 PDF」执行逐页渲染并下载。
 */
import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import {
  useExportPreferences,
  pickExportPrefs,
  type ToggleKey,
} from '../../stores/exportPreferencesStore';
import { collectExportData, type ExportData } from '../../export/data';
import type { ExportProgress } from '../../export/generatePdf';
import type { ExportPreferences } from '../../export/types';
import {
  PAPER_SIZES,
  LEFT_WIDTH_RATIOS,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_STEP,
} from '../../export/types';
import { THEMES } from '../../export/themes';
import ExportPreview from './ExportPreview';

interface ExportSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

/** 内容开关配置（key 对应 store 字段） */
const TOGGLES: Array<{ key: keyof ExportPreferences; label: string }> = [
  { key: 'includeTranslation', label: '段落翻译' },
  { key: 'includePhonetic', label: '音标' },
  { key: 'includeChineseDefinition', label: '中文释义' },
  { key: 'includeSynonyms', label: '同义词' },
  { key: 'includeCognates', label: '同根词' },
  { key: 'includeSentenceStructure', label: '句子精讲' },
  { key: 'includeSummary', label: '全文总结' },
];

export default function ExportSettingsModal({ open, onClose }: ExportSettingsModalProps) {
  const prefs = useExportPreferences();
  const [data, setData] = useState<ExportData | null>(null);
  const [hasAnalyses, setHasAnalyses] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 打开时取一次数据快照
  useEffect(() => {
    if (open) {
      const d = collectExportData();
      setData(d);
      setHasAnalyses(d.words.length > 0 || d.sentences.length > 0);
      setError(null);
      setProgress(null);
    }
  }, [open]);

  const handleExport = async () => {
    if (!data || exporting) return;
    setExporting(true);
    setError(null);
    setProgress(null);
    try {
      // 动态加载 html2canvas/jspdf（约 400KB，仅导出时加载）
      const { exportDocumentToPdf } = await import('../../export/generatePdf');
      await exportDocumentToPdf(data, pickExportPrefs(prefs), setProgress);
      onClose();
    } catch (e: any) {
      setError(e?.message || '导出失败，请重试');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="导出 PDF"
      width="1280px"
      bodyClassName="flex-1 p-0 overflow-hidden flex flex-col md:flex-row"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={exporting}>
            取消
          </Button>
          <Button variant="primary" onClick={handleExport} loading={exporting}>
            导出 PDF
          </Button>
        </>
      }
    >
      {/* 左/上：实时预览 */}
      <div className="h-[38vh] md:h-auto md:flex-1 md:min-w-0 md:min-h-0 shrink-0">
        <ExportPreview data={data} />
      </div>

      {/* 右/下：排版设置 */}
      <div className="flex-1 md:flex-none md:w-[360px] md:shrink-0 overflow-y-auto min-h-0 border-t md:border-t-0 md:border-l border-hairline">
        <div className="p-5 space-y-6">
        {!hasAnalyses && (
          <p className="text-xs text-muted-soft bg-surface-cream-strong border border-hairline rounded-md px-3 py-2 m-0">
            尚未解析单词或句子，将只导出原文与翻译。
          </p>
        )}

        {/* ── 纸张与版式 ── */}
        <section>
          <h4 className="text-xs font-medium text-muted-soft uppercase tracking-wide mb-3">纸张与版式</h4>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-sm text-body w-10 shrink-0">纸张</span>
            <div className="flex gap-2">
              {(Object.keys(PAPER_SIZES) as Array<keyof typeof PAPER_SIZES>).map((key) => (
                <button
                  key={key}
                  onClick={() => prefs.setPaperSize(key)}
                  className={`px-3 py-1.5 rounded-md text-sm border transition-all duration-150 ${
                    prefs.paperSize === key
                      ? 'border-primary bg-surface-card text-primary font-medium'
                      : 'border-hairline text-body hover:border-muted-soft hover:bg-canvas-soft'
                  }`}
                >
                  {PAPER_SIZES[key].label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 mb-3">
            <span className="text-sm text-body w-10 shrink-0">字号</span>
            <button
              onClick={() => prefs.setFontSize(Math.max(FONT_SIZE_MIN, prefs.fontSize - FONT_SIZE_STEP))}
              disabled={prefs.fontSize <= FONT_SIZE_MIN}
              className="w-8 h-8 flex items-center justify-center rounded-md border border-hairline hover:bg-surface-card disabled:opacity-30 transition-colors"
              aria-label="减小字号"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14" /></svg>
            </button>
            <span className="text-base font-medium text-ink min-w-[36px] text-center tabular-nums">{prefs.fontSize}px</span>
            <button
              onClick={() => prefs.setFontSize(Math.min(FONT_SIZE_MAX, prefs.fontSize + FONT_SIZE_STEP))}
              disabled={prefs.fontSize >= FONT_SIZE_MAX}
              className="w-8 h-8 flex items-center justify-center rounded-md border border-hairline hover:bg-surface-card disabled:opacity-30 transition-colors"
              aria-label="增大字号"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-body w-10 shrink-0">原文栏宽</span>
            <div className="flex gap-2">
              {LEFT_WIDTH_RATIOS.map((r) => (
                <button
                  key={r}
                  onClick={() => prefs.setLeftWidthRatio(r)}
                  className={`px-2.5 py-1.5 rounded-md text-sm border transition-all duration-150 ${
                    prefs.leftWidthRatio === r
                      ? 'border-primary bg-surface-card text-primary font-medium'
                      : 'border-hairline text-body hover:border-muted-soft hover:bg-canvas-soft'
                  }`}
                >
                  {Math.round(r * 100)}%
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── 主题风格 ── */}
        <section>
          <h4 className="text-xs font-medium text-muted-soft uppercase tracking-wide mb-3">主题风格</h4>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map((t) => (
              <button
                key={t.key}
                onClick={() => prefs.setTheme(t.key)}
                className={`px-3 py-2.5 rounded-lg border transition-all duration-150 text-left ${
                  prefs.theme === t.key
                    ? 'border-primary bg-surface-card'
                    : 'border-hairline hover:border-muted-soft hover:bg-canvas-soft'
                }`}
              >
                <span className="flex items-center gap-1.5 mb-1.5">
                  {t.swatches.map((c) => (
                    <span
                      key={c}
                      className="w-3.5 h-3.5 rounded-full border border-black/10"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </span>
                <span className="block text-sm font-medium text-ink">{t.label}</span>
                <span className="block text-[11px] text-muted mt-0.5">{t.desc}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ── 内容选项 ── */}
        <section>
          <h4 className="text-xs font-medium text-muted-soft uppercase tracking-wide mb-3">内容选项</h4>
          <div className="flex flex-wrap gap-2">
            {TOGGLES.map((t) => {
              const on = prefs[t.key] as boolean;
              return (
                <button
                  key={t.key}
                  onClick={() => prefs.toggle(t.key as ToggleKey)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-all duration-150 ${
                    on
                      ? 'border-primary bg-surface-card text-primary font-medium'
                      : 'border-hairline text-body hover:border-muted-soft hover:bg-canvas-soft'
                  }`}
                >
                  {on ? '✓ ' : ''}
                  {t.label}
                </button>
              );
            })}
          </div>
          <button
            onClick={prefs.resetAll}
            className="mt-3 text-xs text-muted hover:text-primary transition-colors"
          >
            恢复默认设置
          </button>
        </section>

        {/* 导出进度 / 错误 */}
        {exporting && progress && (
          <div className="text-xs text-muted">
            正在渲染第 {progress.done} / {progress.total} 页…
          </div>
        )}
        {error && (
          <div className="text-xs text-error bg-error/5 border border-error/20 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        </div>
      </div>
    </Modal>
  );
}
