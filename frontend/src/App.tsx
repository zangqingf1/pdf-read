import { Component, type ReactNode } from 'react';
import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ReaderPage from './pages/ReaderPage';
import ReviewPage from './pages/ReviewPage';

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
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-canvas">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/document/:id" element={<ReaderPage />} />
          <Route path="/review/:id" element={<ReviewPage />} />
        </Routes>
      </div>
    </ErrorBoundary>
  );
}
