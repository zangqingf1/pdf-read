/**
 * 文本 token 化共享纯函数：阅读页（ParagraphBlock）与导出 PDF 共用。
 * 单词/句子解析在 store 中的 key 规则也在此统一定义，保证两端一致。
 */

/** 换行符（兼容 \r\n / \r；OCR 入库时已归一为 \n） */
const LINE_BREAK_RE = /\r\n|\r|\n/;

/** 按换行符切分（返回值仍含空行占位，便于还原用户手动换行） */
export function splitLines(text: string): string[] {
  return text.split(LINE_BREAK_RE);
}

/** 统计文本中的换行数量 */
export function countLineBreaks(text: string): number {
  return text.split(LINE_BREAK_RE).length - 1;
}

export interface Sentence {
  text: string;
  index: number;
  /**
   * 本句之前的手动换行数量（0 = 与前句同行）。
   * 切分时句间空白被当作分隔符消费，换行信息只能在此保留，供阅读页还原排版。
   */
  breaksBefore: number;
}

/**
 * 按句末标点 + 大写开头切分句子。
 *
 * 正则外套捕获组，使 split 结果交替输出 [段, 分隔符, 段, 分隔符, …]：
 * 段用于生成句子，分隔符用于记录换行数。`index = i / 2` 与 `text.trim()`
 * 与旧实现（无捕获组的 parts 下标 + trim）逐字逐序一致 —— 句子索引即
 * SentenceAnalysis 的 `sentence_index`，绝不能因换行而漂移。
 */
export function splitSentences(text: string): Sentence[] {
  const parts = text.split(/((?<=[.!?]["']?)\s+(?=[A-Z"']))/g);
  const sentences: Sentence[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const segment = parts[i];
    // 首段没有前置分隔符，取自身前导空白（用户可能整段以回车开头）
    const before = i === 0 ? (/^\s*/.exec(segment)?.[0] ?? '') : parts[i - 1];
    const trimmed = segment.trim();
    if (trimmed.length > 0) {
      sentences.push({ text: trimmed, index: i / 2, breaksBefore: countLineBreaks(before) });
    }
  }
  return sentences;
}

export interface WordToken {
  /** 原始片段（含标点/空白） */
  raw: string;
  /** 提取出的词干（保留连字符/撇号）；空白/纯标点片段为 null */
  stem: string | null;
}

/** 按空白切分并提取词干；空白与纯标点片段 stem=null */
export function tokenizeWords(text: string): WordToken[] {
  return text.split(/(\s+)/g).map((part) => {
    if (/^\s+$/.test(part)) return { raw: part, stem: null };
    if (/[a-zA-Z]/.test(part)) {
      const word = part.replace(/[^a-zA-Z'-]/g, '');
      if (word.length > 0) return { raw: part, stem: word };
    }
    return { raw: part, stem: null };
  });
}

/** 词干 → 在文本 token 流中的首次出现下标；未找到返回 -1（纯标点/空白不计） */
export function wordPositionMap(text: string): Map<string, number> {
  const m = new Map<string, number>();
  tokenizeWords(text).forEach((t, i) => {
    if (t.stem !== null) {
      const k = t.stem.toLowerCase();
      if (!m.has(k)) m.set(k, i);
    }
  });
  return m;
}

/** 单词解析 key：`${paragraphIndex}:${word.toLowerCase()}` */
export function wordAnalysisKey(paragraphIndex: number, word: string): string {
  return `${paragraphIndex}:${word.toLowerCase()}`;
}

/** 句子解析 key：`${paragraphIndex}:${sentenceIndex}` */
export function sentenceAnalysisKey(paragraphIndex: number, sentenceIndex: number): string {
  return `${paragraphIndex}:${sentenceIndex}`;
}
