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
        "system_prompt": "",
        "user_prompt": (
            "你是一个专业的词典撰写专家，你能根据上下文分析单词。请参考牛津词典的风格为以下每个单词提供详细的分析，以 JSON 数组格式返回。\n\n"
            '上下文句子："{sentence}"\n\n'
            "需要分析的单词：{words_list}\n\n"
            "返回格式要求 — 必须返回严格的 JSON 数组，每个元素包含以下字段：\n"
            '- "word": 原单词\n'
            '- "phonetic": IPA 音标，例如 "BrE /ɪnˈseɪn/  NAmE /ɪnˈseɪn/"、"BrE /ˈθrɪlə(r)/  NAmE /ˈθrɪlər/"\n'
            '- "part_of_speech": 词性缩写 (n./v./adj./adv./prep./conj./pron./art./det.等)\n'
            '- "definition": 牛津词典风格的英文释义，例如：" very stupid, crazy or dangerous"、"a book, play or film with an exciting story, especially one about crime or SPYING"\n'
            '- "definition_zh": 中文释义\n'
            '- "cognates": 同根词列表，不包含现在分词及过去式等变形，每个元素包含 "word"（同根词）和 "part_of_speech"（词性缩写）。例如对于 "create"，同根词包括 [{{"word": "creation", "part_of_speech": "n."}}, {{"word": "creative", "part_of_speech": "adj."}}]。没有则返回 []\n'
            '- "synonyms_antonyms": 返回常见的近义词与反义词对象，包含 "synonyms" 和 "antonyms" 两个数组，每个元素包含 "word"（单词）和"part_of_speech"（词性缩写）。例如 {{"synonyms": [{{"word": "joyful", "part_of_speech": "adj."}}]}}。没有则返回 []\n'
            '- "base_form": 原形。若该单词是变形（过去式、过去分词、比较级、最高级、复数等），返回其原形。例如 "went"→"go"、"better"→"good"、"phenomena"→"phenomenon"。若单词已是原形则返回空字符串 ""\n'
            '- "plural_form": 特殊复数形式。若该单词是名词且有特殊复数变化（如 phenomenon→phenomena、criterion→criteria），返回其复数形式。若该单词本身已是复数形式或为规则变化则返回空字符串 ""\n\n'
            "只返回 JSON 数组，不要添加任何其他文字。"
        ),
    },
    "analyze_sentences": {
        "system_prompt": "",
        "user_prompt": (
            "你是一个资深的英语考研教师。请将以下句子按以下要求拆解，分成不同部分，以 JSON 格式返回。\n\n"
            "要求：\n\n"
            "- 主干：概括全句核心框架（主谓宾/主系表/祈使句等）。如果一个句子由并列连词（and/but/or等）连接多个分句，请分别标出各个分句的主干。\n"
            "- 修饰成分，包含但不限于：\n"
            "  · 介词短语（说明修饰对象和功能，如作定语、作状语、作表语等）\n"
            "  · 定语从句（标注先行词和引导词 that/which/who/whom/whose/when/where/why）\n"
            "  · 状语从句（标注引导词和从句类型，如时间/原因/条件/让步/目的/结果/方式/比较）\n"
            "  · 宾语从句（标注引导词 that/whether/if/what/who/which/when/where/why/how）\n"
            "  · 主语从句（标注引导词和从句在句中的位置）\n"
            "  · 表语从句（标注引导词）\n"
            "  · 同位语 / 同位语从句（说明与哪个名词构成同位关系，若有引导词请标出）\n"
            "  · 非谓语动词（to do / doing / done，说明其逻辑主语和所作成分：定语/状语/补语/主语/宾语等）\n"
            "  · 插入语（标注其功能，如表示评价、补充说明、逻辑衔接等）\n"
            "  · 连接词 / 引导词（如 and, but, or, that, which, when, if, because, although 等，说明其连接的内容）\n\n"
            '  需要分析的句子："{sentence_text}"\n'
            '  段落翻译参考："{sentence_translation}"\n\n'
            "  返回格式要求 — 必须返回严格的 JSON 对象，包含以下字段：\n\n"
            '  - "sentence_structure": 数组，每个元素包含：\n'
            '    - "text": 该部分的原文片段\n'
            '    - "label": 句子部分标签（如：主干，定语从句、状语从句、同位语、插入语、宾语从句、主语从句、连接词等）\n'
            '    - "explanation": 该成分在原句中的具体内容，功能说明（说明它修饰谁、作何成分、表达什么含义等）\n'
            '  - "idiomatic_translation": 整句的地道中文翻译（不是逐字直译，而是符合中文表达习惯的自然翻译）\n\n'
            "  注意事项：\n"
            "  1. sentence_structure 数组中的元素应按原文出现顺序排列，便于学生对照原文阅读。\n"
            "  2. 每个修饰成分的 explanation 应明确指出其修饰对象（修饰哪个词/短语/从句）。\n"
            "  3. 引导词应单独列为一个元素（label 为\"连接词\"或\"引导词\"），或合并在对应的从句元素中标注，保持清晰。\n"
            "  4. 如果句子含有多个并列分句，每个分句的主干分别列出。\n\n"
            "  只返回 JSON 对象，不要添加任何其他文字。"
        ),
    },
}

# ── Available placeholders per template type ──────────────────────────────
# These are shown in the UI so users know what variables they can use.

PLACEHOLDERS: dict[str, list[str]] = {
    "translate": ["text", "prev_text", "next_text"],
    "analyze_words": ["words_list", "sentence", "sentence_translation"],
    "analyze_sentences": ["sentence_text", "sentence_translation"],
}

# ── Template display names (for UI) ──────────────────────────────────────

TEMPLATE_NAMES: dict[str, str] = {
    "translate": "段落翻译",
    "analyze_words": "单词解析",
    "analyze_sentences": "句子解析",
}
