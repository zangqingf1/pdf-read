"""真实 API 冒烟测试 — 验证单词流式解析 + 补偿链路。

消耗少量真实 token (8 个单词)。用法:
    cd backend && python scripts/smoke_word_analysis.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.services.ai_service import AIService  # noqa: E402


WORDS = [
    "gravity", "phenomenon", "orbit", "trajectory",
    "velocity", "satellite", "celestial", "astronaut",
]
SENTENCE = (
    "Gravity shapes the trajectory of every celestial body, "
    "and the velocity of a satellite in orbit is a phenomenon "
    "observed by astronauts."
)


async def main() -> int:
    if not settings.DEEPSEEK_API_KEY or settings.DEEPSEEK_API_KEY.startswith("your_"):
        print("!! 未配置真实 DEEPSEEK_API_KEY, 跳过冒烟测试")
        return 1

    ai = AIService(
        api_key=settings.DEEPSEEK_API_KEY,
        base_url=settings.DEEPSEEK_BASE_URL,
        model=settings.DEEPSEEK_MODEL,
    )
    print(f"model={ai.model} base_url={ai.base_url}")

    entries = [
        {"paragraph_index": 0, "word": w, "sentence": SENTENCE, "sentence_translation": None}
        for w in WORDS
    ]

    print("=== 流式解析 8 个单词 (同段落同句子 → 1 个批次) ===")
    events = []
    async for e in ai.analyze_words_stream(entries):
        events.append(e)

    chunks = [e for e in events if e["type"] == "chunk"]
    batches = [e for e in events if e["type"] == "batch"]
    incomplete = [e for e in events if e["type"] == "incomplete"]

    print(f"chunk 事件: {len(chunks)} 条, batch 事件: {len(batches)} 条, incomplete: {len(incomplete)}")

    results = [r for b in batches for r in b["results"]]
    got = {r["word"].lower() for r in results}
    print(f"解析成功: {len(got)}/8 {sorted(got)}")
    missing = [w for w in WORDS if w not in got]
    if missing:
        print(f"!! 缺失: {missing}")
        if incomplete:
            print(f"incomplete 上报: {incomplete[0]['words']}")
        else:
            print("!! BUG: 有缺失但无 incomplete 上报!")
    else:
        print("✓ 8/8 全部解析 (无缺失, 补偿未触发)")

    # 打印一个样本, 验证字段完整
    if results:
        r = results[0]
        print(f"\n样本 {r['word']}: pos={r['part_of_speech']!r} def={r['definition'][:60]!r} zh={r['definition_zh'][:30]!r}")

    await ai.close()
    return 0 if not missing else 2


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
