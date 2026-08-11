import api from './api';

/** 口音：us=美音, uk=英音 */
export type SpeechAccent = 'us' | 'uk';

/**
 * 获取单词发音音频（在线 edge-tts 神经语音）。
 * 成功返回 blob URL；任何失败（网络 / 超时 / 后端异常）返回 null，
 * 由调用方回退到浏览器本地语音。
 */
export async function getTtsAudio(
  word: string,
  accent: SpeechAccent,
  timeoutMs = 5000
): Promise<string | null> {
  try {
    const resp = await api.get('/tts', {
      params: { word, accent },
      responseType: 'blob',
      timeout: timeoutMs,
    });
    const blob = resp.data as Blob;
    if (!blob || blob.size === 0) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
