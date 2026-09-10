"""Schemas for the document Q&A chat API."""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class QaStreamRequest(BaseModel):
    """One user turn of the document Q&A conversation (SSE)."""

    document_id: str = Field(..., min_length=1)
    question: str = Field(..., min_length=1, max_length=4000)
    # Which prompt template drives this turn.  Quiz turns ("doc_quiz") get the
    # quiz system prompt; follow-up answers/批改 stay on the same conversation.
    prompt_name: Literal["doc_qa", "doc_quiz"] = "doc_qa"
    # Optional quoted sentence the question is about (from the reader panel).
    target_paragraph_index: Optional[int] = Field(None, ge=0)
    target_sentence: Optional[str] = Field(None, max_length=4000)
    # Index of the quoted sentence within its paragraph — lets the quote chip
    # jump back to the exact sentence after the conversation is reloaded.
    target_sentence_index: Optional[int] = Field(None, ge=0)
    api_key: Optional[str] = None
    provider: Optional[Literal["deepseek"]] = None


class QaMessageOut(BaseModel):
    id: int
    role: Literal["user", "assistant"]
    content: str
    prompt_name: Optional[str] = None
    paragraph_index: Optional[int] = None
    sentence_index: Optional[int] = None
    sentence_text: Optional[str] = None
    created_at: str


class QaMessagesResponse(BaseModel):
    document_id: str
    messages: list[QaMessageOut]


class QaClearResponse(BaseModel):
    document_id: str
    deleted: int
