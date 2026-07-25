"""AI API service — DeepSeek with parallel batch processing."""

import asyncio
import json
import logging
import re
from collections.abc import AsyncGenerator

import httpx

from app.config import settings
from app.services.prompt_defaults import DEFAULT_PROMPTS, PLACEHOLDERS

logger = logging.getLogger(__name__)


class _SafeDict(dict):
    """A dict that returns the key itself wrapped in braces for missing keys.

    Used with ``str.format_map()`` so that unknown placeholders like ``{foo}``
    remain as literal text instead of raising ``KeyError``.
    """

    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def _is_fatal_error(exc: Exception) -> bool:
    """Check whether an exception should fail the entire batch.

    Auth / config errors affect *every* item, so they must propagate to the
    API endpoint so the frontend can show an actionable error (e.g. "API Key
    无效").  Per-item errors (timeout, rate-limit, malformed response) only
    fail that one item and return an empty placeholder.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        return status in (401, 403)
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


class AIService:
    """AI API wrapper for paragraph translation with parallel batches.

    Uses the DeepSeek API.
    """

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

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            concurrency = getattr(settings, "AI_CONCURRENCY", 15)
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                timeout=httpx.Timeout(60.0, connect=10.0),
                limits=httpx.Limits(
                    max_connections=concurrency + 5,
                    max_keepalive_connections=concurrency,
                ),
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

        # Use a high floor for max_tokens — reasoning models consume tokens
        # for internal reasoning, so we need ample headroom.
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": max(1024, min(len(text) * 3, 4096)),
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

                return data["choices"][0]["message"]["content"].strip()

            except (httpx.HTTPError, httpx.TimeoutException) as e:
                if _is_fatal_error(e):
                    raise  # Auth / config errors never recover with retries
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                else:
                    raise
            except (json.JSONDecodeError, KeyError, TypeError) as e:
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
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
        semaphore = asyncio.Semaphore(concurrency)

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
        semaphore = asyncio.Semaphore(concurrency)
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
            item = await queue.get()
            if item[0] == "__error__":
                # Fatal error — cancel remaining tasks and propagate
                for t in tasks:
                    t.cancel()
                raise ValueError(item[1])
            yield item
            completed += 1

        # Ensure all tasks are done
        await asyncio.gather(*tasks, return_exceptions=True)

    @staticmethod
    def _normalize_word_result(r: dict, para_index: int) -> None:
        """Normalize fields in a single word analysis result (mutates dict in place)."""
        r["paragraph_index"] = para_index
        if "collocations" not in r or not isinstance(r.get("collocations"), list):
            r["collocations"] = []
        if not isinstance(r.get("example_sentence"), str):
            r["example_sentence"] = ""
        if "cognates" not in r or not isinstance(r.get("cognates"), list):
            r["cognates"] = []
        sa = r.get("synonyms_antonyms")
        if not isinstance(sa, dict):
            r["synonyms_antonyms"] = {"synonyms": [], "antonyms": []}
        else:
            if "synonyms" not in sa or not isinstance(sa["synonyms"], list):
                sa["synonyms"] = []
            if "antonyms" not in sa or not isinstance(sa["antonyms"], list):
                sa["antonyms"] = []
        if not isinstance(r.get("base_form"), str):
            r["base_form"] = ""
        if not isinstance(r.get("plural_form"), str):
            r["plural_form"] = ""

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

        # Group entries by paragraph_index to share sentence context

        batch_size = getattr(settings, "WORDS_BATCH_SIZE", 8)
        concurrency = getattr(settings, "AI_CONCURRENCY", 15)
        semaphore = asyncio.Semaphore(concurrency)

        async def _analyze_batch(
            para_index: int,
            words_batch: list[str],
            sentence: str,
            sentence_translation: str | None,
        ) -> list[dict]:
            async with semaphore:
                words_list = ", ".join(words_batch)

                messages = _resolve_prompt(
                    "analyze_words",
                    {
                        "words_list": words_list,
                        "sentence": sentence,
                        "sentence_translation": sentence_translation or "无",
                    },
                    system_override=system_prompt_override,
                    user_override=user_prompt_override,
                )

                payload = {
                    "model": self.model,
                    "messages": messages,
                    "temperature": 0.3,
                    "max_tokens": max(512, min(len(words_batch) * 500, 3072)),
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
                        parsed = json.loads(content)

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
                        if attempt < 2 and not _is_fatal_error(e):
                            await asyncio.sleep(2 ** attempt)
                        else:
                            if _is_fatal_error(e):
                                raise  # Auth / config error → fail the whole batch
                            logger.exception("Word analysis HTTP/timeout error")
                            return []
                    except (json.JSONDecodeError, KeyError, TypeError):
                        if attempt < 2:
                            await asyncio.sleep(2 ** attempt)
                        else:
                            logger.exception("Word analysis JSON/decode error")
                            return []

                return []

        # Group entries by (paragraph_index, sentence) — words that share
        # the same extracted sentence get batched together.  This ensures
        # each batch's context sentence and its translation are correct
        # for every word in that batch.
        entries.sort(key=lambda e: (e["paragraph_index"], e.get("sentence", "")))
        grouped: dict[tuple[int, str], list[dict]] = {}
        for e in entries:
            key = (e["paragraph_index"], e.get("sentence", ""))
            if key not in grouped:
                grouped[key] = []
            grouped[key].append(e)

        # Build tasks: for each (paragraph, sentence) group, split words
        # into batches of batch_size
        tasks = []
        for (para_index, sentence), group_entries in grouped.items():
            sentence_translation = group_entries[0].get("sentence_translation")

            # Split words into smaller batches
            for i in range(0, len(group_entries), batch_size):
                chunk = group_entries[i : i + batch_size]
                words_batch = [e["word"] for e in chunk]
                tasks.append(
                    _analyze_batch(
                        para_index, words_batch, sentence, sentence_translation
                    )
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

        batch_size = getattr(settings, "WORDS_BATCH_SIZE", 8)
        concurrency = getattr(settings, "AI_CONCURRENCY", 15)
        semaphore = asyncio.Semaphore(concurrency)

        def _normalize_results(results: list[dict], para_index: int) -> list[dict]:
            """Normalize fields in parsed results (delegates to shared static method)."""
            for r in results:
                self._normalize_word_result(r, para_index)
            return results

        async def _stream_batch(
            batch_id: int,
            para_index: int,
            words_batch: list[str],
            sentence: str,
            sentence_translation: str | None,
        ) -> None:
            """Stream raw tokens for one batch, then parse & push results to queue."""
            async with semaphore:
                words_list = ", ".join(words_batch)

                messages = _resolve_prompt(
                    "analyze_words",
                    {
                        "words_list": words_list,
                        "sentence": sentence,
                        "sentence_translation": sentence_translation or "无",
                    },
                    system_override=system_prompt_override,
                    user_override=user_prompt_override,
                )

                # NOTE: no response_format when streaming — JSON mode is
                # incompatible with stream=True.  The prompt itself instructs
                # the model to output JSON.
                payload = {
                    "model": self.model,
                    "messages": messages,
                    "temperature": 0.3,
                    "max_tokens": max(512, min(len(words_batch) * 500, 3072)),
                    "stream": True,
                }

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
                        text = accumulated.strip()

                        # Strip markdown code fences if present
                        if text.startswith("```"):
                            text = text.removeprefix("```json").removeprefix("```").strip()
                            if text.endswith("```"):
                                text = text[:-3].strip()

                        parsed = json.loads(text)

                        if isinstance(parsed, dict):
                            results = parsed.get("words", [])
                        elif isinstance(parsed, list):
                            results = parsed
                        else:
                            results = []

                        if not isinstance(results, list):
                            results = []

                        results = _normalize_results(results, para_index)
                        await queue.put({
                            "type": "batch",
                            "batch_id": batch_id,
                            "results": results,
                            "words": words_batch,
                            "para_index": para_index,
                        })
                        return  # success — exit retry loop

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
                            })
                            return
                        if attempt < 2:
                            await asyncio.sleep(2 ** attempt)
                            accumulated = ""
                        else:
                            logger.exception(
                                "Word analysis stream batch %d failed (HTTP/timeout)", batch_id
                            )
                            await queue.put({
                                "type": "batch",
                                "batch_id": batch_id,
                                "results": [],
                                "words": words_batch,
                                "para_index": para_index,
                            })
                            return
                    except (json.JSONDecodeError, KeyError, TypeError):
                        if attempt < 2:
                            await asyncio.sleep(2 ** attempt)
                            accumulated = ""
                        else:
                            logger.exception(
                                "Word analysis stream batch %d failed (JSON/decode)", batch_id
                            )
                            await queue.put({
                                "type": "batch",
                                "batch_id": batch_id,
                                "results": [],
                                "words": words_batch,
                                "para_index": para_index,
                            })
                            return

                # Shouldn't reach here
                await queue.put({
                    "type": "batch",
                    "batch_id": batch_id,
                    "results": [],
                    "words": words_batch,
                    "para_index": para_index,
                })

        # ── Group entries by (paragraph_index, sentence) ──────────
        entries.sort(key=lambda e: (e["paragraph_index"], e.get("sentence", "")))
        grouped: dict[tuple[int, str], list[dict]] = {}
        for e in entries:
            key = (e["paragraph_index"], e.get("sentence", ""))
            if key not in grouped:
                grouped[key] = []
            grouped[key].append(e)

        # Build indexed batch list
        indexed_batches: list[tuple[int, int, list[str], str, str | None]] = []
        batch_id = 0
        for (para_index, sentence), group_entries in grouped.items():
            sentence_translation = group_entries[0].get("sentence_translation")
            for i in range(0, len(group_entries), batch_size):
                chunk = group_entries[i : i + batch_size]
                words_batch = [e["word"] for e in chunk]
                indexed_batches.append(
                    (batch_id, para_index, words_batch, sentence, sentence_translation)
                )
                batch_id += 1

        if not indexed_batches:
            return

        queue: asyncio.Queue[dict] = asyncio.Queue()
        total_batches = len(indexed_batches)
        completed_batches = 0

        # Launch all workers concurrently
        tasks = [
            asyncio.create_task(_stream_batch(bid, pi, wb, s, st))
            for bid, pi, wb, s, st in indexed_batches
        ]

        # Stream events as they arrive — chunks AND batch results
        while completed_batches < total_batches:
            event = await queue.get()
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
            yield event

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

        Each sentence gets its own API call with the detailed-analysis prompt
        (原文/主干/讲解/译文).  Results are returned as raw markdown text.

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
        semaphore = asyncio.Semaphore(concurrency)

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
                    "max_tokens": max(512, min(len(sentence_text) * 400, 4096)),
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
                            await asyncio.sleep(2 ** attempt)
                        else:
                            if _is_fatal_error(e):
                                raise
                            logger.exception("Sentence analysis HTTP/timeout error")
                            return None
                    except (json.JSONDecodeError, KeyError, TypeError):
                        if attempt < 2:
                            await asyncio.sleep(2 ** attempt)
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
        semaphore = asyncio.Semaphore(concurrency)

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
                    "max_tokens": max(512, min(len(sentence_text) * 400, 4096)),
                    "stream": True,
                }

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
                        if attempt < 2:
                            await asyncio.sleep(2 ** attempt)
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
                        if attempt < 2:
                            await asyncio.sleep(2 ** attempt)
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

        # Stream events as they arrive — chunks AND batch results
        while completed < total:
            event = await queue.get()
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
        if self._client:
            await self._client.aclose()
            self._client = None


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
