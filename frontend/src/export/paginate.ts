/**
 * 装箱：把测量好的内容块分配到固定页高的页（纯函数，无 DOM 依赖）。
 * 左/右栏独立装箱（互不等待），页数取大者，短轨尾部留白；
 * 段落按行拆分跨页（绝不断词）；超高卡片按碎片拆分，续页插「— 续」；
 * keepNext 块（组头/总结头/栏头）与后随块粘合，避免孤悬页尾。
 * 右栏解析组锚点：组头对齐左栏对应段落起始（opts.anchors），对齐间隙由
 * PageItem.padTop 物化（渲染端 margin-top）；放不下依次下排；组跨页时
 * 续页顶部插「第 N 段 · 续」（gcont 合成条目）。
 */
// GAP_LEFT（段落尾 margin）不再参与装箱预算：margin 在测量树中折叠出包裹 div，
// 由下一块的实测间距承载；页尾片段由 CSS 去边距规则裁掉。

import { blockIds } from './exportBlocks';

/** 段落行信息：en/zh 各自的每行高度与行结束文本偏移（zh 缺失时为空数组） */
export interface LineInfo {
  /** 每行结束处的文本偏移，如 [8, 21, 34, …]（最后一项 = 文本长度） */
  enEnds: number[];
  hEn: number;
  zhEnds: number[];
  hZh: number;
  /** en 与 zh 之间的间距（CSS margin-top，须与 .ep-zh 一致） */
  zhGap: number;
}

/** 卡片碎片高度 */
export interface FragMeasure {
  id: string;
  h: number;
}

export interface MeasuredBlock {
  id: string;
  h: number;
  keepNext?: boolean;
  /** 段落/总结 <p>：可行级拆分跨页 */
  lines?: LineInfo;
  /** 卡片碎片序列（仅当 h > 页高时启用拆分） */
  frags?: FragMeasure[];
}

/** 段落拆分片段（文本偏移，作用于规范化文本） */
export interface ParagraphFragDef {
  enFrom: number;
  enTo: number;
  zhFrom: number;
  zhTo: number;
}

/** 页内条目：整块或碎片；padTop = 渲染端 margin-top，物化锚点对齐间隙 */
export interface PageItem {
  blk: string;
  frag?: ParagraphFragDef | { fragId: string };
  /** 锚点对齐所需的前置间隙（装箱模型 y 与 DOM 流几何的差值；0/undefined = 无） */
  padTop?: number;
}

export interface PagePlan {
  totalPages: number;
  /** 每页的左右栏条目 */
  pages: { left: PageItem[]; right: PageItem[] }[];
  /** 需要在其前插「— 续」页眉的碎片 id */
  contBefore: Set<string>;
}

/** packTrack 可选输入：锚点（右栏组头对齐）与位置记录（左栏段落锚点来源） */
export interface TrackOpts {
  /** 块 id → 锚点 (page, y)：带锚点的块尝试从其锚点位置开始，否则顺序下排 */
  anchors?: Map<string, { page: number; y: number }>;
  /** 块 id → 首次放置位置（块起点；跨页段落取首片段） */
  positions?: Map<string, { page: number; y: number }>;
}

function isFragId(frag: PageItem['frag']): frag is { fragId: string } {
  return !!frag && 'fragId' in frag;
}

/**
 * 单轨道装箱（左栏或右栏或单栏混合流）。
 * spacing[i] = 块 i 与上一块的间距（实测，页首忽略）。
 */
