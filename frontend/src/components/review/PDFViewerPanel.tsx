import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { fetchPDFBlob } from '../../services/pdfApi';
import { bboxToCss, type ParagraphLayoutItem } from '../../utils/pdfBbox';

// Set PDF.js worker（本地打包，避免运行时依赖 unpkg CDN）
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

interface PDFViewerPanelProps {
  taskId: string;
  width: number;
  selectedPages?: number[] | null;
  /** 各段落的 MinerU 布局框（PDF 源才有） */
  paragraphLayouts?: ParagraphLayoutItem[];
  /** 点击 PDF 上的框 → 编辑区段落滚动居中并高亮 */
  onBoxSelect?: (index: number) => void;
  /** 点击编辑区段落后请求：对应解析框滚动到 PDF 预览居中位置 */
  focusRequest?: { index: number; t: number } | null;
}

/** 文本自校准得到的仿射映射：css = f * box + c（在 refW 渲染宽度下测得），
 *  换宽度时整体按 refW 等比缩放，保证框随 PDF 一起变大变小。 */
interface Calibration {
  fx: number;
  cx: number;
  fy: number;
  cy: number;
  refW: number;
}

/** 连字 → 基础字符（pdf.js 与 OCR 文本都可能带这些字符） */
const LIGATURES: Record<string, string> = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'st',
  '\uFB06': 'st',
};

/** 归一化文本用于匹配：去连字、转小写、去所有非字母数字（连字符/弯引号等一并去除） */
function normalizeText(s: string): string {
  return s
    .replace(/[\uFB00-\uFB06]/g, (ch) => LIGATURES[ch] ?? ch)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

interface TextRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** 原始文本（用于归一化拼接匹配） */
  text: string;
}

interface TextLine {
  top: number;
  bottom: number;
  left: number;
  right: number;
  norm: string;
  items: TextRect[];
}

/** 将 pdf.js 文本项转为 CSS 矩形（top-left 坐标，y 向下） */
function rectFromItem(
  it: { str: string; width: number; height: number; transform: number[] },
  view: [number, number, number, number],
  k: number
): TextRect {
  const x = it.transform[4];
  const y = it.transform[5];
  return {
    left: (x - view[0]) * k,
    right: (x + it.width - view[0]) * k,
    top: (view[3] - (y + (it.height || 10))) * k,
    bottom: (view[3] - y) * k,
    text: it.str,
  };
}

/**
 * 多栏页面同一视觉行左右栏文字会并排 —— 直接按行拼接会让段落文本在拼接串中不连续。
 * 这里先把同一行的文本项按「栏间空隙」切成片段（栏内单词间距远小于栏间距），再按片段
 * x 中心归入左/右栏，各栏内保持 Y 顺序。两栏拼接串彼此独立，段落按其框所在栏匹配。
 */
function splitLinesByColumn(rects: TextRect[], tol: number, colGap: number, midX: number): TextLine[][] {
  const colLines: TextLine[][] = [[], []];
  const push = (seg: TextRect[]) => {
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    let norm = '';
    for (const s of seg) {
      if (s.left < left) left = s.left;
      if (s.right > right) right = s.right;
      if (s.top < top) top = s.top;
      if (s.bottom > bottom) bottom = s.bottom;
      norm += normalizeText(s.text);
    }
    const line: TextLine = { left, right, top, bottom, norm, items: seg };
    colLines[(left + right) / 2 < midX ? 0 : 1].push(line);
  };

  const sorted = [...rects].sort((a, b) => a.top - b.top);
  let rawLine: TextRect[] = [];
  const flush = () => {
    if (!rawLine.length) return;
    rawLine.sort((a, b) => a.left - b.left);
    let seg: TextRect[] = [];
    let prevRight = -Infinity;
    for (const it of rawLine) {
      if (seg.length && it.left - prevRight > colGap) {
        push(seg);
        seg = [];
      }
      seg.push(it);
      prevRight = it.right;
    }
    if (seg.length) push(seg);
    rawLine = [];
  };
  for (const r of sorted) {
    if (rawLine.length && Math.abs(r.top - rawLine[0].top) < tol) {
      rawLine.push(r);
    } else {
      flush();
      rawLine = [r];
    }
  }
  flush();
  return colLines;
}

