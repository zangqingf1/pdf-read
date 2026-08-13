import { create } from 'zustand';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/** 当前朗读位置（wordIdx=-1 表示句子级高亮降级） */
export interface TtsHighlight {
  paraIdx: number;
  sentIdx: number;
  wordIdx: number;
}

interface AudioPlayerState {
  status: PlayerStatus;
  /** 当前段落在文档中的索引 */
  activeParagraph: number | null;
  /** 正在朗读的精确位置（词级或句子级） */
  highlight: TtsHighlight | null;
  accent: 'us' | 'uk';
  /** 语速百分比，如 "+10%"、"0% 归一为 +0%"、"-20%"（edge-tts 要求带符号） */
  rate: string;
  /** 自动跟随滚动 */
  followScroll: boolean;
  /** 当前段总时长（ms）与已播放时长（ms） */
  durationMs: number;
  currentTimeMs: number;
  error: string | null;

  // 播放条 UI 控制（由 player 单例调用）
  setStatus: (s: PlayerStatus) => void;
  setActiveParagraph: (i: number | null) => void;
  setHighlight: (h: TtsHighlight | null) => void;
  setAccent: (a: 'us' | 'uk') => void;
  setRate: (r: string) => void;
  setFollowScroll: (v: boolean) => void;
  setProgress: (currentMs: number, durationMs: number) => void;
  setError: (e: string | null) => void;
}

export const useAudioPlayerStore = create<AudioPlayerState>((set) => ({
  status: 'idle',
  activeParagraph: null,
  highlight: null,
  accent: 'us',
  rate: '+0%',
  followScroll: true,
  durationMs: 0,
  currentTimeMs: 0,
  error: null,

  setStatus: (s) => set({ status: s }),
  setActiveParagraph: (i) => set({ activeParagraph: i }),
  setHighlight: (h) => set({ highlight: h }),
  setAccent: (a) => set({ accent: a }),
  setRate: (r) => set({ rate: r }),
  setFollowScroll: (v) => set({ followScroll: v }),
  setProgress: (currentMs, durationMs) => set({ currentTimeMs: currentMs, durationMs }),
  setError: (e) => set({ error: e }),
}));
