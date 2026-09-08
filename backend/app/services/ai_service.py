"""AI API service — DeepSeek with parallel batch processing."""

import asyncio
import json
import logging
import random
import re
from collections.abc import AsyncGenerator

import httpx

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services.prompt_defaults import DEFAULT_PROMPTS, PLACEHOLDERS

logger = logging.getLogger(__name__)

# ── 进程级共享资源 ─────────────────────────────────────────────────────
# 客户端按 (base_url, model, api_key) 复用连接池；并发信号量全局唯一，
# 避免"每个请求一个连接池 / 每方法一个 Semaphore"导致上游并发失控。
_SHARED_CLIENTS: dict[tuple[str, str, str], httpx.AsyncClient] = {}
_MAX_SHARED_CLIENTS = 64
_AI_SEMAPHORES: dict[int, asyncio.Semaphore] = {}


def _client_pool_key(base_url: str, model: str, api_key: str) -> tuple[str, str, str]:
    return (base_url or "", model or "", api_key or "")


def _get_shared_ai_semaphore(concurrency: int) -> asyncio.Semaphore:
    semaphore = _AI_SEMAPHORES.get(concurrency)
    if semaphore is None:
        semaphore = asyncio.Semaphore(concurrency)
        _AI_SEMAPHORES[concurrency] = semaphore
    return semaphore


def _build_ai_client(
    base_url: str, model: str, api_key: str, concurrency: int
) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=base_url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        timeout=httpx.Timeout(120.0, connect=10.0),
        limits=httpx.Limits(
            max_connections=concurrency + 5,
            max_keepalive_connections=concurrency,
        ),
    )


def _get_shared_ai_client(
    base_url: str, model: str, api_key: str, concurrency: int
) -> httpx.AsyncClient:
    key = _client_pool_key(base_url, model, api_key)
    client = _SHARED_CLIENTS.get(key)
    if client is None:
        client = _build_ai_client(base_url, model, api_key, concurrency)
        if len(_SHARED_CLIENTS) >= _MAX_SHARED_CLIENTS:
            oldest_key, oldest_client = next(iter(_SHARED_CLIENTS.items()))
            _SHARED_CLIENTS.pop(oldest_key, None)
            try:
                asyncio.get_running_loop().create_task(oldest_client.aclose())
            except RuntimeError:
                pass
        _SHARED_CLIENTS[key] = client
    return client


async def close_ai_clients() -> None:
    """App shutdown: close every cached httpx client."""
    clients = list(_SHARED_CLIENTS.values())
    _SHARED_CLIENTS.clear()
    if clients:
        await asyncio.gather(
            *(client.aclose() for client in clients), return_exceptions=True
        )


def _retry_delay(attempt: int, exc: Exception | None = None) -> float:
    """指数退避 + Retry-After + 随机抖动，避免同批任务同步重试惊群。"""
    delay = float(2 ** attempt)
    if isinstance(exc, httpx.HTTPStatusError):
        try:
            retry_after = int(exc.response.headers.get("Retry-After", ""))
            delay = max(delay, float(retry_after))
        except (TypeError, ValueError):
            pass
    return delay + random.uniform(0, min(1.0, delay))


class _SafeDict(dict):
    """A dict that returns the key itself wrapped in braces for missing keys.

    Used with ``str.format_map()`` so that unknown placeholders like ``{foo}``
    remain as literal text instead of raising ``KeyError``.
    """

    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def _extract_json_span(text: str, start_ch: str) -> str | None:
    """从 ``start_ch`` 起做括号匹配，提取配对的 JSON 片段。

    处理字符串内的引号/转义，避免 ``\"}\"`` 被误判为闭合。
    """
    start = text.find(start_ch)
    if start < 0:
        return None
    open_ch = start_ch
    close_ch = "}" if start_ch == "{" else "]"
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def _parse_json_content(content: str):
    """解析模型输出为 JSON，容忍 markdown 代码块与推理文本前后包裹。

    DeepSeek V4 系列（thinking 模式默认开启）可能在 JSON 前后附加
    解释性文本（"以下是结果"等），直接 ``json.loads`` 会失败 —
    用括号匹配提取完整 JSON 片段再解析。
    """
    text = (content or "").strip()

    # Strip markdown code fences if present
    if text.startswith("```"):
        text = text.removeprefix("```json").removeprefix("```").strip()
        if text.endswith("```"):
            text = text[:-3].strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # 推理文本包裹：括号匹配提取完整片段。
        # 先试 "[": prompt 要求输出 JSON 数组 — 从数组内第一个对象 "{"
        # 提取会拿到单个对象 (合法 JSON 但缺外层数组), 导致结果丢失。
        for start_ch in ("[", "{"):
            span = _extract_json_span(text, start_ch)
            if span:
                try:
                    return json.loads(span)
                except json.JSONDecodeError:
                    continue
        raise


