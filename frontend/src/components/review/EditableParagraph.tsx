import { useRef, useEffect, useState, memo } from 'react';

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
  /** 点击段落 → 定位到 PDF 预览中对应解析框 */
  onSelect: (index: number) => void;
  /** 点击解析框后本段闪烁高亮；stamp 递增用于重放动画 */
  flash: { index: number; stamp: number } | null;
}

/** 悬浮联动：本段 hover → 对应 PDF 解析框填充高亮（DOM class 直连，
 *  不经 React 状态，hover 不再触发整页重渲染） */
function toggleBoxHover(index: number, on: boolean): void {
  document
    .querySelector(`[data-layout-box-index="${index}"]`)
    ?.classList.toggle('layout-box-hover', on);
}

const EditableParagraph = memo(function EditableParagraph({
  paragraph,
  isDirty,
  isLast,
  onChange,
  onDelete,
  onMergeDown,
  onSelect,
  flash,
}: EditableParagraphProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(false);

  const isFlashing = flash?.index === paragraph.index;
  const flashStamp = flash?.stamp ?? 0;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Reset to auto so scrollHeight reflects the true content height
    el.style.height = 'auto';
    // 编辑框高度 = 全部内容高度（不设行数上限），切换编辑态时
    // 框始终能刚好包含所有文字，不会因滚动条而“缩小”
    el.style.height = el.scrollHeight + 'px';
  }, [paragraph.text_en, editing]);

  // 段落内容被外部修改（如删除/合并后重排）时退出编辑态
  useEffect(() => {
    setEditing(false);
  }, [paragraph.cid]);

  const handleEnter = () => {
    toggleBoxHover(paragraph.index, true);
  };

  // 移动到本段内部（如操作条）不算离开；移动到别处/窗口外才清除
  const handleLeave = (e: React.MouseEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (related && related.closest(`[data-paragraph-index="${paragraph.index}"]`)) {
      return;
    }
    toggleBoxHover(paragraph.index, false);
  };

  return (
    <div
      className="relative group transition-colors duration-150"
      data-paragraph-index={paragraph.index}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {/* 蓝色线框：直角细线（1px 实线，无圆角/无光晕）。
          z-10 保证绘制在段落内容（textarea/文本）之上不被遮挡；
          悬浮时显示；编辑态常驻显示（不依赖 hover）。 */}
      <div
        className={`absolute inset-0 z-10 pointer-events-none transition-opacity duration-150 ${
          editing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        style={{ boxShadow: '0 0 0 1px #3b82f6' }}
      />

      {editing ? (
        <textarea
          ref={textareaRef}
          value={paragraph.text_en}
          onChange={(e) => onChange(paragraph.index, e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setEditing(false);
            }
          }}
          autoFocus
          className="w-full px-3 py-2 rounded-md border border-transparent text-sm font-sans text-ink bg-canvas leading-relaxed overflow-y-auto focus:outline-none transition-colors"
          rows={2}
        />
      ) : (
        <div
          // key 含 flashStamp：同一段落被多次点击时 key 变化 → 重挂载 → 动画重放
          key={isFlashing ? `flash-${flashStamp}` : 'static'}
          className={`px-3 py-2 text-sm font-sans text-ink leading-relaxed whitespace-pre-wrap break-words rounded-md cursor-pointer transition-colors ${
            isDirty ? 'bg-primary/5' : ''
          } ${isFlashing ? 'review-paragraph-flash' : ''}`}
          onDoubleClick={() => setEditing(true)}
          onClick={() => onSelect(paragraph.index)}
        >
          {paragraph.text_en}
        </div>
      )}

      {/* 悬浮操作条（图标，无文字）—— 显示在段落下方居中。
          CSS group-hover 控制显隐：鼠标移到操作条（本段子元素）时
          group:hover 仍成立，操作条不会消失，可正常点击。
          mt-0 紧贴段落底部，避免段落与操作条之间的空隙导致
          :hover 中断（否则鼠标一进空隙操作条就消失、点不到）。
          left-1/2 -translate-x-1/2 实现水平居中。 */}
      {/* 阻止 mousedown 把焦点从 textarea 移走：否则点击确认按钮时
          onBlur 先触发 setEditing(false) 重渲染，按钮变回铅笔，随后的
          click 落在铅笔按钮上又进入编辑，造成「点确认不退出」。 */}
      <div
        className="absolute top-full left-1/2 -translate-x-1/2 mt-0 z-30 hidden group-hover:flex items-center gap-0.5 rounded-lg bg-surface-elevated border border-hairline shadow-pop px-1 py-0.5"
        onMouseDown={(e) => e.preventDefault()}
      >
        {/* 编辑态：确认按钮；非编辑态：修订（编辑）按钮 */}
        {editing ? (
          <button
            onClick={() => setEditing(false)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-ink hover:bg-surface-card transition-colors"
            title="确认（完成编辑）"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </button>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-ink hover:bg-surface-card transition-colors"
            title="修订（编辑此段）"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </button>
        )}
        {!isLast && (
          <button
            onClick={() => onMergeDown(paragraph.index)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-ink hover:bg-surface-card transition-colors"
            title="与下一段合并"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 10l4 4 4-4M8 18l4 4 4-4M8 2l4 4 4-4" />
            </svg>
          </button>
        )}
        <button
          onClick={() => onDelete(paragraph.index)}
          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-soft hover:text-error hover:bg-error/5 transition-colors"
          title="删除此段落"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
      </div>
    </div>
  );
});

export default EditableParagraph;
