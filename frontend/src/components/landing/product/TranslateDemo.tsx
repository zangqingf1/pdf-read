import { motion, useReducedMotion } from 'framer-motion';
import MiniReaderFrame from './MiniReaderFrame';

const PARAGRAPHS = [
  'Inflation is cooling, yet households still feel the pinch of higher prices at the grocery counter.',
  'Central banks signal patience, but the path back to stable prices remains uncertain for many families.',
];

export default function TranslateDemo() {
  const reduce = useReducedMotion();
  const zh = [
    '通胀正在降温，但家庭在杂货柜台仍能感受到物价上涨的压力。',
    '央行释放出耐心的信号，但对许多家庭而言，回归价格稳定的道路仍不明朗。',
  ];

  return (
    <MiniReaderFrame title="The Guardian">
      <div className="space-y-4">
        {PARAGRAPHS.map((p, i) => (
          <div key={i}>
            <p className="font-reading text-[15px] leading-relaxed text-ink">{p}</p>
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ duration: 0.5, delay: 0.5 + i * 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="not-prose mt-2"
            >
              <div className="border-l-[3px] border-primary py-0.5 pl-3">
                <span className="font-chinese text-[14px] leading-relaxed text-body">
                  {zh[i]}
                </span>
              </div>
            </motion.div>
          </div>
        ))}
      </div>
    </MiniReaderFrame>
  );
}
