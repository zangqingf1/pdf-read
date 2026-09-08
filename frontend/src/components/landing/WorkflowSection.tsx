import { motion, useReducedMotion } from 'framer-motion';
import Reveal from './Reveal';

const STEPS = [
  {
    verb: '导入',
    desc: '拖入文件或粘贴链接。PDF 可先看缩略图，勾选页码再解析。',
  },
  {
    verb: '精读',
    desc: '正文自动分段呈现。点词、选句、看翻译、听朗读，难点随手解析。',
  },
  {
    verb: '沉淀',
    desc: '解析自动保存。导出带注释的学习版 PDF，随时回来复习。',
  },
];

export default function WorkflowSection() {
  const reduce = useReducedMotion();

  return (
    <section id="workflow" className="scroll-mt-16 border-y border-hairline bg-canvas-soft/60">
      <div className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
        <Reveal>
            <h2 className="text-balance max-w-xl text-3xl font-semibold tracking-tight text-ink md:text-4xl">
            三步，开始一篇精读
          </h2>
        </Reveal>

        <div className="relative mt-16">
          <motion.div
            aria-hidden
            initial={reduce ? false : { scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
            style={{ originX: 0 }}
            className="absolute left-[27px] top-[27px] hidden h-px w-[calc(100%-120px)] bg-primary/40 md:block"
          />
          <div className="grid grid-cols-1 gap-12 md:grid-cols-3 md:gap-8">
            {STEPS.map((step, i) => (
              <Reveal key={step.verb} delay={i * 0.15}>
                <div className="flex gap-5 md:block">
                  <span className="relative z-10 inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-hairline-strong bg-canvas font-display text-xl text-primary">
                    {i + 1}
                  </span>
                  <div className="md:mt-6">
                    <h3 className="text-lg font-medium text-ink">{step.verb}</h3>
                    <p className="mt-2 max-w-xs text-sm leading-relaxed text-body">
                      {step.desc}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
