import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { PageSpinner } from '../ui/Spinner';

interface Props {
  children: ReactNode;
}

export default function AdminRouteGuard({ children }: Props) {
  const isLoading = useAuthStore((s) => s.isLoading);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isSuperuser = useAuthStore((s) => s.user?.is_superuser ?? false);

  if (isLoading) return <PageSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isSuperuser) return <Navigate to="/" replace />;
  return <>{children}</>;
}
