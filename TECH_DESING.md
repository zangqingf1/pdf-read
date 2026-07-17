# PDF外刊精读辅助工具 — 技术设计文档（TDD）

**文档版本**：v1.0
**日期**：2026-07-15
**关联文档**：`deliverables/product-strategy/PRD.md`
**目标读者**：开发团队（前端工程师、后端工程师、AI/NLP工程师）

---

## 📌 概述

本文档基于《PDF外刊精读辅助工具 PRD》进行技术层面的系统设计，覆盖系统架构、技术选型、模块设计、数据模型、API规范、AI服务管线、前端架构、部署方案及性能/安全设计。MVP范围聚焦PRD中V1.0的6项P0功能（F01-F05+F07）。

---

## 1. 系统架构

### 1.1 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                      用户浏览器                          │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌─────────┐ │
│  │ PDF上传   │ │ 阅读器    │ │ 长难句    │ │ 生词本  │ │
│  │ 与预览    │ │ (正文展示)│ │ 拆解视图  │ │ 与复习  │ │
│  └───────────┘ └───────────┘ └───────────┘ └─────────┘ │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS
┌──────────────────────┴──────────────────────────────────┐
│                   Nginx (反向代理/静态资源)               │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│                 后端服务 (FastAPI)                        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────────────┐ │
│  │PDF解析  │ │词汇服务 │ │AI分析   │ │生词本/复习    │ │
│  │服务     │ │(查词/   │ │(长难句/ │ │(SM-2调度)     │ │
│  │         │ │ 教学卡) │ │ 段落总结)│ │               │ │
│  └────┬────┘ └────┬────┘ └────┬────┘ └───────┬───────┘ │
└───────┼──────────┼───────────┼───────────────┼─────────┘
        │          │           │               │
   ┌────┴────┐ ┌───┴───┐  ┌────┴────┐    ┌─────┴─────┐
   │PaddleOCR│ │ECDICT │  │DeepSeek │    │PostgreSQL │
   │ /MinerU │ │+ COCA │  │ V3 API  │    │ + Redis   │
   │(本地部署)│ │(本地) │  │(外部API)│    │           │
   └─────────┘ └───────┘  └─────────┘    └───────────┘
```

### 1.2 架构分层说明

| 层级 | 职责 | 技术选型 |
|------|------|---------|
| **前端层** | 用户交互、阅读器渲染、语法树可视化 | React 18 + TypeScript + Vite |
| **网关层** | 反向代理、静态资源托管、HTTPS终止 | Nginx |
| **后端服务层** | 业务逻辑、API服务、任务调度 | Python 3.12 + FastAPI |
| **AI服务层** | PDF解析、翻译、词汇分析、长难句拆解 | PaddleOCR 3.0（本地）+ DeepSeek V3 API |
| **数据层** | 持久化存储、缓存、会话管理 | PostgreSQL 16 + Redis 7 |
| **文件存储** | PDF文件、生成文档的临时存储 | 本地文件系统（MVP）/ MinIO（扩展） |

### 1.3 核心设计原则

1. **AI任务异步化**：PDF解析、AI分析等耗时操作采用异步任务队列，前端轮询/WebSocket获取进度
2. **本地优先**：词典查询（ECDICT）、词频数据（COCA）本地化，保证≤300ms响应
3. **API无状态**：后端API设计为无状态，水平扩展友好
4. **渐进增强**：MVP先跑通核心链路，架构预留扩展点（用户体系、付费等）

---

## 2. 技术栈选型

### 2.1 前端技术栈

| 组件 | 选型 | 版本 | 选型理由 |
|------|------|------|---------|
| 框架 | React | 18.x | 生态成熟，组件复用性强 |
| 语言 | TypeScript | 5.x | 类型安全，PRD接口定义清晰 |
| 构建工具 | Vite | 5.x | 开发体验好，HMR快 |
| UI组件库 | Ant Design | 5.x | 组件丰富，中文文档好，PRD建议复用组件库 |
| 样式方案 | Tailwind CSS | 3.x | 原子化CSS，快速迭代 |
| 语法树可视化 | D3.js | 7.x | PRD指定，灵活的SVG渲染 |
| 状态管理 | Zustand | 4.x | 轻量级，适合中型应用 |
| HTTP客户端 | Axios | 1.x | 拦截器、取消请求支持 |
| Markdown渲染 | react-markdown | 9.x | 文档预览/导出场景 |

### 2.2 后端技术栈

| 组件 | 选型 | 版本 | 选型理由 |
|------|------|------|---------|
| 语言 | Python | 3.12 | AI生态最佳，PaddleOCR原生支持 |
| Web框架 | FastAPI | 0.111+ | 异步原生、自动文档、性能好 |
| ASGI服务器 | Uvicorn | 2.x | FastAPI标配 |
| ORM | SQLAlchemy | 2.x | 异步支持，成熟稳定 |
| 数据库迁移 | Alembic | 1.x | SQLAlchemy标配 |
| 任务队列 | Celery | 5.x | 异步任务（PDF解析、AI分析） |
| 消息代理 | Redis | 7.x | Celery broker + 缓存 |
| PDF解析 | PaddleOCR | 3.0 (PP-OCRv5) | PRD指定，版面分析能力强 |
| PDF备选 | MinerU | latest | 备选方案，学术文档优化 |
| AI API | DeepSeek V3 | API | PRD指定，翻译错误率低于GPT-4o，成本低 |
| AI备选 | GPT-4o | API | 质量备选，成本较高 |
| 本地词典 | ECDICT | latest | PRD指定，离线词典 |
| 词频数据 | COCA | — | 词频分级，判断教学价值 |
| 句法分析 | spaCy | 3.x | 依存句法分析辅助（长难句初筛） |
| 文档生成 | WeasyPrint / python-docx | — | PDF/Word导出 |

### 2.3 基础设施

| 组件 | 选型 | 说明 |
|------|------|------|
| 数据库 | PostgreSQL 16 | 主数据库，支持JSONB存储AI结构化输出 |
| 缓存 | Redis 7 | 会话缓存、AI结果缓存、Celery broker |
| 容器化 | Docker + Docker Compose | 开发/部署一致性 |
| 反向代理 | Nginx | HTTPS、静态资源、负载均衡 |
| CI/CD | GitHub Actions | 自动测试、构建、部署 |
| 监控 | Sentry + Prometheus | 错误监控 + 性能指标 |

---

## 3. 模块设计

### 3.1 模块总览

```
backend/
├── app/
│   ├── main.py                    # FastAPI 入口
│   ├── config.py                  # 配置管理
│   ├── api/                       # API 路由层
│   │   ├── v1/
│   │   │   ├── pdf.py             # F01: PDF上传与解析
│   │   │   ├── vocabulary.py      # F02/F04: 词汇查词与教学
│   │   │   ├── sentence.py        # F03: 长难句分析
│   │   │   ├── summary.py         # F05: 段落总结
│   │   │   └── wordbook.py        # F07: 生词本与复习
│   │   └── deps.py                # 依赖注入
│   ├── services/                  # 业务逻辑层
│   │   ├── pdf_service.py         # PDF解析服务
│   │   ├── ocr_engine.py          # PaddleOCR封装
│   │   ├── ai_service.py          # DeepSeek API封装
│   │   ├── vocabulary_service.py  # 词汇服务
│   │   ├── sentence_service.py    # 长难句服务
│   │   ├── summary_service.py     # 段落总结服务
│   │   ├── review_service.py      # 复习调度服务
│   │   └── export_service.py      # 文档导出服务
│   ├── models/                    # 数据模型
│   ├── schemas/                   # Pydantic 模型
│   ├── tasks/                     # Celery 异步任务
│   │   ├── pdf_tasks.py
│   │   ├── ai_tasks.py
│   │   └── export_tasks.py
│   └── utils/                     # 工具函数
├── alembic/                       # 数据库迁移
├── tests/                         # 测试
└── requirements.txt
```

### 3.2 F01：PDF导入与正文提取模块

**职责**：接收PDF文件 → 版面分析 → 正文提取 → 非正文过滤 → 结构化输出

**核心类设计**：

```python
# app/services/ocr_engine.py
class OCREngine:
    """PaddleOCR 3.0 封装，负责PDF版面分析与文本提取"""
    
    def __init__(self, model_path: str):
        self.engine = PaddleOCR(
            use_angle_cls=True,
            lang="en",
            layout=True,           # 版面分析
            table=True,            # 表格识别
            show_log=False
        )
    
    def parse_pdf(self, pdf_path: str) -> ParsedDocument:
        """
        解析PDF，返回结构化文档
        1. 版面分析：识别文本块类型（正文/标题/页眉/页脚/广告/图片）
        2. 文本提取：OCR识别每个文本块
        3. 结构化：按阅读顺序重组段落
        4. 过滤：排除非正文区域
        """
        pass

