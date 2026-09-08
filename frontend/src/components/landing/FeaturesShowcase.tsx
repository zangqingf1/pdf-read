import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import Reveal from './Reveal';
import WordAnalysisDemo from './product/WordAnalysisDemo';
import TranslateDemo from './product/TranslateDemo';
import SyllabusDemo from './product/SyllabusDemo';
import TtsDemo from './product/TtsDemo';
import ExportDemo from './product/ExportDemo';

const EASE = [0.16, 1, 0.3, 1] as const;

const FEATURES = [
  {
    id: 'word',
    title: '点词即析',
    desc: '整段上下文里的音标、释义与同根词',
    demo: <WordAnalysisDemo />,
  },
  {
    id: 'translate',
    title: '对照翻译',
    desc: '中英逐段对照，译文可编辑校对',
    demo: <TranslateDemo />,
  },
  {
    id: 'syllabus',
    title: '考纲标注',
    desc: '八大考纲词自动高亮，离线判定',
    demo: <SyllabusDemo />,
  },
  {
    id: 'tts',
    title: '朗读跟读',
    desc: '词级卡拉OK高亮，英美双音',
    demo: <TtsDemo />,
  },
  {
    id: 'export',
    title: '导出 PDF',
    desc: '排版分页所见即所得，带注释讲义',
    demo: <ExportDemo />,
  },
];

export default function FeaturesShowcase() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const userClicked = useRef(false);

  useEffect(() => {
    if (reduce || paused) return;
    const timer = setInterval(() => {
      if (!userClicked.current) {
        setActive((a) => (a + 1) % FEATURES.length);
      }
      userClicked.current = false;
    }, 3000);
    return () => clearInterval(timer);
  }, [reduce, paused]);

  const moveTab = (dir: number) => {
    userClicked.current = true;
    setActive((a) => (a + dir + FEATURES.length) % FEATURES.length);
  };

  return (
    <section id="features" className="scroll-mt-16">
      <div className="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Reveal>
            <h2 className="text-balance max-w-xl text-3xl font-semibold tracking-tight text-ink md:text-4xl">
              精读需要的工具，
              <br />
              都在这一个页面里
            </h2>
          </Reveal>
          {!reduce && (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
              aria-label={paused ? '继续自动播放' : '暂停自动播放'}
              className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:text-ink"
            >
              <span aria-hidden="true">{paused ? '▶' : '❚❚'}</span>
              自动播放
            </button>
          )}
        </div>

        <div className="mt-14 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12">
          <div
            className="order-2 lg:order-1 lg:col-span-5"
            role="tablist"
            aria-label="功能演示"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                e.preventDefault();
                moveTab(1);
              } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                e.preventDefault();
                moveTab(-1);
              }
            }}
          >
            {FEATURES.map((feature, i) => (
              <button
                key={feature.id}
                id={`tab-${feature.id}`}
                role="tab"
                type="button"
                aria-selected={active === i}
                aria-controls="feature-panel"
                tabIndex={active === i ? 0 : -1}
                onClick={() => {
                  userClicked.current = true;
                  setActive(i);
                }}
                className={`group block w-full border-b border-hairline py-5 text-left transition-colors ${
                  active === i ? '' : 'opacity-70 hover:opacity-100'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p
                      className={`text-base font-medium transition-colors ${
                        active === i ? 'text-primary' : 'text-ink'
                      }`}
                    >
                      {feature.title}
                    </p>
                    <p className="mt-1 text-sm text-muted">{feature.desc}</p>
                  </div>
                  <motion.span
                    animate={{ opacity: active === i ? 1 : 0, x: active === i ? 0 : -8 }}
                    transition={{ duration: 0.35, ease: EASE }}
                    className="shrink-0 text-primary"
                    aria-hidden
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 9h10M10 5l4 4-4 4" />
                    </svg>
                  </motion.span>
                </div>
              </button>
            ))}
          </div>

          <div className="order-1 lg:order-2 lg:col-span-7">
            <AnimatePresence mode="wait">
              <motion.div
                key={FEATURES[active].id}
                id="feature-panel"
                role="tabpanel"
                aria-labelledby={`tab-${FEATURES[active].id}`}
                initial={reduce ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="flex w-full justify-center"
              >
                {FEATURES[active].demo}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
