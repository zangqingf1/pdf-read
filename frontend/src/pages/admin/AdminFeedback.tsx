import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteAdminFeedback,
  extractFeedbackError,
  getAdminFeedback,
  updateAdminFeedback,
  type AdminFeedbackItem,
} from '../../services/feedbackApi';
import {
  FEEDBACK_STATUSES,
  feedbackCategoryLabel,
  feedbackStatusMeta,
} from '../../constants/feedback';
import Button from '../../components/ui/Button';
import Input, { TextArea } from '../../components/ui/Input';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import FeedbackImageGallery from '../../components/common/FeedbackImageGallery';

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

export default function AdminFeedback() {
  const [items, setItems] = useState<AdminFeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 详情 / 回复弹窗
  const [detail, setDetail] = useState<AdminFeedbackItem | null>(null);
  const [formStatus, setFormStatus] = useState('pending');
  const [formReply, setFormReply] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<AdminFeedbackItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const fetchList = useCallback(async (s: string, st: string, o: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminFeedback({
        search: s,
        status: st || null,
        limit: PAGE_SIZE,
        offset: o,
      });
      setItems(data.feedbacks);
      setTotal(data.total);
    } catch (err: unknown) {
      setError(extractFeedbackError(err, '获取反馈列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchList(search, statusFilter, offset);
  }, [search, statusFilter, offset, fetchList, reloadKey]);

  const handleSearchInput = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setOffset(0);
    }, 300);
  };

  const handleStatusFilter = (value: string) => {
    setStatusFilter(value);
    setOffset(0);
  };

  const openDetail = (fb: AdminFeedbackItem) => {
    setDetail(fb);
    setFormStatus(fb.status);
    setFormReply(fb.admin_reply ?? '');
    setFormError('');
  };

  const handleSave = async () => {
    if (!detail) return;
    setFormError('');
    setSaving(true);
    try {
      await updateAdminFeedback(detail.id, {
        status: formStatus,
        admin_reply: formReply,
      });
      setDetail(null);
      setReloadKey((k) => k + 1);
    } catch (err: unknown) {
      setFormError(extractFeedbackError(err, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAdminFeedback(deleteTarget.id);
      setDeleteTarget(null);
      setReloadKey((k) => k + 1);
    } catch (err: unknown) {
      setDeleteTarget(null);
      setError(extractFeedbackError(err, '删除失败'));
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div>
      <h2 className="text-display-sm font-display text-ink mb-6">反馈管理</h2>

      {/* Search + Filter */}
      <div className="mb-6 flex items-center gap-4 flex-wrap">
        <div className="max-w-sm flex-1 min-w-[200px]">
          <Input
            placeholder="搜索内容、联系方式或用户邮箱..."
            value={searchInput}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSearchInput(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleStatusFilter('')}
            className={`px-3 py-1.5 rounded-md text-sm border transition-all duration-150 ${
              statusFilter === ''
                ? 'border-primary bg-surface-card text-primary font-medium'
                : 'border-hairline text-body hover:border-muted-soft hover:bg-canvas-soft'
            }`}
          >
            全部
          </button>
          {FEEDBACK_STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => handleStatusFilter(s.value)}
              className={`px-3 py-1.5 rounded-md text-sm border transition-all duration-150 ${
                statusFilter === s.value
                  ? 'border-primary bg-surface-card text-primary font-medium'
                  : 'border-hairline text-body hover:border-muted-soft hover:bg-canvas-soft'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" label="加载反馈列表..." />
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-error mb-4 text-sm">{error}</p>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void fetchList(search, statusFilter, offset)}
          >
            重试
          </Button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="未找到匹配的反馈"
          description={search || statusFilter ? '尝试其他搜索关键词或状态筛选' : '暂时还没有用户提交反馈'}
        />
      ) : (
        <>
          {/* ── Mobile: card list ── */}
          <div className="md:hidden space-y-3">
            {items.map((fb) => {
              const status = feedbackStatusMeta(fb.status);
              return (
                <div key={fb.id} className="bg-canvas border border-hairline rounded-lg p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="default">{feedbackCategoryLabel(fb.category)}</Badge>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                    <span className="text-xs text-muted-soft whitespace-nowrap">
                      {formatDate(fb.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-body line-clamp-3 mb-1">{fb.content}</p>
                  <p className="text-xs text-muted-soft mb-3">
                    {fb.user_nickname || fb.user_email}
                    {fb.image_count > 0 ? ` · ${fb.image_count} 张截图` : ''}
                  </p>
                  <div className="flex gap-1 pt-2 border-t border-hairline">
                    <Button variant="ghost" size="sm" onClick={() => openDetail(fb)}>
                      处理
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(fb)}
                      className="!text-error hover:!bg-error/10"
                    >
                      删除
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Desktop: table ── */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-hairline shadow-soft">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-card text-left">
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">ID</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">提交人</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">类型</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">内容</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">状态</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">提交时间</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {items.map((fb) => {
                  const status = feedbackStatusMeta(fb.status);
                  return (
                    <tr key={fb.id} className="hover:bg-surface-card/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-muted tabular-nums">{fb.id}</td>
                      <td className="px-4 py-3 text-sm text-muted">
                        <div className="text-ink">{fb.user_nickname || '--'}</div>
                        <div className="text-xs text-muted-soft">{fb.user_email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="default">{feedbackCategoryLabel(fb.category)}</Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-body max-w-[320px]">
                        <div className="line-clamp-2">{fb.content}</div>
                        {fb.image_count > 0 && (
                          <span className="text-xs text-muted-soft">
                            {fb.image_count} 张截图
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted whitespace-nowrap">
                        {formatDate(fb.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openDetail(fb)}>
                            处理
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(fb)}
                            className="!text-error hover:!bg-error/10"
                          >
                            删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-muted">
              <span>
                共 {total} 条反馈，第 {currentPage} / {totalPages} 页
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

      {/* Detail / Reply Modal */}
      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={`反馈详情 #${detail?.id ?? ''}`}
        width="640px"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDetail(null)}>
              取消
            </Button>
            <Button variant="primary" size="sm" loading={saving} onClick={handleSave}>
              保存
            </Button>
          </>
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="default">{feedbackCategoryLabel(detail.category)}</Badge>
              <Badge variant={feedbackStatusMeta(detail.status).variant}>
                {feedbackStatusMeta(detail.status).label}
              </Badge>
              <span className="text-xs text-muted-soft">
                {formatDate(detail.created_at)}
              </span>
            </div>

            <div className="text-sm">
              <span className="text-muted-soft">提交人：</span>
              <span className="text-ink">
                {detail.user_nickname || '--'}（{detail.user_email}）
              </span>
            </div>

            <div>
              <span className="text-sm text-muted-soft">反馈内容</span>
              <p className="text-sm text-body whitespace-pre-wrap break-words mt-1 bg-canvas border border-hairline rounded-md px-3 py-2">
                {detail.content}
              </p>
            </div>

            {detail.contact && (
              <div className="text-sm">
                <span className="text-muted-soft">联系方式：</span>
                <span className="text-ink">{detail.contact}</span>
              </div>
            )}

            {detail.image_count > 0 && (
              <div>
                <span className="text-sm text-muted-soft">
                  截图（{detail.image_count} 张）
                </span>
                <div className="mt-1">
                  <FeedbackImageGallery
                    key={detail.id}
                    feedbackId={detail.id}
                    count={detail.image_count}
                  />
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-body-strong">处理状态</span>
              <div className="flex flex-wrap gap-2">
                {FEEDBACK_STATUSES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setFormStatus(s.value)}
                    className={`px-3 py-1.5 rounded-md text-sm border transition-all duration-150 ${
                      formStatus === s.value
                        ? 'border-primary bg-surface-card text-primary font-medium'
                        : 'border-hairline text-body hover:border-muted-soft hover:bg-canvas-soft'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <TextArea
              label="回复用户"
              value={formReply}
              onChange={(e) => setFormReply(e.target.value)}
              placeholder="填写回复内容，用户可在「问题反馈」页面看到（留空表示不回复）"
              rows={3}
              maxLength={2000}
            />

            {formError && (
              <p className="text-sm text-error bg-error/5 border border-error/20 rounded-md px-3 py-2">
                {formError}
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="确认删除反馈"
        width="420px"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>
              确认删除
            </Button>
          </>
        }
      >
        <p className="text-sm text-body">
          确定要删除反馈{' '}
          <span className="font-semibold text-ink">#{deleteTarget?.id}</span> 吗？
        </p>
        <p className="text-sm text-muted mt-2">对应的截图文件也会一并删除，此操作不可撤销。</p>
      </Modal>
    </div>
  );
}
