import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

export default function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const isSuperuser = user?.is_superuser ?? false;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (!user) return null;

  const displayName = user.nickname || user.email.split('@')[0];

  return (
    <div className="relative" ref={ref}>
      {/* ── Trigger ── */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm
                   hover:bg-surface-card transition-colors duration-150"
      >
        <span className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-medium flex-shrink-0">
          {displayName.charAt(0).toUpperCase()}
        </span>
        <span className="truncate text-left leading-tight min-w-0">
          <span className="block text-[13px] font-medium text-ink truncate">{displayName}</span>
          <span className="block text-[11px] text-muted-soft truncate">{user.email}</span>
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`ml-auto flex-shrink-0 text-muted-soft transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* ── Dropdown (opens upward) ── */}
      {open && (
        <div className="absolute left-0 right-0 bottom-full mb-1.5 bg-canvas border border-hairline
                        rounded-xl shadow-modal p-1 z-50 animate-fade-in">
          {/* Admin (superuser only) */}
          {isSuperuser && (
            <button
              onClick={() => {
                setOpen(false);
                navigate('/admin');
              }}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-body-strong
                         hover:text-primary hover:bg-primary/5 transition-colors duration-150
                         flex items-center gap-2.5"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              管理后台
            </button>
          )}

          {/* Logout */}
          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="w-full text-left px-3 py-2 rounded-lg text-sm text-muted
                       hover:text-error hover:bg-error/5 transition-colors duration-150
                       flex items-center gap-2.5"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16,17 21,12 16,7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
