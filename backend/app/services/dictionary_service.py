"""Dictionary service — ECDICT local SQLite primary, dictionaryapi.dev fallback."""

import asyncio
import logging
import pathlib
import re
import sqlite3
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_POS_NORMALIZE: dict[str, str] = {
    "noun": "n.",
    "verb": "v.",
    "adjective": "adj.",
    "adverb": "adv.",
    "pronoun": "pron.",
    "preposition": "prep.",
    "conjunction": "conj.",
    "interjection": "int.",
    "article": "art.",
    "determiner": "det.",
    "abbreviation": "abbr.",
    "phrase": "phrase.",
    "plural": "pl.",
}


def _normalize_pos(raw: str) -> str:
    if not raw:
        return ""
    r = raw.strip().lower()
    # ECDICT often stores "n.", "v." already; strip extra
    # Map long forms
    if r in _POS_NORMALIZE:
        return _POS_NORMALIZE[r]
    # Already short form like "n." "v." "adj."
    if re.match(r"^[a-z]+\.$", r):
        return r
    # dictionaryapi.dev returns "noun", "verb" etc.
    # Fallback: take first token before space
    token = r.split()[0].split("/")[0]
    return _POS_NORMALIZE.get(token, token)


def _pos_from_translation(translation: str) -> str:
    """ECDICT's `pos` column is a frequency tag (e.g. 'n:100'), not a real
    part of speech. The Chinese `translation` field, however, begins with a
    standard pos prefix like 'n. ' / 'vt. ' / 'adj. '. Extract that instead."""
    if not translation:
        return ""
    m = re.match(r"^\s*([a-z]{1,6})\.\s", translation, re.IGNORECASE)
    if not m:
        return ""
    return _normalize_pos(m.group(1) + ".")


# High-frequency irregular inflections → base form. Wrong suffix guesses are
# discarded by ECDICT existence validation in lookup(), so this map just lifts
# coverage for the most common irregulars.
_IRREGULAR_LEMMAS: dict[str, str] = {
    "was": "be", "were": "be", "is": "be", "are": "be", "am": "be",
    "been": "be", "being": "be",
    "has": "have", "had": "have", "having": "have",
    "does": "do", "did": "do", "done": "do", "doing": "do",
    "went": "go", "gone": "go", "going": "go",
    "came": "come", "coming": "come",
    "said": "say", "says": "say", "saying": "say",
    "made": "make", "making": "make",
    "better": "good", "best": "good", "well": "good",
    "worse": "bad", "worst": "bad",
    "more": "much", "most": "much", "many": "many",
    "children": "child", "men": "man", "women": "woman",
    "mice": "mouse", "feet": "foot", "teeth": "tooth",
    "thought": "think", "knew": "know", "known": "know", "knowing": "know",
    "bought": "buy", "brought": "bring", "fought": "fight",
    "found": "find", "gave": "give", "given": "give", "giving": "give",
    "took": "take", "taken": "take", "taking": "take",
    "saw": "see", "seen": "see", "seeing": "see",
    "ate": "eat", "eaten": "eat", "eating": "eat",
    "wrote": "write", "written": "write", "writing": "write",
    "spoke": "speak", "spoken": "speak", "speaking": "speak",
    "stood": "stand", "told": "tell", "kept": "keep", "left": "leave",
    "felt": "feel", "met": "meet", "put": "put", "set": "set", "cut": "cut",
    "built": "build", "paid": "pay", "sent": "send", "spent": "spend",
    "held": "hold", "lost": "lose", "won": "win", "taught": "teach",
    "caught": "catch", "broke": "break", "broken": "break",
    "chose": "choose", "chosen": "choose", "froze": "freeze", "frozen": "freeze",
    "drove": "drive", "driven": "drive", "flew": "fly", "flown": "fly",
    "grew": "grow", "threw": "throw", "thrown": "throw", "drew": "draw",
    "stole": "steal", "stolen": "steal", "woke": "wake", "woken": "wake",
    "wore": "wear", "worn": "wear", "tore": "tear", "torn": "tear",
    "swore": "swear", "sworn": "swear", "bore": "bear", "borne": "bear",
    "fell": "fall", "fallen": "fall", "sank": "sink", "sunk": "sink",
    "shook": "shake", "shaken": "shake", "laid": "lay", "laying": "lay",
    "lain": "lie",
}


