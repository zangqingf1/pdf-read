/**
 * 测量 + 装箱：把内容块分配到固定页高的页（预览与导出共用）。
 * 离屏宿主（body 级，position:fixed;left:-99999px，不可用 display:none）渲染测量树，
 * 实测块高/块间距（rect 差，吸收 margin 差异）/段落行信息（探针二分）/卡片碎片高/页眉页脚高。
 */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import {
  blockIds,
  collectLeftBlocks,
  collectRightBlocks,
  collectSingleBlocks,
  renderWholeBlock,
  renderSentenceFrag,
  sentenceCardFragIds,
  wordCardFragRows,
  type BlockDef,
  type BlockCtx,
} from './exportBlocks';
import { paginate, type LineInfo, type MeasuredBlock, type PagePlan } from './paginate';
import { PAPER_SIZES, mmToPx, PAGE_PADDING, COL_GAP, CONT_GAP, ZH_GAP } from './exportTypes';
import type { ExportData } from './data';
import type { ExportPreferences } from './exportTypes';

/**
 * 元素内全部文本节点（文档序）。token 高亮 span、首字下沉等内联样式全部保留，
 * 行界在真实渲染几何上测定，与最终分页 DOM 必然一致。
 */
function textNodesIn(el: HTMLElement): Text[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/**
 * 计算元素每行信息：行高 + 每行结束处的文本偏移。
 * 直接在测量树中的真实元素上逐字符取字形盒矩形（非折叠 Range）：
 * 加粗 token（更宽 → 更早换行）、首字下沉浮动、text-indent 等样式差异
 * 全部天然包含，消除「纯文本探针 vs 富文本渲染」的系统性漂移。
 *
 * 必须用非折叠 Range：折叠 caret 在文本节点/内联 span 边界处锚点漂移，
 * 且同一文档位置会被相邻两个节点各采样一次——边界恰逢换行时推入重复偏移，
 * 导致行数虚高（每页页底大片空白）、行界错位（跨页切片切在词中间）。
 * 字形盒矩形每个字符恰采样一次，永远良定义。
 * 单行或异常返回 null（退回原子装箱）。
 */
function computeLines(el: HTMLElement): { lineH: number; ends: number[] } | null {
  const nodes = textNodesIn(el);
  const total = nodes.reduce((s, t) => s + t.data.length, 0);
  if (total === 0 || !el.textContent?.trim()) return null;

  const cs = getComputedStyle(el);
  const lineH =
    cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);
  if (!Number.isFinite(lineH) || lineH <= 0) return null;

  // 字符 y 坐标变化处 = 行首（真实渲染的换行边界）。行界记录为「新行首字符
  // 的全局偏移」= 前一行的独占结尾，与切片 norm.slice(enFrom, enTo) 语义一致。
  const rng = document.createRange();
  const ends: number[] = [];
  let prevTop: number | null = null;
  let off = 0;
  for (const node of nodes) {
    const len = node.data.length;
    for (let i = 0; i < len; i++) {
      rng.setStart(node, i);
      rng.setEnd(node, i + 1);
      const r = rng.getBoundingClientRect();
      // 零尺寸矩形（不可见/折叠字符）不参与行界链比较
      if (r.width === 0 && r.height === 0) continue;
      if (prevTop !== null && Math.abs(r.top - prevTop) > 0.5) ends.push(off + i);
      prevTop = r.top;
    }
    off += len;
  }
  if (ends.length === 0) return null; // 单行
  ends.push(total); // 末尾
  return { lineH, ends };
}

/** 段落块 → 行信息（en/zh 各自；zh 缺失时为空） */
function collectLines(el: HTMLElement): LineInfo | undefined {
  const enEl = el.querySelector<HTMLElement>('.ep-en');
  const zhEl = el.querySelector<HTMLElement>('.ep-zh');
  const en = enEl ? computeLines(enEl) : null;
  if (!en) return undefined; // en 空/单行 → 原子装箱
  let zhGap = ZH_GAP;
  if (enEl && zhEl) {
    const gap = zhEl.getBoundingClientRect().top - enEl.getBoundingClientRect().bottom;
    if (gap >= 0 && gap < 100) zhGap = gap; // 实测优先，异常值回退常量
  }
  const zh = zhEl ? computeLines(zhEl) : null;
  // 单行译文（不换行 → computeLines 返回 null，但 zhEl 存在即译文真实非空）：
  // 记作单个完整「行」，否则行拆分逻辑不会为它分配行，译文被静默丢弃。
  const zhSingle = zhEl && !zh
    ? { lineH: zhEl.getBoundingClientRect().height, ends: [(zhEl.textContent ?? '').length] }
    : null;
  return {
    enEnds: en.ends,
    hEn: en.lineH,
    zhEnds: zh?.ends ?? zhSingle?.ends ?? [],
    hZh: zh?.lineH ?? zhSingle?.lineH ?? 0,
    zhGap,
  };
}

