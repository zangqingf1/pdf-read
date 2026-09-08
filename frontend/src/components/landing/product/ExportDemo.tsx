import { motion, useReducedMotion } from 'framer-motion';

const MARKED_WORD = 'rgba(201,236,212,1)';
const ACCENT = '#c87455';

const EXPORT_DATE = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date(2026, 7, 26));

export default function ExportDemo() {
  const reduce = useReducedMotion();
  return (
    <div className="flex justify-center">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 20, rotateX: 8 }}
        whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md"
        style={{ perspective: 1000 }}
      >
        <div
          className="bg-white"
          style={{
            padding: '28px 26px',
            boxShadow: '0 2px 16px rgba(0,0,0,0.12)',
            borderRadius: '3px',
          }}
        >
          <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-1.5">
            <span
              className="min-w-0 max-w-[70%] truncate font-medium text-ink"
              style={{ fontSize: '11px' }}
            >
              The Economist · 精读讲义
            </span>
            <span className="flex-shrink-0 text-muted" style={{ fontSize: '11px' }}>
              {EXPORT_DATE}
            </span>
          </div>

          <div className="mt-3 flex gap-4">
            <div className="min-w-0 flex-1">
              <p
                className="font-reading leading-relaxed text-ink"
                style={{ fontSize: '13px' }}
              >
                The magazine published a{' '}
                <span
                  style={{
                    backgroundColor: MARKED_WORD,
                    borderRadius: '2px',
                    padding: '0 1px',
                  }}
                >
                  candid
                </span>{' '}
                assessment of the global economy, warning that recovery remains
                fragile.
              </p>
              <p
                className="font-chinese leading-relaxed text-body"
                style={{
                  fontSize: '12px',
                  marginTop: '6px',
                  paddingLeft: '10px',
                  borderLeft: '2px solid ' + ACCENT,
                }}
              >
                该杂志对全球经济做出了一份坦率的评估，并警示复苏依然脆弱。
              </p>
            </div>

            <div className="w-[42%] flex-shrink-0">
              <p
                className="border-b border-hairline pb-1 font-medium uppercase tracking-wide text-muted"
                style={{ fontSize: '10px' }}
              >
                单词解析
              </p>
              <div
                className="mb-2 mt-2 rounded-md border border-hairline bg-surface-card p-2.5"
                style={{ fontSize: '11px' }}
              >
                <p className="m-0 font-reading font-bold text-ink" style={{ fontSize: '13px' }}>
                  candid <span className="font-normal text-muted">/ˈkændɪd/</span>
                </p>
                <p className="m-0 mt-0.5" style={{ color: '#3e6e4c' }}>
                  <span className="italic text-muted" style={{ fontSize: '10px' }}>
                    adj.
                  </span>{' '}
                  坦率的，直白的
                </p>
                <p className="m-0 mt-1" style={{ color: '#6c6a64' }}>
                  同义词{' '}
                  <span className="rounded border border-[#c8e6c9] bg-[#f0f7f1] px-1.5 py-0.5">
                    frank
                  </span>
                </p>
                <div className="mt-1 flex gap-1">
                  <span
                    className="inline-flex items-center rounded border border-[#eecdb5] bg-[#fdf1ea] px-2 py-0.5 font-medium leading-none text-[#b06a3d]"
                    style={{ fontSize: '10px' }}
                  >
                    考研
                  </span>
                  <span
                    className="inline-flex items-center rounded border border-[#cdbedd] bg-[#f0ebf5] px-2 py-0.5 font-medium leading-none text-[#7a5f92]"
                    style={{ fontSize: '10px' }}
                  >
                    GRE
                  </span>
                </div>
              </div>
            </div>
          </div>

          <p
            className="mt-3 border-t-2 border-hairline pt-2 text-muted"
            style={{ fontSize: '10px' }}
          >
            第 1 页 · 共 1 页
          </p>
        </div>
      </motion.div>
    </div>
  );
}
