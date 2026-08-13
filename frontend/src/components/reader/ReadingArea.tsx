import { useState } from 'react';
import { useDocumentStore } from '../../stores/documentStore';
import ParagraphBlock from './ParagraphBlock';
import DocumentSummary from './DocumentSummary';
import EditableTitle from './EditableTitle';
import type { AIProvider } from '../../services/translateApi';
import { useReaderStore, FONT_SIZE_MIN, FONT_SIZE_MAX } from '../../stores/readerStore';
import TypographyDrawer from './TypographyDrawer';
import { useAudioPlayerStore } from '../../stores/audioPlayerStore';
import { playFromParagraph, togglePlay } from '../../hooks/useParagraphAudioPlayer';

interface ReadingAreaProps {
  isTouchDevice?: boolean;
  /** 全文总结 — API Key 守卫透传 */
  apiKey?: string | null;
  onRequireApiKey?: () => void;
  provider?: AIProvider;
}

export default function ReadingArea({
  isTouchDevice = false,
  apiKey = null,
  onRequireApiKey,
  provider = 'deepseek',
}: ReadingAreaProps) {
  const {
    titleZh,
    paragraphs,
    wordCount,
    paragraphCount,
    pageCount,
    selectedPages,
    translations,
    isTranslating,
  } = useDocumentStore();
  const { fontSize, increaseFontSize, decreaseFontSize } = useReaderStore();
  const playerStatus = useAudioPlayerStore((s) => s.status);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const translatedCount = Object.keys(translations).length;
  const total = paragraphCount || paragraphs.length;

  return (
    <div>
      {/* ── Document header ── */}
      <div className="hidden md:block mb-10 pb-6 border-b border-hairline">
        <EditableTitle headingClassName="text-display-md font-display text-ink mb-1" />
        {titleZh && (
          <p className="text-lg font-display text-body mb-2">
            {titleZh}
          </p>
        )}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4 text-sm text-muted">
            <span className="flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M16 2v4h4M14 2v6h6" />
              </svg>
              {total} 段落
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              {wordCount?.toLocaleString() || '—'} 词
            </span>
            {selectedPages && selectedPages.length > 0 && (
              <span>
                页面 {selectedPages.sort((a, b) => a - b).join(', ')}
              </span>
            )}
            {(!selectedPages || selectedPages.length === 0) && pageCount && (
              <span>{pageCount} 页</span>
            )}
            {isTranslating && (
              <span className="flex items-center gap-1.5 text-primary">
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
                  <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" opacity="0.75" />
                </svg>
                翻译中 ({translatedCount}/{total})
              </span>
            )}
            {!isTranslating && translatedCount > 0 && translatedCount < total && (
              <span>已翻译 {translatedCount}/{total} 段</span>
            )}
          </div>

          {/* Font size & typography controls */}
          <div className="flex items-center gap-1 text-sm text-muted">
            <button
              onClick={() => {
                if (playerStatus === 'idle') {
                  const first = [...paragraphs].sort((a, b) => a.index - b.index)[0];
                  if (first) void playFromParagraph(first.index);
                } else {
                  togglePlay();
                }
              }}
              className="h-8 px-2 flex items-center gap-1.5 rounded-md hover:bg-surface-card transition-colors touch-area text-primary"
              title="朗读全文（点击从第一句开始）"
            >
              {playerStatus === 'loading' ? (
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
                  <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" opacity="0.75" />
                </svg>
              ) : playerStatus === 'playing' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 18V6M15 18V6" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" />
                  <path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" />
                </svg>
              )}
              <span className="text-xs">{playerStatus === 'idle' ? '朗读' : playerStatus === 'playing' ? '暂停' : '继续'}</span>
            </button>
            <div className="w-px h-5 bg-hairline mx-0.5" />
            <button
              onClick={decreaseFontSize}
              disabled={fontSize <= FONT_SIZE_MIN}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-card disabled:opacity-30 transition-colors touch-area"
              title="缩小字体"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14" />
              </svg>
            </button>
            <span className="min-w-[36px] text-center text-xs">{fontSize}px</span>
            <button
              onClick={increaseFontSize}
              disabled={fontSize >= FONT_SIZE_MAX}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-card disabled:opacity-30 transition-colors touch-area"
              title="放大字体"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <div className="w-px h-5 bg-hairline mx-0.5" />
            <button
              onClick={() => setDrawerOpen(true)}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-card transition-colors touch-area"
              title="排版设置"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </button>
          </div>
          <TypographyDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        </div>
      </div>

      {/* ── Paragraphs ── */}
      <div>
        {paragraphs.map((para, idx) => (
          <ParagraphBlock
            key={idx}
            paragraph={para}
            translation={translations[para.index]}
            isTranslating={isTranslating}
            isTouchDevice={isTouchDevice}
          />
        ))}
      </div>

      {/* ── 全文总结（文末）── */}
      <DocumentSummary
        apiKey={apiKey}
        onRequireApiKey={onRequireApiKey ?? (() => {})}
        provider={provider}
      />
    </div>
  );
}
