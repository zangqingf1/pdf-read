/**
 * 预计算装箱：把测量好的内容块分配到固定高度的页容器。
 * 左右栏独立装箱（互不等待），页数取大者，短轨尾部留白。
 * 常规卡片整体装箱（不跨页）；超高卡片按碎片拆分，续页插「— 续」页眉。
 * 左栏段落（.ep-paragraph）可按行拆分：当前页放不下的行顺延到下一页继续显示，
 * 不再整块挪页（避免页尾留白），也不再因段落超高而被 overflow:hidden 裁切。
 */

/** 已测量的块 */
export interface Measured {
  id: string;
  h: number;
  /** 段落行信息：可跨页拆分（按行边界切，绝不断词/断行） */
  lines?: LineInfo;
}

/** 段落行信息：en/zh 各自的每行高度与行结束文本偏移（zh 缺失时为空数组） */
export interface LineInfo {
  /** 每行结束处的文本偏移（相对该行文本），如 [8, 21, 34, …] */
  enEnds: number[];
  hEn: number;
  zhEnds: number[];
  hZh: number;
  /** en 与 zh 之间的间距（CSS margin-top，必须与 .ep-zh 一致） */
  zhGap: number;
}

/** 段落拆分片段：从原文本切片（enFrom/enTo 与 zhFrom/zhTo 均为文本偏移） */
export interface LeftFragDef {
  enFrom: number;
  enTo: number;
  zhFrom: number;
  zhTo: number;
}

/** 卡片碎片（仅超高卡片需要） */
export interface FragMeasure {
  id: string;
  h: number;
}

/** 右栏装箱单元：一张卡片 = 一个单元 */
export interface Unit {
  id: string;
  /** 整卡高度（含卡片 padding/边框） */
  totalH: number;
  /** 碎片序列（仅当 totalH > 页高时启用拆分） */
  frags?: FragMeasure[];
}

export interface PagePlan {
  totalPages: number;
  /** page → 左栏块/片段 id 列表 */
  left: string[][];
  /** page → 右栏碎片/卡片 id 列表（卡片 id 或碎片 id 混存） */
  right: string[][];
  /** 需要在其前插入续页眉的碎片 id */
  contBefore: Set<string>;
  /** 被拆分的左栏块 → 各片段的文本切片（未拆分的块不在此表中） */
  frags: Map<string, LeftFragDef>;
}

/**
 * 左栏装箱：普通块原子放置（放不下整块挪下一页）；段落块按行拆分，
 * 当前页放满整行，剩余行在下一页继续（同一段落连续跨多页）。
 */
export function packLeft(
  blocks: Measured[],
  pageH: number,
  gap: number
): { pages: string[][]; frags: Map<string, LeftFragDef> } {
  const pages: string[][] = [[]];
  const frags = new Map<string, LeftFragDef>();
  let fill = 0;

  for (const b of blocks) {
    // 整块放得下 → 原子放置
    const add = b.h + (fill > 0 ? gap : 0);
    if (fill + add <= pageH) {
      pages[pages.length - 1].push(b.id);
      fill += add;
      continue;
    }

    // 段落块 → 按行拆分
    if (b.lines) {
      const L = b.lines;
      let enLine = 0; // 下一个待放的 en 行号
      let zhLine = 0; // 下一个待放的 zh 行号
      let n = 0; // 已产出片段数（0 = 首个片段，保留原 id）
      let fragStart = fill === 0; // 当前片段是否位于页首（页首无 gap）

      // 行号 → 文本偏移（该行结束处）
      const enOff = (i: number) => (i <= 0 ? 0 : L.enEnds[i - 1]);
      const zhOff = (i: number) => (i <= 0 ? 0 : L.zhEnds[i - 1]);

      for (;;) {
        const avail = pageH - fill - (fragStart ? 0 : gap);
        let h = 0;
        const enStart = enLine;
        const zhStart = zhLine;

        // 先放尽可能多的 en 行
        while (enLine < L.enEnds.length && h + L.hEn <= avail) {
          h += L.hEn;
          enLine++;
        }
        // en 放完仍有空间 → 尝试 6px 间距 + zh 行
        if (enLine >= L.enEnds.length && zhLine < L.zhEnds.length && h + L.zhGap <= avail) {
          h += L.zhGap;
          while (zhLine < L.zhEnds.length && h + L.hZh <= avail) {
            h += L.hZh;
            zhLine++;
          }
        }
        // 一行都放不下 → 换页重试（行高远小于页高，页首必然能放）
        if (h === 0 && !fragStart) {
          pages.push([]);
          fill = 0;
          fragStart = true;
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

        const fid = n === 0 ? b.id : `${b.id}-c${n}`;
        frags.set(fid, {
          enFrom: enOff(enStart),
          enTo: enOff(enLine),
          zhFrom: zhOff(zhStart),
          zhTo: zhOff(zhLine),
        });
        pages[pages.length - 1].push(fid);
        fill += h;
        n++;

        if (enLine >= L.enEnds.length && zhLine >= L.zhEnds.length) break;
        // 还有剩余行 → 下一片段换页
        pages.push([]);
        fill = 0;
        fragStart = true;
      }
      continue;
    }

    // 不可拆块（标题/总结标题等）：整块挪下一页
    pages.push([]);
    fill = 0;
    pages[pages.length - 1].push(b.id);
    fill += b.h;
  }

  return { pages, frags };
}

/**
 * 右栏卡片装箱：常规卡片整体入页；超高卡片逐碎片填充，
 * 非首个碎片入新页时标记 contBefore（该碎片前插「— 续」页眉）。
 */
export function packRight(
  units: Unit[],
  pageH: number,
  gap: number,
  contH: number,
  contGap: number
): { pages: string[][]; contBefore: Set<string> } {
  const pages: string[][] = [[]];
  const contBefore = new Set<string>();
  let fill = 0;

  for (const u of units) {
    if (!u.frags || u.totalH <= pageH) {
      // 常规卡片：整卡入当前页
      const add = u.totalH + (fill > 0 ? gap : 0);
      if (fill + add > pageH && fill > 0) {
        pages.push([]);
        fill = 0;
      }
      pages[pages.length - 1].push(u.id);
      fill += add;
      continue;
    }

    // 超高卡片：逐碎片
    const frags = u.frags;
    for (let i = 0; i < frags.length; i++) {
      const f = frags[i];
      const needCont = i > 0;
      const add = (needCont ? contH + contGap : 0) + f.h + (fill > 0 ? gap : 0);
      if (fill + add > pageH && (fill > 0 || needCont)) {
        pages.push([]);
        fill = 0;
        if (needCont) contBefore.add(f.id);
      }
      pages[pages.length - 1].push(f.id);
      fill += (needCont ? contH + contGap : 0) + f.h + (fill > 0 ? gap : 0);
    }
  }

  return { pages, contBefore };
}

export function paginate(
  leftBlocks: Measured[],
  rightUnits: Unit[],
  pageContentH: number,
  gap: number,
  contH: number,
  contGap: number
): PagePlan {
  const { pages: left, frags } = packLeft(leftBlocks, pageContentH, gap);
  const { pages: right, contBefore } = packRight(rightUnits, pageContentH, gap, contH, contGap);
  return {
    totalPages: Math.max(left.length, right.length),
    left,
    right,
    contBefore,
    frags,
  };
}
