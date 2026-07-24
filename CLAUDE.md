# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

PDF 外刊阅读工具 — 上传英文 PDF，自动提取正文，AI 段落翻译 + 单词解析 + 长难句拆解，支持段落编辑校对，纯净阅读体验。

## 开发命令

```bash
# 后端
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000  # SQLite 开发模式
ruff check .                               # 代码风格

# 前端
cd frontend
npm install --legacy-peer-deps
npm run dev              # Vite :5173, /api → localhost:8000
npm run build            # tsc + vite build
npm run lint             # ESLint

# Docker 全栈
cp .env.example .env     # 编辑填入 MinerU Token + DeepSeek Key
docker-compose up -d     # 前端 :80, API :8000, /docs Swagger
```

## 架构

### 后端分层 (FastAPI + SQLAlchemy)

```
api/v1/   → pdf.py (上传/状态/结果/页面选择/段落编辑/文档管理),
            translate.py (段落翻译), words.py (单词解析CRUD),
            sentences.py (长难句拆解CRUD), prompts.py (Prompt模板CRUD)
services/ → pdf_service.py (解析编排), ocr_engine.py (MinerU OCR),
            ai_service.py (DeepSeek: 翻译+单词+句子分析),
            prompt_defaults.py (默认Prompt), page_utils.py (PDF页数+页面提取)
models/   → Document, Paragraph, WordAnalysis, SentenceAnalysis, PromptTemplate, User
schemas/  → pdf.py, translate.py, words.py, sentences.py, prompts.py
tasks/    → Celery 异步 (可选, 导入失败自动降级 BackgroundTasks)
config.py → pydantic-settings, .env 读取
database.py → async SQLAlchemy (SQLite 默认, PostgreSQL Docker)
```

