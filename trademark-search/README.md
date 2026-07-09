# AU Trade Mark Search

A small, free web app for searching **Australian trade marks** in four focus
areas — **Technology & Software**, **Accounting & Finance**, **Small Business
Services**, and **AI & Machine Learning** — using IP Australia's official
[Australian Trade Mark Search API](https://portal.api.ipaustralia.gov.au/).

Everything in the stack is free: Node.js, Express, vanilla HTML/CSS/JS, and
IP Australia's API (free registration).

## How it works

```
Browser ──> Express server ──> IP Australia API
             (your machine       POST /search/quick   → trade mark numbers
              or free host)      GET  /trade-mark/{n} → full details
```

1. Your search term goes to the app's own `/api/search` endpoint.
2. The server gets an OAuth token (client-credentials grant, cached until
   expiry) and calls IP Australia's **quick search**, which returns matching
   trade mark numbers.
3. It fetches details for the top results (cached for an hour), then keeps
   only marks relevant to your selected focus areas, using a combination of
   **Nice classification classes** and **domain keywords**:

   | Focus area | Nice classes | Example keywords |
   |---|---|---|
   | Technology & Software | 9, 38, 42 | software, cloud, saas, digital |
   | Accounting & Finance | 35, 36 | accounting, tax, payroll, audit |
   | Small Business Services | 35 | small business, startup, advisory |
   | AI & Machine Learning | 9, 42 | artificial intelligence, machine learning |

   A mark must match a class **and** a keyword for a category, which stops
   broad classes like 35 flooding results with unrelated marks.
4. Your API secret never reaches the browser — the frontend only talks to
   the Express server.

## Quick start (demo mode — no credentials needed)

```bash
cd trademark-search
npm install
npm start
```

Open <http://localhost:3000>. Without credentials the app runs in **demo
mode** against a bundled sample dataset, so you can try the UI right away.
Try searching `cloud`, `tax`, or `*` (matches everything in demo mode).

## Going live with real IP Australia data (free)

1. Create a free account at the
   [IP Australia API Developer Portal](https://portal.api.ipaustralia.gov.au/).
2. Create an app in the portal and **subscribe it to the "Australian Trade
   Mark Search API"**. You'll receive a **client ID** and **client secret**.
3. Configure the app:

   ```bash
   cp .env.example .env
   # edit .env and paste in IPA_CLIENT_ID and IPA_CLIENT_SECRET
   npm start
   ```

The startup log tells you which mode you're in (`LIVE` or `DEMO`).
IP Australia offers a `test` sandbox environment too — set `IPA_ENV=test`
if your credentials are for the sandbox.

## Free deployment options

The app is a single small Node server, so any free Node host works:

- **Render** (free web service): create a Web Service from this repo,
  root directory `trademark-search`, build `npm install`, start `npm start`,
  and add `IPA_CLIENT_ID` / `IPA_CLIENT_SECRET` as environment variables.
- **Railway / Fly.io / Glitch**: same idea — set the two env vars and go.
- Or just run it locally with `npm start`.

## API endpoints (served by this app)

- `GET /api/meta` — mode (live/demo), category list, statuses.
- `GET /api/search?q=cloud&categories=tech,ai&statuses=REGISTERED,PENDING`
  — returns filtered, normalised trade marks:

  ```json
  {
    "mode": "live",
    "count": 3,
    "results": [
      {
        "number": "2001001",
        "words": "CLOUDLEDGER",
        "status": "Registered",
        "classes": [9, 35, 42],
        "goodsServices": [{ "classNumber": 9, "description": "…" }],
        "owners": ["CloudLedger Pty Ltd"],
        "categories": ["tech", "accounting"],
        "detailsUrl": "https://search.ipaustralia.gov.au/trademarks/search/view/2001001"
      }
    ]
  }
  ```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `IPA_CLIENT_ID` / `IPA_CLIENT_SECRET` | _(empty → demo mode)_ | Free credentials from the developer portal |
| `IPA_ENV` | `production` | `production` or `test` (sandbox) |
| `IPA_BASE_URL` | _(derived from IPA_ENV)_ | Override the API host entirely |
| `PORT` | `3000` | Web server port |
| `MAX_DETAIL_LOOKUPS` | `60` | Detail fetches per search (rate-limit guard) |

To tune the focus areas (classes/keywords), edit `lib/categories.js`.

## Notes & disclaimers

- Results are filtered heuristically; always verify on the
  [official register](https://search.ipaustralia.gov.au/) before acting.
- This tool is not legal advice.
- Data © IP Australia, used under their API terms.
