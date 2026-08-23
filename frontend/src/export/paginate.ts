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
  /** 卡片碎片序列（仅当 h 超过拆分阈值时启用拆分） */
  frags?: FragMeasure[];
  /** 卡片对应 token 在段内归一化文本中的字符偏移（同页对齐用；未定位词 = Infinity） */
  pos?: number;
  /** 段落实体尾 margin（实测 CSS 值；行级拆分装箱计账用，见 collectTrack） */
  tail?: number;
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
  /** 行带短侧补齐空白（渲染端 margin-bottom；BLANK 占位块为高度） */
  padBottom?: number;
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
        markPlaced(b, pages.length - 1, fragTop);

        if (enLine >= L.enEnds.length && zhLine >= L.zhEnds.length) break;
        // 还有剩余行 → 下一片段换页
        pages.push([]);
        fill = 0;
      }
      continue;
    }

    // 超高卡片：逐碎片填充（非首个碎片入新页时标记 contBefore）
    if (b.frags && isSplittable(b, bodyH)) {
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
  singleColumn: boolean,
  alignSamePage = true
): PagePlan {
  if (singleColumn) {
    const { pages, contBefore } = packTrack(leftBlocks, bodyH, spacingLeft, contH, contGap);
    return {
      totalPages: pages.length,
      pages: pages.map((p) => ({ left: p, right: [] })),
      contBefore,
    };
  }
  return paginateTwoColumn(
    leftBlocks,
    rightBlocks,
    bodyH,
    spacingLeft,
    spacingRight,
    contH,
    contGap,
    alignSamePage
  );
}

// ── 双栏严格按段落对齐（行带模型）──
// 每段是一个「行带」：左栏原文（p:i）与右栏解析（g:i + 卡片）同一起始 y，
// 行带高度 = 两侧取大者，较短一侧在内容下方补空白（padBottom / BLANK 占位），
// 因此下一行带在左右栏同时从相同 y 开始 —— 对齐由构造保证，不依赖锚点。
// 行带跨页时左右两侧同步续排：右栏续页顶部插「第 N 段 · 续」（gcont），
// 左栏以 padTop 让出同高占位，续页左右内容仍严格对齐。
// 高度语义：左测量轨为 flex 列（块高已含自身底 margin），右测量轨为块布局
// （块高仅内容、间距在 spacing），故行带计算不用 spacing 数组，改用 CSS 常量。

/** 合成空白占位块 id（渲染为带高度的空 div，补齐行带短侧） */
export const BLANK = blockIds.blank;

/** 左栏段落尾 margin 常量已废弃：尾距由 MeasuredBlock.tail 实测携带（collectTrack） */

/** 安全余量（与 packTrack 一致，吸收测量/渲染亚像素偏差） */
const SAFETY = 10;
/** 卡片碎片拆分阈值比例：卡高超过该比例的页高即按碎片拆分，避免整卡跳页留下大片页底空白 */
const CARD_SPLIT_RATIO = 0.5;
/** 同页对齐截断的最大可容忍浪费（占页高比例）：截断损失行高超过该值时放弃本片对齐，回退自然放置填满页高 */
const ALIGN_WASTE_MAX_RATIO = 0.25;

/** 卡片是否启用碎片拆分（超过阈值的卡整卡跳页会留下大片页底空白） */
function isSplittable(b: MeasuredBlock, bodyH: number): boolean {
  return !!b.frags && b.h > bodyH * CARD_SPLIT_RATIO;
}

/** 行带：左右两侧作为一个整体装箱的单元 */
interface Band {
  kind: 'title' | 'colhead' | 'para' | 'sum';
  /** para 行带的段落下标 */
  pi?: number;
  left: MeasuredBlock;
  /** para：g:pi + 卡片；colhead：colHeadR (+ empty)；其余为空 */
  right: MeasuredBlock[];
  /** 与下一行带首片同页（栏头/总结头避免孤悬页尾） */
  keepNext?: boolean;
}

/** 行带装箱游标状态 */
interface BandState {
  enLine: number;
  zhLine: number;
  leftDone: boolean;
  rightIdx: number;
  rightFragIdx: number;
  rightDone: boolean;
  /** g:pi 组头是否已放置过（续页插 gcont 标记的依据） */
  headEmitted: boolean;
  /** 行带是否已跨页续排 */
  continued: boolean;
}

