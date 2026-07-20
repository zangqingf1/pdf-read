"""DeepSeek API service — translation with parallel batch processing."""

import asyncio
import json

import httpx

from app.config import settings


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
        self, text: str, prev_text: str | None = None, next_text: str | None = None
    ) -> str:
        """Translate an English paragraph to Chinese, with optional context.

        When prev_text/next_text are provided, they are included in the prompt
        as surrounding context so the AI can resolve ambiguities (e.g. "bank" →
        "银行" in finance context vs "河岸" in nature context).
        """
        if not self.api_key or not self.api_key.strip():
            raise ValueError(
                "DeepSeek API Key 未配置。请在 .env 中设置或在页面右上角配置。"
            )

        if prev_text or next_text:
            # Sliding window context translation
            prompt_parts = ["你是一个专业的英文翻译。请结合上下文语境翻译以下段落。"]
            if prev_text:
                prompt_parts.append(f"上文（仅供参考）：\n{prev_text}")
            prompt_parts.append(f"--- 需要翻译的段落 ---\n{text}")
            if next_text:
                prompt_parts.append(f"下文（仅供参考）：\n{next_text}")
            prompt_parts.append("只返回翻译结果，不要添加任何解释。")
            prompt = "\n\n".join(prompt_parts)
        else:
            prompt = (
                "你是一个专业的英文翻译。请将以下英文段落翻译成流畅、地道的中文。"
                "保持原文的段落结构和语气风格。只返回翻译结果，不要添加任何解释。\n\n"
                f"原文：\n{text}"
            )

        # Use a high floor for max_tokens — reasoning models (deepseek-v4-flash)
        # consume tokens for internal reasoning, so we need ample headroom.
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
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

    async def translate_batch(self, paragraphs: list[str]) -> list[str]:
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
                        text, prev_text=prev_text, next_text=next_text
                    )
                    return (index, result)
                except Exception:
                    return (index, "")

        # Launch all translations concurrently (order preserved by index)
        tasks = [_translate_one(i, text) for i, text in enumerate(paragraphs)]
        results = await asyncio.gather(*tasks)

        # Sort by index to maintain original order
        results.sort(key=lambda x: x[0])
        return [text for _, text in results]

    async def analyze_words(self, entries: list[dict]) -> list[dict]:
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
                prompt = f"""你是一个专业的英语词汇分析师。请为以下每个单词提供详细的分析，以 JSON 数组格式返回。

上下文句子："{sentence}"
上下文翻译："{sentence_translation or '无'}"

需要分析的单词：{words_list}

返回格式要求 — 必须返回严格的 JSON 数组，每个元素包含以下字段：
- "word": 原单词
- "phonetic": IPA 音标，例如 "/ˈɡræv.ə.ti/"
- "part_of_speech": 词性缩写 (n./v./adj./adv./prep./conj./pron./art./det.)
- "definition": 简单的英文释义（不超过 30 词）
- "definition_zh": 中文释义
- "example_sentences": 2~3 个自然的英语例句，字符串数组
- "example_sentences_zh": 对应的中文翻译，字符串数组（与英文例句一一对应）

只返回 JSON 数组，不要添加任何其他文字。"""

                payload = {
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
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
                            if "example_sentences" not in r or not isinstance(
                                r.get("example_sentences"), list
                            ):
                                r["example_sentences"] = []
                            if "example_sentences_zh" not in r or not isinstance(
                                r.get("example_sentences_zh"), list
                            ):
                                r["example_sentences_zh"] = []

                        return results

                    except (httpx.HTTPError, httpx.TimeoutException) as e:
                        if attempt < 2:
                            await asyncio.sleep(2 ** attempt)
                        else:
                            return []
                    except (json.JSONDecodeError, KeyError, TypeError):
                        if attempt < 2:
                            await asyncio.sleep(2 ** attempt)
                        else:
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

    async def analyze_sentences(self, entries: list[dict]) -> list[dict]:
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

                prompt = f"""你是一个资深的英语考研教师。请将以下句子按以下要求拆解，分成不同部分，以 JSON 格式返回。

要求：

- 主干：概括全句核心框架（主谓宾/主系表/祈使句等）。如果一个句子由并列连词（and/but/or等）连接多个分句，请分别标出各个分句的主干。
- 修饰成分，包含但不限于：
  · 介词短语（说明修饰对象和功能，如作定语、作状语、作表语等）
  · 定语从句（标注先行词和引导词 that/which/who/whom/whose/when/where/why）
  · 状语从句（标注引导词和从句类型，如时间/原因/条件/让步/目的/结果/方式/比较）
  · 宾语从句（标注引导词 that/whether/if/what/who/which/when/where/why/how）
  · 主语从句（标注引导词和从句在句中的位置）
  · 表语从句（标注引导词）
  · 同位语 / 同位语从句（说明与哪个名词构成同位关系，若有引导词请标出）
  · 非谓语动词（to do / doing / done，说明其逻辑主语和所作成分：定语/状语/补语/主语/宾语等）
  · 插入语（标注其功能，如表示评价、补充说明、逻辑衔接等）
  · 连接词 / 引导词（如 and, but, or, that, which, when, if, because, although 等，说明其连接的内容）

  需要分析的句子："{sentence_text}"
  段落翻译参考："{sentence_translation or '无'}"

  返回格式要求 — 必须返回严格的 JSON 对象，包含以下字段：

  - "sentence_structure": 数组，每个元素包含：
    - "text": 该部分的原文片段
    - "label": 句子部分标签（如：主干，定语从句、状语从句、同位语、插入语、宾语从句、主语从句、连接词等）
    - "explanation": 该成分在原句中的具体内容，功能说明（说明它修饰谁、作何成分、表达什么含义等）
  - "idiomatic_translation": 整句的地道中文翻译（不是逐字直译，而是符合中文表达习惯的自然翻译）

  注意事项：
  1. sentence_structure 数组中的元素应按原文出现顺序排列，便于学生对照原文阅读。
  2. 每个修饰成分的 explanation 应明确指出其修饰对象（修饰哪个词/短语/从句）。
  3. 引导词应单独列为一个元素（label 为"连接词"或"引导词"），或合并在对应的从句元素中标注，保持清晰。
  4. 如果句子含有多个并列分句，每个分句的主干分别列出。

  只返回 JSON 对象，不要添加任何其他文字。"""

                payload = {
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
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
                        if attempt < 2:
                            await asyncio.sleep(2 ** attempt)
                        else:
                            return None
                    except (json.JSONDecodeError, KeyError, TypeError):
                        if attempt < 2:
                            await asyncio.sleep(2 ** attempt)
                        else:
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
