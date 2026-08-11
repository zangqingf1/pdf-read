/**
 * 构建导出文档的 HTML 字符串（内嵌样式，全部具体色值/系统字体）。
 *
 * 两种模式：
 *  - 'measure'：离屏测量版 —— 左/右两个独立轨道容器，全部块带 export-block 类
 *    与唯一 id；每张卡片附隐藏副本 .ep-card-split 用于超高卡片的碎片高度测量。
 *  - 'pages'：最终分页版 —— 按 PagePlan 组装 N 个 .export-page 固定尺寸页容器。
 *
 * 渲染管线（generatePdf.ts）先测量后装箱再重建，两阶段复用同一份块生成逻辑，
 * 保证测量高度与最终渲染一致。
 */
import type { ExportData } from './data';
import type { ExportPreferences, PaperSize } from './types';
import { PAPER_SIZES, PAGE_PADDING, FOOTER_HEIGHT, COL_GAP } from './types';
import { buildThemeCss } from './themes';
import { escapeHtml, mdToHtml } from './markdown';
import type { PagePlan, LeftFragDef } from './paginate';
import type { WordAnalysisResult } from '../services/wordAnalysisApi';
import type { SentenceAnalysisResult } from '../services/sentenceAnalysisApi';

export type BuildMode = 'measure' | 'pages';

/** 装箱间隙（必须与 CSS 中对应 gap 一致） */
export const GAP_LEFT = 14;
export const GAP_RIGHT = 10;
export const CONT_GAP = 8;
/** 段落 en 与 zh 之间的间距（必须与 CSS 中 .ep-zh 的 margin-top 一致） */
export const ZH_GAP = 6;

