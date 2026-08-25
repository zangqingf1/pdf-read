"""Regression: freshly analyzed words must carry their DB id so that deleting
them persists (otherwise a deleted word analysis is re-added by batch-add)."""

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1 import words as words_module
from app.database import Base
from app.models.document import Document
from app.models.word_analysis import WordAnalysis


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


def _entry(word="gravity", definition="old"):
    return {
        "paragraph_index": 0,
        "word": word,
        "phonetic": "/a/",
        "part_of_speech": "n.",
        "definition": definition,
        "definition_zh": "旧释义",
        "collocations": [],
        "example_sentence": "",
        "cognates": [],
        "synonyms_antonyms": {"synonyms": []},
        "base_form": "",
        "plural_form": "",
    }


@pytest.mark.asyncio
async def test_persist_returns_stable_ids(db):
    doc = Document(id=uuid.uuid4(), original_text="", parse_status="completed")
    db.add(doc)
    await db.commit()

    id_map = await words_module._persist_analyses(
        str(doc.id), [_entry()], db,
    )
    assert id_map == {(0, "gravity"): id_map[(0, "gravity")]}
    first_id = id_map[(0, "gravity")]
    assert first_id

    # Re-upserting the same word must keep the same DB id (not a duplicate record)
    id_map2 = await words_module._persist_analyses(
        str(doc.id), [_entry(definition="new")], db,
    )
    assert id_map2[(0, "gravity")] == first_id

    rows = (
        await db.execute(
            select(WordAnalysis).where(WordAnalysis.document_id == str(doc.id))
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].id == first_id
    assert rows[0].definition == "new"
