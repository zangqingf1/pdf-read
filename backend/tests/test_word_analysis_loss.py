"""复现 bug：单词批量解析时单词静默丢失。

用户报告：选择较多单词解析时，解析变慢，一段时间后停止，
部分单词丢失、未解析。

复现路径（均通过 mock AI 客户端，不消耗真实 API）：
1. AI 批次返回的单词数 < 请求单词数 → 缺失单词无结果（丢失）
2. 批次请求失败（如 429 限流 / 超时）→ 整批单词无结果（丢失）
3. 补偿失败后的单词应通过 incomplete 事件上报，而不是静默消失

修复前这些测试失败（证明 bug 存在），修复后应全部通过。
"""

import asyncio
import json

import httpx
import pytest

from app.services.ai_service import AIService


def _sse_lines(content: str) -> list[str]:
    """把完整 content 切成小块模拟 DeepSeek token 流。"""
    lines = []
    for i in range(0, len(content), 4):
        piece = content[i : i + 4]
        lines.append(
            "data: "
            + json.dumps({"choices": [{"delta": {"content": piece}}]})
        )
    lines.append("data: [DONE]")
    return lines


def _word_json(words: list[str]) -> str:
    arr = [
        {
            "word": w,
            "phonetic": "/x/",
            "part_of_speech": "n.",
            "definition": f"definition of {w}",
            "definition_zh": f"{w}的释义",
            "collocations": [],
            "example_sentence": f"Example for {w}.",
            "cognates": [],
            "synonyms_antonyms": {"synonyms": []},
        }
        for w in words
    ]
    return json.dumps(arr, ensure_ascii=False)


class FakeStreamResponse:
    """模拟 DeepSeek 流式响应（可带任意 HTTP 状态码）。"""

    def __init__(self, lines: list[str], status: int = 200):
        self._lines = lines
        self.status = status

    def raise_for_status(self):
        if self.status >= 400:
            req = httpx.Request("POST", "https://fake/v1/chat/completions")
            raise httpx.HTTPStatusError(
                f"HTTP {self.status}", request=req,
                response=httpx.Response(self.status, request=req),
            )

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class FakeJsonResponse:
    """模拟非流式响应（raise_for_status + json）。"""

    def __init__(self, status: int = 200, data: dict | None = None):
        self.status = status
        self._data = data or {}

    def raise_for_status(self):
        if self.status >= 400:
            req = httpx.Request("POST", "https://fake/v1/chat/completions")
            raise httpx.HTTPStatusError(
                f"HTTP {self.status}", request=req,
                response=httpx.Response(self.status, request=req),
            )

    def json(self):
        return self._data


class FakeClient:
    """按顺序返回预设响应的假 httpx client。

    ``post`` 返回 FakeJsonResponse，``stream`` 返回 FakeStreamResponse，
    两者共享同一个响应序列，便于测试"先批次失败、后补偿成功"。
    """

    def __init__(self, responses: list):
        self._responses = list(responses)
        self._i = 0
        self.calls = 0
        self.prompts: list[list[dict]] = []  # 记录每次请求的 messages
        self.payloads: list[dict] = []  # 记录完整请求 payload

    def _next(self):
        self.calls += 1
        resp = self._responses[min(self._i, len(self._responses) - 1)]
        self._i += 1
        return resp

    def stream(self, method, url, json=None):
        # 与真实 httpx 一致: stream() 同步返回 context manager
        if json:
            self.prompts.append(json.get("messages", []))
            self.payloads.append(json)
        return self._next()

    async def post(self, url, json=None):
        if json:
            self.payloads.append(json)
        return self._next()


def _make_service(fake: FakeClient) -> AIService:
    ai = AIService(api_key="test-key", base_url="https://fake/v1")
    ai._client = fake  # type: ignore[attr-defined]
    return ai


def _entries(words: list[str], sentence: str = "The words are here.") -> list[dict]:
    return [
        {"paragraph_index": 0, "word": w, "sentence": sentence, "sentence_translation": None}
        for w in words
    ]


def _collect(events: list[dict]) -> dict:
    """从事件流中提取 batch 结果与 incomplete 上报。"""
    results = [
        r for e in events if e["type"] == "batch" for r in e["results"]
    ]
    incomplete = [
        (e.get("para_index"), w["word"].lower())
        for e in events if e["type"] == "incomplete"
        for w in e.get("words", [])
    ]
    return {"results": results, "incomplete": incomplete}


def _words_of(results: list[dict]) -> set[str]:
    return {r["word"].lower() for r in results}


# ── 测试 1：AI 只返回部分单词 → 缺失单词丢失 ──────────────────────


@pytest.mark.asyncio
async def test_stream_partial_batch_loses_words():
    words = [f"word{i}" for i in range(8)]
    # 流式批次只返回前 5 个; 缺失的 3 个单词由补偿请求补发(单词级成功)
    fake = FakeClient(
        [FakeStreamResponse(_sse_lines(_word_json(words[:5])))]
        + [
            FakeJsonResponse(data={"choices": [{"message": {"content": _word_json([w])}}]})
            for w in words[5:]
        ]
    )
    ai = _make_service(fake)

    events = [e async for e in ai.analyze_words_stream(_entries(words))]
    got = _collect(events)

    assert len(_words_of(got["results"])) == 8, (
        f"丢失 {8 - len(_words_of(got['results']))} 个单词: "
        f"{set(words) - _words_of(got['results'])}"
    )