def _lemmatize(word: str) -> list[str]:
    """Return ordered candidate base forms for an inflected word.

    Only used as a fallback to recover a phonetic; every candidate is
    validated against ECDICT (existence + non-empty phonetic) by the caller,
    so an incorrect guess simply yields nothing instead of a wrong reading.
    """
    w = (word or "").strip().lower()
    if not w:
        return []
    if w in _IRREGULAR_LEMMAS:
        return [_IRREGULAR_LEMMAS[w]]
    out: list[str] = []
    # Plural / 3rd-person-singular noun & verb endings (most specific first)
    if w.endswith("ies") and len(w) > 4:
        out.append(w[:-3] + "y")  # countries -> country
    elif w.endswith("sses") and len(w) > 5:
        out.append(w[:-2])  # dresses -> dress
    elif w.endswith(("ches", "shes", "xes", "zes")):
        out.append(w[:-2])  # boxes -> box, watches -> watch
    elif w.endswith("s") and not w.endswith("ss") and len(w) > 2:
        out.append(w[:-1])  # books -> book, cats -> cat
    elif w.endswith("es") and len(w) > 3:
        out.append(w[:-2])  # goes -> go (fallback)
    # Participle / past forms
    # -ied -> -y (tried -> try, copied -> copy, shied -> shy)
    if w.endswith("ied") and len(w) > 4:
        out.append(w[:-3] + "y")
    # -ity -> base adjective/noun (virality -> viral)
    if w.endswith("ity") and len(w) > 4:
        out.append(w[:-3])
    if w.endswith("ing") and len(w) > 4:
        stem = w[:-3]
        out.append(stem)  # running -> run
        if not stem.endswith("e"):
            out.append(stem + "e")  # making -> make
        # doubled final consonant (stopping -> stop)
        if len(stem) >= 3 and stem[-1] == stem[-2] and stem[-1] not in "aeiou":
            out.append(stem[:-1])
    if w.endswith("ed") and len(w) > 3:
        stem = w[:-2]
        out.append(stem)  # walked -> walk
        if not stem.endswith("e"):
            out.append(stem + "e")  # used -> use
        # doubled final consonant (stopped -> stop, mobbed -> mob)
        if len(stem) >= 3 and stem[-1] == stem[-2] and stem[-1] not in "aeiou":
            out.append(stem[:-1])
    # Derived forms
    if w.endswith("ly") and len(w) > 3:
        out.append(w[:-2])  # quickly -> quick
    if w.endswith("er") and len(w) > 4:
        out.append(w[:-2])  # bigger -> big, teacher -> teach
    if w.endswith("est") and len(w) > 5:
        out.append(w[:-3])  # biggest -> big
    # de-duplicate, preserve order
    seen: set[str] = set()
    res: list[str] = []
    for c in out:
        if c not in seen:
            seen.add(c)
            res.append(c)
    return res


