# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

PDF 外刊阅读工具 — 上传英文 PDF，自动提取正文内容，AI 段落翻译 + 单词解析，纯净阅读体验。

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

# Docker Compose 全栈启动
cp .env.example .env                      # 编辑 .env 填入 MinerU Token + DeepSeek Key
docker-compose up -d                      # 前端 :80, API :8000, /docs Swagger UI
```

## 架构

### 后端分层 (FastAPI + SQLAlchemy)

```
api/v1/pdf.py       → 路由层 (PDF上传、状态查询、结果获取、已存解析附带)
api/v1/translate.py → 路由层 (段落翻译，调用 DeepSeek AI)
api/v1/words.py     → 路由层 (单词解析/查询/删除，调用 DeepSeek AI)
services/           → 业务逻辑层 (pdf_service.py PDF解析编排, ocr_engine.py OCR引擎, ai_service.py AI翻译+单词解析)
models/             → SQLAlchemy ORM 模型 (Document, Paragraph, WordAnalysis, User)
schemas/            → Pydantic 请求/响应模型 (pdf.py, translate.py, words.py)
tasks/              → Celery 异步任务 (可选，自动降级为 BackgroundTasks)
config.py           → pydantic-settings 配置管理，从 .env 读取所有环境变量
database.py         → SQLAlchemy async engine + session factory (SQLite/PostgreSQL 自适应)
```

**关键设计决策：**
- 数据库默认使用 SQLite (`sqlite+aiosqlite:///./pdfreader.db`)，Docker 环境切换 PostgreSQL。
- Celery 为可选依赖，导入失败时自动降级为 `BackgroundTasks`。
- PDF 解析引擎使用 **MinerU Cloud API** (https://mineru.net)。流程：POST 获取预签名上传 URL → PUT PDF 字节 → 轮询解析状态 → 下载 zip 提取 `content_list.json` + `full.md`。使用 VLM 模型版本 (`model_version: "vlm"`)。
- OCR 引擎优先使用 `content_list.json` 的 block type 标签过滤页眉/页脚/页码（`EXCLUDED_BLOCK_TYPES`），仅在 content_list 不可用时回退到 markdown 解析。
- AI 翻译和单词解析均使用 **DeepSeek API** (`deepseek-v4-flash`)。
- `database.py` 的 `get_db` 依赖注入自动 commit/rollback。
- pydantic-settings `Config.extra = "ignore"` 确保旧 `.env` 配置项不会导致启动失败。

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/pdf/upload` | 上传 PDF 文件 (multipart/form-data, 可选 `mineru_token`) |
| GET | `/api/v1/pdf/status/{task_id}` | 查询解析状态 (轮询用, 2s 间隔) |
| GET | `/api/v1/pdf/result/{task_id}` | 获取解析结果 (段落文本 + 已存翻译 + 已存单词解析) |
| GET | `/api/v1/pdf/documents` | 列出已处理文档 (分页, 最新在前) |
| POST | `/api/v1/translate` | 翻译段落列表，可选 `document_id` 持久化翻译到 DB |
| POST | `/api/v1/words/analyze` | 解析选中单词，调用 AI 批量分析，结果持久化到 DB (upsert) |
| GET | `/api/v1/words/list/{document_id}` | 获取文档已存单词解析列表 |
| DELETE | `/api/v1/words/{analysis_id}` | 删除单条单词解析 |
| GET | `/health` | 健康检查 |

### 数据模型

- **Document**: UUID 主键，`parse_status` (pending→processing→completed/failed)，`file_path`, `original_text`, `title`, `source`, `word_count`, `paragraph_count`。Relationships: `paragraphs`, `word_analyses` (均 cascade delete)。
- **Paragraph**: `(document_id, index)` 联合唯一索引，`text_en` (原文) + `text_zh` (AI 翻译) + `summary` (预留)。
- **WordAnalysis**: `(document_id, paragraph_index, word)` 联合唯一索引。存储单词解析结果：`phonetic`, `original_sentence`, `original_sentence_zh`, `part_of_speech`, `definition`, `definition_zh`, `example_sentences` (JSON 数组), `example_sentences_zh` (JSON 数组)。解析后持久化，打开文档时自动恢复。
- **User**: 预留表，目前未使用。

### AI 服务 (`ai_service.py`)

`AIService` 封装 DeepSeek Chat Completions API，三个公共方法：

- `translate(text, prev_text?, next_text?)`: 单段翻译，支持滑动窗口上下文（前后段落）解决歧义。
- `translate_batch(paragraphs)`: 批量翻译，`asyncio.Semaphore(10)` 并发，每段独立 API 调用，按 index 排序恢复顺序。
- `analyze_words(entries)`: 批量单词解析。按 paragraph_index 分组，每批最多 `WORDS_BATCH_SIZE`(默认5) 个单词，`Semaphore(10)` 并发，`response_format: {"type": "json_object"}` 确保结构化输出。Prompt 返回单词+音标+词性+英文释义+中文释义+例句(2-3句)+原文句+翻译。

所有方法内置指数退避重试（3 次），超时 60s/连接 10s。单段/单批失败不阻塞其他。单例 `ai_service` 实例供路由使用，也支持按请求传入独立 API key。

### 单词解析功能

**后端流程：**
1. 前端传入 `POST /words/analyze` — `entries[]` 每组包含 `paragraph_index`, `words[]`, `sentence`, `sentence_translation?`
2. 后端 `_extract_sentence()` 从段落文本中按句号拆分，找到包含目标单词的那句话作为上下文
3. 调用 `ai_service.analyze_words()` → 扁平化为 per-word entries，去重，按段落分组批处理
4. 结果通过 `_persist_analyses()` upsert 写入 `word_analyses` 表（同 doc+para+word 则更新）
5. `GET /pdf/result/{id}` 附带 `word_analyses` 字段，前端加载时自动恢复已存解析

**前端流程：**
1. `ParagraphBlock` 自定义 ReactMarkdown `components.p` 渲染器，递归处理子节点将文本词 token 化
2. 点击词 token → `toggleWordSelection(paragraphIndex, word)` → 蓝色高亮
3. 已解析过的词显示绿色虚线 + 浅绿底（`.word-token-has-analysis`）
4. 底部浮动操作栏：「已选 N 个词」「解析」「清除」
5. 解析时增量发送（仅新词），结果写入 `wordAnalyses` store
6. `WordPanel` 右侧面板：词+音标始终显示，英文释义/原句/例句始终可见，中文翻译点击展开（按钮在右侧）
7. 点击单词卡片 → 原文滚动到对应段落并高亮闪烁
8. 可拖拽分隔条调整左右栏宽度
9. 单个单词删除 → `DELETE /words/{id}` + store 移除

### OCR 引擎 (`ocr_engine.py`)

解析流程使用 MinerU batch file-upload API：
1. `POST /api/v4/file-urls/batch` → 获取预签名上传 URL + `batch_id`
2. `PUT` PDF 字节到预签名 URL（**不设置 Content-Type 头**，按 API 规范）
3. `GET /api/v4/extract-results/batch/{batch_id}` → 轮询直到 `state == "done"`（3s 间隔，5 分钟超时）
4. 下载 `full_zip_url` → 提取 `content_list.json`（首选）或 `full.md`（回退）

`_content_list_to_paragraphs()` 根据 block type 标签过滤：
- **排除**: `header`, `footer`, `page_number`
- **保留**: `text`, `title`, `list`（合并 items）, `table`（保留 HTML）, `code`, `equation`
- 从第一个 `title` 或 `text_level >= 1` 的 block 提取文档标题

`_check_response()` 统一处理 MinerU API 的两种错误格式：`code != 0` 和 `msgCode` 字符串。

### 前端分层 (React + Zustand + Ant Design)

```
pages/       → HomePage (上传入口+最近文档), ReaderPage (阅读器 + 翻译 + 单词解析编排)
components/  → home/ (PDFUploader, RecentDocuments)
                reader/ (DocumentHeader, ArticleView, ParagraphBlock, WordPanel)
                common/ (ApiKeyModal — MinerU Token + DeepSeek Key 双密钥配置)
stores/      → documentStore (文档+翻译+单词解析), readerStore (字体大小偏好)
services/    → api.ts (Axios 实例), pdfApi.ts, translateApi.ts, wordAnalysisApi.ts
```

**关键设计决策：**
- 阅读流程：`PDFUploader` 拖拽上传 → 轮询 `GET /pdf/status` (2s 间隔) → 完成后跳转 `ReaderPage` → 自动触发翻译 + 恢复已存单词解析 → `ArticleView` 渲染段落
- 翻译流程：`ReaderPage` 检测 `paragraphs` 加载完成 → 调用 `POST /translate` 传入所有未翻译段落 → `updateTranslations` 按 index 写回 store → `ParagraphBlock` 显示可折叠译文
- 翻译持久化：`translate` 请求可带 `document_id`，后端自动保存到 `Paragraph.text_zh`。再次打开时自动恢复。
- 单词解析持久化：`word_analyses` 表存储，打开文档时 `GET /pdf/result` 附带返回，前端 `setDocument` 恢复。
- 两种 API Key 均存储在浏览器 `localStorage`，`ApiKeyModal` 统一管理 MinerU Token + DeepSeek Key 的读写。
- Vite 开发服务器 `/api` 代理到 `localhost:8000`（见 `vite.config.ts`），前端 `axios.create({ baseURL: '/api/v1' })` 无需配置完整 URL。
- 前端 `tailwind.config.js` 设置 `preflight: false` 避免覆盖 Ant Design 默认样式，使用 `@tailwindcss/typography` 插件。
- 段落渲染使用 `react-markdown` + `remark-gfm`（支持 GitHub Flavored Markdown）。单词 token 通过自定义 `components.p` 渲染器注入。
- 字体大小通过 `readerStore` 持久化到 `localStorage`（14-28px，步长 2px）。

### 状态管理 (Zustand)

**documentStore**: 文档+翻译+单词解析的综合 store
- 文档数据：`documentId`, `title`, `source`, `paragraphs`, `wordCount`, `paragraphCount`
- 翻译：`translations: Record<number, string>` (paragraph index → zh), `isTranslating`, `translationError`
- 单词选中：`selectedWords: Record<string, boolean>` (key 格式 `"paragraphIndex:word"`)
- 单词解析：`wordAnalyses: Record<string, WordAnalysisResult>`, `isAnalyzing`, `analysisError`
- `setDocument()` 恢复翻译和已存单词解析；`reset()` 清空所有状态

**readerStore**: 仅字体大小偏好，通过 `zustand/middleware/persist` 持久化到 `localStorage`。

### 自定义 CSS

- `.word-token` — 单词可点击 token，hover 蓝色底
- `.word-token-selected` — 选中状态，蓝色底 + 边框光晕
- `.word-token-has-analysis` — 已有解析标记，绿色虚线底 + 浅绿背景
- `.paragraph-flash` / `@keyframes paragraph-flash-anim` — 点击单词卡片后段落黄色闪烁 1.5s

## 注意事项

- PDF 解析使用 MinerU Cloud API VLM 模型进行高精度版面分析，自动过滤页眉页脚页码。
- `pdf_service.py` 的 `filter_non_content` 和 `reconstruct_paragraphs` 目前是 passthrough — 实际过滤逻辑在 `OCREngine._content_list_to_paragraphs()` 中。
- `parse_document()` 中的 `ocr.parse_pdf()` 是 async 方法，必须使用 `await` 调用。
- Celery task 定义在 `pdf_tasks.py`，仅在 `celery_app is not None` 时动态定义 `parse_pdf_task`。
- 翻译/单词解析 API 端点均接受可选的 `api_key` 参数，允许前端传入用户自己的 DeepSeek key 覆盖服务器默认值。
- `POST /translate` 和 `POST /words/analyze` 返回状态码 401/402/429/504 分别对应 API Key 无效、余额不足、限流、超时，前端根据状态码显示对应中文错误提示。
- 翻译保存和单词解析保存失败不阻断响应（异常被静默捕获）。
- 单词解析时后端会自动从段落文本中提取包含目标单词的一句话（按句号拆分），而非发送整段，避免 AI 过长输出。
- 单词解析后端去重：同一段内相同单词合并为一个请求。
- `WordAnalysis` 表使用 `(document_id, paragraph_index, word)` 联合唯一约束，重复解析自动覆盖更新。
- `.word-token` 覆盖了 `strong`/`em` 内部文本，`processChildren` 递归处理确保 markdown 格式内的单词也可点击。