const isGroupHeader = (id: string) => /^g:\d+$/.test(id);

/** 右栏块在 flex 渲染列中的占高：测量树已改为与渲染一致的 flex 列，
 *  wrapper 高度天然包含块自身 margin，无需再手工同步尾距常量 */
function rightItemDomH(b: MeasuredBlock): number {
  return b.h;
}

/** 段落行带切片的尾 margin：按行拆分的段落实体带实测尾距（.ep-paragraph margin-bottom） */
function tailMargin(band: Band): number {
  return band.kind === 'para' && band.left.lines ? band.left.tail ?? 0 : 0;
}

/** 行带首片最小高度（keepNext 预判用） */
function firstSliceMinH(b: Band): number {
  const l = b.left.lines ? b.left.lines.hEn + tailMargin(b) : b.left.h;
  let r = 0;
  if (b.right.length > 0) {
    r = rightItemDomH(b.right[0]);
    if (b.right.length > 1) r += rightItemDomH(b.right[1]);
  }
  return Math.max(l, r);
}

/**
 * 把左右块组装为行带序列。段落列表由左栏块推导（title/colhead/每段/总结），
 * 右栏块按 g: 组头分组成每段的解析；无解析段落右栏为空（渲空白）。
 */
function buildBands(leftBlocks: MeasuredBlock[], rightBlocks: MeasuredBlock[]): Band[] {
  const rightGroups = new Map<number, MeasuredBlock[]>();
  const preGroups: MeasuredBlock[] = [];
  let cur: MeasuredBlock[] | null = null;
  for (const b of rightBlocks) {
    const m = b.id.match(/^g:(\d+)$/);
    if (m) {
      // 组头本身作为该组第一块（placeRightSlice 的组头抗孤头逻辑依赖它参与装箱）
      cur = [b];
      rightGroups.set(Number(m[1]), cur);
    } else if (cur) {
      cur.push(b);
    } else {
      preGroups.push(b);
    }
  }
  const bands: Band[] = [];
  for (const lb of leftBlocks) {
    if (lb.id === blockIds.title) {
      bands.push({ kind: 'title', left: lb, right: [] });
    } else if (lb.id === blockIds.colHeadL) {
      bands.push({ kind: 'colhead', left: lb, right: preGroups, keepNext: true });
    } else if (lb.id === blockIds.sumHead) {
      bands.push({ kind: 'sum', left: lb, right: [], keepNext: true });
    } else if (/^sum-b:/.test(lb.id)) {
      bands.push({ kind: 'sum', left: lb, right: [] });
    } else {
      const m = lb.id.match(/^p:(\d+)$/);
      if (m) {
        const pi = Number(m[1]);
        bands.push({ kind: 'para', pi, left: lb, right: rightGroups.get(pi) ?? [] });
      }
    }
  }
  return bands;
}

/** 左栏切片：段落按行放（en 先行、en 完再 zh），原子块整块放。
 *  maxLines：累计 en 行上限（同页对齐截断用；undefined = 不设限） */
function placeLeftSlice(
  band: Band,
  st: BandState,
  avail: number,
  force: boolean,
  maxLines?: number
): { items: PageItem[]; placed: number; done: boolean } {
  const L = band.left.lines;
  if (!L) {
    if (band.left.h > avail && !force) return { items: [], placed: 0, done: false };
    return { items: [{ blk: band.left.id }], placed: band.left.h, done: true };
  }
  const enStart = st.enLine;
  const zhStart = st.zhLine;
  let h = 0;
  const enCap = maxLines ?? L.enEnds.length;
  while (st.enLine < enCap && h + L.hEn <= avail) {
    h += L.hEn;
    st.enLine++;
  }
  if (st.enLine >= L.enEnds.length && st.zhLine < L.zhEnds.length && h + L.zhGap + L.hZh <= avail) {
    h += L.zhGap;
    while (st.zhLine < L.zhEnds.length && h + L.hZh <= avail) {
      h += L.hZh;
      st.zhLine++;
    }
  }
  // 页首兜底：强制放一行（正常不会走到——页首 avail 恒大于行高，防死循环；
  // maxLines 生效时同样尊重上限，且 zh 兜底仅限 en 已放完，避免 zh 行脱离 en）
  if (h === 0 && force) {
    if (st.enLine < enCap) {
      h = L.hEn;
      st.enLine++;
    } else if (st.enLine >= L.enEnds.length && st.zhLine < L.zhEnds.length) {
      h = L.hZh;
      st.zhLine++;
    }
  }
  const done = st.enLine >= L.enEnds.length && st.zhLine >= L.zhEnds.length;
  if (h === 0) return { items: [], placed: 0, done };
  const enOff = (k: number) => (k <= 0 ? 0 : L.enEnds[k - 1]);
  const zhOff = (k: number) => (k <= 0 ? 0 : L.zhEnds[k - 1]);
  return {
    items: [
      {
        blk: band.left.id,
        frag: {
          enFrom: enOff(enStart),
          enTo: enOff(st.enLine),
          zhFrom: zhOff(zhStart),
          zhTo: zhOff(st.zhLine),
        },
      },
    ],
    placed: h,
    done,
  };
}

