/**
 * 导出渲染管线：测量 → 装箱 → 重建分页 DOM → 逐页 html2canvas → jsPDF。
 *
 * 内存策略：逐页渲染 canvas，每页用完立即清零释放（整页一次性渲染会 OOM）。
 * 测量/装箱见 measurePaginate.ts（预览共用）。
 */
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { ExportData } from './data';
import type { ExportPreferences } from './types';
import { PAPER_SIZES } from './types';
import { buildExportHtml } from './buildExportHtml';
import { measureAndPaginate } from './measurePaginate';

export interface ExportProgress {
  done: number;
  total: number;
}

/** 文件名去非法字符 */
function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  return (cleaned || 'export').slice(0, 80);
}

/**
 * 导出整篇文档为 PDF 并触发下载。
 * @param onProgress 逐页渲染进度回调
 */
export async function exportDocumentToPdf(
  data: ExportData,
  prefs: ExportPreferences,
  onProgress?: (p: ExportProgress) => void
): Promise<void> {
  const paper = PAPER_SIZES[prefs.paperSize];

  // 重建分页 DOM 的离屏宿主
  const host = document.createElement('div');
  host.id = 'export-host';
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${paper.wPx}px;`;
  document.body.appendChild(host);

  try {
    // 1) 测量 + 装箱
    const plan = await measureAndPaginate(data, prefs);
    if (plan.totalPages < 1) return; // 无内容可导出

    // 2) 重建分页 DOM 并逐页渲染
    host.innerHTML = buildExportHtml(data, prefs, 'pages', plan);
    await document.fonts.ready;

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: [paper.wPt, paper.hPt],
      compress: true,
    });
    const pages = [...host.querySelectorAll('.export-page')];

    for (let i = 0; i < pages.length; i++) {
      onProgress?.({ done: i + 1, total: pages.length });
      const canvas = await html2canvas(pages[i] as HTMLElement, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });
      const img = canvas.toDataURL('image/png');
      canvas.width = 0;
      canvas.height = 0; // 立即释放，逐页内存恒定
      if (i > 0) pdf.addPage([paper.wPt, paper.hPt], 'portrait');
      pdf.addImage(img, 'PNG', 0, 0, paper.wPt, paper.hPt);
    }

    pdf.save(`${sanitizeFilename(data.title)}.pdf`);
  } finally {
    host.remove();
  }
}
