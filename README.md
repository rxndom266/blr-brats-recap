# BLR Brats Wrapped

An anonymised, interactive recap of the BLR Brats group chat (9 to 18 Nov). It is one self-contained file, `index.html`, with no build step. It loads three Google Fonts (Anton, Inter, Caveat) and falls back to system fonts if they are blocked.

## Host it on GitHub Pages

1. On GitHub, click **New repository**. Name it something like `blr-brats-recap`. Choose **Public** (GitHub Pages on a free account only works with public repos).
2. Click **uploading an existing file**, drag in `index.html` (and this README if you like), then **Commit changes**.
3. Go to **Settings > Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, pick the `main` branch and the `/ (root)` folder, then **Save**.
4. Wait a minute or two. Your link will be `https://<your-username>.github.io/blr-brats-recap/`. Open it to check it works, then share it.

## Notes

- A public repo and page can be opened by anyone with the link. The page has a `noindex` tag so search engines should skip it, but that is a request, not a lock.
- To update the page later, edit `index.html` in the repo and commit. Pages redeploys on its own.
- The page contains no names or phone numbers. Check with the group admins before sharing it outside the group.

## What is in the repo

- `index.html` is the Wrapped page. `people.html` is the profiles page. `avatar.js` draws the pixel faces. They load `chat/*.json`, so they need to be served over http (GitHub Pages is fine, opening the file directly is not).
- `chat/` is generated and safe to publish. `data/personas.json` holds the written personas (name, tagline, persona, takes), keyed by each person's made-up name.
- Press play shows the last three days in `index.html`. Every day is still on the home page.

## Updating the chat excerpts

The "Read the actual chat" dialogs are built from WhatsApp exports. Everything is anonymised before it reaches the site.

1. In WhatsApp, export the chat **without media** and drop the `.zip` (or `_chat.txt`) into `exports/`. Exports can overlap with earlier ones, messages are de-duplicated.
2. Run `node scripts/build-chat.mjs`. It rewrites `chat/index.json` and one `chat/YYYY-MM-DD.json` per day.
3. Anyone new gets a personality-flavoured name and an auto-written persona from their stats. To give someone a hand-written persona or a better name, change their entry in `exports/aliases.json` and add the persona to `data/personas.json`, then re-run. Written personas are a snapshot, so counts inside them can go stale.
4. Read the "Review these messages" list it prints. To blank a word everywhere, add it to `exports/redactions.txt`. To drop a whole message, add `!some phrase` instead. Re-run.
5. Commit `chat/`, `data/` (and any change to `index.html`). Never commit `exports/`.

What the script does: each sender gets a stable made-up label (kept in `exports/aliases.json`, edit it to rename anyone), real names are replaced inside messages, links keep only their domain, phone numbers, emails and handles are removed, and self-introductions (name, age, area, job) are hidden. Messages are lightly tidied (capital letters, "I'm", missing apostrophes, end punctuation). ALL CAPS, stretched words and anything listed in `exports/preserve.txt` are left as typed, and the dialog has a "Show as typed" toggle. This is a best effort, it cannot know every name or personal detail, so skim the output before you push.

`exports/` is in `.gitignore` on purpose: the raw files contain real names and phone numbers, and this repo is public.

New days in `chat/` show up in the dialog automatically, but the day-by-day Wrapped summaries in `index.html` are written by hand, so a new day needs its summary added there too.
