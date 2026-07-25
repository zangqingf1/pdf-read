import api from './api';

// ── Types ──

export interface AdminStats {
  total_users: number;
  total_documents: number;
  today_users: number;
  today_documents: number;
}

export interface AdminUserItem {
  id: string;
  email: string;
  nickname: string | null;
  is_active: boolean;
  is_superuser: boolean;
  document_count: number;
  created_at: string;
}

export interface AdminUserListResponse {
  users: AdminUserItem[];
  total: number;
}

export interface AdminDocumentItem {
  id: string;
  title: string | null;
  owner_email: string;
  owner_nickname: string | null;
  parse_status: string;
  page_count: number | null;
  word_count: number | null;
  created_at: string;
}

export interface AdminDocumentListResponse {
  documents: AdminDocumentItem[];
  total: number;
}

// ── API calls ──

export async function getAdminStats(): Promise<AdminStats> {
  const { data } = await api.get<AdminStats>('/admin/stats');
  return data;
}

export async function getAdminUsers(params: {
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminUserListResponse> {
  const { data } = await api.get<AdminUserListResponse>('/admin/users', { params });
  return data;
}

export async function updateAdminUser(
  userId: string,
  body: { is_active?: boolean; is_superuser?: boolean }
): Promise<void> {
  await api.put(`/admin/users/${userId}`, body);
}

export async function deleteAdminUser(userId: string): Promise<void> {
  await api.delete(`/admin/users/${userId}`);
}

export async function getAdminDocuments(params: {
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminDocumentListResponse> {
  const { data } = await api.get<AdminDocumentListResponse>('/admin/documents', { params });
  return data;
}

export async function deleteAdminDocument(docId: string): Promise<void> {
  await api.delete(`/admin/documents/${docId}`);
}

export interface AdminBatchDeleteResponse {
  deleted_count: number;
  failed_ids: string[];
  message: string;
}

export async function batchDeleteAdminDocuments(
  documentIds: string[]
): Promise<AdminBatchDeleteResponse> {
  const { data } = await api.post<AdminBatchDeleteResponse>(
    '/admin/documents/batch-delete',
    { document_ids: documentIds }
  );
  return data;
}
