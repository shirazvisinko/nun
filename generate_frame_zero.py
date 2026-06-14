"""
Frame Zero batch generator for Ani Mira.

Calls Fal.ai Flux Schnell N times with the locked master prompt,
varying seeds, saves each PNG with the seed in the filename,
and writes a contact-sheet HTML so you can scan all candidates
in a browser and pick Frame Zero.

Usage:
    pip install -r requirements.txt
    export FAL_KEY="..."
    python generate_frame_zero.py            # default: 300 images
    python generate_frame_zero.py --count 50 # smaller batch
    python generate_frame_zero.py --resume   # skip seeds already on disk

Cherry-pick:
    open output/contact_sheet.html
    Click any image to copy its seed.
    Note your chosen seed somewhere safe — it's the canonical Ani Mira.
"""

import argparse
import asyncio
import json
import os
import random
import sys
from pathlib import Path

import fal_client
import httpx

MASTER_PROMPT = (
    "Ani Mira, 30-year-old woman, mixed European and South Asian features, "
    "shaved head, warm olive skin, dark almond eyes, full eyebrows, small nose, "
    "soft jawline, faint freckles across nose bridge, no makeup, no jewelry, "
    "wearing maroon Tibetan Buddhist nun robes with saffron underlayer, "
    "calm neutral expression, soft natural lighting, shallow depth of field, "
    "35mm film grain, cinematic, portrait, head and shoulders"
)

NEGATIVE_PROMPT = (
    "makeup, jewelry, hair, broad smile, teeth, modern clothing, watch, "
    "phone, laptop, neon, ring light, flash, hard shadows, oversaturation, "
    "plastic skin, anime, extra fingers, deformed"
)

MODEL = "fal-ai/flux/schnell"
IMAGE_SIZE = "portrait_4_3"
NUM_INFERENCE_STEPS = 4
CONCURRENCY = 10
OUTPUT_DIR = Path("output")
IMAGES_DIR = OUTPUT_DIR / "images"
MANIFEST = OUTPUT_DIR / "manifest.jsonl"
CONTACT_SHEET = OUTPUT_DIR / "contact_sheet.html"


async def generate_one(seed: int, client: httpx.AsyncClient, sem: asyncio.Semaphore) -> dict | None:
    async with sem:
        try:
            handler = await fal_client.submit_async(
                MODEL,
                arguments={
                    "prompt": MASTER_PROMPT,
                    "image_size": IMAGE_SIZE,
                    "num_inference_steps": NUM_INFERENCE_STEPS,
                    "num_images": 1,
                    "enable_safety_checker": True,
                    "seed": seed,
                },
            )
            result = await handler.get()
            url = result["images"][0]["url"]

            r = await client.get(url, timeout=60.0)
            r.raise_for_status()
            path = IMAGES_DIR / f"seed_{seed:010d}.png"
            path.write_bytes(r.content)
            return {"seed": seed, "path": str(path.relative_to(OUTPUT_DIR)), "url": url}
        except Exception as e:
            print(f"  seed {seed} failed: {e}", file=sys.stderr)
            return None


def existing_seeds() -> set[int]:
    if not IMAGES_DIR.exists():
        return set()
    seeds = set()
    for p in IMAGES_DIR.glob("seed_*.png"):
        try:
            seeds.add(int(p.stem.split("_")[1]))
        except (IndexError, ValueError):
            pass
    return seeds


def write_contact_sheet(records: list[dict]) -> None:
    records = sorted(records, key=lambda r: r["seed"])
    cards = "\n".join(
        f"""<div class="card" data-seed="{r['seed']}" onclick="pick({r['seed']})">
              <img src="{r['path']}" loading="lazy"/>
              <div class="seed">{r['seed']}</div>
            </div>"""
        for r in records
    )
    html = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Ani Mira — Frame Zero contact sheet</title>
<style>
  body {{ background:#1a1614; color:#e8ddd0; font-family:-apple-system,sans-serif;
          margin:0; padding:24px; }}
  h1 {{ font-weight:400; letter-spacing:0.04em; }}
  .picked {{ position:fixed; top:16px; right:16px; background:#3a2820; padding:12px 18px;
             border-radius:8px; font-family:monospace; font-size:14px; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; }}
  .card {{ cursor:pointer; border:2px solid transparent; border-radius:6px;
           overflow:hidden; background:#000; transition:border-color 0.15s; }}
  .card:hover {{ border-color:#a67860; }}
  .card.selected {{ border-color:#d4a574; }}
  .card img {{ width:100%; display:block; }}
  .seed {{ padding:6px 8px; font-family:monospace; font-size:11px; opacity:0.7; }}
</style></head>
<body>
<h1>Ani Mira — Frame Zero candidates ({len(records)})</h1>
<p>Click an image to mark it as Frame Zero. The seed is copied to your clipboard
and shown top-right. Note it down — that seed + this prompt = canonical Ani Mira.</p>
<div class="picked" id="picked">no selection</div>
<div class="grid">{cards}</div>
<script>
function pick(seed) {{
  document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
  document.querySelector(`.card[data-seed="${{seed}}"]`).classList.add('selected');
  document.getElementById('picked').textContent = 'Frame Zero seed: ' + seed;
  navigator.clipboard.writeText(String(seed));
}}
</script>
</body></html>"""
    CONTACT_SHEET.write_text(html)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=300)
    parser.add_argument("--resume", action="store_true",
                        help="Skip seeds already on disk")
    parser.add_argument("--seed-start", type=int, default=1,
                        help="Deterministic seed range start (1..count)")
    args = parser.parse_args()

    if not os.getenv("FAL_KEY"):
        print("ERROR: FAL_KEY not set. Run: export FAL_KEY=\"...\"", file=sys.stderr)
        sys.exit(1)

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    target_seeds = list(range(args.seed_start, args.seed_start + args.count))
    if args.resume:
        done = existing_seeds()
        target_seeds = [s for s in target_seeds if s not in done]
        print(f"Resume: {len(done)} already on disk, {len(target_seeds)} to generate")
    else:
        print(f"Generating {len(target_seeds)} images at ~$0.003/image "
              f"= ~${len(target_seeds) * 0.003:.2f} on Flux Schnell")

    sem = asyncio.Semaphore(CONCURRENCY)
    records: list[dict] = []

    if MANIFEST.exists():
        for line in MANIFEST.read_text().splitlines():
            if line.strip():
                records.append(json.loads(line))

    async with httpx.AsyncClient() as client:
        with MANIFEST.open("a") as mf:
            tasks = [generate_one(s, client, sem) for s in target_seeds]
            done = 0
            for coro in asyncio.as_completed(tasks):
                rec = await coro
                done += 1
                if rec:
                    records.append(rec)
                    mf.write(json.dumps(rec) + "\n")
                    mf.flush()
                if done % 10 == 0:
                    print(f"  {done}/{len(target_seeds)}")

    # Dedup by seed in case of resume overlap
    seen = {}
    for r in records:
        seen[r["seed"]] = r
    write_contact_sheet(list(seen.values()))

    print(f"\nDone. {len(seen)} images in {IMAGES_DIR}/")
    print(f"Open {CONTACT_SHEET} in a browser to cherry-pick Frame Zero.")


if __name__ == "__main__":
    asyncio.run(main())