async def _lookup_local(word: str) -> dict[str, Any] | None:
    """Try ECDICT local SQLite via aiosqlite (fallback to sqlite3 in thread)."""
    db_path = pathlib.Path(settings.DICT_DB_PATH)
    # Resolve relative to backend dir
    if not db_path.is_absolute():
        # app/services -> backend
        backend_root = pathlib.Path(__file__).resolve().parents[1].parent
        # settings.DICT_DB_PATH is "./data/ecdict.db" relative to CWD (backend)
        # Try both backend/data and CWD/data
        candidate = backend_root / "data" / "ecdict.db"
        if candidate.exists():
            db_path = candidate
        else:
            db_path = pathlib.Path.cwd() / settings.DICT_DB_PATH
    if not db_path.exists():
        return None

    def _query() -> dict[str, Any] | None:
        try:
            conn = sqlite3.connect(str(db_path))
            conn.row_factory = sqlite3.Row
            # ECDICT schema variants: try common table/column names
            # stardict: word, phonetic, definition/translation, pos
            # Try to detect columns
            cur = conn.cursor()
            # Check tables
            cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = [r[0] for r in cur.fetchall()]
            if not tables:
                conn.close()
                return None
            # Prefer table named 'stardict' or 'ecdict' or first table with word column
            target = None
            for t in ("stardict", "ecdict", "dict", "words"):
                if t in tables:
                    target = t
                    break
            if target is None:
                target = tables[0]

            # Detect columns
            cur.execute(f"PRAGMA table_info({target})")
            cols = {row[1] for row in cur.fetchall()}
            # word column variants
            word_col = None
            for c in ("word", "headword", "entry", "term"):
                if c in cols:
                    word_col = c
                    break
            if word_col is None:
                conn.close()
                return None

            phonetic_col = next((c for c in ("phonetic", "phone", "ipa", "pron") if c in cols), None)
            pos_col = next((c for c in ("pos", "part_of_speech", "type", "lexical_category") if c in cols), None)
            trans_col = next((c for c in ("translation", "trans", "chinese", "zh", "definition", "meaning") if c in cols), None)
            def_col = next((c for c in ("definition", "meaning", "english", "en_def") if c in cols and c != trans_col), None)

            # Build select
            select_cols = [word_col]
            if phonetic_col:
                select_cols.append(phonetic_col)
            if pos_col:
                select_cols.append(pos_col)
            if trans_col:
                select_cols.append(trans_col)
            if def_col:
                select_cols.append(def_col)

            # Case-insensitive exact match
            cur.execute(
                f"SELECT {', '.join(select_cols)} FROM {target} WHERE lower({word_col}) = lower(?) LIMIT 1",
                (word,),
            )
            row = cur.fetchone()
            conn.close()
            if row is None:
                return None

            # row is sqlite3.Row — access by index/col name
            idx = 0
            # need to map back
            result: dict[str, Any] = {"word": word}
            # word_col is idx 0
            idx = 1
            if phonetic_col:
                result["phonetic"] = row[idx] or ""
                idx += 1
            else:
                result["phonetic"] = ""
            raw_pos = ""
            if pos_col:
                raw_pos = row[idx] or ""
                idx += 1
            if trans_col:
                result["translation"] = row[idx] or ""
                idx += 1
            else:
                result["translation"] = ""
            if def_col:
                result["definition_en"] = row[idx] or ""
            else:
                result["definition_en"] = ""
            # ECDICT pos column is a frequency tag ('n:100'); prefer the real
            # part of speech embedded at the start of the Chinese translation.
            result["pos"] = _pos_from_translation(result["translation"]) or _normalize_pos(
                raw_pos.split(",")[0].strip() if raw_pos else ""
            )
            result["pos_raw"] = raw_pos
            return result
        except Exception as exc:
            logger.warning("ECDICT local lookup failed for %s: %s", word, exc)
            return None

    return await asyncio.to_thread(_query)


_shared_client: httpx.AsyncClient | None = None


