import Reveal from './Reveal';

export default function AudienceSection() {
  return (
    <section id="audience" className="scroll-mt-16">
      <div className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
        <Reveal>
            <h2 className="text-balance max-w-xl text-3xl font-semibold tracking-tight text-ink md:text-4xl">
            谁在用它读外刊
          </h2>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
          <Reveal
            className="md:col-span-2"
            delay={0}
          >
            <div className="flex h-full min-h-[220px] flex-col justify-between rounded-2xl border border-hairline bg-gradient-to-br from-primary/[0.08] to-accent-amber/[0.08] p-8">
              <p className="font-display text-2xl italic leading-snug text-ink">
                &ldquo;The Economist&rdquo; &ldquo;The Guardian&rdquo;
              </p>
              <div>
                <h3 className="mt-6 text-lg font-medium text-ink">外刊精读者</h3>
                <p className="mt-1 max-w-md text-sm leading-relaxed text-body">
                  整篇原文直读，一篇是一篇。不满足于二手节选的人，在这里读到作者写下的每一句。
                </p>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="flex h-full min-h-[220px] flex-col justify-between rounded-2xl border border-hairline bg-surface-card/60 p-8">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/12 font-display text-lg text-primary">
                考
              </span>
              <div>
                <h3 className="mt-6 text-lg font-medium text-ink">备考学生</h3>
                <p className="mt-1 text-sm leading-relaxed text-body">
                  考研、四六级、雅思托福材料，考纲词自动高亮，解析自动留存。
                </p>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.05}>
            <div className="flex h-full min-h-[200px] flex-col justify-between rounded-2xl border border-hairline p-8">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/12 font-display text-lg text-primary">
                讲
              </span>
              <div>
                <h3 className="mt-6 text-lg font-medium text-ink">英语教师</h3>
                <p className="mt-1 text-sm leading-relaxed text-body">
                  校对工作台快速整理讲义，导出即可印发。
                </p>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.15} className="md:col-span-2">
            <div className="flex h-full min-h-[200px] flex-col justify-between rounded-2xl border border-hairline bg-surface-overlay shadow-soft p-8 md:flex-row md:items-end md:justify-between md:gap-8">
              <div>
                <h3 className="text-lg font-medium text-ink">资讯读者</h3>
                <p className="mt-1 max-w-sm text-sm leading-relaxed text-body">
                  网页文章贴进来，母语式对照阅读，通勤路上手机也能精读。
                </p>
              </div>
              <p className="mt-4 shrink-0 font-display text-xl italic text-muted-soft md:mt-0">
                paste &amp; read
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
