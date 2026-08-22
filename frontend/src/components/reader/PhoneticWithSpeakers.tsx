import type { SpeechAccent } from '../../services/ttsApi';
import { splitPhonetic } from '../../utils/phonetic';
import { useReaderStore } from '../../stores/readerStore';
import SpeakerButton from './SpeakerButton';

interface PhoneticWithSpeakersProps {
  word: string;
  phonetic: string;
  /** sm=桌面端小按钮, md=移动端大按钮（带 touch-area） */
  size?: 'sm' | 'md';
}

/** 按全局口音偏好展示单段音标 + 单个喇叭；所选口音缺失时回退另一口音，两者皆无则兜底原串。 */
export default function PhoneticWithSpeakers({
  word,
  phonetic,
  size = 'sm',
}: PhoneticWithSpeakersProps) {
  const accent = useReaderStore((s) => s.accent);
  const { br, am } = splitPhonetic(phonetic);

  let ipa: string | null;
  let playAccent: SpeechAccent;
  if (accent === 'us') {
    ipa = am ?? br;
    playAccent = am ? 'us' : 'uk';
  } else {
    ipa = br ?? am;
    playAccent = br ? 'uk' : 'us';
  }

  const btnClass = size === 'md' ? 'w-8 h-8 touch-area' : 'w-5 h-5';

  return (
    <span
      className="inline-flex items-center gap-x-2 gap-y-0.5 flex-wrap text-muted-soft"
      style={{ fontSize: '0.75em' }}
    >
      {ipa ? (
        <span className="inline-flex items-center gap-1">
          {ipa}
          <SpeakerButton word={word} accent={playAccent} className={btnClass} />
        </span>
      ) : (
        <span className="inline-flex items-center gap-1">
          {phonetic && <span>{phonetic}</span>}
          <SpeakerButton word={word} accent={accent} className={btnClass} />
        </span>
      )}
    </span>
  );
}