# app/services/pdf_service.py
class PDFService:
    """PDF处理业务逻辑"""
    
    async def upload_and_parse(self, file: UploadFile) -> str:
        """
        上传PDF并启动异步解析任务
        返回: task_id
        """
        # 1. 校验文件（格式、大小≤50MB）
        # 2. 保存到临时目录
        # 3. 启动Celery异步任务
        # 4. 返回task_id供前端轮询
        pass
    
    def filter_non_content(self, blocks: List[TextBlock]) -> List[TextBlock]:
        """
        过滤非正文区域
        规则：
        - 排除版面类型为 header/footer/advertisement/page_number 的块
        - 排除重复出现的页眉页脚（跨页比对）
        - 排除纯图片块
        """
        pass
    
    def reconstruct_paragraphs(self, blocks: List[TextBlock]) -> List[Paragraph]:
        """
        按阅读顺序重组段落
        - 双栏排版：先左栏后右栏
        - 跨页段落合并
        - 断词连字符修复（如 "exam-\nple" → "example"）
        """
        pass
```

**异步任务流程**：

```
[前端] 上传PDF
    ↓
[API] POST /api/v1/pdf/upload → 返回 task_id
    ↓
[Celery Worker] pdf_parse_task(task_id)
    ├── 1. PaddleOCR 版面分析（10-30秒）
    ├── 2. 文本块类型分类
    ├── 3. 非正文过滤
    ├── 4. 段落重组与清洗
    ├── 5. 结果存入PostgreSQL (documents表)
    └── 6. 更新任务状态 → completed
    ↓
[前端] GET /api/v1/pdf/status/{task_id} 轮询
    ↓ (status=completed)
[前端] GET /api/v1/pdf/result/{task_id} → 正文预览
```

### 3.3 F02：生词点查与难度标注模块

**职责**：点击单词 ≤300ms 返回释义 + 难度等级

**核心设计**：本地词典优先，保证响应速度

```python
# app/services/vocabulary_service.py
class VocabularyService:
    """词汇查询与教学服务"""
    
    def __init__(self):
        self.ecdict = ECDICTLoader()     # 本地加载ECDICT SQLite
        self.coca_freq = COCAFreqLoader() # 本地加载COCA词频数据
    
    async def lookup_word(self, word: str, context: str = "") -> WordLookup:
        """
        本地查词，≤300ms响应
        1. ECDICT查释义、词性、音标
        2. COCA词频匹配难度等级（CET4/CET6/考研/雅思/托福）
        3. 返回结构化结果
        """
        # 本地SQLite查询，无需网络请求
        definition = self.ecdict.lookup(word)
        level = self.coca_freq.get_level(word)
        return WordLookup(
            word=word,
            phonetic=definition.phonetic,
            pos=definition.pos,
            translation=definition.translation,
            difficulty_level=level,  # CET4/CET6/考研/雅思/托福
            context_hint=context     # 上下文提示（为F04深度教学准备）
        )
