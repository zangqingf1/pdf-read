/**
 * 段落朗读播放器引擎 — 模块级单例（组件经 audioPlayerStore 订阅状态）。
 *
 * 双 `<audio>` 交替实现近无感段落衔接：
 * - 播放第 N 段时，将第 N+1 段预加载（fetch + 解码 + 定位）到备用元素，
 *   `ended` 触发时直接切到已就绪元素播放，避免「取音频→解码→起播」的切换间隙
 * - `timeupdate` 用 WordBoundary 时间戳二分定位当前词/句 → 更新 store 高亮
 * - 支持从任意句子起播（`playFromSentence` 按句起始时间 seek）
 * - 语速/口音变更后从当前句强制重新合成播放；自动跟随滚动（可关闭）
 */

import { useAudioPlayerStore } from '../stores/audioPlayerStore';
import { useReaderStore } from '../stores/readerStore';
import { useDocumentStore } from '../stores/documentStore';
import {
  getParagraphAudio,
  type ParagraphAudioResult,
} from '../services/paragraphTtsApi';
import {
  alignBoundaries,
  findEntryAtTime,
  findSentenceAtTime,
  sentenceStartOffset,
  type TtsAlignment,
} from '../utils/ttsAlign';
import { splitSentences } from '../utils/textTokens';

/** 双元素交替：activeIdx 指向当前播放元素，另一个作为备用预加载槽 */
let els: HTMLAudioElement[] = [];
let activeIdx = 0;

let activeResult: ParagraphAudioResult | null = null;
let activeAlignment: TtsAlignment | null = null;
let activeParaIdx: number | null = null;
let loadSeq = 0;

/** 已预加载、随时可播的下一段（含其合成参数，参数变更后失效） */
let standby: {
  docId: string;
  paraIdx: number;
  accent: string;
  rate: string;
  el: HTMLAudioElement;
  result: ParagraphAudioResult;
} | null = null;
let prefetchSeq = 0;

let lastScrollSent = -1;
let lastScrollTime = 0;

// ── element management ───────────────────────────────────────────────

function ensureEls(): HTMLAudioElement[] {
  if (els.length === 0) {
    els = [new Audio(), new Audio()];
    for (const el of els) {
      el.addEventListener('timeupdate', onTimeUpdate);
      el.addEventListener('ended', onEnded);
      el.addEventListener('error', onAudioError);
    }
  }
  return els;
}

function activeEl(): HTMLAudioElement | null {
  return ensureEls()[activeIdx];
}

function freeEl(): HTMLAudioElement {
  return ensureEls()[1 - activeIdx];
}

/** 切到备用元素（暂停旧元素避免双音源） */
function swapActive() {
  const prev = els[activeIdx];
  activeIdx = 1 - activeIdx;
  prev.pause();
}

function sortedParagraphs() {
  return [...useDocumentStore.getState().paragraphs].sort((a, b) => a.index - b.index);
}

function store() {
  return useAudioPlayerStore.getState();
}

function nowDocId(): string | null {
  return useDocumentStore.getState().documentId;
}

/** 当前口音偏好（全局 readerStore，音标/单词发音/朗读统一） */
function currentAccent(): 'us' | 'uk' {
  return useReaderStore.getState().accent;
}

// ── 预加载下一段到备用元素 ─────────────────────────────────────────

function prefetchNext(paraIdx: number) {
  const docId = nowDocId();
  if (!docId) return;
  const paras = sortedParagraphs();
  const cur = paras.findIndex((p) => p.index === paraIdx);
  const next = cur >= 0 ? paras[cur + 1] : undefined;
  if (!next) return;
  const st = store();
  const seq = ++prefetchSeq;
  const el = freeEl();
  const targetIdx = next.index;
  const accent = currentAccent();
  void (async () => {
    const result = await getParagraphAudio(docId, targetIdx, next.text, accent, st.rate);
    if (seq !== prefetchSeq || !result) return;
    await _prepare(el, result, 0);
    if (seq !== prefetchSeq) return;
    standby = { docId, paraIdx: targetIdx, accent, rate: st.rate, el, result };
  })().catch(() => {});
}

// ── 元素就绪准备（设源 / 解码 / 定位，不播放）──────────────────────

function _waitMetadata(el: HTMLAudioElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (el.readyState >= 1) {
      resolve();
      return;
    }
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error('metadata load failed'));
    };
    const cleanup = () => {
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('error', onErr);
    };
    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('error', onErr);
  });
}

