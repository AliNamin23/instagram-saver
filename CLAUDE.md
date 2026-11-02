# Instagram Saver

A local macOS web app that downloads the user's **saved** Instagram posts with gallery-dl, using their logged-in browser's cookies, and lets them browse the library offline. It is a port of [Twitter Saver](https://github.com/AliNamin23/twitter-saver) (copied on 2026-11-01) with the same files, UI and engine layout. Python standard-library server plus vanilla JS. There is no build step and no test suite.

## Rules (read first)

- `downloads/` is the user's personal library. Do not open, list, summarise, screenshot or commit it or anything generated from it. It is git-ignored, along with `config.json` (username, browser, library path) and `run_history.json`.
- **Never loosen Instagram's throttling.** Instagram blocks fast automation. `gallery-dl.conf` sleeps 6–12 seconds between requests, and `max_per_run` (default 300, the "Limit each run" setting) pauses a run so it can continue later. Keep both. If Instagram asks the user to confirm it is them, they finish the check in the browser, wait about an hour, then retry.
- **The real login and download path has never been run.** Everything so far was tested against a stand-in gallery-dl and a fake library. Do not claim it works against Instagram. To test, copy the code (never `downloads/` or `config.json`) to a scratch folder so it starts with default config and an empty library.
- Starting the real app rewrites the library's export files, and a run downloads from the user's account. Do not do either unless asked.
- Login goes through gallery-dl's `--cookies-from-browser`. Never read browser cookies directly.

## Layout

- `app.py` — the control-panel server on `127.0.0.1:8767` (Host header checked). Routes: `/` (panel), `/items`, `/state`, `/files/*`, `/api/*`. `write_export()` rebuilds the library index and writes the offline viewer into the library folder.
- `saver_core.py` — the engine. The `Saver` class wraps gallery-dl: runs, login check, schedule, disk-space guard, moving the library, video shrinking, duplicate finder, previews, and plain-English error reports via `classify()`. `shortcode_from_id()` converts a post id to the shortcode used in Instagram URLs.
- `viewer_server.py`, `viewer.js`, `viewer.css` — the offline viewer. `viewer_server.py` defaults to port 8779.
- `index.html`, `panel.js`, `panel.css` — the control-panel UI.
- `lib_stats.py` — counts posts and size in `<library>/saved`.
- `gallery-dl.conf` — extractor settings: filename `{post_id}_{num}`, archive key `instagram{post_id}_{num}` (via `archive-format`), `videos: merged`, request sleeps, JSON metadata sidecars.
- `start.command` — creates `venv/` on first run, installs `gallery-dl` and `imageio-ffmpeg`, then runs `app.py`. `Open Viewer.command` opens the viewer.

**Edit the files in this folder, not the copies in `downloads/`.** `write_export()` overwrites the viewer files in the library folder from these root files on every export.

## Differences from Twitter Saver

- Saved posts only (no likes; Instagram gives no list of liked posts). Library kind is `saved`, files match `saved/<post_id>_<num>`.
- No profile pictures (accounts show a letter), and no deleted-post check, because Instagram's embed page returns 200 for posts that do not exist.
- The `max_per_run` limit and the slower request pacing above.
- Ports: app 8767 (Twitter 8765), viewer 8779 (Twitter 8778), so both can run together.

## Run

```bash
./start.command                        # opens Terminal, installs dependencies, starts the app
BROWSER=true ./venv/bin/python app.py  # start without popping a browser window
```

`BROWSER=true` stops Python's `webbrowser.open`, which the app calls on start.

`.claude/launch.json` has command configs (`instagram-saver`, `instagram-viewer`) and url-only attach configs (`instagram-saver-attach`, `instagram-viewer-attach`). In the Claude desktop app, `preview_start` could not spawn processes from `~/Desktop` (macOS blocks the launcher, even with Full Disk Access). Start the servers from the shell, for example with `run_in_background`, then `preview_start` the `-attach` configs. Stop the servers afterwards (`lsof -ti tcp:8767 | xargs kill`).
