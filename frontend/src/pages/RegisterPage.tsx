import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

export default function RegisterPage() {
  const navigate = useNavigate();
  const register = useAuthStore((s) => s.register);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('请填写邮箱和密码');
      return;
    }

    if (password.length < 8) {
      setError('密码至少需要 8 个字符');
      return;
    }

    const hasLetter = /[a-zA-Z]/.test(password);
    const hasDigit = /\d/.test(password);
    if (!hasLetter || !hasDigit) {
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
        nickname.trim() || undefined
      );
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || '注册失败，请稍后重试';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
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
          <p className="text-sm text-muted">创建账号</p>
        </div>

        {/* Card */}
        <div className="bg-surface-card border border-hairline rounded-xl p-6 shadow-card">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="邮箱"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
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
            />

            <Input
              label="昵称（可选）"
              type="text"
              placeholder="如何称呼你？"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              autoComplete="name"
            />

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
        </p>
      </div>
    </div>
  );
}
