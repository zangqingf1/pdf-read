from fastapi import APIRouter

from app.api.v1.pdf import router as pdf_router
from app.api.v1.translate import router as translate_router

api_v1_router = APIRouter(prefix="/api/v1")

api_v1_router.include_router(pdf_router, prefix="/pdf", tags=["PDF"])
api_v1_router.include_router(translate_router, prefix="/translate", tags=["Translate"])