/** 采集轨道内全部块：高度/间距/行信息/卡片碎片 */
function collectTrack(
  host: HTMLElement,
  track: string,
  defs: BlockDef[]
): { blocks: MeasuredBlock[]; spacing: number[] } {
  const els = [...host.querySelectorAll<HTMLElement>(`[data-track="${track}"] [data-blk]`)];
  const blocks: MeasuredBlock[] = [];
  const spacing: number[] = new Array(defs.length).fill(0);
  els.forEach((el, i) => {
    const def = defs[i];
    const rect = el.getBoundingClientRect();
    const h = rect.height;
    if (i > 0) {
      const prev = els[i - 1].getBoundingClientRect();
      spacing[i] = rect.top - (prev.top + prev.height);
    }
    const measured: MeasuredBlock = { id: def.id, h, keepNext: def.keepNext, pos: def.pos };
    if (def.kind === 'paragraph' || def.kind === 'sum-p') {
      const lines = collectLines(el);
      if (lines) measured.lines = lines;
      // 段落实体的尾 margin（.ep-paragraph margin-bottom）：flex 测量树中包含在
      // wrapper 高度里；行级拆分装箱只计行高，尾距由此字段显式携带（实测 CSS 值，
      // 不再手工同步常量）
      const inner = el.firstElementChild as HTMLElement | null;
      if (inner) {
        const mb = parseFloat(getComputedStyle(inner).marginBottom);
        if (Number.isFinite(mb) && mb > 0) measured.tail = mb;
      }
    }
    if (def.kind === 'sentence-card' || def.kind === 'word-card') {
      const splitEl = host.querySelector<HTMLElement>(`.ep-card-split[data-of="${def.id}"]`);
      if (splitEl) {
        const frags = [...splitEl.querySelectorAll<HTMLElement>('.ep-frag')].map((f) => ({
          id: f.id,
          h: f.getBoundingClientRect().height,
        }));
        if (frags.length > 0) measured.frags = frags;
      }
    }
    blocks.push(measured);
  });
  return { blocks, spacing };
}

