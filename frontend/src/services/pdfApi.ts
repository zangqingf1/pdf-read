import api from './api';

export interface PDFUploadResponse {
  task_id: string;
  status: string;
  page_count?: number | null;
}

export interface PDFStatusResponse {
  task_id: string;
  status: string;
  progress: number;
  error?: string;
  page_count?: number | null;
  selected_pages?: number[] | null;
}

export interface ParagraphResult {
  index: number;
  text: string;
  text_zh?: string | null;
  page_number?: number | null;
}

export interface WordAnalysisItem {
  id: string;
  paragraph_index: number;
  word: string;
  phonetic: string;
  part_of_speech: string;
  definition: string;
  definition_zh: string;
  collocations: string[];
  example_sentence: string;
  cognates: Array<{ word: string; part_of_speech: string }>;
  synonyms_antonyms: {
    synonyms: Array<{ word: string; part_of_speech: string }>;
  };
  base_form: string;
  plural_form: string;
}

export interface PDFResultResponse {
  document_id: string;
  title?: string;
  source?: string;
  paragraphs: ParagraphResult[];
  word_count: number;
  paragraph_count: number;
  word_analyses: WordAnalysisItem[];
  sentence_analyses: any[];
  page_count?: number | null;
  selected_pages?: number[] | null;
  summary?: string | null;
  summary_updated_at?: string | null;
}

export interface SelectPagesRequest {
  task_id: string;
  selected_pages: number[] | null;  // null = parse all pages
  mineru_token?: string;
}

export interface SelectPagesResponse {
  task_id: string;
  status: string;
  selected_pages: number[];
  message: string;
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

export interface UpdateParagraphsResponse {
  document_id: string;
  updated_count: number;
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

export async function selectPages(
  body: SelectPagesRequest
): Promise<SelectPagesResponse> {
  const { data } = await api.post<SelectPagesResponse>('/pdf/select-pages', body);
  return data;
}

/** Get the URL for serving the raw PDF file (used for preview thumbnails). */
export function getPDFFileUrl(taskId: string): string {
  return `/api/v1/pdf/file/${taskId}`;
}

/**
 * Fetch PDF file as a Blob through the axios instance (includes auth header).
 * Use this when react-pdf needs to load a PDF that requires authentication.
 */
export async function fetchPDFBlob(taskId: string): Promise<Blob> {
  const { data } = await api.get(`/pdf/file/${taskId}`, {
    responseType: 'blob',
  });
  return data;
}

export async function deleteDocument(taskId: string): Promise<void> {
  await api.delete(`/pdf/documents/${taskId}`);
}

export interface BatchDeleteRequest {
  document_ids: string[];
}

export interface BatchDeleteResponse {
  deleted_count: number;
  failed_ids: string[];
  message: string;
}

export async function batchDeleteDocuments(
  documentIds: string[]
): Promise<BatchDeleteResponse> {
  const { data } = await api.post<BatchDeleteResponse>(
    '/pdf/documents/batch-delete',
    { document_ids: documentIds }
  );
  return data;
}

export async function retryDocument(taskId: string): Promise<PDFUploadResponse> {
  const { data } = await api.post<PDFUploadResponse>(`/pdf/retry/${taskId}`);
  return data;
}

export async function updateParagraphs(
  taskId: string,
  paragraphs: { index: number; text_en: string }[]
): Promise<UpdateParagraphsResponse> {
  const { data } = await api.put<UpdateParagraphsResponse>(
    `/pdf/documents/${taskId}/paragraphs`,
    { paragraphs }
  );
  return data;
}

export interface DeleteParagraphResponse {
  document_id: string;
  deleted_index: number;
  message: string;
}

export async function deleteParagraph(
  taskId: string,
  paragraphIndex: number
): Promise<DeleteParagraphResponse> {
  const { data } = await api.delete<DeleteParagraphResponse>(
    `/pdf/documents/${taskId}/paragraphs/${paragraphIndex}`
  );
  return data;
}

export interface MergeParagraphsResponse {
  document_id: string;
  merged_index: number;
  message: string;
}

export async function mergeParagraphs(
  taskId: string,
  indexA: number,
  indexB: number
): Promise<MergeParagraphsResponse> {
  const { data } = await api.post<MergeParagraphsResponse>(
    `/pdf/documents/${taskId}/paragraphs/merge`,
    { index_a: indexA, index_b: indexB }
  );
  return data;
}

export interface ReorderParagraphsResponse {
  document_id: string;
  message: string;
}

export async function reorderParagraphs(
  taskId: string,
  orderedIndices: number[]
): Promise<ReorderParagraphsResponse> {
  const { data } = await api.put<ReorderParagraphsResponse>(
    `/pdf/documents/${taskId}/paragraphs/reorder`,
    { ordered_indices: orderedIndices }
  );
  return data;
}
