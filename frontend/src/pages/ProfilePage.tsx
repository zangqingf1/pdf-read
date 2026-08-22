import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useReaderStore, ACCENTS } from '../stores/readerStore';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import {
  avatarUrl,
  uploadAvatarApi,
  removeAvatarApi,
} from '../services/authApi';

const AVATAR_MAX_MB = 2;

function extractError(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    fallback
  );
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const syncUser = useAuthStore((s) => s.syncUser);
  const accent = useReaderStore((s) => s.accent);
  const setAccent = useReaderStore((s) => s.setAccent);

  const [nickname, setNickname] = useState(user?.nickname ?? '');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const currentAvatar = avatarPreview || avatarUrl(user.id);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setSuccess('');
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件');
      return;
    }
    if (file.size > AVATAR_MAX_MB * 1024 * 1024) {
      setError(`头像不能超过 ${AVATAR_MAX_MB}MB`);
      return;
    }
    setUploading(true);
    try {
      const updated = await uploadAvatarApi(file);
      syncUser(updated);
      setAvatarPreview('');
      setSuccess('头像已更新');
    } catch (err: unknown) {
      setError(extractError(err, '头像上传失败，请稍后重试'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveAvatar = async () => {
    setError('');
    setSuccess('');
    setUploading(true);
    try {
      await removeAvatarApi();
      syncUser({ ...user, avatar_url: null });
      setAvatarPreview('');
      setSuccess('头像已删除');
    } catch (err: unknown) {
      setError(extractError(err, '头像删除失败，请稍后重试'));
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await updateProfile({ nickname: nickname.trim() || null });
      setSuccess('资料已保存');
    } catch (err: unknown) {
      setError(extractError(err, '保存失败，请稍后重试'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas px-4 py-10">
      <div className="max-w-md mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-muted hover:text-primary mb-6 inline-flex items-center gap-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
          返回
        </button>

        <h1 className="text-display-md font-display text-ink mb-6">个人资料</h1>

        <div className="bg-surface-card border border-hairline rounded-xl p-6 shadow-elevated flex flex-col gap-5">
          {/* 头像 */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-body-strong">头像</span>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full overflow-hidden bg-primary/15 flex items-center justify-center text-primary font-medium text-xl flex-shrink-0">
                {user.avatar_url || avatarPreview ? (
                  <img
                    src={currentAvatar}
                    alt="头像"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  (user.nickname || user.email.charAt(0)).charAt(0).toUpperCase()
                )}
              </div>
              <div className="flex flex-col items-start gap-1.5">
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {user.avatar_url ? '更换头像' : '上传头像'}
                  </Button>
                  {user.avatar_url && (
                    <Button type="button" variant="text" size="sm" onClick={handleRemoveAvatar} loading={uploading}>
                      删除
                    </Button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
                <span className="text-xs text-muted-soft">PNG / JPG / GIF / WebP，≤2MB</span>
              </div>
            </div>
          </div>

          {/* 用户名 */}
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <Input
              label="用户名"
              type="text"
              placeholder="如何称呼你？"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={100}
            />

            <div className="text-sm">
              <span className="text-muted-soft">邮箱（不可修改）：</span>
              <span className="text-ink font-medium">{user.email}</span>
            </div>

            {error && (
              <p className="text-sm text-error bg-error/5 border border-error/20 rounded-md px-3 py-2">
                {error}
              </p>
            )}
            {success && (
              <p className="text-sm text-success bg-success/5 border border-success/20 rounded-md px-3 py-2">
                {success}
              </p>
            )}

            <Button type="submit" variant="primary" size="md" loading={saving} className="w-full mt-1">
              保存
            </Button>
          </form>

          {/* 发音口音（与阅读页排版抽屉共用同一偏好，自动联动） */}
          <div className="flex flex-col gap-2 border-t border-hairline pt-5">
            <span className="text-sm font-medium text-body-strong">发音口音</span>
            <div className="flex gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setAccent(a.key)}
                  className={`flex-1 px-2 py-2 rounded-md text-sm border transition-all duration-150 ${
                    accent === a.key
                      ? 'border-primary bg-surface-card text-primary font-medium'
                      : 'border-hairline text-body hover:border-muted-soft hover:bg-canvas-soft'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-soft">音标与朗读仅使用所选口音，阅读页同步生效</span>
          </div>
        </div>
      </div>
    </div>
  );
}
