/**
 * 文本 token 化共享纯函数：阅读页（ParagraphBlock）与导出 PDF 共用。
 * 单词/句子解析在 store 中的 key 规则也在此统一定义，保证两端一致。
 */

/** 按句末标点 + 大写开头切分句子 */
export function splitSentences(text: string): { text: string; index: number }[] {
  const parts = text.split(/(?<=[.!?]["']?)\s+(?=[A-Z"'])/g);
  return parts
    .map((s, i) => ({ text: s.trim(), index: i }))
    .filter((s) => s.text.length > 0);
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
