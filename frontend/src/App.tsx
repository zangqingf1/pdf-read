import { Component, type ReactNode } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Result, Button } from 'antd';
import HomePage from './pages/HomePage';
import ReaderPage from './pages/ReaderPage';

// Error boundary to catch React rendering crashes
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
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-8">
          <Result
            status="error"
            title="页面加载出错"
            subTitle={this.state.error?.message || '未知错误'}
            extra={
              <Button
                type="primary"
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.href = '/';
                }}
              >
                返回首页
              </Button>
            }
          />
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/document/:id" element={<ReaderPage />} />
        </Routes>
      </div>
    </ErrorBoundary>
  );
}
