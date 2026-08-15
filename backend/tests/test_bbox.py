"""单元测试：MinerU bbox 布局坐标链路（PDF 预览解析框）。

覆盖：
  - _content_list_to_paragraphs 提取 text/title/list 并集/table/code/equation 的 bbox
  - 5 元素 bbox（带置信度）兼容；缺 bbox → None；markdown 回退 → 全 None
  - _parse_layout（api/v1/pdf.py）解析 bbox_json → layout dict / 损坏回退 None
  - pdf_service.parse_document 将 bbox + 页面点数尺寸写入 Paragraph.bbox_json
    （PDF 源写入；非 PDF / 无 bbox → None）
"""

import json
import os
import tempfile
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1.pdf import _parse_layout
from app.database import Base
from app.models.document import Document
from app.models.paragraph import Paragraph
from app.services.ocr_engine import ParsedDocument, _content_list_to_paragraphs
from app.services.pdf_service import PDFService


# ── _content_list_to_paragraphs bbox 提取 ──────────────────────────────────

def test_text_block_bbox_extracted():
    content_list = [
        {"type": "text", "page_idx": 0, "text": "Hello world", "bbox": [10, 20, 300, 400]},
    ]
    paragraphs, pages, _title, bboxes = _content_list_to_paragraphs(content_list)
    assert paragraphs == ["Hello world"]
    assert pages == [1]
    assert bboxes == [[10.0, 20.0, 300.0, 400.0]]


def test_five_element_bbox_keeps_first_four():
    # 部分 MinerU 版本 bbox 带置信度 [x1,y1,x2,y2,score]
    content_list = [
        {"type": "text", "page_idx": 0, "text": "Hi", "bbox": [1, 2, 3, 4, 0.98]},
    ]
    _paragraphs, _pages, _title, bboxes = _content_list_to_paragraphs(content_list)
    assert bboxes == [[1.0, 2.0, 3.0, 4.0]]


def test_missing_bbox_is_none():
    content_list = [
        {"type": "text", "page_idx": 0, "text": "No box"},
    ]
    _paragraphs, _pages, _title, bboxes = _content_list_to_paragraphs(content_list)
    assert bboxes == [None]


def test_invalid_bbox_is_none():
    content_list = [
        {"type": "text", "page_idx": 0, "text": "Bad box", "bbox": "not-a-list"},
        {"type": "text", "page_idx": 1, "text": "Short box", "bbox": [1, 2]},
        {"type": "text", "page_idx": 2, "text": "NaN box", "bbox": [1, 2, 3, "x"]},
    ]
    _paragraphs, _pages, _title, bboxes = _content_list_to_paragraphs(content_list)
    assert bboxes == [None, None, None]


def test_title_and_equation_bbox():
    content_list = [
        {"type": "title", "page_idx": 0, "text": "Title", "bbox": [0, 0, 500, 60]},
        {"type": "equation", "page_idx": 0, "text": "a=b", "bbox": [50, 100, 200, 150]},
    ]
    paragraphs, pages, title, bboxes = _content_list_to_paragraphs(content_list)
    assert title == "Title"
    assert paragraphs == ["Title", "[公式] a=b"]
    assert bboxes == [[0.0, 0.0, 500.0, 60.0], [50.0, 100.0, 200.0, 150.0]]


def test_list_bbox_is_union_of_items():
    content_list = [
        {
            "type": "list",
            "page_idx": 0,
            "text": "items",
            "list_items": [
                {"text": "a", "bbox": [0, 10, 100, 30]},
                {"text": "b", "bbox": [20, 40, 300, 60]},
            ],
        },
    ]
    _paragraphs, _pages, _title, bboxes = _content_list_to_paragraphs(content_list)
    assert bboxes == [[0.0, 10.0, 300.0, 60.0]]


def test_list_without_item_bbox_falls_back_to_block_bbox():
    content_list = [
        {
            "type": "list",
            "page_idx": 0,
            "text": "items",
            "bbox": [5, 5, 400, 90],
            "list_items": [{"text": "a"}, {"text": "b"}],
        },
    ]
    _paragraphs, _pages, _title, bboxes = _content_list_to_paragraphs(content_list)
    assert bboxes == [[5.0, 5.0, 400.0, 90.0]]


def test_table_and_code_bbox():
    content_list = [
        {
            "type": "table",
            "page_idx": 1,
            "text": "tbl",
            "table_body": "<table><tr><td>x</td></tr></table>",
            "bbox": [10, 200, 500, 400],
        },
        {"type": "code", "page_idx": 1, "text": "print(1)", "code_body": "print(1)", "bbox": [10, 500, 400, 560]},
    ]
    paragraphs, pages, _title, bboxes = _content_list_to_paragraphs(content_list)
    assert pages == [2, 2]
    assert bboxes == [[10.0, 200.0, 500.0, 400.0], [10.0, 500.0, 400.0, 560.0]]


def test_markdown_fallback_bboxes_all_none():
    paragraphs, pages, title, bboxes = _content_list_to_paragraphs(
        [{"type": "text", "page_idx": 0, "text": "x"}]
    )
    assert bboxes == [None]


# ── _parse_layout ──────────────────────────────────────────────────────────

def test_parse_layout_valid():
    layout = _parse_layout(
        json.dumps({"box": [1, 2, 3, 4], "pts_w": 612, "pts_h": 792, "scale": 2.777})
    )
    assert layout == {"box": [1.0, 2.0, 3.0, 4.0], "pts_w": 612.0, "pts_h": 792.0, "scale": 2.777}