```

**难度分级映射规则**：

```python
# COCA词频 → 考试难度等级映射
DIFFICULTY_MAP = {
    "top_3000": "CET4",      # 高频词 → 四级
    "top_6000": "CET6",      # 中频词 → 六级
    "top_10000": "考研",      # 中低频 → 考研
    "top_20000": "雅思托福",   # 低频学术 → 雅思/托福
    "beyond": "GRE",          # 超低频 → GRE/专业词汇
}
```

### 3.4 F03：长难句AI结构拆解模块

**职责**：识别长难句 → AI拆解语法结构 → 结构化JSON → 前端D3.js渲染

**核心设计**：

```python
# app/services/sentence_service.py
class SentenceService:
    """长难句分析与拆解服务"""
    
    def __init__(self, ai_service: AIService, nlp):
        self.ai = ai_service          # DeepSeek V3 API
        self.nlp = nlp                # spaCy 英文模型
    
    async def identify_complex_sentences(self, text: str) -> List[SentenceInfo]:
        """
        初步筛选长难句（本地spaCy分析，快速）
        规则：
        - 句子长度 ≥ 25词
        - 含2个及以上从句标记词（that/which/who/where/when/although/because等）
        - 含非谓语动词短语作修饰成分
        - 含倒装/强调/省略等特殊句式
        """
        doc = self.nlp(text)
        candidates = []
        for sent in doc.sents:
            score = self._complexity_score(sent)
            if score >= THRESHOLD:
                candidates.append(SentenceInfo(
                    text=sent.text,
                    position=sent.start_char,
                    complexity_score=score
                ))
        # 按复杂度排序，取Top N
        return sorted(candidates, key=lambda x: -x.complexity_score)[:8]
    
    async def analyze_sentence(self, sentence: str, context: str = "") -> SentenceAnalysis:
        """
        调用DeepSeek V3进行深度语法拆解
        返回结构化JSON：原句、结构拆解、语法讲解、翻译
        """
        prompt = self._build_analysis_prompt(sentence, context)
        result = await self.ai.chat_complete(prompt, response_format="json")
        return SentenceAnalysis.model_validate_json(result)
    
    def _build_analysis_prompt(self, sentence: str, context: str) -> str:
        return f"""You are an expert English grammar teacher. Analyze the following complex sentence and provide a structured analysis.

Sentence: "{sentence}"
Context: "{context}"

Return a JSON object with this exact structure:
{{
  "original": "the original sentence",
  "structure": {{
    "main_clause": "主句部分（英文原文）",
    "subordinate_clauses": [
      {{
        "type": "定语从句/状语从句/名词性从句/同位语从句",
        "text": "从句原文",
        "function": "修饰对象/语法功能"
      }}
    ],
    "modifiers": [
      {{
        "type": "现在分词/过去分词/不定式/介词短语",
        "text": "修饰语原文",
        "target": "修饰对象"
      }}
    ]
  }},
  "grammar_explanation": "≥3句话的中文语法讲解，解释关键语法点",
  "translation": "整句通顺的中文翻译"
}}"""
```

**前端D3.js语法树渲染**：

```typescript
// frontend/src/components/sentence/GrammarTree.tsx
interface SyntaxNode {
  id: string;
  label: string;        // 文本片段
  type: 'main' | 'subordinate' | 'modifier';
  clauseType?: string;  // 定语从句/状语从句等
  children: SyntaxNode[];
}

// D3.js 层级树布局
// - 主句为根节点（蓝色）
// - 从句为子节点（绿色，标注从句类型）
// - 修饰语为叶子节点（橙色，标注修饰对象）
// - 点击节点高亮原文对应文字（双向联动）
```

### 3.5 F04：词汇深度教学模块

**职责**：基于上下文生成6区教学卡片

```python
# app/services/vocabulary_service.py (续)
class VocabularyService:
    
    async def deep_teach(self, word: str, context: str) -> VocabularyTeaching:
        """
        调用DeepSeek V3生成词汇深度教学卡片
        6个区域：语境释义、用法示例、常见搭配、词族词根、考试考点、对比辨析
        """
        prompt = f"""You are an expert English vocabulary teacher. Provide a comprehensive analysis of the word "{word}" as used in the following context.

Context: "{context}"

Return a JSON object:
{{
  "word": "{word}",
  "contextual_meaning": "该词在本文特定语境下的含义和用法（≥2句中文）",
  "usage_examples": [
    {{"en": "例句1（不同语境）", "zh": "中文翻译"}},
    {{"en": "例句2", "zh": "中文翻译"}},
    {{"en": "例句3", "zh": "中文翻译"}}
  ],
  "collocations": ["常见搭配1", "常见搭配2", "常见搭配3"],
  "word_family": "词族词根分析（如词根、派生词）",
  "exam_points": "考研/雅思/托福中的考查重点和常见考法",
  "comparison": "与近义词的对比辨析"
}}"""
        result = await self.ai.chat_complete(prompt, response_format="json")
        return VocabularyTeaching.model_validate_json(result)
```

### 3.6 F05：段落总结模块

**职责**：AI生成每段大意 + 全文主旨

```python
# app/services/summary_service.py
class SummaryService:
    
    async def summarize_paragraphs(self, paragraphs: List[str]) -> ParagraphSummary:
        """
        段落级总结 + 全文主旨概括
        """
        prompt = f"""请对以下英文文章进行结构化总结。

文章内容（分段）：
{chr(10).join(f"[段落{i+1}] {p}" for i, p in enumerate(paragraphs))}

返回JSON：
{{
  "paragraph_summaries": [
    {{"index": 1, "summary": "段落1大意（中文，1-2句）"}},
    ...
  ],
  "main_idea": "全文主旨概括（中文，2-3句）"
}}"""
        result = await self.ai.chat_complete(prompt, response_format="json")
        return ParagraphSummary.model_validate_json(result)
