import { Link } from 'react-router-dom';
import ReaderPreview from './ReaderPreview';

export default function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-[-10%] h-[480px] w-[480px] rounded-full bg-primary/[0.07] blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-20%] left-[-8%] h-[380px] w-[380px] rounded-full bg-accent-amber/[0.08] blur-3xl"
      />

      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-5 pb-20 pt-16 md:px-8 md:pt-24 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-6">
          <h1 className="text-balance text-5xl font-semibold leading-[1.15] tracking-tight text-ink md:text-6xl">
            真外刊，
            <span className="text-primary">自己挑</span>
          </h1>

          <p className="mt-6 max-w-md text-base leading-relaxed text-body md:text-lg">
            上传 PDF 或粘贴链接，读你想读的原刊原文。AI
            帮你逐段翻译、解析单词与长难句。
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              to="/register"
              className="inline-flex items-center whitespace-nowrap rounded-full bg-primary px-7 py-3 text-sm font-medium text-on-primary shadow-soft transition-[background-color,transform] hover:bg-primary-active active:scale-[0.98]"
            >
              免费注册
            </Link>
            <a
              href="#features"
              className="inline-flex items-center whitespace-nowrap rounded-full border border-hairline-strong px-7 py-3 text-sm font-medium text-body transition-colors hover:border-muted hover:text-ink"
            >
              看看怎么用
            </a>
          </div>
        </div>

        <div className="flex justify-center lg:col-span-6 lg:justify-end lg:pr-4">
          <ReaderPreview />
        </div>
      </div>
    </section>
  );
}