**关键设计决策：**
- 数据库默认 SQLite (`sqlite+aiosqlite:///./pdfreader.db`)，Docker 切 PostgreSQL
- AI 全用 **DeepSeek API** (`deepseek-v4-flash`)，指数退避重试 3 次，超时 60s/连接 10s
- `get_db` 依赖注入自动 commit/rollback；pydantic-settings `extra="ignore"` 兼容旧配置
- 启动 `lifespan` 自动将 `processing`/`awaiting_selection` 状态文档标记 `failed`（防孤儿任务）
- 无外部认证系统 — API Key (MinerU Token + DeepSeek Key) 存前端 localStorage，通过请求参数传递

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/pdf/upload` | 上传 PDF (可选 `pages` 指定页, `mineru_token`) |
| POST | `/api/v1/pdf/select-pages` | 选择页面范围，触发解析 |
| GET | `/api/v1/pdf/page-count/{task_id}` | PDF 总页数 |
| GET | `/api/v1/pdf/status/{task_id}` | 查询解析状态 (2s 轮询) |
| GET | `/api/v1/pdf/result/{task_id}` | 获取结果 (段落+已存翻译/单词/句子解析) |
| GET | `/api/v1/pdf/file/{task_id}` | 原始 PDF 文件 (预览用) |
| GET | `/api/v1/pdf/documents` | 已处理文档列表 (分页) |
| DELETE | `/api/v1/pdf/documents/{task_id}` | 删除文档及文件 |
| POST | `/api/v1/pdf/retry/{task_id}` | 重试失败/卡住的文档 |
| PUT | `/api/v1/pdf/documents/{task_id}/paragraphs` | 批量更新段落文本 (校对页用) |
| DELETE | `/api/v1/pdf/documents/{task_id}/paragraphs/{paragraph_index}` | 删除段落 (自动重排索引) |
| POST | `/api/v1/pdf/documents/{task_id}/paragraphs/merge` | 合并相邻段落 |
| PUT | `/api/v1/pdf/documents/{task_id}/paragraphs/reorder` | 拖拽重排段落 (页码传播) |
| POST | `/api/v1/translate` | 翻译段落, 可选 `document_id` 持久化 |
| POST | `/api/v1/words/analyze` | 单词解析 (upsert) |
| GET | `/api/v1/words/list/{document_id}` | 文档已存单词解析 |
| DELETE | `/api/v1/words/{analysis_id}` | 删除单词解析 |
| POST | `/api/v1/sentences/analyze` | 长难句拆解 (upsert) |
| GET | `/api/v1/sentences/list/{document_id}` | 文档已存句子解析 |
| DELETE | `/api/v1/sentences/{analysis_id}` | 删除句子解析 |
| GET | `/api/v1/prompts` | 列出所有 Prompt 模板 |
| GET | `/api/v1/prompts/{name}` | 查看单个 Prompt 模板 |
| PUT | `/api/v1/prompts/{name}` | 修改 Prompt 模板 |
| POST | `/api/v1/prompts/{name}/reset` | 重置单个 Prompt |
| POST | `/api/v1/prompts/reset-all` | 重置全部 Prompt |
| GET | `/health` | 健康检查 |

**注意**: Prompt 路由当前 `_VALID_NAMES = frozenset({"analyze_sentences"})`，仅开放长难句 Prompt 的编辑。translate 和 analyze_words 的 Prompt 虽在 `prompt_defaults.py` 中有定义，但暂不可通过 API 修改。

错误码约定: 401=Key无效, 402=余额不足, 429=限流, 504=超时。持久化失败静默忽略不阻断响应。

### 数据模型

- **Document**: UUID 主键, `parse_status` (pending→awaiting_selection→processing→completed/failed), `page_count`, `word_count`, `paragraph_count`, `original_text`, `file_path`, `error_message`, `selected_pages`(JSON), `created_at`/`updated_at`。cascade delete paragraphs/analyses。
- **Paragraph**: `(document_id, index)` 唯一索引, `text_en` + `text_zh` + `summary`(预留) + `page_number` + `created_at`
- **WordAnalysis**: `(document_id, paragraph_index, word)` 唯一, upsert。字段: `phonetic`, `original_sentence`, `original_sentence_zh`, `part_of_speech`, `definition`, `definition_zh`, `cognates`(JSON数组), `synonyms_antonyms`(JSON: {synonyms, antonyms}), `base_form`, `plural_form`
- **SentenceAnalysis**: `(document_id, paragraph_index, sentence_index)` 唯一, upsert。`sentence_text` + `structure_json` (包含 `structure` 数组 + `idiomatic_translation`)
- **PromptTemplate**: `name` 主键 (translate/analyze_words/analyze_sentences), `system_prompt` + `user_prompt`。DB 有行=自定义覆盖, 无行=使用 `prompt_defaults.py` 默认
- **User**: 预留表, `email`(unique) + `nickname`

### 页面选择 & OCR 流程

1. 前端上传 PDF → 后端 `page_utils.count_pdf_pages()` 返回总页数
2. 前端 `PageSelector` (react-pdf 渲染缩略图, 最多10页) 展示供用户选择
3. 用户确认 → `POST /select-pages` → 状态变为 `processing`
4. **本地页面提取**: `page_utils.extract_pdf_pages()` 从原始 PDF 提取选中页到临时文件 → 上传临时文件到 MinerU (节省 Token)
5. MinerU 解析后，`_map_page_numbers()` 将 MinerU 的 0-based 索引映射回原始文档页码

### OCR 引擎 (`ocr_engine.py`)

MinerU batch file-upload API 流程:
1. `POST /api/v4/file-urls/batch` → 预签名 URL + batch_id
2. `PUT` PDF 字节 (不设 Content-Type)
3. `GET /api/v4/extract-results/batch/{batch_id}` 轮询 (3s, 5min 超时)
4. 下载 zip → `content_list.json` 优先, `full.md` 回退

`_content_list_to_paragraphs()`: 排除 header/footer/page_number；保留 text/title/list(合并)/table(HTML)/code/equation；从首个 title 或 text_level≥1 提取文档标题。

### AI 服务 (`ai_service.py`)

四个公共方法，均 `Semaphore(10)` 并发 + 3 次指数退避重试：

| 方法 | 说明 |
|------|------|
| `translate(text, prev?, next?)` | 单段翻译，滑动窗口上下文 |
| `translate_batch(paragraphs)` | 批量翻译，按 index 排序 |
| `analyze_words(entries)` | 按段落分组，每批 ≤5 词，`response_format: json_object` |
| `analyze_sentences(entries)` | 每句独立调用，返回 structure + idiomatic_translation |

**Prompt 模板系统**: 每个方法接受 `system_prompt_override`/`user_prompt_override`。路由层从 `PromptTemplate` 表查询自定义 prompt 传入。`_resolve_prompt()` 用 `_SafeDict` + `str.format_map()` 替换 `{placeholder}`，未知占位符保留原文。默认 prompt 定义在 `prompt_defaults.py`。

### 单词解析 & 句子解析 & 校对页

**单词解析**: 段落内 token 化渲染 → 点击选中 → `POST /words/analyze` → 后端按句号提取上下文句 → 去重 + 分组批处理 → upsert `WordAnalysis`

**句子解析**: 选中句子 → `POST /sentences/analyze` → 并发调用 → 返回结构拆解 + 地道翻译 → upsert `SentenceAnalysis`

**校对页** (`/review/:id`): 阅读完成后可进入校对模式 → 左侧 PDF 预览 (`react-pdf`) + 右侧可编辑段落列表 → 支持编辑/删除/合并/拖拽重排 (`@dnd-kit`) → 撤销/重做 (`useUndoRedo`, 快照栈最大 50) → 保存调用 `PUT paragraphs` 等端点

三个功能模块均遵循「前端选中 → API 调用 → AI 分析 → upsert 持久化 → 下次打开自动恢复」模式。

### 前端分层 (React 18 + TypeScript + Zustand + Tailwind CSS)

```
pages/       → HomePage (上传+文档列表), ReaderPage (阅读+翻译+解析), ReviewPage (校对编辑)
components/  → home/ (PDFUploader, RecentDocuments, PageSelector)
                reader/ (ReaderHeader, ReadingArea, ParagraphBlock, StudyPanel)
                review/ (ReviewHeader, UndoRedoToolbar, PDFViewerPanel, EditableParagraphPanel,
                         EditableParagraph, PageGroup, SortableParagraph)
                common/ (ApiKeyModal, PromptEditorModal)
                ui/ (Button, Modal, Input, Spinner/PageSpinner, Card/DarkCard/CreamCard,
                     Badge/CoralBadge, EmptyState) — 自定义组件库，无第三方 UI 库
