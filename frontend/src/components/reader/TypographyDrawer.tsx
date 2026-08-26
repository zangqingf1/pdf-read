import { useEffect, useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReaderStore, BG_COLORS, FONT_FAMILIES, LINE_HEIGHTS, ACCENTS, TEXT_ALIGNS, FONT_SIZE_MIN, FONT_SIZE_MAX, WORD_PANEL_FONT_SIZE_MIN, WORD_PANEL_FONT_SIZE_MAX } from '../../stores/readerStore';
import { EXAM_TAGS } from '../../constants/examTags';

interface TypographyDrawerProps {
  open: boolean;
  onClose: () => void;
}

const CLOSE_ANIM_MS = 300;

export default function TypographyDrawer({ open, onClose }: TypographyDrawerProps) {
  const {
    bgColor, fontFamily, lineHeight,
    fontSize, increaseFontSize, decreaseFontSize,
    wordPanelFontSize, increaseWordPanelFontSize, decreaseWordPanelFontSize,
    setBgColor, setFontFamily, setLineHeight,
    textAlign, setTextAlign,
    accent, setAccent,
    syllabusTags, toggleSyllabusTag,
  } = useReaderStore();
  const overlayRef = useRef<HTMLDivElement>(null);

  // ── 两阶段渲染：先播放滑出动画，动画结束再卸载 ──
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
    } else if (rendered) {
      setClosing(true);
      const t = setTimeout(() => {
        setRendered(false);
        setClosing(false);
      }, CLOSE_ANIM_MS);
      return () => clearTimeout(t);
    }
  }, [open, rendered]);

  const handleClose = useCallback(() => {
    if (!closing) onClose();
  }, [closing, onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    },
    [handleClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, handleKeyDown]);

  // 背景滚动锁定跟随 rendered（关闭动画期间保持锁定，动画结束卸载后才恢复），
  // 并用 paddingRight 补偿滚动条宽度，避免开合时整页位移/闪动。
  useEffect(() => {
    if (!rendered) return;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = '';
    };
  }, [rendered]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) handleClose();
  };

  if (!rendered) return null;

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className={`fixed inset-0 z-50 flex justify-end bg-black/20 ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
    >
      <div className={`w-[320px] h-full bg-surface-overlay shadow-elevated flex flex-col overflow-hidden ${closing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline-soft shrink-0">
          <h3 className="text-lg font-display font-medium text-ink">阅读排版</h3>
          <button
            onClick={handleClose}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-muted hover:text-ink hover:bg-surface-card transition-colors"
            aria-label="关闭"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* ── Text Font Size ── */}
          <section>
            <h4 className="text-xs font-medium text-muted-soft uppercase tracking-wide mb-3">文本字号</h4>
            <div className="flex items-center gap-3">
              <button
                onClick={decreaseFontSize}
                disabled={fontSize <= FONT_SIZE_MIN}
                className="w-10 h-10 flex items-center justify-center rounded-lg border border-hairline hover:bg-surface-card disabled:opacity-30 transition-colors touch-area"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14" /></svg>
              </button>
              <span className="text-lg font-medium text-ink min-w-[48px] text-center tabular-nums">{fontSize}px</span>
              <button
                onClick={increaseFontSize}
                disabled={fontSize >= FONT_SIZE_MAX}
                className="w-10 h-10 flex items-center justify-center rounded-lg border border-hairline hover:bg-surface-card disabled:opacity-30 transition-colors touch-area"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
              </button>
            </div>
          </section>

          {/* ── Analysis Font Size ── */}
          <section>
            <h4 className="text-xs font-medium text-muted-soft uppercase tracking-wide mb-3">解析字号</h4>
            <div className="flex items-center gap-3">
              <button
                onClick={decreaseWordPanelFontSize}
                disabled={wordPanelFontSize <= WORD_PANEL_FONT_SIZE_MIN}
                className="w-10 h-10 flex items-center justify-center rounded-lg border border-hairline hover:bg-surface-card disabled:opacity-30 transition-colors touch-area"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14" /></svg>
              </button>
              <span className="text-lg font-medium text-ink min-w-[48px] text-center tabular-nums">{wordPanelFontSize}px</span>
              <button
                onClick={increaseWordPanelFontSize}
                disabled={wordPanelFontSize >= WORD_PANEL_FONT_SIZE_MAX}
                className="w-10 h-10 flex items-center justify-center rounded-lg border border-hairline hover:bg-surface-card disabled:opacity-30 transition-colors touch-area"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
              </button>
            </div>
          </section>

          {/* ── Background Color ── */}
          <section>
            <h4 className="text-xs font-medium text-muted-soft uppercase tracking-wide mb-3">背景色</h4>
            <div className="flex items-center gap-3">
              {BG_COLORS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setBgColor(c.key)}
                  className={`w-7 h-7 rounded-full border transition-all duration-150 hover:scale-110 ${
                    bgColor === c.key
                      ? 'ring-2 ring-primary ring-offset-2 border-primary'
                      : 'border-hairline hover:border-muted-soft'
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.label}
                  aria-label={c.label}
                />
              ))}
            </div>
          </section>

          {/* ── Font Family ── */}
          <section>
            <h4 className="text-xs font-medium text-muted-soft uppercase tracking-wide mb-3">字体</h4>
            <div className="space-y-2">
              {FONT_FAMILIES.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFontFamily(f.key)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg border transition-all duration-150 text-left ${
                    fontFamily === f.key
                      ? 'border-primary bg-surface-card'
                      : 'border-hairline hover:border-muted-soft hover:bg-canvas-soft'
                  }`}
                >
                  <span
                    className="text-xl leading-none text-ink w-10 h-10 flex items-center justify-center rounded-md bg-canvas-soft shrink-0"
                    style={{ fontFamily: f.value }}
                  >
                    Ag
                  </span>
                  <span className="text-sm text-body-strong">{f.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* ── Accent ── */}
          <section>
            <h4 className="text-xs font-medium text-muted-soft uppercase tracking-wide mb-3">发音口音</h4>
            <div className="flex gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.key}
                  onClick={() => setAccent(a.key)}
                  className={`flex-1 px-2 py-2 rounded-md text-sm border transition-all duration-150 ${
                    accent === a.key
                      ? 'border-primary bg-surface-card text-primary font-medium'
                      : 'border-hairline text-body hover:border-muted-soft hover:bg-canvas-soft'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-soft">音标与朗读仅使用所选口音</p>
          </section>

          {/* ── Line Height ── */}
          <section>
            <h4 className="text-xs font-medium text-muted-soft uppercase tracking-wide mb-3">行距</h4>
            <div className="flex gap-2">
              {LINE_HEIGHTS.map((l) => (
                <button
                  key={l.key}
                  onClick={() => setLineHeight(l.key)}
                  className={`flex-1 px-2 py-2 rounded-md text-sm border transition-all duration-150 ${
                    lineHeight === l.key
                      ? 'border-primary bg-surface-card text-primary font-medium'
                      : 'border-hairline text-body hover:border-muted-soft hover:bg-canvas-soft'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </section>

          {/* ── Text Align ── */}
          <section>
            <h4 className="text-xs font-medium text-muted-soft uppercase tracking-wide mb-3">对齐方式</h4>
            <div className="flex gap-2">
              {TEXT_ALIGNS.map((a) => (
                <button
                  key={a.key}
                  onClick={() => setTextAlign(a.key)}
                  className={`flex-1 px-2 py-2 rounded-md text-sm border transition-all duration-150 ${
                    textAlign === a.key
                      ? 'border-primary bg-surface-card text-primary font-medium'
                      : 'border-hairline text-body hover:border-muted-soft hover:bg-canvas-soft'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-soft">两端对齐只拉伸占满的行，段落末行保持左对齐</p>
          </section>

          {/* ── 考纲标注（阅读页高亮，与解析卡片的标签显隐过滤相互独立）── */}
          <section>
            <h4 className="text-xs font-medium text-muted-soft uppercase tracking-wide mb-3">考纲标注</h4>
            <div className="flex flex-wrap gap-2">
              {EXAM_TAGS.map((t) => {
                const active = syllabusTags.includes(t.label);
                return (
                  <button
                    key={t.label}
                    onClick={() => toggleSyllabusTag(t.label)}
                    aria-pressed={active}
                    className={`px-2.5 py-1.5 rounded-md text-xs border transition-all duration-150 ${
                      active
                        ? `${t.className} font-medium ring-1 ring-primary`
                        : 'border-hairline text-body hover:border-muted-soft hover:bg-canvas-soft'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted-soft">
              在正文中用虚线下划线标出所选考纲的单词，可多选；全不选则不标注
            </p>
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}
