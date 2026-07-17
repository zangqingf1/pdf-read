"""DeepSeek API service — lightweight wrapper for paragraph translation."""

import asyncio
import hashlib
import json

import httpx

from app.config import settings


class AIService:
    """Minimal DeepSeek API wrapper for translation tasks."""

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

    async def explain_words(self, words: list[str], context: str) -> list[dict]:
        """Explain multiple words in context. Returns structured JSON list."""
        if not self.api_key or not self.api_key.strip():
            raise ValueError(
                "DeepSeek API Key 未配置。请在 .env 中设置或在页面右上角配置。"
            )

        word_list = "、".join(words)
        prompt = (
            f"你是一位专业的英语教师。请在以下原文语境中分析下列单词：{word_list}\n\n"
            f"原文：{context}\n\n"
            "对每个单词，请返回一个 JSON 对象，格式如下：\n"
            "{\n"
            '  "explanations": [\n'
            "    {\n"
            '      "word": "单词原形",\n'
            '      "phonetic": "/IPA音标/",\n'
            '      "context_sentence": "该单词在原文中所在的完整句子（英文，必须从原文中提取）",\n'
            '      "context_sentence_zh": "该句子的自然流畅中文翻译",\n'
            '      "pos": "词性英文简写，如 n. / v. / adj. / adv. / prep. / conj. 等",\n'
            '      "definition_en": "用简单英语解释该词在此语境中的含义（用基础词汇，适合英语学习者）",\n'
            '      "definition_zh": "该词在此语境中的中文释义",\n'
            '      "examples": [\n'
            '        {"en": "英文例句", "zh": "中文翻译"},\n'
            '        {"en": "英文例句", "zh": "中文翻译"}\n'
            '      ]\n'
            "    }\n"
            "  ]\n"
            "}\n\n"
            "要求：\n"
            "1. explanations 数组中的每个元素对应一个要分析的单词，顺序与输入单词顺序严格一致\n"
            "2. context_sentence 必须是从原文中提取的包含该单词的完整句子，不要自己编造\n"
            "3. 音标使用 IPA 国际音标\n"
            "4. definition_en 用简单英语表达，避免使用比原词更难的词汇\n"
            "5. examples 提供 2-3 个例句，每个包含 en 和 zh 字段\n"
            "6. 纯 JSON 输出，不要使用 Markdown 代码块包裹"
        )

        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_tokens": max(1024, min(500 * len(words), 8192)),
            "response_format": {"type": "json_object"},
        }

        last_error = None
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
                content = self._extract_json(content)
                parsed = json.loads(content)
                explanations = parsed.get("explanations", [])

                if not isinstance(explanations, list):
                    raise ValueError("explanations is not a list")

                # Pad or truncate to match input word count
                while len(explanations) < len(words):
                    explanations.append({
                        "word": words[len(explanations)],
                        "phonetic": "",
                        "context_sentence": "",
                        "context_sentence_zh": "",
                        "pos": "",
                        "definition_en": "",
                        "definition_zh": "",
                        "examples": [],
                    })
                return explanations[: len(words)]

            except (httpx.HTTPError, httpx.TimeoutException) as e:
                last_error = e
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                continue
            except (json.JSONDecodeError, KeyError, TypeError, ValueError) as e:
                last_error = e
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                continue

        if last_error is None:
            raise RuntimeError("AI service call failed")
        raise last_error

    async def analyze_sentence(self, sentence: str, context: str = "") -> dict:
        """Analyze English sentence grammar structure using DeepSeek.

        Returns a structured dict with sentence structure breakdown,
        grammar explanation, key vocabulary, and Chinese translation.

        Args:
            sentence: The sentence to analyze.
            context: Surrounding paragraph for better understanding.

        Returns:
            dict with keys: sentence_structure, grammar_explanation,
            key_vocabulary, translation.
        """
        if not self.api_key or not self.api_key.strip():
            raise ValueError(
                "DeepSeek API Key 未配置。请在 .env 中设置或在页面右上角配置。"
            )

        prompt = (
            "你是一位专业的英语语法教师。请对以下英文句子进行详细的语法结构分析。\n\n"
            f"句子：\"{sentence}\"\n"
            + (f"上下文：\"{context}\"\n\n" if context else "\n")
            + "请返回一个 JSON 对象，格式如下：\n"
            "{\n"
            '  "sentence_structure": "详细描述句子结构（主句、从句类型、修饰成分等），用中文说明",\n'
            '  "grammar_explanation": "详细的语法讲解，包括时态、语态、从句引导词、特殊句式等，用中文说明，不少于3句话",\n'
            '  "key_vocabulary": [\n'
            '    {"word": "单词", "pos": "词性", "meaning": "在句中的含义"}\n'
            "  ],\n"
            '  "translation": "整句的自然流畅中文翻译"\n'
            "}\n\n"
            "要求：\n"
            "1. key_vocabulary 列出句中重要或有学习价值的词汇（3-8个）\n"
            "2. 语法讲解要清晰易懂，适合英语学习者\n"
            "3. 翻译要通顺自然，符合中文表达习惯\n"
            "4. 纯 JSON 输出，不要使用 Markdown 代码块包裹"
        )

        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_tokens": max(1024, min(len(sentence) * 8, 4096)),
            "response_format": {"type": "json_object"},
        }

        last_error = None
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
                content = self._extract_json(content)
                return json.loads(content)

            except (httpx.HTTPError, httpx.TimeoutException) as e:
                last_error = e
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                continue
            except (json.JSONDecodeError, KeyError, TypeError) as e:
                last_error = e
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                continue

        if last_error is None:
            raise RuntimeError("AI service call failed with no specific error")
        raise last_error

    async def translate(self, text: str) -> str:
        """Translate English text to Chinese using DeepSeek."""
        if not self.api_key or not self.api_key.strip():
            raise ValueError(
                "DeepSeek API Key 未配置。请在 .env 中设置或在页面右上角配置。"
            )

        prompt = (
            "你是一个专业的英文翻译。请将以下英文段落翻译成流畅、地道的中文。"
            "保持原文的段落结构和语气风格。只返回翻译结果，不要添加任何解释。\n\n"
            f"原文：\n{text}"
        )

        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_tokens": min(len(text) * 3, 4096),
        }

        last_error = None
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
                last_error = e
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                continue

        if last_error is None:
            raise RuntimeError("AI service call failed with no specific error")
        raise last_error

    async def translate_batch(self, paragraphs: list[str]) -> list[str]:
        """Translate multiple paragraphs in one API call."""
        if not paragraphs:
            return []

        if not self.api_key or not self.api_key.strip():
            raise ValueError(
                "DeepSeek API Key 未配置。请在 .env 中设置或在页面右上角配置。"
            )

        # Build a single prompt for all paragraphs
        parts = []
        for i, text in enumerate(paragraphs):
            parts.append(f"[段落{i + 1}]\n{text}")
        joined = "\n\n".join(parts)

        prompt = (
            "你是一个专业的英文翻译。请将以下每个英文段落翻译成流畅、地道的中文。"
            "保持原文的段落结构和语气风格。\n"
            "返回一个 JSON 对象，格式为：{\"translations\": [\"翻译1\", \"翻译2\", ...]}\n"
            "每个翻译对应一个输入段落，顺序保持一致。\n\n"
            f"{joined}"
        )

        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "max_tokens": min(len(joined) * 3, 8192),
            "response_format": {"type": "json_object"},
        }

        last_error = None
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
                # Extract JSON from response (handle markdown wrapping)
                content = self._extract_json(content)
                parsed = json.loads(content)
                translations = parsed.get("translations", [])

                # Ensure we have the right number of translations
                while len(translations) < len(paragraphs):
                    translations.append("")
                return translations[: len(paragraphs)]

            except (httpx.HTTPError, httpx.TimeoutException) as e:
                last_error = e
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                continue
            except (json.JSONDecodeError, KeyError, IndexError, TypeError) as e:
                last_error = e
                break

        if last_error is None:
            raise RuntimeError("AI service call failed with no specific error")
        raise last_error

    @staticmethod
    def _extract_json(text: str) -> str:
        """Extract valid JSON from model response, handling markdown wrapping."""
        import re
        text = text.strip()
        m = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
        if m:
            text = m.group(1).strip()
        if text.startswith("{"):
            depth = 0
            for i, ch in enumerate(text):
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        return text[: i + 1]
        return text

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None


ai_service = AIService()
