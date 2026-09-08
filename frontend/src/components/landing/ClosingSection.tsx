import { Link } from 'react-router-dom';
import Reveal from './Reveal';

export default function ClosingSection() {
  return (
    <>
      <section className="border-t border-hairline">
        <div className="mx-auto max-w-3xl px-5 py-28 text-center md:px-8 md:py-36">
          <Reveal>
            <h2 className="text-balance text-4xl font-semibold leading-snug tracking-tight text-ink md:text-5xl">
              真外刊，
              <span className="text-primary">自己挑</span>
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mt-5 text-base leading-relaxed text-body">
              第一篇，就从现在开始。
            </p>
          </Reveal>
          <Reveal delay={0.2}>
            <Link
              to="/register"
              className="mt-9 inline-flex items-center whitespace-nowrap rounded-full bg-primary px-8 py-3.5 text-sm font-medium text-on-primary shadow-soft transition-[background-color,transform] hover:bg-primary-active active:scale-[0.98]"
            >
              免费注册
            </Link>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-10 md:flex-row md:px-8">
          <p className="font-display text-lg font-semibold tracking-tight text-ink">
            Reader
          </p>
          <nav className="flex items-center gap-6 text-sm text-muted">
            <a href="#features" className="transition-colors hover:text-ink">
              功能
            </a>
            <a href="#workflow" className="transition-colors hover:text-ink">
              流程
            </a>
            <Link to="/login" className="transition-colors hover:text-ink">
              直接登录
            </Link>
          </nav>
          <p className="text-xs text-muted">2026 Reader</p>
        </div>
      </footer>
    </>
  );
}