/** 单词 id 安全化（仅用于 DOM id，不用于显示） */
function wordKey(word: string): string {
  return word.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
}

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${p(d.getMonth() + 1)}月${p(d.getDate())}日`;
}

/** 卡片元数据：id / 容器类 / 续页眉文本 / 碎片 id→html 映射 */
interface Card {
  id: string;
  kindClass: 'ep-word' | 'ep-sentence';
  contLabel: string;
  frags: string[];
  fragMap: Map<string, string>;
}

/** 生成单词卡碎片（逐行结构：原词 / 音标 / 词性+释义 / 同义词 / 同根词） */
function buildWordCard(a: WordAnalysisResult, prefs: ExportPreferences): Card {
  const cardId = `w-${a.paragraph_index}-${wordKey(a.word)}`;
  const frags: string[] = [];

  // f0: 第一行 — 原单词
  frags.push(`<div class="ep-frag w-word">${escapeHtml(a.word)}</div>`);

  // f1: 第二行 — 音标
  if (prefs.includePhonetic && a.phonetic) {
    frags.push(`<div class="ep-frag w-phon">${escapeHtml(a.phonetic)}</div>`);
  }

  // f2: 第三行 — 词性 + 英文释义 + 中文释义（紧挨同一行）
  if (a.definition || a.definition_zh) {
    let def = '';
    if (a.part_of_speech) def += `<span class="w-pos">${escapeHtml(a.part_of_speech)}</span>`;
    if (a.definition) def += `<span class="w-def-en">${escapeHtml(a.definition)}</span>`;
    if (prefs.includeChineseDefinition && a.definition_zh) {
      def += `<span class="w-def-zh">${escapeHtml(a.definition_zh)}</span>`;
    }
    frags.push(`<div class="ep-frag w-def">${def}</div>`);
  }

  // f3: 第四行 — 同义词
  const synonyms = a.synonyms_antonyms?.synonyms ?? [];
  if (prefs.includeSynonyms && synonyms.length > 0) {
    const tags = synonyms
      .map((s) => {
        const pos = s.part_of_speech ? `<em class="w-tag-pos">${escapeHtml(s.part_of_speech)}</em> ` : '';
        return `<span class="w-tag w-tag-syn">${pos}${escapeHtml(s.word)}</span>`;
      })
      .join('');
    frags.push(`<div class="ep-frag w-tags"><span class="w-tag-lbl">同义词</span>${tags}</div>`);
  }

  // f4: 第五行 — 同根词
  if (prefs.includeCognates && a.cognates && a.cognates.length > 0) {
    const tags = a.cognates
      .map((c) => {
        const pos = c.part_of_speech ? `<em class="w-tag-pos">${escapeHtml(c.part_of_speech)}</em> ` : '';
        return `<span class="w-tag w-tag-cog">${pos}${escapeHtml(c.word)}</span>`;
      })
      .join('');
    frags.push(`<div class="ep-frag w-tags"><span class="w-tag-lbl">同根词</span>${tags}</div>`);
  }

  return toCard(cardId, 'ep-word', a.word, frags);
}

/**
 * 生成句子卡碎片。
 * 标题行 = AI 拆解后的原句（取「原句拆解」节内容直接做进句子标题，替代纯原文），
 * 内容区 = 其余节（理解拆解 / 阅读线索 / 地道翻译）。
 */
function buildSentenceCard(a: SentenceAnalysisResult, prefs: ExportPreferences): Card | null {
  if (!prefs.includeSentenceStructure) return null;
  const cardId = `s-${a.paragraph_index}-${a.sentence_index}`;
  const frags: string[] = [];

  const blocks = mdToHtml(a.content || '');
  let titleHtml = escapeHtml(a.sentence_text);
  const contentBlocks: string[] = [];
  let titleTaken = false;
  for (const block of blocks) {
    // 原句拆解节 → 剥离标签 span，内容直接作为句子标题（拆解在标题中）
    if (!titleTaken && /ep-sec-label ep-sec-1/.test(block)) {
      titleHtml = block
        .replace(/^<p><span class="ep-sec-label ep-sec-1">[^<]*<\/span>\s*/, '')
        .replace(/<\/p>$/, '');
      titleTaken = true;
    } else {
      contentBlocks.push(block);
    }
  }

  frags.push(`<div class="ep-frag s-head">${titleHtml}</div>`);
  for (const block of contentBlocks) {
    frags.push(`<div class="ep-frag">${block}</div>`);
  }
  if (frags.length <= 1) return null; // 无有效内容
  return toCard(cardId, 'ep-sentence', '句子精讲', frags);
}

function toCard(id: string, kindClass: Card['kindClass'], contLabel: string, frags: string[]): Card {
  return {
    id,
    kindClass,
    contLabel,
    frags,
    fragMap: new Map(frags.map((html, i) => [`${id}-f${i}`, html])),
  };
}

/** 内嵌样式：主题变量 + 全部 .ep-* 类 */
function buildStyles(prefs: ExportPreferences, paper: PaperSize): string {
  const fs = prefs.fontSize;
  const fsEn = fs + 2;
  const fsSm = Math.max(fs - 2, 10);
  return `<style>
.export-doc * { box-sizing: border-box; }
.export-doc {
  font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif;
  color: var(--body);
  -webkit-font-smoothing: antialiased;
}
.theme-warm{${buildThemeCss('warm')}}
.theme-bw{${buildThemeCss('bw')}}
.theme-academic{${buildThemeCss('academic')}}

