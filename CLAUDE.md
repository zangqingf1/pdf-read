# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

PDF 外刊阅读工具 — 上传英文 PDF，自动提取正文内容，支持 AI 翻译、单词解析和长难句语法分析。

## 开发命令

```bash
# 后端
cd backend
pip install -r requirements.txt          # 安装依赖
uvicorn app.main:app --reload --port 8000 # 启动开发服务器 (SQLite 模式)

# 前端
cd frontend
npm install --legacy-peer-deps            # 安装依赖
npm run dev                               # 启动 Vite 开发服务器 (端口 5173)
npm run build                             # 生产构建

# Docker Compose 全栈启动
cp .env.example .env                      # 编辑 .env 填入 DeepSeek API Key
docker-compose up -d                      # 前端 :80, API :8000, /docs Swagger UI

# 性能测试
cd backend && python test_word_timing.py  # 单词解析 API 耗时测试 (1/5/7 词)
cd frontend && node bench_store.mjs       # 前端 store 更新微基准
```

## 架构核心

### 后端分层 (FastAPI + SQLAlchemy)

```
api/v1/        → 路由层 (pdf.py PDF解析, translate.py AI翻译+单词解析+句子分析)
services/      → 业务逻辑层 (pdf_service.py PDF解析编排, ocr_engine.py OCR引擎, ai_service.py DeepSeek API)
models/        → SQLAlchemy ORM 模型 (Document, Paragraph, User)
schemas/       → Pydantic 请求/响应模型 (pdf.py, translate.py)
tasks/         → Celery 异步任务 (celery_app 在导入失败时为 None，自动降级为 BackgroundTasks)
config.py      → pydantic-settings 配置管理，从 .env 读取所有环境变量
database.py    → SQLAlchemy async engine + session factory (SQLite/PostgreSQL 自适应)
```