def _get_shared_client() -> httpx.AsyncClient:
    global _shared_client
    if _shared_client is None:
        _shared_client = httpx.AsyncClient(
            timeout=httpx.Timeout(2.0, connect=1.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _shared_client


async def _lookup_remote(word: str) -> dict[str, Any] | None:
    """Fallback to dictionaryapi.dev — short timeout, reuse connection pool."""
    url = f"{settings.DICT_API_URL.rstrip('/')}/{word.strip().lower()}"
    try:
        client = _get_shared_client()
        # Per-request guard: don't let a single word block the batch for long
        resp = await asyncio.wait_for(
            client.get(url, headers={"Accept": "application/json"}),
            timeout=2.5,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        if not isinstance(data, list) or not data:
            return None
        entry = data[0]
        phonetic = entry.get("phonetic") or ""
        if not phonetic:
            phonetics = entry.get("phonetics") or []
            for p in phonetics:
                if p.get("text"):
                    phonetic = p["text"]
                    break
        meanings = entry.get("meanings") or []
        pos = ""
        translation = ""
        definition_en = ""
        if meanings:
            first = meanings[0]
            raw_pos = first.get("partOfSpeech") or ""
            pos = _normalize_pos(raw_pos)
            defs = first.get("definitions") or []
            if defs:
                definition_en = defs[0].get("definition") or ""
        return {
            "word": word,
            "phonetic": phonetic,
            "pos": pos,
            "pos_raw": meanings[0].get("partOfSpeech") if meanings else "",
            "translation": translation,
            "definition_en": definition_en,
        }
    except asyncio.TimeoutError:
        logger.debug("Dictionary remote timeout for %s", word)
        return None
    except Exception as exc:
        logger.debug("Dictionary remote lookup failed for %s: %s", word, exc)
        return None


async def lookup(word: str) -> dict[str, Any] | None:
    """Single word lookup: local → base-form fallback → remote.

    ECDICT stores inflected forms (e.g. "books") with an *empty* phonetic,
    while the base headword ("book") carries it.  So when the exact form has
    no phonetic we look up candidate base forms and reuse their phonetic
    (and translation/definition only when the inflected form lacks them).
    """
    if not word or not word.strip():
        return None
    w = word.strip()
    local = await _lookup_local(w)
    # Exact form already has a phonetic — nothing to do.
    if local is not None and local.get("phonetic"):
        return local
    # Fall back to base/lemma form(s) for the phonetic.
    if local is None or not local.get("phonetic"):
        for lemma in _lemmatize(w):
            base = await _lookup_local(lemma)
            if base and base.get("phonetic"):
                merged = dict(base)
                merged["word"] = w
                merged["base_form"] = lemma
                # Keep the inflected form's own richer fields when present.
                if local and local.get("translation"):
                    merged["translation"] = local["translation"]
                if local and local.get("definition_en"):
                    merged["definition_en"] = local["definition_en"]
                if local and local.get("pos"):
                    merged["pos"] = local["pos"]
                return merged
    # Still no phonetic: return the local record if it had any content
    # (try remote once for a phonetic before giving up).
    if local is not None and any([local.get("pos"), local.get("translation"), local.get("definition_en")]):
        remote = await _lookup_remote(w)
        if remote and remote.get("phonetic"):
            local["phonetic"] = remote["phonetic"]
            return local
        return local
    # Nothing useful locally — try remote, else return whatever local gave.
    remote = await _lookup_remote(w)
    if remote is not None:
        return remote
    if local is not None:
        return local
    return None


async def lookup_many(words: list[str], concurrency: int = 15) -> dict[str, dict[str, Any] | None]:
    """Batch lookup with concurrency limit. Keys are lowercased words."""
    # Deduplicate case-insensitive
    uniq: dict[str, str] = {}  # lower -> original first occurrence
    for w in words:
        if not w or not w.strip():
            continue
        lower = w.strip().lower()
        if lower not in uniq:
            uniq[lower] = w.strip()

    # Fast-path: if stub ECDICT covers none, remote will still be tried but
    # with short timeout and shared client it stays within a few seconds.
    sem = asyncio.Semaphore(concurrency)

    async def _one(lower: str, original: str) -> tuple[str, dict[str, Any] | None]:
        async with sem:
            try:
                rec = await asyncio.wait_for(lookup(original), timeout=4.0)
            except asyncio.TimeoutError:
                rec = None
            return lower, rec

    results = await asyncio.gather(*[_one(low, orig) for low, orig in uniq.items()])
    return dict(results)
