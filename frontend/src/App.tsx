import { Component, lazy, Suspense, type ReactNode, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/common/ProtectedRoute';
import AdminRouteGuard from './components/admin/AdminRouteGuard';
import AdminLayout from './components/admin/AdminLayout';
import { PageSpinner } from './components/ui/Spinner';
import { useAuthStore } from './stores/authStore';

// 路由级代码分割：react-pdf/pdfjs、导出管线、admin 页面等重依赖
// 只在进入对应路由时才下载，主 chunk 不再背负全部页面。
const HomePage = lazy(() => import('./pages/HomePage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const ReaderPage = lazy(() => import('./pages/ReaderPage'));
const ReviewPage = lazy(() => import('./pages/ReviewPage'));
const VocabularyPage = lazy(() => import('./pages/VocabularyPage'));
const SrsReviewPage = lazy(() => import('./pages/SrsReviewPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminDocuments = lazy(() => import('./pages/admin/AdminDocuments'));
const AdminPrompts = lazy(() => import('./pages/admin/AdminPrompts'));
const AdminQuotes = lazy(() => import('./pages/admin/AdminQuotes'));

// ── Error Boundary (no Ant Design dependency) ──
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-canvas">
          <div className="text-center max-w-md px-6">
            <div className="text-5xl mb-4 font-display text-muted-soft">!</div>
            <h2 className="text-display-sm text-ink mb-2">页面加载出错</h2>
            <p className="text-muted mb-6 text-sm">
              {this.state.error?.message || '发生了未知错误'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.href = '/';
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary rounded-md font-medium text-sm hover:bg-primary-active transition-colors"
            >
              返回首页
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const initialize = useAuthStore((s) => s.initialize);

  // Validate stored token on app mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-canvas">
        <Suspense fallback={<PageSpinner />}>
          <Routes>
          {/* Public routes */}
          <Route path="/welcome" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />

          {/* Protected routes */}
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />

          {/* Protected routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <HomePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/document/:id"
            element={
              <ProtectedRoute>
                <ReaderPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/review/:id"
            element={
              <ProtectedRoute>
                <ReviewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vocabulary"
            element={
              <ProtectedRoute>
                <VocabularyPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/srs"
            element={
              <ProtectedRoute>
                <SrsReviewPage />
              </ProtectedRoute>
            }
          />

          {/* Admin routes */}
          <Route
            path="/admin"
            element={
              <AdminRouteGuard>
                <AdminLayout />
              </AdminRouteGuard>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="documents" element={<AdminDocuments />} />
            <Route path="prompts" element={<AdminPrompts />} />
            <Route path="quotes" element={<AdminQuotes />} />
          </Route>
        </Routes>
        </Suspense>
      </div>
    </ErrorBoundary>
  );
}