// ── 测量树 ──
function MeasureTree({ data, prefs, ctx }: { data: ExportData; prefs: ExportPreferences; ctx: BlockCtx }) {
  const single = prefs.singleColumn;
  const leftDefs = single ? collectSingleBlocks(data, prefs) : collectLeftBlocks(data, prefs);
  const rightDefs = single ? [] : collectRightBlocks(data, prefs);
  const paper = PAPER_SIZES[prefs.paperSize];
  const contentW = mmToPx(paper.wMm) - PAGE_PADDING * 2;
  const leftW = single ? contentW : Math.round((contentW - COL_GAP) * prefs.leftWidthRatio);
  const rightW = single ? 0 : contentW - COL_GAP - leftW;

  // 与 ExportPages 完全一致的渲染上下文：.export-doc 类（box-sizing/font-family/主题变量）
  // + --fs-* 字号变量。缺一都会让测量树回退 16px 默认字号，导致预算与实际渲染系统性偏差
  // （字号偏小 → 预算偏大 → 空白；字号偏大 → 预算偏小 → 溢出裁剪）。
  const fsStyle = {
    '--fs-text': `${prefs.fontSizeText}px`,
    '--fs-translation': `${prefs.fontSizeTranslation}px`,
    '--fs-summary': `${prefs.fontSizeSummary}px`,
    '--fs-word': `${prefs.fontSizeWord}px`,
    '--fs-sentence': `${prefs.fontSizeSentence}px`,
  } as CSSProperties;

  // 卡片碎片副本（超高卡片拆分测量用；absolute + host visibility:hidden，不占流可测量）。
  // 宽度必须与碎片实际渲染的栏一致（右栏卡 → rightW），否则换行数不同 → 碎片高失真
  const fragW = single ? contentW : rightW;
  const fragCopies: ReactNode[] = [];
  if (prefs.includeWords) {
    for (const w of data.words) {
      fragCopies.push(
        <div key={`w-split:${w.paragraph_index}:${w.word}`} className="ep-card-split" data-of={blockIds.w(w.paragraph_index, w.word)} style={{ width: fragW }}>
          {wordCardFragRows(w, prefs).map((row) => (
            <div key={row.id} className="ep-frag" id={row.id}>{row.node}</div>
          ))}
        </div>
      );
    }
  }
  if (prefs.includeSentences) {
    for (const s of data.sentences) {
      fragCopies.push(
        <div key={`s-split:${s.paragraph_index}:${s.sentence_index}`} className="ep-card-split" data-of={blockIds.s(s.paragraph_index, s.sentence_index)} style={{ width: fragW }}>
          {sentenceCardFragIds(s, prefs).map((fid) => (
            <div key={fid} style={{ display: 'contents' }}>{renderSentenceFrag(s, fid, false, prefs)}</div>
          ))}
        </div>
      );
    }
  }

  return (
    <div className={`export-doc theme-${prefs.theme}`} style={fsStyle}>
      <div className="measure-left" data-track="left" style={{ width: leftW, display: 'flex', flexDirection: 'column' }}>
        {leftDefs.map((b) => (
          <div key={b.id} data-blk={b.id}>
            {renderWholeBlock(b.id, ctx)}
          </div>
        ))}
        {fragCopies}
      </div>
      {!single && (
        <div
          className="measure-right"
          data-track="right"
          style={{ width: rightW, display: 'flex', flexDirection: 'column' }}
        >
          {rightDefs.map((b) => (
            <div key={b.id} data-blk={b.id}>
              {renderWholeBlock(b.id, ctx)}
            </div>
          ))}
        </div>
      )}
      {/* 样本页：实测页眉/页脚高 + 续页眉高 */}
      <div className="measure-page" style={{ position: 'absolute', left: 0, top: 0, width: Math.round(contentW + PAGE_PADDING * 2), visibility: 'hidden' }}>
        <div className="ep-page">
          <div className="ep-page-head">
            <span className="ph-title">标题</span>
            <span className="ph-date">日期</span>
          </div>
          <div className="ep-page-foot">第 1 页 · 共 1 页</div>
        </div>
      </div>
      <div className="ep-cont" id="ep-cont-sample">词 — 续</div>
    </div>
  );
}

/**
 * 测量 + 装箱，返回分页计划（预览与导出共用）。
 * 内部创建临时离屏宿主，测量后立即销毁；并发调用互不干扰。
 */
export async function measureAndPaginate(data: ExportData, prefs: ExportPreferences): Promise<PagePlan> {
  const paper = PAPER_SIZES[prefs.paperSize];
  await document.fonts.ready;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    const ctx: BlockCtx = { data, prefs };
    flushSync(() => root.render(<MeasureTree data={data} prefs={prefs} ctx={ctx} />));

    const single = prefs.singleColumn;
    const leftDefs = single ? collectSingleBlocks(data, prefs) : collectLeftBlocks(data, prefs);
    const rightDefs = single ? [] : collectRightBlocks(data, prefs);

    const headEl = host.querySelector<HTMLElement>('.measure-page .ep-page-head');
    const footEl = host.querySelector<HTMLElement>('.measure-page .ep-page-foot');
    const headTop = headEl?.getBoundingClientRect().top ?? 0;
    const footBottom = footEl?.getBoundingClientRect().bottom ?? 60;
    // head 顶 → foot 底 = 页眉高 + 页眉 margin-bottom + 页脚 margin-top + 页脚高
    // （样本页 head/foot 相邻，flex 内 margin 不折叠，rect 差精确含两个 margin）
    const headFootH = footBottom - headTop;
    const contSample = host.querySelector<HTMLElement>('#ep-cont-sample');
    const contH = contSample?.getBoundingClientRect().height ?? 20;
    const contMb = contSample ? parseFloat(getComputedStyle(contSample).marginBottom) : NaN;
    const contGap = Number.isFinite(contMb) && contMb >= 0 ? contMb : CONT_GAP;

    const bodyH = mmToPx(paper.hMm) - PAGE_PADDING * 2 - headFootH;

    const L = collectTrack(host, 'left', leftDefs);
    const R = single ? { blocks: [], spacing: [] } : collectTrack(host, 'right', rightDefs);

    return paginate(L.blocks, R.blocks, bodyH, L.spacing, R.spacing, contH, contGap, single, prefs.alignSamePage);
  } finally {
    root.unmount();
    host.remove();
  }
}
