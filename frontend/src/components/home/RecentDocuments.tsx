import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { listDocuments, deleteDocument, retryDocument, batchDeleteDocuments, setFavorite, type DocumentListItem } from '../../services/pdfApi';
import { getStoredMineruToken } from '../common/ApiKeyModal';
import dayjs from 'dayjs';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Spinner from '../ui/Spinner';
import EmptyState from '../ui/EmptyState';

const ACTIVE_STATUSES = ['pending', 'processing', 'awaiting_selection'];
const POLL_INTERVAL = 3000;

const statusLabelMap: Record<string, string> = {
  pending: '等待中',
  processing: '解析中',
  awaiting_selection: '待选页',
  completed: '已完成',
  failed: '失败',
};

interface RecentDocumentsProps {
  refreshKey?: number;
  sidebar?: boolean;
  /** 每页加载数量（默认 10） */
  pageSize?: number;
  /** 非 sidebar 模式下显示「加载更多」 */
  showLoadMore?: boolean;
  /** 受控批量选择模式（侧边栏「批量管理」导航触发） */
  selectMode?: boolean;
  onSelectModeChange?: (selecting: boolean) => void;
  /** 仅显示收藏的文档（「我的收藏」视图） */
  favoritesOnly?: boolean;
  /** 文档发生变化（删除/收藏切换/批量删除）后通知父级刷新其他实例 */
  onChanged?: () => void;
}

let toastFn: ((msg: string) => void) | null = null;
export function setRecentToast(fn: (msg: string) => void) { toastFn = fn; }

