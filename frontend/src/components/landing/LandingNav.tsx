import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useScroll, useMotionValueEvent } from 'framer-motion';

const NAV_LINKS = [
  { label: '功能', href: '#features' },
  { label: '流程', href: '#workflow' },
  { label: '适合谁', href: '#audience' },
];

export default function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, 'change', (v) => {
    setScrolled(v > 24);
  });

  return (
    <motion.header
      initial={{ y: -64 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={`sticky top-0 z-40 border-b transition-colors duration-300 ${
        scrolled
          ? 'border-hairline bg-canvas/85 backdrop-blur-md'
          : 'border-transparent bg-transparent'
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:px-8">
        <Link to="/welcome" className="flex items-baseline gap-2">
          <span className="font-display text-xl font-semibold tracking-tight text-ink">
            Reader
          </span>
          <span className="text-sm text-muted">AI 外刊精读</span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-body transition-colors hover:text-ink"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="rounded-full px-4 py-2 text-sm font-medium text-body transition-colors hover:text-ink"
          >
            直接登录
          </Link>
          <Link
            to="/register"
              className="inline-flex items-center whitespace-nowrap rounded-full bg-primary px-5 py-2 text-sm font-medium text-on-primary shadow-soft transition-[background-color,transform] hover:bg-primary-active active:scale-[0.98]"
          >
            免费注册
          </Link>
        </div>
      </nav>
    </motion.header>
  );
}
