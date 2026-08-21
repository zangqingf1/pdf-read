/** MinerU bbox → react-pdf 渲染坐标换算（PDF 预览布局解析框用）。 */

/**
 * MinerU bbox 是「渲染图像像素」坐标。后端在解析时已把每页实际渲染缩放
 * scale（MinerU 用 pypdfium2 以 dpi=200 渲染，长边超 3500px 时钳制，
 * 见 `mineru/utils/pdf_reader.py`）存入 layout；此常量仅作为旧数据
 * （无 scale 字段）的回退假设。
 */
export const MINERU_BBOX_DPI = 200;

/** MinerU Cloud 归一化坐标空间的宽度（bbox 实际落在约 1000×1000 正方形空间） */
export const MINERU_NORMALIZED_SPACE = 1000;

export interface PdfLayout {
  /** MinerU bbox [x1, y1, x2, y2]（渲染图像像素） */
  box: number[];
  /** 该页 PDF 点数宽度（pypdf mediabox） */
  pts_w: number;
  /** 该页 PDF 点数高度（pypdf mediabox） */
  pts_h: number;
  /** 该页 MinerU 渲染缩放（图像像素/PDF 点）；旧数据可能缺失 */
  scale?: number;
}

export interface ParagraphLayoutItem {
  index: number;
  page_number: number | null;
  layout: PdfLayout;
  /** 段落英文原文（用于前端「文本自校准」与 pdf.js 文本匹配定位） */
  text?: string;
}

/**
 * 将 MinerU bbox 换算为以 renderWidth 为宽的 CSS 像素矩形。
 *
 * 正常路径（自校准成功）不经过这里。此回退分两种情况：
 * - MinerU Cloud 的 bbox 实际落在约 1000×1000 归一化坐标空间，存储的 scale
 *   （200dpi 假设）对其无效 —— 若按 scale 计算会把框放大约 2.8 倍。检测特征：
 *   box 坐标很小而 pts_w × scale 远大于 1000 → 按「box/1000 × 页宽」归一化换算。
 * - 真渲染像素坐标：css = box × renderWidth / (pts_w × scale)。
 * scale 缺失（旧文档）时回退 MINERU_BBOX_DPI=200 假设：scale = 200/72。
 */
export function bboxToCss(
  layout: PdfLayout,
  renderWidth: number
): { x: number; y: number; w: number; h: number } {
  const [x1, y1, x2, y2] = layout.box;
  const maxCoord = Math.max(x1, y1, x2, y2);
  const impliedImageW = layout.pts_w * (layout.scale ?? MINERU_BBOX_DPI / 72);
  // 归一化空间判定：box 坐标落在 ~1000 以内，且按 scale 推算的渲染图远大于该范围
  //（若真是像素坐标，box 不可能远小于整幅图）——此时按 scale 换算会放大数倍
  const isNormalized =
    Number.isFinite(maxCoord) &&
    maxCoord <= MINERU_NORMALIZED_SPACE + 100 &&
    impliedImageW > maxCoord * 1.5;
  if (isNormalized) {
    // 归一化 ~1000×1000 坐标空间：x 直接映射到页宽，y 按页面纵横比缩放
    const pageH = renderWidth * (layout.pts_h / layout.pts_w);
    return {
      x: (x1 / MINERU_NORMALIZED_SPACE) * renderWidth,
      y: (y1 / MINERU_NORMALIZED_SPACE) * pageH,
      w: ((x2 - x1) / MINERU_NORMALIZED_SPACE) * renderWidth,
      h: ((y2 - y1) / MINERU_NORMALIZED_SPACE) * pageH,
    };
  }
  const scale = layout.scale ?? MINERU_BBOX_DPI / 72;
  const sx = renderWidth / (layout.pts_w * scale);
  return {
    x: x1 * sx,
    y: y1 * sx,
    w: (x2 - x1) * sx,
    h: (y2 - y1) * sx,
  };
}

/**
 * 合并两个相邻段落的布局框（用于「合并段落」时同步合并 PDF 解析框）。
 * - 同一页：取两框并集，text 拼接（与新段落文字一致，供文本自校准匹配）
 * - 不同页/缺页码：仅保留第一个框（合并后的段落跨页，无法用单框表示）
 */
export function mergeLayoutItems(
  a: ParagraphLayoutItem,
  b: ParagraphLayoutItem
): ParagraphLayoutItem {
  const samePage =
    a.page_number !== null && b.page_number !== null && a.page_number === b.page_number;
  if (!samePage) {
    return { ...a, text: a.text };
  }
  const [ax1, ay1, ax2, ay2] = a.layout.box;
  const [bx1, by1, bx2, by2] = b.layout.box;
  return {
    index: a.index,
    page_number: a.page_number,
    layout: {
      ...a.layout,
      box: [
        Math.min(ax1, bx1),
        Math.min(ay1, by1),
        Math.max(ax2, bx2),
        Math.max(ay2, by2),
      ],
    },
    text: ((a.text ?? '') + ' ' + (b.text ?? '')).trim(),
  };
}