/* ── 页容器 ── */
.export-page {
  width: ${paper.wPx}px; height: ${paper.hPx}px;
  background: var(--paper);
  padding: ${PAGE_PADDING}px;
  display: flex; flex-direction: column;
  overflow: hidden; position: relative;
}
.ep-body { flex: 1; min-height: 0; display: flex; gap: ${COL_GAP}px; overflow: hidden; }
.ep-left { display: flex; flex-direction: column; gap: ${GAP_LEFT}px; }
.ep-right { display: flex; flex-direction: column; gap: ${GAP_RIGHT}px; }
.ep-footer {
  height: 14px; margin-top: 8px; flex-shrink: 0;
  display: flex; justify-content: space-between; align-items: center;
  font-size: 11px; color: var(--muted);
  border-top: 1px solid var(--line); padding-top: 3px;
}
.ep-footer .ep-ft-title { max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── 左栏：标题 ── */
.ep-title { border-bottom: 2px solid var(--accent); padding-bottom: 10px; }
.ep-title h1 {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 21px; line-height: 1.3; margin: 0 0 3px;
  color: var(--ink); font-weight: 700;
  overflow-wrap: break-word;
}
.ep-meta { font-size: 11px; color: var(--muted); margin: 0; letter-spacing: 0.06em; }

/* ── 左栏：总结（章节式，按块拆分可跨页） ── */
.ep-summary-title {
  font-size: 13px; font-weight: 700; letter-spacing: 0.14em;
  color: var(--accent); text-transform: uppercase;
  border-bottom: 2px solid var(--accent); padding-bottom: 6px;
}
.ep-summary-body p, .ep-summary-body ul {
  font-size: var(--fs-body); line-height: 1.7; margin: 0 0 6px; color: var(--body);
}
.ep-summary-body ul { padding-left: 18px; list-style: disc; }
.ep-summary-body li { margin-bottom: 3px; }
.ep-summary-body h3, .ep-summary-body h4 {
  font-size: var(--fs-body); color: var(--ink); margin: 4px 0;
}
.ep-summary-body strong { color: var(--ink); }

/* ── 左栏：段落 ── */
.ep-en {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: var(--fs-en); color: var(--ink);
  line-height: 1.6; margin: 0; overflow-wrap: break-word;
  text-indent: 2em; /* 首行缩进 */
}
.ep-zh {
  font-size: var(--fs-sm); color: var(--muted);
  border-left: 2px solid var(--accent); padding-left: 8px;
  margin: 6px 0 0 0; line-height: 1.7; overflow-wrap: break-word;
}
/* 跨页续排片段：不再缩进/不再加段间距（视觉上仍是同一段落的延续） */
.ep-en-cont { text-indent: 0; }
.ep-zh-cont { margin-top: 0; }

/* ── 右栏：栏目标题 ── */
.ep-col-head {
  font-size: 13px; font-weight: 700; letter-spacing: 0.14em;
  color: var(--accent); text-transform: uppercase;
  border-bottom: 2px solid var(--accent); padding-bottom: 6px;
}
.ep-empty { font-size: var(--fs-sm); color: var(--muted); line-height: 1.6; }

/* ── 卡片 ── */
.ep-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 9px 12px;
}
.ep-card-split { padding: 0 12px; }
.ep-frag { margin: 0 0 7px; }
.ep-frag:last-child { margin-bottom: 0; }
.ep-frag p { margin: 0; }

/* 续页眉 */
.ep-cont {
  font-size: 11px; font-weight: 600; color: var(--accent);
  border-bottom: 1px dashed var(--line);
  padding-bottom: 3px; margin-bottom: 8px;
}

/* ── 单词卡（逐行结构：原词 / 音标 / 词性+释义 / 同义词 / 同根词 / 搭配 / 例句） ── */
.w-word {
  display: block;
  font-size: calc(var(--fs-body) + 4px); font-weight: 700; color: var(--ink);
  line-height: 1.25;
}
.w-phon {
  display: block;
  font-size: var(--fs-sm); color: var(--muted);
  font-family: 'Segoe UI', 'Arial Unicode MS', Arial, sans-serif;
  line-height: 1.3;
}
.w-def { font-size: var(--fs-body); color: var(--body); line-height: 1.5; }
.w-pos { font-style: italic; color: var(--accent); margin-right: 4px; }
.w-def-en { color: var(--body); }
.w-def-zh { color: var(--muted); margin-left: 5px; }
.w-tags { line-height: 1.9; }
.w-tag-lbl { display: block; font-size: 11px; color: var(--muted); margin: 0 0 2px; }
.w-tag {
  display: inline-block; font-size: var(--fs-sm);
  padding: 1px 8px; border-radius: 10px;
  margin: 0 4px 3px 0; vertical-align: middle;
}
.w-tag-pos { font-style: normal; opacity: 0.7; font-size: 0.9em; margin-right: 3px; }
.w-tag-syn { background: var(--tag-syn); border: 1px solid var(--tag-synb); color: var(--tag-sync); }
.w-tag-cog { background: var(--tag-cog); border: 1px solid var(--tag-cogb); color: var(--tag-cogc); }

