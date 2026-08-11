/**
 * 单词发音混合播放器：
 *  - 有网络 → 优先在线 edge-tts 神经语音（后端 /api/v1/tts），带会话级 blob 缓存
 *  - 无网络 / 网络差（请求失败或超时）→ 回退浏览器本地 Web Speech API
 *
 * 提速策略：同一 (word, accent) 只在线请求一次并缓存 blob URL，
 * 悬停/弹层打开时提前预取，点击时命中缓存即可零网络播放。
 */

import { getTtsAudio, type SpeechAccent } from '../services/ttsApi';

let currentAudio: HTMLAudioElement | null = null;

// ── 会话级 blob 缓存：key = `${word}:${accent}` → blob URL ──
const blobCache = new Map<string, string>();
// 并发去重：正在请求中的 (word, accent) 复用同一 Promise，避免 hover+click 双发
const pending = new Map<string, Promise<string | null>>();

function cacheKey(word: string, accent: SpeechAccent): string {
  return `${word.toLowerCase()}:${accent}`;
}

function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

function loadVoices(): SpeechSynthesisVoice[] {
  if (!speechSupported()) return [];
  // Chrome 首次调用可能为空，voiceschanged 事件后再拉取
  return window.speechSynthesis.getVoices();
}

if (speechSupported()) {
  loadVoices();
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    loadVoices();
  });
}

/** 优先选与目标语言匹配的本地语音，否则交给浏览器默认。 */
function pickVoice(locale: 'en-US' | 'en-GB'): SpeechSynthesisVoice | null {
  const lang = locale.toLowerCase();
  const matches = loadVoices().filter((v) =>
    v.lang.toLowerCase().replace('_', '-').startsWith(lang)
  );
  return matches.find((v) => v.localService) ?? matches[0] ?? null;
}

/** 离线方案：浏览器本地语音（en-US / en-GB）。 */
export function speakOffline(word: string, accent: SpeechAccent): void {
  if (!speechSupported() || !word) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const locale: 'en-US' | 'en-GB' = accent === 'us' ? 'en-US' : 'en-GB';
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = locale;
  const voice = pickVoice(locale);
  if (voice) utterance.voice = voice;
  synth.speak(utterance);
}

/** 停止当前在线/离线播放。 */
export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
}

/** 获取并缓存音频 blob URL：命中缓存直接返回；失败返回 null（不缓存）。并发去重。 */
function fetchAndCache(word: string, accent: SpeechAccent): Promise<string | null> {
  const k = cacheKey(word, accent);
  const cached = blobCache.get(k);
  if (cached) return Promise.resolve(cached);
  let p = pending.get(k);
  if (!p) {
    p = getTtsAudio(word, accent).then((url) => {
      pending.delete(k);
      if (url) blobCache.set(k, url);
      return url;
    });
    pending.set(k, p);
  }
  return p;
}

/** 预热缓存：不等待、失败静默，供悬停/弹层打开时提前请求音频。 */
export function prefetchSpeak(word: string, accent: SpeechAccent): void {
  if (!word || typeof window === 'undefined' || !navigator.onLine) return;
  void fetchAndCache(word, accent);
}

/** 主入口：命中缓存立即播放，否则在线获取，失败回退离线。 */
export async function speakWord(word: string, accent: SpeechAccent): Promise<void> {
  if (!word) return;
  stopSpeaking();
  if (typeof window === 'undefined') return;

  // 浏览器明确离线 → 直接走本地语音
  if (!navigator.onLine) {
    speakOffline(word, accent);
    return;
  }

  // 已缓存 → 零网络直接播放；未命中 → 在线获取并缓存
  const url = blobCache.get(cacheKey(word, accent)) ?? (await fetchAndCache(word, accent));
  if (!url) {
    speakOffline(word, accent);
    return;
  }
  try {
    const audio = new Audio(url);
    currentAudio = audio;
    audio.addEventListener('ended', () => {
      if (currentAudio === audio) currentAudio = null;
    });
    await audio.play();
  } catch {
    speakOffline(word, accent);
  }
}