# ── 测试 2：批次请求 429 失败 → 整批单词丢失 ──────────────────────


@pytest.mark.asyncio
async def test_stream_batch_429_loses_all_words():
    words = [f"word{i}" for i in range(8)]
    # 批次流式 3 次重试全部 429 → 触发单词级补偿（每个单词一个请求，成功）
    fake = FakeClient(
        [FakeStreamResponse([], status=429)] * 3
        + [
            FakeJsonResponse(data={"choices": [{"message": {"content": _word_json([w])}}]})
            for w in words
        ]
    )
    ai = _make_service(fake)

    events = [e async for e in ai.analyze_words_stream(_entries(words))]
    got = _collect(events)

    assert len(_words_of(got["results"])) == 8, (
        f"429 后整批丢失: 只拿到 {len(_words_of(got['results']))} 个"
    )


# ── 测试 3：补偿也失败 → incomplete 事件上报缺失单词 ────────────────


@pytest.mark.asyncio
async def test_stream_reports_missing_words_when_compensation_fails():
    words = [f"word{i}" for i in range(8)]
    # 批次 3 次 attempt 与 8 个单词级补偿请求全部 429 → 全部缺失需上报
    fake = FakeClient(
        [FakeStreamResponse([], status=429)] * 3
        + [FakeJsonResponse(status=429)] * 8
    )
    ai = _make_service(fake)

    events = [e async for e in ai.analyze_words_stream(_entries(words))]
    got = _collect(events)

    missing = {w for w in words if w.lower() not in got["results"]}
    reported = {w for _, w in got["incomplete"]}
    assert reported == missing, (
        f"未上报缺失单词: 缺 {missing - reported}"
    )


# ── 测试 3.5：慢批次期间发出心跳, 前端读超时不会误杀 ────────────────


@pytest.mark.asyncio
async def test_stream_emits_heartbeat_while_waiting():
    words = [f"word{i}" for i in range(8)]

    class SlowResponse(FakeStreamResponse):
        """延迟 0.15s 才产出第一行, 模拟慢批次/排队。"""

        async def aiter_lines(self):
            await asyncio.sleep(0.15)
            for line in self._lines:
                yield line

    fake = FakeClient([SlowResponse(_sse_lines(_word_json(words)))])
    ai = _make_service(fake)
    ai.heartbeat_interval = 0.05  # type: ignore[attr-defined]

    events = [e async for e in ai.analyze_words_stream(_entries(words))]
    heartbeats = [e for e in events if e["type"] == "heartbeat"]

    assert len(heartbeats) >= 1, "慢批次等待期间应发出心跳保活"
    assert len(_words_of(_collect(events)["results"])) == 8, "心跳不应影响最终结果"


# ── 测试 3.8：按段落分组 — 同段落不同句子的单词合并为一个批次 ────────


@pytest.mark.asyncio
async def test_grouping_by_paragraph_not_sentence():
    """同一段落内上下文不同的单词也应合并为一个批次 (段落分组)。"""
    words = [f"word{i}" for i in range(8)]
    # 每个单词带不同的句子字段 — 修复前按句子分组会拆成 8 批
    entries = [
        {"paragraph_index": 0, "word": w, "sentence": f"Different sentence {i}.", "sentence_translation": None}
        for i, w in enumerate(words)
    ]
    fake = FakeClient([FakeStreamResponse(_sse_lines(_word_json(words)))])
    ai = _make_service(fake)

    events = [e async for e in ai.analyze_words_stream(entries)]
    batches = [e for e in events if e["type"] == "batch"]

    assert len(batches) == 1, f"应按段落分组为 1 批, 实际 {len(batches)} 批"
    assert len(_words_of(_collect(events)["results"])) == 8

    # 流式请求用第一个 entry 的 sentence 作为段落原文 (组内共享)
    assert fake.prompts, "应发出过 AI 请求"
    user_msg = fake.prompts[0][-1]["content"]
    assert "Different sentence 0." in user_msg, "prompt 应包含完整段落原文"


@pytest.mark.asyncio
async def test_prompt_contains_full_paragraph():
    """prompt 的 {paragraph} 占位符应填充完整段落原文。"""
    words = ["gravity", "orbit"]
    para_text = "Gravity shapes the trajectory of every celestial body in orbit."
    entries = [
        {"paragraph_index": 0, "word": w, "sentence": para_text, "sentence_translation": None}
        for w in words
    ]
    fake = FakeClient([FakeStreamResponse(_sse_lines(_word_json(words)))])
    ai = _make_service(fake)

    events = [e async for e in ai.analyze_words_stream(entries)]
    assert len(_words_of(_collect(events)["results"])) == 2

    user_msg = fake.prompts[0][-1]["content"]
    assert para_text in user_msg, "prompt 应包含完整段落原文"
    assert "gravity" in user_msg and "orbit" in user_msg


