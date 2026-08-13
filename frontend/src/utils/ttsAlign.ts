/**
 * 段落朗读时间戳对齐 — 纯函数，可单测。
 *
 * 后端返回的 WordBoundary 是按「实际朗读顺序」的词级时间戳，与原文 token 流
 * 不一定一一对应（数字被展开朗读、缩写/连字符可能被拆词、个别词不发音等）。
 * 这里用贪婪双指针 + 前向查找把边界对齐到 `splitSentences`/`tokenizeWords`
 * 产出的 (句子索引, 词索引) 上；对齐率过低时整段降级为句子级高亮。
 */

import { splitSentences, tokenizeWords } from './textTokens';

/** 前向查找窗口：允许跳过的原文词数上限（应对数字/展开朗读） */
const LOOKAHEAD = 8;
/** 对齐率阈值：低于则句子级高亮兜底 */
const MIN_MATCH_RATIO = 0.6;

export interface TtsWordBoundary {
  text: string;
  offset_ms: number;
  duration_ms: number;
}

export interface TtsAlignedEntry {
  sentIdx: number;
  wordIdx: number;
  offset_ms: number;
  duration_ms: number;
}

export interface TtsAlignment {
  /** `${sentIdx}:${wordIdx}` → 时间区间 */
  wordMap: Map<string, { offset_ms: number; duration_ms: number }>;
  /** 按时间升序的词级条目（供播放器二分定位） */
  entries: TtsAlignedEntry[];
  /** 每句起始时间戳（未匹配句子用邻近句子插值） */
  sentenceStartMap: Map<number, number>;
  /** 对齐率过低 → 句子级高亮 */
  sentenceFallback: boolean;
  totalWords: number;
  matchedWords: number;
}

interface FlatWord {
  sentIdx: number;
  wordIdx: number;
  norm: string;
}

function normalizeWord(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9']/g, '');
}

function buildWordStream(
  sentences: { text: string; index: number }[],
): FlatWord[] {
  const words: FlatWord[] = [];
  for (const s of sentences) {
    let wi = 0;
    for (const t of tokenizeWords(s.text)) {
      if (t.stem !== null) {
        words.push({ sentIdx: s.index, wordIdx: wi, norm: normalizeWord(t.stem) });
        wi += 1;
      }
    }
  }
  return words;
}

export function alignBoundaries(
  boundaries: TtsWordBoundary[],
  sentences: { text: string; index: number }[],
): TtsAlignment {
  const words = buildWordStream(sentences);
  const wordMap = new Map<string, { offset_ms: number; duration_ms: number }>();
  const entries: TtsAlignedEntry[] = [];
  const matched = new Set<number>();

  let b = 0;
  let w = 0;

  const assign = (wordIdx: number, offset_ms: number, duration_ms: number) => {
    const fw = words[wordIdx];
    const key = `${fw.sentIdx}:${fw.wordIdx}`;
    wordMap.set(key, { offset_ms, duration_ms });
    entries.push({ sentIdx: fw.sentIdx, wordIdx: fw.wordIdx, offset_ms, duration_ms });
    matched.add(wordIdx);
  };

  while (b < boundaries.length && w < words.length) {
    const bnorm = normalizeWord(boundaries[b].text);
    if (!bnorm) {
      b += 1; // 空文本边界跳过
      continue;
    }
    if (words[w].norm === bnorm) {
      assign(w, boundaries[b].offset_ms, boundaries[b].duration_ms);
      w += 1;
      b += 1;
      continue;
    }
    // 前向查找：跳过若干原文词（可能被展开/不发音），尝试匹配当前边界
    let found = -1;
    for (let d = 1; d <= LOOKAHEAD && w + d < words.length; d += 1) {
      if (words[w + d].norm === bnorm) {
        found = d;
        break;
      }
    }
    if (found >= 0) {
      assign(w + found, boundaries[b].offset_ms, boundaries[b].duration_ms);
      w = w + found + 1;
      b += 1;
    } else {
      b += 1; // 该边界在原文无对应词（多余的朗读），跳过
    }
  }

  // 每句最早/最晚词级时间，用于句子起始插值
  const sentFirst = new Map<number, number>();
  const sentLast = new Map<number, number>();
  for (const e of entries) {
    const first = sentFirst.get(e.sentIdx) ?? Infinity;
    const last = sentLast.get(e.sentIdx) ?? -1;
    sentFirst.set(e.sentIdx, Math.min(first, e.offset_ms));
    sentLast.set(e.sentIdx, Math.max(last, e.offset_ms + e.duration_ms));
  }

  const sentenceStartMap = new Map<number, number>();
  const orderedSentences = sentences.slice().sort((a, b2) => a.index - b2.index);
  let prevEnd: number | null = null;

  for (let i = 0; i < orderedSentences.length; i += 1) {
    const s = orderedSentences[i];
    const own = sentFirst.get(s.index);
    if (own !== undefined) {
      sentenceStartMap.set(s.index, own);
      prevEnd = sentLast.get(s.index) ?? own;
      continue;
    }
    // 未匹配句子：用前句结尾，或后文最近的已知起始，或 0
    if (prevEnd === null) {
      let next: number | null = null;
      for (let j = i + 1; j < orderedSentences.length; j += 1) {
        const v = sentFirst.get(orderedSentences[j].index);
        if (v !== undefined) { next = v; break; }
      }
      sentenceStartMap.set(s.index, next ?? 0);
    } else {
      sentenceStartMap.set(s.index, prevEnd);
    }
  }

  const totalWords = words.length;
  const matchedWords = matched.size;
  const sentenceFallback =
    totalWords > 0 && matchedWords / totalWords < MIN_MATCH_RATIO;

  entries.sort((a, b2) => a.offset_ms - b2.offset_ms);

  return {
    wordMap,
    entries,
    sentenceStartMap,
    sentenceFallback,
    totalWords,
    matchedWords,
  };
}

/** 二分：给定毫秒时间，返回当前词级条目（无则 null） */
export function findEntryAtTime(
  entries: TtsAlignedEntry[],
  timeMs: number,
): TtsAlignedEntry | null {
  if (entries.length === 0) return null;
  let lo = 0;
  let hi = entries.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (entries[mid].offset_ms <= timeMs) lo = mid;
    else hi = mid - 1;
  }
  const e = entries[lo];
  if (timeMs >= e.offset_ms && timeMs < e.offset_ms + e.duration_ms) return e;
  return null;
}

/** 二分：给定毫秒时间，返回当前句子索引（无数据返回 null） */
export function findSentenceAtTime(
  sentenceStartMap: Map<number, number>,
  timeMs: number,
): number | null {
  const keys = [...sentenceStartMap.keys()].sort((a, b) => a - b);
  if (keys.length === 0) return null;
  let lo = 0;
  let hi = keys.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((sentenceStartMap.get(keys[mid]) ?? 0) <= timeMs) lo = mid;
    else hi = mid - 1;
  }
  return keys[lo];
}

/** 给定句子索引，返回该句起始时间戳（无则 null） */
export function sentenceStartOffset(
  sentenceStartMap: Map<number, number>,
  sentIdx: number,
): number | null {
  return sentenceStartMap.get(sentIdx) ?? null;
}
