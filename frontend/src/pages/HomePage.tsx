import { useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PDFUploader from '../components/home/PDFUploader';
import RecentDocuments from '../components/home/RecentDocuments';
import DailyQuote from '../components/home/DailyQuote';
import HomeSidebar, { type HomeNavKey } from '../components/home/HomeSidebar';
import ApiKeyModal from '../components/common/ApiKeyModal';
import Modal from '../components/ui/Modal';

export default function HomePage() {
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [showAllDocs, setShowAllDocs] = useState(false);
  const [activeNav, setActiveNav] = useState<Exclude<HomeNavKey, 'recent'>>('home');
  const [searchParams, setSearchParams] = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);
  const [isSelecting, setIsSelecting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const resumeTaskId = searchParams.get('resume');

  const handleResumed = useCallback(() => {
    searchParams.delete('resume');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleDocumentChanged = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleSidebarNavigate = useCallback((key: HomeNavKey) => {
    // 首页 ↔ 我的收藏：切换侧边栏下方面板内容（移动端抽屉保持打开）；「查看全部」仍走弹窗
    if (key === 'home' || key === 'favorites') {
      setActiveNav(key);
      return;
    }
    setSidebarOpen(false);
    if (key === 'recent') setShowAllDocs(true);
  }, []);

  return (
    <div className="h-screen bg-canvas flex overflow-hidden">
      {/* ── Mobile sidebar backdrop ── */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/30 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={[
          'flex-shrink-0 flex flex-col transition-transform duration-300',
          // Mobile: fixed overlay drawer
          'fixed inset-y-0 left-0 z-50 w-[290px] shadow-xl',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: persistent column
          'md:relative md:w-[300px] md:z-auto md:shadow-none md:translate-x-0',
        ].join(' ')}
      >
        <HomeSidebar
          refreshKey={refreshKey}
          activeNav={activeNav}
          onNavigate={handleSidebarNavigate}
          onCloseMobile={() => setSidebarOpen(false)}
          onChanged={handleDocumentChanged}
        />
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 min-w-0 overflow-y-auto scrollbar-none">
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-30 flex items-center gap-2 h-[52px] px-3 bg-canvas/90 backdrop-blur border-b border-hairline-soft">
          <button
            className="w-10 h-10 flex items-center justify-center rounded-md hover:bg-surface-card transition-colors touch-area"
            onClick={() => setSidebarOpen(true)}
            aria-label="打开侧边栏"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </button>
          <span className="text-base font-display font-semibold text-ink">外刊阅读</span>
          <div className="ml-auto flex items-center gap-2">
            {!isSelecting && (
              <>
                <button
                  className="h-7 px-2.5 rounded-md bg-surface-card hover:bg-surface-cream-strong text-xs font-medium text-body-strong transition-colors"
                  onClick={() => setShowApiKeyModal(true)}
                >
                  API 配置
                </button>
                <button
                  className="h-7 px-2.5 rounded-md bg-surface-overlay border border-hairline hover:border-primary/50 hover:text-primary text-xs font-medium text-body-strong transition-colors"
                  onClick={() => navigate('/srs')}
                >
                  今日复习
                </button>
                <button
                  className="h-7 px-2.5 rounded-md bg-surface-overlay border border-hairline hover:border-primary/50 hover:text-primary text-xs font-medium text-body-strong transition-colors"
                  onClick={() => navigate('/vocabulary')}
                >
                  单词本
                </button>
              </>
            )}
          </div>
        </div>

        {/* Top-right actions — desktop only */}
        {!isSelecting && (
          <div className="hidden md:flex items-center justify-end gap-2.5 px-4 md:px-10 pt-6">
            <button
              className="h-8 px-3.5 rounded-md bg-surface-card hover:bg-surface-cream-strong text-xs font-medium text-body-strong transition-colors"
              onClick={() => setShowApiKeyModal(true)}
            >
              API 配置
            </button>
            <button
              className="h-8 px-3.5 rounded-md bg-surface-overlay border border-hairline hover:border-primary/50 hover:text-primary text-xs font-medium text-body-strong transition-colors"
              onClick={() => navigate('/srs')}
            >
              今日复习
            </button>
            <button
              className="h-8 px-3.5 rounded-md bg-surface-overlay border border-hairline hover:border-primary/50 hover:text-primary text-xs font-medium text-body-strong transition-colors"
              onClick={() => navigate('/vocabulary')}
            >
              单词本
            </button>
          </div>
        )}

        {/* Center column */}
        <div className={isSelecting ? 'min-h-0 h-[calc(100%-53px)] md:h-full flex flex-col' : 'max-w-[700px] mx-auto px-4 md:px-10 pt-4 md:pt-6 pb-12 md:pb-20 w-full'}>
          {/* Daily Quote — 每日一句 */}
          {!isSelecting && !resumeTaskId && <DailyQuote />}

          {/* Upload area */}
          <PDFUploader
            resumeTaskId={resumeTaskId}
            onResumed={handleResumed}
            onDocumentChanged={handleDocumentChanged}
            onSelectionChange={setIsSelecting}
          />
        </div>
      </main>

      {/* ── 全部文档弹窗 ── */}
      <Modal
        open={showAllDocs}
        onClose={() => setShowAllDocs(false)}
        title="最近阅读"
        width="620px"
        bodyClassName="px-4 py-4 overflow-y-auto"
      >
        <RecentDocuments refreshKey={refreshKey} pageSize={20} showLoadMore onChanged={handleDocumentChanged} />
      </Modal>

      {/* ── API 配置 ── */}
      <ApiKeyModal
        open={showApiKeyModal}
        onClose={() => setShowApiKeyModal(false)}
      />
    </div>
  );
}