# ── 测试 5：推理模型空 content (reasoning 吃光 max_tokens) ─────────


@pytest.mark.asyncio
async def test_empty_stream_content_falls_back_to_compensation():
    """流式批次 content 为空 (deepseek-v4-flash thinking 模式) → 补偿兜底。"""
    words = [f"word{i}" for i in range(8)]
    # 流式批次 3 次重试都无 content token (只有 [DONE]) — 模拟推理模型
    # reasoning 吃光 max_tokens; 补偿: 8 个单词级请求成功
    fake = FakeClient(
        [FakeStreamResponse(["data: [DONE]"])] * 3
        + [
            FakeJsonResponse(data={"choices": [{"message": {"content": _word_json([w])}}]})
            for w in words
        ]
    )
    ai = _make_service(fake)

    events = [e async for e in ai.analyze_words_stream(_entries(words))]
    got = _collect(events)

    assert len(_words_of(got["results"])) == 8, (
        f"空 content 后应通过补偿拿到全部单词, 实际 {len(_words_of(got['results']))}"
    )


@pytest.mark.asyncio
async def test_json_wrapped_in_reasoning_text():
    """AI 输出带推理文本包裹 → _parse_json_content 提取出 JSON 数组。"""
    words = ["word0", "word1"]
    wrapped = "先逐词分析如下：\n" + _word_json(words) + "\n以上是全部结果。"
    fake = FakeClient([FakeStreamResponse(_sse_lines(wrapped))])
    ai = _make_service(fake)

    events = [e async for e in ai.analyze_words_stream(_entries(words))]
    got = _collect(events)

    assert len(_words_of(got["results"])) == 2, "推理文本包裹不应导致解析失败"


@pytest.mark.asyncio
async def test_word_request_max_tokens_floor():
    """单词分析请求 max_tokens 下限 ≥ 2048 (推理模型 reasoning 占用)。"""
    words = [f"word{i}" for i in range(2)]
    fake = FakeClient([FakeStreamResponse(_sse_lines(_word_json(words)))])
    ai = _make_service(fake)

    [e async for e in ai.analyze_words_stream(_entries(words))]
    assert fake.payloads, "应发出过 AI 请求"
    for p in fake.payloads:
        assert p["max_tokens"] >= 2048, f"max_tokens 应 ≥ 2048, 实际 {p['max_tokens']}"


# ── 测试 4：非流式 /analyze 同样补偿缺失单词 ───────────────────────


@pytest.mark.asyncio
async def test_analyze_partial_batch_loses_words():
    words = [f"word{i}" for i in range(8)]
    # 第一批只返回前 5 个；后续每个缺失单词单发一个完整结果
    # （非流式用 post；补偿单请求也用 post）
    fake = FakeClient(
        [FakeJsonResponse(data={"choices": [{"message": {"content": _word_json(words[:5])}}]})]
        + [FakeJsonResponse(data={"choices": [{"message": {"content": _word_json([w])}}]}) for w in words[5:]]
    )
    ai = _make_service(fake)

    results = await ai.analyze_words(_entries(words))
    assert len(_words_of(results)) == 8, (
        f"丢失 {8 - len(_words_of(results))} 个单词: "
        f"{set(words) - _words_of(results)}"
    )


# ── 测试 6：DB 自定义 prompt 覆盖应进入最终 AI 请求 ───────────────


def test_prompt_override_reaches_payload():
    """用户保存的模板 (含 {paragraph}) 应完整进入请求且占位符被填充。"""
    from app.services.ai_service import _resolve_prompt

    user_template = (
        "请分析以下英语单词在给定英文段落中的用法。"
        "测试，一律返回test\n\n"
        '段落原文："{paragraph}"\n'
        "待分析单词：{words_list}"
    )
    messages = _resolve_prompt(
        "analyze_words",
        {
            "words_list": "gravity, orbit",
            "paragraph": "Gravity shapes the orbit.",
            "sentence": "Gravity shapes the orbit.",
            "sentence_translation": "无",
        },
        system_override=None,
        user_override=user_template,
    )
    content = messages[-1]["content"]
    assert "测试" in content, "用户模板内容应出现在请求中"
    assert "Gravity shapes the orbit." in content, "{paragraph} 应被段落原文填充"
    assert "{paragraph}" not in content, "占位符不应以字面形式残留"


# ── 测试 7：单词分析请求应禁用 thinking (消除静默推理等待) ─────────


@pytest.mark.asyncio
async def test_word_requests_disable_thinking():
    """deepseek-v4-flash 默认开启 thinking — 推理阶段无 content 输出
    (前端表现为"等待 AI 响应"), 且损坏 JSON。单词分析应显式禁用。"""
    words = [f"word{i}" for i in range(2)]
    fake = FakeClient([FakeStreamResponse(_sse_lines(_word_json(words)))])
    ai = _make_service(fake)

    [e async for e in ai.analyze_words_stream(_entries(words))]
    assert fake.payloads, "应发出过 AI 请求"
    for p in fake.payloads:
        assert p.get("thinking") == {"type": "disabled"}, (
            f"应禁用 thinking, 实际 {p.get('thinking')}"
        )
