# Ani Mira — Frame Zero generator

Batch-generate candidates for the canonical Ani Mira face, then cherry-pick
one in a browser.

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export FAL_KEY="your-fal-key"
```

## Run

```bash
python generate_frame_zero.py                # 300 images, ~$0.90
python generate_frame_zero.py --count 50     # smaller batch
python generate_frame_zero.py --resume       # skip seeds already on disk
```

Outputs go to `output/`:
- `output/images/seed_XXXXXXXXXX.png` — one per generation
- `output/manifest.jsonl` — seed → path log
- `output/contact_sheet.html` — open in a browser, click to pick Frame Zero

## Cherry-pick

1. Open `output/contact_sheet.html`.
2. Scan the grid. Click the image where the face is exactly right.
3. The seed is copied to your clipboard and shown top-right. Save it.

That seed + the master prompt in `generate_frame_zero.py` =
the canonical Ani Mira. Everything downstream (LoRA training set,
asset library, video) is built off this single seed.
