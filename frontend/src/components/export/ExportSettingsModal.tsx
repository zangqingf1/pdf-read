/**
 * 导出设置弹窗：左侧实时分页预览（ExportPreview），右侧设置面板（ExportSettingsPanel）。
 * 底部「导出 PDF」→ 分页 → 序列化 HTML → 后端 Chrome 无头生成 → 直接下载 .pdf 文件。
 */
import { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import Spinner from '../ui/Spinner';
import ExportPreview from './ExportPreview';
import ExportSettingsPanel from './ExportSettingsPanel';
import { useResponsiveBreakpoint } from '../../hooks/useResponsiveBreakpoint';
import { useDocumentStore } from '../../stores/documentStore';
import { useExportPreferences } from '../../stores/exportPreferencesStore';
import { pickExportPrefs } from '../../stores/exportPreferencesStore';
import { buildExportData } from '../../export/data';
import { measureAndPaginate } from '../../export/measure';
import { serializeExportHtml } from '../../export/serializeExportHtml';
import { exportPdf } from '../../services/pdfApi';

/** 文件名清洗：去除路径非法字符 */
function sanitizeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'export';
}

/** 解析导出错误（blob 错误响应是 JSON） */
async function parseExportError(err: unknown): Promise<string> {
  const e = err as { response?: { data?: unknown; status?: number }; code?: string; message?: string };
  const data = e?.response?.data;
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      const j = JSON.parse(text);
      if (j?.detail) return String(j.detail);
    } catch {
      /* 非 JSON */
    }
  }
  if (e?.code === 'ECONNABORTED') return '导出超时，请重试或减少导出内容';
  if (e?.response?.status === 413) return '导出内容过大，请减少内容后重试';
  if (!e?.response) return '网络错误，无法连接服务器';
  return (e?.response?.data as { detail?: string })?.detail || e?.message || '导出失败，请重试';
}

export default function ExportSettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const paragraphs = useDocumentStore((s) => s.paragraphs);
  const translations = useDocumentStore((s) => s.translations);
  const wordAnalyses = useDocumentStore((s) => s.wordAnalyses);
  const sentenceAnalyses = useDocumentStore((s) => s.sentenceAnalyses);
  const summary = useDocumentStore((s) => s.summary);
  const title = useDocumentStore((s) => s.title);
  const titleZh = useDocumentStore((s) => s.titleZh);
  const prefsStore = useExportPreferences();
  const prefs = useMemo(() => pickExportPrefs(prefsStore), [prefsStore]);

  const data = useMemo(
    () =>
      buildExportData({
        title: title || '',
        titleZh,
        paragraphs,
        translations,
        wordAnalyses,
        sentenceAnalyses,
        summary,
      }),
    [paragraphs, translations, wordAnalyses, sentenceAnalyses, summary, title, titleZh]
  );

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // 移动端：设置视图 ↔ 预览视图 切换（桌面端始终并排显示，不受此状态影响）
  const { isMobile } = useResponsiveBreakpoint();
  const [showPreview, setShowPreview] = useState(false);

  // 重新打开弹窗时回到设置视图
  useEffect(() => {
    if (open) setShowPreview(false);
  }, [open]);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const plan = await measureAndPaginate(data, prefs);
      const html = await serializeExportHtml(data, prefs, plan);
      const blob = await exportPdf(html);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sanitizeFileName(data.title)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setExportError(await parseExportError(err));
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
      bodyClassName="p-0 flex flex-col md:flex-row overflow-hidden flex-1"
      footer={
        <>
          {exportError && (
            <span className="text-sm text-[color:var(--error)] mr-auto">{exportError}</span>
          )}
          {isMobile && !showPreview && (
            <button
              onClick={() => setShowPreview(true)}
              className="md:hidden px-4 h-9 rounded-md border border-hairline text-muted hover:text-ink hover:bg-surface-card transition-colors"
            >
              预览
            </button>
          )}
          {isMobile && showPreview && (
            <button
              onClick={() => setShowPreview(false)}
              className="md:hidden px-4 h-9 rounded-md border border-hairline text-muted hover:text-ink hover:bg-surface-card transition-colors"
            >
              返回设置
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 h-9 rounded-md border border-hairline text-muted hover:text-ink hover:bg-surface-card transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-5 h-9 rounded-md bg-primary text-on-primary hover:bg-primary-active disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium inline-flex items-center gap-2"
          >
            {exporting && <Spinner size="sm" />}
            {exporting ? '导出中…' : '导出 PDF'}
          </button>
        </>
      }
    >
      {!isMobile ? (
        <div className="flex-1 min-w-0 flex flex-col md:flex-row min-h-0">
          <ExportPreview data={data} />
          <ExportSettingsPanel />
        </div>
      ) : showPreview ? (
        // 移动端预览视图：预览画面替换设置画面
        <div className="flex-1 min-h-0 flex flex-col">
          <ExportPreview data={data} />
        </div>
      ) : (
        // 移动端设置视图：只显示设置，外层承担滚动（面板自身 shrink-0 无 flex-1）
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ExportSettingsPanel />
        </div>
      )}
    </Modal>
  );
}