```

### 3.7 F07：生词本与复习模块

**职责**：生词收录 + SM-2间隔重复调度 + 语境挖空复习

```python
# app/services/review_service.py
class ReviewService:
    """生词本与SM-2复习调度"""
    
    def calculate_next_review(self, word_id: str, quality: int) -> ReviewSchedule:
        """
        SM-2算法实现
        quality: 0-5 评分（0=完全不认识, 5=完美记住）
        
        SM-2核心公式：
        - 如果 quality < 3: 重复次数归零，间隔=1天
        - 否则:
          - 第1次: 间隔=1天
          - 第2次: 间隔=6天
          - 第n次: 间隔 = 上次间隔 × EF (easiness factor)
          - EF = EF + (0.1 - (5-q)×(0.08+(5-q)×0.02))
          - EF 最小值 = 1.3
        """
        record = self.get_review_record(word_id)
        
        if quality < 3:
            record.repetitions = 0
            record.interval = 1
        else:
            if record.repetitions == 0:
                record.interval = 1
            elif record.repetitions == 1:
                record.interval = 6
            else:
                record.interval = round(record.interval * record.ef)
            
            record.repetitions += 1
            record.ef = max(1.3, record.ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)))
        
        record.next_review = date.today() + timedelta(days=record.interval)
        self.save_review_record(record)
        return ReviewSchedule(
            next_review=record.next_review,
            interval=record.interval,
            ef=record.ef
        )
    
    def generate_cloze_card(self, word_id: str) -> ClozeCard:
        """
        生成语境挖空卡片
        从生词的语境原句中挖空目标词，提供选项
        """
        record = self.get_word_record(word_id)
        original_sentence = record.context_sentence
        # 用同难度等级的其他生词作为干扰项
        distractors = self.get_distractors(record.difficulty_level, exclude=word_id, count=3)
        
        return ClozeCard(
            cloze_sentence=original_sentence.replace(record.word, "_____"),
            answer=record.word,
            options=shuffle([record.word] + distractors)
        )
```

---

## 4. 数据模型设计

### 4.1 ER图概览

```
documents (1) ──── (N) paragraphs
documents (1) ──── (N) sentences_analysis
documents (1) ──── (1) summaries
users (1) ──── (N) wordbook_entries
wordbook_entries (1) ──── (N) review_records
documents (1) ──── (N) wordbook_entries
```

### 4.2 核心表结构

```sql
-- 文档表：存储PDF解析结果
CREATE TABLE documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           VARCHAR(500),           -- 文章标题
    source          VARCHAR(200),           -- 来源刊物（如能识别）
    original_text   TEXT NOT NULL,          -- 提取的正文全文
    paragraph_count INTEGER,                -- 段落数
    word_count      INTEGER,                -- 总词数
    file_path       VARCHAR(500),           -- 原PDF文件路径
    parse_status    VARCHAR(20) DEFAULT 'pending',  -- pending/processing/completed/failed
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- 段落表：按段落存储，支持段落级操作
CREATE TABLE paragraphs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    index       INTEGER NOT NULL,           -- 段落序号（从0开始）
    text_en     TEXT NOT NULL,              -- 英文原文
    text_zh     TEXT,                       -- 中文翻译（F02翻译结果）
    summary     TEXT,                       -- 段落大意（F05）
    created_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE(document_id, index)
);

-- 长难句分析表
CREATE TABLE sentence_analyses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    paragraph_index INTEGER,                -- 所在段落
    original        TEXT NOT NULL,          -- 原句
    structure       JSONB NOT NULL,         -- 结构拆解（JSON）
    grammar_explain TEXT,                   -- 语法讲解
    translation     TEXT,                   -- 中文翻译
    complexity_score FLOAT,                 -- 复杂度评分
    created_at      TIMESTAMP DEFAULT NOW()
);

-- 段落/全文总结表
CREATE TABLE document_summaries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    paragraph_summaries JSONB NOT NULL,     -- 各段大意 [{index, summary}]
    main_idea       TEXT NOT NULL,          -- 全文主旨
    created_at      TIMESTAMP DEFAULT NOW()
);

-- 用户表（MVP可选，预留扩展）
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       VARCHAR(200) UNIQUE,        -- 邮箱（未来登录用）
    nickname    VARCHAR(100),
    created_at  TIMESTAMP DEFAULT NOW()
);

-- 生词本
CREATE TABLE wordbook_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id),     -- 可空（匿名用户用session）
    document_id     UUID REFERENCES documents(id),
    word            VARCHAR(200) NOT NULL,         -- 单词/词组
    pos             VARCHAR(50),                   -- 词性
    phonetic        VARCHAR(100),                  -- 音标
    translation     TEXT,                          -- 中文释义
    difficulty_level VARCHAR(20),                  -- CET4/CET6/考研/雅思/托福/GRE
    context_sentence TEXT,                         -- 语境原句
    teaching_data   JSONB,                         -- F04深度教学数据
    created_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, word)
);
CREATE INDEX idx_wordbook_user ON wordbook_entries(user_id);
CREATE INDEX idx_wordbook_level ON wordbook_entries(difficulty_level);

