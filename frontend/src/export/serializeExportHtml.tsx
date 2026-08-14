/**
 * 导出 HTML 序列化：分页 DOM（ExportPages）→ 完整 HTML 字符串（POST 给后端 Chrome 渲染）。
 * 全量内联 CSS（与预览逐字节一致的样式表上下文）+ @page 规则。
 */
import ExportPages from './ExportPages';
import { PAPER_SIZES } from './exportTypes';
import type { ExportData } from './data';
import type { ExportPreferences } from './exportTypes';
import type { PagePlan } from './paginate';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 收集全部同源样式表规则（跳过跨域 sheet 与 @import） */
export function collectStylesheetsCss(): string {
  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 跨域样式表不可读
    }
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.IMPORT_RULE) continue; // Google Fonts @import 跨域
      try {
        css += rule.cssText + '\n';
      } catch {
        /* 单条失败忽略 */
      }
    }
  }
  return css;
}

export async function serializeExportHtml(
  data: ExportData,
  prefs: ExportPreferences,
  plan: PagePlan
): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const markup = renderToStaticMarkup(<ExportPages data={data} prefs={prefs} plan={plan} />);
  const css = collectStylesheetsCss();
  return [
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">',
    `<title>${escapeHtml(data.title)}</title><style>`,
    `@page { size: ${PAPER_SIZES[prefs.paperSize].pageSize}; margin: 0; }`,
    'html, body { margin: 0; padding: 0; }',
    css,
    '</style></head><body>',
    markup,
    '</body></html>',
  ].join('');
}