hooks/       → useSplitPane.ts (可拖拽分隔条), useUndoRedo.ts (快照撤销/重做, 最大50步)
stores/      → documentStore, readerStore, promptStore
services/    → api.ts, pdfApi.ts, translateApi.ts, wordAnalysisApi.ts,
                sentenceAnalysisApi.ts, promptApi.ts
```

**关键决策：**
- **无 Ant Design** — 全部使用自定义 `ui/` 组件 + Tailwind CSS，`preflight: true`
- 设计系统: 暖色调 — `--canvas: #faf9f5`, `--primary: #cc785c`, `--ink: #141413`；衬线字体阅读 (`Cormorant Garamond`)，Inter 作 UI 字体
- 阅读流程: 拖拽上传 → 页面选择 (可选) → 2s 轮询状态 → 完成后跳转 ReaderPage → 自动翻译 + 恢复已存解析
- 翻译/解析持久化: 带 `document_id` 请求自动保存到 DB；`GET /pdf/result` 附带返回；`setDocument()` 恢复
- API Key 存 localStorage, `ApiKeyModal` 统一管理 MinerU Token + DeepSeek Key
- Vite `/api` 代理到 `localhost:8000`, axios `baseURL: '/api/v1'`
- 段落渲染: `react-markdown` + `remark-gfm`, 单词 token 通过自定义 `components.p` 注入
- 字体大小: `readerStore` persist 到 localStorage — 正文 14-28px (步长 2px, 默认 18px), 词面板 12-22px (步长 2px, 默认 14px)
- 右侧 `StudyPanel` 可拖拽分隔条调宽度；点击单词卡片→原文段落黄色闪烁定位 (`paragraph-flash` 动画 1.5s)
- 校对页: 左右分栏 (`useSplitPane`, 默认 55/45), 段落支持行内编辑 + dnd-kit 拖拽排序, 段落按页码分组显示
- `ErrorBoundary` 包裹整个 App，中文错误提示 + 返回首页按钮

