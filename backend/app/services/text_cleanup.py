"""Deterministic post-OCR text cleanup — pure rules, zero AI cost.

Applied to MinerU output blocks before they are stored as paragraphs.
Only fixes things that are *almost certainly* OCR artifacts; everything
else is left untouched (the review page is the manual safety net).

Rules are conservative and idempotent:
  - Normalize line endings (\\r\\n / lone \\r → \\n)
  - Remove control characters
  - Replace Unicode artifacts (ligatures, curly quotes, en dash, NBSP,
    zero-width chars, replacement char U+FFFD)
  - Join hyphenated line breaks ("con-\\n" + "tinue" → "continue")
  - Fix stray spaces before punctuation ("word ," → "word,")
  - Collapse doubled punctuation ("word.." → "word.") while protecting
    ellipses ("..." stays "..." and "…" becomes "...")
  - Collapse 3+ spaces and trim

Explicitly NOT cleaned:
  - Table HTML (cleaning could break tags) — callers must skip HTML
  - Em dash U+2014 (legitimate English punctuation)
  - In-line hyphens (well-known) and hyphen-broken words whose pieces
    start with a capital letter (X-ray) — the hyphen-join rule requires
    a lowercase letter on both sides of the line break
"""

import re

# Control characters (same set the OCR engine used before this module existed)
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")

# Unicode artifacts → ASCII / plain equivalents
_UNICODE_FIXES = {
    "\ufb00": "ff",  # ﬀ
    "\ufb01": "fi",  # ﬁ
    "\ufb02": "fl",  # ﬂ
    "\ufb03": "ffi",  # ﬃ
    "\ufb04": "ffl",  # ﬄ
    "\u2018": "'",  # ‘
    "\u2019": "'",  # ’
    "\u201c": '"',  # “
    "\u201d": '"',  # ”
    "\u2013": "-",  # – en dash (ranges: 1990–2000 → 1990-2000)
    # Em dash U+2014 is intentionally kept — legitimate punctuation.
    "\u00a0": " ",  # non-breaking space
}

# Zero-width / invisible characters to remove entirely
_ZERO_WIDTH_RE = re.compile(r"[\u200b\u200c\u200d\u2060]")

# U+FFFD replacement character — the original glyph is unrecoverable;
# leaving it renders as a tofu box, removing it is the least harmful option.
_REPLACEMENT_CHAR_RE = re.compile(r"\ufffd")

# Hyphenated line break: lowercase letter + "-" (+ optional space) + newline
# + lowercase letter. Joins "con-\n" "tinue" → "continue".
# In-line hyphens (well-known) and capital-letter pieces (X-\nray) are spared.
_HYPHEN_BREAK_RE = re.compile(r"(?<=[a-z])- ?\n(?=[a-z])")

# Stray space before punctuation: "word ," → "word," / "word ." → "word."
_SPACE_BEFORE_PUNCT_RE = re.compile(r"(?<=\S)\s+([,.;:!?%])")

# Doubled punctuation → single, but never inside a longer run:
# ".." → "." / ",," → "," while "..." stays intact.
_DOUBLED_DOT_RE = re.compile(r"(?<!\.)\.\.(?!\.)")
_DOUBLED_COMMA_RE = re.compile(r"(?<!,),,(?!,)")

# Unicode ellipsis → three ASCII dots
_ELLIPSIS_RE = re.compile(r"\u2026")

# 3+ consecutive spaces → 1
_MULTI_SPACE_RE = re.compile(r" {3,}")


def _normalize_line_endings(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _replace_unicode_artifacts(text: str) -> str:
    for src, dst in _UNICODE_FIXES.items():
        text = text.replace(src, dst)
    text = _ZERO_WIDTH_RE.sub("", text)
    text = _REPLACEMENT_CHAR_RE.sub("", text)
    return text


def clean_ocr_text(text: str) -> str:
    """Clean OCR artifacts from a text block. Idempotent and conservative.

    Safe to call on already-cleaned text (repeated parsing / retries never
    accumulate transformations).
    """
    if not text:
        return text

    text = _normalize_line_endings(text)
    text = _CONTROL_CHARS_RE.sub("", text)
    text = _replace_unicode_artifacts(text)
    text = _HYPHEN_BREAK_RE.sub("", text)
    text = _SPACE_BEFORE_PUNCT_RE.sub(r"\1", text)
    text = _DOUBLED_DOT_RE.sub(".", text)
    text = _DOUBLED_COMMA_RE.sub(",", text)
    text = _ELLIPSIS_RE.sub("...", text)
    text = _MULTI_SPACE_RE.sub(" ", text)
    return text.strip()