-- 复习记录表（SM-2）
CREATE TABLE review_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wordbook_entry_id UUID NOT NULL REFERENCES wordbook_entries(id) ON DELETE CASCADE,
    repetitions      INTEGER DEFAULT 0,            -- 重复次数
    interval_days    INTEGER DEFAULT 0,            -- 当前间隔（天）
    easiness_factor  FLOAT DEFAULT 2.5,            -- EF值（初始2.5）
    last_review      TIMESTAMP,                    -- 上次复习时间
    next_review      DATE NOT NULL,                -- 下次复习日期
    last_quality     INTEGER,                      -- 上次评分(0-5)
    created_at       TIMESTAMP DEFAULT NOW(),
    updated_at       TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_review_next ON review_records(next_review);

-- AI结果缓存表（避免重复调用API）
CREATE TABLE ai_cache (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_key   VARCHAR(500) NOT NULL UNIQUE,     -- hash(prompt + model)
    result      JSONB NOT NULL,
    model       VARCHAR(50),
    created_at  TIMESTAMP DEFAULT NOW(),
    expires_at  TIMESTAMP                          -- 过期时间
);
CREATE INDEX idx_cache_key ON ai_cache(cache_key);
```

---

## 5. API设计

### 5.1 API总览

所有API以 `/api/v1` 为前缀，返回JSON格式，统一响应结构：

```json
{
  "code": 0,           // 0=成功, 非0=错误码
  "message": "success",
  "data": { ... }
}
```

### 5.2 F01：PDF上传与解析

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 上传PDF | POST | `/api/v1/pdf/upload` | 上传PDF，返回task_id |
| 查询状态 | GET | `/api/v1/pdf/status/{task_id}` | 轮询解析状态 |
| 获取结果 | GET | `/api/v1/pdf/result/{task_id}` | 获取解析后的正文 |

**POST /api/v1/pdf/upload**

```
Request: multipart/form-data
  - file: PDF文件 (≤50MB)

Response:
{
  "code": 0,
  "data": {
    "task_id": "uuid-xxx",
    "status": "processing"
  }
}
```

**GET /api/v1/pdf/status/{task_id}**

```
Response:
{
  "code": 0,
  "data": {
    "task_id": "uuid-xxx",
    "status": "completed",       // pending/processing/completed/failed
    "progress": 100,             // 0-100
    "error": null                // 失败时的错误信息
  }
}
```

**GET /api/v1/pdf/result/{task_id}**

```
Response:
{
  "code": 0,
  "data": {
    "document_id": "uuid-xxx",
    "title": "The Future of AI",
    "source": "The Economist",
    "paragraphs": [
      {"index": 0, "text": "Paragraph 1 text..."},
      {"index": 1, "text": "Paragraph 2 text..."}
    ],
    "word_count": 3200,
    "paragraph_count": 12
  }
}
```

### 5.3 F02/F04：词汇查词与深度教学

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 即时查词 | GET | `/api/v1/vocab/lookup` | 本地词典查词 ≤300ms |
| 深度教学 | POST | `/api/v1/vocab/teach` | AI生成教学卡片 ≤3s |

**GET /api/v1/vocab/lookup?word=resilience&context=...**

```
Response:
{
  "code": 0,
  "data": {
    "word": "resilience",
    "phonetic": "/rɪˈzɪliəns/",
    "pos": "n.",
    "translation": "恢复力；韧性；弹性",
    "difficulty_level": "考研",
    "definition_en": "the capacity to recover quickly from difficulties"
  }
}
```

**POST /api/v1/vocab/teach**

```
Request:
{
  "word": "resilience",
  "context": "The resilience of the economy surprised analysts."
}

Response:
{
  "code": 0,
  "data": {
    "word": "resilience",
    "contextual_meaning": "在此语境中指经济的恢复力，即经济在遭受冲击后迅速恢复的能力...",
    "usage_examples": [
      {"en": "Children show remarkable resilience.", "zh": "孩子们表现出惊人的恢复力。"},
      ...
    ],
    "collocations": ["build resilience", "show resilience", "economic resilience"],
    "word_family": "词根: salire (跳跃) → resilient (adj.) → resilience (n.)",
    "exam_points": "考研中常考"恢复力"义，注意与toughness区分...",
    "comparison": "resilience vs toughness: resilience强调恢复能力，toughness强调承受能力"
  }
}
```

### 5.4 F03：长难句分析

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 识别长难句 | POST | `/api/v1/sentence/identify` | 本地spaCy初筛 |
| 拆解长难句 | POST | `/api/v1/sentence/analyze` | AI深度拆解 ≤5s |

**POST /api/v1/sentence/analyze**

```
Request:
{
  "sentence": "The report, which was compiled by researchers who spent three years analyzing data from over 50 countries, suggests that climate change poses a greater threat than previously estimated.",
  "context": "Paragraph 3 of the article"
}

Response:
{
  "code": 0,
  "data": {
    "original": "The report, which was compiled...",
    "structure": {
      "main_clause": "The report suggests that climate change poses a greater threat",
      "subordinate_clauses": [
        {
          "type": "非限制性定语从句",
          "text": "which was compiled by researchers",
          "function": "修饰The report"
        },
        {
          "type": "限制性定语从句",
          "text": "who spent three years analyzing data from over 50 countries",
          "function": "修饰researchers"
        },
        {
          "type": "宾语从句",
          "text": "that climate change poses a greater threat than previously estimated",
          "function": "作suggests的宾语"
        }
      ],
      "modifiers": [
        {
          "type": "介词短语",
          "text": "from over 50 countries",
          "target": "data"
        }
      ]
    },
    "grammar_explanation": "本句为多层嵌套复合句。主句为The report suggests...，其中包含三个从句...",
    "translation": "这份报告由花了三年时间分析50多个国家数据的研究人员编写，指出气候变化构成的威胁比此前估计的更大。"
  }
}
```

### 5.5 F05：段落总结

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 生成总结 | POST | `/api/v1/summary/generate` | AI生成段落+全文总结 ≤10s |

### 5.6 F07：生词本与复习

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 添加生词 | POST | `/api/v1/wordbook/add` | 收录生词+语境 |
| 生词列表 | GET | `/api/v1/wordbook/list` | 分页查询 |
| 今日待复习 | GET | `/api/v1/wordbook/review/today` | SM-2调度 |
| 提交复习结果 | POST | `/api/v1/wordbook/review/submit` | 更新SM-2参数 |
| 获取挖空卡片 | GET | `/api/v1/wordbook/review/cloze/{word_id}` | 语境挖空 |

---

## 6. AI服务管线设计

### 6.1 DeepSeek V3 API封装

```python
# app/services/ai_service.py
import httpx
from typing import AsyncGenerator