### Zustand Store

- **documentStore**: `documentId`, `paragraphs`, `pageCount`, `selectedPages`, `translations: Record<number, string>`, `selectedWords`/`wordAnalyses`, `selectedSentences`/`sentenceAnalyses`, 各状态的 loading/error 标志, `highlightedAnalysisKey`/`highlightedAnalysisTab` (分析面板→段落反向定位)。`setDocument()` 恢复, `reset()` 清空。
- **readerStore**: `fontSize` (正文 14-28px) + `wordPanelFontSize` (词面板 12-22px), `zustand/middleware/persist` → localStorage
- **promptStore**: `templates`, `isLoading`, `isSaving`, `error`, `fetchTemplates()`, `updateTemplate()`, `resetTemplate()`, `resetAllTemplates()`, `clearError()`

### 自定义 CSS

- `.word-token` — 可点击, hover 蓝底
- `.word-token-selected` — 选中蓝底+光晕
- `.word-token-has-analysis` — 已解析, 绿色虚线底+浅绿背景
- `.paragraph-flash` / `@keyframes paragraph-flash-anim` — 黄色闪烁 1.5s

### 前端依赖要点

| 依赖 | 用途 |
|------|------|
| `react-pdf` | PDF 缩略图 (PageSelector) + 校对页 PDF 预览 (PDFViewerPanel) |
| `@dnd-kit/core` `@dnd-kit/sortable` `@dnd-kit/modifiers` | 校对页段落拖拽排序 |
| `dayjs` | RecentDocuments 日期格式化 |
| `@tailwindcss/typography` | prose 排版 (段落阅读区) |
| `zustand` + `persist` middleware | 全局状态 + 字体偏好持久化 |
| `react-markdown` + `remark-gfm` | 段落 Markdown 渲染 |

## 注意事项

- `pdf_service.py` 的 `filter_non_content`/`reconstruct_paragraphs` 是 passthrough — 实际过滤在 `OCREngine._content_list_to_paragraphs()`
- `ocr.parse_pdf()` 是 async, 必须 `await`
- Celery task 仅在 `celery_app is not None` 时动态定义
- 所有 AI 端点接受可选 `api_key` 参数覆盖服务器默认值
- 所有 AI 端点接受可选 `system_prompt_override`/`user_prompt_override` (来自 PromptTemplate 表)
- 单词解析按句号提取上下文句而非整段; 同段同词去重合并
- `WordAnalysis`/`SentenceAnalysis` upsert: 同 key 自动覆盖
- `.word-token` 覆盖 `strong`/`em`, `processChildren` 递归确保 markdown 内单词可点击
- `_SafeDict` 使未知占位符保留原文; `_is_fatal_error()` 区分认证错误(立即失败)和瞬时错误(重试)
- `page_utils.extract_pdf_pages()` 在 OCR 前从原始 PDF 提取选中页 → 上传临时文件; `_map_page_numbers()` 将 MinerU 的 0-based 索引映射回原文档页码
- `_VALID_NAMES` 当前仅 `{"analyze_sentences"}` — translate 和 analyze_words 的 Prompt 暂不可通过 API 编辑
- 校对页 `updateParagraphs` 批量保存, `deleteParagraph`/`mergeParagraphs` 自动重排 `paragraph_index`; `reorderParagraphs` 同步更新 `page_number`
- 后端安装了但未实际使用的包: `python-docx`, `python-jose`/`passlib`(认证预留), `slowapi`(限流预留), `aiofiles`