/** 右栏切片：卡片逐个放（组头须与首卡同页避免孤头；超高卡走碎片路径）。
 *  maxCards：累计右栏块索引上限（同页对齐截断用；undefined = 不设限）。
 *  上限按整卡边界生效（绝不切到碎片中间）；pos=Infinity（原文中找不到的
 *  孤立解析）的卡允许越过上限——它们没有可见 token 可匹配，否则永不放置。 */
function placeRightSlice(
  band: Band,
  st: BandState,
  avail: number,
  bodyH: number,
  contH: number,
  contGap: number,
  contBefore: Set<string>,
  atPageTop: boolean,
  suppressCardCont: boolean,
  maxCards?: number
): { items: PageItem[]; placed: number } {
  const items: PageItem[] = [];
  let placed = 0;
  while (st.rightIdx < band.right.length) {
    const b = band.right[st.rightIdx];
    if (maxCards !== undefined && st.rightIdx >= maxCards && b.pos !== Infinity) break;
    // 页首兜底：一行都没放时强制放当前卡（超页卡照放，overflow 兜底裁剪），
    // 避免不可拆卡在页首也放不下而被静默丢弃 —— 与 packTrack「不可拆块照放」一致
    const force = atPageTop && placed === 0;
    // 组头 + 首卡须同页放下（避免页尾孤头）；页首 avail 足够，跳过
    if (isGroupHeader(b.id) && st.rightFragIdx === 0 && !atPageTop && st.rightIdx + 1 < band.right.length) {
      if (placed + rightItemDomH(b) + rightItemDomH(band.right[st.rightIdx + 1]) > avail) break;
    }
    const oversized = isSplittable(b, bodyH);
    if (!oversized) {
      const domH = rightItemDomH(b);
      if (placed + domH > avail && !force) break;
      items.push({ blk: b.id });
      placed += domH;
      if (isGroupHeader(b.id)) st.headEmitted = true;
      st.rightIdx++;
      continue;
    }
    // 超高卡：逐碎片填充（非首碎片续页插「— 续」；已显示 gcont 的页抑制避免双标记）
    const frags = b.frags!;
    let any = false;
    while (st.rightFragIdx < frags.length) {
      const f = frags[st.rightFragIdx];
      const needCont = st.rightFragIdx > 0 && !suppressCardCont;
      const fAdd = (needCont ? contH + contGap : 0) + f.h;
      if (placed + fAdd > avail && !force) break;
      placed += fAdd;
      if (needCont) contBefore.add(f.id);
      items.push({ blk: b.id, frag: { fragId: f.id } });
      st.rightFragIdx++;
      any = true;
    }
    if (any && st.rightFragIdx >= frags.length) {
      st.rightIdx++;
      st.rightFragIdx = 0;
    }
    if (!any || st.rightFragIdx < frags.length) break; // frag0 放不下 / 卡未放完
  }
  return { items, placed };
}

/** 纯预算：给定 avail，本片可放的最大 en 行数（与 placeLeftSlice 同一套 fit 逻辑） */
function maxEnLinesThatFit(L: LineInfo, avail: number): number {
  let h = 0;
  let k = 0;
  while (k < L.enEnds.length && h + L.hEn <= avail) {
    h += L.hEn;
    k++;
  }
  return k;
}

