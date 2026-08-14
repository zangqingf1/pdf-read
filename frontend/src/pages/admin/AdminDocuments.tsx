import { useEffect, useState, useCallback, useRef } from 'react';
import {
  getAdminDocuments,
  deleteAdminDocument,
  batchDeleteAdminDocuments,
  type AdminDocumentItem,
} from '../../services/adminApi';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';

const PAGE_SIZE = 20;

const STATUS_MAP: Record<string, { variant: 'success' | 'warning' | 'default' | 'coral'; label: string }> = {
  completed: { variant: 'success', label: '已完成' },
  processing: { variant: 'warning', label: '处理中' },
  pending: { variant: 'default', label: '待处理' },
  failed: { variant: 'coral', label: '失败' },
  awaiting_selection: { variant: 'default', label: '待选页' },
};

function statusBadge(status: string) {
  const config = STATUS_MAP[status] ?? { variant: 'default' as const, label: status };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function formatDate(iso: string): string {
  if (!iso) return '--';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '--';
  }
}

export default function AdminDocuments() {
  const [docs, setDocs] = useState<AdminDocumentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<AdminDocumentItem | null>(null);

  // Batch selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const fetchDocs = useCallback(async (s: string, o: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminDocuments({ search: s, limit: PAGE_SIZE, offset: o });
      setDocs(data.documents);
      setTotal(data.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '获取文档列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocs(search, offset);
  }, [search, offset, fetchDocs]);

  const handleSearchInput = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setOffset(0);
    }, 300);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(deleteTarget.id);
    try {
      await deleteAdminDocument(deleteTarget.id);
      setDeleteTarget(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.id);
        return next;
      });
      await fetchDocs(search, offset);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '删除失败');
    } finally {
      setActionLoading(null);
    }
  };

  // ── Batch selection helpers ──

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === docs.length && docs.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(docs.map((d) => d.id)));
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  // ── Batch delete ──

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setBatchDeleting(true);
    try {
      const result = await batchDeleteAdminDocuments(Array.from(selectedIds));
      setShowBatchDeleteConfirm(false);
      clearSelection();
      await fetchDocs(search, offset);
      // Show result summary
      if (result.failed_ids.length > 0) {
        alert(`${result.message}\n失败ID: ${result.failed_ids.join(', ')}`);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '批量删除失败');
    } finally {
      setBatchDeleting(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div>
      <h2 className="text-display-sm font-display text-ink mb-6">文档管理</h2>

      {/* Search + Batch Actions */}
      <div className="mb-6 flex items-center gap-4 flex-wrap">
        <div className="max-w-sm flex-1 min-w-[200px]">
          <Input
            placeholder="搜索文档标题..."
            value={searchInput}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSearchInput(e.target.value)}
          />
        </div>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 animate-fade-in">
            <span className="text-sm text-muted">
              已选 <span className="font-semibold text-ink">{selectedIds.size}</span> 项
            </span>
            <Button variant="secondary" size="sm" onClick={clearSelection}>
              取消选择
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={batchDeleting}
              onClick={() => setShowBatchDeleteConfirm(true)}
            >
              批量删除
            </Button>
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" label="加载文档列表..." />
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-error mb-4 text-sm">{error}</p>
          <Button variant="primary" size="sm" onClick={() => fetchDocs(search, offset)}>
            重试
          </Button>
        </div>
      ) : docs.length === 0 ? (
        <EmptyState
          title="未找到匹配的文档"
          description={search ? '尝试其他搜索关键词' : '还没有上传文档'}
        />
      ) : (
        <>
          {/* ── Mobile: card list ── */}
          <div className="md:hidden space-y-3">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className={`bg-canvas border rounded-lg p-4 transition-colors ${selectedIds.has(doc.id) ? 'border-primary bg-primary/5' : 'border-hairline'}`}
                onClick={() => toggleSelect(doc.id)}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="font-medium text-sm text-body-strong line-clamp-2 flex-1">
                    {doc.title || '未命名文档'}
                  </span>
                  {statusBadge(doc.parse_status)}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted mb-3">
                  <div><span className="text-muted-soft">所有者：</span>{doc.owner_email}</div>
                  <div><span className="text-muted-soft">页数：</span>{doc.page_count ?? '--'} · {doc.word_count ?? '--'} 词</div>
                  <div className="col-span-2"><span className="text-muted-soft">创建：</span>{formatDate(doc.created_at)}</div>
                </div>
                <div className="flex gap-1 pt-2 border-t border-hairline">
                  <Button
                    variant="ghost" size="sm"
                    loading={actionLoading === doc.id}
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(doc); }}
                    className="!text-error hover:!bg-error/10"
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* ── Desktop: table ── */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-hairline shadow-soft">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-card text-left">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-hairline accent-primary cursor-pointer"
                      checked={selectedIds.size === docs.length && docs.length > 0}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">
                    标题
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">
                    所有者
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">
                    状态
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider text-right">
                    页数
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider text-right">
                    词数
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">
                    创建时间
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {docs.map((doc) => (
                  <tr
                    key={doc.id}
                    className={`hover:bg-surface-card/50 transition-colors ${selectedIds.has(doc.id) ? 'bg-primary/5' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-hairline accent-primary cursor-pointer"
                        checked={selectedIds.has(doc.id)}
                        onChange={() => toggleSelect(doc.id)}
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-body font-medium max-w-[240px] truncate">
                      {doc.title || '未命名文档'}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">
                      <div>
                        <span className="text-body">{doc.owner_email}</span>
                        {doc.owner_nickname && (
                          <span className="text-muted-soft ml-1">
                            ({doc.owner_nickname})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">{statusBadge(doc.parse_status)}</td>
                    <td className="px-4 py-3 text-sm text-body text-right tabular-nums">
                      {doc.page_count ?? '--'}
                    </td>
                    <td className="px-4 py-3 text-sm text-body text-right tabular-nums">
                      {doc.word_count ?? '--'}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted whitespace-nowrap">
                      {formatDate(doc.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={actionLoading === doc.id}
                        onClick={() => setDeleteTarget(doc)}
                        className="!text-error hover:!bg-error/10"
                      >
                        删除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-muted">
              <span>
                共 {total} 个文档，第 {currentPage} / {totalPages} 页
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  上一页
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="确认删除文档"
        width="420px"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={actionLoading === deleteTarget?.id}
              onClick={handleDelete}
            >
              确认删除
            </Button>
          </>
        }
      >
        <p className="text-sm text-body">
          确定要删除文档{' '}
          <span className="font-semibold text-ink">
            {deleteTarget?.title || '未命名文档'}
          </span>{' '}
          吗？
        </p>
        <p className="text-sm text-muted mt-2">
          此操作不可撤销，将同时删除文档文件和相关数据。
        </p>
      </Modal>

      {/* Batch Delete Confirmation Modal */}
      <Modal
        open={showBatchDeleteConfirm}
        onClose={() => setShowBatchDeleteConfirm(false)}
        title="确认批量删除"
        width="420px"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setShowBatchDeleteConfirm(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={batchDeleting}
              onClick={handleBatchDelete}
            >
              确认删除
            </Button>
          </>
        }
      >
        <p className="text-sm text-body">
          确定要删除选中的{' '}
          <span className="font-semibold text-ink">{selectedIds.size} 个文档</span>{' '}
          吗？
        </p>
        <p className="text-sm text-muted mt-2">
          此操作不可撤销，将同时删除所有选中文档的文件和相关数据。
        </p>
      </Modal>
    </div>
  );
}
