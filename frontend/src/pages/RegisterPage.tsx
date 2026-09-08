import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { sendVerificationCodeApi, uploadAvatarApi } from '../services/authApi';

const CODE_COOLDOWN_SECONDS = 60;
const AVATAR_MAX_MB = 2;

function extractError(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    fallback
  );
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const register = useAuthStore((s) => s.register);
  const syncUser = useAuthStore((s) => s.syncUser);

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState('');

  // 换图/卸载时释放旧 blob URL，避免会话内内存泄漏
  useEffect(() => {
    const url = avatarPreview;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [avatarPreview]);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [devCode, setDevCode] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCountdown = (seconds?: number) => {
    setCountdown(seconds ?? CODE_COOLDOWN_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    // 邮箱变更后旧验证码失效，需重新获取
    if (code || devCode) {
      setCode('');
      setDevCode('');
    }
  };

  const handleSendCode = async () => {
    setError('');
    const value = email.trim();
    if (!value) {
      setError('请先填写邮箱');
      return;
    }
    if (!isValidEmail(value)) {
      setError('邮箱格式不正确');
      return;
    }
    setSendingCode(true);
    try {
      const resp = await sendVerificationCodeApi({ email: value, purpose: 'register' });
      setDevCode(resp.dev_code ?? '');
      startCountdown(resp.cooldown_seconds);
    } catch (err: unknown) {
      setError(extractError(err, '验证码发送失败，请稍后重试'));
    } finally {
      setSendingCode(false);
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件');
      return;
    }
    if (file.size > AVATAR_MAX_MB * 1024 * 1024) {
      setError(`头像不能超过 ${AVATAR_MAX_MB}MB`);
      return;
    }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setError('');
  };

  const clearAvatar = () => {
    setAvatarFile(null);
    setAvatarPreview('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isValidEmail(email.trim())) {
      setError('请填写正确的邮箱');
      return;
    }
    if (!code.trim()) {
      setError('请填写验证码');
      return;
    }
    if (password.length < 8) {
      setError('密码至少需要 8 个字符');
      return;
    }
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      setError('密码需要包含至少一个字母和一个数字');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    try {
      await register(
        email.trim(),
        password,
        confirmPassword,
        code.trim(),
        nickname.trim() || undefined
      );
      // 注册成功即已登录 —— 上传头像（可选）
      if (avatarFile) {
        try {
          const user = await uploadAvatarApi(avatarFile);
          syncUser(user);
        } catch {
          // 头像上传失败不影响注册，忽略即可
        }
      }
      navigate('/', { replace: true });
    } catch (err: unknown) {
      setError(extractError(err, '注册失败，请稍后重试'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto mb-3"
          >
            <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
          </svg>
          <h1 className="text-display-md font-display text-ink mb-1">外刊阅读</h1>
          <p className="text-sm text-muted">邮箱注册，开启精读之旅</p>
        </div>

        {/* Card */}
        <div className="bg-surface-card border border-hairline rounded-xl p-6 shadow-elevated">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* 邮箱 + 验证码 */}
            <div>
              <Input
                label="邮箱"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                autoComplete="email"
                autoFocus
              />
              <div className="flex gap-2 mt-2">
                <Input
                  placeholder="验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="one-time-code"
                  className="flex-1"
                  inputMode="numeric"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  className="shrink-0 h-10"
                  onClick={handleSendCode}
                  loading={sendingCode}
                  disabled={countdown > 0}
                >
                  {countdown > 0 ? `${countdown}s 后重发` : '发送验证码'}
                </Button>
              </div>
              {devCode && (
                <p className="text-xs text-muted-soft mt-1.5">
                  开发模式验证码（未配置 SMTP）：<span className="font-mono text-primary">{devCode}</span>
                </p>
              )}
            </div>

            <Input
              label="用户名"
              type="text"
              placeholder="给自己起个名字（可选）"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              autoComplete="name"
              maxLength={100}
            />

            <Input
              label="密码"
              type="password"
              placeholder="至少 8 位，包含字母和数字"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              hint="至少 8 个字符，包含至少 1 个字母和 1 个数字"
            />

            <Input
              label="确认密码"
              type="password"
              placeholder="再次输入密码"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              error={
                confirmPassword && password !== confirmPassword
                  ? '两次输入的密码不一致'
                  : undefined
              }
            />

            {/* 头像（可选） */}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-body-strong">头像（可选）</span>
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full overflow-hidden bg-primary/15 shadow-inset-hairline flex items-center justify-center text-primary font-medium text-lg flex-shrink-0">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="头像预览" className="w-full h-full object-cover" />
                  ) : (
                    '像'
                  )}
                </div>
                <div className="flex flex-col items-start gap-1.5">
                  <div className="flex gap-1.5">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      选择头像
                    </Button>
                    {avatarFile && (
                      <Button type="button" variant="text" size="sm" onClick={clearAvatar}>
                        移除
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

            {error && (
              <p className="text-sm text-error bg-error/5 border border-error/20 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" size="md" loading={loading} className="w-full mt-1">
              注册
            </Button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-muted mt-6">
          已有账号？{' '}
          <Link to="/login" className="text-primary hover:underline font-medium">
            去登录
          </Link>
          {' · '}
          <Link to="/welcome" className="text-muted hover:underline">
            先看看功能
          </Link>
        </p>
      </div>
    </div>
  );
}
