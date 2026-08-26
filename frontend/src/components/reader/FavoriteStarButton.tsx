/**
 * 阅读页顶栏「收藏」按钮。
 * 桌面显示文字按钮，移动端图标按钮；点击切换当前文档收藏状态。
 */
import { useState } from 'react';
import { useDocumentStore } from '../../stores/documentStore';
import { setFavorite } from '../../services/pdfApi';

const StarIcon = ({ filled, size }: { filled: boolean; size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

export default function FavoriteStarButton() {
  const documentId = useDocumentStore((s) => s.documentId);
  const isFavorite = useDocumentStore((s) => s.isFavorite);
  const setIsFavorite = useDocumentStore((s) => s.setIsFavorite);
  const [busy, setBusy] = useState(false);

  const handleToggle = async () => {
    if (!documentId || busy) return;
    const next = !isFavorite;
    setBusy(true);
    // Optimistic update; rollback on failure
    setIsFavorite(next);
    try {
      await setFavorite(documentId, next);
    } catch {
      setIsFavorite(!next);
    } finally {
      setBusy(false);
    }
  };

  const colorClass = isFavorite ? 'text-primary' : 'text-muted hover:text-ink';
  const label = isFavorite ? '已收藏' : '收藏';

  return (
    <>
      {/* 桌面端：文字按钮 */}
      <button
        onClick={handleToggle}
        disabled={busy}
        className={`hidden md:inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-sm transition-colors disabled:opacity-50 ${colorClass} ${
          isFavorite ? '' : 'hover:bg-surface-card'
        }`}
        title={label}
      >
        <StarIcon filled={isFavorite} size={15} />
        {label}
      </button>

      {/* 移动端：图标按钮 */}
      <button
        onClick={handleToggle}
        disabled={busy}
        className={`md:hidden w-8 h-8 flex items-center justify-center rounded-md transition-colors touch-area disabled:opacity-50 ${colorClass} ${
          isFavorite ? '' : 'hover:bg-surface-card'
        }`}
        title={label}
      >
        <StarIcon filled={isFavorite} size={18} />
      </button>
    </>
  );
}
