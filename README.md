# AI PDF 外刊精读辅助工具

基于 AI 的 PDF 外刊精读辅助工具，提供 PDF 导入解析 → AI 精读分析（词汇/长难句）的一站式闭环。

## 功能

- **F01** PDF 导入与正文提取（PaddleOCR 版面分析）
- **F02** 生词即时点查 + 难度标注（ECDICT + COCA 词频）
- **F03** 长难句 AI 结构拆解（spaCy 初筛 + DeepSeek V3 深度分析）
- **F04** 词汇深度教学（语境释义/用法示例/搭配/词根/考点）
- **F05** 段落总结 + 全文主旨
- **F07** 生词本 + SM-2 间隔重复复习

## 技术栈

**前端**：React 18 + TypeScript + Vite + Ant Design + Tailwind CSS + D3.js + Zustand
**后端**：Python 3.12 + FastAPI + Celery + SQLAlchemy + PostgreSQL + Redis
**AI**：PaddleOCR 3.0（本地）+ DeepSeek V3 API

## 快速启动

### 1. 环境准备

```bash
# 复制环境变量
cp .env.example .env
# 编辑 .env，填入 DeepSeek API Key
```

### 2. Docker Compose 启动

```bash
docker-compose up -d
```

### 3. 访问

- 前端：[http://localhost](http://localhost)
- API 文档：[http://localhost/docs](http://localhost/docs)
- 健康检查：[http://localhost/health](http://localhost/health)

## 项目结构

```
├── frontend/          # React 前端
│   └── src/
│       ├── pages/     # 页面组件
│       ├── components/# 可复用组件
│       ├── stores/    # Zustand 状态管理
│       ├── services/  # API 调用层
│       └── hooks/     # 自定义 Hooks
├── backend/           # FastAPI 后端
│   └── app/
│       ├── api/v1/    # API 路由
│       ├── models/    # SQLAlchemy 模型
│       ├── schemas/   # Pydantic 模型
│       ├── services/  # 业务逻辑
│       └── tasks/     # Celery 异步任务
├── docker-compose.yml
├── nginx.conf
├── PRD.md
└── TECH_DESING.md
```

## 开发

```bash
# 后端开发
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# 前端开发
cd frontend
npm install
npm run dev
```