/** 在按行拼接的归一化文本里找段落文本，返回 [起始行, 结束行] */
function findParagraphRange(lines: TextLine[], paraNorm: string): [number, number] | null {
  const starts: number[] = [];
  let acc = 0;
  for (const ln of lines) {
    starts.push(acc);
    acc += ln.norm.length;
  }
  const concat = lines.map((l) => l.norm).join('');
  const lineAt = (pos: number): number => {
    // binary search: last line whose start <= pos
    let lo = 0, hi = lines.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= pos) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  };

  const idx = concat.indexOf(paraNorm);
  if (idx >= 0) {
    return [lineAt(idx), lineAt(idx + paraNorm.length - 1)];
  }
  // 容错：OCR 与内嵌文本中间可能有差异 → 用首/尾锚点（各 24 字符）
  if (paraNorm.length > 60) {
    const head = paraNorm.slice(0, 24);
    const tail = paraNorm.slice(-24);
    const hi = concat.indexOf(head);
    const ti = concat.lastIndexOf(tail);
    if (hi >= 0 && ti >= hi) {
      return [lineAt(hi), lineAt(ti + tail.length - 1)];
    }
  }
  return null;
}

/** 最小二乘线性拟合 y = f * x + c；点数不足返回 null */
function fitLine(xs: number[], ys: number[]): { f: number; c: number } | null {
  const n = xs.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i];
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const f = (n * sxy - sx * sy) / denom;
  const c = (sy - f * sx) / n;
  if (!isFinite(f) || !isFinite(c) || f <= 0.001) return null;
  return { f, c };
}

/** 带离群点剔除的拟合：反复「拟合 → 按残差剔除 → 重拟合」，抵御个别段落的错误匹配 */
function fitLineRobust(xs: number[], ys: number[]): { f: number; c: number } | null {
  let keep = xs.map((_, i) => i);
  let result: { f: number; c: number } | null = null;
  for (let iter = 0; iter < 5; iter++) {
    const fit = fitLine(keep.map((i) => xs[i]), keep.map((i) => ys[i]));
    if (!fit) return null;
    result = fit;
    const res = keep.map((i) => Math.abs(fit.f * xs[i] + fit.c - ys[i]));
    const sorted = [...res].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const cutoff = Math.max(med * 3, 12);
    const next = keep.filter((_, j) => res[j] <= cutoff);
    if (next.length < 3) return null;
    if (next.length === keep.length) break;
    keep = next;
  }
  return result;
}

/** react-pdf Page 是普通函数组件，包一层 memo：分栏宽度/页码不变时跳过重渲染 */
const PdfPage = memo(function PdfPage({
  pageNumber,
  width,
}: {
  pageNumber: number;
  width: number;
}) {
  return (
    <Page
      pageNumber={pageNumber}
      width={width}
      renderTextLayer={false}
      renderAnnotationLayer={false}
      loading={
        <div
          className="flex items-center justify-center bg-canvas-soft"
          style={{ width, height: width * 1.4 }}
        >
          <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      }
    />
  );
});

