"""SRS review schemas — queue, rating submission, card management, stats."""

from pydantic import BaseModel, Field

from app.schemas.vocabulary import VocabularyEntryOut


class SrsCounts(BaseModel):
    new: int = 0
    learning: int = 0
    review: int = 0
    due_total: int = 0
    mastered_total: int = 0


class SrsCardOut(VocabularyEntryOut):
    """A review card: vocabulary entry fields plus live scheduling helpers."""

    srs_is_learning: bool = True
    # rating (0-3) → humanized next-interval preview, display only
    srs_preview: dict[str, str] = Field(default_factory=dict)


class SrsQueueResponse(BaseModel):
    items: list[SrsCardOut] = Field(default_factory=list)
    counts: SrsCounts = Field(default_factory=SrsCounts)


class SrsReviewRequest(BaseModel):
    entry_id: str = Field(..., min_length=1)
    rating: int = Field(..., ge=0, le=3, description="0=忘了 1=困难 2=良好 3=简单")


class SrsReviewResponse(BaseModel):
    entry: SrsCardOut


class SrsMasteredRequest(BaseModel):
    mastered: bool


class SrsForecastItem(BaseModel):
    date: str
    count: int = 0


class SrsStatsResponse(BaseModel):
    total: int = 0
    active: int = 0
    mastered: int = 0
    due_today: int = 0
    reviewed_today: int = 0
    forecast: list[SrsForecastItem] = Field(default_factory=list)