/* ── 句子卡 ── */
.s-head {
  font-size: calc(var(--fs-sm) + 1px); font-weight: 600; color: var(--ink);
  font-family: Georgia, 'Times New Roman', serif;
  line-height: 1.55; margin-bottom: 6px !important;
  border-left: 2px solid var(--accent); padding-left: 7px;
}
.s-head strong { color: var(--accent); font-weight: 700; }
.ep-sentence p { font-size: var(--fs-sm); color: var(--body); line-height: 1.65; margin: 0 0 5px; }
.ep-sentence ul { margin: 0 0 6px; padding-left: 17px; list-style: disc; }
.ep-sentence li { margin-bottom: 2px; }
.ep-sentence strong { color: var(--ink); }
.ep-sentence code {
  font-family: Consolas, 'Courier New', monospace; font-size: 0.92em;
  background: var(--card); padding: 0 3px; border-radius: 3px;
}
.ep-sentence h3, .ep-sentence h4 { font-size: var(--fs-body); color: var(--ink); margin: 4px 0; }
.ep-sec-label {
  display: inline-block; font-size: 11px; font-weight: 600;
  padding: 1px 7px; border-radius: 3px; margin-right: 6px;
  vertical-align: middle;
}
.ep-sec-1 { background: var(--sec1); color: var(--sec1c); border: 1px solid var(--sec1b); }
.ep-sec-2 { background: var(--sec2); color: var(--sec2c); border: 1px solid var(--sec2b); }
.ep-sec-3 { background: var(--sec3); color: var(--sec3c); border: 1px solid var(--sec3b); }
.ep-sec-4 { background: var(--sec4); color: var(--sec4c); border: 1px solid var(--sec4b); }
</style>`;
}

/** 左栏块列表（顺序：标题 → 段落 → 总结放最后） */
function buildLeftBlocks(
  data: ExportData,
  prefs: ExportPreferences
): Array<{ id: string; html: string }> {
  const blocks: Array<{ id: string; html: string }> = [];

  // 标题（仅第 1 页）
  blocks.push({
    id: 't-title',
    html: `<div class="ep-title export-block" id="t-title"><h1>${escapeHtml(data.title)}</h1><p class="ep-meta">外刊精读 · ${formatDate(new Date())}</p></div>`,
  });

  // 段落
  for (const p of data.paragraphs) {
    const zhText = data.translations[p.index];
    const zh = prefs.includeTranslation && zhText
      ? `<p class="ep-zh">${escapeHtml(zhText)}</p>`
      : '';
    blocks.push({
      id: `p-${p.index}`,
      html: `<div class="ep-paragraph export-block" id="p-${p.index}"><p class="ep-en">${escapeHtml(p.text)}</p>${zh}</div>`,
    });
  }

  // 总结（放文档最后；按 markdown 块拆分装箱，超长可自然跨页，避免截断）
  if (prefs.includeSummary && data.summary) {
    blocks.push({
      id: 't-summary-head',
      html: `<div class="ep-summary-title export-block" id="t-summary-head">全文总结</div>`,
    });
    mdToHtml(data.summary).forEach((body, i) => {
      blocks.push({
        id: `t-summary-${i}`,
        html: `<div class="ep-summary-body export-block" id="t-summary-${i}">${body}</div>`,
      });
    });
  }

  return blocks;
}

/** 右栏卡片列表（按段落序） */
function buildRightCards(
  data: ExportData,
  prefs: ExportPreferences
): Card[] {
  const cards: Card[] = [];
  for (const w of data.words) {
    const card = buildWordCard(w, prefs);
    if (card.frags.length > 0) cards.push(card);
  }
  for (const s of data.sentences) {
    const card = buildSentenceCard(s, prefs);
    if (card) cards.push(card);
  }
  return cards;
}

/** 段落文本表：块 id (`p-{index}`) → 英文/中文原文（供片段切片） */
function buildParaTexts(data: ExportData): Map<string, { en: string; zh: string }> {
  const map = new Map<string, { en: string; zh: string }>();
  for (const p of data.paragraphs) {
    const zh = data.translations[p.index];
    map.set(`p-${p.index}`, { en: p.text, zh: zh ?? '' });
  }
  return map;
}

/**
 * 渲染段落跨页片段（按行边界切片后的部分段落）。
 * 首个片段保留原 id（`p-N`），续排片段 id 为 `p-N-c1/c2…`；
 * 续排的 en 不缩进、续排的 zh 不加段间距，视觉上仍是同一段落的延续。
 */
function renderParaFragment(
  id: string,
  frag: LeftFragDef,
  paraTexts: Map<string, { en: string; zh: string }>
): string {
  const parentId = id.replace(/^(p-\d+)-c\d+$/, '$1');
  const t = paraTexts.get(parentId);
  if (!t) return '';
  const enText = t.en.slice(frag.enFrom, frag.enTo);
  const zhText = t.zh.slice(frag.zhFrom, frag.zhTo);
  const enCont = frag.enFrom > 0;
  const zhCont = frag.zhFrom > 0;
  let html = `<div class="ep-paragraph export-block" id="${id}">`;
  if (enText) html += `<p class="ep-en${enCont ? ' ep-en-cont' : ''}">${escapeHtml(enText)}</p>`;
  if (zhText) html += `<p class="ep-zh${zhCont ? ' ep-zh-cont' : ''}">${escapeHtml(zhText)}</p>`;
  html += '</div>';
  return html;
}

/** 右栏静态块（栏目标题 / 空态提示） */
function buildRightStatics(data: ExportData): Array<{ id: string; html: string }> {
  const statics: Array<{ id: string; html: string }> = [];
  statics.push({
    id: 't-colhead',
    html: `<div class="export-block ep-col-head" id="t-colhead">单词 · 句子解析</div>`,
  });
  const hasAnalyses = data.words.length > 0 || data.sentences.length > 0;
  if (!hasAnalyses) {
    statics.push({
      id: 't-empty',
      html: `<div class="export-block ep-empty">暂无可导出的单词 / 句子解析。请在阅读页选中单词、句子并解析后再导出。</div>`,
    });
  }
  return statics;
}

/** 右栏：按卡片分组渲染（整卡 or 拆分 + 续页眉），静态块直接输出 */
function renderRightForPage(
  ids: string[],
  cards: Map<string, Card>,
  statics: Map<string, string>,
  contBefore: Set<string>
): string {
  const groups: Array<{ cardId: string; fragIds: string[] }> = [];
  for (const id of ids) {
    if (cards.has(id) || statics.has(id)) {
      groups.push({ cardId: id, fragIds: [] });
    } else {
      const m = id.match(/^(.*)-f\d+$/);
      const cardId = m ? m[1] : id;
      const last = groups[groups.length - 1];
      if (last && last.cardId === cardId) last.fragIds.push(id);
      else groups.push({ cardId, fragIds: [id] });
    }
  }

  return groups
    .map((g) => {
      const staticHtml = statics.get(g.cardId);
      if (staticHtml) return staticHtml;
      const card = cards.get(g.cardId);
      if (!card) return '';
      if (g.fragIds.length === 0) {
        // 整卡
        return `<div class="ep-card ${card.kindClass}" id="${card.id}">${card.frags.join('')}</div>`;
      }
      // 拆分态
      let html = `<div class="ep-card-split ${card.kindClass}">`;
      for (const fid of g.fragIds) {
        if (contBefore.has(fid)) {
          html += `<div class="ep-cont">${escapeHtml(card.contLabel)} — 续</div>`;
        }
        html += card.fragMap.get(fid) ?? '';
      }
      html += '</div>';
      return html;
    })
    .join('');
}

export function buildExportHtml(
  data: ExportData,
  prefs: ExportPreferences,
  mode: BuildMode,
  plan?: PagePlan
): string {
  const paper = PAPER_SIZES[prefs.paperSize];
  const contentW = paper.wPx - PAGE_PADDING * 2;
  const leftW = Math.round(contentW * prefs.leftWidthRatio);
  const rightW = contentW - leftW - COL_GAP;
  const fsEn = prefs.fontSize + 2;
  const fsSm = Math.max(prefs.fontSize - 2, 10);
  const styles = buildStyles(prefs, paper);
  const hasAnalyses = data.words.length > 0 || data.sentences.length > 0;

  if (mode === 'measure') {
    const leftBlocks = buildLeftBlocks(data, prefs);
    const cards = buildRightCards(data, prefs);
    let rightHtml = buildRightStatics(data)
      .map((b) => b.html)
      .join('');
    if (hasAnalyses) {
      for (const card of cards) {
        const fragsHtml = card.frags.join('');
        rightHtml += `<div class="ep-card ${card.kindClass} export-block" id="${card.id}">${fragsHtml}</div>`;
        // 隐藏副本：仅用于测量超高卡片的碎片高度（脱离文档流，不影响其他测量）
        rightHtml += `<div class="ep-card-split ${card.kindClass}" data-of="${card.id}" style="position:absolute;visibility:hidden;left:0;top:0">${fragsHtml}</div>`;
      }
    }
    // 测量轨道用 flex + gap（与 .ep-left 完全一致）：防止块内 margin 折叠导致
    // 测量高度 ≠ 渲染高度（如 .ep-summary-body p 的 6px 下边距）
    return `<div class="export-doc theme-${prefs.theme}" style="--fs-en:${fsEn}px;--fs-body:${prefs.fontSize}px;--fs-sm:${fsSm}px">${styles}
