# CLAUDE.md

## 项目概述

PDF 外刊阅读工具 — 上传英文 PDF，自动提取正文，AI 段落翻译 + 单词解析 + 长难句拆解，支持段落编辑校对，纯净阅读体验。含 JWT 认证系统和超级管理员后台。

## 开发命令

```bash
# 后端
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000  # SQLite 开发模式
ruff check .

# 前端
cd frontend
npm install --legacy-peer-deps
npm run dev              # Vite :5173, /api → localhost:8000
npm run build            # tsc + vite build
npm run lint

# Docker 全栈
cp .env.example .env     # 填入 MinerU Token + DeepSeek Key
docker-compose up -d     # 前端 :80, API :8000
```

## 架构

### 后端 (FastAPI + SQLAlchemy async)

```
app/
├── api/v1/
│   ├── pdf.py        # PDF 上传/状态/结果/页面选择/段落编辑/文档管理
│   ├── translate.py  # 段落翻译 (流式 SSE)
│   ├── words.py      # 单词解析 CRUD
│   ├── sentences.py  # 长难句拆解 CRUD
│   ├── prompts.py    # Prompt 模板管理 (3种模板全部可编辑)
│   └── admin.py      # 管理后台 API (统计/用户管理/文档管理，superuser only)
├── auth/
│   ├── router.py     # POST /register, POST /login, GET /me
│   ├── models.py     # User (id, email, nickname, password_hash, is_superuser, is_active)
│   └── security.py   # JWT create/verify, password hash, get_current_user
├── services/
│   ├── pdf_service.py     # 解析编排
│   ├── ocr_engine.py      # MinerU OCR (batch file-upload API)
│   ├── ai_service.py      # DeepSeek: 翻译+单词+句子分析
│   ├── prompt_defaults.py # 默认 Prompt + TEMPLATE_NAMES + PLACEHOLDERS
│   └── page_utils.py      # PDF 页数统计 + 页面提取
├── models/   # Document, Paragraph, WordAnalysis, SentenceAnalysis, PromptTemplate, User
├── schemas/  # pdf.py, translate.py, words.py, sentences.py, prompts.py, admin.py
├── config.py     # pydantic-settings (.env)
└── database.py   # async SQLAlchemy (SQLite 默认, PostgreSQL Docker)
```

