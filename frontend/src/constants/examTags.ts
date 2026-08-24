/**
 * 考纲标签 — 由后端基于本地 ECDICT（tag 列）确定性生成，
 * 前端只负责展示与显隐过滤。
 */

export interface ExamTagMeta {
  /** 展示名 */
  label: string;
  /** 徽章配色（Tailwind 类）：底色 + 边框 + 文字 */
  className: string;
  /** 原始色值（导出 PDF 内联样式用，须与 className 视觉一致） */
  colors: { bg: string; border: string; text: string };
}

/** 全部考纲标签（固定顺序） */
export const EXAM_TAGS: ExamTagMeta[] = [
  { label: '初中', className: 'bg-[#eef7ee] border-[#bfe0bf] text-[#4a7c59]', colors: { bg: '#eef7ee', border: '#bfe0bf', text: '#4a7c59' } },
  { label: '高中', className: 'bg-[#eaf3ec] border-[#a9d4b2] text-[#3e6e4c]', colors: { bg: '#eaf3ec', border: '#a9d4b2', text: '#3e6e4c' } },
  { label: '四级', className: 'bg-[#eef4fa] border-[#bcd6ee] text-[#4a6d96]', colors: { bg: '#eef4fa', border: '#bcd6ee', text: '#4a6d96' } },
  { label: '六级', className: 'bg-[#e8eff8] border-[#a5c4e4] text-[#3d5f8a]', colors: { bg: '#e8eff8', border: '#a5c4e4', text: '#3d5f8a' } },
  { label: '考研', className: 'bg-[#fdf1ea] border-[#eecdb5] text-[#b06a3d]', colors: { bg: '#fdf1ea', border: '#eecdb5', text: '#b06a3d' } },
  { label: '雅思', className: 'bg-[#f2eefa] border-[#d4c6ea] text-[#6f5a9e]', colors: { bg: '#f2eefa', border: '#d4c6ea', text: '#6f5a9e' } },
  { label: '托福', className: 'bg-[#edeafa] border-[#c5bae8] text-[#5f4d94]', colors: { bg: '#edeafa', border: '#c5bae8', text: '#5f4d94' } },
  { label: 'GRE', className: 'bg-[#f0ebf5] border-[#cdbedd] text-[#7a5f92]', colors: { bg: '#f0ebf5', border: '#cdbedd', text: '#7a5f92' } },
];

const EXAM_TAG_MAP = new Map(EXAM_TAGS.map((t) => [t.label, t]));

export function examTagMeta(label: string): ExamTagMeta | undefined {
  return EXAM_TAG_MAP.get(label);
}

export const ALL_EXAM_TAG_LABELS = EXAM_TAGS.map((t) => t.label);

/** 过滤出用户选择显示的标签，并按固定顺序输出（忽略未知标签） */
export function filterVisibleExamTags(
  tags: string[] | undefined | null,
  visible: string[],
): string[] {
  if (!tags || tags.length === 0) return [];
  const visibleSet = new Set(visible);
  const tagSet = new Set(tags);
  return EXAM_TAGS.filter((t) => tagSet.has(t.label) && visibleSet.has(t.label)).map(
    (t) => t.label,
  );
}
