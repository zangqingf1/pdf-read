import { useEffect, useRef, useState } from 'react';
import { EXAM_TAGS } from '../../constants/examTags';
import { useReaderStore } from '../../stores/readerStore';

/**
 * 考纲标签显隐设置弹层 — 复选框选择要展示的标签。
 * 设置持久化在 readerStore（localStorage），阅读页解析面板与单词本页共用。
 */
export default function ExamTagFilterPopover({ align = 'right' }: { align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const visibleExamTags = useReaderStore((s) => s.visibleExamTags);
  const toggleExamTag = useReaderStore((s) => s.toggleExamTag);
  const setAllExamTagsVisible = useReaderStore((s) => s.setAllExamTagsVisible);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const allSelected = visibleExamTags.length === EXAM_TAGS.length;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded transition-colors ${
          open ? 'bg-surface-card text-ink' : 'text-muted-soft hover:text-ink hover:bg-surface-card'
        }`}
        title="考纲标签显示设置"
        aria-label="考纲标签显示设置"
        aria-expanded={open}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
          <circle cx="7" cy="7" r="1" fill="currentColor" stroke="none" />
        </svg>
        标签
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-1 w-44 bg-surface-card border border-hairline rounded-lg shadow-lg p-3 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-ink">显示考纲标签</span>
            <button
              onClick={() =>
                setAllExamTagsVisible(allSelected ? [] : EXAM_TAGS.map((t) => t.label))
              }
              className="text-[11px] text-primary hover:underline"
            >
              {allSelected ? '全不选' : '全选'}
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {EXAM_TAGS.map((t) => {
              const checked = visibleExamTags.includes(t.label);
              return (
                <label
                  key={t.label}
                  className="flex items-center gap-2 cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleExamTag(t.label)}
                    className="accent-[var(--primary)] w-3.5 h-3.5"
                  />
                  <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none ${t.className}`}>
                    {t.label}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
