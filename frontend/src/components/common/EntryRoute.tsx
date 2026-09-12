import { useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { hasVisitedLanding } from '../../services/visitStorage';
import { PageSpinner } from '../ui/Spinner';

interface Props {
  children: ReactNode;
}

/**
 * 站点入口闸门（挂在 `/`）：
 * 已登录 → 主页；首次访问 → 欢迎页；看过欢迎页但未登录 → 登录页。
 */
export default function EntryRoute({ children }: Props) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  // 一次启动只判定一次，避免渲染期反复读 storage
  const [firstVisit] = useState(() => !hasVisitedLanding());

  if (isLoading) {
    return <PageSpinner />;
  }

  if (isAuthenticated) {
    return <>{children}</>;
  }

  return <Navigate to={firstVisit ? '/welcome' : '/login'} replace />;
}
