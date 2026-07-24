import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { listDocuments, deleteDocument, retryDocument, type DocumentListItem } from '../../services/pdfApi';
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
}

let toastFn: ((msg: string) => void) | null = null;
export function setRecentToast(fn: (msg: string) => void) { toastFn = fn; }

export default function RecentDocuments({ refreshKey = 0, sidebar = false }: RecentDocumentsProps) {
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const navigate = useNavigate();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listDocuments(10, 0);
      setDocuments(result.documents);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

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
    } catch { toastFn?.('删除失败'); }
    finally { setActionLoading(null); }
  };

  const handleRetry = async (id: string) => {
    setActionLoading(id);
    try {
      const result = await retryDocument(id);
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
            <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
          </svg>
          <p className="text-xs text-muted-soft">暂无文档</p>
        </div>
      );
    }
    return (
      <EmptyState
        title="还没有处理过文档"
        description="上传一篇英文 PDF 开始阅读吧"
      />
    );
  }

  return (
    <div>
      {!sidebar && (
        <h3 className="text-lg font-display font-medium text-ink mb-4">最近阅读</h3>
      )}

      <div className={sidebar ? 'space-y-0.5' : 'space-y-1'}>
        {documents.map((doc) => {
          const isCompleted = doc.parse_status === 'completed';
          const isFailed = doc.parse_status === 'failed';
          const isAwaitingSelection = doc.parse_status === 'awaiting_selection';
          const showDeleteConfirm = confirmDelete === doc.id;

          return (
            <div
              key={doc.id}
              onClick={() => {
                if (isCompleted) navigate(`/document/${doc.id}`);
                else if (sidebar && isAwaitingSelection) navigate(`/?resume=${doc.id}`);
                else if (sidebar && isFailed) handleRetry(doc.id);
              }}
              className={[
                'group flex items-center gap-3 rounded-lg transition-colors',
                sidebar ? 'px-3 py-2' : 'px-4 py-3',
                (isCompleted || (sidebar && (isAwaitingSelection || isFailed))) ? 'cursor-pointer hover:bg-surface-card' : '',
              ].join(' ')}
            >
              {/* PDF icon */}
              <svg width={sidebar ? 18 : 22} height={sidebar ? 18 : 22} viewBox="0 0 24 24" fill="none" stroke="#c64545" strokeWidth="1.5" className="flex-shrink-0">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M14 2v6h6" />
              </svg>

              {/* Title + meta */}
              <div className="flex-1 min-w-0">
                <div className={sidebar ? 'flex flex-col gap-0.5' : 'flex items-center gap-2'}>
                  <span className={`${sidebar ? 'text-[13px] leading-tight' : 'text-sm'} font-medium truncate ${isCompleted ? 'text-body-strong' : 'text-muted'}`}>
                    {doc.title || 'Untitled'}
                  </span>
                  <div className={sidebar ? 'flex items-center gap-1.5' : ''}>
                    {sidebar && !['completed', 'failed'].includes(doc.parse_status) && (
                      <Badge
                        variant={
                          doc.parse_status === 'awaiting_selection' ? 'warning' : 'default'
                        }
                      >
                        {statusLabelMap[doc.parse_status] || doc.parse_status}
                      </Badge>
                    )}
                    {!sidebar && (
                      <Badge
                        variant={
                          doc.parse_status === 'completed' ? 'success' :
                          doc.parse_status === 'failed' ? 'coral' :
                          doc.parse_status === 'awaiting_selection' ? 'warning' :
                          'default'
                        }
                      >
                        {statusLabelMap[doc.parse_status] || doc.parse_status}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className={sidebar ? 'flex items-center gap-2 mt-0.5' : 'flex items-center gap-4 mt-0.5'}>
                  {doc.word_count != null && doc.word_count > 0 && (
                    <span className="text-[11px] text-muted-soft">{doc.word_count.toLocaleString()} 词</span>
                  )}
                  <span className="text-[11px] text-muted-soft">{dayjs(doc.created_at).format(sidebar ? 'MM-DD HH:mm' : 'YYYY-MM-DD HH:mm')}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                {/* Sidebar: compact actions */}
                {sidebar && (
                  <>
                    {/* Delete with confirmation */}
                    {showDeleteConfirm ? (
                      <div className="flex items-center gap-1 animate-fade-in">
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
                      <button
                        className="w-5 h-5 flex items-center justify-center rounded text-muted-soft hover:text-error hover:bg-error/5 opacity-0 group-hover:opacity-100 transition-all"
                        onClick={() => setConfirmDelete(doc.id)}
                        title="删除"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        </svg>
                      </button>
                    )}
                  </>
                )}

                {/* Non-sidebar: full actions */}
                {!sidebar && (
                  <>
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
                        className="w-7 h-7 flex items-center justify-center rounded-md text-muted-soft hover:text-error hover:bg-error/5 opacity-0 group-hover:opacity-100 transition-all"
                        onClick={() => setConfirmDelete(doc.id)}
                        title="删除"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        </svg>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