class AIService:
    """DeepSeek V3 API 封装"""
    
    def __init__(self, api_key: str, base_url: str, model: str = "deepseek-chat"):
        self.client = httpx.AsyncClient(
            base_url=base_url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30.0
        )
        self.model = model
    
    async def chat_complete(
        self, 
        prompt: str, 
        response_format: str = "text",
        temperature: float = 0.3,    # 低温度保证输出稳定
        max_tokens: int = 2000
    ) -> str:
        """
        调用DeepSeek V3 Chat API
        - temperature=0.3: 语法分析需要确定性输出
        - response_format="json": 需要结构化输出时使用
        """
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": temperature,
            "max_tokens": max_tokens
        }
        
        if response_format == "json":
            payload["response_format"] = {"type": "json_object"}
        
        # 先查缓存
        cache_key = self._cache_key(prompt, model)
        cached = await self._get_cache(cache_key)
        if cached:
            return cached
        
        response = await self.client.post("/v1/chat/completions", json=payload)
        result = response.json()["choices"][0]["message"]["content"]
        
        # 写入缓存（24小时过期）
        await self._set_cache(cache_key, result, ttl=86400)
        
        return result
    
    def _cache_key(self, prompt: str, model: str) -> str:
        """生成缓存key: md5(prompt + model)"""
        import hashlib
        return hashlib.md5(f"{prompt}:{model}".encode()).hexdigest()
```

### 6.2 AI调用管线全景

```
                    ┌──────────────────┐
                    │  用户点击「开始   │
                    │  精读分析」      │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌────────────┐ ┌──────────────┐ ┌────────────┐
     │ F02翻译    │ │ F03词汇分析  │ │ F04长难句  │
     │ (DeepSeek  │ │ (DeepSeek    │ │ (spaCy初筛 │
     │  V3 API)   │ │  V3 + COCA)  │ │  + DeepSeek│
     │            │ │              │ │  V3拆解)   │
     └─────┬──────┘ └──────┬───────┘ └─────┬──────┘
           │               │               │
           │     并行执行（asyncio.gather）
           │               │               │
           ▼               ▼               ▼
     ┌────────────┐ ┌──────────────┐ ┌────────────┐
     │段落级翻译   │ │ 8-15个词汇   │ │ 3-8个长难句│
     │存paragraphs│ │ JSON结构化   │ │ JSON结构化 │
     │.text_zh    │ │ 存vocab表    │ │ 存sentence │
     └────────────┘ └──────────────┘ └────────────┘
                             │
                    ┌────────┴─────────┐
                    │  F05段落总结     │
                    │  (DeepSeek V3)   │
                    │  依赖F02翻译完成 │
                    └──────────────────┘
```

### 6.3 Prompt工程关键策略

| 功能 | Prompt策略 | 关键参数 |
|------|-----------|---------|
| 翻译(F02) | 提供文章标题+来源，提升术语一致性 | temp=0.3, json格式 |
| 词汇挑选(F03) | 注入COCA词频参考，要求按教学价值排序 | temp=0.2, json格式 |
| 词汇教学(F04) | 必须包含原文语境，要求6区完整输出 | temp=0.4, json格式 |
| 长难句拆解(F03) | 提供全文上下文，要求标注从句类型和修饰关系 | temp=0.2, json格式 |
| 段落总结(F05) | 按段落编号输入，要求主旨+各段大意 | temp=0.3, json格式 |

### 6.4 成本控制策略

```python
# 成本估算（DeepSeek V3定价）
# 输入: ¥0.001/千tokens, 输出: ¥0.002/千tokens
# 单篇3000词文章约: 输入~5000 tokens, 输出~3000 tokens
# 单篇AI成本 ≈ ¥0.001×5 + ¥0.002×3 = ¥0.011
# 加上缓存命中率60%: 实际成本 ≈ ¥0.005/篇

COST_CONTROL = {
    "cache_ttl_seconds": 86400,        # AI结果缓存24小时
    "max_tokens_per_request": 2000,    # 单次请求token上限
    "batch_paragraphs": True,          # 段落批量翻译（减少API调用次数）
    "free_user_daily_limit": 3,        # 免费用户每日3篇
    "pro_user_monthly_limit": 100,     # Pro用户每月100篇
}
```

---

## 7. 前端架构

### 7.1 页面路由

```
/                       → 首页（PDF上传入口）
/document/:id           → 阅读器主界面（正文展示+交互）
/document/:id/sentence/:sid → 长难句拆解详情（弹窗/侧栏）
/wordbook               → 生词本
/wordbook/review        → 复习页面
```

### 7.2 核心组件树

```
<App>
├── <HomePage>                      # 首页
│   ├── <PDFUploader />             # 拖拽上传组件
│   └── <RecentDocuments />         # 最近处理
│
├── <ReaderPage>                    # 阅读器主界面
│   ├── <DocumentHeader />          # 标题+来源+操作栏
│   ├── <ArticleView>               # 正文展示区
│   │   ├── <ParagraphBlock>        # 单段落
│   │   │   ├── <WordToken>         # 可点击单词
│   │   │   │   └── <WordPopover>   # 释义气泡(F02)
│   │   │   ├── <SentenceMarker>    # 长难句标记
│   │   │   └── <ParagraphSummary>  # 段落大意(F05,可折叠)
│   │   └── <TranslationToggle>     # 翻译显示/隐藏
│   ├── <SentenceAnalysisPanel>     # 长难句分析面板(F03)
│   │   ├── <GrammarTree />         # D3.js语法树
│   │   ├── <StructureBreakdown />  # 结构拆解文本
│   │   └── <GrammarExplain />      # 语法讲解
│   ├── <VocabTeachingModal>        # 词汇教学卡片(F04)
│   │   ├── <ContextualMeaning />
│   │   ├── <UsageExamples />
│   │   ├── <Collocations />
│   │   ├── <WordFamily />
│   │   ├── <ExamPoints />
│   │   └── <Comparison />
│   └── <SummaryPanel>              # 全文主旨(F05)
│
├── <WordbookPage>                  # 生词本
│   ├── <WordList />                # 生词列表
│   └── <ReviewPage>                # 复习
│       ├── <ClozeCard />           # 挖空卡片
│       └── <ReviewStats />         # 复习统计
│
└── <GlobalComponents>
    ├── <ProcessingModal />         # AI处理进度
    └── <Toast />                   # 通知