<div class="measure-left" style="width:${leftW}px;display:flex;flex-direction:column;gap:${GAP_LEFT}px">${leftBlocks.map((b) => b.html).join('')}</div>
<div class="measure-right" style="width:${rightW}px;position:relative">${rightHtml}
<div class="ep-cont" id="ep-cont-sample">词 — 续</div></div>
</div>`;
  }

  // pages 模式
  if (!plan) throw new Error('buildExportHtml pages 模式需要 plan');
  const leftMap = new Map(buildLeftBlocks(data, prefs).map((b) => [b.id, b.html]));
  const paraTexts = buildParaTexts(data);
  const cards = new Map(buildRightCards(data, prefs).map((c) => [c.id, c]));
  const statics = new Map(buildRightStatics(data).map((b) => [b.id, b.html]));
  const title = escapeHtml(data.title);
  const pages: string[] = [];

  for (let i = 0; i < plan.totalPages; i++) {
    const leftIds = plan.left[i] ?? [];
    const rightIds = plan.right[i] ?? [];
    const leftHtml = leftIds
      .map((id) => {
        const frag = plan.frags.get(id);
        return frag ? renderParaFragment(id, frag, paraTexts) : leftMap.get(id) ?? '';
      })
      .join('');
    const rightHtml = rightIds.length > 0
      ? renderRightForPage(rightIds, cards, statics, plan.contBefore)
      : `<div class="export-block ep-empty">—</div>`;
    // 每页自带 --fs-* 变量：预览的 splitPagesHtml 会剥离 .export-doc 包装，
    // 若变量只挂在包装元素上，预览会丢失字体大小 → 渲染比测量高 → 末段被裁切
    pages.push(`<div class="export-page" style="--fs-en:${fsEn}px;--fs-body:${prefs.fontSize}px;--fs-sm:${fsSm}px">
<div class="ep-body">
  <div class="ep-left" style="width:${leftW}px">${leftHtml}</div>
  <div class="ep-right" style="width:${rightW}px">${rightHtml}</div>
</div>
<div class="ep-footer"><span class="ep-ft-title">${title}</span><span>p. ${i + 1} / ${plan.totalPages}</span></div>
</div>`);
  }

  return `<div class="export-doc theme-${prefs.theme}" style="--fs-en:${fsEn}px;--fs-body:${prefs.fontSize}px;--fs-sm:${fsSm}px">${styles}${pages.join('')}</div>`;
}
