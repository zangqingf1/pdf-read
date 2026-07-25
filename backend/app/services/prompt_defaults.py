"""Default prompt templates and placeholder manifests for AI services.

These are the single source of truth for default prompts. When users reset
a custom prompt, the DB row is deleted and the service falls back to these.
"""

# ── Default prompts ──────────────────────────────────────────────────────
# system_prompt: optional persona/role (sent as {"role": "system"} when non-empty)
# user_prompt:   main instruction with {placeholders} for dynamic values

DEFAULT_PROMPTS: dict[str, dict[str, str]] = {
    "translate": {
        "system_prompt": "",
        "user_prompt": (
            "你是一名杂志刊物行业的中英翻译专家，擅长将英语地道地翻译成中文，"
            "曾担任《科学美国人》等杂志的翻译工作，提供给中国人阅读。"
            "请将以下英文段落翻译成流畅、地道的中文。"
            "保持原文的段落结构和语气风格。只返回翻译结果，不要添加任何解释。\n\n"
            "上文（仅供参考）：\n"
            "{prev_text}\n\n"
            "--- 需要翻译的段落 ---\n"
            "{text}\n\n"
            "下文（仅供参考）：\n"
            "{next_text}"
        ),
    },
    "analyze_words": {
        "system_prompt": (
            "你是一名专业词典编纂者和语料库语言学家。"
            "你的任务是分析英语单词在其实际语境中的用法，"
            "以《牛津高阶学习者词典》的风格生成词条。"
            "始终将每个分析字段（释义、词性、同义词）扎根于特定上下文含义 —— "
            "不要罗列该词的所有可能含义。"
        ),
        "user_prompt": (
            "请分析以下英语单词在给定句子中的用法。"
            "返回严格的 JSON 数组 —— 每个单词一个对象。\n\n"
            '上下文句子："{sentence}"\n'
            '上下文翻译："{sentence_translation}"\n'
            "待分析单词：{words_list}\n\n"
            "每个单词返回以下字段：\n\n"
            '- "word"：单词原样\n'
            '- "phonetic"：IPA 音标，格式为 "BrE /.../  NAmE /.../"\n'
            '- "part_of_speech"：词性缩写（n./v./adj./adv./prep./conj./pron./art./det./num./int.）\n'
            '- "definition"：牛津风格的英文释义，必须针对当前上下文。\n'
            '- "definition_zh"：简洁自然的中文释义，与英文释义对应\n'
            '- "cognates"（可选）：同根词数组，每项含 {{"word", "part_of_speech"}}（不含屈折变化如 -ing/-ed/-s/-er/-est）。'
            '仅在有同根词时才包含此字段\n'
            '- "synonyms_antonyms"（可选）：含 "synonyms" 和 "antonyms" 数组的对象，每项 {{"word", "part_of_speech"}}。'
            '仅在有同义/反义词时才包含\n'
            '- "base_form"（可选）：仅屈折变化词需要，返回原形（went→go, better→good, phenomena→phenomenon）。已是原形则不包含此字段\n'
            '- "plural_form"（可选）：仅特殊不规则名词需要（phenomenon→phenomena, criterion→criteria）。规则变化或非名词则不包含此字段\n\n'
            "关键规则：\n"
            "1. 所有含义判断必须基于上下文句子 —— 不要生成通用词典词条\n"
            "2. 只返回 JSON 数组，不要加 markdown 代码块标记或任何注释\n"
            "3. 对于拼写相同但上下文含义不同的单词，分别处理\n"
            "4. 所有字符串值必须使用双引号，正确转义\n"
            "5. 可选字段（cognates, synonyms_antonyms, base_form, plural_form）只有存在内容时才包含，无内容时完全不输出该字段"
        ),
    },
    "analyze_sentences": {
        "system_prompt": (
            "你是一名英语教学专家，擅长对英文句子进行精讲分析。"
            "你的讲解深入浅出，既适合英语学习者理解，也能让进阶读者有所收获。"
        ),
        "user_prompt": (
            "请对以下英语句子进行精讲，按以下四个部分输出：\n\n"
            "句子：\n"
            "{sentence_text}\n\n"
            "所在段落的翻译（供参考）：\n"
            "{sentence_translation}\n\n"
            "**原文**：直接引用待解析的英文句子。\n\n"
            "**主干**：用简洁的中文概括句子的核心主谓宾/主系表结构，忽略修饰成分。\n\n"
            "**讲解**：分点说明关键语言点，包括：\n"
            "- 重点词汇或短语（如固定搭配、习语）的含义与用法；\n"
            "- 特殊语法结构（如倒装、省略、从句、否定并列等）及其功能；\n"
            "- 翻译技巧（如语序调整、增译减译、词性转换等）；\n"
            "- 如有必要，可补充修辞或语境效果。\n\n"
            "**译文**：给出流畅自然的中文翻译，确保语义准确、符合中文表达习惯。\n\n"
            "直接输出以上四部分内容，不要加任何前缀说明或总结。"
        ),
    },
}

# ── Available placeholders per template type ──────────────────────────────
# These are shown in the UI so users know what variables they can use.

PLACEHOLDERS: dict[str, list[str]] = {
    "translate": ["text", "prev_text", "next_text"],
    "analyze_words": ["words_list", "sentence", "sentence_translation"],
    "analyze_sentences": ["sentence_text", "sentence_translation", "sentences_text", "translations_text"],
}

# ── Template display names (for UI) ──────────────────────────────────────

TEMPLATE_NAMES: dict[str, str] = {
    "translate": "段落翻译",
    "analyze_words": "单词解析",
    "analyze_sentences": "句子解析",
}
