/**
 * 导出文档的块模型与共享渲染函数。
 * 测量树（ExportContent）与分页 DOM（ExportPages）共用同一套渲染实现，
 * 一致性由构造保证；块 id 是测量 ↔ 装箱 ↔ 渲染之间的唯一契约。
 */
import { Fragment, isValidElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeMarkdownComponents } from '../utils/markdownComponents';
import type { ParagraphResult } from '../services/pdfApi';
import type { WordAnalysisResult } from '../services/wordAnalysisApi';
import type { SentenceAnalysisResult } from '../services/sentenceAnalysisApi';
import { splitSentences, tokenizeWords, wordAnalysisKey, sentenceAnalysisKey } from '../utils/textTokens';
import { sentenceBodyMarkdown, sentenceBreakdownChunks } from '../utils/sentenceSections';
import type { ExportPreferences } from './exportTypes';
import type { ExportData } from './data';
import { splitMarkdownBlocks } from './markdown';
import { filterVisibleExamTags, examTagMeta } from '../constants/examTags';
import { useReaderStore } from '../stores/readerStore';

/** 导出单词卡的考纲标签行（受导出开关 + 全局标签显隐双重过滤） */
function visibleExamTagsOf(analysis: WordAnalysisResult): string[] {
  const { visibleExamTags } = useReaderStore.getState();
  return filterVisibleExamTags(analysis.exam_tags, visibleExamTags);
}

function ExamTagRow({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="w-tags">
      {tags.map((t) => {
        const meta = examTagMeta(t);
        if (!meta) return null;
        return (
          <span
            key={t}
            className="ep-tag"
            style={{ background: meta.colors.bg, borderColor: meta.colors.border, color: meta.colors.text }}
          >
            {t}
          </span>
        );
      })}
    </div>
  );
}

// ── 块 id 契约 ──
export const blockIds = {
  title: 't-title',
  colHeadL: 'colhead-l',
  colHeadR: 'colhead-r',
  empty: 't-empty',
  /** 行带短侧空白占位（装箱期合成块，渲染为带高度的空 div） */
  blank: 'b-blank',
  sumHead: 'sum-head',
  p: (i: number) => `p:${i}`,
  pFrag: (i: number, n: number) => `p:${i}:c${n}`,
  sumBody: (i: number) => `sum-b:${i}`,
  g: (i: number) => `g:${i}`,
  /** 解析组续页标记（装箱期合成块，渲染为「第 N 段 · 续」） */
  gcont: (i: number) => `gcont:${i}`,
  w: (pi: number, w: string) => `w:${pi}:${w}`,
  s: (pi: number, si: number) => `s:${pi}:${si}`,
  sFrag: (pi: number, si: number, k: number) => `s:${pi}:${si}:f${k}`,
};

export type BlockKind = 'atomic' | 'paragraph' | 'sum-p' | 'word-card' | 'sentence-card';

export interface BlockDef {
  id: string;
  kind: BlockKind;
  /** 与后随块粘合（组头/总结头/栏头：避免孤悬页尾） */
  keepNext?: boolean;
  /** 该卡对应 token 在段内归一化文本中的字符偏移（双栏同页对齐用；未定位词 = Infinity） */
  pos?: number;
}

export interface BlockCtx {
  data: ExportData;
  prefs: ExportPreferences;
}

// ── 段落切片（跨页续排）──
export interface ParagraphFragDef {
  enFrom: number;
  enTo: number;
  zhFrom: number;
  zhTo: number;
}

/** 段落规范化文本（.ep-en 渲染用的 textContent，探针与切片基于它） */
export function paragraphNormText(paragraph: ParagraphResult): string {
  return splitSentences(paragraph.text)
    .map((s) => s.text)
    .join(' ');
}

// ── 句子 content 节标签映射（与旧 StudyPanel SENTENCE_HEADER_STYLES 一致，含旧格式兼容）──
const SECTION_MAP: Record<string, number> = {
  原句拆解: 1,
  理解拆解: 2,
  阅读线索: 3,
  地道翻译: 4,
  原文: 3,
  主干: 1,
  讲解: 2,
  译文: 3,
};

function sectionLabel(name: string) {
  return <span className={`ep-sec-label ep-sec-${SECTION_MAP[name]}`}>{name}</span>;
}

