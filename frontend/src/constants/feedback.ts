/**
 * 问题反馈 — 分类与状态的展示元数据。
 * 取值须与后端 app/schemas/feedback.py 的 CATEGORY_VALUES / STATUS_VALUES 一致。
 */

export type FeedbackCategory = 'bug' | 'feature' | 'content' | 'other';
export type FeedbackStatus = 'pending' | 'processing' | 'resolved' | 'ignored';

export type FeedbackBadgeVariant = 'default' | 'coral' | 'success' | 'warning';

export interface FeedbackCategoryMeta {
  value: FeedbackCategory;
  label: string;
}

export interface FeedbackStatusMeta {
  value: FeedbackStatus;
  label: string;
  variant: FeedbackBadgeVariant;
}

export const FEEDBACK_CATEGORIES: FeedbackCategoryMeta[] = [
  { value: 'bug', label: '功能异常' },
  { value: 'feature', label: '体验建议' },
  { value: 'content', label: '内容问题' },
  { value: 'other', label: '其他' },
];

export const FEEDBACK_STATUSES: FeedbackStatusMeta[] = [
  { value: 'pending', label: '待处理', variant: 'warning' },
  { value: 'processing', label: '处理中', variant: 'coral' },
  { value: 'resolved', label: '已解决', variant: 'success' },
  { value: 'ignored', label: '已忽略', variant: 'default' },
];

const CATEGORY_MAP = new Map(FEEDBACK_CATEGORIES.map((c) => [c.value, c]));
const STATUS_MAP = new Map(FEEDBACK_STATUSES.map((s) => [s.value, s]));

export function feedbackCategoryLabel(value: string): string {
  return CATEGORY_MAP.get(value as FeedbackCategory)?.label ?? value;
}

export function feedbackStatusMeta(value: string): FeedbackStatusMeta {
  return (
    STATUS_MAP.get(value as FeedbackStatus) ?? {
      value: value as FeedbackStatus,
      label: value,
      variant: 'default',
    }
  );
}

/** 截图上限于后端 FEEDBACK_MAX_MB / FEEDBACK_MAX_IMAGES / FEEDBACK_MAX_TOTAL_MB 保持一致 */
export const FEEDBACK_MAX_IMAGE_MB = 5;
export const FEEDBACK_MAX_IMAGES = 9;
export const FEEDBACK_MAX_TOTAL_MB = 20;
export const FEEDBACK_MAX_CONTENT = 2000;
