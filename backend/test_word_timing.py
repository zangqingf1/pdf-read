"""Timing test for explain_words with 1, 5, and 7 words.

Measures:
  - network_ms: raw HTTP POST round-trip (network + LLM inference)
  - parse_ms: JSON extraction + validation
  - total_ms: end-to-end wall clock

Also simulates the frontend's batched-concurrent approach for 7 words
(2 batches of 5+2 fired via asyncio.gather, matching explainWordsInBatches).
"""

import asyncio
import json
import os
import sys
import time
from pathlib import Path

# Ensure we can import the app
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.services.ai_service import AIService

# --- Test data ----------------------------------------------------------
CONTEXT = (
    "The rapid advancement of artificial intelligence has transformed "
    "industries across the globe. Machine learning algorithms can now "
    "analyze vast amounts of data and make predictions with remarkable "
    "accuracy. However, these technologies also raise important ethical "
    "questions about privacy, bias, and the future of employment."
)

# Word sets: 1, 5, 7 words (words actually in the context)
WORDS_1 = ["advancement"]
WORDS_5 = ["advancement", "artificial", "algorithms", "predictions", "ethical"]
WORDS_7 = [
    "advancement", "artificial", "algorithms", "predictions",
    "ethical", "privacy", "employment",
]


async def time_single_call(
    ai: AIService, words: list[str], label: str
) -> dict:
    """Time a single explain_words call end-to-end with sub-step breakdown."""
    print(f"\n{'='*60}")
    print(f"[{label}] {len(words)} word(s): {words}")
    print(f"{'='*60}")

    # Wrap the httpx post to capture network timing
    original_post = ai.client.post

    network_times = []
    parse_start = 0
    parse_end = 0

    async def timed_post(url, **kwargs):
        nonlocal parse_start, parse_end
        t_req = time.perf_counter()
        result = await original_post(url, **kwargs)
        t_resp = time.perf_counter()
        network_times.append((t_req, t_resp))
        parse_start = time.perf_counter()
        return result

    ai.client.post = timed_post  # type: ignore[method-assign]

    try:
        t_total_start = time.perf_counter()
        result = await ai.explain_words(words, CONTEXT)
        t_total_end = time.perf_counter()
        parse_end = time.perf_counter()
    finally:
        ai.client.post = original_post  # type: ignore[method-assign]

    # Compute metrics
    network_ms = (
        (network_times[0][1] - network_times[0][0]) * 1000
        if network_times
        else 0
    )
    parse_ms = (parse_end - parse_start) * 1000 if parse_start else 0
    total_ms = (t_total_end - t_total_start) * 1000
    overhead_ms = total_ms - network_ms  # everything outside the HTTP call

    # Result stats
    total_chars = sum(
        len(json.dumps(item, ensure_ascii=False)) for item in result
    )
    print(f"  [TIMING] Network (HTTP POST):  {network_ms:8.1f} ms")
    print(f"  [TIMING] Parse + validate:     {parse_ms:8.1f} ms")
    print(f"  [TIMING] Other overhead:       {overhead_ms - parse_ms:8.1f} ms")
    print(f"  [TIMING] -----------------------------------")
    print(f"  [TIMING] TOTAL wall-clock:     {total_ms:8.1f} ms")
    print(f"  [DATA]   Response size: ~{total_chars} chars, {len(result)} explanations")

    # Show truncated result
    for item in result:
        w = item.get("word", "?")
        zh = item.get("definition_zh", "")[:40]
        print(f"     - {w}: {zh}...")

    return {
        "label": label,
        "words": len(words),
        "network_ms": round(network_ms, 1),
        "parse_ms": round(parse_ms, 1),
        "overhead_ms": round(overhead_ms - parse_ms, 1),
        "total_ms": round(total_ms, 1),
        "response_chars": total_chars,
        "num_explanations": len(result),
    }


