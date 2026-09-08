from fastapi import APIRouter

from app.api.v1.admin import router as admin_router
from app.api.v1.pdf import router as pdf_router
from app.api.v1.prompts import router as prompts_router
from app.api.v1.qa import router as qa_router
from app.api.v1.quote import router as quote_router
from app.api.v1.sentences import router as sentences_router
from app.api.v1.srs import router as srs_router
from app.api.v1.summary import router as summary_router
from app.api.v1.translate import router as translate_router
from app.api.v1.tts import router as tts_router
from app.api.v1.vocabulary import router as vocabulary_router
from app.api.v1.words import router as words_router

api_v1_router = APIRouter(prefix="/api/v1")

api_v1_router.include_router(admin_router, prefix="/admin", tags=["Admin"])
api_v1_router.include_router(pdf_router, prefix="/pdf", tags=["PDF"])
api_v1_router.include_router(prompts_router, prefix="/prompts", tags=["Prompts"])
api_v1_router.include_router(qa_router, prefix="/qa", tags=["QA"])
api_v1_router.include_router(quote_router, prefix="/quote", tags=["Quote"])
api_v1_router.include_router(sentences_router, prefix="/sentences", tags=["Sentences"])
api_v1_router.include_router(srs_router, prefix="/srs", tags=["SRS"])
api_v1_router.include_router(summary_router, prefix="/summary", tags=["Summary"])
api_v1_router.include_router(translate_router, prefix="/translate", tags=["Translate"])
api_v1_router.include_router(tts_router, prefix="/tts", tags=["TTS"])
api_v1_router.include_router(vocabulary_router, prefix="/vocabulary", tags=["Vocabulary"])
api_v1_router.include_router(words_router, prefix="/words", tags=["Words"])
