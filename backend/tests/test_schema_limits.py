"""请求列表长度上限：防止单请求携带超大列表耗尽 worker。

上限取值按「前端整篇文档一次性发送、目前不分片」的真实调用量来定，因此这里同时
断言边界值仍被接受 —— 上限收紧到会误伤正常文档就是回归。
"""

import pytest
from pydantic import ValidationError

from app.schemas.feedback import AdminFeedbackUpdateRequest
from app.schemas.pdf import ReorderParagraphsRequest, UpdateParagraphItem, UpdateParagraphsRequest
from app.schemas.sentences import SentenceAnalysisRequest, SentenceEntry
from app.schemas.translate import TranslateRequest
from app.schemas.vocabulary import VocabularyBatchAddRequest, VocabularyBatchDeleteRequest
from app.schemas.words import WordAnalysisRequest, WordEntry


def _word_entries(n: int) -> list[WordEntry]:
    return [WordEntry(paragraph_index=i, words=["hello"], sentence="hello world") for i in range(n)]


def _sentence_entries(n: int) -> list[SentenceEntry]:
    return [
        SentenceEntry(paragraph_index=i, sentence_index=0, sentence_text="hello")
        for i in range(n)
    ]


@pytest.mark.parametrize(
    "build,limit,limit_ok",
    [
        (lambda n: WordAnalysisRequest(entries=_word_entries(n), document_id="d"), 1000, 1000),
        (lambda n: SentenceAnalysisRequest(entries=_sentence_entries(n), document_id="d"), 2000, 2000),
        (lambda n: TranslateRequest(paragraphs=[f"p{i}" for i in range(n)]), 2000, 2000),
        (lambda n: TranslateRequest(paragraphs=["x"], indices=list(range(n))), 2000, 2000),
        (lambda n: VocabularyBatchAddRequest(document_id="d", words=[f"w{i}" for i in range(n)]), 5000, 5000),
        (lambda n: VocabularyBatchDeleteRequest(ids=[f"id{i}" for i in range(n)]), 1000, 1000),
        (
            lambda n: UpdateParagraphsRequest(
                paragraphs=[UpdateParagraphItem(index=i, text_en="t") for i in range(n)]
            ),
            2000,
            2000,
        ),
        (lambda n: ReorderParagraphsRequest(ordered_indices=list(range(n))), 2000, 2000),
        (lambda n: AdminFeedbackUpdateRequest(admin_reply="x" * n), 2000, 2000),
    ],
)
def test_list_fields_are_capped(build, limit, limit_ok):
    # 上限内正常通过
    build(limit_ok)
    # 超出上限必须被拒（422），否则超大列表会拖垮 worker
    with pytest.raises(ValidationError):
        build(limit + 1)
