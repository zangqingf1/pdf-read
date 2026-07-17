"""Pydantic schemas for paragraph translation."""

import re

from pydantic import BaseModel, Field, field_validator


class TranslateRequest(BaseModel):
    paragraphs: list[str] = Field(..., min_length=1)
    api_key: str | None = Field(
        default=None, description="DeepSeek API key (uses server default if empty)"
    )
    document_id: str | None = Field(
        default=None, description="If set, save translations to DB for this document"
    )


class TranslateResponse(BaseModel):
    translations: list[str]


class ExplainWordRequest(BaseModel):
    words: list[str] = Field(..., min_length=1, max_length=100)
    context: str = Field(..., min_length=1, max_length=5000)
    api_key: str | None = Field(default=None)


class WordExample(BaseModel):
    en: str = ""
    zh: str = ""


class PhraseItem(BaseModel):
    en: str = ""
    zh: str = ""


class WordExplanationItem(BaseModel):
    word: str = ""
    phonetic: str = ""
    context_sentence: str = ""
    context_sentence_zh: str = ""
    pos: str = ""
    definition_en: str = ""
    definition_zh: str = ""
    phrases: list[PhraseItem] = Field(default_factory=list)
    examples: list[WordExample] = Field(default_factory=list)

    @field_validator("phrases", mode="before")
    @classmethod
    def coerce_phrases(cls, v: list) -> list:
        """Accept either string phrases (old format) or {en,zh} dicts (new format)."""
        result = []
        for item in v:
            if isinstance(item, str):
                # Try to split "English phrase Chinese翻译" into en/zh
                m = re.match(r"^(.+?)\s+([一-鿿].*)$", item.strip())
                if m:
                    result.append(PhraseItem(en=m.group(1).strip(), zh=m.group(2).strip()))
                else:
                    result.append(PhraseItem(en=item.strip(), zh=""))
            elif isinstance(item, dict):
                result.append(PhraseItem(**item))
            else:
                result.append(item)
        return result


class ExplainWordResponse(BaseModel):
    words: list[str]
    explanations: list[WordExplanationItem]


class AnalyzeSentenceRequest(BaseModel):
    sentence: str = Field(..., min_length=1, max_length=2000)
    context: str = Field(default="", max_length=5000)
    api_key: str | None = Field(default=None)


class AnalyzeSentenceResponse(BaseModel):
    sentence: str
    analysis: dict
