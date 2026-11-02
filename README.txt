Instagram Saver
1. Double-click start.command (first run installs what it needs; if macOS blocks it, right-click > Open).
2. Your browser opens. Log in to Instagram in Chrome (or pick another browser) first.
3. Enter your username, click Test login, then Start download. Leave it running; a big saved list can take a long time.
4. Everything is saved in the "downloads" folder. Open downloads/viewer.html (double-click Open Viewer.command in that folder) to browse your saved posts offline.
Re-running only downloads new items. Press Ctrl+C in the Terminal window to quit.

Same engine and interface as Twitter Saver: Test login + automatic login check, scheduled runs, disk-space guard,
move library to another drive, a message box when a download finishes, video previews (thumbnail + length),
duplicate finder, large-files cleaner and video shrinker, plain-English error reports with Retry,
Export (CSV/JSON/printable) and "On this day".

Differences from Twitter Saver
- Only your SAVED posts can be downloaded (photos, carousels and videos, with captions). Instagram gives no list of liked posts.
- Instagram is strict about automated activity, so the app is deliberately slow: it waits 6-12 seconds between requests,
  and "Limit each run to N new posts" (Automation tab, default 300) pauses a run so you can continue it later.
  If Instagram asks you to confirm it's you, finish the check in your browser, wait an hour, then press Retry.
- Instagram doesn't send profile pictures with saved posts, so accounts show a letter instead.
- Videos are saved from Instagram's ready-made video file (no extra tools needed).
- The app runs at http://127.0.0.1:8767 (Twitter Saver uses 8765), so both can be open at once.

Notes
- Unofficial tool, not affiliated with or endorsed by Instagram or Meta. Automated access may be against Instagram's terms of service, and Instagram can restrict accounts that automate heavily. Use it with your own account, at your own risk, and keep the default slow pacing.
- Not yet tested against a live Instagram account: so far it has only been run against a stand-in for gallery-dl and a fake library. Expect rough edges in the login and download steps.
- It reads your login from your own browser through gallery-dl (https://github.com/mikf/gallery-dl), which is installed on first run and does the downloading.
- Built on macOS.

License
GNU General Public License v3.0. See the LICENSE file.