async function _prepare(el: HTMLAudioElement, result: ParagraphAudioResult, offsetMs: number) {
  if (el.src !== result.url) el.src = result.url;
  if (el.readyState < 1) await _waitMetadata(el);
  const target = Math.max(0, Math.min(offsetMs / 1000, el.duration || 0));
  if (Math.abs((el.currentTime || 0) - target) > 0.01) {
    await new Promise<void>((resolve) => {
      const onSeek = () => {
        el.removeEventListener('seeked', onSeek);
        resolve();
      };
      el.addEventListener('seeked', onSeek);
      el.currentTime = target;
    });
  }
}

// ── audio element events ─────────────────────────────────────────────

function onTimeUpdate(e: Event) {
  if (!els.length) return;
  if (e.target !== els[activeIdx]) return;
  if (activeParaIdx === null) return;
  const el = e.target as HTMLAudioElement;
  const timeMs = (el.currentTime || 0) * 1000;
  const st = store();
  st.setProgress(timeMs, activeResult?.duration_ms ?? (el.duration || 0) * 1000);

  const align = activeAlignment;
  if (!align) return;
  if (align.sentenceFallback) {
    const s = findSentenceAtTime(align.sentenceStartMap, timeMs);
    if (s !== null) {
      st.setHighlight({ paraIdx: activeParaIdx, sentIdx: s, wordIdx: -1 });
      maybeScroll({ paraIdx: activeParaIdx, sentIdx: s });
    }
  } else {
    const entry = findEntryAtTime(align.entries, timeMs);
    if (entry) {
      st.setHighlight({ paraIdx: activeParaIdx, sentIdx: entry.sentIdx, wordIdx: entry.wordIdx });
      maybeScroll({ paraIdx: activeParaIdx, sentIdx: entry.sentIdx });
    }
  }
}

function onEnded(e: Event) {
  if (!els.length) return;
  if (e.target !== els[activeIdx]) return;
  if (activeParaIdx === null) return;
  const paras = sortedParagraphs();
  const cur = paras.findIndex((p) => p.index === activeParaIdx);
  const next = cur >= 0 ? paras[cur + 1] : undefined;
  if (next) {
    void playFromParagraph(next.index);
  } else {
    stop();
  }
}

function onAudioError(e: Event) {
  if (!els.length) return;
  if (e.target !== els[activeIdx]) return;
  const st = store();
  st.setStatus('error');
  st.setError(`第 ${(activeParaIdx ?? 0) + 1} 段音频播放失败`);
  // 尝试跳到下一段，避免整篇中断
  const paras = sortedParagraphs();
  const cur = paras.findIndex((p) => p.index === activeParaIdx);
  const next = cur >= 0 ? paras[cur + 1] : undefined;
  if (next) void playFromParagraph(next.index);
  else stop();
}

function maybeScroll(highlight: { paraIdx: number; sentIdx: number }) {
  const st = store();
  if (!st.followScroll) return;
  const now = Date.now();
  if (highlight.sentIdx === lastScrollSent && now - lastScrollTime < 1500) return;
  const el = document.querySelector<HTMLElement>(
    `[data-paragraph-index="${highlight.paraIdx}"][data-sentence-index="${highlight.sentIdx}"]`
  );
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    lastScrollSent = highlight.sentIdx;
    lastScrollTime = now;
  }
}

// ── play orchestration ───────────────────────────────────────────────

