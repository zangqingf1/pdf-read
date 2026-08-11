import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useDocumentStore } from '../../stores/documentStore';
import { useReaderStore, BG_COLORS } from '../../stores/readerStore';
import TypographyDrawer from './TypographyDrawer';
import Button from '../ui/Button';
import ExportButton from '../export/ExportButton';

export default function ReaderHeader() {
  const navigate = useNavigate();
  const { title } = useDocumentStore();
  const { bgColor } = useReaderStore();
  const bgColorValue = BG_COLORS.find(c => c.key === bgColor)?.value ?? BG_COLORS[0].value;
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <header
      className="sticky top-0 z-50 border-b border-hairline h-[52px] px-4 md:px-6 flex items-center justify-between flex-shrink-0 transition-colors duration-300"
      style={{ backgroundColor: bgColorValue }}
    >
      <div className="flex items-center gap-2 md:gap-6 min-w-0 flex-1">
        <Button
          variant="ghost"
          size="sm"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          }
          onClick={() => navigate('/')}
        >
          返回
        </Button>
        <h2 className="text-base font-display font-medium text-ink truncate max-w-[100px] md:max-w-md m-0">
          {title || 'Untitled'}
        </h2>
      </div>

      {/* Right: export + font size & typography (mobile only) */}
      <div className="flex items-center gap-0.5 md:gap-1 flex-shrink-0">
        <ExportButton />

        {/* Typography settings — mobile only */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="md:hidden w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-card transition-colors touch-area text-muted"
          title="排版设置"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>

      </div>

      <TypographyDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </header>
  );
}
