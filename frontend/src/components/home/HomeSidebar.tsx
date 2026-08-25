import { useState, useCallback } from 'react';
import RecentDocuments from './RecentDocuments';
import UserMenu from '../common/UserMenu';

export type HomeNavKey = 'home' | 'recent' | 'favorites';

interface HomeSidebarProps {
  refreshKey: number;
  /** 导航点击回调（favorites 由 HomePage 打开弹窗） */
  onNavigate: (key: HomeNavKey) => void;
  /** 移动端抽屉关闭（仅移动端传入） */
  onCloseMobile?: () => void;
}

const NAV_ITEMS: { key: HomeNavKey; label: string; icon: React.ReactNode }[] = [
  {
    key: 'home',
    label: '首页',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    key: 'favorites',
    label: '我的收藏',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
];

export default function HomeSidebar({ refreshKey, onNavigate, onCloseMobile }: HomeSidebarProps) {
  const [activeNav, setActiveNav] = useState<HomeNavKey>('home');

  const handleNav = useCallback((key: HomeNavKey) => {
    setActiveNav(key);
    onNavigate(key);
  }, [onNavigate]);

  return (
    <div className="h-full flex flex-col bg-canvas-soft">
      {/* ── Logo ── */}
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-4 flex-shrink-0">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <path d="M2 4h6a4 4 0 014 4v13a3 3 0 00-3-3H2z" />
          <path d="M22 4h-6a4 4 0 00-4 4v13a3 3 0 013-3h7z" />
        </svg>
        <div className="min-w-0">
          <h1 className="text-[17px] font-display font-semibold text-ink leading-none m-0">
            外刊阅读
          </h1>
          <p className="text-[9px] font-sans tracking-[0.2em] text-muted-soft mt-1">
            GLOBAL READING
          </p>
        </div>
        {/* Mobile close */}
        {onCloseMobile && (
          <button
            className="md:hidden ml-auto w-9 h-9 flex items-center justify-center rounded-md hover:bg-surface-card transition-colors touch-area"
            onClick={onCloseMobile}
            aria-label="关闭侧边栏"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Nav ── */}
      <nav className="px-3.5 space-y-1 flex-shrink-0">
        {NAV_ITEMS.map((item) => {
          const active = activeNav === item.key;
          return (
            <button
              key={item.key}
              onClick={() => handleNav(item.key)}
              className={[
                'w-full flex items-center gap-2.5 px-3.5 py-2 rounded-lg text-[13px] transition-colors duration-150',
                active
                  ? 'bg-surface-cream-strong text-primary font-medium'
                  : 'text-body hover:bg-surface-card',
              ].join(' ')}
            >
              <span className={active ? 'text-primary' : 'text-muted-soft'}>{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* ── Recent documents panel ── */}
      <div className="flex-1 min-h-0 flex flex-col px-3.5 pt-4 pb-2">
        <div className="bg-canvas/80 rounded-xl p-2.5 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-1 mb-2.5 flex-shrink-0">
            <h3 className="text-[13px] font-semibold text-ink m-0">最近阅读</h3>
            <button
              className="text-[11px] text-muted-soft hover:text-primary transition-colors touch-area"
              onClick={() => onNavigate('recent')}
            >
              查看全部
            </button>
          </div>

          <div className="flex-1 overflow-y-auto pr-0.5 min-h-0">
            <RecentDocuments refreshKey={refreshKey} sidebar />
          </div>
        </div>
      </div>

      {/* ── User footer ── */}
      <div className="px-3.5 py-3 border-t border-hairline flex-shrink-0">
        <UserMenu />
      </div>
    </div>
  );
}
