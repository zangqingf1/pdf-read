"""DeepSeek API service — translation with parallel batch processing."""

import asyncio
import json
import logging
import re

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
    """DeepSeek API wrapper for paragraph translation with parallel batches."""

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or settings.DEEPSEEK_API_KEY
        self.base_url = settings.DEEPSEEK_BASE_URL
        self.model = settings.DEEPSEEK_MODEL
        self._client: httpx.AsyncClient | None = None

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                timeout=httpx.Timeout(60.0, connect=10.0),
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
                "DeepSeek API Key 未配置。请在 .env 中设置或在页面右上角配置。"
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

        # Use a high floor for max_tokens — reasoning models (deepseek-v4-flash)
        # consume tokens for internal reasoning, so we need ample headroom.
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": max(1024, min(len(text) * 4, 4096)),
        }

        for attempt in range(3):
            try:
                response = await self.client.post(
                    "/v1/chat/completions", json=payload
                )
                response.raise_for_status()
                data = response.json()

                if "error" in data:
                    err = data["error"]
                    raise httpx.HTTPStatusError(
                        f"DeepSeek API error: {err.get('message', str(err))}",
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
                "DeepSeek API Key 未配置。请在 .env 中设置或在页面右上角配置。"
            )

        semaphore = asyncio.Semaphore(10)  # 10 concurrent calls

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
        tasks = [_translate_one(i, text) for i, text in enumerate(paragraphs)]
        results = await asyncio.gather(*tasks)

        # Sort by index to maintain original order
        results.sort(key=lambda x: x[0])
        return [text for _, text in results]

    async def analyze_words(
        self,
        entries: list[dict],
        *,
        system_prompt_override: str | None = None,
        user_prompt_override: str | None = None,
    ) -> list[dict]:
        """Analyze vocabulary words with DeepSeek AI — parallel batch processing.

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
                "DeepSeek API Key 未配置。请在 .env 中设置或在页面右上角配置。"
            )

        # Group entries by paragraph_index to share sentence context
        from itertools import groupby
        from app.config import settings as app_settings

        batch_size = getattr(app_settings, "WORDS_BATCH_SIZE", 5)
        semaphore = asyncio.Semaphore(10)

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
                    "max_tokens": max(1024, min(len(words_batch) * 1500, 8192)),
                    "response_format": {"type": "json_object"},
                }

                for attempt in range(3):
                    try:
                        response = await self.client.post(
                            "/v1/chat/completions", json=payload
                        )
                        response.raise_for_status()
                        data = response.json()

                        if "error" in data:
                            err = data["error"]
                            raise httpx.HTTPStatusError(
                                f"DeepSeek API error: {err.get('message', str(err))}",
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
                            r["paragraph_index"] = para_index
                            # cognates: ensure list of {word, part_of_speech, meaning_zh}
                            if "cognates" not in r or not isinstance(
                                r.get("cognates"), list
                            ):
                                r["cognates"] = []
                            # synonyms_antonyms: ensure dict with synonyms/antonyms arrays
                            sa = r.get("synonyms_antonyms")
                            if not isinstance(sa, dict):
                                r["synonyms_antonyms"] = {"synonyms": [], "antonyms": []}
                            else:
                                if "synonyms" not in sa or not isinstance(
                                    sa["synonyms"], list
                                ):
                                    sa["synonyms"] = []
                                if "antonyms" not in sa or not isinstance(
                                    sa["antonyms"], list
                                ):
                                    sa["antonyms"] = []
                            # base_form / plural_form: ensure strings
                            if not isinstance(r.get("base_form"), str):
                                r["base_form"] = ""
                            if not isinstance(r.get("plural_form"), str):
                                r["plural_form"] = ""

                        return results

                    except (httpx.HTTPError, httpx.TimeoutException) as e:
                        if attempt < 2 and not _is_fatal_error(e):
                            await asyncio.sleep(2 ** attempt)
                        else:
                            if _is_fatal_error(e):
                                raise  # Auth / config error → fail the whole batch
                            logger.exception("Word analysis HTTP/timeout error")
                            return []
                    except (json.JSONDecodeError, KeyError, TypeError) as e:
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

    async def analyze_sentences(
        self,
        entries: list[dict],
        *,
        system_prompt_override: str | None = None,
        user_prompt_override: str | None = None,
    ) -> list[dict]:
        """Analyze sentence structure with DeepSeek AI — parallel batch processing.

        entries: [
            {"paragraph_index": 0, "sentence_index": 0, "sentence_text": "...",
             "sentence_translation": "..."},
            ...
        ]

        Returns a list of result dicts keyed by (paragraph_index, sentence_index),
        each containing structure (sentence_structure array with text/label/explanation)
        and idiomatic_translation.
        """
        if not entries:
            return []

        if not self.api_key or not self.api_key.strip():
            raise ValueError(
                "DeepSeek API Key 未配置。请在 .env 中设置或在页面右上角配置。"
            )

        semaphore = asyncio.Semaphore(10)

        async def _analyze_one(entry: dict) -> dict | None:
            async with semaphore:
                sentence_text = entry["sentence_text"]
                sentence_translation = entry.get("sentence_translation", "")

                messages = _resolve_prompt(
                    "analyze_sentences",
                    {
                        "sentence_text": sentence_text,
                        "sentence_translation": sentence_translation or "无",
                    },
                    system_override=system_prompt_override,
                    user_override=user_prompt_override,
                )

                payload = {
                    "model": self.model,
                    "messages": messages,
                    "temperature": 0.3,
                    "max_tokens": max(1024, min(len(sentence_text) * 2000, 8192)),
                    "response_format": {"type": "json_object"},
                }

                for attempt in range(3):
                    try:
                        response = await self.client.post(
                            "/v1/chat/completions", json=payload
                        )
                        response.raise_for_status()
                        data = response.json()

                        if "error" in data:
                            err = data["error"]
                            raise httpx.HTTPStatusError(
                                f"DeepSeek API error: {err.get('message', str(err))}",
                                request=response.request,
                                response=response,
                            )

                        content = data["choices"][0]["message"]["content"].strip()
                        parsed = json.loads(content)

                        if not isinstance(parsed, dict):
                            return None

                        # Normalize result
                        result = {
                            "paragraph_index": entry["paragraph_index"],
                            "sentence_index": entry["sentence_index"],
                            "sentence_text": sentence_text,
                            "structure": parsed.get("sentence_structure", []),
                            "idiomatic_translation": parsed.get("idiomatic_translation", ""),
                        }

                        # Ensure structure is a list
                        if not isinstance(result["structure"], list):
                            result["structure"] = []
                        # Ensure idiomatic_translation is a string
                        if not isinstance(result["idiomatic_translation"], str):
                            result["idiomatic_translation"] = str(result["idiomatic_translation"])

                        return result

                    except (httpx.HTTPError, httpx.TimeoutException) as e:
                        if attempt < 2 and not _is_fatal_error(e):
                            await asyncio.sleep(2 ** attempt)
                        else:
                            if _is_fatal_error(e):
                                raise  # Auth / config error → fail the whole batch
                            logger.exception("Sentence analysis HTTP/timeout error")
                            return None
                    except (json.JSONDecodeError, KeyError, TypeError) as e:
                        if attempt < 2:
                            await asyncio.sleep(2 ** attempt)
                        else:
                            logger.exception("Sentence analysis JSON/decode error")
                            return None

                return None

        # Launch all sentence analyses concurrently
        tasks = [_analyze_one(e) for e in entries]
        results = await asyncio.gather(*tasks)

        # Filter out failures
        return [r for r in results if r is not None]

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None


ai_service = AIService()
