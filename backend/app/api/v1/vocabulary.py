"""Vocabulary book API — batch add from a document, list with search/sort, delete."""

import json
import logging
import re
import uuid
from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import asc, case, desc, func, or_, select, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from app.auth.deps import get_current_user
from app.config import settings
from app.database import get_db
from app.models.document import Document
from app.models.paragraph import Paragraph
from app.models.user import User
from app.models.vocabulary import VocabularyEntry
from app.models.vocabulary_source import VocabularySource
from app.models.word_analysis import WordAnalysis
from app.schemas.vocabulary import (
    VocabularyBatchAddRequest,
    VocabularyBatchAddResponse,
    VocabularyBatchDeleteRequest,
    VocabularyBatchDeleteResponse,
    VocabularyEntryOut,
    VocabularyListResponse,
    VocabularySourceOut,
)
from app.services import dictionary_service

router = APIRouter()
_logger = logging.getLogger(__name__)


async def _verify_doc_ownership(document_id: str, user: User, db: AsyncSession) -> Document:
    try:
        doc_uuid = uuid.UUID(document_id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found")
    doc = (
        await db.execute(
            select(Document).where(Document.id == doc_uuid).options(load_only(Document.user_id, Document.title))
        )
    ).scalar_one_or_none()
    if doc is None or doc.user_id != user.id:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found")
    return doc


def _vocab_upsert_rows(user_id: uuid.UUID, rows: list[dict]):
    """Upsert keyed by (user_id, word). Updates dict fields but keeps created_at."""
    if "sqlite" in settings.DATABASE_URL:
        stmt = sqlite_insert(VocabularyEntry).values(rows)
    else:
        stmt = pg_insert(VocabularyEntry).values(rows)
    excluded = stmt.excluded
    return stmt.on_conflict_do_update(
        index_elements=[VocabularyEntry.user_id, VocabularyEntry.word],
        set_={
            "word_original": excluded.word_original,
            "phonetic": excluded.phonetic,
            "pos": excluded.pos,
            "translation": excluded.translation,
            "definition_en": excluded.definition_en,
            "context_sentence": excluded.context_sentence,
            # Rich fields: keep existing value when the incoming one is empty
            # (so re-adding from a doc without analysis never clobbers good data).
            "definition_zh": case(
                (excluded.definition_zh == "", VocabularyEntry.definition_zh),
                else_=excluded.definition_zh,
            ),
            "base_form": case(
                (excluded.base_form == "", VocabularyEntry.base_form),
                else_=excluded.base_form,
            ),
            "plural_form": case(
                (excluded.plural_form == "", VocabularyEntry.plural_form),
                else_=excluded.plural_form,
            ),
            "synonyms_antonyms": case(
                (excluded.synonyms_antonyms == "", VocabularyEntry.synonyms_antonyms),
                (excluded.synonyms_antonyms == '{"synonyms": []}', VocabularyEntry.synonyms_antonyms),
                else_=excluded.synonyms_antonyms,
            ),
            "cognates": case(
                (excluded.cognates == "", VocabularyEntry.cognates),
                (excluded.cognates == "[]", VocabularyEntry.cognates),
                else_=excluded.cognates,
            ),
            "collocations": case(
                (excluded.collocations == "", VocabularyEntry.collocations),
                (excluded.collocations == "[]", VocabularyEntry.collocations),
                else_=excluded.collocations,
            ),
            "exam_tags": case(
                (excluded.exam_tags == "", VocabularyEntry.exam_tags),
                (excluded.exam_tags == "[]", VocabularyEntry.exam_tags),
                else_=excluded.exam_tags,
            ),
            "source_document_id": excluded.source_document_id,
            "latest_paragraph_index": excluded.latest_paragraph_index,
            "latest_token_rank": excluded.latest_token_rank,
            "updated_at": excluded.updated_at,
        },
    )


def _wa_field_filled(value: str | None, empty_json: str | None = None) -> bool:
    """True if a stored rich-field value carries actual content."""
    if not value:
        return False
    v = value.strip()
    if v == "":
        return False
    if empty_json is not None and v == empty_json:
        return False
    return True


def _tokenize_words(text: str) -> list[dict]:
    parts = re.split(r"(\s+)", text)
    tokens: list[dict] = []
    for part in parts:
        if re.match(r"^\s+$", part):
            tokens.append({"raw": part, "stem": None})
        elif re.search(r"[a-zA-Z]", part):
            word = re.sub(r"[^a-zA-Z'-]", "", part)
            if word:
                tokens.append({"raw": part, "stem": word})
            else:
                tokens.append({"raw": part, "stem": None})
        else:
            tokens.append({"raw": part, "stem": None})
    return tokens


def _word_position_map(text: str) -> dict[str, int]:
    m: dict[str, int] = {}
    for i, t in enumerate(_tokenize_words(text)):
        stem = t["stem"]
        if stem is not None:
            k = stem.lower()
            if k not in m:
                m[k] = i
    return m


async def _compute_ranks(db: AsyncSession, document_id: str, words: list[str]) -> dict[str, tuple[int, int]]:
    """For each lower word, find (paragraph_index, token_rank) of its first occurrence in document."""
    lowers = {w.lower() for w in words}
    paras = (
        await db.execute(
            select(Paragraph.index, Paragraph.text_en).where(Paragraph.document_id == uuid.UUID(document_id)).order_by(Paragraph.index)
        )
    ).all()
    para_maps: list[tuple[int, dict[str, int]]] = []
    for idx, text_en in paras:
        para_maps.append((idx, _word_position_map(text_en or "")))
    result: dict[str, tuple[int, int]] = {}
    for lower in lowers:
        best: tuple[int, int] | None = None
        for p_idx, mp in para_maps:
            if lower in mp:
                rank = mp[lower]
                cand = (p_idx, rank)
                if best is None or cand < best:
                    best = cand
        if best is not None:
            result[lower] = best
    # Fallback: if not found in paragraphs (e.g. edited), try WordAnalysis paragraph_index
    missing = [lw for lw in lowers if lw not in result]
    if missing:
        rows = (
            await db.execute(
                select(WordAnalysis.word, WordAnalysis.paragraph_index).where(
                    WordAnalysis.document_id == document_id, WordAnalysis.word.in_(missing)
                )
            )
        ).all()
        # Pick minimal paragraph_index per word
        min_map: dict[str, int] = {}
        for w, pi in rows:
            lw = (w or "").lower()
            if lw not in min_map or pi < min_map[lw]:
                min_map[lw] = pi
        for lw in missing:
            if lw in min_map:
                result[lw] = (min_map[lw], 999999)
    return result


async def _fetch_title_map(db: AsyncSession, doc_ids: list[str]) -> dict[str, str]:
    if not doc_ids:
        return {}
    uuids: list[uuid.UUID] = []
    str_map: dict[str, uuid.UUID] = {}
    for did in doc_ids:
        try:
            u = uuid.UUID(did)
            uuids.append(u)
            str_map[str(u)] = did
        except ValueError:
            continue
    if not uuids:
        return {}
    rows = (
        await db.execute(
            select(Document.id, Document.title).where(Document.id.in_(uuids))
        )
    ).all()
    out: dict[str, str] = {}
    for doc_id, title in rows:
        key = str(doc_id)
        out[key] = title or "未命名文档"
        for k, v in list(str_map.items()):
            if str(v) == key:
                out[k] = out[key]
    return out


async def _fetch_sources_map(db: AsyncSession, entry_ids: list[str]) -> dict[str, list[VocabularySourceOut]]:
    if not entry_ids:
        return {}
    rows = (
        await db.execute(
            select(VocabularySource).where(VocabularySource.vocabulary_entry_id.in_(entry_ids)).order_by(VocabularySource.added_at.asc())
        )
    ).scalars().all()
    # Collect doc ids for live title
    doc_ids = list({r.document_id for r in rows})
    title_map = await _fetch_title_map(db, doc_ids)
    out: dict[str, list[VocabularySourceOut]] = {eid: [] for eid in entry_ids}
    for r in rows:
        doc_id_str = r.document_id
        live_title = title_map.get(doc_id_str, r.document_title or "未命名文档")
        # If document was deleted, title_map misses, fallback to snapshot
        if doc_id_str not in title_map and r.document_title:
            live_title = r.document_title
        elif doc_id_str not in title_map:
            live_title = None
        out[r.vocabulary_entry_id].append(
            VocabularySourceOut(
                document_id=r.document_id,
                document_title=live_title,
                added_at=r.added_at,
                paragraph_index=r.paragraph_index,
                token_rank=r.token_rank,
            )
        )
    return out


def _to_out(
    entry: VocabularyEntry,
    title_map: dict[str, str] | None = None,
    sources_map: dict[str, list[VocabularySourceOut]] | None = None,
) -> VocabularyEntryOut:
    doc_id = entry.source_document_id
    title = None
    if doc_id and title_map is not None:
        title = title_map.get(str(doc_id))
    return VocabularyEntryOut(
        id=str(entry.id),
        word=entry.word,
        word_original=entry.word_original,
        phonetic=entry.phonetic or "",
        pos=entry.pos or "",
        translation=entry.translation or "",
        definition_en=entry.definition_en or "",
        source_document_id=entry.source_document_id,
        source_document_title=title,
        latest_paragraph_index=entry.latest_paragraph_index,
        latest_token_rank=entry.latest_token_rank,
        all_sources=sources_map.get(str(entry.id), []) if sources_map else [],
        context_sentence=entry.context_sentence,
        definition_zh=entry.definition_zh or "",
        base_form=entry.base_form or "",
        plural_form=entry.plural_form or "",
        synonyms_antonyms=entry.synonyms_antonyms or '{"synonyms": []}',
        cognates=entry.cognates or "[]",
        collocations=entry.collocations or "[]",
        exam_tags=entry.exam_tags or "[]",
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


@router.post("/batch-add", response_model=VocabularyBatchAddResponse)
async def batch_add(
    request: VocabularyBatchAddRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = await _verify_doc_ownership(request.document_id, current_user, db)

    target_words: list[str] = []
    word_to_context: dict[str, str] = {}
    word_to_rich: dict[str, dict] = {}
    word_to_para: dict[str, int] = {}
    word_to_original: dict[str, str] = {}

    if request.words and len([w for w in request.words if w.strip()]) > 0:
        for w in request.words:
            s = w.strip()
            if not s:
                continue
            lower = s.lower()
            if lower not in word_to_original:
                word_to_original[lower] = s
                target_words.append(s)
    else:
        rows = (
            await db.execute(
                select(WordAnalysis.word, WordAnalysis.paragraph_index).where(
                    WordAnalysis.document_id == request.document_id
                )
            )
        ).all()
        for word, _para_idx in rows:
            s = (word or "").strip()
            if not s:
                continue
            lower = s.lower()
            if lower not in word_to_original:
                word_to_original[lower] = s
                target_words.append(s)

    if not target_words:
        return VocabularyBatchAddResponse(added=0, skipped=0, total=0, items=[])

    try:
        wa_rows = (
            await db.execute(
                select(WordAnalysis).where(
                    WordAnalysis.document_id == request.document_id,
                    WordAnalysis.word.in_([w.lower() for w in target_words]),
                )
            )
        ).scalars().all()
        for wa in wa_rows:
            lower = (wa.word or "").lower()
            if lower not in word_to_context:
                word_to_context[lower] = wa.example_sentence or ""
            # Prefer WordAnalysis.paragraph_index (reliable even when the
            # document's paragraphs table has been purged); fall back to the
            # paragraph-text rank computation below.
            if lower not in word_to_para or (
                wa.paragraph_index is not None
                and (word_to_para[lower] is None or wa.paragraph_index < word_to_para[lower])
            ):
                word_to_para[lower] = wa.paragraph_index
            if lower not in word_to_rich:
                rich: dict[str, str] = {}
                if _wa_field_filled(wa.definition_zh):
                    rich["definition_zh"] = wa.definition_zh
                if _wa_field_filled(wa.base_form):
                    rich["base_form"] = wa.base_form
                if _wa_field_filled(wa.plural_form):
                    rich["plural_form"] = wa.plural_form
                if _wa_field_filled(wa.synonyms_antonyms, '{"synonyms": []}'):
                    rich["synonyms_antonyms"] = wa.synonyms_antonyms
                if _wa_field_filled(wa.cognates, "[]"):
                    rich["cognates"] = wa.cognates
                if _wa_field_filled(wa.collocations, "[]"):
                    rich["collocations"] = wa.collocations
                if _wa_field_filled(wa.exam_tags, "[]"):
                    rich["exam_tags"] = wa.exam_tags
                if rich:
                    word_to_rich[lower] = rich
    except Exception:
        pass

    lowers = [w.lower() for w in target_words]
    existing_entries: list[VocabularyEntry] = (
        await db.execute(
            select(VocabularyEntry).where(
                VocabularyEntry.user_id == current_user.id,
                VocabularyEntry.word.in_(lowers),
            )
        )
    ).scalars().all()
    existing_map: dict[str, VocabularyEntry] = {e.word: e for e in existing_entries}
    existing_set = set(existing_map.keys())

    new_words = [w for w in target_words if w.lower() not in existing_set]
    if new_words:
        dict_map = await dictionary_service.lookup_many(new_words)
    else:
        dict_map = {}

    # Exam tags come straight from local ECDICT (deterministic, cached
    # in-process) for every target word, so entries always carry tags no
    # matter when their word was last analyzed. The value carried over from
    # WordAnalysis stays only as a fallback (e.g. missing ecdict.db).
    tags_map = await dictionary_service.lookup_exam_tags(target_words)

    # Compute ranks for all target words (needed for latest_* of new and existing)
    rank_map = await _compute_ranks(db, request.document_id, target_words)
    doc_title = doc.title or "未命名文档"

    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)

    # Handle new words: upsert entries
    upsert_rows: list[dict] = []
    for w in new_words:
        lower = w.lower()
        rec = dict_map.get(lower)
        phonetic = (rec or {}).get("phonetic", "") or ""
        pos = (rec or {}).get("pos", "") or ""
        translation = (rec or {}).get("translation", "") or ""
        definition_en = (rec or {}).get("definition_en", "") or ""
        word_original = word_to_original.get(lower, w)
        context = word_to_context.get(lower)
        rich = word_to_rich.get(lower, {})
        definition_zh = rich.get("definition_zh", "")
        base_form = rich.get("base_form", "")
        plural_form = rich.get("plural_form", "")
        synonyms_antonyms = rich.get("synonyms_antonyms", '{"synonyms": []}')
        cognates = rich.get("cognates", "[]")
        collocations = rich.get("collocations", "[]")
        direct_tags = tags_map.get(lower)
        exam_tags = (
            json.dumps(direct_tags, ensure_ascii=False)
            if direct_tags
            else rich.get("exam_tags", "[]")
        )
        rank = rank_map.get(lower, (None, None))[1]
        para_idx = word_to_para.get(lower)
        if para_idx is None:
            para_idx = rank_map.get(lower, (None, None))[0]

        upsert_rows.append({
            "id": str(uuid.uuid4()),
            "user_id": current_user.id,
            "word": lower,
            "word_original": word_original,
            "phonetic": phonetic,
            "pos": pos,
            "translation": translation,
            "definition_en": definition_en,
            "source_document_id": request.document_id,
            "latest_paragraph_index": para_idx,
            "latest_token_rank": rank,
            "context_sentence": context,
            "definition_zh": definition_zh,
            "base_form": base_form,
            "plural_form": plural_form,
            "synonyms_antonyms": synonyms_antonyms,
            "cognates": cognates,
            "collocations": collocations,
            "exam_tags": exam_tags,
            "updated_at": now,
            "created_at": now,
        })

    if upsert_rows:
        for start in range(0, len(upsert_rows), 100):
            await db.execute(_vocab_upsert_rows(current_user.id, upsert_rows[start:start + 100]))
        await db.flush()

    # For existing words: ensure vocabulary_sources has an entry for this document,
    # and update latest_* to this document's rank (since it's the latest)
    # We need entry ids for existing
    all_entry_ids: list[str] = []
    if existing_entries:
        all_entry_ids.extend([e.id for e in existing_entries])
    # After insert, fetch new entries to get their ids
    if new_words:
        new_entries = (
            await db.execute(
                select(VocabularyEntry).where(
                    VocabularyEntry.user_id == current_user.id,
                    VocabularyEntry.word.in_([w.lower() for w in new_words]),
                )
            )
        ).scalars().all()
        all_entry_ids.extend([e.id for e in new_entries])
        # Merge into map for later source handling
        for e in new_entries:
            existing_map[e.word] = e

    # Insert into vocabulary_sources for all target words (new and existing) if not already present
    # and update latest_* for existing ones
    for w in target_words:
        lower = w.lower()
        entry = existing_map.get(lower)
        if entry is None:
            continue
        rank = rank_map.get(lower, (None, None))[1]
        para_idx = word_to_para.get(lower)
        if para_idx is None:
            para_idx = rank_map.get(lower, (None, None))[0]
        # Check if source already exists for this doc
        exists = (
            await db.execute(
                select(VocabularySource).where(
                    VocabularySource.vocabulary_entry_id == entry.id,
                    VocabularySource.document_id == request.document_id,
                )
            )
        ).scalar_one_or_none()
        if exists is None:
            vs = VocabularySource(
                vocabulary_entry_id=entry.id,
                document_id=request.document_id,
                document_title=doc_title,
                paragraph_index=para_idx,
                token_rank=rank,
            )
            db.add(vs)
        # Update latest_* to current doc (since it's the latest)
        entry.source_document_id = request.document_id
        entry.latest_paragraph_index = para_idx
        entry.latest_token_rank = rank
        # Refresh rich fields from this document's WordAnalysis when present
        rich = word_to_rich.get(lower)
        if rich:
            if "definition_zh" in rich:
                entry.definition_zh = rich["definition_zh"]
            if "base_form" in rich:
                entry.base_form = rich["base_form"]
            if "plural_form" in rich:
                entry.plural_form = rich["plural_form"]
            if "synonyms_antonyms" in rich:
                entry.synonyms_antonyms = rich["synonyms_antonyms"]
            if "cognates" in rich:
                entry.cognates = rich["cognates"]
            if "collocations" in rich:
                entry.collocations = rich["collocations"]
        # Exam tags always come straight from ECDICT — overwriting on re-add
        # heals entries whose tags predate this logic (empty, or carrying old
        # derived labels). The WordAnalysis-carried value is the fallback.
        direct_tags = tags_map.get(lower)
        if direct_tags:
            entry.exam_tags = json.dumps(direct_tags, ensure_ascii=False)
        elif rich and "exam_tags" in rich:
            entry.exam_tags = rich["exam_tags"]
        entry.updated_at = now

    await db.commit()

    added = len(new_words)
    skipped = len(lowers) - added
    result_entries = (
        await db.execute(
            select(VocabularyEntry).where(
                VocabularyEntry.user_id == current_user.id,
                VocabularyEntry.word.in_(lowers),
            ).order_by(VocabularyEntry.created_at.desc())
        )
    ).scalars().all()
    title_map = await _fetch_title_map(db, [e.source_document_id for e in result_entries if e.source_document_id])
    sources_map = await _fetch_sources_map(db, [e.id for e in result_entries])
    return VocabularyBatchAddResponse(
        added=added,
        skipped=skipped,
        total=len(lowers),
        items=[_to_out(e, title_map, sources_map) for e in result_entries],
    )


@router.get("/list", response_model=VocabularyListResponse)
async def list_entries(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str | None = Query(None),
    sort_by: str = Query("created_at", pattern="^(created_at|document_order)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    base = select(VocabularyEntry).where(VocabularyEntry.user_id == current_user.id)

    conditions = [VocabularyEntry.user_id == current_user.id]
    if q and q.strip():
        like = f"%{q.strip()}%"
        cond = or_(
            VocabularyEntry.word.like(like),
            VocabularyEntry.word_original.like(like),
            VocabularyEntry.translation.like(like),
            VocabularyEntry.definition_en.like(like),
        )
        base = base.where(cond)
        conditions.append(cond)

    total = (await db.execute(select(func.count()).select_from(VocabularyEntry).where(*conditions))).scalar() or 0

    # 全量按日统计（本地时区 YYYY-MM-DD），前端日期分组标题显示当日总添加数
    day_counts: dict[str, int] = {}
    created_rows = (
        await db.execute(select(VocabularyEntry.created_at).where(*conditions))
    ).all()
    for (ca,) in created_rows:
        if ca is None:
            continue
        dt = ca if ca.tzinfo else ca.replace(tzinfo=timezone.utc)
        key = dt.astimezone().strftime("%Y-%m-%d")
        day_counts[key] = day_counts.get(key, 0) + 1

    if sort_by == "document_order":
        # Group by source document first (so each document's words stay
        # contiguous and aren't interleaved across documents by paragraph),
        # then by reading order within the document. Nulls last.
        if order == "asc":
            base = base.order_by(
                VocabularyEntry.source_document_id.is_(None),
                asc(VocabularyEntry.source_document_id),
                VocabularyEntry.latest_paragraph_index.is_(None),
                asc(VocabularyEntry.latest_paragraph_index),
                VocabularyEntry.latest_token_rank.is_(None),
                asc(VocabularyEntry.latest_token_rank),
                asc(VocabularyEntry.word),
            )
        else:
            base = base.order_by(
                VocabularyEntry.source_document_id.is_(None),
                desc(VocabularyEntry.source_document_id),
                VocabularyEntry.latest_paragraph_index.is_(None),
                desc(VocabularyEntry.latest_paragraph_index),
                VocabularyEntry.latest_token_rank.is_(None),
                desc(VocabularyEntry.latest_token_rank),
                asc(VocabularyEntry.word),
            )
    else:  # created_at
        if order == "asc":
            base = base.order_by(asc(VocabularyEntry.created_at), asc(VocabularyEntry.word))
        else:
            base = base.order_by(desc(VocabularyEntry.created_at), asc(VocabularyEntry.word))

    offset = (page - 1) * page_size
    base = base.offset(offset).limit(page_size)

    rows = (await db.execute(base)).scalars().all()
    title_map = await _fetch_title_map(db, [r.source_document_id for r in rows if r.source_document_id])
    sources_map = await _fetch_sources_map(db, [r.id for r in rows])
    return VocabularyListResponse(
        items=[_to_out(e, title_map, sources_map) for e in rows],
        total=total,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        order=order,
        day_counts=day_counts,
    )


@router.get("/{entry_id}", response_model=VocabularyEntryOut)
async def get_entry(
    entry_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = (
        await db.execute(
            select(VocabularyEntry).where(
                VocabularyEntry.id == entry_id, VocabularyEntry.user_id == current_user.id
            )
        )
    ).scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    title_map = await _fetch_title_map(db, [entry.source_document_id] if entry.source_document_id else [])
    sources_map = await _fetch_sources_map(db, [entry.id])
    return _to_out(entry, title_map, sources_map)


@router.delete("/{entry_id}")
async def delete_entry(
    entry_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = (
        await db.execute(
            select(VocabularyEntry).where(
                VocabularyEntry.id == entry_id, VocabularyEntry.user_id == current_user.id
            )
        )
    ).scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    await db.delete(entry)
    await db.commit()
    return {"status": "ok"}


@router.post("/batch-delete", response_model=VocabularyBatchDeleteResponse)
async def batch_delete(
    request: VocabularyBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        delete(VocabularyEntry).where(
            VocabularyEntry.user_id == current_user.id,
            VocabularyEntry.id.in_(request.ids),
        )
    )
    await db.commit()
    return VocabularyBatchDeleteResponse(deleted=result.rowcount or 0)
