/**
 * 共享的 react-markdown 安全组件。
 *
 * 全站所有 ReactMarkdown 调用点都应合并本组件，核心是 `a`（链接）的
 * 协议白名单：AI 输出与 OCR 文本是不可信内容，若其中含
 * `[点我](javascript:...)` / `[x](data:text/html,...)`，默认的 react-markdown
 * 会把它们渲染成可点击的脚本链接（存储型 XSS 面）。只放行 http/https/mailto，
 * 其余协议渲染为纯文本。
 */

import type { Components } from 'react-markdown';

/** 允许的链接协议（大小写不敏感，无 scheme 视为相对链接一并放行） */
const SAFE_LINK_RE = /^(https?:|mailto:)/i;

export const safeMarkdownComponents: Components = {
  a: ({ href, children, ...props }) => {
    const safe = href ? SAFE_LINK_RE.test(href) : true;
    if (!safe) {
      return <span>{children}</span>;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
};
