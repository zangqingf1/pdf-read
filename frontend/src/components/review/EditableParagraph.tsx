import { useRef, useEffect } from 'react';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';

export interface ParagraphData {
  cid: string;
  index: number;
  text_en: string;
  page_number: number | null;
}

interface EditableParagraphProps {
  paragraph: ParagraphData;
  isDirty: boolean;
  isLast: boolean;
  onChange: (index: number, text: string) => void;
  onDelete: (index: number) => void;
  onMergeDown: (index: number) => void;
  dragHandleListeners?: SyntheticListenerMap;
}

/** line-height: text-sm (0.875rem) × leading-relaxed (1.625) ≈ 22.75px per row */
const ROW_HEIGHT = 22.75;
const MAX_ROWS = 5;
const PADDING_Y = 16; // py-2 = 8px top + 8px bottom

export default function EditableParagraph({
  paragraph,
  isDirty,
  isLast,
  onChange,
  onDelete,
  onMergeDown,
  dragHandleListeners,
}: EditableParagraphProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Reset to auto so scrollHeight reflects the true content height
    el.style.height = 'auto';
    const maxH = ROW_HEIGHT * MAX_ROWS + PADDING_Y;
    el.style.height = Math.min(el.scrollHeight, maxH) + 'px';
  }, [paragraph.text_en]);

  return (
    <div
      className="mb-4 p-3 rounded-lg border transition-colors duration-200 bg-white"
      style={{
        borderColor: isDirty ? 'var(--primary)' : 'var(--hairline)',
        borderLeft: isDirty ? '3px solid var(--primary)' : '3px solid transparent',
        background: isDirty ? '#fdf3ef' : '#ffffff',
      }}
    >
      {/* Header row */}
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2">
          <span
            className="drag-handle inline-flex items-center text-base"
            {...dragHandleListeners}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" opacity="0.5">
              <circle cx="9" cy="5" r="2" />
              <circle cx="15" cy="5" r="2" />
              <circle cx="9" cy="12" r="2" />
              <circle cx="15" cy="12" r="2" />
              <circle cx="9" cy="19" r="2" />
              <circle cx="15" cy="19" r="2" />
            </svg>
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-pill text-xs font-medium bg-surface-card text-ink">
            段落 {paragraph.index + 1}
          </span>
          <span className="text-xs text-muted-soft">
            {paragraph.text_en.length} 字符
          </span>
        </div>

        <div className="flex items-center gap-1">
          {!isLast && (
            <button
              onClick={() => onMergeDown(paragraph.index)}
              className="w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-ink hover:bg-surface-card transition-colors"
              title="与下一段合并"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M8 10l4 4 4-4M8 18l4 4 4-4M8 2l4 4 4-4" />
              </svg>
            </button>
          )}
          <button
            onClick={() => onDelete(paragraph.index)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-soft hover:text-error hover:bg-error/5 transition-colors"
            title="删除此段落"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Text area — auto-grow up to 5 rows, then scroll */}
      <textarea
        ref={textareaRef}
        value={paragraph.text_en}
        onChange={(e) => onChange(paragraph.index, e.target.value)}
        className="w-full px-3 py-2 rounded-md border border-hairline text-sm font-sans text-ink bg-canvas leading-relaxed overflow-y-auto focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-colors"
        rows={1}
      />
    </div>
  );
}
