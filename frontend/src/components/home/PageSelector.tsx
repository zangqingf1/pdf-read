import { useState, useCallback, useRef, useEffect } from 'react';
import { Document, Page } from 'react-pdf';
import { pdfjs } from 'react-pdf';
import { fetchPDFBlob } from '../../services/pdfApi';
import Button from '../ui/Button';

// Set PDF.js worker — use unpkg for reliability (same as PDFViewerPanel)
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const MAX_PAGES = 10;

interface PageSelectorProps {
  taskId: string;
  pageCount: number;
  onSubmit: (selectedPages: number[]) => void;
  onSkip: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function PageSelector({
  taskId,
  pageCount,
  onSubmit,
  onSkip,
  onCancel,
  loading = false,
}: PageSelectorProps) {
  const [selected, setSelected] = useState<number[]>([]);
  const gridRef = useRef<HTMLDivElement>(null);
  const [pageWidth, setPageWidth] = useState(500);
  const [columns, setColumns] = useState<1 | 2 | 3 | 4>(
    typeof window !== 'undefined' && window.innerWidth >= 768 ? 2 : 1
  );
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);

  // Fetch PDF as blob through axios (so auth header is included)
  useEffect(() => {
    let cancelled = false;
    fetchPDFBlob(taskId)
      .then((blob) => {
        if (!cancelled) {
          setPdfBlobUrl(URL.createObjectURL(blob));
        }
      })
      .catch(() => {
        /* 预览加载失败时静默降级为按页码选择 */
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    const url = pdfBlobUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [pdfBlobUrl]);

  // Compute page width based on column count
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const gap = 12 * (columns - 1);
        setPageWidth(Math.floor((w - gap) / columns));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [columns]);

  const togglePage = useCallback((page: number) => {
    setSelected((prev) => {
      if (prev.includes(page)) return prev.filter((p) => p !== page);
      if (prev.length >= MAX_PAGES) return prev;
      return [...prev, page].sort((a, b) => a - b);
    });
  }, []);

  const isMaxReached = selected.length >= MAX_PAGES;

  return (
    <div className="flex flex-col min-h-0 flex-1 bg-canvas">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 md:px-6 py-3 border-b border-hairline-soft">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-lg font-display font-medium text-ink m-0">选择要阅读的页面</h3>
          <span className="text-sm text-muted">
            共 {pageCount} 页，最多选择 {MAX_PAGES} 页
          </span>
          {/* Column toggle */}
          <div className="flex items-center gap-0.5 ml-2 bg-surface-card rounded-md p-0.5">
            {([1, 2, 3, 4] as const).map((n) => (
              <button
                key={n}
                onClick={() => setColumns(n)}
                className={[
                  'w-7 h-6 flex items-center justify-center rounded text-xs font-medium transition-colors touch-area',
                  columns === n ? 'bg-white text-primary shadow-sm' : 'text-muted-soft hover:text-ink',
                ].join(' ')}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setSelected(Array.from({ length: Math.min(pageCount, MAX_PAGES) }, (_, i) => i + 1))}
            className="text-xs text-muted hover:text-ink transition-colors">
            全选
          </button>
          <button onClick={() => setSelected([])}
            className="text-xs text-muted hover:text-ink transition-colors">
            取消全选
          </button>
          <span className="text-sm font-medium text-body-strong">
            已选 {selected.length}/{MAX_PAGES} 页
          </span>
        </div>
      </div>

      {/* PDF preview grid */}
      <div
        ref={gridRef}
        className="flex-1 min-h-0 overflow-y-auto p-4 page-selector-grid"
      >
        <Document
          file={pdfBlobUrl}
          loading={
            <div className="text-center py-16">
              <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
              <p className="text-sm text-muted">正在加载 PDF 预览...</p>
            </div>
          }
          error={
            <div className="text-center py-12 text-muted text-sm">
              预览加载失败，请根据页码选择
            </div>
          }
        >
          <div className={[
            'grid gap-3',
            columns === 1 ? 'grid-cols-1' : columns === 2 ? 'grid-cols-2' : columns === 3 ? 'grid-cols-3' : 'grid-cols-4',
          ].join(' ')}>
            {Array.from({ length: pageCount }, (_, i) => {
              const pageNum = i + 1;
              const isSelected = selected.includes(pageNum);
              const isDisabled = isMaxReached && !isSelected;

              return (
                <div
                  key={pageNum}
                  onClick={() => !isDisabled && togglePage(pageNum)}
                  className="overflow-hidden rounded-md border-2 transition-all duration-150 bg-white"
                  style={{
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    opacity: isDisabled ? 0.4 : 1,
                    borderColor: isSelected ? 'var(--primary)' : 'var(--hairline)',
                    boxShadow: isSelected ? '0 2px 8px rgba(200, 116, 85, 0.15)' : 'none',
                  }}
                >
                  <div className="bg-canvas min-h-[100px]">
                    <Page
                      pageNumber={pageNum}
                      width={pageWidth}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      loading={
                        <div style={{ width: pageWidth, height: pageWidth * 1.4, background: 'var(--surface-card)' }} />
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between px-3 py-2">
                    <div
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-primary border-primary' : 'border-hairline'}`}
                    >
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </div>
                    <span
                      className="text-xs"
                      style={{ color: isSelected ? 'var(--primary)' : 'var(--muted)', fontWeight: isSelected ? 600 : 400 }}
                    >
                      第 {pageNum} 页
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Document>
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-center gap-3 px-6 py-3 border-t border-hairline-soft">
        <Button
          variant="primary"
          size="sm"
          disabled={selected.length === 0}
          loading={loading}
          onClick={() => onSubmit(selected)}
        >
          确认并开始解析（{selected.length} 页）
        </Button>
        <Button variant="secondary" size="sm" disabled={loading} onClick={onSkip}>
          解析全部页面
        </Button>
        <Button variant="ghost" size="sm" disabled={loading} onClick={onCancel}>
          放弃
        </Button>
      </div>
    </div>
  );
}
