"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import update

from app.config import settings
from app.database import init_db, close_db, async_session_factory
from app.models import *  # noqa: F401,F403 — ensure all models are registered
from app.models.document import Document
from app.api.v1 import api_v1_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown events."""
    # Startup: always create tables on startup (create_all is idempotent)
    await init_db()

    # Recover orphaned documents left in transient states by a server restart.
    # BackgroundTasks are in-memory and die with the process, so any document
    # stuck in "processing" or "awaiting_selection" will never complete.
    async with async_session_factory() as db:
        for status in ("processing", "awaiting_selection"):
            stmt = (
                update(Document)
                .where(Document.parse_status == status)
                .values(
                    parse_status="failed",
                    error_message=f"Server restarted while document was in '{status}' state. Please re-upload.",
                )
            )
            await db.execute(stmt)
        await db.commit()

    yield
    # Shutdown
    await close_db()


app = FastAPI(
    title="AI PDF 外刊精读辅助工具",
    description="PDF import → AI intensive reading analysis → vocabulary review",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost",
        "http://127.0.0.1",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(api_v1_router)


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": "1.0.0", "environment": settings.ENVIRONMENT}
