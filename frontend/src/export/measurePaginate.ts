/**
 * 测量 + 装箱：把内容块分配到页容器（预览与导出共用）。
 * 独立成文件以便不含 html2canvas/jspdf 依赖（保持主包小）。
 */
import type { ExportData } from './data';
import type { ExportPreferences } from './types';
import { PAPER_SIZES, PAGE_PADDING, FOOTER_HEIGHT, PAGE_SAFETY } from './types';
import { buildExportHtml, GAP_LEFT, CONT_GAP, ZH_GAP } from './buildExportHtml';
import { paginate, type PagePlan, type Measured, type Unit, type LineInfo } from './paginate';

/** 收集右栏装箱单元：整卡高度 + 超高卡片的碎片高度（从隐藏副本测量） */
function collectRightUnits(host: HTMLElement, pageContentH: number): Unit[] {
  const blocks = [...host.querySelectorAll('.measure-right .export-block')];
  const units: Unit[] = [];
  for (const el of blocks) {
    const id = el.id;
    if (!id) continue;
    const h = el.getBoundingClientRect().height;
    if (h > pageContentH) {
      // 超高卡片：碎片高度从 .ep-card-split 副本读取
      const splitEl = host.querySelector<HTMLElement>(`.ep-card-split[data-of="${id}"]`);
      const frags = splitEl
        ? [...splitEl.querySelectorAll('.ep-frag')].map((f) => ({
            id: (f as HTMLElement).id,
            h: (f as HTMLElement).getBoundingClientRect().height,
          }))
        : [];
      if (frags.length > 0) units.push({ id, totalH: h, frags });
      else units.push({ id, totalH: h });
    } else {
      units.push({ id, totalH: h });
    }
  }
  return units;
}

/**
 * 计算元素的每行信息：单行高度 + 每行结束处的文本偏移。
 * 用克隆探针做前缀高度二分：行布局与视口无关（caretRangeFromPoint 对
 * 视口外的行会返回 null，段落高于视口时不可用），切点与浏览器实际换行
 * 完全一致（不打断词/字，兼容 break-word 断词与中日韩任意处换行）。
 * 单行或异常时返回 null（该块退回原子装箱）。
 */
function computeLines(el: HTMLElement): { lineH: number; ends: number[] } | null {
  const text = el.textContent ?? '';
  if (!text.trim()) return null;
  // 探针：克隆元素本身（含类与内联样式，无子节点），absolute 不占位、
  // 不影响任何测量；显式定宽保证与原文同宽度换行
  const probe = el.cloneNode(false) as HTMLElement;
  probe.style.cssText = `${probe.style.cssText || ''};position:absolute;left:0;top:0;visibility:hidden;width:${el.getBoundingClientRect().width}px;`;
  probe.textContent = 'x';
  (el.parentElement ?? el).appendChild(probe);

  const probeH = (t: string): number => {
    probe.textContent = t;
    return probe.getBoundingClientRect().height;
  };
  const lineH = probeH('x');
  const lines = Math.round(probeH(text) / lineH);
  if (!(lines > 1)) {
    probe.remove();
    return null; // 单行无需拆
  }
  // 二分每行结束偏移：最大的 m 使 前缀高度 ≤ k×lineH（k 行整行）
  const ends: number[] = [];
  for (let k = 1; k < lines; k++) {
    const target = k * lineH + 0.5;
    let lo = ends.length > 0 ? ends[ends.length - 1] : 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (probeH(text.slice(0, mid)) <= target) lo = mid;
      else hi = mid - 1;
    }
    ends.push(lo);
  }
  ends.push(text.length); // 末行（片段切片闭区间）
  probe.remove();
  return { lineH, ends };
}

/** 段落块 → 行信息（en/zh 各自；zh 缺失时为空） */
function collectLines(el: HTMLElement): LineInfo | undefined {
  if (!el.classList.contains('ep-paragraph')) return undefined;
  const enEl = el.querySelector<HTMLElement>('.ep-en');
  const zhEl = el.querySelector<HTMLElement>('.ep-zh');
  const en = enEl ? computeLines(enEl) : null;
  const zh = zhEl ? computeLines(zhEl) : null;
  if (!en) return undefined; // en 为空/单行时整块原子装箱即可
  return {
    enEnds: en.ends,
    hEn: en.lineH,
    zhEnds: zh?.ends ?? [],
    hZh: zh?.lineH ?? 0,
    zhGap: ZH_GAP,
  };
}

/**
 * 测量 + 装箱，返回分页计划（导出与预览共用）。
 * 内部创建临时离屏宿主，测量后立即销毁；并发调用互不干扰。
 */
export async function measureAndPaginate(
  data: ExportData,
  prefs: ExportPreferences
): Promise<PagePlan> {
  const paper = PAPER_SIZES[prefs.paperSize];
  // 减去安全边距：html2canvas 渲染行高比浏览器布局略大，留 12px 余量防止
  // 每页最后一块（段落/卡片）底部被 overflow:hidden 裁剪
  const pageContentH = paper.hPx - PAGE_PADDING * 2 - FOOTER_HEIGHT - PAGE_SAFETY;

  // 离屏宿主（不可用 display:none —— 需要真实布局测量）
  const host = document.createElement('div');
  host.id = 'export-host';
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${paper.wPx}px;`;
  document.body.appendChild(host);

  try {
    host.innerHTML = buildExportHtml(data, prefs, 'measure');
    await document.fonts.ready;
    const leftBlocks: Measured[] = [...host.querySelectorAll('.measure-left .export-block')].map(
      (el) => ({
        id: el.id,
        h: el.getBoundingClientRect().height,
        lines: collectLines(el as HTMLElement),
      })
    );
    const rightUnits = collectRightUnits(host, pageContentH);
    const contSample = host.querySelector<HTMLElement>('#ep-cont-sample');
    const contH = contSample ? contSample.getBoundingClientRect().height : 20;

    // 装箱（左右轨独立；页面 gap 与 CSS 中一致）
    return paginate(leftBlocks, rightUnits, pageContentH, GAP_LEFT, contH, CONT_GAP);
  } finally {
    host.remove();
  }
}