/**
 * 双栏严格对齐装箱：逐行带同步放置左右两侧。
 * 两侧共享游标 fill；每片左右同一起始 y，短侧以 padBottom/BLANK 补到切片高；
 * 行带未放完则换新页两侧同步续排（右栏 gcont 标记，左栏 padTop 让位）。
 * 同页对齐（alignSamePage，默认开）：每片把「左栏可见 token 集」与「右栏已放
 * 卡片集」对齐为同一前缀 —— 先按可见 token 数上限放卡片（maxCards），卡片滞后
 * 时把左栏行界截到已放卡界（maxLines），页界落在 token 行界 = 卡界处。
 */
export function paginateTwoColumn(
  leftBlocks: MeasuredBlock[],
  rightBlocks: MeasuredBlock[],
  bodyH: number,
  _spacingLeft: number[],
  _spacingRight: number[],
  contH: number,
  contGap: number,
  alignSamePage = true
): PagePlan {
  const bands = buildBands(leftBlocks, rightBlocks);
  const pages: { left: PageItem[]; right: PageItem[] }[] = [{ left: [], right: [] }];
  const contBefore = new Set<string>();
  let fill = 0;

  for (let bi = 0; bi < bands.length; bi++) {
    const band = bands[bi];
    const next = bands[bi + 1];

    // keepNext（栏头/总结头）：与下一行带首片同页，避免孤悬页尾
    if (band.keepNext && next && fill > 0) {
      if (fill + firstSliceMinH(band) + firstSliceMinH(next) > bodyH - SAFETY) {
        pages.push({ left: [], right: [] });
        fill = 0;
      }
    }

    const st: BandState = {
      enLine: 0,
      zhLine: 0,
      leftDone: false,
      rightIdx: 0,
      rightFragIdx: 0,
      rightDone: band.right.length === 0,
      headEmitted: false,
      continued: false,
    };

    while (!(st.leftDone && st.rightDone)) {
      // 行带续页：右栏顶部插「第 N 段 · 续」，左右两侧预留同高占位
      const needGcont = fill === 0 && st.continued && !st.rightDone && st.headEmitted;
      const topReserve = needGcont ? contH + contGap : 0;
      const avail = bodyH - fill - topReserve - SAFETY;

      // ── 同页对齐预算（两趟：先无上限预算右栏 → 求对齐截断目标 → 正式放置）──
      // 目标：把「左栏可见 token 集」与「右栏已放卡片集」对齐为同一前缀。
      // j* = 可放卡数 mMax 内最后一个 count(pos ≤ enEnds[j-1]) ≤ mMax 的行界，
      // m* = count 于 j*（≤ mMax）。左栏截到 j*、右栏 cap 到 m* ⇒ 严格同页。
      let maxCards: number | undefined;
      let maxLines: number | undefined;
      // 仅当组内存在「有定位 token」的卡才对齐：全未定位（pos 缺失/Infinity）时
      // 无可见 token 可匹配，跳过对齐走自然放置，避免 cap=0 抑制全部卡片/死循环
      const hasPosCard =
        band.right.length > 1 &&
        band.right.slice(1).some((c) => typeof c.pos === 'number' && c.pos !== Infinity);
      if (
        alignSamePage &&
        band.kind === 'para' &&
        band.left.lines &&
        hasPosCard &&
        !st.leftDone &&
        !st.rightDone
      ) {
        const L = band.left.lines;
        const kMaxCum = st.enLine + maxEnLinesThatFit(L, avail);
        if (kMaxCum > 0) {
          // 预算趟：无上限放一次右栏得 mMax（副作用仅 contBefore 幂等标记，无害）
          const saveRI = st.rightIdx;
          const saveRF = st.rightFragIdx;
          const saveHE = st.headEmitted;
          placeRightSlice(band, st, avail, bodyH, contH, contGap, contBefore, fill === 0, needGcont);
          const mMax = st.headEmitted ? st.rightIdx - 1 : 0;
          st.rightIdx = saveRI;
          st.rightFragIdx = saveRF;
          st.headEmitted = saveHE;

          if (mMax >= 1) {
            let jStar = 0;
            let mStar = 0;
            let cnt = 0;
            for (let li = 1; li <= kMaxCum; li++) {
              const e = L.enEnds[li - 1];
              while (cnt < band.right.length - 1) {
                const p = band.right[cnt + 1].pos;
                if (p === undefined || p === Infinity || p > e) break;
                cnt++;
              }
              if (cnt <= mMax) {
                jStar = li;
                mStar = cnt;
              }
            }
            if (jStar >= 1 && jStar < kMaxCum) {
              if ((kMaxCum - jStar) * L.hEn > bodyH * ALIGN_WASTE_MAX_RATIO) {
                // 截断会截掉太多行（页底大片空白）→ 放弃本片对齐，
                // 不设限自然放置：左栏填满页高，卡片滞后接受跨页错位
              } else {
                // 卡片滞后（可见 token 超可放卡）：左栏截到 token m* 所在行，右栏 cap 到 m*
                maxLines = jStar;
                maxCards = 1 + mStar;
              }
            } else if (jStar >= 1) {
              // 无需截断（可见 token ≤ 可放卡）：右栏 cap 到可见数，防卡片超前
              maxCards = mStar >= 1 ? 1 + mStar : 0;
            } else {
              // 首行已超 mMax（行不可拆）：放满可放卡片，接受行内残留
              maxCards = 1 + mMax;
            }
          }
          // mMax == 0（卡片放不下）→ 不设限，走自然翻页兜底
        }
      }

      // 右栏切片（对齐预算后带 maxCards 正式放置）
      const R: PageItem[] = [];
      let rightPlaced = 0;
      if (needGcont) {
        R.push({ blk: blockIds.gcont(band.pi!) });
        rightPlaced += topReserve;
      }
      if (!st.rightDone) {
        const sr = placeRightSlice(
          band,
          st,
          avail,
          bodyH,
          contH,
          contGap,
          contBefore,
          fill === 0,
          needGcont,
          maxCards
        );
        R.push(...sr.items);
        rightPlaced += sr.placed;
        st.rightDone = st.rightIdx >= band.right.length;
      }

      // 左栏切片（maxLines 为累计上限；对齐预算与实际放置共用同一 fit 逻辑）
      const L: PageItem[] = [];
      let leftPlaced = 0;
      if (!st.leftDone) {
        const sl = placeLeftSlice(band, st, avail, fill === 0, maxLines);
        if (sl.placed > 0) {
          L.push({
            blk: sl.items[0].blk,
            frag: sl.items[0].frag,
            padTop: needGcont ? topReserve : undefined,
          });
          leftPlaced = sl.placed;
          st.leftDone = sl.done;
        }
      }

      // 两侧都放不下：页中换页重试；页首仍放不下属异常，防御性结束行带
      if (leftPlaced === 0 && rightPlaced === 0) {
        if (fill > 0) {
          pages.push({ left: [], right: [] });
          fill = 0;
          continue;
        }
        break;
      }

      // 切片高 = 左右取大（左含 padTop 让位 + 段尾 margin；右含 gcont 占位）
      const leftTotal = leftPlaced > 0 ? topReserve + leftPlaced + tailMargin(band) : 0;
      const rightTotal = rightPlaced;
      const sliceH = Math.max(leftTotal, rightTotal, 1);

      // 短侧补齐：有内容 → 末项 padBottom；无内容 → 空白占位
      if (L.length) L[L.length - 1].padBottom = Math.max(0, sliceH - leftTotal);
      else L.push({ blk: BLANK, padBottom: sliceH });
      if (R.length) R[R.length - 1].padBottom = Math.max(0, sliceH - rightTotal);
      else R.push({ blk: BLANK, padBottom: sliceH });

      pages[pages.length - 1].left.push(...L);
      pages[pages.length - 1].right.push(...R);
      fill += sliceH;

      if (!(st.leftDone && st.rightDone)) {
        pages.push({ left: [], right: [] });
        fill = 0;
        st.continued = true;
      }
    }
  }

  // 去除左右皆空的尾页
  while (pages.length > 1 && pages[pages.length - 1].left.length === 0 && pages[pages.length - 1].right.length === 0) {
    pages.pop();
  }
  return { totalPages: pages.length, pages, contBefore };
}

export { isFragId };
