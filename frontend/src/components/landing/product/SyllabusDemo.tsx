import { motion, useReducedMotion } from 'framer-motion';
import MiniReaderFrame from './MiniReaderFrame';

const SENTENCE =
  'A candid assessment of how households pinch every dollar during inflation.';

const HITS: Record<string, string[]> = {
  candid: ['GRE'],
  assessment: ['考研'],
  pinch: ['六级'],
  dollar: ['四级'],
};

export default function SyllabusDemo() {
  const reduce = useReducedMotion();
  const words = SENTENCE.split(' ');

  return (
    <MiniReaderFrame title="Financial Times">
      <p className="font-reading text-[15px] leading-relaxed text-ink">
        {words.map((w, i) => {
          const clean = w.replace(/[^a-zA-Z]/g, '');
          const tags = HITS[clean];
          if (!tags) return <span key={i}>{w} </span>;
          return (
            <span key={i} className="relative whitespace-nowrap">
              <motion.span
                initial={{ backgroundImage: 'none' }}
                whileInView={{
                  textDecoration: 'underline dashed #b45309',
                  textUnderlineOffset: '4px',
                  textDecorationThickness: '1.5px',
                }}
                viewport={{ once: true }}
                transition={{ delay: 0.5 + Object.keys(HITS).indexOf(clean) * 0.35, duration: 0.2 }}
                className="text-primary-active"
              >
                {w}
              </motion.span>{' '}
            </span>
          );
        })}
      </p>

      <motion.div
        initial={reduce ? false : { opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 2 }}
        className="mt-4 flex flex-wrap gap-1"
      >
        {Object.entries(HITS).flatMap(([, tags]) =>
          tags.map((t) => (
            <span
              key={t}
              className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium leading-none ${EXAM[t]}`}
            >
              {t}
            </span>
          )),
        )}
      </motion.div>
    </MiniReaderFrame>
  );
}

const EXAM: Record<string, string> = {
  初中: 'bg-[#eef7ee] border-[#bfe0bf] text-[#4a7c59]',
  高中: 'bg-[#eaf3ec] border-[#a9d4b2] text-[#3e6e4c]',
  四级: 'bg-[#eef4fa] border-[#bcd6ee] text-[#4a6d96]',
  六级: 'bg-[#e8eff8] border-[#a5c4e4] text-[#3d5f8a]',
  考研: 'bg-[#fdf1ea] border-[#eecdb5] text-[#b06a3d]',
  雅思: 'bg-[#f2eefa] border-[#d4c6ea] text-[#6f5a9e]',
  托福: 'bg-[#edeafa] border-[#c5bae8] text-[#5f4d94]',
  GRE: 'bg-[#f0ebf5] border-[#cdbedd] text-[#7a5f92]',
};
