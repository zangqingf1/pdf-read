/**
 * 分页文档 DOM：预览（ep-preview：多页纵向排列 + 纸张阴影）与
 * 导出（无 ep-preview 类，@media print 每页 div 一页）共用同一实现。
 * 每页 = 页眉（标题+日期）+ 页体（左右栏条目）+ 页脚（页码）。
 */
import type { CSSProperties, ReactNode } from 'react';
import {
  renderWholeBlock,
  renderParagraphFrag,
  renderSentenceFrag,
  parseSentenceFragId,
  wordCardFragRows,
  type BlockCtx,
} from './exportBlocks';
import type { PageItem, PagePlan, ParagraphFragDef } from './paginate';
import { BLANK } from './paginate';
import { PAPER_SIZES, mmToPx, PAGE_PADDING, COL_GAP } from './exportTypes';
import type { ExportData } from './data';
import type { ExportPreferences } from './exportTypes';
import { useReaderStore } from '../stores/readerStore';

interface ExportPagesProps {
  data: ExportData;
  prefs: ExportPreferences;
  plan: PagePlan;
  /** 预览模式：多页纵向排列 + 纸张外观（导出时无） */
  preview?: boolean;
  /** 阅读页「对齐方式」设置：预览路径由调用方响应式传入；
   *  序列化路径（renderToStaticMarkup）下 Zustand hook 会读到未水合默认值，
   *  必须由 serializeExportHtml 用 getState() 取当前值后显式传入 */
  textAlign?: string;
}

/** 条目补距样式：padTop/margin-top（锚点/续页让位），padBottom/margin-bottom（行带短侧补齐） */
function padStyle(item: PageItem): CSSProperties | undefined {
  if (!item.padTop && !item.padBottom) return undefined;
  return {
    ...(item.padTop ? { marginTop: item.padTop } : {}),
    ...(item.padBottom ? { marginBottom: item.padBottom } : {}),
  };
}

function renderPageItem(item: PageItem, ctx: BlockCtx, plan: PagePlan, idx: number): ReactNode {
  // 行带空白占位（短侧补齐：高度 = padBottom）
  if (item.blk === BLANK) {
    return (
      <div key={idx} className="ep-blank" data-blk={BLANK} style={{ height: item.padBottom ?? 0 }} />
    );
  }
  const pad = padStyle(item);
  // 卡片碎片（句子卡/单词卡）
  if (item.frag && 'fragId' in item.frag) {
    const fragId = item.frag.fragId;
    const parsed = parseSentenceFragId(fragId);
    if (parsed) {
      const analysis = ctx.data.sentences.find(
        (s) => s.paragraph_index === parsed.pi && s.sentence_index === parsed.si
      );
      if (analysis) {
        return (
          <div key={idx} style={pad} data-blk={item.blk} data-frag={fragId}>
            {renderSentenceFrag(analysis, fragId, plan.contBefore.has(fragId), ctx.prefs)}
          </div>
        );
      }
      return null;
    }
    const wm = fragId.match(/^w:(\d+):(.+):f(\d+)$/);
    if (wm) {
      const pi = Number(wm[1]);
      const analysis = ctx.data.words.find((w) => w.paragraph_index === pi && w.word === wm[2]);
      if (analysis) {
        const row = wordCardFragRows(analysis, ctx.prefs)[Number(wm[3])];
        if (row) {
          return (
            <div key={idx} style={pad} data-blk={item.blk} data-frag={fragId}>
              {plan.contBefore.has(fragId) && <div className="ep-cont">— 续</div>}
              <div className="ep-frag" id={fragId}>{row.node}</div>
            </div>
          );
        }
      }
      return null;
    }
    return null;
  }
  // 段落碎片（跨页续排；padTop 预留续页 gcont 让位，padBottom 补齐行带短侧）
  if (item.frag) {
    const pm = item.blk.match(/^p:(\d+)$/);
    if (pm) {
      return (
        <div key={idx} style={pad} data-blk={item.blk}>
          {renderParagraphFrag(Number(pm[1]), item.frag as ParagraphFragDef, ctx)}
        </div>
      );
    }
    return null;
  }
  // 解析组续页标记（装箱期合成：解析组跨页时续页顶部）
  const gcm = item.blk.match(/^gcont:(\d+)$/);
  if (gcm) {
    return (
      <div key={idx} className="ep-cont" data-blk={item.blk}>
        第 {Number(gcm[1]) + 1} 段 · 续
      </div>
    );
  }
  // 整块（padTop 物化锚点对齐间隙：渲染 margin-top 后模型 y 与 DOM 几何一致）
  return (
    <div key={idx} style={pad} data-blk={item.blk}>
      {renderWholeBlock(item.blk, ctx)}
    </div>
  );
}

export default function ExportPages({ data, prefs, plan, preview = false, textAlign: textAlignProp }: ExportPagesProps) {
  const paper = PAPER_SIZES[prefs.paperSize];
  const ctx: BlockCtx = { data, prefs };
  const exportedDate = new Date().toISOString().slice(0, 10);
  const single = prefs.singleColumn;
  // 预览路径响应式传入；序列化/兜底用 getState() 直接读当前水合值
  const textAlign = textAlignProp ?? useReaderStore.getState().textAlign;

  // 左右栏宽度（与测量树一致：mm→px 页宽 - padding*2，按比例分配）
  const contentW = mmToPx(paper.wMm) - PAGE_PADDING * 2;
  const leftW = single ? contentW : Math.round((contentW - COL_GAP) * prefs.leftWidthRatio);
  const rightW = single ? 0 : contentW - COL_GAP - leftW;

  const style = {
    '--fs-text': `${prefs.fontSizeText}px`,
    '--fs-translation': `${prefs.fontSizeTranslation}px`,
    '--fs-summary': `${prefs.fontSizeSummary}px`,
    '--fs-word': `${prefs.fontSizeWord}px`,
    '--fs-sentence': `${prefs.fontSizeSentence}px`,
    // 跟随阅读页「对齐方式」设置（两端对齐只拉伸占满的行，末行保持左对齐）
    '--ta-en': textAlign === 'justify' ? 'justify' : 'left',
  } as CSSProperties;

  return (
    <div
      className={`export-doc theme-${prefs.theme} export-doc-pages${preview ? ' ep-preview' : ''}`}
      style={style}
      data-page-count={plan.totalPages}
    >
      {plan.pages.map((p, i) => (
        <div className={`ep-page ${prefs.paperSize}`} key={i}>
          {/* 页眉：左标题 + 右日期 */}
          <div className="ep-page-head">
            <span className="ph-title">{data.title}</span>
            <span className="ph-date">{exportedDate}</span>
          </div>
          {/* 页体：左右栏 */}
          <div className="ep-page-body">
            <div className="ep-left" style={{ width: leftW }}>
              {p.left.map((it, i) => renderPageItem(it, ctx, plan, i))}
            </div>
            {!single && (
              <div className="ep-right" style={{ width: rightW }}>
                {p.right.map((it, i) => renderPageItem(it, ctx, plan, i))}
              </div>
            )}
          </div>
          {/* 页脚：页码 */}
          <div className="ep-page-foot">
            第 {i + 1} 页 · 共 {plan.totalPages} 页
          </div>
        </div>
      ))}
    </div>
  );
}