def _is_fatal_error(exc: Exception) -> bool:
    """Check whether an exception should fail the entire batch.

    Auth / config errors affect *every* item, so they must propagate to the
    API endpoint so the frontend can show an actionable error (e.g. "API Key
    无效").  Per-item errors (timeout, rate-limit, malformed response) only
    fail that one item and return an empty placeholder.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        # 401/403 鉴权错误 + 402 余额不足对所有条目同样致命，不重试。
        return status in (401, 403, 402)
    # ValueError is raised for missing API key — a config error, not transient
    if isinstance(exc, ValueError):
        return True
    return False


def _resolve_prompt(
    template_type: str,
    format_kwargs: dict[str, str],
    system_override: str | None = None,
    user_override: str | None = None,
) -> list[dict[str, str]]:
    """Build the messages list for a chat completion request.

    Returns a list of message dicts.  When a system prompt is present (either
    from overrides or defaults), a ``{"role": "system"}`` message is prepended.

    Uses ``str.format_map()`` with a ``_SafeDict`` so that unknown placeholders
    are left as-is instead of crashing.  A warning is logged when placeholders
    referenced in the template are not present in *format_kwargs*.
    """
    defaults = DEFAULT_PROMPTS[template_type]
    system_prompt = system_override if system_override is not None else defaults["system_prompt"]
    user_template = user_override if user_override is not None else defaults["user_prompt"]

    # Warn about placeholders in template that are not in format_kwargs
    expected = set(PLACEHOLDERS.get(template_type, []))
    actual = set(re.findall(r"\{(\w+)\}", user_template))
    missing = actual - expected
    if missing:
        logger.warning(
            "Prompt template '%s' has unknown placeholder(s): %s. "
            "They will be left as literal text.",
            template_type, ", ".join("{" + p + "}" for p in missing),
        )

    formatted_user = user_template.format_map(_SafeDict(format_kwargs))

    messages: list[dict[str, str]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": formatted_user})
    return messages


# 单词分析 prompt 骨架：段落上下文只格式化一次，每批只替换 words_list。
# 先经 format_map 时用哨兵占位，之后恢复成字面 {words_list} 供逐批替换。
_WORDS_LIST_SENTINEL = "\u0000WORDS_LIST\u0000"


def _resolve_word_prompt_skeleton(
    sentence: str,
    sentence_translation: str | None,
    *,
    system_prompt_override: str | None,
    user_prompt_override: str | None,
) -> list[dict[str, str]]:
    """Resolve the analyze_words prompt once per paragraph.

    返回的 messages 中 user 内容保留字面 ``{words_list}`` 占位符；
    每批请求经 :func:`_messages_with_words` 只做一次字符串替换，
    避免同段落多批重复携带/格式化整段原文。
    """
    messages = _resolve_prompt(
        "analyze_words",
        {
            "words_list": _WORDS_LIST_SENTINEL,
            "sentence": sentence,  # 兼容旧自定义模板的占位符名
            "paragraph": sentence,  # 完整段落原文
            "sentence_translation": sentence_translation or "无",
        },
        system_override=system_prompt_override,
        user_override=user_prompt_override,
    )
    for msg in messages:
        if msg["role"] == "user":
            msg["content"] = msg["content"].replace(
                _WORDS_LIST_SENTINEL, "{words_list}"
            )
    return messages


def _messages_with_words(
    skeleton: list[dict[str, str]], words_list: str
) -> list[dict[str, str]]:
    """Substitute the per-batch word list into a resolved prompt skeleton."""
    messages: list[dict[str, str]] = []
    for msg in skeleton:
        if msg["role"] == "user":
            messages.append(
                {"role": "user", "content": msg["content"].replace("{words_list}", words_list)}
            )
        else:
            messages.append(msg)
    return messages


async def resolve_prompt_overrides(
    db: AsyncSession, name: str
) -> tuple[str | None, str | None]:
    """Resolve effective prompt overrides with two-tier lookup.

    Resolution order:
    1. Custom override  (is_default=False) — user-level customization
    2. System default   (is_default=True)  — admin-defined default
    3. Factory default  (prompt_defaults.py) — hardcoded fallback (None, None)

    Returns ``(system_prompt, user_prompt)`` or ``(None, None)`` to use
    the factory default.
    """
    from app.models.prompt_template import PromptTemplate

    stmt = (
        select(PromptTemplate)
        .where(PromptTemplate.name == name)
        .order_by(PromptTemplate.is_default.asc())  # False (0) before True (1)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    for row in rows:
        system = row.system_prompt if row.system_prompt else None
        user = row.user_prompt if row.user_prompt else None
        if system or user:
            return (system, user)

    return (None, None)


class AIService:
    """AI API wrapper for paragraph translation with parallel batches.

    Uses the DeepSeek API.
    """

    # 流式 SSE 无事件时的心跳间隔 (秒)。批次慢/排队时保证连接
    # 持续有数据, 前端读超时不会误杀正在等待的长任务。
    heartbeat_interval = 60.0

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ):
        self.api_key = api_key or ""
        self.base_url = base_url or settings.DEEPSEEK_BASE_URL
        # Normalize: ensure base_url ends with /v1 for backward compat
        # Old .env files may have "https://api.deepseek.com" without /v1
        if self.base_url and "api.deepseek.com" in self.base_url and not self.base_url.rstrip("/").endswith("/v1"):
            self.base_url = self.base_url.rstrip("/") + "/v1"
            logger.info("Normalized DEEPSEEK_BASE_URL to %s", self.base_url)
        self.model = model or settings.DEEPSEEK_MODEL
        self._client: httpx.AsyncClient | None = None
        # 共享池中的 client 不属于本实例：close() 只解绑，不销毁池内连接。
        self._owns_client = False

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            concurrency = getattr(settings, "AI_CONCURRENCY", 15)
            self._client = _get_shared_ai_client(
                self.base_url, self.model, self.api_key, concurrency
            )
        return self._client

    async def translate(
        self,
        text: str,
        prev_text: str | None = None,
        next_text: str | None = None,
        *,
        system_prompt_override: str | None = None,
        user_prompt_override: str | None = None,
    ) -> str:
        """Translate an English paragraph to Chinese, with optional context.

        When prev_text/next_text are provided, they are included in the prompt
        as surrounding context so the AI can resolve ambiguities (e.g. "bank" →
        "银行" in finance context vs "河岸" in nature context).

        Set ``system_prompt_override`` / ``user_prompt_override`` to use a
        custom prompt template instead of the built-in default.
        """
        if not self.api_key or not self.api_key.strip():
            raise ValueError(
                "AI API Key 未配置。请点击页面右上角🔑图标设置。"
            )

        messages = _resolve_prompt(
            "translate",
            {
                "text": text,
                "prev_text": prev_text or "",
                "next_text": next_text or "",
            },
            system_override=system_prompt_override,
            user_override=user_prompt_override,
        )

        # Thinking mode is disabled so the whole token budget goes to the
        # translation itself (reasoning otherwise burns max_tokens and can
        # return an empty answer on long paragraphs).
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": max(2048, min(len(text) * 3, 8192)),
            "thinking": {"type": "disabled"},
        }

        for attempt in range(3):
            try:
                response = await self.client.post(
                    "/chat/completions", json=payload
                )
                response.raise_for_status()
                data = response.json()

                if "error" in data:
                    err = data["error"]
                    raise httpx.HTTPStatusError(
                            f"API error ({self.model}): {err.get('message', str(err))}",
                        request=response.request,
                        response=response,
                    )

                content = data["choices"][0]["message"]["content"].strip()
                if not content:
                    # Model returned nothing (e.g. reasoning consumed the
                    # whole budget) — treat as a retryable failure. Must be a
                    # RuntimeError, NOT ValueError: _is_fatal_error() treats
                    # ValueError as a fatal config error and skips retries.
                    logger.warning(
                        "AI returned empty translation content (attempt %d/3) — retrying",
                        attempt + 1,
                    )
                    if attempt < 2:
                        await asyncio.sleep(_retry_delay(attempt))
                        continue
                    raise RuntimeError("AI 返回空内容，翻译失败")

                return content

            except (httpx.HTTPError, httpx.TimeoutException) as e:
                if _is_fatal_error(e):
                    raise  # Auth / config errors never recover with retries
                if attempt < 2:
                    await asyncio.sleep(_retry_delay(attempt, e))
                else:
                    raise
            except (json.JSONDecodeError, KeyError, TypeError) as e:
                if attempt < 2:
                    await asyncio.sleep(_retry_delay(attempt, e))
                else:
                    raise RuntimeError(f"AI service call failed: {e}")

        raise RuntimeError("AI service call failed")

    async def translate_batch(
        self,
        paragraphs: list[str],
        *,
        system_prompt_override: str | None = None,
        user_prompt_override: str | None = None,
    ) -> list[str]:
        """Translate paragraphs one-by-one with high concurrency.

        Each paragraph gets its own API call — eliminates ordering issues
        and isolates failures. Uses asyncio.Semaphore(10) for parallelism.
        """
        if not paragraphs:
            return []

        if not self.api_key or not self.api_key.strip():
            raise ValueError(
                "AI API Key 未配置。请点击页面右上角🔑图标设置。"
            )

        # Filter out empty/whitespace-only paragraphs to avoid wasted API calls.
        # We track original indices so we can reconstruct the result array.
        indexed: list[tuple[int, str]] = [
            (i, p) for i, p in enumerate(paragraphs) if p and p.strip()
        ]
        if not indexed:
            return [""] * len(paragraphs)

        concurrency = getattr(settings, "AI_CONCURRENCY", 15)
        semaphore = _get_shared_ai_semaphore(concurrency)

        async def _translate_one(index: int, text: str) -> tuple[int, str]:
            async with semaphore:
                try:
                    prev_text = paragraphs[index - 1] if index > 0 else None
                    next_text = (
                        paragraphs[index + 1]
                        if index < len(paragraphs) - 1
                        else None
                    )
                    result = await self.translate(
                        text,
                        prev_text=prev_text,
                        next_text=next_text,
                        system_prompt_override=system_prompt_override,
                        user_prompt_override=user_prompt_override,
                    )
                    return (index, result)
                except Exception as e:
                    if _is_fatal_error(e):
                        raise  # Auth / config error → fail the whole batch
                    logger.exception("Translation failed for paragraph %d", index)
                    return (index, "")

        # Launch all translations concurrently (order preserved by index)
        tasks = [_translate_one(i, text) for i, text in indexed]
        results = await asyncio.gather(*tasks)

        # Reconstruct full result array, filling empty paragraphs with ""
        lookup = dict(results)
        return [lookup.get(i, "") for i in range(len(paragraphs))]

    async def translate_batch_stream(
        self,
        paragraphs: list[str],
        *,
        system_prompt_override: str | None = None,
        user_prompt_override: str | None = None,
    ) -> AsyncGenerator[tuple[int, str], None]:
        """Stream translations as they complete — one SSE event per paragraph.

        Yields ``(index, translation)`` tuples as each paragraph translation
        finishes.  Empty/whitespace paragraphs are yielded immediately with
        an empty translation so the frontend can count them as done.
        """
        if not paragraphs:
            return

        if not self.api_key or not self.api_key.strip():
            raise ValueError(
                "AI API Key 未配置。请点击页面右上角🔑图标设置。"
            )

        # Build indexed list of non-empty paragraphs
        indexed: list[tuple[int, str]] = [
            (i, p) for i, p in enumerate(paragraphs) if p and p.strip()
        ]

        # Yield empty paragraphs immediately
        empty_indices = {i for i, p in enumerate(paragraphs) if not p or not p.strip()}
        for i in empty_indices:
            yield (i, "")

        if not indexed:
            return

        concurrency = getattr(settings, "AI_CONCURRENCY", 15)
        semaphore = _get_shared_ai_semaphore(concurrency)
        queue: asyncio.Queue[tuple[int, str]] = asyncio.Queue()
        total = len(indexed)
        completed = 0

        async def _worker(index: int, text: str) -> None:
            async with semaphore:
                try:
                    prev_text = paragraphs[index - 1] if index > 0 else None
                    next_text = (
                        paragraphs[index + 1]
                        if index < len(paragraphs) - 1
                        else None
                    )
                    result = await self.translate(
                        text,
                        prev_text=prev_text,
                        next_text=next_text,
                        system_prompt_override=system_prompt_override,
                        user_prompt_override=user_prompt_override,
                    )
                    await queue.put((index, result))
                except Exception as e:
                    if _is_fatal_error(e):
                        await queue.put(("__error__", str(e)))
                    else:
                        logger.exception("Translation failed for paragraph %d", index)
                        await queue.put((index, ""))

        # Launch all workers
        tasks = [asyncio.create_task(_worker(i, t)) for i, t in indexed]

        # Stream results as they complete
        while completed < total:
            try:
                item = await asyncio.wait_for(
                    queue.get(), timeout=self.heartbeat_interval
                )
            except asyncio.TimeoutError:
                # Keep the SSE connection alive while the slowest AI call is
                # still running; nginx would otherwise cut a silent stream.
                yield ("__heartbeat__", "")
                continue
            if item[0] == "__error__":
                # Fatal error — cancel remaining tasks and propagate
                for t in tasks:
                    t.cancel()
                raise ValueError(item[1])
            yield item
            completed += 1

        # Ensure all tasks are done
        await asyncio.gather(*tasks, return_exceptions=True)

    async def summarize_stream(
        self,
        document_text: str,
        user_summary: str | None = None,
        *,
        system_prompt_override: str | None = None,
        user_prompt_override: str | None = None,
    ) -> AsyncGenerator[dict, None]:
        """Stream a full-document summary (or revision of a user draft).

        Yields tagged dicts:
          ``{"type": "chunk", "text": str}`` — raw text delta as the AI types.
          ``{"type": "heartbeat"}``         — keepalive while waiting for the AI.
          ``{"type": "done", "summary": str}`` — final accumulated summary.

        Retries happen only *before* the first chunk: once any text has been
        streamed to the client, a mid-stream failure propagates immediately
        (retrying would replay duplicate text to the client).
        """
        if not self.api_key or not self.api_key.strip():
            raise ValueError(
                "AI API Key 未配置。请点击页面右上角🔑图标设置。"
            )

        messages = _resolve_prompt(
            "summary",
            {"document_text": document_text, "user_summary": user_summary or ""},
            system_override=system_prompt_override,
            user_override=user_prompt_override,
        )

        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": 2048,
            "thinking": {"type": "disabled"},
            "stream": True,
        }

        queue: asyncio.Queue[dict] = asyncio.Queue()

        async def _reader() -> None:
            """Read the SSE stream, pushing chunk deltas into the queue."""
            accumulated = ""
            for attempt in range(3):
                try:
                    async with self.client.stream(
                        "POST", "/chat/completions", json=payload
                    ) as response:
                        response.raise_for_status()
                        async for line in response.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            data_str = line[6:]
                            if data_str.strip() == "[DONE]":
                                break
                            try:
                                chunk_data = json.loads(data_str)
                                choices = chunk_data.get("choices", [])
                                if choices:
                                    delta = choices[0].get("delta", {})
                                    content = delta.get("content", "")
                                    if content:
                                        accumulated += content
                                        await queue.put({"type": "chunk", "text": content})
                            except (json.JSONDecodeError, KeyError, IndexError):
                                continue

                    # Stream finished — empty content is retried like a failure
                    if not accumulated.strip():
                        if attempt < 2:
                            logger.warning(
                                "Summary stream attempt %d returned empty content, retrying",
                                attempt + 1,
                            )
                            await asyncio.sleep(_retry_delay(attempt))
                            continue
                        await queue.put({"type": "error", "message": "AI 返回空内容，总结失败"})
                        return
                    await queue.put({"type": "done", "summary": accumulated.strip()})
                    return

                except (httpx.HTTPError, httpx.TimeoutException) as e:
                    if _is_fatal_error(e):
                        # Auth/config errors — propagate raw message so the
                        # endpoint can map 401 → actionable Chinese hint.
                        await queue.put({"type": "error", "message": str(e)})
                        return
                    if accumulated:
                        # Mid-stream failure — cannot retry without duplicating text
                        logger.warning(
                            "Summary stream dropped after %d chars: %s",
                            len(accumulated), e,
                        )
                        await queue.put({"type": "error", "message": f"总结生成中断: {e}"})
                        return
                    if attempt < 2:
                        logger.warning(
                            "Summary stream attempt %d failed, retrying: %s",
                            attempt + 1, e,
                        )
                        await asyncio.sleep(_retry_delay(attempt, e))
                        continue
                    logger.exception("Summary stream failed after 3 attempts")
                    await queue.put({"type": "error", "message": f"总结失败: {e}"})
                    return

        task = asyncio.create_task(_reader())

        try:
            while True:
                try:
                    event = await asyncio.wait_for(
                        queue.get(), timeout=self.heartbeat_interval
                    )
                except asyncio.TimeoutError:
                    yield {"type": "heartbeat"}
                    continue
                if event.get("type") == "error":
                    raise RuntimeError(event.get("message", "总结失败"))
                yield event
                if event.get("type") == "done":
                    break
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int = 2048,
    ) -> AsyncGenerator[dict, None]:
        """Stream a multi-turn chat completion for a pre-built messages list.

        Unlike ``summarize_stream`` the caller assembles ``messages`` (system
        context + conversation history + current question).  Yields the same
        tagged dicts: ``chunk`` / ``heartbeat`` / ``done`` (with ``text``).
        """
        if not self.api_key or not self.api_key.strip():
            raise ValueError(
                "AI API Key 未配置。请点击页面右上角🔑图标设置。"
            )

        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.5,
            "max_tokens": max_tokens,
            "thinking": {"type": "disabled"},
            "stream": True,
        }

        queue: asyncio.Queue[dict] = asyncio.Queue()

        async def _reader() -> None:
            """Read the SSE stream, pushing chunk deltas into the queue."""
            accumulated = ""
            for attempt in range(3):
                try:
                    async with self.client.stream(
                        "POST", "/chat/completions", json=payload
                    ) as response:
                        response.raise_for_status()
                        async for line in response.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            data_str = line[6:]
                            if data_str.strip() == "[DONE]":
                                break
                            try:
                                chunk_data = json.loads(data_str)
                                choices = chunk_data.get("choices", [])
                                if choices:
                                    delta = choices[0].get("delta", {})
                                    content = delta.get("content", "")
                                    if content:
                                        accumulated += content
                                        await queue.put({"type": "chunk", "text": content})
                            except (json.JSONDecodeError, KeyError, IndexError):
                                continue

                    # Stream finished — empty content is retried like a failure
                    if not accumulated.strip():
                        if attempt < 2:
                            logger.warning(
                                "Chat stream attempt %d returned empty content, retrying",
                                attempt + 1,
                            )
                            await asyncio.sleep(_retry_delay(attempt))
                            continue
                        await queue.put({"type": "error", "message": "AI 返回空内容，回答失败"})
                        return
                    await queue.put({"type": "done", "text": accumulated.strip()})
                    return

                except (httpx.HTTPError, httpx.TimeoutException) as e:
                    if _is_fatal_error(e):
                        # Auth/config errors — propagate raw message so the
                        # endpoint can map 401 → actionable Chinese hint.
                        await queue.put({"type": "error", "message": str(e)})
                        return
                    if accumulated:
                        # Mid-stream failure — cannot retry without duplicating text
                        logger.warning(
                            "Chat stream dropped after %d chars: %s",
                            len(accumulated), e,
                        )
                        await queue.put({"type": "error", "message": f"回答生成中断: {e}"})
                        return
                    if attempt < 2:
                        logger.warning(
                            "Chat stream attempt %d failed, retrying: %s",
                            attempt + 1, e,
                        )
                        await asyncio.sleep(_retry_delay(attempt, e))
                        continue
                    logger.exception("Chat stream failed after 3 attempts")
                    await queue.put({"type": "error", "message": f"回答失败: {e}"})
                    return

        task = asyncio.create_task(_reader())

        try:
            while True:
                try:
                    event = await asyncio.wait_for(
                        queue.get(), timeout=self.heartbeat_interval
                    )
                except asyncio.TimeoutError:
                    yield {"type": "heartbeat"}
                    continue
                if event.get("type") == "error":
                    raise RuntimeError(event.get("message", "回答失败"))
                yield event
                if event.get("type") == "done":
                    break
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    @staticmethod
    def _normalize_word_result(r: dict, para_index: int) -> None:
        """Normalize fields in a single word analysis result (mutates dict in place)."""
        r["paragraph_index"] = para_index
        # Normalize word to lowercase so frontend keys (which use .toLowerCase())
        # consistently match regardless of AI casing.
        if "word" in r and isinstance(r["word"], str):
            r["word"] = r["word"].strip().lower()
        if "collocations" not in r or not isinstance(r.get("collocations"), list):
            r["collocations"] = []
        if not isinstance(r.get("example_sentence"), str):
            r["example_sentence"] = ""
        if "cognates" not in r or not isinstance(r.get("cognates"), list):
            r["cognates"] = []
        sa = r.get("synonyms_antonyms")
        if not isinstance(sa, dict):
            r["synonyms_antonyms"] = {"synonyms": []}
        else:
            if "synonyms" not in sa or not isinstance(sa["synonyms"], list):
                sa["synonyms"] = []
        if not isinstance(r.get("base_form"), str):
            r["base_form"] = ""
        if not isinstance(r.get("plural_form"), str):
            r["plural_form"] = ""

    @staticmethod
    def _missing_words(requested: list[str], results: list[dict]) -> list[str]:
        """返回请求了但在结果中缺失的单词。

        AI 批次响应经常漏词(输出截断 / 忽略部分单词) —
        这是"部分单词丢失"的首要原因, 调用方据此逐词补发。
        """
        got = {r.get("word", "").lower() for r in results}
        return [w for w in requested if w.lower() not in got]

    async def _request_word_batch(
        self,
        para_index: int,
        words_batch: list[str],
        prompt_skeleton: list[dict[str, str]],
    ) -> list[dict] | None:
        """发一个非流式单词分析请求 (JSON mode), 最多重试 3 次。

        成功返回规范化结果列表; 彻底失败返回 ``None`` (调用方负责
        补偿或上报)。认证/配置错误 (``_is_fatal_error``) 直接抛出。
        ``prompt_skeleton`` 由 ``_resolve_word_prompt_skeleton`` 每段落
        解析一次，这里只替换 words_list，避免每批重复格式化整段原文。
        """
        words_list = ", ".join(words_batch)
        messages = _messages_with_words(prompt_skeleton, words_list)

        # DeepSeek V4 系列默认开启 thinking 模式: 推理阶段静默无输出
        # (前端表现为"等待 AI 响应"), 且已知会损坏严格 JSON 输出 —
        # 单词分析是结构化提取任务, 显式禁用推理。
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": max(2048, min(len(words_batch) * 500, 4096)),
            "thinking": {"type": "disabled"},
            "response_format": {"type": "json_object"},
        }

        for attempt in range(3):
            try:
                response = await self.client.post(
                    "/chat/completions", json=payload
                )
                response.raise_for_status()
                data = response.json()

                if "error" in data:
                    err = data["error"]
                    raise httpx.HTTPStatusError(
                            f"API error ({self.model}): {err.get('message', str(err))}",
                        request=response.request,
                        response=response,
                    )

                content = data["choices"][0]["message"]["content"].strip()
                if not content:
                    logger.warning(
                        "Empty AI content for words %s — 推理模型 reasoning 可能耗尽 max_tokens",
                        words_batch,
                    )
                parsed = _parse_json_content(content)

                # Handle both {"words": [...]} wrapper and bare array
                if isinstance(parsed, dict):
                    results = parsed.get("words", [])
                elif isinstance(parsed, list):
                    results = parsed
                else:
                    results = []

                if not isinstance(results, list):
                    results = []

                # Normalize fields
                for r in results:
                    self._normalize_word_result(r, para_index)

                return results

            except (httpx.HTTPError, httpx.TimeoutException) as e:
                if _is_fatal_error(e):
                    raise  # Auth / config error → fail the whole batch
                if attempt < 2:
                    await asyncio.sleep(_retry_delay(attempt, e))
                else:
                    logger.exception("Word analysis request failed (HTTP/timeout)")
                    return None
            except (json.JSONDecodeError, KeyError, TypeError):
                if attempt < 2:
                    await asyncio.sleep(_retry_delay(attempt))
                else:
                    logger.exception("Word analysis request failed (JSON/decode)")
                    return None

        return None

    async def analyze_words(
        self,
        entries: list[dict],
        *,
        system_prompt_override: str | None = None,
        user_prompt_override: str | None = None,
    ) -> list[dict]:
        """Analyze vocabulary words with AI — parallel batch processing.

        entries: [
            {"paragraph_index": 0, "word": "gravity", "sentence": "...",
             "sentence_translation": "..."},
            ...
        ]

        Returns a list of result dicts keyed by (paragraph_index, word),
        each containing phonetic, part_of_speech, definition, example, etc.
        """
        if not entries:
            return []

        if not self.api_key or not self.api_key.strip():
            raise ValueError(
                "AI API Key 未配置。请点击页面右上角🔑图标设置。"
            )

        # 记录实际使用的模板来源 — 排查"修改的 prompt 不生效"时看日志确认
        logger.info(
            "analyze_words %s prompt override",
            "using DB" if (system_prompt_override or user_prompt_override) else "using factory default",
        )

        # Group entries by paragraph_index to share sentence context

        batch_size = getattr(settings, "WORDS_BATCH_SIZE", 8)
        concurrency = getattr(settings, "AI_CONCURRENCY", 15)
        semaphore = _get_shared_ai_semaphore(concurrency)

        async def _analyze_batch(
            para_index: int,
            words_batch: list[str],
        ) -> list[dict]:
            async with semaphore:
                results = await self._request_word_batch(
                    para_index, words_batch, prompt_skeletons[para_index]
                )
                if results is None:
                    results = []

                # ── 单词补偿: 先按批量小批补发一次, 仍缺失再逐词兜底 ──
                # 合并补发把请求数从"每漏一词 1 次"降到"每 8 词 1 次"。
                missing = self._missing_words(words_batch, results)
                for start in range(0, len(missing), batch_size):
                    chunk = missing[start : start + batch_size]
                    one = await self._request_word_batch(
                        para_index, chunk, prompt_skeletons[para_index]
                    )
                    if one:
                        results.extend(one)

                for w in self._missing_words(words_batch, results):
                    one = await self._request_word_batch(
                        para_index, [w], prompt_skeletons[para_index]
                    )
                    if one:
                        results.extend(one)

                return results

        # Group entries by paragraph — all words in the same paragraph share
        # the full paragraph text as context (one prompt per batch).
        grouped: dict[int, list[dict]] = {}
        for e in entries:
            grouped.setdefault(e["paragraph_index"], []).append(e)

        # 每段落只格式化一次 prompt（含整段原文上下文），批次间只换 words_list
        prompt_skeletons: dict[int, list[dict[str, str]]] = {}
        for para_index, group_entries in grouped.items():
            sentence = group_entries[0].get("sentence", "")
            sentence_translation = group_entries[0].get("sentence_translation")
            prompt_skeletons[para_index] = _resolve_word_prompt_skeleton(
                sentence,
                sentence_translation,
                system_prompt_override=system_prompt_override,
                user_prompt_override=user_prompt_override,
            )

        # Build tasks: for each paragraph group, split words into batches
        tasks = []
        for para_index, group_entries in grouped.items():
            # Split words into smaller batches
            for i in range(0, len(group_entries), batch_size):
                chunk = group_entries[i : i + batch_size]
                words_batch = [e["word"] for e in chunk]
                tasks.append(
                    _analyze_batch(para_index, words_batch)
                )

        # Run all batches concurrently
        results_per_batch = await asyncio.gather(*tasks)

        # Flatten results and key by (paragraph_index, word)
        all_results: list[dict] = []
        for batch_results in results_per_batch:
            if batch_results:
                all_results.extend(batch_results)

        return all_results

    async def analyze_words_stream(
        self,
        entries: list[dict],
        *,
        system_prompt_override: str | None = None,
        user_prompt_override: str | None = None,
    ) -> AsyncGenerator[dict, None]:
        """Stream word analyses with raw token-level output — the frontend sees
        AI text appear in real time.

        Yields tagged dicts:
          ``{"type": "chunk", "batch_id": int, "text": str, "words": [...],
             "para_index": int}``
            — raw text delta as the AI types.

          ``{"type": "batch", "batch_id": int, "results": [...], "words": [...],
             "para_index": int}``
            — parsed & normalised word analyses for one batch.
        """
        if not entries:
            return

        if not self.api_key or not self.api_key.strip():
            raise ValueError(
                "AI API Key 未配置。请点击页面右上角🔑图标设置。"
            )

        # 记录实际使用的模板来源 — 排查"修改的 prompt 不生效"时看日志确认
        logger.info(
            "analyze_words_stream %s prompt override",
            "using DB" if (system_prompt_override or user_prompt_override) else "using factory default",
        )

        batch_size = getattr(settings, "WORDS_BATCH_SIZE", 8)
        concurrency = getattr(settings, "AI_CONCURRENCY", 15)
        semaphore = _get_shared_ai_semaphore(concurrency)

        def _normalize_results(results: list[dict], para_index: int) -> list[dict]:
            """Normalize fields in parsed results (delegates to shared static method)."""
            for r in results:
                self._normalize_word_result(r, para_index)
            return results

        async def _stream_batch(
            batch_id: int,
            para_index: int,
            words_batch: list[str],
            prompt_skeleton: list[dict[str, str]],
        ) -> None:
            """Stream raw tokens for one batch, then parse & push results to queue.

            IMPORTANT: Every code path MUST push a "batch" event to *queue*.
            If a task dies without doing so, the main event loop deadlocks
            waiting for ``completed_batches`` to reach ``total_batches``.

            NEW: when the streamed batch returns fewer words than requested
            (or fails entirely), the missing words are re-requested one-by-one
            (non-streaming).  Words that STILL fail are listed in the batch
            event's ``missing`` field so the main loop can report them —
            selected words are never silently dropped.
            """
            async def _push_batch(
                results: list[dict], missing_words: list[str] | None = None
            ) -> None:
                if missing_words is None:
                    missing_words = self._missing_words(words_batch, results)
                await queue.put({
                    "type": "batch",
                    "batch_id": batch_id,
                    "results": results,
                    "words": words_batch,
                    "para_index": para_index,
                    "missing": [
                        {"para_index": para_index, "word": w} for w in missing_words
                    ],
                })

            try:
                async with semaphore:
                    words_list = ", ".join(words_batch)

                    # 段落级 prompt 骨架已解析一次，这里只替换 words_list
                    messages = _messages_with_words(prompt_skeleton, words_list)

                    # NOTE: no response_format when streaming — JSON mode is
                    # incompatible with stream=True.  The prompt itself instructs
                    # the model to output JSON.
                    # thinking 禁用: 消除推理阶段的静默等待 (首 token 更快),
                    # 且避免推理文本损坏 JSON 输出。
                    payload = {
                        "model": self.model,
                        "messages": messages,
                        "temperature": 0.3,
                        "max_tokens": max(2048, min(len(words_batch) * 500, 4096)),
                        "thinking": {"type": "disabled"},
                        "stream": True,
                    }

                    accumulated = ""
                    stream_failed = False
                    # 已向前端发过 chunk 后不再重试（重发会重复渲染、浪费 token）
                    sent_any_chunk = False

                    for attempt in range(3):
                        try:
                            async with self.client.stream(
                                "POST", "/chat/completions", json=payload
                            ) as response:
                                response.raise_for_status()

                                async for line in response.aiter_lines():
                                    if not line.startswith("data: "):
                                        continue
                                    data_str = line[6:]
                                    if data_str.strip() == "[DONE]":
                                        break
                                    try:
                                        chunk_data = json.loads(data_str)
                                        choices = chunk_data.get("choices", [])
                                        if choices:
                                            delta = choices[0].get("delta", {})
                                            content = delta.get("content", "")
                                            if content:
                                                accumulated += content
                                                sent_any_chunk = True
                                                await queue.put({
                                                    "type": "chunk",
                                                    "batch_id": batch_id,
                                                    "text": content,
                                                    "words": words_batch,
                                                    "para_index": para_index,
                                                })
                                    except (json.JSONDecodeError, KeyError, IndexError):
                                        continue

                            # ── Parse the accumulated text as JSON ──
                            # _parse_json_content 容忍推理文本包裹与代码块
                            parsed = _parse_json_content(accumulated)

                            if isinstance(parsed, dict):
                                results = parsed.get("words", [])
                            elif isinstance(parsed, list):
                                results = parsed
                            else:
                                results = []

                            if not isinstance(results, list):
                                results = []

                            results = _normalize_results(results, para_index)
                            break  # success — exit retry loop

                        except (httpx.HTTPError, httpx.TimeoutException) as e:
                            if _is_fatal_error(e):
                                err_msg = str(e)
                                if "401" in err_msg or "Unauthorized" in err_msg:
                                    err_msg = "AI API Key 无效或未配置，请点击右上角🔑图标设置。"
                                await queue.put({
                                    "type": "batch",
                                    "batch_id": batch_id,
                                    "results": [{"__error__": err_msg}],
                                    "words": words_batch,
                                    "para_index": para_index,
                                    "missing": [],
                                })
                                return
                            if attempt < 2 and not sent_any_chunk:
                                await asyncio.sleep(_retry_delay(attempt, e))
                                accumulated = ""
                            else:
                                logger.exception(
                                    "Word analysis stream batch %d failed (HTTP/timeout)", batch_id
                                )
                                stream_failed = True
                                break
                        except (json.JSONDecodeError, KeyError, TypeError):
                            if attempt < 2 and not sent_any_chunk:
                                await asyncio.sleep(_retry_delay(attempt))
                                accumulated = ""
                            else:
                                logger.exception(
                                    "Word analysis stream batch %d failed (JSON/decode)", batch_id
                                )
                                stream_failed = True
                                break
                    else:
                        # Shouldn't reach here
                        stream_failed = True

                    # ── Compensate missing words (merged small batches first) ──
                    if stream_failed:
                        results = []  # 成功路径中 results 已在上方解析赋值
                    missing = self._missing_words(words_batch, results)
                    for start in range(0, len(missing), batch_size):
                        chunk = missing[start : start + batch_size]
                        one = await self._request_word_batch(
                            para_index, chunk, prompt_skeleton
                        )
                        if one:
                            results.extend(one)

                    # 合并补发仍缺词时，保留逐词兜底（保证不静默丢词）
                    for w in self._missing_words(words_batch, results):
                        one = await self._request_word_batch(
                            para_index, [w], prompt_skeleton
                        )
                        if one:
                            results.extend(one)

                    await _push_batch(results)
            except Exception:
                # ── Catch-all: prevent any unhandled exception from
                # deadlocking the main event loop.  This must ALWAYS push a
                # "batch" event so completed_batches can advance. ──
                logger.exception(
                    "Word analysis stream batch %d crashed unexpectedly", batch_id
                )
                await queue.put({
                    "type": "batch",
                    "batch_id": batch_id,
                    "results": [],
                    "words": words_batch,
                    "para_index": para_index,
                    "missing": [
                        {"para_index": para_index, "word": w} for w in words_batch
                    ],
                })

        # ── Group entries by paragraph — all words in the same paragraph
        # share the full paragraph text as context (one prompt per batch). ──
        grouped: dict[int, list[dict]] = {}
        for e in entries:
            grouped.setdefault(e["paragraph_index"], []).append(e)

        # 每段落只格式化一次 prompt（含整段原文上下文），批次间只换 words_list
        prompt_skeletons: dict[int, list[dict[str, str]]] = {}
        for para_index, group_entries in grouped.items():
            sentence = group_entries[0].get("sentence", "")
            sentence_translation = group_entries[0].get("sentence_translation")
            prompt_skeletons[para_index] = _resolve_word_prompt_skeleton(
                sentence,
                sentence_translation,
                system_prompt_override=system_prompt_override,
                user_prompt_override=user_prompt_override,
            )

        # Build indexed batch list
        indexed_batches: list[tuple[int, int, list[str], list[dict[str, str]]]] = []
        batch_id = 0
        for para_index, group_entries in grouped.items():
            for i in range(0, len(group_entries), batch_size):
                chunk = group_entries[i : i + batch_size]
                words_batch = [e["word"] for e in chunk]
                indexed_batches.append(
                    (batch_id, para_index, words_batch, prompt_skeletons[para_index])
                )
                batch_id += 1

        if not indexed_batches:
            return

        queue: asyncio.Queue[dict] = asyncio.Queue()
        total_batches = len(indexed_batches)
        completed_batches = 0
        # 收集各批次补偿后仍缺失的单词, 最后汇总为 incomplete 事件
        all_missing: list[dict] = []
        remaining_batch_ids = {b[0] for b in indexed_batches}

        # Launch all workers concurrently
        tasks = [
            asyncio.create_task(_stream_batch(bid, pi, wb, sk))
            for bid, pi, wb, sk in indexed_batches
        ]

        # Stream events as they arrive — chunks AND batch results.
        # 无事件时 (慢批次/排队) 发心跳保持 SSE 活跃 — 前端 120s 读超时
        # 不会误杀长时间等待的长任务; 客户端断开时生成器自然终止。
        while completed_batches < total_batches:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=self.heartbeat_interval)
            except asyncio.TimeoutError:
                yield {"type": "heartbeat"}
                continue
            if event.get("type") == "batch":
                # Check for fatal error sentinel
                if (
                    event.get("results")
                    and len(event["results"]) == 1
                    and "__error__" in event["results"][0]
                ):
                    for t in tasks:
                        t.cancel()
                    raise ValueError(event["results"][0]["__error__"])
                completed_batches += 1
                remaining_batch_ids.discard(event.get("batch_id"))
                all_missing.extend(event.get("missing", []))
            yield event

        # 早退 (超时): 未完成批次的单词全部视为缺失, 并取消剩余任务
        if completed_batches < total_batches:
            for bid, pi, wb, s, st in indexed_batches:
                if bid in remaining_batch_ids:
                    all_missing.extend({"para_index": pi, "word": w} for w in wb)
            for t in tasks:
                t.cancel()

        # 汇总缺失单词 → incomplete 事件 (去重, 前端据此提示用户)
        if all_missing:
            seen = set()
            deduped: list[dict] = []
            for m in all_missing:
                key = (m.get("para_index"), m.get("word", "").lower())
                if key not in seen:
                    seen.add(key)
                    deduped.append(m)
            yield {"type": "incomplete", "words": deduped}

        # Ensure all tasks are done
        await asyncio.gather(*tasks, return_exceptions=True)

    async def analyze_sentences(
        self,
        entries: list[dict],
        *,
        system_prompt_override: str | None = None,
        user_prompt_override: str | None = None,
    ) -> list[dict]:
        """Analyze sentences with AI — one sentence per API call, high concurrency.

        Each sentence gets its own API call with the semantic-chunk prompt
        (原句拆解/理解拆解/阅读线索/地道翻译).  Results are returned as raw markdown text.

        entries: [
            {"paragraph_index": 0, "sentence_index": 0, "sentence_text": "...",
             "sentence_translation": "..."},
            ...
        ]

        Returns a list of result dicts keyed by (paragraph_index, sentence_index),
        each containing the raw content string.
        """
        if not entries:
            return []

        if not self.api_key or not self.api_key.strip():
            raise ValueError(
                "AI API Key 未配置。请点击页面右上角🔑图标设置。"
            )

        concurrency = getattr(settings, "AI_CONCURRENCY", 15)
        semaphore = _get_shared_ai_semaphore(concurrency)

        async def _analyze_one(entry: dict) -> dict | None:
            async with semaphore:
                sentence_text = entry["sentence_text"]
                sentence_translation = entry.get("sentence_translation") or ""

                messages = _resolve_prompt(
                    "analyze_sentences",
                    {
                        "sentence_text": sentence_text,
                        "sentence_translation": sentence_translation,
                        # Backward compat: old custom prompts may use these
                        "sentences_text": f"S1: {sentence_text}",
                        "translations_text": f"S1: {sentence_translation}",
                    },
                    system_override=system_prompt_override,
                    user_override=user_prompt_override,
                )

                # Allow generous max_tokens — the detailed analysis can be lengthy
                payload = {
                    "model": self.model,
                    "messages": messages,
                    "temperature": 0.3,
                    "max_tokens": max(2048, min(len(sentence_text) * 400, 4096)),
                    "thinking": {"type": "disabled"},
                }

                for attempt in range(3):
                    try:
                        response = await self.client.post(
                            "/chat/completions", json=payload
                        )
                        response.raise_for_status()
                        data = response.json()

                        if "error" in data:
                            err = data["error"]
                            raise httpx.HTTPStatusError(
                                f"API error ({self.model}): {err.get('message', str(err))}",
                                request=response.request,
                                response=response,
                            )

                        content = data["choices"][0]["message"]["content"].strip()

                        return {
                            "paragraph_index": entry["paragraph_index"],
                            "sentence_index": entry["sentence_index"],
                            "sentence_text": sentence_text,
                            "content": content,
                        }

                    except (httpx.HTTPError, httpx.TimeoutException) as e:
                        if attempt < 2 and not _is_fatal_error(e):
                            await asyncio.sleep(_retry_delay(attempt, e))
                        else:
                            if _is_fatal_error(e):
                                raise
                            logger.exception("Sentence analysis HTTP/timeout error")
                            return None
                    except (json.JSONDecodeError, KeyError, TypeError):
                        if attempt < 2:
                            await asyncio.sleep(_retry_delay(attempt))
                        else:
                            logger.exception("Sentence analysis JSON/decode error")
                            return None

                return None

        # Launch all sentences concurrently (one API call per sentence)
        tasks = [_analyze_one(e) for e in entries]
        results = await asyncio.gather(*tasks)

        return [r for r in results if r is not None]

    async def analyze_sentences_stream(
        self,
        entries: list[dict],
        *,
        system_prompt_override: str | None = None,
        user_prompt_override: str | None = None,
    ) -> AsyncGenerator[dict, None]:
        """Stream sentence analyses with raw token-level output — the frontend sees
        AI text appear in real time.

        Yields tagged dicts:
          ``{"type": "chunk", "text": str, "para_index": int, "sentence_index": int}``
            — raw text delta as the AI types.

          ``{"type": "batch", "results": [...], "para_index": int, "sentence_index": int}``
            — completed sentence analysis for one sentence.
        """
        if not entries:
            return

        if not self.api_key or not self.api_key.strip():
            raise ValueError(
                "AI API Key 未配置。请点击页面右上角🔑图标设置。"
            )

        concurrency = getattr(settings, "AI_CONCURRENCY", 15)
        semaphore = _get_shared_ai_semaphore(concurrency)

        async def _stream_one(entry: dict) -> None:
            """Stream raw tokens for one sentence, then push completed result."""
            async with semaphore:
                sentence_text = entry["sentence_text"]
                sentence_translation = entry.get("sentence_translation") or ""

                messages = _resolve_prompt(
                    "analyze_sentences",
                    {
                        "sentence_text": sentence_text,
                        "sentence_translation": sentence_translation,
                        # Backward compat: old custom prompts may use these
                        "sentences_text": f"S1: {sentence_text}",
                        "translations_text": f"S1: {sentence_translation}",
                    },
                    system_override=system_prompt_override,
                    user_override=user_prompt_override,
                )

                payload = {
                    "model": self.model,
                    "messages": messages,
                    "temperature": 0.3,
                    "max_tokens": max(2048, min(len(sentence_text) * 400, 4096)),
                    "thinking": {"type": "disabled"},
                    "stream": True,
                }

                accumulated = ""
                # 已向前端发过 chunk 后不再重试，避免重复渲染与 token 浪费
                sent_any_chunk = False

                for attempt in range(3):
                    try:
                        async with self.client.stream(
                            "POST", "/chat/completions", json=payload
                        ) as response:
                            response.raise_for_status()

                            async for line in response.aiter_lines():
                                if not line.startswith("data: "):
                                    continue
                                data_str = line[6:]
                                if data_str.strip() == "[DONE]":
                                    break
                                try:
                                    chunk_data = json.loads(data_str)
                                    choices = chunk_data.get("choices", [])
                                    if choices:
                                        delta = choices[0].get("delta", {})
                                        content = delta.get("content", "")
                                        if content:
                                            accumulated += content
                                            sent_any_chunk = True
                                            await queue.put({
                                                "type": "chunk",
                                                "text": content,
                                                "para_index": entry["paragraph_index"],
                                                "sentence_index": entry["sentence_index"],
                                            })
                                except (json.JSONDecodeError, KeyError, IndexError):
                                    continue

                        # Success — push completed result
                        await queue.put({
                            "type": "batch",
                            "results": [{
                                "paragraph_index": entry["paragraph_index"],
                                "sentence_index": entry["sentence_index"],
                                "sentence_text": sentence_text,
                                "content": accumulated.strip(),
                            }],
                            "para_index": entry["paragraph_index"],
                            "sentence_index": entry["sentence_index"],
                        })
                        return  # success — exit retry loop

                    except (httpx.HTTPError, httpx.TimeoutException) as e:
                        if _is_fatal_error(e):
                            err_msg = str(e)
                            if "401" in err_msg or "Unauthorized" in err_msg:
                                err_msg = "AI API Key 无效或未配置，请点击右上角🔑图标设置。"
                            await queue.put({
                                "type": "batch",
                                "results": [{"__error__": err_msg}],
                                "para_index": entry["paragraph_index"],
                                "sentence_index": entry["sentence_index"],
                            })
                            return
                        if attempt < 2 and not sent_any_chunk:
                            await asyncio.sleep(_retry_delay(attempt, e))
                            accumulated = ""
                        else:
                            logger.exception(
                                "Sentence analysis stream failed (HTTP/timeout) for para %d sent %d",
                                entry["paragraph_index"], entry["sentence_index"],
                            )
                            await queue.put({
                                "type": "batch",
                                "results": [],
                                "para_index": entry["paragraph_index"],
                                "sentence_index": entry["sentence_index"],
                            })
                            return
                    except (json.JSONDecodeError, KeyError, TypeError):
                        if attempt < 2 and not sent_any_chunk:
                            await asyncio.sleep(_retry_delay(attempt))
                            accumulated = ""
                        else:
                            logger.exception(
                                "Sentence analysis stream failed (JSON/decode) for para %d sent %d",
                                entry["paragraph_index"], entry["sentence_index"],
                            )
                            await queue.put({
                                "type": "batch",
                                "results": [],
                                "para_index": entry["paragraph_index"],
                                "sentence_index": entry["sentence_index"],
                            })
                            return

                # Shouldn't reach here
                await queue.put({
                    "type": "batch",
                    "results": [],
                    "para_index": entry["paragraph_index"],
                    "sentence_index": entry["sentence_index"],
                })

        total = len(entries)
        completed = 0
        queue: asyncio.Queue[dict] = asyncio.Queue()

        # Launch all workers concurrently
        tasks = [asyncio.create_task(_stream_one(e)) for e in entries]

        # Stream events as they arrive — chunks AND batch results.
        # 无事件时发心跳保活, 防止前端读超时误杀慢句子。
        while completed < total:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=self.heartbeat_interval)
            except asyncio.TimeoutError:
                yield {"type": "heartbeat"}
                continue
            if event.get("type") == "batch":
                results = event.get("results", [])
                # Check for fatal error sentinel
                if results and len(results) == 1 and "__error__" in results[0]:
                    for t in tasks:
                        t.cancel()
                    raise ValueError(results[0]["__error__"])
                completed += 1
            yield event

        # Ensure all tasks are done
        await asyncio.gather(*tasks, return_exceptions=True)

    async def close(self):
        """Release this instance's reference.

        Shared-pool clients stay alive for other in-flight requests and are
        closed at app shutdown via :func:`close_ai_clients`.
        """
        client = self._client
        self._client = None
        if self._owns_client and client is not None:
            await client.aclose()


def create_ai_service(
    provider: str | None = None,
    api_key: str | None = None,
) -> AIService:
    """Create an AIService configured for DeepSeek.

    NOTE: Currently only DeepSeek is supported. The ``provider`` parameter
    and request-schema ``Literal["deepseek"]`` fields exist as extension
    points for future multi-provider support (e.g. OpenAI, Anthropic).
    When a new provider is added, this factory will dispatch to the
    appropriate service class.

    Args:
        provider: AI provider name (currently only "deepseek" is valid).
        api_key: Optional user-provided API key (overrides server config).

    Returns:
        AIService instance.
    """
    if not api_key:
        logger.warning("create_ai_service called without api_key — AI calls will fail")
    return AIService(
        api_key=api_key or "",
        base_url=settings.DEEPSEEK_BASE_URL,
        model=settings.DEEPSEEK_MODEL,
    )


# Module-level singleton for backward compatibility.
# Prefer create_ai_service() in new code so the API key is explicit.
ai_service = AIService()