export default function RecentDocuments({
  refreshKey = 0,
  sidebar = false,
  pageSize = 10,
  showLoadMore = false,
  selectMode: selectModeProp,
  onSelectModeChange,
  favoritesOnly = false,
  onChanged,
}: RecentDocumentsProps) {
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Batch selection — 支持受控（导航触发）与内部状态两种模式
  const [internalSelectMode, setInternalSelectMode] = useState(false);
  const isControlled = selectModeProp !== undefined;
  const selectMode = isControlled ? selectModeProp : internalSelectMode;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  const navigate = useNavigate();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setSelectMode = useCallback((v: boolean) => {
    if (!isControlled) setInternalSelectMode(v);
    onSelectModeChange?.(v);
  }, [isControlled, onSelectModeChange]);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listDocuments(pageSize, 0, favoritesOnly);
      setDocuments(result.documents);
      setTotal(result.total ?? result.documents.length);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [pageSize, favoritesOnly]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await listDocuments(pageSize, documents.length, favoritesOnly);
      setDocuments((prev) => [...prev, ...result.documents]);
      setTotal(result.total ?? 0);
    } catch { /* silent */ }
    finally { setLoadingMore(false); }
  }, [documents.length, loadingMore, pageSize, favoritesOnly]);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments, refreshKey]);

  // Auto-poll for active documents
  useEffect(() => {
    const hasActive = documents.some((d) => ACTIVE_STATUSES.includes(d.parse_status));
    if (hasActive && !pollRef.current) {
      pollRef.current = setInterval(() => fetchDocuments(), POLL_INTERVAL);
    } else if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [documents, fetchDocuments]);

  const handleDelete = async (id: string) => {
    setConfirmDelete(null);
    setActionLoading(id);
    try {
      await deleteDocument(id);
      toastFn?.('已删除');
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      setTotal((t) => Math.max(0, t - 1));
      onChanged?.();
    } catch { toastFn?.('删除失败'); }
    finally { setActionLoading(null); }
  };

  const handleToggleFavorite = async (doc: DocumentListItem) => {
    const next = !doc.is_favorite;
    // Optimistic update; rollback on failure
    setDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, is_favorite: next } : d)));
    try {
      await setFavorite(doc.id, next);
      if (favoritesOnly && !next) {
        // 收藏视图中取消收藏 → 从列表移除
        setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
        setTotal((t) => Math.max(0, t - 1));
      }
      onChanged?.();
    } catch {
      setDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, is_favorite: doc.is_favorite } : d)));
      toastFn?.('收藏操作失败');
    }
  };

  const handleRetry = async (id: string) => {
    setActionLoading(id);
    try {
      const result = await retryDocument(id, getStoredMineruToken());
      if (result.status === 'awaiting_selection') {
        navigate(`/?resume=${id}`);
      } else {
        toastFn?.('已重新开始解析');
        await fetchDocuments();
      }
    } catch (err: any) {
      toastFn?.(err?.response?.data?.detail || '重试失败');
    } finally { setActionLoading(null); }
  };

  // ── Batch selection ──

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setBatchDeleting(true);
    try {
      const result = await batchDeleteDocuments(Array.from(selectedIds));
      toastFn?.(result.message);
      exitSelectMode();
      await fetchDocuments();
      onChanged?.();
    } catch (err: any) {
      toastFn?.(err?.response?.data?.detail || '批量删除失败');
    } finally {
      setBatchDeleting(false);
    }
  };

  if (loading && documents.length === 0) {
    return (
      <div className={sidebar ? 'flex items-center justify-center py-8' : 'text-center py-12'}>
        <Spinner size="sm" />
      </div>
    );
  }

  if (!loading && documents.length === 0) {
    if (sidebar) {
      return (
        <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--muted-soft)" strokeWidth="1.2" className="mb-3 opacity-50">
            {favoritesOnly ? (
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            ) : (
              <>
                <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
              </>
            )}
          </svg>
          <p className="text-xs text-muted-soft">{favoritesOnly ? '暂无收藏' : '暂无文档'}</p>
          {!favoritesOnly && <p className="text-[10px] text-muted-soft/70 mt-1">上传文档或粘贴链接开始阅读吧</p>}
        </div>
      );
    }
    return (
      <EmptyState
        title={favoritesOnly ? '暂无收藏' : '还没有处理过文档'}
        description={favoritesOnly ? '在文档上点击星标即可收藏' : '上传文档或粘贴链接开始阅读吧'}
      />
    );
  }

  // ── Sidebar item hover actions: 收藏 + 删除 ──
  const renderRowActions = (doc: DocumentListItem) => (
    <div className="flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      {/* 收藏 */}
      <button
        className={`w-6 h-6 flex items-center justify-center rounded transition-all touch-area ${
          doc.is_favorite
            ? 'text-primary'
            : 'text-muted-soft hover:text-primary hover:bg-primary/10'
        }`}
        onClick={() => handleToggleFavorite(doc)}
        title={doc.is_favorite ? '取消收藏' : '收藏'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill={doc.is_favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </button>
      {/* 删除 */}
      <button
        className="w-6 h-6 flex items-center justify-center rounded text-muted-soft hover:text-error hover:bg-error/5 transition-all touch-area"
        onClick={() => setConfirmDelete(doc.id)}
        title="删除"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        </svg>
      </button>
    </div>
  );

  return (
    <div>
      {/* Non-sidebar header (modal full list) */}
      {!sidebar && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-display font-medium text-ink">全部文档</h3>
          {documents.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); }}
            >
              {selectMode ? '取消' : '批量管理'}
            </Button>
          )}
        </div>
      )}

      {/* Batch action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className={`flex items-center gap-2 mb-3 animate-fade-in ${sidebar ? 'px-1' : ''}`}>
          <span className="text-xs text-muted">
            已选 {selectedIds.size} 项
          </span>
          <Button
            variant="danger"
            size="sm"
            loading={batchDeleting}
            onClick={handleBatchDelete}
          >
            删除选中
          </Button>
          <Button variant="ghost" size="sm" onClick={exitSelectMode}>
            取消
          </Button>
        </div>
      )}

      {/* Empty selection bar (show when selectMode is on but nothing selected) */}
      {selectMode && selectedIds.size === 0 && (
        <div className={`flex items-center gap-2 mb-3 ${sidebar ? 'px-1' : ''}`}>
          <span className="text-xs text-muted">点击文档进行选择</span>
          <Button variant="ghost" size="sm" onClick={exitSelectMode}>
            取消
          </Button>
        </div>
      )}

      <div className={sidebar ? 'space-y-2' : 'space-y-1'}>
        {documents.map((doc) => {
          const isCompleted = doc.parse_status === 'completed';
          const isFailed = doc.parse_status === 'failed';
          const isAwaitingSelection = doc.parse_status === 'awaiting_selection';
          const showDeleteConfirm = confirmDelete === doc.id;
          const clickable = !selectMode && (isCompleted || (sidebar && (isAwaitingSelection || isFailed)));

          if (sidebar) {
            return (
              <div
                key={doc.id}
                onClick={() => {
                  if (selectMode) { toggleSelect(doc.id); return; }
                  if (isCompleted) navigate(`/document/${doc.id}`);
                  else if (isAwaitingSelection) navigate(`/?resume=${doc.id}`);
                  else if (isFailed) handleRetry(doc.id);
                }}
                className={[
                  'group relative flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-all',
                  selectedIds.has(doc.id)
                    ? 'bg-primary/10 border-primary/40'
                    : 'bg-surface-overlay border-hairline-soft hover:shadow-soft hover:border-hairline',
                  selectMode || clickable ? 'cursor-pointer' : '',
                ].join(' ')}
              >
                {/* Checkbox in select mode */}
                {selectMode && (
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-hairline accent-primary cursor-pointer flex-shrink-0"
                    checked={selectedIds.has(doc.id)}
                    onChange={() => toggleSelect(doc.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}

                {/* PDF icon */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c64545" strokeWidth="1.5" className="flex-shrink-0">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <path d="M14 2v6h6M16 13H8M16 17H8" />
                </svg>

                {/* Title + meta */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-body-strong truncate leading-tight">
                    {doc.title || 'Untitled'}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {doc.word_count != null && doc.word_count > 0 && (
                      <span className="text-[10px] text-muted-soft">{doc.word_count.toLocaleString()} 词</span>
                    )}
                    <span className="text-[10px] text-muted-soft">{dayjs(doc.created_at).format('MM-DD HH:mm')}</span>
                    {!['completed', 'failed'].includes(doc.parse_status) && (
                      <Badge variant={isAwaitingSelection ? 'warning' : 'default'}>
                        {statusLabelMap[doc.parse_status] || doc.parse_status}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Inline delete confirm / hover actions */}
                {showDeleteConfirm ? (
                  <div className="flex items-center gap-1 flex-shrink-0 animate-fade-in" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="px-1.5 py-0.5 text-[11px] font-medium text-error hover:bg-error/10 rounded"
                      onClick={() => handleDelete(doc.id)}
                    >
                      删除
                    </button>
                    <button
                      className="px-1.5 py-0.5 text-[11px] text-muted-soft hover:bg-surface-card rounded"
                      onClick={() => setConfirmDelete(null)}
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  !selectMode && (
                    <div className="hover-reveal transition-all">
                      {renderRowActions(doc)}
                    </div>
                  )
                )}
              </div>
            );
          }

          // ── Non-sidebar (full list, e.g. modal) ──
          return (
            <div
              key={doc.id}
              onClick={() => {
                if (selectMode) { toggleSelect(doc.id); return; }
                if (isCompleted) navigate(`/document/${doc.id}`);
              }}
              className={[
                'group flex items-center gap-3 rounded-lg transition-colors',
                'px-4 py-3',
                selectMode ? 'cursor-pointer' : '',
                selectedIds.has(doc.id) ? 'bg-primary/10' : '',
                (!selectMode && (isCompleted || isAwaitingSelection || isFailed)) ? 'cursor-pointer hover:bg-surface-card' : '',
              ].join(' ')}
            >
              {/* Checkbox in select mode */}
              {selectMode && (
                <input
                  type="checkbox"
                  className="w-5 h-5 rounded border-hairline accent-primary cursor-pointer flex-shrink-0"
                  checked={selectedIds.has(doc.id)}
                  onChange={() => toggleSelect(doc.id)}
                  onClick={(e) => e.stopPropagation()}
                />
              )}

              {/* PDF icon */}
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c64545" strokeWidth="1.5" className="flex-shrink-0">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M14 2v6h6" />
              </svg>

              {/* Title + meta */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate text-body-strong">
                    {doc.title || 'Untitled'}
                  </span>
                  {doc.is_favorite && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="var(--primary)" stroke="none" className="flex-shrink-0">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  )}
                  <Badge
                    variant={
                      isCompleted ? 'success' :
                      isFailed ? 'coral' :
                      isAwaitingSelection ? 'warning' :
                      'default'
                    }
                  >
                    {statusLabelMap[doc.parse_status] || doc.parse_status}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 mt-0.5">
                  {doc.word_count != null && doc.word_count > 0 && (
                    <span className="text-[11px] text-muted-soft">{doc.word_count.toLocaleString()} 词</span>
                  )}
                  <span className="text-[11px] text-muted-soft">{dayjs(doc.created_at).format('YYYY-MM-DD HH:mm')}</span>
                </div>
              </div>

              {/* Actions (hidden in select mode) */}
              {!selectMode && (
                <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                  {isAwaitingSelection && (
                    <Button variant="primary" size="sm" loading={actionLoading === doc.id}
                      onClick={() => {
                        setActionLoading(doc.id);
                        navigate(`/?resume=${doc.id}`);
                      }}>
                      继续选页
                    </Button>
                  )}
                  {isFailed && (
                    <Button variant="primary" size="sm" loading={actionLoading === doc.id}
                      onClick={() => handleRetry(doc.id)}>
                      重试
                    </Button>
                  )}

                  {/* 收藏 */}
                  {!showDeleteConfirm && (
                    <button
                      className={`w-7 h-7 flex items-center justify-center rounded-md transition-all hover-reveal ${
                        doc.is_favorite
                          ? 'text-primary'
                          : 'text-muted-soft hover:text-primary hover:bg-primary/10'
                      }`}
                      onClick={() => handleToggleFavorite(doc)}
                      title={doc.is_favorite ? '取消收藏' : '收藏'}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill={doc.is_favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>
                  )}

                  {/* Delete with confirmation */}
                  {showDeleteConfirm ? (
                    <div className="flex items-center gap-1 animate-fade-in">
                      <span className="text-xs text-error">确定删除？</span>
                      <button
                        className="px-2 py-1 text-xs font-medium text-error hover:bg-error/10 rounded"
                        onClick={() => handleDelete(doc.id)}
                      >
                        删除
                      </button>
                      <button
                        className="px-2 py-1 text-xs text-muted hover:bg-surface-card rounded"
                        onClick={() => setConfirmDelete(null)}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      className="w-7 h-7 flex items-center justify-center rounded-md text-muted-soft hover:text-error hover:bg-error/5 hover-reveal transition-all"
                      onClick={() => setConfirmDelete(doc.id)}
                      title="删除"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Load more (full list) */}
      {showLoadMore && documents.length < total && (
        <div className="flex justify-center pt-4">
          <Button variant="ghost" size="sm" loading={loadingMore} onClick={loadMore}>
            加载更多（共 {total} 篇）
          </Button>
        </div>
      )}
    </div>
  );
}