```

### 7.3 关键交互实现

**单词点击查词（F02）**：

```typescript
// frontend/src/hooks/useWordLookup.ts
function useWordLookup() {
  const [popup, setPopup] = useState<WordPopup | null>(null);
  
  const handleWordClick = async (word: string, context: string, rect: DOMRect) => {
    // 先显示loading状态
    setPopup({ word, loading: true, position: rect });
    
    // 调用本地查词API（≤300ms）
    const result = await api.get('/vocab/lookup', { params: { word, context } });
    setPopup({ ...result.data, loading: false, position: rect });
  };
  
  return { popup, handleWordClick };
}
```

**长难句语法树渲染（F03）**：

```typescript
// frontend/src/components/sentence/GrammarTree.tsx
import * as d3 from 'd3';

function GrammarTree({ analysis }: { analysis: SentenceAnalysis }) {
  const svgRef = useRef<SVGSVGElement>(null);
  
  useEffect(() => {
    // 将结构化JSON转为D3层级数据
    const root = buildHierarchy(analysis.structure);
    
    // D3 tree布局
    const treeLayout = d3.tree().nodeSize([120, 200]);
    const treeData = treeLayout(d3.hierarchy(root));
    
    // 渲染节点和连线
    renderNodes(svgRef.current, treeData);
    renderLinks(svgRef.current, treeData);
    
    // 节点点击：高亮原文对应文字（双向联动）
    d3.selectAll('.node').on('click', (event, d) => {
      highlightOriginalText(d.data.text);
    });
  }, [analysis]);
  
  return <svg ref={svgRef} width="100%" height="300" />;
}
```

---

## 8. 部署架构

### 8.1 Docker Compose编排（MVP）

```yaml
# docker-compose.yml
version: '3.8'

services:
  # 前端
  frontend:
    build: ./frontend
    ports: ["3000:80"]           # Nginx托管静态资源
    depends_on: [backend]
  
  # 后端API
  backend:
    build: ./backend
    ports: ["8000:8000"]
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/pdfreader
      - REDIS_URL=redis://redis:6379/0
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}
      - PADDLEOCR_MODEL_PATH=/models/paddleocr
    volumes:
      - ./uploads:/app/uploads     # PDF临时文件
      - ./models:/models           # PaddleOCR模型
    depends_on: [db, redis]
  
  # Celery Worker（异步任务）
  celery_worker:
    build: ./backend
    command: celery -A app.tasks worker -l info -c 2
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/pdfreader
      - REDIS_URL=redis://redis:6379/0
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}
    volumes:
      - ./uploads:/app/uploads
      - ./models:/models
    depends_on: [backend, redis]
  
  # PostgreSQL
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: pdfreader
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports: ["5432:5432"]
  
  # Redis
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  
  # Nginx（反向代理）
  nginx:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on: [frontend, backend]

volumes:
  pgdata:
```

### 8.2 服务器配置建议（MVP）

| 资源 | 最低配置 | 推荐配置 | 说明 |
|------|---------|---------|------|
| CPU | 4核 | 8核 | PaddleOCR推理需要CPU |
| 内存 | 8GB | 16GB | PaddleOCR模型加载+Redis+PostgreSQL |
| 磁盘 | 50GB SSD | 100GB SSD | 模型文件+PDF临时文件+数据库 |
| 带宽 | 5Mbps | 10Mbps | PDF上传+API响应 |
| GPU | 不需要 | 不需要 | PaddleOCR CPU模式足够（MVP） |

> 注：PaddleOCR 3.0 CPU模式对标准外刊PDF的处理速度约为2-5秒/页，20页PDF约40-100秒，满足≤60秒/20页的目标需优化（可考虑GPU加速或预处理）。

---

## 9. 性能设计

### 9.1 响应时间目标

| 操作 | 目标 | 策略 |
|------|------|------|
| 单词查词(F02) | ≤300ms | ECDICT本地SQLite，无网络请求 |
| 词汇教学(F04) | ≤3s | DeepSeek API + 结果缓存 |
| 长难句拆解(F03) | ≤5s | spaCy本地初筛 + DeepSeek API |
| 段落总结(F05) | ≤10s | 批量段落+全文一次请求 |
| PDF解析(F01) | ≤60s/20页 | Celery异步 + PaddleOCR |
| 全流程(上传→导出) | ≤5分钟 | 并行AI任务(asyncio.gather) |

### 9.2 缓存策略

```
┌─────────────────────────────────────────────┐
│              缓存层级                        │
├─────────────────────────────────────────────┤
│ L1: 浏览器缓存 (前端)                       │
│   - 词典查询结果: sessionStorage (5分钟)     │
│   - 文档正文: IndexedDB (本地持久化)         │
│                                             │
│ L2: Redis缓存 (后端)                        │
│   - AI结果缓存: 24小时 (md5(prompt+model))  │
│   - 词典热词: LRU缓存 (10000条)             │
│   - 会话状态: 30分钟过期                     │
│                                             │
│ L3: PostgreSQL ai_cache表                   │
│   - AI结果持久化缓存: 7天过期                │
│   - 避免重复API调用                          │
└─────────────────────────────────────────────┘
```

### 9.3 异步任务设计

```python
# app/tasks/ai_tasks.py
from celery import Celery, group

