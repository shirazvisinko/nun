"""
Generate 30 variants of Ani Mira using Fal PuLID-Flux with frame_zero.png
as the identity reference.

Reads FAL_KEY from env. Uploads frame_zero.png once, then runs all 30
prompts concurrently. Saves PNGs to output/variants/ and builds a
contact_sheet.html in output/.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

import fal_client
import httpx

REFERENCE = Path("frame_zero.png")
OUT_DIR = Path("output/variants")
SHEET = Path("output/variants_contact_sheet.html")
MANIFEST = Path("output/variants_manifest.jsonl")
MODEL = "fal-ai/flux-pulid"
CONCURRENCY = 5

PROMPTS = [
    # Face / angle anchors (10)
    ("01_front_neutral", "a Buddhist nun, head-on portrait, neutral expression, soft window light, monastery interior, 35mm film, cinematic, calm gaze"),
    ("02_three_quarter_left", "a Buddhist nun, three-quarter profile facing left, calm gaze, soft natural light, monastery courtyard, cinematic"),
    ("03_three_quarter_right", "a Buddhist nun, three-quarter profile facing right, calm gaze, soft natural light, monastery courtyard, cinematic"),
    ("04_profile_left", "a Buddhist nun, full profile facing left, looking forward, soft side light, monastery, cinematic"),
    ("05_eyes_closed_meditation", "a Buddhist nun, eyes closed in meditation, soft natural light, serene expression, monastery hall, cinematic"),
    ("06_looking_down_candlelight", "a Buddhist nun, looking down slightly, contemplative expression, warm candlelight, dim altar, cinematic"),
    ("07_looking_up_dawn", "a Buddhist nun, looking up at sky, soft dawn light, peaceful expression, mountain monastery, cinematic"),
    ("08_half_face_candle", "a Buddhist nun, half-face lit by candlelight, half in soft shadow, contemplative, cinematic"),
    ("09_slight_smile_afternoon", "a Buddhist nun, very slight gentle smile, warm afternoon golden hour light, monastery courtyard, cinematic"),
    ("10_head_shoulders_overcast", "a Buddhist nun, head and shoulders portrait, soft overcast morning light, calm expression, stone wall behind, cinematic"),

    # Body / setting anchors (12)
    ("11_meditation_cushion_full", "a Buddhist nun sitting cross-legged on meditation cushion, full body, beam of light from window, wooden hall, cinematic"),
    ("12_doorway_silhouette", "a Buddhist nun standing in monastery doorway, silhouette, mist rolling in behind her, dawn, cinematic"),
    ("13_walking_courtyard_back", "a Buddhist nun walking through stone courtyard, seen from behind, robes flowing, soft morning light, cinematic"),
    ("14_walking_pine_forest", "a Buddhist nun walking toward camera through pine forest path, mid-distance, dappled light, cinematic"),
    ("15_seated_tea_low_table", "a Buddhist nun seated at low wooden table with clay teacup, three-quarter view, warm window light, cinematic"),
    ("16_pouring_tea", "a Buddhist nun pouring tea from clay teapot, hands and torso visible, calm focus, soft natural light, cinematic"),
    ("17_lighting_butter_lamp", "a Buddhist nun lighting butter lamp at altar, side view, golden glow on face, cinematic"),
    ("18_holding_mala", "a Buddhist nun holding mala beads, hands in lap, seated meditation posture, soft light, cinematic"),
    ("19_sweeping_stone", "a Buddhist nun sweeping stone floor with bamboo broom, soft morning light, courtyard, cinematic"),
    ("20_reading_candle", "a Buddhist nun reading a small book by candlelight, side view, dim warm interior, cinematic"),
    ("21_open_window_mountains", "a Buddhist nun standing at open window, looking out at distant mountains, soft daylight, cinematic"),
    ("22_herb_garden_walking", "a Buddhist nun walking through herb garden, mid-distance, golden hour, cinematic"),

    # Lighting variations (8)
    ("23_meditation_goldenhour", "a Buddhist nun seated in meditation, warm golden hour window light, peaceful, monastery hall, cinematic"),
    ("24_meditation_candlelight", "a Buddhist nun seated in meditation, candlelight only, dim warm glow, deep shadows, cinematic"),
    ("25_meditation_overcast", "a Buddhist nun seated in meditation, overcast diffuse cool light, stone room, cinematic"),
    ("26_meditation_snow", "a Buddhist nun seated in meditation, cool snow light through window, blue tones, cinematic"),
    ("27_portrait_dawn_mist", "a Buddhist nun portrait, soft dawn light, mist drifting in background, calm gaze, cinematic"),
    ("28_portrait_late_afternoon", "a Buddhist nun portrait, late afternoon warm golden window light, calm gaze, cinematic"),
    ("29_portrait_night_candle", "a Buddhist nun portrait, night, single candle, deep shadows, contemplative, cinematic"),
    ("30_portrait_dawn_pink", "a Buddhist nun portrait, dawn pink light through paper screen, soft glow, calm gaze, cinematic"),
]

NEGATIVE = "makeup, jewelry, hair, broad smile, teeth, modern clothing, watch, phone, laptop, neon, ring light, flash, hard shadows, oversaturation, plastic skin, anime, extra fingers, deformed, costume"


async def generate(slug: str, prompt: str, ref_url: str,
                   client: httpx.AsyncClient, sem: asyncio.Semaphore) -> dict | None:
    async with sem:
        try:
            handler = await fal_client.submit_async(
                MODEL,
                arguments={
                    "prompt": prompt + ", wearing maroon Tibetan Buddhist nun robes with saffron underlayer, shaved head, no makeup",
                    "reference_image_url": ref_url,
                    "negative_prompt": NEGATIVE,
                    "image_size": "portrait_4_3",
                    "num_inference_steps": 28,
                    "guidance_scale": 4.0,
                    "true_cfg": 1.0,
                    "id_weight": 0.85,
                    "num_images": 1,
                    "enable_safety_checker": True,
                },
            )
            result = await handler.get()
            url = result["images"][0]["url"]

            r = await client.get(url, timeout=120.0)
            r.raise_for_status()
            path = OUT_DIR / f"{slug}.png"
            path.write_bytes(r.content)
            print(f"  ok  {slug}")
            return {"slug": slug, "prompt": prompt, "path": f"variants/{slug}.png"}
        except Exception as e:
            print(f"  FAIL {slug}: {e}", file=sys.stderr)
            return {"slug": slug, "prompt": prompt, "error": str(e)}


def write_sheet(records: list[dict]) -> None:
    cards = []
    for r in records:
        if "error" in r:
            cards.append(f"""<div class="card err">
              <div class="ph">FAILED</div>
              <div class="slug">{r['slug']}</div>
              <div class="err-msg">{r['error']}</div>
            </div>""")
        else:
            cards.append(f"""<div class="card">
              <img src="{r['path']}" loading="lazy"/>
              <div class="slug">{r['slug']}</div>
            </div>""")
    html = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Ani Mira — variant set</title>
<style>
  body {{ background:#1a1614; color:#e8ddd0; font-family:-apple-system,sans-serif;
          margin:0; padding:24px; }}
  h1 {{ font-weight:400; letter-spacing:0.04em; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:14px; }}
  .card {{ background:#000; border-radius:6px; overflow:hidden; border:2px solid transparent; }}
  .card.err {{ background:#3a1818; }}
  .card img {{ width:100%; display:block; }}
  .ph {{ padding:80px 0; text-align:center; opacity:0.6; }}
  .slug {{ padding:8px 10px; font-family:monospace; font-size:12px; opacity:0.75; }}
  .err-msg {{ padding:0 10px 10px; font-size:11px; opacity:0.6; }}
</style></head>
<body>
<h1>Ani Mira — variant set ({sum(1 for r in records if 'error' not in r)}/{len(records)} succeeded)</h1>
<p>Review for face consistency. Cull anything where she stops looking like Ani Mira before LoRA training.</p>
<div class="grid">{''.join(cards)}</div>
</body></html>"""
    SHEET.write_text(html)


async def main() -> None:
    if not os.getenv("FAL_KEY"):
        print("ERROR: FAL_KEY not set", file=sys.stderr); sys.exit(1)
    if not REFERENCE.exists():
        print(f"ERROR: {REFERENCE} not found", file=sys.stderr); sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Uploading {REFERENCE} as identity reference...")
    ref_url = await fal_client.upload_file_async(str(REFERENCE))
    print(f"Reference URL ready.\nGenerating {len(PROMPTS)} variants at concurrency {CONCURRENCY}...")

    sem = asyncio.Semaphore(CONCURRENCY)
    records: list[dict] = []

    async with httpx.AsyncClient() as client:
        tasks = [generate(slug, prompt, ref_url, client, sem) for slug, prompt in PROMPTS]
        for coro in asyncio.as_completed(tasks):
            rec = await coro
            if rec:
                records.append(rec)

    with MANIFEST.open("w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")

    records.sort(key=lambda r: r["slug"])
    write_sheet(records)

    ok = sum(1 for r in records if "error" not in r)
    print(f"\nDone. {ok}/{len(records)} variants saved to {OUT_DIR}/")
    print(f"Contact sheet: {SHEET}")


if __name__ == "__main__":
    asyncio.run(main())
