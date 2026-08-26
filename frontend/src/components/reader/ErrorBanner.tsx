import type { ReactNode } from 'react';

interface ErrorBannerProps {
  message: string;
  /** 可选右侧操作（如「关闭」按钮） */
  action?: ReactNode;
  className?: string;
}

/** 阅读页通用错误横幅（暖色纸感体系的错误态） */
export default function ErrorBanner({ message, action, className = '' }: ErrorBannerProps) {
  return (
    <div
      className={`p-3 bg-error/10 border border-error/20 rounded-md text-sm text-error flex items-center justify-between gap-2 ${className}`}
      role="alert"
    >
      <span>{message}</span>
      {action}
    </div>
  );
}
