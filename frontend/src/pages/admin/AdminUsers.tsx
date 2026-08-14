import { useEffect, useState, useCallback, useRef } from 'react';
import {
  getAdminUsers,
  updateAdminUser,
  deleteAdminUser,
  type AdminUserItem,
} from '../../services/adminApi';
import { useAuthStore } from '../../stores/authStore';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
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
    }).format(new Date(iso));
  } catch {
    return '--';
  }
}

export default function AdminUsers() {
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<AdminUserItem | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const fetchUsers = useCallback(async (s: string, o: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminUsers({ search: s, limit: PAGE_SIZE, offset: o });
      setUsers(data.users);
      setTotal(data.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '获取用户列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers(search, offset);
  }, [search, offset, fetchUsers]);

  const handleSearchInput = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setOffset(0);
    }, 300);
  };

  const handleToggleActive = async (user: AdminUserItem) => {
    setActionLoading(user.id);
    try {
      await updateAdminUser(user.id, { is_active: !user.is_active });
      await fetchUsers(search, offset);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '操作失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleSuperuser = async (user: AdminUserItem) => {
    setActionLoading(user.id);
    try {
      await updateAdminUser(user.id, { is_superuser: !user.is_superuser });
      await fetchUsers(search, offset);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '操作失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(deleteTarget.id);
    try {
      await deleteAdminUser(deleteTarget.id);
      setDeleteTarget(null);
      await fetchUsers(search, offset);
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
      <h2 className="text-display-sm font-display text-ink mb-6">用户管理</h2>

      {/* Search */}
      <div className="mb-6 max-w-sm">
        <Input
          placeholder="搜索邮箱或昵称..."
          value={searchInput}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSearchInput(e.target.value)}
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" label="加载用户列表..." />
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-error mb-4 text-sm">{error}</p>
          <Button variant="primary" size="sm" onClick={() => fetchUsers(search, offset)}>
            重试
          </Button>
        </div>
      ) : users.length === 0 ? (
        <EmptyState
          title="未找到匹配的用户"
          description={search ? '尝试其他搜索关键词' : '还没有注册用户'}
        />
      ) : (
        <>
          {/* ── Mobile: card list ── */}
          <div className="md:hidden space-y-3">
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              const isBusy = actionLoading === user.id;
              return (
                <div key={user.id} className="bg-canvas border border-hairline rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm text-body-strong truncate max-w-[220px]">{user.email}</span>
                    <Badge variant={user.is_active ? 'success' : 'default'}>
                      {user.is_active ? '正常' : '已禁用'}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted mb-3">
                    <div><span className="text-muted-soft">昵称：</span>{user.nickname || '--'}</div>
                    <div><span className="text-muted-soft">角色：</span>{user.is_superuser ? '管理员' : '用户'}</div>
                    <div><span className="text-muted-soft">文档数：</span>{user.document_count}</div>
                    <div><span className="text-muted-soft">注册：</span>{formatDate(user.created_at)}</div>
                  </div>
                  <div className="flex gap-1 pt-3 border-t border-hairline">
                    <Button
                      variant="ghost" size="sm" loading={isBusy}
                      onClick={() => handleToggleActive(user)}
                    >
                      {user.is_active ? '禁用' : '启用'}
                    </Button>
                    {!isSelf && (
                      <Button variant="ghost" size="sm" loading={isBusy}
                        onClick={() => handleToggleSuperuser(user)}
                      >
                        {user.is_superuser ? '降级' : '提升'}
                      </Button>
                    )}
                    {!isSelf && (
                      <Button variant="ghost" size="sm" loading={isBusy}
                        onClick={() => setDeleteTarget(user)}
                        className="!text-error hover:!bg-error/10"
                      >
                        删除
                      </Button>
                    )}
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
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">
                    昵称
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">
                    状态
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">
                    角色
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider text-right">
                    文档数
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">
                    注册时间
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {users.map((user) => {
                  const isSelf = user.id === currentUserId;
                  const isBusy = actionLoading === user.id;

                  return (
                    <tr
                      key={user.id}
                      className="hover:bg-surface-card/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-body font-medium">
                        {user.email}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted">
                        {user.nickname || '--'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={user.is_active ? 'success' : 'default'}>
                          {user.is_active ? '正常' : '已禁用'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {user.is_superuser ? (
                          <Badge variant="coral">管理员</Badge>
                        ) : (
                          <Badge variant="default">用户</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-body text-right tabular-nums">
                        {user.document_count}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted whitespace-nowrap">
                        {formatDate(user.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={isBusy}
                            onClick={() => handleToggleActive(user)}
                            title={user.is_active ? '禁用该用户' : '启用该用户'}
                          >
                            {user.is_active ? '禁用' : '启用'}
                          </Button>
                          {!isSelf && (
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={isBusy}
                              onClick={() => handleToggleSuperuser(user)}
                              title={
                                user.is_superuser ? '取消管理员权限' : '设为管理员'
                              }
                            >
                              {user.is_superuser ? '降级' : '提升'}
                            </Button>
                          )}
                          {!isSelf && (
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={isBusy}
                              onClick={() => setDeleteTarget(user)}
                              className="!text-error hover:!bg-error/10"
                            >
                              删除
                            </Button>
                          )}
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
                共 {total} 个用户，第 {currentPage} / {totalPages} 页
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
        title="确认删除用户"
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
          确定要删除用户 <span className="font-semibold text-ink">{deleteTarget?.email}</span> 吗？
        </p>
        <p className="text-sm text-muted mt-2">
          此操作不可撤销，将同时删除该用户的所有文档和数据。
        </p>
      </Modal>
    </div>
  );
}
