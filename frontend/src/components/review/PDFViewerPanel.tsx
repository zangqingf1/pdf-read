import { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { fetchPDFBlob } from '../../services/pdfApi';

// Set PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerPanelProps {
  taskId: string;
  width: number;
  selectedPages?: number[] | null;
}

export default function PDFViewerPanel({ taskId, width, selectedPages }: PDFViewerPanelProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
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
        if (!cancelled) {
          setLoadError(true);
        }
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

  const pageWidth = Math.max(200, width - 32);

  const pagesToRender: number[] = selectedPages && selectedPages.length > 0
    ? selectedPages
    : Array.from({ length: numPages || 0 }, (_, i) => i + 1);

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden p-4 bg-canvas">
      {loadError ? (
        <div className="text-center py-12">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--muted-soft)" strokeWidth="1" className="mx-auto mb-3">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          <p className="text-sm text-muted">PDF 预览加载失败，请参考右侧文本编辑</p>
        </div>
      ) : (
        <Document
          file={pdfBlobUrl}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          onLoadError={() => setLoadError(true)}
          loading={
            <div className="text-center py-12">
              <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
              <p className="text-sm text-muted">加载 PDF...</p>
            </div>
          }
        >
          {pagesToRender.map((pageNum) => (
            <div
              key={pageNum}
              className="mb-4 shadow-card bg-white rounded-lg overflow-hidden"
            >
              <div className="px-3 py-1.5 bg-canvas-soft border-b border-hairline text-xs text-muted text-center">
                第 {pageNum} 页
              </div>
              <Page
                pageNumber={pageNum}
                width={pageWidth}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                loading={
                  <div
                    className="flex items-center justify-center bg-canvas-soft"
                    style={{ width: pageWidth, height: pageWidth * 1.4 }}
                  >
                    <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
                  </div>
                }
              />
            </div>
          ))}
        </Document>
      )}
    </div>
  );
}