async function _loadAndPlay(
  docId: string,
  paraIdx: number,
  sentIdx: number | null,
  forceReload = false,
) {
  const st = store();
  const seq = ++loadSeq;
  st.setStatus('loading');
  st.setActiveParagraph(paraIdx);
  st.setHighlight(null);
  st.setError(null);

  const para = useDocumentStore.getState().paragraphs.find((p) => p.index === paraIdx);

  // 快速路径：同一段内点句子 / 重播 → 直接定位当前活动元素，不重建音源
  if (!forceReload && paraIdx === activeParaIdx && activeResult && activeEl()) {
    const offset = sentIdx !== null
      ? sentenceStartOffset(activeAlignment?.sentenceStartMap ?? new Map(), sentIdx) ?? 0
      : 0;
    const el = activeEl()!;
    await _prepare(el, activeResult, offset);
    if (seq !== loadSeq) return;
    try {
      await el.play();
    } catch {
      if (seq === loadSeq) st.setStatus('paused');
      return;
    }
    if (seq !== loadSeq) return;
    st.setStatus('playing');
    return;
  }

  // 复用已预加载的下一段（参数一致时）
  const reuseStandby =
    !forceReload &&
    !!standby &&
    standby.paraIdx === paraIdx &&
    standby.accent === currentAccent() &&
    standby.rate === st.rate;

  let result: ParagraphAudioResult | null;
  if (reuseStandby && standby) {
    result = standby.result;
  } else {
    result = await getParagraphAudio(docId, paraIdx, para?.text ?? '', currentAccent(), st.rate);
    if (seq !== loadSeq) return;
    if (!result) {
      st.setStatus('error');
      st.setError(`第 ${paraIdx + 1} 段音频生成失败`);
      activeParaIdx = paraIdx;
      const paras = sortedParagraphs();
      const cur = paras.findIndex((p) => p.index === paraIdx);
      const next = cur >= 0 ? paras[cur + 1] : undefined;
      if (next) {
        void playFromParagraph(next.index);
      } else {
        stop();
      }
      return;
    }
  }

  // 计算对齐与句起始偏移
  let offsetMs = 0;
  let alignment: TtsAlignment | null = null;
  if (para) {
    alignment = alignBoundaries(result.boundaries, splitSentences(para.text));
    if (sentIdx !== null) {
      offsetMs = sentenceStartOffset(alignment.sentenceStartMap, sentIdx) ?? 0;
    }
  }

  // 切到目标元素（预加载元素或空载元素）
  let el: HTMLAudioElement;
  if (reuseStandby && standby) {
    el = standby.el;
    standby = null;
    swapActive();
  } else {
    el = freeEl();
    swapActive();
  }
  activeResult = result;
  activeAlignment = alignment;
  activeParaIdx = paraIdx;

  // 使备用预取失效，避免与手动加载同抢一个空闲元素
  prefetchSeq += 1;

  try {
    await _prepare(el, result, offsetMs);
    if (seq !== loadSeq) return;
    await el.play();
    if (seq !== loadSeq) return;
    st.setStatus('playing');
    prefetchNext(paraIdx);
  } catch {
    if (seq === loadSeq) st.setStatus('paused');
  }
}

// ── public API（组件通过这里控制播放器）──────────────────────────────

export async function playFromParagraph(paraIdx: number) {
  const docId = nowDocId();
  if (!docId) return;
  await _loadAndPlay(docId, paraIdx, null);
}

export async function playFromSentence(paraIdx: number, sentIdx: number, forceReload = false) {
  const docId = nowDocId();
  if (!docId) return;
  await _loadAndPlay(docId, paraIdx, sentIdx, forceReload);
}

export function togglePlay() {
  const st = store();
  const el = activeEl();
  if (!el) return;
  if (st.status === 'playing') {
    el.pause();
    st.setStatus('paused');
  } else if (st.status === 'paused') {
    el.play().then(() => st.setStatus('playing')).catch(() => {});
  }
}

export function pause() {
  const el = activeEl();
  el?.pause();
  if (store().status === 'playing') store().setStatus('paused');
}

export function stop() {
  loadSeq += 1;
  prefetchSeq += 1;
  for (const el of els) {
    el.pause();
    el.removeAttribute('src');
    el.load();
  }
  standby = null;
  activeResult = null;
  activeAlignment = null;
  activeParaIdx = null;
  const st = store();
  st.setStatus('idle');
  st.setActiveParagraph(null);
  st.setHighlight(null);
  st.setProgress(0, 0);
  st.setError(null);
}

export function setAccent(accent: 'us' | 'uk') {
  const st = store();
  const paraIdx = st.activeParagraph;
  const sentIdx = st.highlight?.sentIdx ?? 0;
  useReaderStore.getState().setAccent(accent);
  if (paraIdx !== null && st.status !== 'idle') {
    void playFromSentence(paraIdx, sentIdx, true);
  }
}

export function setRate(rate: string) {
  const st = store();
  const paraIdx = st.activeParagraph;
  const sentIdx = st.highlight?.sentIdx ?? 0;
  st.setRate(rate);
  if (paraIdx !== null && st.status !== 'idle') {
    void playFromSentence(paraIdx, sentIdx, true);
  }
}

/** 拖动进度条跳转（当前段落内）。 */
export function seek(ms: number) {
  const el = activeEl();
  if (!el || activeParaIdx === null) return;
  const clamped = Math.max(0, Math.min(ms / 1000, el.duration || 0));
  el.currentTime = clamped;
  store().setProgress(clamped * 1000, activeResult?.duration_ms ?? 0);
}

export function destroy() {
  stop();
  for (const el of els) {
    el.removeEventListener('timeupdate', onTimeUpdate);
    el.removeEventListener('ended', onEnded);
    el.removeEventListener('error', onAudioError);
  }
  els = [];
}

/** React hook：仅在组件树挂载时初始化/清理单例。 */
export function useParagraphAudioPlayer() {
  return { playFromParagraph, playFromSentence, togglePlay, pause, stop, setAccent, setRate, seek };
}
