import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { resetPasswordSendApi, resetPasswordConfirmApi } from '../services/authApi';

const CODE_COOLDOWN_SECONDS = 60;

function extractError(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
    fallback
  );
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

type Step = 'email' | 'reset';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [devCode, setDevCode] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const handleSendCode = async () => {
    setError('');
    const value = email.trim();
    if (!isValidEmail(value)) {
      setError('请填写正确的邮箱');
      return;
    }
    setSendingCode(true);
    try {
      const resp = await resetPasswordSendApi({ email: value, purpose: 'reset_password' });
      setDevCode(resp.dev_code ?? '');
      setStep('reset');
      startCountdown(resp.cooldown_seconds);
    } catch (err: unknown) {
      setError(extractError(err, '验证码发送失败，请稍后重试'));
    } finally {
      setSendingCode(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!code.trim()) {
      setError('请填写验证码');
      return;
    }
    if (newPassword.length < 8) {
      setError('密码至少需要 8 个字符');
      return;
    }
    if (!/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError('密码需要包含至少一个字母和一个数字');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    try {
      const resp = await resetPasswordConfirmApi({
        email: email.trim(),
        code: code.trim(),
        new_password: newPassword,
        password_confirm: confirmPassword,
      });
      setSuccess(resp.message || '密码已重置，请使用新密码登录。');
      setError('');
      setTimeout(() => navigate('/login', { replace: true }), 1500);
    } catch (err: unknown) {
      setError(extractError(err, '密码重置失败，请稍后重试'));
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
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <h1 className="text-display-md font-display text-ink mb-1">找回密码</h1>
          <p className="text-sm text-muted">
            {step === 'email' ? '输入注册邮箱，获取验证码' : '验证邮箱后设置新密码'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-surface-card border border-hairline rounded-xl p-6 shadow-card">
          {step === 'email' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendCode();
              }}
              className="flex flex-col gap-4"
            >
              <Input
                label="邮箱"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (devCode) setDevCode('');
                }}
                autoComplete="email"
                autoFocus
              />

              {error && (
                <p className="text-sm text-error bg-error/5 border border-error/20 rounded-md px-3 py-2">
                  {error}
                </p>
              )}

              <Button type="submit" variant="primary" size="md" loading={sendingCode} className="w-full mt-1">
                获取验证码
              </Button>
            </form>
          ) : (
            <form onSubmit={handleReset} className="flex flex-col gap-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">
                  邮箱：<span className="text-ink font-medium">{email}</span>
                </span>
                <button
                  type="button"
                  className="text-primary hover:underline text-xs"
                  onClick={() => setStep('email')}
                >
                  更换邮箱
                </button>
              </div>

              <div className="flex gap-2">
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
                  {countdown > 0 ? `${countdown}s 后重发` : '重新发送'}
                </Button>
              </div>
              {devCode && (
                <p className="text-xs text-muted-soft -mt-2">
                  开发模式验证码（未配置 SMTP）：<span className="font-mono text-primary">{devCode}</span>
                </p>
              )}

              <Input
                label="新密码"
                type="password"
                placeholder="至少 8 位，包含字母和数字"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                hint="至少 8 个字符，包含至少 1 个字母和 1 个数字"
              />

              <Input
                label="确认新密码"
                type="password"
                placeholder="再次输入新密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                error={
                  confirmPassword && newPassword !== confirmPassword
                    ? '两次输入的密码不一致'
                    : undefined
                }
              />

              {error && (
                <p className="text-sm text-error bg-error/5 border border-error/20 rounded-md px-3 py-2">
                  {error}
                </p>
              )}
              {success && (
                <p className="text-sm text-success bg-success/5 border border-success/20 rounded-md px-3 py-2">
                  {success} 即将跳转到登录页…
                </p>
              )}

              <Button type="submit" variant="primary" size="md" loading={loading} className="w-full mt-1">
                重置密码
              </Button>
            </form>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-muted mt-6">
          想起密码了？{' '}
          <Link to="/login" className="text-primary hover:underline font-medium">
            返回登录
          </Link>
        </p>
      </div>
    </div>
  );
}
