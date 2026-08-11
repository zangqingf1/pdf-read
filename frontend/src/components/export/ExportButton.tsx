/**
 * 阅读页顶栏「导出 PDF」入口按钮。
 * 桌面显示文字按钮，移动端图标按钮；点击打开导出设置弹窗。
 */
import { useState } from 'react';
import ExportSettingsModal from './ExportSettingsModal';

export default function ExportButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* 桌面端：文字按钮 */}
      <button
        onClick={() => setOpen(true)}
        className="hidden md:inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-sm text-muted hover:text-ink hover:bg-surface-card transition-colors"
        title="导出 PDF"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
        导出 PDF
      </button>

      {/* 移动端：图标按钮 */}
      <button
        onClick={() => setOpen(true)}
        className="md:hidden w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-card transition-colors touch-area text-muted"
        title="导出 PDF"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
      </button>

      <ExportSettingsModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