**关键决策：**
- DB 默认 SQLite，Docker 切 PostgreSQL
- AI 全用 **DeepSeek API** (`deepseek-v4-flash`)，指数退避重试 3 次，Semaphore(10) 并发
- `get_db` 依赖注入自动 commit/rollback
- 启动 `lifespan` 自动清理孤儿任务状态
- Prompt 模板: 路由层从 `PromptTemplate` 表查询自定义 prompt，`_resolve_prompt()` 用 `_SafeDict` + `str.format_map()` 替换占位符

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/register` | 注册 |
| POST | `/api/v1/auth/login` | 登录，返回 JWT |
| GET | `/api/v1/auth/me` | 当前用户信息 |
| POST | `/api/v1/pdf/upload` | 上传 PDF |
| POST | `/api/v1/pdf/select-pages` | 选择页面范围，触发解析 |
| GET | `/api/v1/pdf/page-count/{task_id}` | PDF 总页数 |
| GET | `/api/v1/pdf/status/{task_id}` | 查询解析状态 |
| GET | `/api/v1/pdf/result/{task_id}` | 获取解析结果 |
| GET | `/api/v1/pdf/file/{task_id}` | 原始 PDF 文件 |
| GET | `/api/v1/pdf/documents` | 文档列表 (分页) |
| DELETE | `/api/v1/pdf/documents/{task_id}` | 删除文档 |
| POST | `/api/v1/pdf/retry/{task_id}` | 重试失败文档 |
| PUT | `/api/v1/pdf/documents/{task_id}/paragraphs` | 批量更新段落 |
| DELETE | `/api/v1/pdf/documents/{task_id}/paragraphs/{idx}` | 删除段落 |
| POST | `/api/v1/pdf/documents/{task_id}/paragraphs/merge` | 合并段落 |
| PUT | `/api/v1/pdf/documents/{task_id}/paragraphs/reorder` | 拖拽重排 |
| POST | `/api/v1/translate` | 翻译段落 (SSE) |
| POST | `/api/v1/words/analyze` | 单词解析 (upsert) |
| GET | `/api/v1/words/list/{document_id}` | 单词解析列表 |
| DELETE | `/api/v1/words/{analysis_id}` | 删除单词解析 |
| POST | `/api/v1/sentences/analyze` | 句子解析 (upsert) |
| GET | `/api/v1/sentences/list/{document_id}` | 句子解析列表 |
| DELETE | `/api/v1/sentences/{analysis_id}` | 删除句子解析 |
| GET | `/api/v1/prompts` | 列出所有 Prompt 模板 |
| GET | `/api/v1/prompts/{name}` | 查看单个 Prompt |
| PUT | `/api/v1/prompts/{name}` | 修改 Prompt |
| POST | `/api/v1/prompts/{name}/reset` | 重置单个 Prompt |
| POST | `/api/v1/prompts/reset-all` | 重置全部 Prompt |
| GET | `/api/v1/admin/stats` | 管理后台统计 |
| GET | `/api/v1/admin/users` | 用户列表 |
| PUT | `/api/v1/admin/users/{user_id}` | 编辑用户 |
| DELETE | `/api/v1/admin/users/{user_id}` | 删除用户 |
| GET | `/api/v1/admin/documents` | 全部文档列表 |
| POST | `/api/v1/admin/documents/batch-delete` | 批量删除文档 |
| DELETE | `/api/v1/admin/documents/{doc_id}` | 删除单个文档 |
| GET | `/health` | 健康检查 |

**Prompt 模板**: 三种 (`translate`, `analyze_words`, `analyze_sentences`) 全部可通过 API 编辑。`_VALID_NAMES` 从 `DEFAULT_PROMPTS.keys()` 动态派生。

### 数据模型

- **User**: `email`(unique), `nickname`, `password_hash`, `is_superuser`, `is_active`, `created_at`
- **Document**: UUID 主键, `parse_status` (pending→awaiting_selection→processing→completed/failed), cascade delete
- **Paragraph**: `(document_id, index)` 唯一索引, `text_en`, `text_zh`, `page_number`
- **WordAnalysis**: `(document_id, paragraph_index, word)` 唯一, upsert。含 phonetic, definition, cognates, synonyms_antonyms 等
- **SentenceAnalysis**: `(document_id, paragraph_index, sentence_index)` 唯一, upsert。含 structure_json
- **PromptTemplate**: `name` 主键, `system_prompt` + `user_prompt`。DB 有行=自定义, 无行=默认

### OCR 流程

1. 上传 PDF → `count_pdf_pages()` 返回总页数
2. 前端 `PageSelector` (react-pdf 缩略图) 供用户选择
3. `page_utils.extract_pdf_pages()` 提取选中页到临时文件 → 上传 MinerU
4. MinerU batch API 轮询 → 下载 zip → `content_list.json` 优先, `full.md` 回退
5. `_map_page_numbers()` 将 MinerU 0-based 索引映射回原文档页码

### 前端 (React 18 + TypeScript + Zustand + Tailwind CSS)

```
pages/
├── HomePage.tsx       # 上传 + 文档列表
├── ReaderPage.tsx     # 阅读 + 翻译 + 解析 (桌面左右分栏, 移动端单栏)
├── ReviewPage.tsx     # 校对编辑 (PDF预览 + 可编辑段落)
├── LoginPage.tsx      # 登录
├── RegisterPage.tsx   # 注册
└── admin/
    ├── AdminDashboard.tsx   # 统计概览
    ├── AdminUsers.tsx       # 用户管理
    ├── AdminDocuments.tsx   # 文档管理
    └── AdminPrompts.tsx     # Prompt 模板管理 (3卡片布局)

components/
├── reader/
│   ├── ReaderHeader.tsx         # 顶栏 (返回/标题/排版设置)
│   ├── ReadingArea.tsx          # 阅读区 (段落列表)
│   ├── ParagraphBlock.tsx       # 段落渲染 (token化单词/句子, 点击选择/解析)
│   ├── StudyPanel.tsx           # 解析面板 (单词/句子tab, 桌面右侧, 可关闭)
│   ├── StudySheet.tsx           # 移动端底部弹出面板 (45vh)
│   ├── FocusedAnalysisSheet.tsx # 移动端单词/句子详情弹窗 (max 45vh)
│   └── TypographyDrawer.tsx     # 移动端排版设置抽屉
├── common/
│   ├── ApiKeyModal.tsx       # API Key 管理 (MinerU + DeepSeek, 多Provider)
│   ├── ProviderSelector.tsx  # AI Provider 选择
│   ├── ProtectedRoute.tsx    # 登录保护 (检查 JWT)
│   ├── UserMenu.tsx          # 用户菜单 (头像/昵称/登出)
│   └── PromptEditorModal.tsx # 死代码 — 已被 AdminPrompts 替代, 无页面引用
├── admin/
│   ├── AdminLayout.tsx    # 管理后台布局 (侧边栏 + Outlet)
│   └── AdminRouteGuard.tsx # superuser 权限守卫
└── ui/  # 自定义组件库 (Button, Modal, Input, Spinner, Badge, Card, EmptyState 等)