export default function PDFViewerPanel({
  taskId,
  width,
  selectedPages,
  paragraphLayouts,
  onBoxSelect,
  focusRequest,
}: PDFViewerPanelProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  /** 文本自校准结果；null = 未完成或失败（回退 bboxToCss 公式） */
  const [calib, setCalib] = useState<Calibration | null>(null);
  /** 点击编辑区段落后闪亮的解析框 index（t 递增用于重放动画） */
  const [flashBox, setFlashBox] = useState<{ index: number; t: number } | null>(null);
  /** 已挂载（进入视口附近）的页码集合 —— 视口外页面只渲染占位符，不栅格化 */
  const [mountedPages, setMountedPages] = useState<Set<number>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const boxRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedPagesRef = useRef<Set<number>>(new Set());
  const pageObserverRef = useRef<IntersectionObserver | null>(null);

  // ── 页面虚拟化：IntersectionObserver 按需挂载 PdfPage ──
  // 只渲染视口附近（±800px）的页面；已挂载页保持挂载（滚动回来不再重新栅格化）。
  // 选中页模式（≤10 页）下 observer 会很快把全部页挂上，行为与原来一致。
  useEffect(() => {
    const observer = pageObserverRef.current;
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    if (!numPages) return;
    const initial = new Set<number>();
    for (const p of [1, 2]) {
      if (p <= numPages) initial.add(p);
    }
    mountedPagesRef.current = initial;
    setMountedPages(initial);
  }, [numPages]);

  const observePage = useCallback((pageNum: number, el: HTMLDivElement | null) => {
    if (!el || mountedPagesRef.current.has(pageNum)) return;
    if (!pageObserverRef.current) {
      pageObserverRef.current = new IntersectionObserver(
        (entries) => {
          let changed = false;
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const p = Number((entry.target as HTMLElement).dataset.pageNum);
            if (Number.isFinite(p) && !mountedPagesRef.current.has(p)) {
              mountedPagesRef.current.add(p);
              changed = true;
            }
            pageObserverRef.current?.unobserve(entry.target);
          }
          if (changed) setMountedPages(new Set(mountedPagesRef.current));
        },
        { rootMargin: '800px 0px' },
      );
    }
    el.dataset.pageNum = String(pageNum);
    pageObserverRef.current.observe(el);
  }, []);

  // 稳定 ref 回调：从元素自身的 data-page-num 读页码，避免每渲染
  // 换一个内联回调导致 React 反复 detach/attach（IO 重复 observe 噪音）
  const pageSlotRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const p = Number(el.dataset.pageNum);
    if (Number.isFinite(p)) observePage(p, el);
  }, [observePage]);

  // 点击编辑区段落 → 对应解析框滚动到预览区居中并闪烁高亮。
  // numPages 入依赖：移动端切到 PDF 标签页时本组件全新挂载，PDF 加载完成
  // （numPages 变化）后解析框才存在，此时再滚动定位一次。
  useEffect(() => {
    if (!focusRequest) return;
    const box = boxRefs.current.get(focusRequest.index);
    const container = scrollContainerRef.current;
    if (box) {
      if (container) {
        const boxRect = box.getBoundingClientRect();
        const contRect = container.getBoundingClientRect();
        const target =
          container.scrollTop +
          (boxRect.top - contRect.top) -
          (container.clientHeight - boxRect.height) / 2;
        container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      }
      setFlashBox({ index: focusRequest.index, t: focusRequest.t });
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashBox(null), 1600);
    }
  }, [focusRequest, numPages]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  // 校准不因渲染宽度变化而重跑 —— 用 ref 记录当次宽度，之后按 refW 等比缩放
  const pageWidth = Math.max(200, width - 32);
  const pageWidthRef = useRef(pageWidth);
  pageWidthRef.current = pageWidth;

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

  // 按页码分组布局框（页码 → 该页全部段落框）
  const boxesByPage = useMemo(() => {
    const map = new Map<number, ParagraphLayoutItem[]>();
    for (const item of paragraphLayouts ?? []) {
      if (item.page_number == null || !item.layout) continue;
      const list = map.get(item.page_number) ?? [];
      list.push(item);
      map.set(item.page_number, list);
    }
    return map;
  }, [paragraphLayouts]);

  // useMemo 保持数组引用稳定：否则自校准 effect 会随任意 render（hover/flash）
  // 拿到新数组而反复 abort 并重跑整篇 pdfjs getTextContent。
  const pagesToRender = useMemo<number[]>(
    () =>
      selectedPages && selectedPages.length > 0
        ? selectedPages
        : Array.from({ length: numPages || 0 }, (_, i) => i + 1),
    [selectedPages, numPages],
  );

  // ── 文本自校准 ──
  // 用 pdf.js 提取真实文本位置（getTextContent，无需渲染），把段落框与文本做线性拟合，
  // 得到「MinerU 图像像素 → CSS 像素」的仿射映射。MinerU Cloud 的 bbox 实际落在约
  // 1000×1000 正方形坐标空间（x/y 缩放不同），存储的 scale（200dpi 假设）对其无效，
  // 因此必须从真实文本反推 fx/fy/cx/cy；非 Cloud 文档同样适用（fx≈fy）。
  const calibPages = useMemo(
    () => pagesToRender.filter((p) => (boxesByPage.get(p)?.length ?? 0) > 0),
    [pagesToRender, boxesByPage],
  );

  useEffect(() => {
    if (!pdfBlobUrl || calibPages.length === 0) return;
    let cancelled = false;
    const refW = pageWidthRef.current;

    (async () => {
      try {
        const pdf = await pdfjs.getDocument({ url: pdfBlobUrl }).promise;
        const xs: number[] = [];
        const ys: number[] = [];
        const cxs: number[] = [];
        const cys: number[] = [];

        for (const pageNum of calibPages) {
          if (cancelled) return;
          const items = boxesByPage.get(pageNum) ?? [];
          const page = await pdf.getPage(pageNum);
          const view = page.view as [number, number, number, number];
          const pageWpt = view[2] - view[0];
          const k = refW / pageWpt;
          const tol = Math.max(2, refW * 0.008);
          const textContent = await page.getTextContent();
          const rects: TextRect[] = [];
          for (const it of textContent.items) {
            if (!('str' in it) || !it.str.trim()) continue;
            rects.push(rectFromItem(it as { str: string; width: number; height: number; transform: number[] }, view, k));
          }

          // 按栏切分行片段（栏间空隙 → 各栏内按 Y 顺序拼接），段落按其框所在栏匹配
          const midX = refW / 2;
          const colGap = Math.max(6, refW * 0.015);
          const colLines = splitLinesByColumn(rects, tol, colGap, midX);
          const boxXs = items.map((i) => i.layout.box[0]);
          const loX = Math.min(...boxXs);
          const hiX = Math.max(...boxXs);
          const colThresh = loX + (hiX - loX) / 2;

          for (const item of items) {
            if (!item.text) continue;
            const paraNorm = normalizeText(item.text);
            if (!paraNorm) continue;
            // 优先在框所在栏匹配（跨栏标题等框在左/右栏都可），失败再试另一栏
            const preferCol = item.layout.box[0] >= colThresh ? 1 : 0;
            let col = -1;
            let range: [number, number] | null = null;
            for (const c of [preferCol, 1 - preferCol]) {
              const r = findParagraphRange(colLines[c], paraNorm);
              if (r) { col = c; range = r; break; }
            }
            if (!range) continue;
            let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
            for (let i = range[0]; i <= range[1]; i++) {
              const ln = colLines[col][i];
              if (ln.left < left) left = ln.left;
              if (ln.right > right) right = ln.right;
              if (ln.top < top) top = ln.top;
              if (ln.bottom > bottom) bottom = ln.bottom;
            }
            const [bx1, by1, bx2, by2] = item.layout.box;
            xs.push(bx1, bx2);
            cxs.push(left, right);
            ys.push(by1, by2);
            cys.push(top, bottom);
          }
        }

        if (cancelled) return;
        const fitX = fitLineRobust(xs, cxs);
        const fitY = fitLineRobust(ys, cys);
        if (fitX && fitY) {
          setCalib({ fx: fitX.f, cx: fitX.c, fy: fitY.f, cy: fitY.c, refW });
        }
      } catch {
        /* 标定失败 → 保持 null，回退 bboxToCss 公式 */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfBlobUrl, calibPages, boxesByPage]);

  // 解析框整体垂直微调偏移（CSS 像素，正值向下）：用于视觉上让框与文字对齐
  const BOX_V_OFFSET = 4;

  const boxToCss = useCallback(
    (item: ParagraphLayoutItem) => {
      const [x1, y1, x2, y2] = item.layout.box;
      if (calib) {
        const s = pageWidth / calib.refW;
        return {
          x: (calib.fx * x1 + calib.cx) * s,
          y: (calib.fy * y1 + calib.cy) * s + BOX_V_OFFSET,
          w: calib.fx * (x2 - x1) * s,
          h: calib.fy * (y2 - y1) * s,
        };
      }
      const rect = bboxToCss(item.layout, pageWidth);
      return { ...rect, y: rect.y + BOX_V_OFFSET };
    },
    [calib, pageWidth],
  );

  return (
    <div ref={scrollContainerRef} className="h-full overflow-y-auto overflow-x-hidden p-4 bg-canvas">
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
          {pagesToRender.map((pageNum) => {
            const pageBoxes = boxesByPage.get(pageNum);
            const hasOverlay = !!pageBoxes && pageBoxes.length > 0;
            // 页面渲染高度 = 宽 × (pts_h/pts_w)（用该页第一个框的 pts 尺寸）
            const pageHeight = hasOverlay
              ? pageWidth * (pageBoxes![0].layout.pts_h / pageBoxes![0].layout.pts_w)
              : undefined;
            // 未挂载页的占位高度：有框页用真实比例，无框页按 A4 估算
            const estHeight = pageHeight ?? pageWidth * 1.4;
            const isMounted = mountedPages.has(pageNum);

            return (
              <div
                key={pageNum}
                className="mb-4 shadow-card bg-white rounded-lg overflow-hidden"
              >
                <div className="px-3 py-1.5 bg-canvas-soft border-b border-hairline text-xs text-muted text-center">
                  第 {pageNum} 页
                </div>
                <div
                  ref={pageSlotRef}
                  data-page-num={pageNum}
                  className="relative mx-auto"
                  style={
                    hasOverlay
                      ? { width: pageWidth, height: pageHeight }
                      : { width: pageWidth, minHeight: estHeight }
                  }
                >
                  {isMounted ? (
                    <>
                      <PdfPage pageNumber={pageNum} width={pageWidth} />
                      {hasOverlay &&
                        pageBoxes!.map((item) => {
                          const rect = boxToCss(item);
                          const isFlashed = flashBox?.index === item.index;
                          return (
                            <div
                              key={isFlashed ? `box-${item.index}-${flashBox!.t}` : `box-${item.index}`}
                              data-layout-box-index={item.index}
                              ref={(el) => {
                                if (el) boxRefs.current.set(item.index, el);
                                else boxRefs.current.delete(item.index);
                              }}
                              className={`absolute border transition-colors duration-100 cursor-pointer ${
                                isFlashed ? 'layout-box-flash' : ''
                              } border-blue-500/70 hover:bg-blue-500/20`}
                              style={{
                                left: rect.x,
                                top: rect.y,
                                width: rect.w,
                                height: rect.h,
                              }}
                              onMouseEnter={() => {
                                // 悬浮联动：PDF 框 hover → 编辑区段落浅色底
                                // （DOM class 直连，不经 React 状态，不触发整页重渲染）
                                document
                                  .querySelector(`[data-paragraph-index="${item.index}"]`)
                                  ?.classList.add('review-paragraph-highlight');
                              }}
                              onMouseLeave={() => {
                                document
                                  .querySelector(`[data-paragraph-index="${item.index}"]`)
                                  ?.classList.remove('review-paragraph-highlight');
                              }}
                              onClick={() => onBoxSelect?.(item.index)}
                              title={`段落 ${item.index + 1}`}
                            />
                          );
                        })}
                    </>
                  ) : (
                    <div
                      className="flex items-center justify-center bg-canvas-soft"
                      style={{ height: estHeight }}
                    >
                      <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </Document>
      )}
    </div>
  );
}