export function packTrack(
  blocks: MeasuredBlock[],
  bodyH: number,
  spacing: number[],
  contH: number,
  contGap: number,
  opts?: TrackOpts
): { pages: PageItem[][]; contBefore: Set<string> } {
  const { anchors, positions } = opts ?? {};
  const pages: PageItem[][] = [[]];
  const contBefore = new Set<string>();
  let fill = 0;
  // 当前解析组（g:pi 的 pi）与其组头放置页：组跨页时卡片落新页前插「第 N 段 · 续」
  let curGroup: number | null = null;
  let curGroupPage = 0;
  const space = (i: number) => (fill > 0 ? spacing[i] ?? 0 : 0);
  const isGroupHeader = (id: string) => /^g:\d+$/.test(id);
  /** 记录块首次放置位置（左栏段落锚点来源）；组头放置页同步更新 curGroupPage */
  const markPlaced = (b: MeasuredBlock, page: number, top: number) => {
    if (isGroupHeader(b.id)) curGroupPage = page;
    if (positions && !positions.has(b.id)) positions.set(b.id, { page, y: top });
  };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const next = blocks[i + 1];
    if (isGroupHeader(b.id)) curGroup = Number(b.id.slice(2));

    // 锚点解析：组头尝试从对应段落的 (页, y) 开始（对齐左栏原文起始）。
    // 锚点页超前 → 补空页（fill 归零）；同页且 cursor 未越过 → 精确对齐；
    // 其余（cursor 已越过锚点）→ 顺序流，锚点处空穴保留（依次往下展示）。
    let exact = false;
    const a = anchors?.get(b.id);
    if (a) {
      if (a.page > pages.length - 1) {
        while (pages.length <= a.page) pages.push([]);
        fill = 0;
        exact = true;
      } else if (a.page === pages.length - 1 && fill <= a.y) {
        exact = true;
      }
    }
    // 放置 top：精确锚点 = 锚点 y（免 space，间隙由 padTop 物化）；
    // 顺序流 = fill + space（与既有逻辑一致）
    let placementTop = exact && a ? a.y : fill + space(i);

    // keep-with-next：与后块放不同页则整体换页（避免孤悬页尾；页首跳过，
    // 锚点放置位于页内时以其 y 判断）
    if (b.keepNext && (fill > 0 || placementTop > 0) && next) {
      const withNext = placementTop + b.h + (spacing[i + 1] ?? 0) + next.h;
      if (withNext > bodyH) {
        pages.push([]);
        fill = 0;
        placementTop = 0;
        exact = false;
      }
    }

    // 整块原子放置（预留 10px 安全余量，与行拆分循环一致，吸收测量/渲染亚像素偏差）
    if (placementTop + b.h <= bodyH - 10) {
      pages[pages.length - 1].push(
        exact
          ? { blk: b.id, padTop: placementTop - fill - (fill > 0 ? space(i) : 0) }
          : { blk: b.id }
      );
      fill = placementTop + b.h;
      markPlaced(b, pages.length - 1, placementTop);
      continue;
    }

    // 段落/总结 <p>：按行拆分（旧 packLeft 行填充循环）
    if (b.lines) {
      const L = b.lines;
      let enLine = 0;
      let zhLine = 0;
      let n = 0;
      const enOff = (k: number) => (k <= 0 ? 0 : L.enEnds[k - 1]);
      const zhOff = (k: number) => (k <= 0 ? 0 : L.zhEnds[k - 1]);

      for (;;) {
        // 安全余量：吸收词边界回退/子像素取整的亚行级误差（≤ 10px < 最小行高），
        // 保证片段预算不超出页面可用高度
        const avail = bodyH - fill - (fill > 0 ? space(i) : 0) - 10;
        let h = 0;
        const enStart = enLine;
        const zhStart = zhLine;

        // 放尽可能多的 en 行。不预留段落尾 margin：该 margin（.ep-paragraph
        // margin-bottom）在测量树中折叠出包裹 div，已由下一块的实测间距 space
        // 承载；此处按行预留 + 片段补加都会双算，导致每页文末少放 ~14px
        while (enLine < L.enEnds.length && h + L.hEn <= avail) {
          h += L.hEn;
          enLine++;
        }
        // en 放完仍有空间 → 尝试 zhGap + zh 行（zhGap 与 zh 首行必须完整放下）
        if (enLine >= L.enEnds.length && zhLine < L.zhEnds.length && h + L.zhGap + L.hZh <= avail) {
          h += L.zhGap;
          while (zhLine < L.zhEnds.length && h + L.hZh <= avail) {
            h += L.hZh;
            zhLine++;
          }
        }
        // 一行都放不下 → 换页重试（行高远小于页高，页首必然能放）
        if (h === 0 && fill > 0) {
          pages.push([]);
          fill = 0;
          continue;
        }
        // 兜底：页首仍放不下（行高 ≥ 页高，实际不可能）→ 强制放一行防死循环
        if (h === 0) {
          if (enLine < L.enEnds.length) {
            h = L.hEn;
            enLine++;
          } else if (zhLine < L.zhEnds.length) {
            h = L.hZh;
            zhLine++;
          } else {
            break; // 所有行已放完
          }
        }

        // 片段占位 = 行高（段落尾 margin 由下一块放置时的实测间距承载；
        // 页尾片段不补 —— 其 margin 由 CSS 页尾去边距规则裁掉，见 index.css）
        const fragTop = fill + (fill > 0 ? space(i) : 0);
        pages[pages.length - 1].push({
          blk: b.id,
          frag: {
            enFrom: enOff(enStart),
            enTo: enOff(enLine),
            zhFrom: zhOff(zhStart),
            zhTo: zhOff(zhLine),
          },
        });
        fill += h;
        n++;
        markPlaced(b, pages.length - 1, fragTop);

        if (enLine >= L.enEnds.length && zhLine >= L.zhEnds.length) break;
        // 还有剩余行 → 下一片段换页
        pages.push([]);
        fill = 0;
      }
      continue;
    }

    // 超高卡片：逐碎片填充（非首个碎片入新页时标记 contBefore）
    if (b.frags && b.h > bodyH) {
      for (let k = 0; k < b.frags.length; k++) {
        const f = b.frags[k];
        const needCont = k > 0;
        const fAdd = (needCont ? contH + contGap : 0) + f.h + (fill > 0 ? space(i) : 0);
        if (fill + fAdd > bodyH && (fill > 0 || needCont)) {
          pages.push([]);
          fill = 0;
          if (needCont) contBefore.add(f.id);
        }
        const fTop = fill + (fill > 0 ? space(i) : 0);
        pages[pages.length - 1].push({ blk: b.id, frag: { fragId: f.id } });
        fill += (needCont ? contH + contGap : 0) + f.h + (fill > 0 ? space(i) : 0);
        markPlaced(b, pages.length - 1, fTop);
      }
      continue;
    }

    // 不可拆块：整块挪下一页（超页块照放，overflow:hidden 兜底裁剪）。
    // 组内卡片落新页时先插「第 N 段 · 续」标记（每新页恰一个）；组头自身
    // 落兜底则新页即组起点，不插标记（curGroupPage 由 markPlaced 更新）
    pages.push([]);
    fill = 0;
    if (!isGroupHeader(b.id) && curGroup !== null && curGroupPage < pages.length - 1) {
      pages[pages.length - 1].push({ blk: blockIds.gcont(curGroup) });
      fill += contH + contGap;
    }
    const fbTop = fill;
    pages[pages.length - 1].push({ blk: b.id });
    fill += b.h;
    markPlaced(b, pages.length - 1, fbTop);
  }

  // 去除尾空页
  while (pages.length > 1 && pages[pages.length - 1].length === 0) pages.pop();
  return { pages, contBefore };
}