def test_parse_layout_without_scale_ok():
    # 旧数据无 scale → 不包含 scale 键（前端回退 200dpi 假设）
    layout = _parse_layout(json.dumps({"box": [1, 2, 3, 4], "pts_w": 612, "pts_h": 792}))
    assert layout == {"box": [1.0, 2.0, 3.0, 4.0], "pts_w": 612.0, "pts_h": 792.0}
    assert "scale" not in layout


def test_parse_layout_none_or_corrupt():
    assert _parse_layout(None) is None
    assert _parse_layout("") is None
    assert _parse_layout("not json") is None
    assert _parse_layout(json.dumps({"box": [1, 2]})) is None  # 短 box
    assert _parse_layout(json.dumps({"box": [1, 2, 3, 4]})) is None  # 缺 pts
    assert _parse_layout(json.dumps({"box": [1, 2, 3, 4], "pts_w": 0, "pts_h": 0})) is None


# ── pdf_service.parse_document 落库 ────────────────────────────────────────

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


def _make_pdf(path: str, width: float = 612.0, height: float = 792.0) -> None:
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=width, height=height)
    with open(path, "wb") as f:
        writer.write(f)


class _FakeOCR:
    """MinerU OCR 返回带 bbox 的 ParsedDocument。"""

    def __init__(self, parsed: ParsedDocument):
        self._parsed = parsed

    async def parse_file(self, file_path, api_token="", selected_pages=None):
        return self._parsed


async def _seed_doc(db: AsyncSession, file_path, file_ext=".pdf") -> Document:
    doc = Document(
        id=uuid.uuid4(),
        title="t",
        original_text="",
        parse_status="processing",
        file_path=file_path,
        file_ext=file_ext,
        source_type="upload",
        source=None,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@pytest.mark.asyncio
async def test_parse_document_writes_bbox_json_with_pts_dims(db):
    tmp_pdf = os.path.join(tempfile.gettempdir(), f"bbox_{uuid.uuid4().hex}.pdf")
    _make_pdf(tmp_pdf, width=612, height=792)
    try:
        parsed = ParsedDocument(
            title="Doc",
            paragraphs=["hello world"],
            paragraph_page_numbers=[1],
            paragraph_bboxes=[[10, 20, 300, 400]],
            word_count=2,
            total_pages=1,
        )
        svc = PDFService(ocr=_FakeOCR(parsed))
        doc = await _seed_doc(db, tmp_pdf)
        await svc.parse_document(doc.id, db, mineru_token="")

        row = (await db.execute(select(Paragraph))).scalar_one()
        data = json.loads(row.bbox_json)
        assert data["box"] == [10.0, 20.0, 300.0, 400.0]
        assert data["pts_w"] == 612.0
        assert data["pts_h"] == 792.0
        # 标准 A4/Letter 页不触发长边钳制 → scale = 200/72
        assert abs(data["scale"] - 200.0 / 72.0) < 1e-9
    finally:
        if os.path.exists(tmp_pdf):
            os.unlink(tmp_pdf)


@pytest.mark.asyncio
async def test_parse_document_scale_clamped_for_huge_pages(db):
    # 超长页面触发 MinerU 的 3500px 长边钳制：scale = 3500/长边
    tmp_pdf = os.path.join(tempfile.gettempdir(), f"bbox_{uuid.uuid4().hex}.pdf")
    _make_pdf(tmp_pdf, width=612, height=5000)
    try:
        parsed = ParsedDocument(
            title="Doc",
            paragraphs=["hello world"],
            paragraph_page_numbers=[1],
            paragraph_bboxes=[[10, 20, 300, 400]],
            word_count=2,
            total_pages=1,
        )
        svc = PDFService(ocr=_FakeOCR(parsed))
        doc = await _seed_doc(db, tmp_pdf)
        await svc.parse_document(doc.id, db, mineru_token="")

        row = (await db.execute(select(Paragraph))).scalar_one()
        data = json.loads(row.bbox_json)
        assert abs(data["scale"] - 3500.0 / 5000.0) < 1e-9
    finally:
        if os.path.exists(tmp_pdf):
            os.unlink(tmp_pdf)


@pytest.mark.asyncio
async def test_parse_document_non_pdf_ignores_bbox(db):
    tmp_file = os.path.join(tempfile.gettempdir(), f"bbox_{uuid.uuid4().hex}.docx")
    open(tmp_file, "wb").close()  # 非 PDF 源不读页尺寸
    try:
        parsed = ParsedDocument(
            title="Doc",
            paragraphs=["hello"],
            paragraph_page_numbers=[1],
            paragraph_bboxes=[[10, 20, 300, 400]],
            word_count=1,
            total_pages=1,
        )
        svc = PDFService(ocr=_FakeOCR(parsed))
        doc = await _seed_doc(db, tmp_file, file_ext=".docx")
        await svc.parse_document(doc.id, db, mineru_token="")

        row = (await db.execute(select(Paragraph))).scalar_one()
        assert row.bbox_json is None
    finally:
        if os.path.exists(tmp_file):
            os.unlink(tmp_file)


@pytest.mark.asyncio
async def test_parse_document_without_bbox_writes_none(db):
    tmp_pdf = os.path.join(tempfile.gettempdir(), f"bbox_{uuid.uuid4().hex}.pdf")
    _make_pdf(tmp_pdf)
    try:
        parsed = ParsedDocument(
            title="Doc",
            paragraphs=["no box here"],
            paragraph_page_numbers=[1],
            paragraph_bboxes=[None],
            word_count=3,
            total_pages=1,
        )
        svc = PDFService(ocr=_FakeOCR(parsed))
        doc = await _seed_doc(db, tmp_pdf)
        await svc.parse_document(doc.id, db, mineru_token="")

        row = (await db.execute(select(Paragraph))).scalar_one()
        assert row.bbox_json is None
    finally:
        if os.path.exists(tmp_pdf):
            os.unlink(tmp_pdf)
