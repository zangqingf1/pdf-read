import type { SpeechAccent } from '../../services/ttsApi';
import { splitPhonetic } from '../../utils/phonetic';
import SpeakerButton from './SpeakerButton';

interface PhoneticWithSpeakersProps {
  word: string;
  phonetic: string;
  /** sm=桌面端小按钮, md=移动端大按钮（带 touch-area） */
  size?: 'sm' | 'md';
}

const SEGMENTS: Array<{ accent: SpeechAccent; label: string; key: 'br' | 'am' }> = [
  { accent: 'uk', label: 'UK', key: 'br' },
  { accent: 'us', label: 'US', key: 'am' },
];

/** 音标分段展示（英音/美音），每段内联一个小喇叭按钮；音标缺失/异常时兜底两个喇叭。 */
export default function PhoneticWithSpeakers({
  word,
  phonetic,
  size = 'sm',
}: PhoneticWithSpeakersProps) {
  const { br, am } = splitPhonetic(phonetic);
  const hasSegment = !!(br || am);
  const btnClass = size === 'md' ? 'w-8 h-8 touch-area' : 'w-5 h-5';

  return (
    <span
      className="inline-flex items-center gap-x-2 gap-y-0.5 flex-wrap text-muted-soft"
      style={{ fontSize: '0.75em' }}
    >
      {SEGMENTS.map((seg) => {
        const ipa = seg.key === 'br' ? br : am;
        if (ipa) {
          return (
            <span key={seg.accent} className="inline-flex items-center gap-1">
              {seg.label} {ipa}
              <SpeakerButton word={word} accent={seg.accent} className={btnClass} />
            </span>
          );
        }
        return null;
      })}
      {!hasSegment && (
        <span className="inline-flex items-center gap-1">
          {phonetic && <span>{phonetic}</span>}
          {SEGMENTS.map((seg) => (
            <SpeakerButton
              key={seg.accent}
              word={word}
              accent={seg.accent}
              className={btnClass}
            />
          ))}
        </span>
      )}
    </span>
  );
}
