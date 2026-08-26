import { useState, useCallback, useRef, useEffect } from 'react';
import { Document, Page } from 'react-pdf';
import { pdfjs } from 'react-pdf';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { fetchPDFBlob } from '../../services/pdfApi';
import Button from '../ui/Button';

// Set PDF.js worker（本地打包，避免运行时依赖 unpkg CDN）
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

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
  // 初始 0 = 尚未测量：测量前不渲染缩略图，避免先以 500px 巨幅渲染再重排
  const [pageWidth, setPageWidth] = useState(0);
  const [columns, setColumns] = useState<1 | 2 | 3 | 4>(
    typeof window !== 'undefined' && window.innerWidth >= 768 ? 2 : 1
  );
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  /** 已挂载（进入视口附近）的页码 —— 视口外只渲染占位格，不建 canvas */
  const [mountedPages, setMountedPages] = useState<Set<number>>(
    () => new Set([1, 2, 3, 4])
  );
  const mountedRef = useRef<Set<number>>(new Set([1, 2, 3, 4]));
  const slotObserverRef = useRef<IntersectionObserver | null>(null);

  // 缩略图懒挂载：长文档不再一次性创建全部页面的 canvas
  const observeSlot = useCallback((pageNum: number, el: HTMLDivElement | null) => {
    if (!el || mountedRef.current.has(pageNum)) return;
    if (!slotObserverRef.current) {
      slotObserverRef.current = new IntersectionObserver(
        (entries) => {
          let changed = false;
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const p = Number((entry.target as HTMLElement).dataset.pageNum);
            if (Number.isFinite(p) && !mountedRef.current.has(p)) {
              mountedRef.current.add(p);
              changed = true;
            }
            slotObserverRef.current?.unobserve(entry.target);
          }
          if (changed) setMountedPages(new Set(mountedRef.current));
        },
        { rootMargin: '400px 0px' },
      );
    }
    el.dataset.pageNum = String(pageNum);
    slotObserverRef.current.observe(el);
  }, []);

  // 稳定 ref 回调：从元素自身的 data-page-num 读页码，避免每渲染
  // 换一个内联回调导致 React 反复 detach/attach（IO 重复 observe 噪音）
  const pageSlotRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const p = Number(el.dataset.pageNum);
    if (Number.isFinite(p)) observeSlot(p, el);
  }, [observeSlot]);

  useEffect(() => {
    return () => slotObserverRef.current?.disconnect();
  }, []);

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
            {pageWidth > 0 &&
              Array.from({ length: pageCount }, (_, i) => {
                const pageNum = i + 1;
                const isSelected = selected.includes(pageNum);
                const isDisabled = isMaxReached && !isSelected;
                const isMounted = mountedPages.has(pageNum);

                return (
                  <div
                    key={pageNum}
                    ref={pageSlotRef}
                    data-page-num={pageNum}
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
                      {isMounted ? (
                        <Page
                          pageNumber={pageNum}
                          width={pageWidth}
                          renderTextLayer={false}
                          renderAnnotationLayer={false}
                          loading={
                            <div style={{ width: pageWidth, height: pageWidth * 1.4, background: 'var(--surface-card)' }} />
                          }
                        />
                      ) : (
                        <div
                          className="flex items-center justify-center"
                          style={{ width: pageWidth, height: pageWidth * 1.4, background: 'var(--surface-card)' }}
                        >
                          <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                        </div>
                      )}
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
      <div className="h-[64px] flex items-center justify-center gap-3 px-6 border-t border-hairline-soft flex-shrink-0">
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