export function paginate(
  leftBlocks: MeasuredBlock[],
  rightBlocks: MeasuredBlock[],
  bodyH: number,
  spacingLeft: number[],
  spacingRight: number[],
  contH: number,
  contGap: number,
  singleColumn: boolean
): PagePlan {
  if (singleColumn) {
    const { pages, contBefore } = packTrack(leftBlocks, bodyH, spacingLeft, contH, contGap);
    return {
      totalPages: pages.length,
      pages: pages.map((p) => ({ left: p, right: [] })),
      contBefore,
    };
  }
  // Pass 1：左栏照旧装箱，同时记录每段（p:i）的首次放置位置（锚点来源）。
  // Pass 2：右栏按锚点装箱 —— g:i 组头对齐 p:i 段落起始（同页同 y）。
  const positions = new Map<string, { page: number; y: number }>();
  const L = packTrack(leftBlocks, bodyH, spacingLeft, contH, contGap, { positions });
  const anchors = new Map<string, { page: number; y: number }>();
  for (const [id, pos] of positions) {
    const m = id.match(/^p:(\d+)$/);
    if (m) anchors.set(blockIds.g(Number(m[1])), pos);
  }
  const R = packTrack(rightBlocks, bodyH, spacingRight, contH, contGap, { anchors });
  const total = Math.max(L.pages.length, R.pages.length);
  const contBefore = new Set([...L.contBefore, ...R.contBefore]);
  const pages = Array.from({ length: total }, (_, i) => ({
    left: L.pages[i] ?? [],
    right: R.pages[i] ?? [],
  }));
  return { totalPages: total, pages, contBefore };
}

export { isFragId };
