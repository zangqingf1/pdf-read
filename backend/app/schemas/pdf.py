"""Pydantic schemas for PDF upload and parsing (F01)."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class PDFUploadResponse(BaseModel):
    task_id: str
    status: str = "processing"
    page_count: int | None = None
    source_type: str | None = None  # "upload" | "url"
    file_ext: str | None = None  # ".pdf" ".docx" ".html" ...


class PDFStatusResponse(BaseModel):
    task_id: str
    status: str  # pending / processing / completed / failed / awaiting_selection
    progress: int = 0  # 0-100
    error: Optional[str] = None
    page_count: int | None = None
    selected_pages: list[int] | None = None
    source_type: str | None = None
    file_ext: str | None = None


class ParagraphResult(BaseModel):
    index: int
    text: str
    text_zh: str | None = None
    page_number: int | None = None
    # MinerU 布局框（PDF 源）: {"box":[x1,y1,x2,y2], "pts_w":.., "pts_h":..}
    # box 为 MinerU 渲染图像像素坐标；pts_w/pts_h 为该页 PDF 点数尺寸。
    # 非 PDF / 无坐标时为 None。
    layout: dict | None = None


class WordAnalysisItem(BaseModel):
    id: str
    paragraph_index: int
    word: str
    phonetic: str = ""
    part_of_speech: str = ""
    definition: str = ""
    definition_zh: str = ""
    collocations: list[str] = Field(default_factory=list)
    example_sentence: str = ""
    cognates: list[dict] = Field(default_factory=list)
    synonyms_antonyms: dict = Field(default_factory=lambda: {"synonyms": []})
    base_form: str = ""
    plural_form: str = ""
    exam_tags: list[str] = Field(default_factory=list)


class PDFResultResponse(BaseModel):
    document_id: str
    title: Optional[str] = None
    title_zh: Optional[str] = None
    source: Optional[str] = None
    paragraphs: list[ParagraphResult]
    word_count: int
    paragraph_count: int
    word_analyses: list[WordAnalysisItem] = Field(default_factory=list)
    sentence_analyses: list = Field(default_factory=list)
    page_count: int | None = None
    selected_pages: list[int] | None = None
    source_type: str | None = None
    file_ext: str | None = None
    summary: Optional[str] = None
    summary_updated_at: Optional[datetime] = None
    is_favorite: bool = False


class ParseUrlRequest(BaseModel):
    """提交 URL 解析（文件链接或 HTML 网页）。"""

    url: str = Field(..., min_length=1, max_length=2000)
    mineru_token: str = ""  # User's MinerU token (from frontend localStorage)


class SelectPagesRequest(BaseModel):
    task_id: str
    selected_pages: list[int] | None = Field(
        default=None, max_length=10
    )  # None = parse all pages
    mineru_token: str = ""  # User's MinerU token (from frontend localStorage)


class SelectPagesResponse(BaseModel):
    task_id: str
    status: str
    selected_pages: list[int]
    message: str


class DocumentListItem(BaseModel):
    id: str
    title: Optional[str] = None
    source: Optional[str] = None
    word_count: Optional[int] = None
    parse_status: str
    source_type: Optional[str] = None
    file_ext: Optional[str] = None
    created_at: datetime
    is_favorite: bool = False


class DocumentListResponse(BaseModel):
    documents: list[DocumentListItem]
    total: int


class SetFavoriteRequest(BaseModel):
    """设置/取消文档收藏。"""

    is_favorite: bool


class SetFavoriteResponse(BaseModel):
    document_id: str
    is_favorite: bool


class UpdateTitleRequest(BaseModel):
    """修改文档大标题。"""

    title: str = Field(..., min_length=1, max_length=500)


class UpdateTitleResponse(BaseModel):
    document_id: str
    title: str
    title_zh: str | None = None


class UpdateParagraphItem(BaseModel):
    index: int
    text_en: str = Field(..., min_length=0, max_length=50000)


class UpdateParagraphsRequest(BaseModel):
    paragraphs: list[UpdateParagraphItem]


class UpdateParagraphsResponse(BaseModel):
    document_id: str
    updated_count: int


class DeleteParagraphResponse(BaseModel):
    document_id: str
    deleted_index: int
    message: str


class MergeParagraphsRequest(BaseModel):
    index_a: int = Field(..., description="Index of the upper paragraph to keep")
    index_b: int = Field(..., description="Index of the lower paragraph to merge into index_a")


class MergeParagraphsResponse(BaseModel):
    document_id: str
    merged_index: int
    message: str


class ReorderParagraphsRequest(BaseModel):
    ordered_indices: list[int] = Field(
        ..., description="New order of paragraph indices, e.g. [3, 1, 0, 2]"
    )


class ReorderParagraphsResponse(BaseModel):
    document_id: str
    message: str


class BatchDeleteRequest(BaseModel):
    document_ids: list[str] = Field(..., min_length=1, max_length=100)


class BatchDeleteResponse(BaseModel):
    deleted_count: int
    failed_ids: list[str] = Field(default_factory=list)
    message: str


class RetryDocumentRequest(BaseModel):
    mineru_token: str = ""  # User's MinerU token (from frontend localStorage)


class PDFExportRequest(BaseModel):
    """导出 PDF：前端序列化后的完整 HTML（含内联 CSS 与 @page 规则）。"""

    html: str = Field(..., min_length=1)
