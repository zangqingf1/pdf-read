import api from './api';

export interface PDFUploadResponse {
  task_id: string;
  status: string;
}

export interface PDFStatusResponse {
  task_id: string;
  status: string;
  progress: number;
  error?: string;
}

export interface ParagraphResult {
  index: number;
  text: string;
  text_zh?: string | null;
}

export interface PDFResultResponse {
  document_id: string;
  title?: string;
  source?: string;
  paragraphs: ParagraphResult[];
  word_count: number;
  paragraph_count: number;
}

export interface DocumentListItem {
  id: string;
  title?: string;
  source?: string;
  word_count?: number;
  parse_status: string;
  created_at: string;
}

export interface DocumentListResponse {
  documents: DocumentListItem[];
  total: number;
}

export async function uploadPDF(
  file: File,
  mineruToken?: string
): Promise<PDFUploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  if (mineruToken) {
    formData.append('mineru_token', mineruToken);
  }
  const { data } = await api.post<PDFUploadResponse>('/pdf/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  return data;
}

export async function getPDFStatus(taskId: string): Promise<PDFStatusResponse> {
  const { data } = await api.get<PDFStatusResponse>(`/pdf/status/${taskId}`);
  return data;
}

export async function getPDFResult(taskId: string): Promise<PDFResultResponse> {
  const { data } = await api.get<PDFResultResponse>(`/pdf/result/${taskId}`);
  return data;
}

export async function listDocuments(
  limit: number = 20,
  offset: number = 0
): Promise<DocumentListResponse> {
  const { data } = await api.get<DocumentListResponse>('/pdf/documents', {
    params: { limit, offset },
  });
  return data;
}