/** 单块 markdown 渲染（节标签 + 正文）；整块与碎片共用 */
export function SentenceMarkdown({ content }: { content: string }) {
  return (
    <div className="s-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          ...safeMarkdownComponents,
          strong: ({ children }) => {
            const text = String(children);
            const colonMatch = text.match(/^(.+?)[：:]\s*/);
            if (colonMatch && SECTION_MAP[colonMatch[1].trim()]) {
              const header = colonMatch[1].trim();
              const after = text.slice(colonMatch[0].length);
              return (
                <span>
                  {sectionLabel(header)}
                  {after && <span>{after}</span>}
                </span>
              );
            }
            return <strong>{children}</strong>;
          },
          p: ({ children }) => {
            const arr = Array.isArray(children) ? children : [children];
            const first = arr[0];
            const firstChildren =
              isValidElement(first) ? (first.props as { children?: unknown }).children : undefined;
            const headerName = typeof firstChildren === 'string' ? firstChildren.trim() : '';
            if (SECTION_MAP[headerName] && typeof arr[1] === 'string') {
              const after = arr[1].replace(/^[：:]\s*/, '');
              return (
                <p>
                  {sectionLabel(headerName)}
                  {after && <span>{after}</span>}
                  {arr.slice(2)}
                </p>
              );
            }
            return <p>{children}</p>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ── 句子卡标题：标题承接「原句拆解」（分节/正文逻辑见 utils/sentenceSections）──

/** 按导出偏好计算句子正文要排除的节（原句拆解始终上移标题；阅读线索/地道翻译可关） */
function sentenceExcludeSet(prefs: ExportPreferences): ReadonlySet<string> {
  const exclude = new Set<string>(['原句拆解']);
  if (!prefs.includeReadingCues) exclude.add('阅读线索');
  if (!prefs.includeIdiomaticTranslation) exclude.add('地道翻译');
  return exclude;
}

/** 句子卡标题：有「原句拆解」时直接在该句上按 / 分块展示，否则原句纯文本 */
function SentenceTitleContent({ analysis }: { analysis: SentenceAnalysisResult }) {
  const chunks = sentenceBreakdownChunks(analysis.content);
  if (!chunks) return <>{analysis.sentence_text}</>;
  return (
    <>
      {chunks.map((chunk, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="ep-chunk-sep"> / </span>}
          {chunk}
        </Fragment>
      ))}
    </>
  );
}

// ── 原文 token 高亮（整块：句子级 + 单词级；碎片：仅单词级）──
function highlightTokens(text: string, pIndex: number, wordAnalyses: Record<string, WordAnalysisResult>, sentenceLevel: boolean, sentenceAnalyses: Record<string, SentenceAnalysisResult>) {
  if (sentenceLevel) {
    const sentences = splitSentences(text);
    return sentences.map((s, i) => {
      const hasS = !!sentenceAnalyses[sentenceAnalysisKey(pIndex, s.index)];
      const inner = tokenizeWords(s.text).map((t, j) => {
        if (!t.stem) return t.raw;
        const hasW = !!wordAnalyses[wordAnalysisKey(pIndex, t.stem)];
        return hasW ? <span key={j} className="ep-token-w">{t.raw}</span> : t.raw;
      });
      return (
        <Fragment key={s.index}>
          {hasS ? <span className="ep-token-s">{inner}</span> : inner}
          {i < sentences.length - 1 ? ' ' : ''}
        </Fragment>
      );
    });
  }
  return tokenizeWords(text).map((t, i) => {
    if (!t.stem) return t.raw;
    const hasW = !!wordAnalyses[wordAnalysisKey(pIndex, t.stem)];
    return hasW ? <span key={i} className="ep-token-w">{t.raw}</span> : t.raw;
  });
}

// ── 整块渲染（测量树与分页 DOM 共用）──
export function renderWholeBlock(id: string, ctx: BlockCtx): React.ReactNode {
  const { data, prefs } = ctx;
  // 索引在 buildExportData 时已建好（wordsByKey/sentencesByKey/paragraphsByIndex），
  // 每个块渲染只做 O(1) 查找，不再重建字典。
  const wordAnalyses = data.wordsByKey;
  const sentenceAnalyses = data.sentencesByKey;

  switch (id) {
    case blockIds.title:
      return (
        <div className="ep-title">
          <h1>{data.title}</h1>
          {data.titleZh && <p className="ep-title-zh">{data.titleZh}</p>}
          {prefs.source.trim() && <p className="ep-source">来源：{prefs.source.trim()}</p>}
          <p className="ep-meta">Exported on {new Date().toISOString().slice(0, 10)}</p>
        </div>
      );
    case blockIds.colHeadL:
      return <div className="ep-col-head">原文{prefs.includeTranslation ? ' · 译文' : ''}</div>;
    case blockIds.colHeadR:
      return <div className="ep-col-head">解析</div>;
    case blockIds.empty:
      return (
        <div className="ep-empty">暂无可导出的单词 / 句子解析。请在阅读页选中单词、句子并解析后再导出。</div>
      );
    case blockIds.sumHead:
      return <div className="ep-summary-title">全文总结</div>;
  }

  const pMatch = id.match(/^p:(\d+)$/);
  if (pMatch) {
    const p = data.paragraphsByIndex.get(Number(pMatch[1]));
    if (!p) return null;
    return (
      <div className="ep-paragraph">
        <div className={`ep-en${p.index === 0 ? ' ep-dropcap' : ''}`}>{highlightTokens(paragraphNormText(p), p.index, wordAnalyses, true, sentenceAnalyses)}</div>
        {prefs.includeTranslation && data.translations[p.index] && (
          <div className="ep-zh">{data.translations[p.index]}</div>
        )}
      </div>
    );
  }

  const sumMatch = id.match(/^sum-b:(\d+)$/);
  if (sumMatch && data.summary) {
    const blocks = splitMarkdownBlocks(data.summary);
    const block = blocks[Number(sumMatch[1])];
    if (block === undefined) return null;
    return (
      <div className="ep-summary-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={safeMarkdownComponents}>{block}</ReactMarkdown>
      </div>
    );
  }

  const gMatch = id.match(/^g:(\d+)$/);
  if (gMatch) return <div className="ep-group-head">第 {Number(gMatch[1]) + 1} 段</div>;

  const wMatch = id.match(/^w:(\d+):(.+)$/);
  if (wMatch) {
    const analysis = wordAnalyses[wordAnalysisKey(Number(wMatch[1]), wMatch[2])];
    if (analysis) return <WordCardView analysis={analysis} prefs={prefs} />;
  }

  const sMatch = id.match(/^s:(\d+):(\d+)$/);
  if (sMatch) {
    const analysis = sentenceAnalyses[sentenceAnalysisKey(Number(sMatch[1]), Number(sMatch[2]))];
    if (analysis) return <SentenceCardView analysis={analysis} prefs={prefs} />;
  }

  return null;
}

// ── 单词卡（整块）──
function WordCardView({ analysis, prefs }: { analysis: WordAnalysisResult; prefs: ExportPreferences }) {
  const synonyms = analysis.synonyms_antonyms?.synonyms ?? [];
  const cognates = analysis.cognates ?? [];
  const baseForm =
    analysis.base_form && analysis.base_form.toLowerCase() !== analysis.word.toLowerCase()
      ? analysis.base_form
      : null;
  return (
    <div className="ep-card ep-word">
      <div className="w-word">{analysis.word}</div>
      {prefs.includePhonetic && analysis.phonetic && <div className="w-phon">{analysis.phonetic}</div>}
      {(analysis.definition || analysis.definition_zh) && (
        <div className="w-def">
          {analysis.part_of_speech && <i className="w-pos">{analysis.part_of_speech}</i>}
          {analysis.definition && <span className="w-def-en">{analysis.definition}</span>}
          {prefs.includeChineseDefinition && analysis.definition_zh && (
            <span className="w-def-zh">{analysis.definition_zh}</span>
          )}
        </div>
      )}
      {prefs.includeBaseForm && baseForm && (
        <div className="w-base">
          <span className="w-tag-lbl">原形</span>
          {baseForm}
        </div>
      )}
      {prefs.includeSynonyms && synonyms.length > 0 && (
        <div className="w-tags">
          <span className="w-tag-lbl">同义词</span>
          {synonyms.map((s, i) => (
            <span key={i} className="ep-tag ep-tag-syn">
              {s.part_of_speech ? `${s.part_of_speech} ${s.word}` : s.word}
            </span>
          ))}
        </div>
      )}
      {prefs.includeCognates && cognates.length > 0 && (
        <div className="w-tags">
          <span className="w-tag-lbl">同根词</span>
          {cognates.map((c, i) => (
            <span key={i} className="ep-tag ep-tag-cog">
              {c.part_of_speech ? `${c.part_of_speech} ${c.word}` : c.word}
            </span>
          ))}
        </div>
      )}
      {prefs.includeExamTags && <ExamTagRow tags={visibleExamTagsOf(analysis)} />}
    </div>
  );
}

// ── 句子卡（整块）──
function SentenceCardView({ analysis, prefs }: { analysis: SentenceAnalysisResult; prefs: ExportPreferences }) {
  return (
    <div className="ep-card ep-sentence">
      <div className="s-head"><SentenceTitleContent analysis={analysis} /></div>
      <SentenceMarkdown content={sentenceBodyMarkdown(analysis.content, sentenceExcludeSet(prefs))} />
    </div>
  );
}

// ── 段落碎片（跨页续排）──
export function renderParagraphFrag(
  pIndex: number,
  frag: ParagraphFragDef,
  ctx: BlockCtx
): React.ReactNode {
  const { data, prefs } = ctx;
  const p = data.paragraphsByIndex.get(pIndex);
  if (!p) return null;
  const norm = paragraphNormText(p);
  // 索引在 buildExportData 已建好，这里直接 O(1) 查表
  const wordAnalyses = data.wordsByKey;

  const enSlice = norm.slice(frag.enFrom, frag.enTo);
  const zh = data.translations[pIndex] ?? '';
  const zhSlice = zh.slice(frag.zhFrom, frag.zhTo);

  // 首片段（enFrom=0）是段落真正的段首：首段用首字下沉（不缩进），其余段保留首行缩进；仅续排片段不缩进
  const isFirst = p.index === 0;
  const enCls = frag.enFrom !== 0
    ? 'ep-en ep-en-cont'
    : isFirst ? 'ep-en ep-dropcap' : 'ep-en';

  return (
    <div className="ep-paragraph">
      <div className={enCls}>{highlightTokens(enSlice, p.index, wordAnalyses, false, {})}</div>
      {prefs.includeTranslation && zhSlice && <div className="ep-zh ep-zh-cont">{zhSlice}</div>}
    </div>
  );
}

// ── 卡片碎片（fragId 驱动，测量副本与分页 DOM 共用）──

/** 句子卡碎片 id 序列：f0 = 标题行（含原句拆解），f1.. = 正文 markdown 块 */
export function sentenceCardFragIds(analysis: SentenceAnalysisResult, prefs: ExportPreferences): string[] {
  const n = splitMarkdownBlocks(sentenceBodyMarkdown(analysis.content, sentenceExcludeSet(prefs))).length;
  return Array.from({ length: n + 1 }, (_, k) =>
    blockIds.sFrag(analysis.paragraph_index, analysis.sentence_index, k)
  );
}

/** 解析句子卡碎片 id → 碎片序号 */
export function parseSentenceFragId(fragId: string): { pi: number; si: number; k: number } | null {
  const m = fragId.match(/^s:(\d+):(\d+):f(\d+)$/);
  return m ? { pi: Number(m[1]), si: Number(m[2]), k: Number(m[3]) } : null;
}

/** 句子卡碎片行（带 id，可选「— 续」页眉） */
export function renderSentenceFrag(
  analysis: SentenceAnalysisResult,
  fragId: string,
  contBefore: boolean,
  prefs: ExportPreferences
): React.ReactNode {
  const parsed = parseSentenceFragId(fragId);
  const k = parsed?.k ?? 0;
  const blocks = splitMarkdownBlocks(sentenceBodyMarkdown(analysis.content, sentenceExcludeSet(prefs)));
  return (
    <>
      {contBefore && <div className="ep-cont">— 续</div>}
      {k === 0 ? (
        <div className="ep-frag s-head" id={fragId}><SentenceTitleContent analysis={analysis} /></div>
      ) : (
        <div className="ep-frag" id={fragId}>
          <SentenceMarkdown content={blocks[k - 1] ?? ''} />
        </div>
      )}
    </>
  );
}

/** 单词卡碎片行内容（id + 节点），六行卡超页罕见但保留碎片机制 */
export function wordCardFragRows(
  analysis: WordAnalysisResult,
  prefs: ExportPreferences
): { id: string; node: React.ReactNode }[] {
  const synonyms = analysis.synonyms_antonyms?.synonyms ?? [];
  const cognates = analysis.cognates ?? [];
  const baseForm =
    analysis.base_form && analysis.base_form.toLowerCase() !== analysis.word.toLowerCase()
      ? analysis.base_form
      : null;
  const base = blockIds.w(analysis.paragraph_index, analysis.word);
  const rows: { id: string; node: React.ReactNode }[] = [
    { id: `${base}:f0`, node: <div className="w-word">{analysis.word}</div> },
  ];
  if (prefs.includePhonetic && analysis.phonetic) {
    rows.push({ id: `${base}:f1`, node: <div className="w-phon">{analysis.phonetic}</div> });
  }
  if (analysis.definition || analysis.definition_zh) {
    rows.push({
      id: `${base}:f${rows.length}`,
      node: (
        <div className="w-def">
          {analysis.part_of_speech && <i className="w-pos">{analysis.part_of_speech}</i>}
          {analysis.definition && <span className="w-def-en">{analysis.definition}</span>}
          {prefs.includeChineseDefinition && analysis.definition_zh && (
            <span className="w-def-zh">{analysis.definition_zh}</span>
          )}
        </div>
      ),
    });
  }
  if (prefs.includeBaseForm && baseForm) {
    rows.push({
      id: `${base}:f${rows.length}`,
      node: <div className="w-base"><span className="w-tag-lbl">原形</span>{baseForm}</div>,
    });
  }
  if (prefs.includeSynonyms && synonyms.length > 0) {
    rows.push({
      id: `${base}:f${rows.length}`,
      node: (
        <div className="w-tags">
          <span className="w-tag-lbl">同义词</span>
          {synonyms.map((s, i) => (
            <span key={i} className="ep-tag ep-tag-syn">{s.part_of_speech ? `${s.part_of_speech} ${s.word}` : s.word}</span>
          ))}
        </div>
      ),
    });
  }
  if (prefs.includeCognates && cognates.length > 0) {
    rows.push({
      id: `${base}:f${rows.length}`,
      node: (
        <div className="w-tags">
          <span className="w-tag-lbl">同根词</span>
          {cognates.map((c, i) => (
            <span key={i} className="ep-tag ep-tag-cog">{c.part_of_speech ? `${c.part_of_speech} ${c.word}` : c.word}</span>
          ))}
        </div>
      ),
    });
  }
  if (prefs.includeExamTags) {
    const tags = visibleExamTagsOf(analysis);
    if (tags.length > 0) {
      rows.push({ id: `${base}:f${rows.length}`, node: <ExamTagRow tags={tags} /> });
    }
  }
  return rows;
}

// ── 块序列生成 ──

/**
 * 段内已解析 token（词+句）按原文出现顺序合并排序，返回 [{id, pos}]。
 * pos = token 在段内归一化文本（.ep-en 渲染文本，即 paragraphNormText）中的
 * 字符偏移；词取词干首现偏移，句取 splitSentences 序号累计起始偏移。
 * 原文中找不到的词 → Infinity（排末尾，属孤立解析，不参与同页对齐）。
 * 双栏同页对齐依赖：左栏「可见 token 计数」与右栏「卡片顺序/卡片 pos」
 * 必须来自同一序列，故 collectLeftBlocks/collectRightBlocks 共用本辅助。
 */
export function analyzedTokenPositions(
  data: ExportData,
  prefs: ExportPreferences,
  pi: number
): { id: string; pos: number }[] {
  const p = data.paragraphsByIndex.get(pi);
  if (!p) return [];
  const norm = paragraphNormText(p);
  const out: { id: string; pos: number }[] = [];
  if (prefs.includeWords) {
    // 词干首现在归一化文本中的字符偏移（与 wordPositionMap 的首次出现语义一致）
    const first = new Map<string, number>();
    let off = 0;
    for (const t of tokenizeWords(norm)) {
      if (t.stem) {
        const k = t.stem.toLowerCase();
        if (!first.has(k)) first.set(k, off);
      }
      off += t.raw.length;
    }
    for (const w of data.words) {
      if (w.paragraph_index !== pi) continue;
      out.push({ id: blockIds.w(pi, w.word), pos: first.get(w.word.toLowerCase()) ?? Infinity });
    }
  }
  if (prefs.includeSentences) {
    const sentences = splitSentences(p.text);
    const analyzed = new Set(
      data.sentences.filter((s) => s.paragraph_index === pi).map((s) => s.sentence_index)
    );
    let offset = 0;
    for (const s of sentences) {
      if (analyzed.has(s.index)) out.push({ id: blockIds.s(pi, s.index), pos: offset });
      offset += s.text.length + 1;
    }
  }
  out.sort((a, b) => a.pos - b.pos || (a.id < b.id ? -1 : 1));
  return out;
}

export function collectLeftBlocks(data: ExportData, prefs: ExportPreferences): BlockDef[] {
  const blocks: BlockDef[] = [];
  if (data.title) blocks.push({ id: blockIds.title, kind: 'atomic' });
  blocks.push({ id: blockIds.colHeadL, kind: 'atomic', keepNext: true });
  for (const p of data.paragraphs) {
    blocks.push({ id: blockIds.p(p.index), kind: 'paragraph' });
  }
  if (prefs.includeSummary && data.summary) {
    blocks.push({ id: blockIds.sumHead, kind: 'atomic', keepNext: true });
    splitMarkdownBlocks(data.summary).forEach((_, i) => {
      blocks.push({ id: blockIds.sumBody(i), kind: 'sum-p' });
    });
  }
  return blocks;
}

export function collectRightBlocks(data: ExportData, prefs: ExportPreferences): BlockDef[] {
  const blocks: BlockDef[] = [];
  // 右栏栏头（与左栏「原文 · 译文」对称）；双栏严格对齐时位于栏头行带
  blocks.push({ id: blockIds.colHeadR, kind: 'atomic', keepNext: true });
  // 每段卡片按段内原文出现顺序合并排序（词+句交错，带字符偏移 pos，
  // 双栏同页对齐的前提：卡片顺序 = token 顺序，才能做前缀对齐）
  const grouped = new Map<number, { id: string; pos: number }[]>();
  for (const p of data.paragraphs) {
    const tokens = analyzedTokenPositions(data, prefs, p.index);
    if (tokens.length > 0) grouped.set(p.index, tokens);
  }
  const indexes = [...grouped.keys()].sort((a, b) => a - b);
  for (const pi of indexes) {
    const g = grouped.get(pi)!;
    blocks.push({ id: blockIds.g(pi), kind: 'atomic', keepNext: true });
    for (const t of g) {
      blocks.push({
        id: t.id,
        kind: t.id.startsWith('w:') ? 'word-card' : 'sentence-card',
        pos: t.pos,
      });
    }
  }
  // 全文档零解析：栏头下保留提示（位于栏头行带，紧随栏头）
  if (blocks.length === 1) blocks.push({ id: blockIds.empty, kind: 'atomic' });
  return blocks;
}

/** 单栏模式单轨道：段落后紧跟该段解析，末尾总结 */
export function collectSingleBlocks(data: ExportData, prefs: ExportPreferences): BlockDef[] {
  const blocks: BlockDef[] = [];
  if (data.title) blocks.push({ id: blockIds.title, kind: 'atomic' });
  const wordsByPara = new Map<number, WordAnalysisResult[]>();
  const sentencesByPara = new Map<number, SentenceAnalysisResult[]>();
  if (prefs.includeWords) {
    for (const w of data.words) {
      const arr = wordsByPara.get(w.paragraph_index) ?? [];
      arr.push(w);
      wordsByPara.set(w.paragraph_index, arr);
    }
  }
  if (prefs.includeSentences) {
    for (const s of data.sentences) {
      const arr = sentencesByPara.get(s.paragraph_index) ?? [];
      arr.push(s);
      sentencesByPara.set(s.paragraph_index, arr);
    }
  }
  for (const p of data.paragraphs) {
    blocks.push({ id: blockIds.p(p.index), kind: 'paragraph' });
    for (const w of wordsByPara.get(p.index) ?? []) blocks.push({ id: blockIds.w(p.index, w.word), kind: 'word-card' });
    for (const s of sentencesByPara.get(p.index) ?? []) blocks.push({ id: blockIds.s(p.index, s.sentence_index), kind: 'sentence-card' });
  }
  if (prefs.includeSummary && data.summary) {
    blocks.push({ id: blockIds.sumHead, kind: 'atomic', keepNext: true });
    splitMarkdownBlocks(data.summary).forEach((_, i) => {
      blocks.push({ id: blockIds.sumBody(i), kind: 'sum-p' });
    });
  }
  return blocks;
}
