/**
 * 导出 HTML 序列化：分页 DOM（ExportPages）→ 完整 HTML 字符串（POST 给后端 Chrome 渲染）。
 * 全量内联 CSS（与预览逐字节一致的样式表上下文）+ @page 规则。
 */
import ExportPages from './ExportPages';
import { useReaderStore } from '../stores/readerStore';
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

/** 收集全部同源样式表规则（跳过跨域 sheet 与非导出字体 @import/@font-face）。
 *  模块级缓存：同源样式表在会话内基本不变，重复导出不再重新拼接全部规则。 */
let _cssCache: { fingerprint: string; css: string } | null = null;

export function collectStylesheetsCss(): string {
  const sheets = Array.from(document.styleSheets);
  // 指纹 = 每个 sheet 的 href + 规则数（廉价）；规则数不变即视为未变
  const fingerprint = sheets
    .map((s) => `${s.href ?? 'inline'}:${s.cssRules?.length ?? -1}`)
    .join('|');
  if (_cssCache && _cssCache.fingerprint === fingerprint) {
    return _cssCache.css;
  }

  let css = '';
  for (const sheet of sheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 跨域样式表不可读
    }
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.IMPORT_RULE) continue; // 外部 @import 无法随导出携带
      // 只保留导出文档实际用到的字体（Source Serif 4 衬线正文），其余 @font-face 剔除，
      // 避免无谓增大导出 HTML（Cormorant/Inter/JetBrains 仅页面 UI 使用）
      if (rule.type === CSSRule.FONT_FACE_RULE && !/font-family:\s*['"]?Source Serif 4/i.test(rule.cssText)) {
        continue;
      }
      try {
        css += rule.cssText + '\n';
      } catch {
        /* 单条失败忽略 */
      }
    }
  }
  _cssCache = { fingerprint, css };
  return css;
}

/** 字体 data URI 缓存：同一字体文件只在会话内拉取/base64 一次 */
const _fontDataCache = new Map<string, string>();

/** 将导出 CSS 中的本地字体 url 内联为 data URI（服务端 Chrome 渲染 file:// 临时 HTML 无法解析 /fonts/ 相对路径） */
export async function inlineLocalFonts(css: string): Promise<string> {
  const urlRe = /url\((['"]?)(\/fonts\/[a-z0-9-]+\.woff2)\1\)/g;
  const urls = [...new Set(Array.from(css.matchAll(urlRe)).map((m) => m[2]))];
  if (urls.length === 0) return css;
  const cache = new Map<string, string>();
  await Promise.all(
    urls.map(async (u) => {
      const cached = _fontDataCache.get(u);
      if (cached) {
        cache.set(u, cached);
        return;
      }
      try {
        const resp = await fetch(u);
        if (!resp.ok) return;
        const buf = await resp.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        const data = `data:font/woff2;base64,${btoa(bin)}`;
        _fontDataCache.set(u, data);
        cache.set(u, data);
      } catch {
        /* 保留原 url（本地预览/开发环境仍可解析） */
      }
    })
  );
  if (cache.size === 0) return css;
  let out = css;
  for (const [u, data] of cache) {
    out = out.split(`url("${u}")`).join(`url("${data}")`).split(`url('${u}')`).join(`url('${data}')`).split(`url(${u})`).join(`url(${data})`);
  }
  return out;
}

export async function serializeExportHtml(
  data: ExportData,
  prefs: ExportPreferences,
  plan: PagePlan
): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  // renderToStaticMarkup 下 Zustand hook 会返回未水合默认值，必须 getState() 取当前值显式传入
  const markup = renderToStaticMarkup(
    <ExportPages data={data} prefs={prefs} plan={plan} textAlign={useReaderStore.getState().textAlign} />
  );
  const css = await inlineLocalFonts(collectStylesheetsCss());
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