async def time_batched_concurrent(
    ai_factory, words: list[str], batch_size: int = 5
) -> dict:
    """Simulate frontend's explainWordsInBatches: split into batches, fire concurrently."""
    batches = []
    for i in range(0, len(words), batch_size):
        batches.append(words[i : i + batch_size])

    print(f"\n{'='*60}")
    print(f"[Batched-concurrent] {len(words)} words -> {len(batches)} batches: {[len(b) for b in batches]}")
    print(f"{'='*60}")

    async def call_batch(batch: list[str], idx: int) -> tuple[int, dict]:
        ai = ai_factory()
        t0 = time.perf_counter()
        result = await ai.explain_words(batch, CONTEXT)
        t1 = time.perf_counter()
        await ai.close()
        return idx, {
            "batch_idx": idx,
            "batch_size": len(batch),
            "duration_ms": round((t1 - t0) * 1000, 1),
            "words_done": [item.get("word", "?") for item in result],
        }

    t_total_start = time.perf_counter()
    results = await asyncio.gather(
        *[call_batch(b, i) for i, b in enumerate(batches)]
    )
    t_total_end = time.perf_counter()
    total_ms = (t_total_end - t_total_start) * 1000

    batch_results = [r for _, r in sorted(results, key=lambda x: x[0])]
    slowest_batch = max(r["duration_ms"] for r in batch_results)

    batch_dur_str = ", ".join(f"{r['duration_ms']:.0f}ms" for r in batch_results)
    seq_sum = sum(r["duration_ms"] for r in batch_results)
    print(f"  [TIMING] Batch durations:  [{batch_dur_str}]")
    print(f"  [TIMING] Slowest batch:    {slowest_batch:.0f} ms")
    print(f"  [TIMING] TOTAL concurrent: {total_ms:.1f} ms")
    print(f"  [INFO]   Concurrency gain: {seq_sum:.0f} ms sequential -> {total_ms:.0f} ms concurrent")

    return {
        "label": f"batched-{len(words)}w-{len(batches)}b",
        "words": len(words),
        "batches": len(batches),
        "batch_durations": [r["duration_ms"] for r in batch_results],
        "slowest_batch_ms": round(slowest_batch, 1),
        "total_concurrent_ms": round(total_ms, 1),
    }


async def main():
    print("=" * 60)
    print("DeepSeek word-explanation timing test")
    print(f"  Model: deepseek-v4-flash")
    print(f"  Context: {CONTEXT[:80]}...")
    print("=" * 60)

    # --- Warm-up: single word to prime connection pool ---
    print("\n--- Warm-up (not counted) ---")
    warm = AIService()
    await warm.explain_words(["test"], "This is a test sentence.")
    await warm.close()
    print("  warm-up complete")

    # --- Test 1: 1 word (single call) ---
    ai1 = AIService()
    r1 = await time_single_call(ai1, WORDS_1, "Single-call 1 word")
    await ai1.close()

    # --- Test 2: 5 words (single call) ---
    ai2 = AIService()
    r5 = await time_single_call(ai2, WORDS_5, "Single-call 5 words")
    await ai2.close()

    # --- Test 3: 7 words (single call) ---
    ai3 = AIService()
    r7 = await time_single_call(ai3, WORDS_7, "Single-call 7 words")
    await ai3.close()

    # --- Test 4: 7 words (batched-concurrent, 5+2) ---
    ai_factory = lambda: AIService()
    r7b = await time_batched_concurrent(ai_factory, WORDS_7, batch_size=5)

    # --- Summary ---
    print(f"\n\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    header = f"  {'Test':<28} {'Words':>5} {'Network':>9} {'Parse':>8} {'Total':>9}"
    print(header)
    print(f"  {'-'*len(header)}")
    for r in [r1, r5, r7]:
        print(
            f"  {r['label']:<28} {r['words']:>5} "
            f"{r['network_ms']:>7.0f}ms {r['parse_ms']:>6.0f}ms {r['total_ms']:>7.0f}ms"
        )
    print(f"  {'-'*len(header)}")
    print(
        f"  {r7b['label']:<28} {r7b['words']:>5} "
        f"{'--':>9} {'--':>8} {r7b['total_concurrent_ms']:>7.0f}ms"
        f"  (concurrent, slowest batch: {r7b['slowest_batch_ms']:.0f}ms)"
    )

    # Compare single vs batched for 7 words
    speedup = r7["total_ms"] / r7b["total_concurrent_ms"] if r7b["total_concurrent_ms"] > 0 else 0
    print(f"\n  [INFO] 7 words: single-call {r7['total_ms']:.0f}ms vs batched-concurrent {r7b['total_concurrent_ms']:.0f}ms ({speedup:.1f}x speedup)")

    print(f"\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
