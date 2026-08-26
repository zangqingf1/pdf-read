import api from './api';

export interface PDFUploadResponse {
  task_id: string;
  status: string;
  page_count?: number | null;
  source_type?: string | null;  // "upload" | "url"
  file_ext?: string | null;     // ".pdf" ".docx" ".html" ...
}

export interface PDFStatusResponse {
  task_id: string;
  status: string;
  progress: number;
  error?: string;
  page_count?: number | null;
  selected_pages?: number[] | null;
  source_type?: string | null;
  file_ext?: string | null;
}

/** MinerU 布局框：box 为渲染图像像素 [x1,y1,x2,y2]，pts_w/pts_h 为该页 PDF 点数尺寸 */
export interface PdfLayout {
  box: number[];
  pts_w: number;
  pts_h: number;
  /** 该页 MinerU 渲染缩放（图像像素/PDF 点），旧数据可能缺失 */
  scale?: number;
}

export interface ParagraphResult {
  index: number;
  text: string;
  text_zh?: string | null;
  page_number?: number | null;
  /** PDF 源的 MinerU 布局框；非 PDF / 旧文档为 null */
  layout?: PdfLayout | null;
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
  /** 考纲标签（后端 ECDICT 离线判定） */
  exam_tags: string[];
}

export interface PDFResultResponse {
  document_id: string;
  title?: string;
  /** 大标题中文翻译（段落翻译流程持久化） */
  title_zh?: string | null;
  source?: string;
  paragraphs: ParagraphResult[];
  word_count: number;
  paragraph_count: number;
  word_analyses: WordAnalysisItem[];
  sentence_analyses: any[];
  page_count?: number | null;
  selected_pages?: number[] | null;
  source_type?: string | null;
  file_ext?: string | null;
  summary?: string | null;
  summary_updated_at?: string | null;
  is_favorite?: boolean;
}

export interface ParseUrlRequest {
  url: string;
  mineru_token?: string;
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
  source_type?: string | null;
  file_ext?: string | null;
  created_at: string;
  is_favorite?: boolean;
}

export interface DocumentListResponse {
  documents: DocumentListItem[];
  total: number;
}

export interface UpdateParagraphsResponse {
  document_id: string;
  updated_count: number;
}

export interface UpdateTitleResponse {
  document_id: string;
  title: string;
  title_zh?: string | null;
}

/** 修改文档大标题（后端同时清空旧的中文翻译，随翻译流程自动重译） */
export async function updateDocumentTitle(
  taskId: string,
  title: string
): Promise<UpdateTitleResponse> {
  const { data } = await api.put<UpdateTitleResponse>(
    `/pdf/documents/${taskId}/title`,
    { title }
  );
  return data;
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

/** 提交 URL 解析（文件链接或 HTML 网页），后端下载后走 MinerU。 */
export async function parseUrl(
  url: string,
  mineruToken?: string
): Promise<PDFUploadResponse> {
  const body: ParseUrlRequest = { url };
  if (mineruToken) {
    body.mineru_token = mineruToken;
  }
  const { data } = await api.post<PDFUploadResponse>('/pdf/parse-url', body, {
    timeout: 120000,
  });
  return data;
}

export async function getPDFResult(taskId: string): Promise<PDFResultResponse> {
  const { data } = await api.get<PDFResultResponse>(`/pdf/result/${taskId}`);
  return data;
}

export async function listDocuments(
  limit: number = 20,
  offset: number = 0,
  favoriteOnly: boolean = false
): Promise<DocumentListResponse> {
  const { data } = await api.get<DocumentListResponse>('/pdf/documents', {
    params: { limit, offset, favorite: favoriteOnly || undefined },
  });
  return data;
}

export interface SetFavoriteResponse {
  document_id: string;
  is_favorite: boolean;
}

/** 设置/取消文档收藏 */
export async function setFavorite(
  taskId: string,
  isFavorite: boolean
): Promise<SetFavoriteResponse> {
  const { data } = await api.put<SetFavoriteResponse>(
    `/pdf/documents/${taskId}/favorite`,
    { is_favorite: isFavorite }
  );
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

/** 导出 PDF：POST 序列化 HTML → 后端 Chrome 无头渲染 → 文件流 */
export async function exportPdf(html: string): Promise<Blob> {
  const { data } = await api.post('/pdf/export', { html }, { responseType: 'blob', timeout: 120000 });
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

export async function retryDocument(taskId: string, mineruToken?: string): Promise<PDFUploadResponse> {
  const body: Record<string, string> = {};
  if (mineruToken) {
    body.mineru_token = mineruToken;
  }
  const { data } = await api.post<PDFUploadResponse>(`/pdf/retry/${taskId}`, body);
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