**关键设计决策：**
- 数据库默认使用 SQLite (`sqlite+aiosqlite:///./pdfreader.db`)，Docker 环境切换 PostgreSQL。所有模型使用 `sqlalchemy.Uuid` 保证跨数据库兼容。
- Celery 为可选依赖。`tasks/celery_app.py` 中 `celery_app` 在导入失败时为 `None`。`tasks/pdf_tasks.py` 提供 `parse_pdf_sync()` 降级函数。API 层 `pdf.py` 检测 `parse_pdf_task is not None` 决定走 Celery 还是 `BackgroundTasks`。
- PDF 解析引擎使用 **MinerU Cloud API** (https://mineru.net)。PDF 上传后通过预签名 URL 上传到 MinerU → 轮询解析状态 → 下载 zip 提取 Markdown → 清理并分段。需要配置 `MINERU_API_TOKEN`（可在 .env 或前端页面配置）。注意：PRD 原计划用 PaddleOCR 本地部署，实际选择了 MinerU Cloud API。
- 所有 AI 调用走 DeepSeek API (OpenAI 兼容协议)，模型默认为 `deepseek-v4-flash`（`DEEPSEEK_MODEL` 配置项）。`AIService` 使用 httpx (不是 openai SDK)，手动构造 `POST /v1/chat/completions` 请求。封装了 3 次重试 (指数退避 2^attempt 秒)、JSON 响应提取 (`_extract_json` 处理 markdown 代码块包裹)、`temperature=0.3` 确定性输出。
- `database.py` 的 `get_db` 依赖注入自动 commit/rollback：正常返回时 commit，异常时 rollback。开发环境 `init_db()` 用 `Base.metadata.create_all` 自动建表。

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/pdf/upload` | 上传 PDF 文件 (multipart/form-data) |
| GET | `/api/v1/pdf/status/{task_id}` | 查询解析状态 (轮询用) |
| GET | `/api/v1/pdf/result/{task_id}` | 获取解析结果 (段落文本+已有翻译) |
| GET | `/api/v1/pdf/documents` | 列出已处理文档 (分页) |
| POST | `/api/v1/translate/translate` | AI 批量翻译段落，可选 document_id 持久化 |
| POST | `/api/v1/translate/explain-word` | AI 单词解析 (多词+语境，单次 API 调用) |
| POST | `/api/v1/translate/analyze-sentence` | AI 长难句语法分析 (句子结构+语法讲解+词汇+翻译) |
| GET | `/health` | 健康检查 |

**API 响应格式：** 所有 API 由 FastAPI 直接返回 Pydantic 模型（不包装）。错误通过 HTTPException 抛出，前端 Axios 拦截器统一处理 `response.data.detail`。

**翻译批处理：** `translate_paragraphs` 自动按 `CHUNK_SIZE = 15` 分批调用 `translate_batch`，避免 token 超限。

**单词解析 `max_tokens`：** `max(1024, min(500 * len(words), 8192))` — 按词数线性增长，1 词 ~1024 tokens，7 词 ~3500 tokens。

### 前端分层 (React + Zustand)

```
pages/       → HomePage (上传入口+最近文档), ReaderPage (阅读器主界面)
components/  → home/ (PDFUploader, RecentDocuments)
                reader/ (DocumentHeader, ArticleView, ParagraphBlock,
                         AnalysisPanel, WordExplainPanel, SentenceAnalysisPanel, SentenceAnalyzer)
                common/ (ApiKeyModal)
stores/      → documentStore (文档数据+翻译), readerStore (单词选中+解析缓存+句子分析)
services/    → api.ts (Axios 实例+拦截器), pdfApi.ts, translateApi.ts
```

**关键设计决策：**
- 阅读流程：`PDFUploader` 拖拽上传 → 轮询 `GET /pdf/status` (2s 间隔) → 完成后显示「开始阅读」→ 跳转 `ReaderPage` → 自动调用 AI 翻译 (如已配 API Key) → `ArticleView` 渲染段落
- `ReaderPage` 加载文档后自动检测 `paragraphs` 是否有 `text_zh`：如已有翻译则跳过；否则自动调用 `POST /translate/translate` 并 `setTranslations` 到 store 中。
- 右侧分析面板使用 **Ant Design Tabs** 切换两个子面板 (`AnalysisPanel`)：
  - **单词解析 tab** (`WordExplainPanel`)：单词 tokenize → 点击选中 → 批量解析
  - **句子分析 tab** (`SentenceAnalysisPanel`)：选中句子文本 → AI 语法分析
  - 当用户选中句子时自动切换到句子 tab
- 单词点击交互：`ParagraphBlock` 将每个段落 tokenize 为可点击单词 → 点击触发 `readerStore.toggleWord` → 右侧 `WordExplainPanel` 显示已选词列表 → 点击「解析」调用 `POST /translate/explain-word` → 结果缓存到 `explanationCache` (normalized key → structured explanation)。
- **单词批量解析：** 前端 `explainWordsInBatches` 将单词按 `BATCH_SIZE = 5` 分组，用 `Promise.all` 并发请求所有批次。每批完成后立即通过 `onBatchDone` 回调增量合并结果，用户无需等待所有单词完成。1 批 = 1 次 API 调用，7 个词 = 2 批并发 (5+2)。
- 句子分析交互：在 `ArticleView` 中选中文本 → `SentenceAnalyzer` 弹出浮动工具栏 → 点击「分析」→ 调用 `POST /translate/analyze-sentence` → 结果缓存到 `sentenceAnalysisCache` → `SentenceAnalysisPanel` 展示句子结构、语法讲解、关键词汇、中文翻译。
- `readerStore` 中单词以 normalized canonical key 存储（去标点、小写），`selectedDisplay` 保留原始显示形式。句子以 canonicalized key (`sentence.trim().toLowerCase()`) 缓存分析结果。
- DeepSeek API Key 存储在浏览器 `localStorage`，`ApiKeyModal` 管理读写。前端每次 API 调用时从 localStorage 读取并以 `api_key` 参数传递，不经过后端存储。
- Vite 开发服务器 `/api` 代理到 `localhost:8000`，前端 `axios.create({ baseURL: '/api/v1' })` 无需配置完整 URL。
- 前端 `tailwind.config.js` 设置 `preflight: false` 避免覆盖 Ant Design 默认样式。

### 数据流

| 功能 | 触发 | 数据流 |
|------|------|--------|
| PDF 导入 | `PDFUploader` 拖拽 | POST /pdf/upload → BackgroundTasks/Celery 解析 → 轮询 /pdf/status → GET /pdf/result |
| AI 翻译 | ReaderPage 加载后自动 | POST /translate/translate → 翻译结果存 documentStore.translations + 可选持久化到 DB |
| 单词解析 | 点击单词 + 右侧面板按钮 | POST /translate/explain-word → 结果写 readerStore.explanationCache |
| 句子分析 | 选中文本 + 浮动工具栏按钮 | POST /translate/analyze-sentence → 结果写 readerStore.sentenceAnalysisCache |
| 文档阅读 | 点击「开始阅读」 | ReaderPage → DocumentHeader + ArticleView (ParagraphBlock 逐段渲染 + 翻译对照) + AnalysisPanel (WordExplainPanel / SentenceAnalysisPanel tabs) |

### 数据模型

- **Document**: UUID 主键，`parse_status` (pending→processing→completed/failed)，`paragraphs` relationship (cascade delete)
- **Paragraph**: `(document_id, index)` 联合唯一索引，`text_en` (原文) + `text_zh` (翻译，AI 翻译后可持久化) + `summary` (预留)
- **User**: 预留表，目前未使用

### 已实现 vs 规划中

| 功能 | 状态 | 说明 |
|------|------|------|
| F01 PDF 导入解析 | ✅ 已实现 | 使用 MinerU Cloud API |
| F02 单词解析 | ✅ 已实现 | AI 深度解析（非 PRD 规划的本地 ECDICT 查词） |
| F03 长难句拆解 | ⚠️ 部分实现 | 句子语法分析已实现 (`analyze-sentence`)，但无 spaCy 初筛和 D3.js 语法树可视化 |
| F04 词汇深度教学 | ✅ 已实现 | 融合在 `explain-word` 中（音标/释义/例句/词组/语境句子） |

## 注意事项

- PDF 解析使用 MinerU Cloud API 进行高精度识别。MinerU 提供版面分析、正文提取、页眉页脚过滤等功能。
- `AIService` 提供三个核心方法：`translate_batch()` 批量翻译、`explain_words()` 多词解析、`analyze_sentence()` 句子语法分析。全部支持 3 次重试 + 指数退避。
- `pdf_service.py` 的 `filter_non_content` 和 `reconstruct_paragraphs` 目前是 passthrough — 实际逻辑在 `OCREngine._markdown_to_paragraphs` 中。
- `parse_document()` 中的 `ocr.parse_pdf()` 是 async 方法，必须使用 `await` 调用。
- Celery task 定义在 `pdf_tasks.py`，仅在 `celery_app is not None` 时动态定义 `parse_pdf_task`，无 `@celery_app.task` 装饰器。
- 前端 tokenize 正则 `([a-zA-Z0-9À-ɏ'’‘’\-]+)` 匹配带 Unicode 字母和撇号的英文单词。
- AI 服务使用 httpx.AsyncClient（不是 openai SDK），client 通过 `@property` 延迟初始化，首次调用时创建。
- `analysis_panel.py` 中的 `AnalysisPanel` 使用 Ant Design `Tabs` 组件在单词解析和句子分析之间切换，切换逻辑由 `readerStore.selectedSentence` 变化触发。
- 句子选中通过浏览器 `Selection API` 实现：`SentenceAnalyzer` 监听 `mouseup` 事件检测文本选区，展示浮动工具栏。
- 性能测试脚本 `test_word_timing.py` 和 `bench_store.mjs` 是手动添加的测试工具，不在正式构建流程中。`test_word_timing.py` 会创建 httpx client 并直接调用 DeepSeek API，需要有效的 `.env` 配置。
