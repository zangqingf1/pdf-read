const FLASH_DURATION = 1500;
const WORD_FLASH_DURATION = 1800;

export interface ScrollToParagraphOptions {
  /** scrollIntoView 的对齐方式，默认居中；移动端底部弹层遮挡时用 'start' */
  block?: ScrollLogicalPosition;
  /** 段内要闪动高亮的单词（wordAnalysisKey 词形，小写） */
  word?: string | null;
  /** 元素尚未渲染时的重试次数（默认 ~3 秒） */
  retries?: number;
  /** 重试间隔毫秒 */
  retryIntervalMs?: number;
}

function flashWordToken(paragraphIndex: number, word: string): boolean {
  const el = document.querySelector(
    `[data-paragraph-index="${paragraphIndex}"] [data-word-key="${paragraphIndex}:${word.toLowerCase()}"]`,
  );
  if (!el) return false;
  el.classList.add('word-token-jump-flash');
  setTimeout(() => el.classList.remove('word-token-jump-flash'), WORD_FLASH_DURATION);
  return true;
}

function flashAndScroll(
  index: number,
  block: ScrollLogicalPosition,
  word?: string | null,
): boolean {
  const el = document.querySelector(`[data-paragraph-index="${index}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block });
  el.classList.add('paragraph-flash');
  setTimeout(() => el.classList.remove('paragraph-flash'), FLASH_DURATION);
  if (word) flashWordToken(index, word);
  return true;
}

/**
 * 滚动到指定段落并闪动高亮（.paragraph-flash）；
 * 传入 word 时对段内对应单词 token 叠加暖橙闪动（.word-token-jump-flash）。
 * 元素未渲染时按 retries/intervalMs 延迟重试（文档异步加载场景）。
 */
export function scrollToParagraph(
  index: number,
  { block = 'center', word, retries = 20, retryIntervalMs = 150 }: ScrollToParagraphOptions = {},
): void {
  if (flashAndScroll(index, block, word)) return;
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (flashAndScroll(index, block, word) || attempts >= retries) {
      clearInterval(timer);
    }
  }, retryIntervalMs);
}

export interface ScrollToSentenceOptions {
  /** scrollIntoView 的对齐方式，默认居中 */
  block?: ScrollLogicalPosition;
  /** 元素尚未渲染时的重试次数（默认 ~3 秒） */
  retries?: number;
  /** 重试间隔毫秒 */
  retryIntervalMs?: number;
}

function findSentenceElement(
  paragraphIndex: number,
  sentenceIndex: number,
): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-paragraph-index="${paragraphIndex}"] .sentence-token[data-sentence-index="${sentenceIndex}"]`,
  );
}

/**
 * 滚动到指定段落的某一句话（句子 span 精确居中）。
 * 与 scrollToParagraph 一样带元素未渲染重试；始终找不到时（段落被编辑/
 * 索引错位等）回退到整段定位，不静默失败。
 */
export function scrollToSentence(
  paragraphIndex: number,
  sentenceIndex: number,
  { block = 'center', retries = 20, retryIntervalMs = 150 }: ScrollToSentenceOptions = {},
): void {
  let found = false;
  const scrollOnce = () => {
    const el = findSentenceElement(paragraphIndex, sentenceIndex);
    if (!el) return false;
    found = true;
    el.scrollIntoView({ behavior: 'smooth', block });
    return true;
  };
  if (scrollOnce()) return;
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (scrollOnce() || attempts >= retries) {
      clearInterval(timer);
      if (!found) scrollToParagraph(paragraphIndex, { block });
    }
  }, retryIntervalMs);
}
