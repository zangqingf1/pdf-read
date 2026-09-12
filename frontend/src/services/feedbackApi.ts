import api from './api';

// ── 用户侧 ──

export interface FeedbackItem {
  id: number;
  category: string;
  content: string;
  contact: string | null;
  image_count: number;
  status: string;
  admin_reply: string | null;
  replied_at: string | null;
  created_at: string;
}

export interface FeedbackListResponse {
  feedbacks: FeedbackItem[];
  total: number;
}

export interface SubmitFeedbackInput {
  category: string;
  content: string;
  contact?: string;
  images?: File[];
}

/** 提交反馈（multipart，截图可选，最多 9 张）。 */
export async function submitFeedback(input: SubmitFeedbackInput): Promise<FeedbackItem> {
  const form = new FormData();
  form.append('category', input.category);
  form.append('content', input.content);
  if (input.contact?.trim()) form.append('contact', input.contact.trim());
  for (const file of input.images ?? []) form.append('images', file);
  const { data } = await api.post<FeedbackItem>('/feedback', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function getMyFeedback(params: {
  limit?: number;
  offset?: number;
}): Promise<FeedbackListResponse> {
  const { data } = await api.get<FeedbackListResponse>('/feedback/mine', { params });
  return data;
}

/**
 * 取第 index 张反馈截图并转成可放进 <img src> 的 blob URL
 * （端点需要鉴权，不能直接引用）。
 */
export async function fetchFeedbackImageUrl(
  feedbackId: number,
  index: number,
): Promise<string> {
  const { data } = await api.get(`/feedback/${feedbackId}/images/${index}`, {
    responseType: 'blob',
  });
  return URL.createObjectURL(data);
}

// ── 管理后台 ──

export interface AdminFeedbackItem extends FeedbackItem {
  user_id: string;
  user_email: string;
  user_nickname: string | null;
}

export interface AdminFeedbackListResponse {
  feedbacks: AdminFeedbackItem[];
  total: number;
}

export interface AdminFeedbackUpdatePayload {
  status?: string;
  admin_reply?: string;
}

export async function getAdminFeedback(params: {
  search?: string;
  status?: string | null;
  limit?: number;
  offset?: number;
}): Promise<AdminFeedbackListResponse> {
  const { data } = await api.get<AdminFeedbackListResponse>('/admin/feedback', { params });
  return data;
}

export async function updateAdminFeedback(
  feedbackId: number,
  body: AdminFeedbackUpdatePayload,
): Promise<AdminFeedbackItem> {
  const { data } = await api.put<AdminFeedbackItem>(`/admin/feedback/${feedbackId}`, body);
  return data;
}

export async function deleteAdminFeedback(feedbackId: number): Promise<void> {
  await api.delete(`/admin/feedback/${feedbackId}`);
}

/** 统一提取后端 detail 文案（与 ProfilePage/RegisterPage 的本地写法一致）。 */
export function extractFeedbackError(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data
    ?.detail;
  return detail || fallback;
}
