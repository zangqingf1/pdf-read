import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import MiniReaderFrame from './MiniReaderFrame';

const SENTENCE =
  'Every sentence can be read aloud, word by word, at your own pace.';

export default function TtsDemo() {
  const reduce = useReducedMotion();
  const tokens = SENTENCE.split(' ');
  const [idx, setIdx] = useState(reduce ? -1 : 0);
  const [time, setTime] = useState('0:00');

  useEffect(() => {
    if (reduce) return;
    let current = 0;
    const timer = setInterval(() => {
      current += 1;
      if (current >= tokens.length) current = 0;
      setIdx(current);
      setTime(`0:0${Math.max(1, current + 1)}`);
    }, 480);
    return () => clearInterval(timer);
  }, [reduce, tokens.length]);

  const progress = ((idx + 1) / tokens.length) * 100;

  return (
    <MiniReaderFrame title="The Atlantic" audio="playing" progress={progress} time={time} duration="0:09">
      <p className="font-reading text-[15px] leading-loose text-body">
        {tokens.map((w, i) => (
          <span
            key={i}
            className="rounded-sm px-0.5"
            style={
              i === idx
                ? {
                    backgroundColor: 'rgba(200,116,85,0.35)',
                    boxShadow: '0 0 0 1.5px rgba(200,116,85,0.6)',
                    color: '#141413',
                  }
                : undefined
            }
          >
            {w}{' '}
          </span>
        ))}
      </p>
    </MiniReaderFrame>
  );
}