hooks/
├── useSplitPane.ts            # 拖拽分隔条
├── useUndoRedo.ts             # 快照撤销/重做 (最大50步)
└── useResponsiveBreakpoint.ts # 响应式断点检测 (isMobile, isTouchDevice)

stores/
├── authStore.ts       # JWT token, user info, login/register/logout, initialize
├── documentStore.ts   # 文档/段落/翻译/单词解析/句子解析 全部状态
├── readerStore.ts     # fontSize, wordPanelFontSize, bgColor, fontFamily (persist → localStorage)
└── promptStore.ts     # Prompt 模板 CRUD (仅 AdminPrompts 使用)
```

**关键设计：**
- 无 Ant Design — 全部自定义 `ui/` 组件 + Tailwind CSS
- 暖色调设计系统: `--canvas: #faf9f5`, `--primary: #cc785c`, `--ink: #141413`
- 阅读页桌面端: 左右分栏，拖拽分隔条调宽度；解析面板可 ✕ 关闭 (右侧竖条按钮恢复)；点击已解析单词/句子自动打开面板并定位
- 阅读页移动端: 单栏 + 底部 FAB → StudySheet (45vh 弹出)；已解析内容点击 → FocusedAnalysisSheet (max 45vh)
- 段落渲染: `react-markdown` + `remark-gfm`，单词/句子 token 化注入，支持选中/解析/已解析三种状态
- 三个分析功能: 前端选中 → API → AI 分析 → upsert 持久化 → 下次打开自动恢复
- 认证: JWT 存 localStorage，`ProtectedRoute` 拦截未登录，`AdminRouteGuard` 检查 `is_superuser`
- 错误边界: `ErrorBoundary` 包裹 App，中文提示 + 返回首页

### 自定义 CSS

- `.word-token` — 可点击单词, hover 蓝底
- `.word-token-selected` — 选中状态, 蓝底+光晕
- `.word-token-has-analysis` — 已解析, 绿色虚线底+浅绿背景
- `.sentence-token` — 可点击句子
- `.paragraph-flash` / `@keyframes paragraph-flash-anim` — 黄色闪烁 1.5s
- `.word-card-flash` / `.sentence-card-flash` — 解析卡片闪烁定位

## 注意事项

- `ocr.parse_pdf()` 是 async，必须 `await`
- `pdf_service.py` 的 `filter_non_content`/`reconstruct_paragraphs` 是 passthrough — 实际过滤在 `OCREngine._content_list_to_paragraphs()`
- Celery tasks 仅在 `celery_app is not None` 时动态定义
- 所有 AI 端点接受可选 `api_key` + `system_prompt_override`/`user_prompt_override`
- `_SafeDict` 使未知占位符保留原文; `_is_fatal_error()` 区分认证错误和瞬时错误
- 单词分析防丢失: `_request_word_batch()` + `_missing_words()` 做单词级补偿 — AI 批次返回不全/失败时对缺失单词逐词补发; 补偿仍失败则通过 SSE `incomplete` 事件上报, 前端明确提示缺失单词(绝不静默丢弃)
- 单词分析按**段落分组**(非句子): 同段落单词共享完整段落原文作为上下文 (`{paragraph}` 占位符), 每批 ≤8 词; 兼容旧自定义模板保留 `{sentence}` 占位符(同值填充)
- 校对页 `updateParagraphs` 批量保存, `deleteParagraph`/`mergeParagraphs` 自动重排索引; `reorderParagraphs` 同步更新页码
- `PromptEditorModal.tsx` 是死代码 — Prompt 编辑唯一入口在管理后台 `/admin/prompts`
- 后端安装了但未实际使用的包: `python-docx`, `python-jose`/`passlib`(认证预留), `slowapi`(限流预留), `aiofiles`
