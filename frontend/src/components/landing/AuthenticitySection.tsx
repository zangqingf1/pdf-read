import Reveal from './Reveal';

const POINTS = [
  {
    title: '原文直达',
    desc: '上传完整 PDF 或粘贴原文链接，逐段还原正文。不删减，不改写。',
  },
  {
    title: '难度你定',
    desc: '觉得难就点词看解析、选句拆结构；觉得简单就关掉译文裸读。',
  },
  {
    title: '题材你选',
    desc: '科技、财经、评论、文学，你的兴趣就是教材。',
  },
];

export default function AuthenticitySection() {
  return (
    <section className="bg-canvas-soft/60">
      <div className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
        <div className="max-w-2xl">
          <Reveal>
            <h2 className="text-balance text-3xl font-semibold leading-snug tracking-tight text-ink md:text-4xl">
              你的阅读清单，
              <br />
              不该由别人代写
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-body">
              市面上的外刊课常把原文裁短、改写、替换生词。你读完的，
              其实是一篇被驯化的英语。在这里，选择权还给你。
            </p>
          </Reveal>
        </div>

        <div className="mt-14 divide-y divide-hairline border-t border-hairline">
          {POINTS.map((point, i) => (
            <Reveal key={point.title} delay={i * 0.08}>
              <div className="grid grid-cols-1 gap-3 py-8 md:grid-cols-12 md:gap-6">
                <h3 className="font-display text-2xl text-ink md:col-span-4">
                  {point.title}
                </h3>
                <p className="max-w-xl text-base leading-relaxed text-body md:col-span-7 md:col-start-6">
                  {point.desc}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.15}>
          <blockquote className="mt-16 max-w-2xl">
            <p className="font-display text-2xl italic leading-[1.35] text-muted-soft md:text-3xl">
              &ldquo;Read what the author wrote, not what the editor left
              behind.&rdquo;
            </p>
          </blockquote>
        </Reveal>
      </div>
    </section>
  );
}
