/**
 * 导出 PDF 实时预览（单页翻页器）。
 * 订阅排版偏好，设置变更 200ms 防抖后走「测量 → 装箱 → 分页」管线重建预览，
 * 与最终导出同源（所见即所得），不经 html2canvas。
 */
import { useEffect, useRef, useState } from 'react';
import {
  useExportPreferences,
  pickExportPrefs,
} from '../../stores/exportPreferencesStore';
import { measureAndPaginate } from '../../export/measurePaginate';
import { buildExportHtml } from '../../export/buildExportHtml';
import { PAPER_SIZES } from '../../export/types';
import { THEMES } from '../../export/themes';
import type { ExportData } from '../../export/data';

interface ExportPreviewProps {
  data: ExportData | null;
}

/** 从完整分页 HTML 提取 <style> 与每页 outerHTML（DOM 解析，健壮于嵌套 div） */
function splitPagesHtml(html: string): { styleHtml: string; pages: string[] } {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const styleEl = tmp.querySelector('style');
  const pages = [...tmp.querySelectorAll('.export-page')].map((el) => el.outerHTML);
  return { styleHtml: styleEl ? styleEl.outerHTML : '', pages };
}

export default function ExportPreview({ data }: ExportPreviewProps) {
  const prefs = useExportPreferences();
  const paper = PAPER_SIZES[prefs.paperSize];

  const [styleHtml, setStyleHtml] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  // 防抖重建预览
  useEffect(() => {
    if (!data) {
      setPages([]);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const prefsSnapshot = pickExportPrefs(prefs);
        const plan = await measureAndPaginate(data, prefsSnapshot);
        if (cancelled) return;
        const html = buildExportHtml(data, prefsSnapshot, 'pages', plan);
        if (cancelled) return;
        const { styleHtml: s, pages: p } = splitPagesHtml(html);
        setStyleHtml(s);
        setPages(p);
        setCurrent((c) => Math.min(c, Math.max(p.length - 1, 0)));
      } catch {
        // 预览失败不阻断（保持上一版预览）
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [data, prefs]);

  // 容器宽度变化 → 重算缩放
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const compute = () => {
      const avail = Math.max(el.clientWidth - 32, 100);
      setScale(Math.min(1, avail / paper.wPx));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [paper]);

  const currentHtml = pages.length > 0 ? styleHtml + pages[current] : '';
  const themeLabel = THEMES.find((t) => t.key === prefs.theme)?.label ?? '';

  return (
    <div className="h-full flex flex-col bg-[#efeee9] min-h-0">
      {/* 状态条 */}
      <div className="flex items-center justify-between px-4 h-9 border-b border-hairline bg-canvas text-xs text-muted shrink-0">
        <span>
          {paper.label} · {loading ? '预览渲染中…' : `共 ${pages.length} 页`}
        </span>
        <span className="text-muted-soft">{themeLabel}</span>
      </div>

      {/* 预览区 */}
      <div ref={containerRef} className="flex-1 overflow-auto p-4 min-h-0">
        {currentHtml ? (
          <div
            style={{
              width: paper.wPx * scale,
              height: paper.hPx * scale,
              margin: '0 auto',
            }}
          >
            <div
              style={{
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                width: paper.wPx,
              }}
            >
              <div className="ep-preview" dangerouslySetInnerHTML={{ __html: currentHtml }} />
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-muted-soft">
            {data ? '暂无预览内容' : '请先打开一个文档'}
          </div>
        )}
      </div>

      {/* 翻页条 */}
      <div className="flex items-center justify-center gap-3 h-11 bg-canvas border-t border-hairline shrink-0">
        <button
          onClick={() => setCurrent((c) => Math.max(c - 1, 0))}
          disabled={current <= 0 || pages.length === 0}
          className="inline-flex items-center gap-1 px-3 h-8 rounded-md text-sm border border-hairline text-body hover:bg-surface-card hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
          上一页
        </button>
        <span className="text-xs text-muted tabular-nums min-w-[64px] text-center">
          {pages.length > 0 ? `${current + 1} / ${pages.length}` : '—'}
        </span>
        <button
          onClick={() => setCurrent((c) => Math.min(c + 1, pages.length - 1))}
          disabled={current >= pages.length - 1 || pages.length === 0}
          className="inline-flex items-center gap-1 px-3 h-8 rounded-md text-sm border border-hairline text-body hover:bg-surface-card hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          下一页
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>

      {/* 预览专用样式（仅视觉装饰，不影响导出管线） */}
      <style>{`
        .ep-preview .export-page {
          box-shadow: 0 2px 16px rgba(0,0,0,0.15);
        }
      `}</style>
    </div>
  );
}
