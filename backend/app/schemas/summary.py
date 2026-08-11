"""Pydantic schemas for full-document summary (AI generate / revise / draft save)."""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class SummaryRequest(BaseModel):
    document_id: str  # 必填 — 所有权校验 + 后端自取全文
    mode: Literal["generate", "revise"]  # generate=一键总结; revise=AI 修改
    user_summary: Optional[str] = None  # revise 模式的草稿; generate 模式忽略
    api_key: Optional[str] = None
    provider: Optional[Literal["deepseek"]] = None


class SummaryDraftRequest(BaseModel):
    document_id: str
    summary: str = Field(..., max_length=20000)


class SummaryDraftResponse(BaseModel):
    document_id: str
    saved: bool = True
