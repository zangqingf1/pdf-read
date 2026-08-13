import api from './api';

/** 口音：us=美音, uk=英音（与单词发音一致） */
export type SpeechAccent = 'us' | 'uk';

/** edge-tts WordBoundary 词级时间戳（前端用它做卡拉OK高亮） */
export interface ParagraphWordBoundary {
  text: string;
  offset_ms: number;
  duration_ms: number;
}

export interface ParagraphAudioResult {
  /** 段落 mp3 的 blob URL */
  url: string;
  boundaries: ParagraphWordBoundary[];
  duration_ms: number;
}

/** 会话级缓存：key = `docId:index:textHash:accent:rate` → blob URL + 边界 */
const cache = new Map<string, ParagraphAudioResult>();
/** 并发去重：正在请求中的 key 复用同一 Promise */
const pending = new Map<string, Promise<ParagraphAudioResult>>();

/** 简单字符串哈希：段落文本参与缓存键，编辑后自动失效旧音频 */
function textHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

function cacheKey(
  documentId: string,
  index: number,
  text: string,
  accent: SpeechAccent,
  rate: string,
): string {
  return `${documentId}:${index}:${textHash(text)}:${accent}:${rate}`;
}

function base64ToBlobUrl(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
}

/**
 * 获取某段落朗读音频 + 词级边界。成功缓存 blob URL；任何失败返回 null。
 * 并发调用同段落会复用同一个进行中的请求。
 */
export async function getParagraphAudio(
  documentId: string,
  index: number,
  text: string,
  accent: SpeechAccent,
  rate: string,
  signal?: AbortSignal,
): Promise<ParagraphAudioResult | null> {
  const key = cacheKey(documentId, index, text, accent, rate);
  const cached = cache.get(key);
  if (cached) return cached;

  let p = pending.get(key);
  if (!p) {
    p = (async () => {
      const resp = await api.get(`/tts/paragraph/${documentId}`, {
        params: { index, accent, rate },
        signal,
      });
      const data = resp.data as {
        audio_base64: string;
        boundaries: ParagraphWordBoundary[];
        duration_ms: number;
      };
      if (!data?.audio_base64) throw new Error('empty audio');
      const result: ParagraphAudioResult = {
        url: base64ToBlobUrl(data.audio_base64),
        boundaries: data.boundaries || [],
        duration_ms: data.duration_ms || 0,
      };
      cache.set(key, result);
      return result;
    })().finally(() => {
      pending.delete(key);
    });
    pending.set(key, p);
  }
  return p.catch(() => null);
}
