"""每日一句 API — 每天返回一条英文名句（英文 + 中文翻译 + 作者）。"""

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.daily_quote import get_daily_quote

router = APIRouter()


@router.get("")
async def daily_quote(db: AsyncSession = Depends(get_db)):
    """返回今天的英文名句。

    按日期确定性取句（数据源为 daily_quotes 表，空则回退内置库），
    同一天内结果稳定、跨天自动轮换。公开端点，无需鉴权。
    """
    today = date.today()
    quote = await get_daily_quote(today, db)
    return {
        "date": today.isoformat(),
        "en": quote["en"],
        "zh": quote["zh"],
        "author": quote["author"],
    }
