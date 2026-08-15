import { useEffect, useState, useCallback, useRef } from 'react';
import {
  getAdminQuotes,
  createAdminQuote,
  updateAdminQuote,
  deleteAdminQuote,
  type AdminQuoteItem,
  type AdminQuotePayload,
} from '../../services/adminApi';
import Button from '../../components/ui/Button';
import Input, { TextArea } from '../../components/ui/Input';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';

const PAGE_SIZE = 20;

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

const EMPTY_FORM: AdminQuotePayload = { text_en: '', text_zh: '', author: '', active: true };

export default function AdminQuotes() {
  const [quotes, setQuotes] = useState<AdminQuoteItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  // Editor modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<AdminQuotePayload>(EMPTY_FORM);
  const [formError, setFormError] = useState('');

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<AdminQuoteItem | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const fetchQuotes = useCallback(async (s: string, o: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminQuotes({ search: s, limit: PAGE_SIZE, offset: o });
      setQuotes(data.quotes);
      setTotal(data.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '获取名句列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuotes(search, offset);
  }, [search, offset, fetchQuotes]);

  const handleSearchInput = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setOffset(0);
    }, 300);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setEditorOpen(true);
  };

  const openEdit = (q: AdminQuoteItem) => {
    setEditingId(q.id);
    setForm({ text_en: q.text_en, text_zh: q.text_zh, author: q.author, active: q.active });
    setFormError('');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    if (!form.text_en.trim()) {
      setFormError('英文原文不能为空');
      return;
    }
    setSaving(true);
    try {
      const body: AdminQuotePayload = {
        text_en: form.text_en.trim(),
        text_zh: form.text_zh.trim(),
        author: form.author.trim(),
        active: form.active,
      };
      if (editingId === null) {
        await createAdminQuote(body);
      } else {
        await updateAdminQuote(editingId, body);
      }
      setEditorOpen(false);
      await fetchQuotes(search, offset);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (q: AdminQuoteItem) => {
    setActionLoading(q.id);
    try {
      await updateAdminQuote(q.id, { active: !q.active });
      await fetchQuotes(search, offset);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '切换状态失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(deleteTarget.id);
    try {
      await deleteAdminQuote(deleteTarget.id);
      setDeleteTarget(null);
      await fetchQuotes(search, offset);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '删除失败');
    } finally {
      setActionLoading(null);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div>
      <h2 className="text-display-sm font-display text-ink mb-6">句子管理</h2>

      {/* Search + Actions */}
      <div className="mb-6 flex items-center gap-4 flex-wrap">
        <div className="max-w-sm flex-1 min-w-[200px]">
          <Input
            placeholder="搜索英文原文或作者..."
            value={searchInput}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSearchInput(e.target.value)}
          />
        </div>
        <Button variant="primary" onClick={openCreate}>
          新增名句
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" label="加载名句列表..." />
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-error mb-4 text-sm">{error}</p>
          <Button variant="primary" size="sm" onClick={() => fetchQuotes(search, offset)}>
            重试
          </Button>
        </div>
      ) : quotes.length === 0 ? (
        <EmptyState
          title="未找到匹配的名句"
          description={search ? '尝试其他搜索关键词' : '点击「新增名句」添加第一句'}
        />
      ) : (
        <>
          {/* ── Mobile: card list ── */}
          <div className="md:hidden space-y-3">
            {quotes.map((q) => (
              <div key={q.id} className="bg-canvas border border-hairline rounded-lg p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="font-display italic text-sm text-ink leading-snug flex-1">
                    {q.text_en}
                  </span>
                  <Badge variant={q.active ? 'success' : 'default'}>
                    {q.active ? '启用' : '停用'}
                  </Badge>
                </div>
                <p className="text-xs text-muted mb-1">{q.text_zh}</p>
                <p className="text-xs text-muted-soft mb-3">—— {q.author || '--'} · {formatDate(q.created_at)}</p>
                <div className="flex gap-1 pt-2 border-t border-hairline">
                  <Button variant="ghost" size="sm" onClick={() => handleToggleActive(q)} loading={actionLoading === q.id}>
                    {q.active ? '停用' : '启用'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(q)}>
                    编辑
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    loading={actionLoading === q.id && deleteTarget?.id === q.id}
                    onClick={() => setDeleteTarget(q)}
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
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">ID</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">英文原文</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">中文翻译</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">作者</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">状态</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">创建时间</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {quotes.map((q) => (
                  <tr key={q.id} className="hover:bg-surface-card/50 transition-colors">
                    <td className="px-4 py-3 text-sm text-muted tabular-nums">{q.id}</td>
                    <td className="px-4 py-3 text-sm text-body font-display italic max-w-[320px]">
                      <div className="line-clamp-2">{q.text_en}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted max-w-[260px]">
                      <div className="line-clamp-2">{q.text_zh}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">{q.author || '--'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={q.active ? 'success' : 'default'}>
                        {q.active ? '启用' : '停用'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted whitespace-nowrap">{formatDate(q.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" loading={actionLoading === q.id} onClick={() => handleToggleActive(q)}>
                          {q.active ? '停用' : '启用'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(q)}>
                          编辑
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          loading={actionLoading === q.id && deleteTarget?.id === q.id}
                          onClick={() => setDeleteTarget(q)}
                          className="!text-error hover:!bg-error/10"
                        >
                          删除
                        </Button>
                      </div>
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
                共 {total} 条名句，第 {currentPage} / {totalPages} 页
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary" size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  上一页
                </Button>
                <Button
                  variant="secondary" size="sm"
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

      {/* Editor Modal */}
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editingId === null ? '新增名句' : '编辑名句'}
        width="560px"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditorOpen(false)}>
              取消
            </Button>
            <Button variant="primary" size="sm" loading={saving} onClick={handleSave}>
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <TextArea
            label="英文原文 *"
            value={form.text_en}
            onChange={(e) => setForm({ ...form, text_en: e.target.value })}
            placeholder="输入英文名句原文"
            rows={3}
            error={formError}
          />
          <TextArea
            label="中文翻译"
            value={form.text_zh}
            onChange={(e) => setForm({ ...form, text_zh: e.target.value })}
            placeholder="输入中文翻译（可选）"
            rows={2}
          />
          <Input
            label="作者"
            value={form.author}
            onChange={(e) => setForm({ ...form, author: e.target.value })}
            placeholder="如 Steve Jobs（可选）"
          />
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-hairline accent-primary cursor-pointer"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            <span className="text-sm text-body-strong">启用（参与每日轮换展示）</span>
          </label>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="确认删除名句"
        width="420px"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="danger" size="sm"
              loading={actionLoading === deleteTarget?.id}
              onClick={handleDelete}
            >
              确认删除
            </Button>
          </>
        }
      >
        <p className="text-sm text-body">
          确定要删除名句{' '}
          <span className="font-semibold text-ink">「{deleteTarget?.text_en}」</span>
          吗？
        </p>
        <p className="text-sm text-muted mt-2">此操作不可撤销。</p>
      </Modal>
    </div>
  );
}