app = Celery('pdfreader', broker='redis://redis:6379/0')

@app.task
def parse_pdf_task(task_id: str, file_path: str):
    """F01: PDF解析（耗时10-60秒）"""
    engine = OCREngine()
    result = engine.parse_pdf(file_path)
    save_to_db(task_id, result)
    return {"status": "completed", "document_id": result.id}

@app.task
def analyze_document_task(document_id: str):
    """
    F02+F03+F04+F05 并行分析
    用户点击「开始精读分析」后触发
    """
    document = get_document(document_id)
    
    # 三个AI任务并行执行
    job = group(
        translate_task.s(document_id),          # F02翻译
        analyze_vocabulary_task.s(document_id),  # F03词汇
        analyze_sentences_task.s(document_id),   # F04长难句
    )
    result = job.apply_async()
    
    # 等待全部完成
    result.get()  # F02/F03/F04完成
    
    # F05段落总结依赖翻译完成
    summarize_task.delay(document_id)  # F05异步
    
    return {"status": "completed"}
```

---

## 10. 安全设计

### 10.1 文件上传安全

```python
# 文件类型校验
ALLOWED_MIME_TYPES = {"application/pdf"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

# 安全措施：
# 1. 校验Magic Number（文件头），不仅依赖扩展名
# 2. 文件名脱敏（去除路径穿越字符）
# 3. 上传目录隔离（不可执行权限）
# 4. 文件大小限制
# 5. 病毒扫描（可选，ClamAV）
```

### 10.2 API安全

| 措施 | 实现 |
|------|------|
| HTTPS | Nginx配置SSL证书，强制HTTPS |
| CORS | 仅允许前端域名 |
| 速率限制 | Redis + slowapi，免费用户10次/分钟 |
| 输入校验 | Pydantic模型校验所有请求体 |
| SQL注入防护 | SQLAlchemy参数化查询 |
| XSS防护 | 前端React自动转义 + CSP头 |

### 10.3 数据安全

- PDF文件上传后存储在隔离目录，不直接暴露给外部访问
- AI API Key存储在环境变量，不写入代码
- 用户数据（生词本）按用户隔离，MVP阶段用session_id关联
- 定期清理过期临时文件（cron job，每日清理7天前的PDF）

---

## 11. 技术风险与缓解

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|---------|
| **PaddleOCR对外刊多栏排版准确率不足** | 高 | 高 | W1-W2技术验证；MinerU备选；先支持3-5种主流外刊格式 |
| **DeepSeek API响应延迟过高** | 中 | 高 | 结果缓存；异步处理+进度展示；超时30s降级提示 |
| **AI输出JSON格式不稳定** | 中 | 中 | response_format=json_object；JSON Schema校验；解析失败重试1次 |
| **PaddleOCR CPU推理速度慢** | 中 | 中 | 预处理排队；后续可加GPU；限制并发解析数 |
| **API成本超预期** | 低 | 中 | 多级缓存（Redis+DB）；免费用户限额；监控单用户成本 |
| **spaCy长难句初筛误判** | 低 | 低 | 初筛仅作候选，AI最终决定；可调阈值参数 |

---

## 12. 开发规范

### 12.1 代码规范

| 项目 | 工具 | 配置 |
|------|------|------|
| Python代码风格 | Ruff | 行长100, import排序 |
| TypeScript代码风格 | ESLint + Prettier | Airbnb config |
| Git提交规范 | Conventional Commits | feat/fix/docs/refactor |
| API文档 | FastAPI自动生成 | /docs (Swagger UI) |
| 测试 | pytest (后端) + Vitest (前端) | 覆盖率>70% |

### 12.2 环境管理

```
.env                    # 本地开发环境变量
.env.staging            # 预发布环境
.env.production         # 生产环境
docker-compose.yml      # 本地开发
docker-compose.prod.yml # 生产部署
```

### 12.3 CI/CD流程

```
GitHub Push
    ↓
GitHub Actions
    ├── lint (ruff + eslint)
    ├── test (pytest + vitest)
    ├── build (docker build)
    └── deploy (条件触发: main分支)
        ├── staging: 自动部署到预发布
        └── production: 手动确认后部署
```

---

## 13. 后续扩展预留

虽然MVP不实现以下功能，但架构设计已预留扩展点：

| 扩展方向 | 预留设计 |
|---------|---------|
| 用户账号体系 | users表已设计，API层预留user_id注入 |
| 付费订阅 | 速率限制中间件已设计，可接入支付后调整限额 |
| 移动端 | API无状态设计，前端可独立开发移动端 |
| 教师批量处理 | Celery任务可扩展为批量模式 |
| 内置资源库 | documents表可标记source=internal/external |
| 多语言 | AI Prompt可参数化目标语言 |

---

## 📚 关联文档

- 产品需求文档（PRD）：`deliverables/product-strategy/PRD.md`
- 市场调研报告：`deliverables/product-strategy/competitive-analysis-pdf-reader-2026-07-15.md`

---

> 本技术设计文档基于PRD v1.0编写，覆盖MVP（V1.0）全部6项P0功能的技术实现方案。开发过程中如有架构调整，请同步更新本文档。
