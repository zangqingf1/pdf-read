import type { SpeechAccent } from '../../services/ttsApi';
import { speakWord, prefetchSpeak } from '../../utils/speak';

interface SpeakerButtonProps {
  word: string;
  accent: SpeechAccent;
  label?: string;
  className?: string;
}

const LABELS: Record<SpeechAccent, string> = { us: '美音', uk: '英音' };

/** 小喇叭按钮：点击播放单词发音（在线 edge-tts，失败回退浏览器语音）。 */
export default function SpeakerButton({
  word,
  accent,
  label,
  className = '',
}: SpeakerButtonProps) {
  const text = label ?? LABELS[accent];
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-md text-muted-soft hover:text-primary hover:bg-surface-card transition-colors flex-shrink-0 ${className}`}
      title={`${text} ${word}`}
      aria-label={`${text} ${word}`}
      onMouseEnter={() => prefetchSpeak(word, accent)}
      onTouchStart={() => prefetchSpeak(word, accent)}
      onClick={() => void speakWord(word, accent)}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M11 5 6 9H2v6h4l5 4V5z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        <path d="M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
    </button>
  );
}
