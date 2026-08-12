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
 * 计算元素每行信息：单行高度 + 每行结束处的文本偏移。
 * 克隆探针 + Range API 遍历字符 y 坐标，直接取浏览器真实行边界：
 * 与渲染必然一致（消除探针二分/词边界回退的亚像素漂移），且边界天然落在
 * 词间空隙（浏览器按词换行，中文逐字）——跨页切片不会把单词拆成两半。
 * 单行或异常返回 null（退回原子装箱）。
 */
function computeLines(el: HTMLElement): { lineH: number; ends: number[] } | null {
  const text = el.textContent ?? '';
  if (!text.trim()) return null;
  const probe = el.cloneNode(false) as HTMLElement;
  probe.style.cssText = `${probe.style.cssText || ''};position:absolute;left:0;top:0;visibility:hidden;width:${el.getBoundingClientRect().width}px;`;
  probe.textContent = 'x';
  (el.parentElement ?? el).appendChild(probe);

  const probeH = (t: string): number => {
    probe.textContent = t;
    return probe.getBoundingClientRect().height;
  };
  const lineH = probeH('x');
  if (!(probeH(text) > lineH + 0.5)) {
    probe.remove();
    return null;
  }

  // Range API：字符位置 y 坐标变化处 = 行首（真实渲染的换行边界）
  probe.textContent = text;
  const node = probe.firstChild as Text;
  const rng = document.createRange();
  const ends: number[] = [];
  let lastY: number | null = null;
  for (let i = 1; i <= text.length; i++) {
    rng.setStart(node, i);
    rng.setEnd(node, i);
    const y = rng.getBoundingClientRect().top;
    if (lastY === null) {
      lastY = y;
      continue;
    }
    if (Math.abs(y - lastY) > 0.5) {
      ends.push(i - 1);
      lastY = y;
    }
  }
  probe.remove();
  if (ends.length === 0) return null; // 单行
  ends.push(text.length); // 末尾
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
    const measured: MeasuredBlock = { id: def.id, h, keepNext: def.keepNext };
    if (def.kind === 'paragraph' || def.kind === 'sum-p') {
      const lines = collectLines(el);
      if (lines) measured.lines = lines;
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

  // 卡片碎片副本（超高卡片拆分测量用；absolute + host visibility:hidden，不占流可测量）
  const fragCopies: ReactNode[] = [];
  if (prefs.includeWords) {
    for (const w of data.words) {
      fragCopies.push(
        <div key={`w-split:${w.paragraph_index}:${w.word}`} className="ep-card-split" data-of={blockIds.w(w.paragraph_index, w.word)}>
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
        <div key={`s-split:${s.paragraph_index}:${s.sentence_index}`} className="ep-card-split" data-of={blockIds.s(s.paragraph_index, s.sentence_index)}>
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
        <div className="measure-right" data-track="right" style={{ width: rightW, position: 'relative' }}>
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

    const bodyH = mmToPx(paper.hMm) - PAGE_PADDING * 2 - headFootH;

    const L = collectTrack(host, 'left', leftDefs);
    const R = single ? { blocks: [], spacing: [] } : collectTrack(host, 'right', rightDefs);

    return paginate(L.blocks, R.blocks, bodyH, L.spacing, R.spacing, contH, CONT_GAP, single);
  } finally {
    root.unmount();
    host.remove();
  }
}
