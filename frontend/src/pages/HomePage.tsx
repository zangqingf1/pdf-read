import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import PDFUploader from '../components/home/PDFUploader';
import RecentDocuments from '../components/home/RecentDocuments';
import ApiKeyModal from '../components/common/ApiKeyModal';
import UserMenu from '../components/common/UserMenu';
import Button from '../components/ui/Button';

export default function HomePage() {
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);
  const [isSelecting, setIsSelecting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const resumeTaskId = searchParams.get('resume');

  const handleResumed = useCallback(() => {
    searchParams.delete('resume');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleDocumentChanged = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="h-screen bg-canvas flex flex-col">
      {/* ── Top Navigation ── */}
      <header className="flex items-center justify-between h-[52px] px-4 md:px-6 bg-canvas border-b border-hairline">
        <div className="flex items-center gap-3">
          {/* Hamburger button — mobile only */}
          <button
            className="md:hidden w-10 h-10 flex items-center justify-center rounded-md hover:bg-surface-card transition-colors touch-area"
            onClick={() => setSidebarOpen(true)}
            aria-label="打开侧边栏"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </button>
          {/* Book icon — simple SVG */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
          </svg>
          <h1 className="text-base font-display font-medium text-ink tracking-tight m-0">
            外刊阅读
          </h1>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setShowApiKeyModal(true)}>
            API 配置
          </Button>
        </div>
      </header>

      {/* ── Mobile sidebar backdrop ── */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/30 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Main Content: sidebar + center ── */}
      <main className="flex-1 flex overflow-hidden">
        {/* ── Left Sidebar: Recent Documents ── */}
        <aside
          className={[
            'flex-shrink-0 border-r border-hairline bg-[#f8f5ef] flex flex-col transition-transform duration-300',
            // Mobile: fixed overlay
            'fixed inset-y-0 left-0 z-50 w-[280px] shadow-xl',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
            // Desktop: persistent column
            'md:relative md:w-[250px] md:z-auto md:shadow-none md:translate-x-0',
          ].join(' ')}
        >
          {/* Close button — mobile only */}
          <div className="md:hidden flex items-center justify-between px-5 pt-4 pb-2 flex-shrink-0">
            <h3 className="text-sm font-sans font-semibold text-muted tracking-wide uppercase">
              最近阅读
            </h3>
            <button
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-card transition-colors touch-area"
              onClick={() => setSidebarOpen(false)}
              aria-label="关闭侧边栏"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="hidden md:block px-5 pt-5 pb-3 flex-shrink-0">
            <h3 className="text-sm font-sans font-semibold text-muted tracking-wide uppercase">
              最近阅读
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-4">
            <RecentDocuments refreshKey={refreshKey} sidebar />
          </div>
          {/* User info at bottom of sidebar */}
          <div className="px-3 py-3 border-t border-hairline flex-shrink-0">
            <UserMenu />
          </div>
        </aside>

        {/* ── Center: Upload + Hero ── */}
        <div className={isSelecting ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'flex-1 overflow-y-auto'}>
          <div className={isSelecting ? 'min-h-0 flex-1 flex flex-col' : 'max-w-2xl mx-auto px-4 md:px-8 py-8 md:py-12 w-full'}>
            {/* Hero section */}
            {!isSelecting && !resumeTaskId && (
              <div className="text-center mb-12">
                <h2 className="text-display-md font-display text-ink mb-3">
                  上传文档或粘贴链接，即刻阅读
                </h2>
                <p className="text-base text-muted max-w-md mx-auto">
                  导入英文文档或网页链接，自动提取正文内容，AI 翻译 + 单词解析 + 语意块拆分，纯净阅读体验
                </p>
              </div>
            )}

            {/* Upload area */}
            <PDFUploader
              resumeTaskId={resumeTaskId}
              onResumed={handleResumed}
              onDocumentChanged={handleDocumentChanged}
              onSelectionChange={setIsSelecting}
            />
          </div>
        </div>
      </main>

      <ApiKeyModal
        open={showApiKeyModal}
        onClose={() => setShowApiKeyModal(false)}
      />
    </div>
  );
}
