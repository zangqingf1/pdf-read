"""End-to-end: analyzed words carry their DB id so deleting them persists,
and a subsequent batch-add no longer resurrects deleted words."""

import json
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1 import vocabulary as vocab_module
from app.api.v1 import words as words_module
from app.database import Base
from app.models.document import Document
from app.models.user import User
from app.models.word_analysis import WordAnalysis
from app.schemas.vocabulary import VocabularyBatchAddRequest
from app.schemas.words import WordAnalysisRequest


@pytest_asyncio.fixture
async def db():
    test_engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )()
    yield session
    await session.close()
    await test_engine.dispose()


class _StubAI:
    """Yields a single batch with the requested words."""

    def __init__(self, words: list[str]):
        self._words = words

    async def analyze_words_stream(self, entries, **kwargs):
        results = []
        for w in self._words:
            results.append({
                "paragraph_index": 0,
                "word": w,
                "phonetic": "/x/",
                "part_of_speech": "n.",
                "definition": f"definition of {w}",
                "definition_zh": "",
                "collocations": [],
                "example_sentence": "",
                "cognates": [],
                "synonyms_antonyms": {"synonyms": []},
                "base_form": "",
                "plural_form": "",
            })
        yield {"type": "batch", "results": results, "words": self._words, "para_index": 0}

    async def close(self):
        return None


def _word_req(document_id: str, words: list[str]) -> WordAnalysisRequest:
    return WordAnalysisRequest(
        document_id=document_id,
        entries=[{"paragraph_index": 0, "words": words, "sentence": "ctx."}],
    )


def _sse_analyses(body: str) -> list[dict]:
    out = []
    for line in body.split("\n"):
        if not line.startswith("data: "):
            continue
        ev = json.loads(line[6:])
        if ev.get("type") == "batch":
            out.extend(ev["analyses"])
    return out


@pytest.mark.asyncio
async def test_deleted_parsed_word_not_eadded_to_vocab(monkeypatch, db):
    user = User(id=uuid.uuid4(), email="u@t.com")
    doc = Document(id=uuid.uuid4(), original_text="", parse_status="completed", user_id=user.id)
    db.add_all([user, doc])
    await db.commit()

    monkeypatch.setattr(
        words_module, "create_ai_service",
        lambda *a, **k: _StubAI(words=["apple", "banana", "cherry"]),
    )

    req = _word_req(str(doc.id), ["apple", "banana", "cherry"])
    resp = await words_module.analyze_words_stream(req, db, user)

    chunks = [c async for c in resp.body_iterator]
    analyses = _sse_analyses("".join(chunks))

    # 1) Each analyzed word must carry its DB id.
    assert len(analyses) == 3
    ids = {a["word"].lower(): a.get("id") for a in analyses}
    assert all(ids.values()), f"every analyzed word must get an id: {ids}"

    # 2) Delete "banana" via its id — must actually remove the DB row.
    await words_module.delete_word_analysis(ids["banana"], db, user)
    remaining = (
        await db.execute(select(WordAnalysis).where(WordAnalysis.document_id == str(doc.id)))
    ).scalars().all()
    assert {r.word for r in remaining} == {"apple", "cherry"}

    # 3) batch-add with NO explicit words must only add the surviving analyses.
    add_resp = await vocab_module.batch_add(
        VocabularyBatchAddRequest(document_id=str(doc.id)), db, user
    )
    added_words = {it.word for it in add_resp.items}
    assert "banana" not in added_words, "deleted word must not be re-added to vocabulary"
    assert {"apple", "cherry"}.issubset(added_words)
