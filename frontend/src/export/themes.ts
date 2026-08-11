/**
 * 导出 PDF 的主题定义。
 * 主题通过根类（theme-warm / theme-bw / theme-academic）覆盖 CSS 变量，
 * 导出文档内嵌 <style> 全部使用这些变量（值均为具体 hex，html2canvas 兼容）。
 */
import type { ThemeKey } from './types';

export interface ThemeDef {
  key: ThemeKey;
  label: string;
  desc: string;
  /** 设置弹窗预览色块 */
  swatches: string[];
}

export const THEMES: ThemeDef[] = [
  { key: 'warm', label: '暖色', desc: '暖白底 · 珊瑚橙点缀', swatches: ['#ffffff', '#faf9f5', '#cc785c'] },
  { key: 'bw', label: '黑白简约', desc: '纯黑白 · 无彩色干扰', swatches: ['#ffffff', '#fafafa', '#111111'] },
  { key: 'academic', label: '蓝色学术', desc: '浅蓝底 · 深蓝点缀', swatches: ['#ffffff', '#f5f8fc', '#2e5e8e'] },
];

/**
 * 生成主题 CSS 变量字符串。
 * 变量清单：
 *  --paper 页面底色  --card 卡片底色  --accent 强调色  --ink 主文字
 *  --body 正文       --muted 次要文字 --line 分隔线/边框
 *  --tag-* 句子精讲四节标签 + 单词卡片彩色标签的配色
 */
export function buildThemeCss(theme: ThemeKey): string {
  switch (theme) {
    case 'bw':
      return [
        '--paper:#ffffff;--card:#fafafa;--accent:#111111;--ink:#111111;',
        '--body:#333333;--muted:#888888;--line:#dddddd;',
        '--sec1:#f2f2f2;--sec1c:#555555;--sec1b:#d5d5d5;',
        '--sec2:#f2f2f2;--sec2c:#555555;--sec2b:#d5d5d5;',
        '--sec3:#f2f2f2;--sec3c:#555555;--sec3b:#d5d5d5;',
        '--sec4:#f2f2f2;--sec4c:#555555;--sec4b:#d5d5d5;',
        '--tag-syn:#f5f5f5;--tag-synb:#d9d9d9;--tag-sync:#4a4a4a;',
        '--tag-cog:#f5f5f5;--tag-cogb:#d9d9d9;--tag-cogc:#4a4a4a;',
        '--tag-col:#f5f5f5;--tag-colb:#d9d9d9;--tag-colc:#4a4a4a;',
      ].join('');
    case 'academic':
      return [
        '--paper:#ffffff;--card:#f5f8fc;--accent:#2e5e8e;--ink:#16222e;',
        '--body:#3a4a5a;--muted:#6b7c8d;--line:#d5e0ee;',
        '--sec1:#fdf3ef;--sec1c:#b85c3a;--sec1b:#e8b4a0;',
        '--sec2:#f0f7f1;--sec2c:#4a7c59;--sec2b:#a3d4a8;',
        '--sec3:#eef2f8;--sec3c:#5a6d8a;--sec3b:#a8b8d4;',
        '--sec4:#fdf6e3;--sec4c:#8a6d3b;--sec4b:#e6d5a0;',
        '--tag-syn:#f0f7f1;--tag-synb:#c8e6c9;--tag-sync:#2e5e3c;',
        '--tag-cog:#fdf3ef;--tag-cogb:#e8c4b0;--tag-cogc:#7a4228;',
        '--tag-col:#eef2f8;--tag-colb:#c8ddf0;--tag-colc:#3a5a7a;',
      ].join('');
    case 'warm':
    default:
      return [
        '--paper:#ffffff;--card:#faf9f5;--accent:#cc785c;--ink:#141413;',
        '--body:#3d3d3a;--muted:#6c6a64;--line:#e6dfd8;',
        '--sec1:#fdf3ef;--sec1c:#b85c3a;--sec1b:#e8b4a0;',
        '--sec2:#f0f7f1;--sec2c:#4a7c59;--sec2b:#a3d4a8;',
        '--sec3:#eef2f8;--sec3c:#5a6d8a;--sec3b:#a8b8d4;',
        '--sec4:#fdf6e3;--sec4c:#8a6d3b;--sec4b:#e6d5a0;',
        '--tag-syn:#f0f7f1;--tag-synb:#c8e6c9;--tag-sync:#2e5e3c;',
        '--tag-cog:#fdf3ef;--tag-cogb:#e8c4b0;--tag-cogc:#7a4228;',
        '--tag-col:#eef2f8;--tag-colb:#c8ddf0;--tag-colc:#3a5a7a;',
      ].join('');
  }
}
