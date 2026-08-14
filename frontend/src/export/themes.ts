/**
 * 导出 PDF 的主题元数据（设置弹窗选择器用）。
 * 主题变量值落在 index.css 的 .theme-warm/.theme-bw/.theme-academic 上。
 */
import type { ThemeKey } from './exportTypes';

export interface ThemeDef {
  key: ThemeKey;
  label: string;
  desc: string;
  /** 设置弹窗预览色块 */
  swatches: string[];
}

export const THEMES: ThemeDef[] = [
  { key: 'warm', label: '暖色', desc: '暖白底 · 珊瑚橙点缀', swatches: ['#ffffff', '#faf9f5', '#c87455'] },
  { key: 'bw', label: '黑白简约', desc: '纯黑白 · 无彩色干扰', swatches: ['#ffffff', '#fafafa', '#111111'] },
  { key: 'academic', label: '蓝色学术', desc: '浅蓝底 · 深蓝点缀', swatches: ['#ffffff', '#f5f8fc', '#2e5e8e'] },
];
