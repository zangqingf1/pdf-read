"""单元测试：确定性 OCR 文本清洗（text_cleanup + ocr_engine 接入点）。

覆盖：
  - 断行连字合并（含带空格变体）；单行连字符与大写开头不受影响
  - 连字字符、弯引号、短破折号、NBSP、零宽字符、替换符、控制字符
  - 标点前多余空格、重复标点（省略号保护）
  - 空白折叠与 trim
  - 幂等性：clean(clean(x)) == clean(x)
  - ocr_engine._content_list_to_paragraphs 集成路径：
    表格 HTML 透传、list/code 清洗生效
"""

from app.services.ocr_engine import _content_list_to_paragraphs
from app.services.text_cleanup import clean_ocr_text


# ── 断行连字 ──────────────────────────────────────────────────────────────

def test_hyphenated_line_break_joined():
    assert clean_ocr_text("The con-\ntinued story") == "The continued story"


def test_hyphenated_line_break_with_space_joined():
    assert clean_ocr_text("The con- \ntinued story") == "The continued story"


def test_inline_hyphen_preserved():
    assert clean_ocr_text("a well-known fact") == "a well-known fact"


def test_capital_after_hyphen_not_joined():
    # X-\nray must NOT be merged (lookbehind requires lowercase before "-")
    assert clean_ocr_text("an X-\nray image") == "an X-\nray image"


def test_trailing_hyphen_without_following_word_not_touched():
    assert clean_ocr_text("word-") == "word-"


# ── Unicode 痕迹 ──────────────────────────────────────────────────────────

def test_ligatures_replaced():
    assert clean_ocr_text("\ufb01nd \ufb02ag") == "find flag"
    assert clean_ocr_text("a\ufb00ect \ufb03ne \ufb04ow") == "affect ffine fflow"


def test_curly_quotes_replaced():
    assert clean_ocr_text("\u201cHello\u201d and \u2018world\u2019") == '"Hello" and \'world\''


def test_en_dash_replaced_em_dash_kept():
    assert clean_ocr_text("1990\u20132000") == "1990-2000"
    assert clean_ocr_text("one \u2014 two") == "one \u2014 two"


def test_nbsp_replaced():
    assert clean_ocr_text("a\u00a0b") == "a b"


def test_zero_width_removed():
    assert clean_ocr_text("ab\u200bcd\u200de") == "abcde"


def test_replacement_char_removed():
    assert clean_ocr_text("replac\ufffded") == "replaced"


def test_control_chars_removed():
    assert clean_ocr_text("a\x00b\x1fc") == "abc"


# ── 标点与空白 ────────────────────────────────────────────────────────────

def test_space_before_punctuation_fixed():
    assert clean_ocr_text("word , then .") == "word, then."


def test_doubled_punctuation_collapsed():
    assert clean_ocr_text("word..") == "word."
    assert clean_ocr_text("a,, b") == "a, b"


def test_ellipsis_preserved():
    assert clean_ocr_text("Wait... really?") == "Wait... really?"


def test_unicode_ellipsis_normalized():
    assert clean_ocr_text("Wait\u2026 really?") == "Wait... really?"


def test_multi_spaces_collapsed_and_trimmed():
    assert clean_ocr_text("  a   b  ") == "a b"


def test_crlf_normalized():
    assert clean_ocr_text("a\r\nb") == "a\nb"
    assert clean_ocr_text("a\rb") == "a\nb"


# ── 幂等性 ────────────────────────────────────────────────────────────────

def test_idempotent_on_samples():
    samples = [
        "The con-\ntinued story",
        "a well-known fact",
        "\u201cHello\u201d \ufb01ne 1990\u20132000 a\u00a0b",
        "word.. Wait... a,, b\u2026",
        "  lead   and  trail  ",
        "a\x00b\u200b\ufffdc",
    ]
    for s in samples:
        once = clean_ocr_text(s)
        assert clean_ocr_text(once) == once, f"not idempotent for {s!r}"


def test_empty_input():
    assert clean_ocr_text("") == ""


# ── ocr_engine 集成 ───────────────────────────────────────────────────────

def test_content_list_text_cleaned():
    content_list = [
        {"type": "text", "page_idx": 0, "text": "The con-\ntinued story , with \ufb01 ligature"},
    ]
    paragraphs, _pages, _title, _bboxes = _content_list_to_paragraphs(content_list)
    assert paragraphs == ["The continued story, with fi ligature"]


def test_content_list_table_html_passthrough():
    # 表格 HTML 不参与清洗（避免破坏标签），NBSP 保留在 HTML 内。
    # 块需带非空 text 才会进入 table 分支（真实 MinerU 表格块两者都有）。
    html = '<table><td>a\u00a0b</td><td>c&amp;d</td></table>'
    content_list = [
        {"type": "table", "page_idx": 0, "text": "Table 1", "table_body": html},
    ]
    paragraphs, _pages, _title, _bboxes = _content_list_to_paragraphs(content_list)
    assert paragraphs == [html]


def test_content_list_list_items_cleaned():
    content_list = [
        {
            "type": "list",
            "page_idx": 0,
            "text": "items",
            "list_items": [
                {"text": "item con-\none"},
                {"text": "item , two"},
            ],
        },
    ]
    paragraphs, _pages, _title, _bboxes = _content_list_to_paragraphs(content_list)
    assert paragraphs == ["item conone\nitem, two"]


def test_content_list_code_cleaned():
    content_list = [
        {
            "type": "code",
            "page_idx": 0,
            "text": "print('\ufb01ne')\nvalue..",
            "code_body": "print('\ufb01ne')\nvalue..",
        },
    ]
    paragraphs, _pages, _title, _bboxes = _content_list_to_paragraphs(content_list)
    assert paragraphs == ["print('fine')\nvalue."]


def test_title_uses_cleaned_text():
    content_list = [
        {"type": "title", "page_idx": 0, "text": "The \u201c\ufb01nal\u201d word.."},
    ]
    _paragraphs, _pages, title, _bboxes = _content_list_to_paragraphs(content_list)
    assert title == 'The "final" word.'
