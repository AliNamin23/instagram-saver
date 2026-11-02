"""Engine for Instagram Saver.

Runs gallery-dl with your logged-in browser session and manages everything around it:
auto-stop, per-run limit, scheduled runs, disk-space guard, moving the library, pop-up notifications,
video previews, duplicate finder, plain-English error reports and a login check.
Everything stays on this computer."""
import hashlib, json, os, re, shutil, sqlite3, subprocess, sys, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

import lib_stats

BROWSERS = ("chrome", "brave", "firefox", "safari", "edge")
KINDS = ("saved",)  # library sub-folders: <library>/saved holds every saved post
ABORT_AFTER = 25  # quick update: stop after this many posts in a row that are already saved
VIDEO_EXT = (".mp4", ".webm", ".mov", ".m4v")
SKIP_EXT = (".json", ".part", ".tmp")
PRESETS = {"720": (720, 27), "480": (480, 28), "360": (360, 30)}  # preset -> (max height, x264 quality)
MEDIA_RE = re.compile(r"^(saved)/(\d+)_(\d+)\.[A-Za-z0-9]+$")
_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"


def shortcode_from_id(pid):
    """The short code in an Instagram post link (instagram.com/p/<code>/) is the post id written in base 64."""
    n, out = int(pid), ""
    while n:
        n, r = divmod(n, 64)
        out = _ALPHABET[r] + out
    return out or _ALPHABET[0]


def human(n):
    for unit, size in (("TB", 1e12), ("GB", 1e9), ("MB", 1e6)):
        if n >= size:
            return f"{n / size:.1f} {unit}"
    return f"{n / 1e3:.0f} KB"


def classify(lines, rc, browser="your browser"):
    """Turn raw gallery-dl output into a plain-English problem report."""
    text = "\n".join(lines[-60:])
    low = text.lower()
    saved = "Your progress is saved, so pressing Retry continues where it stopped."
    if re.search(r"no space left|errno 28", low):
        return {"kind": "disk", "title": "The drive is full", "advice": "Free up space or move your library to a bigger drive, then press Retry. " + saved, "retry": True}
    if re.search(r"keyring|keychain|safe storage|failed to decrypt|operation not permitted|permission denied.*cookies", low):
        return {"kind": "keychain", "title": f"Couldn't read {browser}'s saved login", "advice": f"macOS may have asked for permission to read {browser}'s cookies. Press Retry and choose Allow. Safari also needs Full Disk Access for Terminal.", "retry": True}
    if re.search(r"challenge_required|checkpoint_required|redirect to challenge|feedback_required|action blocked|suspicious|confirm it'?s you|please wait a few minutes", low):
        return {"kind": "blocked", "title": "Instagram wants to confirm it's you", "advice": f"Open instagram.com in {browser} and finish any security check it shows. Then wait about an hour before pressing Retry. A lower \"Limit each run\" (Automation tab) helps keep this from happening again. " + saved, "retry": True}
    if re.search(r"authenticationerror|login required|login_required|authorizationerror|\b401\b|could not authenticate|not logged in|you have to log in|redirect to login|redirect to home|\blog in\b", low):
        return {"kind": "login", "title": "You're not logged in to Instagram", "advice": f"Open instagram.com in {browser}, log in, then press Retry. " + saved, "retry": True}
    if re.search(r"\b429\b|rate.?limit|too many requests", low):
        return {"kind": "rate", "title": "Instagram asked us to slow down", "advice": "That's a temporary limit. Wait about an hour, then press Retry. " + saved, "retry": True}
    if re.search(r"notfounderror|user .* not found|unable to retrieve|does not exist|suspended", low):
        return {"kind": "notfound", "title": "Couldn't find that Instagram account", "advice": "Check the spelling of your username (no @), then try again.", "retry": False}
    if re.search(r"connectionerror|timed out|timeout|name or service not known|nodename nor servname|network is unreachable|ssl|temporary failure|max retries", low):
        return {"kind": "network", "title": "No internet connection", "advice": "Check your connection, then press Retry. " + saved, "retry": True}
    return {"kind": "error", "title": "Finished with some errors", "advice": "Some items couldn't be downloaded. Press Retry to try them again, or open the log below for details. " + saved, "retry": True}


class Saver:
    def __init__(self, root, config_path, default_dir, on_change=None):
        self.root, self.config_path = root, config_path
        self.cfg = {"dir": default_dir, "user": "", "browser": "chrome", "kinds": ["saved"], "auto_stop": True, "complete": {},
                    "schedule_minutes": 0, "next_run": 0, "notify": True, "min_free_gb": 5, "max_per_run": 300}
        try:
            with open(config_path) as f:
                self.cfg.update(json.load(f))
        except Exception:
            pass
        self.state = {"running": False, "refreshing": False, "log": [], "proc": None, "outcome": None, "reason": ""}
        self.lock = threading.Lock()
        self.tracker = lib_stats.Tracker(lambda: self.cfg["dir"])
        self.on_change = on_change or (lambda what: None)
        self.move = {"active": False, "phase": "", "done_bytes": 0, "total_bytes": 0, "done_files": 0, "total_files": 0, "started": 0, "error": "", "message": "", "samples": []}
        self.previews = {"active": False, "done": 0, "total": 0, "error": ""}
        self.shrink = {"active": False, "total": 0, "done": 0, "current": "", "pct": 0.0, "saved": 0, "skipped": [], "failed": [], "preset": "", "started": 0, "stop": False}
        self.dupes = {"active": False, "phase": "", "done": 0, "total": 0, "groups": 0, "wasted": 0, "applied": 0}
        self._side_cache = {}
        self.alert, self._aid = None, 0
        self.history_path = os.path.join(root, "run_history.json")
        self.history, self._cur = self._load_history(), None

    # ---------- basics ----------
    @property
    def dir(self):
        return self.cfg["dir"]

    def save_cfg(self):
        with open(self.config_path, "w") as f:
            json.dump(self.cfg, f)

    def log(self, line):
        with self.lock:
            self.state["log"].append(line.rstrip())
            del self.state["log"][:-400]

    def path(self, *parts):
        return os.path.join(self.dir, *parts)

    def available(self):
        return os.path.isdir(os.path.dirname(self.dir.rstrip("/")))

    def _mac_available(self, path):
        """Free space the way Finder and System Settings count it. It includes space macOS gives back by itself
        (old Time Machine snapshots, caches), so it matches what you see in System Settings > Storage."""
        if sys.platform != "darwin":
            return None
        c = getattr(self, "_mac_cache", None)
        now = time.time()
        if c and c[0] == path and now - c[1] < 10:
            return c[2]
        val = None
        try:
            script = ('ObjC.import("Foundation");var k="NSURLVolumeAvailableCapacityForImportantUsageKey";'
                      'var v=$.NSURL.fileURLWithPath(%s).resourceValuesForKeysError($([k]),$());v?ObjC.unwrap(v.objectForKey(k)):""' % json.dumps(path))
            r = subprocess.run(["osascript", "-l", "JavaScript", "-e", script], capture_output=True, text=True, timeout=6)
            if r.returncode == 0 and r.stdout.strip():
                val = int(float(r.stdout.strip()))
        except Exception:
            val = None
        self._mac_cache = (path, now, val)
        return val

    def disk(self):
        p = self.dir
        while p and not os.path.exists(p):
            nxt = os.path.dirname(p)
            if nxt == p:
                break
            p = nxt
        try:
            u = shutil.disk_usage(p or "/")
        except OSError:
            return None
        free, mac = u.free, self._mac_available(p or "/")
        if mac and mac > free:
            free = min(mac, u.total)
        mn = float(self.cfg["min_free_gb"]) * 1e9
        return {"free": free, "raw_free": u.free, "purgeable": free - u.free, "total": u.total, "min": mn, "low": free < mn}

    def raise_alert(self, kind, title, advice="", retry=False, **extra):
        """Queue a message box for the page to show once (download finished, move finished, scheduled run skipped...)."""
        self._aid += 1
        self.alert = dict(id=self._aid, kind=kind, title=title, advice=advice, retry=retry, **extra)

    def ffmpeg(self):
        exe = shutil.which("ffmpeg")
        if exe:
            return exe
        try:
            import imageio_ffmpeg
            return imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            return None

    # ---------- run history (kept on disk, so it survives restarts and crashes) ----------
    def _load_history(self):
        try:
            with open(self.history_path, encoding="utf-8") as f:
                h = json.load(f)
        except Exception:
            h = []
        changed = False
        for r in h:
            if r.get("status") == "running":  # the app was closed in the middle of this run
                r.update(status="interrupted", ended=r.get("updated") or r.get("started"),
                         outcome={"kind": "interrupted", "title": "Interrupted: the app was closed during this run",
                                  "advice": "Press Start to continue. Your progress was saved.", "retry": True})
                changed = True
        if changed:
            self._write_history(h)
        return h

    def _write_history(self, h=None):
        h = self.history if h is None else h
        tmp = self.history_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(h[-500:], f)
        os.replace(tmp, self.history_path)

    def _record_start(self, user, kinds, scheduled):
        now = time.time()
        self._cur = {"id": int(now * 1000), "status": "running", "started": now, "updated": now, "ended": None, "user": user, "kinds": kinds, "scheduled": bool(scheduled),
                     "modes": {}, "new": 0, "files": 0, "bytes": 0, "seconds": 0, "dir": self.dir, "total": self.tracker.lib["posts"], "outcome": None}
        self.history.append(self._cur)
        self._write_history()

    def _touch_run(self):
        """Save the live numbers, so even a crash leaves an accurate record."""
        if not self._cur:
            return
        r = self.tracker.snapshot()["run"] or {}
        self._cur.update(updated=time.time(), new=r.get("posts", 0), files=r.get("files", 0), bytes=r.get("bytes", 0), seconds=r.get("seconds", 0))
        self._write_history()

    def _record_end(self, outcome, n, size, files, seconds):
        if not self._cur:
            return
        self._cur.update(status="done", ended=time.time(), updated=time.time(), new=n, bytes=size, files=files, seconds=seconds, total=self.tracker.lib["posts"],
                         outcome={k: outcome.get(k, "") for k in ("kind", "title", "advice", "retry")})
        self._write_history()
        self._cur = None

    def last_activity(self):
        """For libraries downloaded before history was kept: the newest download-archive change."""
        best = 0
        for kind in KINDS:
            try:
                best = max(best, os.path.getmtime(self.path(f"{kind}.archive.sqlite3")))
            except OSError:
                pass
        return best

    # ---------- login check ----------
    def login_check(self, browser, user):
        """Ask Instagram for one saved post with your saved login, before a long run, so problems show up in seconds."""
        if not user:
            return {"ok": False, "kind": "notfound", "title": "Enter your Instagram username first", "advice": "", "retry": False}
        cmd = [sys.executable, "-m", "gallery_dl", "--config", os.path.join(self.root, "gallery-dl.conf"), "--cookies-from-browser", browser,
               "-s", "--range", "1", "-q", f"https://www.instagram.com/{user}/saved/"]
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
        except subprocess.TimeoutExpired:
            return {"ok": False, "kind": "network", "title": "Instagram didn't answer in time", "advice": "Check your connection and try again.", "retry": True}
        except Exception as e:
            return {"ok": False, "kind": "error", "title": "Couldn't run the downloader", "advice": str(e), "retry": False}
        if p.returncode == 0:
            return {"ok": True, "kind": "ok", "title": f"Logged in. {browser} is ready.", "advice": "", "retry": False}
        out = classify((p.stdout + "\n" + p.stderr).splitlines(), p.returncode, browser)
        out["ok"] = False
        return out

    # ---------- start / stop ----------
    def start(self, body, scheduled=False):
        user = str(body.get("user", self.cfg["user"])).strip().lstrip("@")
        browser = body.get("browser", self.cfg["browser"])
        kinds = [k for k in body.get("kinds", self.cfg["kinds"]) if k in KINDS]
        if not re.fullmatch(r"[A-Za-z0-9._]{1,30}", user) or not kinds or browser not in BROWSERS:
            return 400, {"error": "Enter your Instagram username and pick something to download."}
        if not self.available():
            return 400, {"error": "The save folder's drive isn't connected. Plug it in or change the folder."}
        if self.state["running"] or self.move["active"]:
            return 409, {"error": "Something is already running."}
        d = self.disk()
        if d and d["low"]:
            return 400, {"error": f"Only {human(d['free'])} free on this drive (your minimum is {self.cfg['min_free_gb']} GB). Free up space or move the library first."}
        auto = bool(body.get("auto_stop", True))
        self.cfg.update(user=user, browser=browser, kinds=kinds, auto_stop=auto)
        self.save_cfg()
        self.state.update(running=True, log=[], outcome=None, reason="")
        threading.Thread(target=self._run_job, args=(browser, user, kinds, auto, scheduled), daemon=True).start()
        return 200, {"ok": True}

    def stop(self):
        p = self.state["proc"]
        self.state["proc"] = None
        self.state["reason"] = self.state["reason"] or "user"
        if p:
            p.terminate()

    def _guard(self):
        """While downloading, stop cleanly before the drive fills up, or once this run has reached its limit of new posts."""
        tick = 0
        while self.state["running"]:
            time.sleep(5)
            tick += 1
            if tick % 6 == 0:
                try:
                    self._touch_run()
                except Exception:
                    pass
            d = self.disk()
            if d and d["low"] and self.state["proc"] is not None:
                self.state["reason"] = "lowdisk"
                self.log(f"Only {human(d['free'])} left on the drive. Pausing so it doesn't fill up.")
                self.stop()
                return
            cap = int(self.cfg.get("max_per_run") or 0)
            if cap and self.state["proc"] is not None and (self.tracker.snapshot()["run"] or {}).get("posts", 0) >= cap:
                self.state["reason"] = "capped"
                self.log(f"Reached your limit of {cap:,} new posts for this run. Pausing so Instagram doesn't flag the account.")
                self.stop()
                return

    def _run_job(self, browser, user, kinds, auto, scheduled):
        st, cfg = self.state, self.cfg
        self.tracker.start_run()
        self._record_start(user, kinds, scheduled)
        dl = self.dir
        recent, stopped, failed, last_rc, outcome = [], False, False, 0, None
        threading.Thread(target=self._guard, daemon=True).start()
        try:
            self.log("Checking your Instagram login…")
            chk = self.login_check(browser, user)
            if not chk["ok"]:
                outcome = {k: chk.get(k, "") for k in ("kind", "title", "advice", "retry")}
                self.log(chk["title"])
                return
            self.log(chk["title"])
            jobs = []
            if "saved" in kinds:
                jobs.append(("saved", f"https://www.instagram.com/{user}/saved/", []))
            for name, url, extra in jobs:
                out = os.path.join(dl, name)
                os.makedirs(out, exist_ok=True)
                quick = auto and cfg["complete"].get(dl, {}).get(name)
                if self._cur:
                    self._cur["modes"][name] = "quick" if quick else "full"
                self.log(f"=== Downloading {name} ({'quick update: stops when it reaches posts you already have' if quick else 'full scan'}) ===")
                cmd = [sys.executable, "-m", "gallery_dl", "--config", os.path.join(self.root, "gallery-dl.conf"),
                       *(["-A", str(ABORT_AFTER)] if quick else []), "--cookies-from-browser", browser, "-d", out,
                       "--download-archive", os.path.join(dl, f"{name}.archive.sqlite3"), *extra, url]
                p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                st["proc"] = p
                for line in p.stdout:
                    self.log(line)
                    recent.append(line.rstrip())
                    del recent[:-120]
                p.wait()
                last_rc = p.returncode
                self.log(f"=== {name} finished (exit code {p.returncode}) ===")
                if st["proc"] is None:
                    stopped = True
                    break
                if p.returncode == 0:
                    cfg["complete"].setdefault(dl, {})[name] = True  # reached the end (or saved posts): later runs can be quick
                    self.save_cfg()
                else:
                    failed = True
        except Exception as e:
            outcome = {"kind": "error", "title": "Something went wrong", "advice": str(e), "retry": True}
        finally:
            st["proc"] = None
            self.tracker.end_run()
            n = (self.tracker.last_run or {}).get("posts", 0)
            size = (self.tracker.last_run or {}).get("bytes", 0)
            if outcome is None:
                if st["reason"] == "lowdisk":
                    d = self.disk() or {"free": 0}
                    outcome = {"kind": "lowdisk", "title": "Paused: the drive is almost full", "retry": True,
                               "advice": f"Only {human(d['free'])} free. Free up space or move your library to a bigger drive, then press Retry. Your progress is saved."}
                elif st["reason"] == "capped":
                    outcome = {"kind": "capped", "title": f"Paused at your limit of {int(cfg.get('max_per_run') or 0):,} new posts", "retry": True,
                               "advice": "The limit keeps Instagram from flagging the account. Press Retry (or let the next scheduled run) to continue where it stopped. Your progress is saved."}
                elif stopped:
                    outcome = {"kind": "stopped", "title": "Stopped by you", "advice": "", "retry": False}
                elif failed:
                    outcome = classify(recent, last_rc, browser)
                elif n == 0:
                    outcome = {"kind": "none", "title": "No new posts found. You're up to date.", "advice": "", "retry": False}
                else:
                    outcome = {"kind": "ok", "title": f"Done. {n:,} new post{'s' if n != 1 else ''} saved.", "advice": "", "retry": False}
            outcome["new"] = n
            try:
                self._record_end(outcome, n, size, (self.tracker.last_run or {}).get("files", 0), (self.tracker.last_run or {}).get("seconds", 0))
            except Exception:
                pass
            st["outcome"] = outcome
            self.log(outcome["title"])
            if outcome["kind"] != "stopped":
                self.raise_alert(outcome["kind"], outcome["title"], outcome.get("advice", ""), outcome.get("retry", False), new=n, bytes=size,
                                 seconds=(self.tracker.last_run or {}).get("seconds", 0), total=self.tracker.lib["posts"], scheduled=scheduled)
            if cfg.get("schedule_minutes"):
                cfg["next_run"] = time.time() + cfg["schedule_minutes"] * 60
                self.save_cfg()
            st["refreshing"] = True
            st["running"] = False
            try:
                if n > 0:
                    self.on_change("run")
            finally:
                st["refreshing"] = False
            if n > 0:
                self.start_previews()

    # ---------- scheduled auto-run ----------
    def _scheduler(self):
        while True:
            time.sleep(20)
            m = self.cfg.get("schedule_minutes", 0)
            if not m or self.state["running"] or self.move["active"] or time.time() < self.cfg.get("next_run", 0):
                continue
            if not self.cfg.get("user"):
                continue
            code, res = self.start({}, scheduled=True)
            if code != 200:
                self.cfg["next_run"] = time.time() + m * 60
                self.save_cfg()
                now = time.time()
                self.history.append({"id": int(now * 1000), "status": "done", "started": now, "ended": now, "updated": now, "user": self.cfg.get("user", ""), "kinds": [], "scheduled": True,
                                     "modes": {}, "new": 0, "files": 0, "bytes": 0, "seconds": 0, "dir": self.dir, "total": self.tracker.lib["posts"],
                                     "outcome": {"kind": "skipped", "title": "A scheduled download was skipped", "advice": res.get("error", "It couldn't start."), "retry": False}})
                self._write_history()
                self.raise_alert("skipped", "A scheduled download was skipped", res.get("error", "It couldn't start."), False)

    # ---------- move library to another drive ----------
    def start_move(self, newdir, delete_old):
        old = os.path.realpath(self.dir)
        new = os.path.abspath(os.path.expanduser(str(newdir).strip())).rstrip("/")
        if self.state["running"] or self.move["active"]:
            return 409, {"error": "Stop the download first."}
        if not os.path.isabs(new) or not os.path.isdir(os.path.dirname(new)):
            return 400, {"error": "That location isn't available. Is the drive plugged in? Example: /Volumes/MyDrive/instagram"}
        rn = os.path.realpath(new)
        if rn == old or rn.startswith(old + os.sep) or old.startswith(rn + os.sep):
            return 400, {"error": "Choose a folder that is not inside the current library (and not the same one)."}
        if not os.path.isdir(old):
            return 400, {"error": "The current library folder isn't available."}
        self.move.update(active=True, phase="counting", done_bytes=0, total_bytes=0, done_files=0, total_files=0, started=time.time(), error="", message="", samples=[])
        threading.Thread(target=self._move, args=(old, new, bool(delete_old)), daemon=True).start()
        return 200, {"ok": True}

    def _move(self, old, new, delete_old):
        mv = self.move
        try:
            files = []
            for r, _, fs in os.walk(old):
                for f in fs:
                    if f.startswith("._") or f.endswith(".tmp"):
                        continue
                    p = os.path.join(r, f)
                    try:
                        files.append((p, os.path.relpath(p, old), os.path.getsize(p)))
                    except OSError:
                        pass
            mv.update(total_files=len(files), total_bytes=sum(s for _, _, s in files))
            free = shutil.disk_usage(os.path.dirname(new)).free
            if mv["total_bytes"] > free:
                raise RuntimeError(f"The new drive has {human(free)} free but the library is {human(mv['total_bytes'])}.")
            os.makedirs(new, exist_ok=True)
            mv["phase"] = "copying"
            for src, rel, size in files:
                dst = os.path.join(new, rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                if not (os.path.exists(dst) and os.path.getsize(dst) == size):  # resumable: skip files already copied
                    tmp = dst + ".moving"
                    with open(src, "rb") as fi, open(tmp, "wb") as fo:
                        while True:
                            chunk = fi.read(4 * 1024 * 1024)
                            if not chunk:
                                break
                            fo.write(chunk)
                            mv["done_bytes"] += len(chunk)
                    os.replace(tmp, dst)
                    try:
                        os.utime(dst, (os.path.getatime(src), os.path.getmtime(src)))
                    except OSError:
                        pass
                else:
                    mv["done_bytes"] += size
                mv["done_files"] += 1
                now = time.time()
                mv["samples"].append((now, mv["done_bytes"]))
                del mv["samples"][:-40]
            mv["phase"] = "verifying"
            bad = [rel for _, rel, size in files if not os.path.exists(os.path.join(new, rel)) or os.path.getsize(os.path.join(new, rel)) != size]
            if bad:
                raise RuntimeError(f"{len(bad)} files didn't copy correctly (for example {bad[0]}). Nothing was changed.")
            comp = self.cfg["complete"]
            if self.dir in comp:
                comp[new] = comp[self.dir]
            self.cfg["dir"] = new
            self.save_cfg()
            if delete_old:
                mv["phase"] = "cleaning"
                shutil.rmtree(old, ignore_errors=True)
            mv.update(phase="done", message=f"Your library is now at {new}." + (" The old copy was deleted." if delete_old else " The old copy is still in place; delete it when you're happy."))
            threading.Thread(target=self.tracker.refresh, daemon=True).start()
            self.raise_alert("moved", "Your library was moved", mv["message"], False, total=self.tracker.lib["posts"], bytes=mv["total_bytes"])
            self.on_change("move")
        except Exception as e:
            mv.update(phase="error", error=str(e))
            self.raise_alert("movefail", "Moving the library failed", str(e) + " Nothing was changed; your library is still in its original place.", False)
        finally:
            mv["active"] = False

    # ---------- video previews (thumbnail + duration) ----------
    def _read_json(self, rel, default):
        try:
            with open(self.path(rel), encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default

    def _write_json(self, rel, obj):
        p = self.path(rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p + ".tmp", "w", encoding="utf-8") as f:
            json.dump(obj, f)
        os.replace(p + ".tmp", p)

    def start_previews(self):
        if self.previews["active"] or not self.available():
            return
        threading.Thread(target=self._previews, daemon=True).start()

    def _previews(self):
        pv = self.previews
        exe = self.ffmpeg()
        if not exe:
            pv["error"] = "Video previews need ffmpeg (it installs on the next start)."
            return
        pv.update(active=True, error="", done=0, total=0)
        try:
            index = self._read_json("thumbs/index.json", {})
            todo = []
            for kind in KINDS:
                try:
                    names = os.listdir(self.path(kind))
                except OSError:
                    continue
                for n in names:
                    rel = f"{kind}/{n}"
                    if n.lower().endswith(VIDEO_EXT) and not n.startswith("._") and rel not in index:
                        todo.append(rel)
            todo.sort(key=lambda r: r.split("/")[1], reverse=True)  # newest first
            pv["total"] = len(todo)
            os.makedirs(self.path("thumbs"), exist_ok=True)

            def one(rel):
                thumb = "thumbs/" + rel.replace("/", "_").rsplit(".", 1)[0] + ".jpg"
                dur = 0.0
                for seek in ("1", "0"):
                    p = subprocess.run([exe, "-hide_banner", "-ss", seek, "-i", self.path(rel), "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", "-y", self.path(thumb)],
                                       capture_output=True, text=True, timeout=60)
                    m = re.search(r"Duration: (\d+):(\d+):(\d+\.?\d*)", p.stderr)
                    if m:
                        dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
                    if os.path.exists(self.path(thumb)) and os.path.getsize(self.path(thumb)) > 0:
                        return rel, {"d": round(dur, 1), "t": thumb}
                return rel, {"d": round(dur, 1), "t": "", "x": 1}

            with ThreadPoolExecutor(3) as ex:
                for i, (rel, info) in enumerate(ex.map(lambda r: self._safe(one, r), todo)):
                    if info:
                        index[rel] = info
                    pv["done"] = i + 1
                    if (i + 1) % 300 == 0:
                        self._write_json("thumbs/index.json", index)
            self._write_json("thumbs/index.json", index)
        except Exception as e:
            pv["error"] = str(e)
        finally:
            pv["active"] = False

    @staticmethod
    def _safe(fn, arg):
        try:
            return fn(arg)
        except Exception:
            return arg, None

    # ---------- duplicate finder ----------
    def start_dupe_scan(self):
        if self.dupes["active"]:
            return
        self.dupes.update(active=True, phase="listing", done=0, total=0, groups=0, wasted=0)
        threading.Thread(target=self._dupe_scan, daemon=True).start()

    @staticmethod
    def _quick_hash(path, size):
        h = hashlib.sha1(str(size).encode())
        with open(path, "rb") as f:
            h.update(f.read(65536))
            if size > 131072:
                f.seek(size - 65536)
                h.update(f.read(65536))
        return h.hexdigest()

    @staticmethod
    def _full_hash(path):
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(4 * 1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()

    def _dupe_scan(self):
        dp = self.dupes
        try:
            by_size = {}
            for kind in KINDS:
                try:
                    it = os.scandir(self.path(kind))
                except OSError:
                    continue
                with it:
                    for e in it:
                        if e.name.startswith("._") or e.name.lower().endswith(SKIP_EXT):
                            continue
                        try:
                            by_size.setdefault(e.stat().st_size, []).append(f"{kind}/{e.name}")
                        except OSError:
                            pass
            cands = [(s, fs) for s, fs in by_size.items() if len(fs) > 1 and s > 0]
            dp.update(phase="comparing", total=sum(len(fs) for _, fs in cands), done=0)
            groups = []
            for size, fs in cands:
                quick = {}
                for rel in fs:
                    quick.setdefault(self._quick_hash(self.path(rel), size), []).append(rel)
                    dp["done"] += 1
                for same in quick.values():
                    if len(same) < 2:
                        continue
                    full = {}
                    for rel in same:
                        full.setdefault(self._full_hash(self.path(rel)), []).append(rel)
                    for g in full.values():
                        if len(g) > 1:
                            g.sort(key=lambda r: (len(r.split("/")[1].split("_")[0]), r.split("/")[1]))  # keep the oldest post's copy
                            groups.append({"size": size, "files": g})
            groups.sort(key=lambda g: g["size"] * (len(g["files"]) - 1), reverse=True)
            self._write_json("duplicates.json", groups)
            dp.update(groups=len(groups), wasted=sum(g["size"] * (len(g["files"]) - 1) for g in groups))
        except Exception as e:
            dp["phase"] = "error: " + str(e)
        finally:
            dp.update(active=False, phase=dp["phase"] if dp["phase"].startswith("error") else "done")

    def dupes_cleaned(self):
        """Running total of space freed with the duplicate finder (dupes-cleaned.json). For cleanups made before the tally existed,
        it is estimated from media-alias.json, because every removed copy was exactly as big as the copy that was kept."""
        try:
            key = (os.path.getmtime(self.path("dupes-cleaned.json")) if os.path.exists(self.path("dupes-cleaned.json")) else 0,
                   os.path.getmtime(self.path("media-alias.json")) if os.path.exists(self.path("media-alias.json")) else 0)
        except OSError:
            key = (0, 0)
        c = getattr(self, "_dc_cache", None)
        if c and c[0] == key and c[2] == self.dir:
            return c[1]
        d = self._read_json("dupes-cleaned.json", None)
        if d is None:
            alias = self._read_json("media-alias.json", {})
            removed = self._read_json("media-removed.json", {})
            total = 0
            for kept in alias.values():
                try:
                    total += os.path.getsize(self.path(kept))
                except OSError:
                    total += (removed.get(kept) or {}).get("size", 0)
            d = {"files": len(alias), "bytes": total, "first": key[1], "last": key[1], "runs": 0, "estimated": True} if alias else {"files": 0, "bytes": 0, "first": 0, "last": 0, "runs": 0}
        self._dc_cache = (key, d, self.dir)
        return d

    def apply_dedupe(self):
        """Delete the extra copies, keep one, and remember where each removed copy now points."""
        groups = self._read_json("duplicates.json", [])
        alias = self._read_json("media-alias.json", {})
        base = dict(self.dupes_cleaned())  # the total so far, taken before this cleanup changes anything
        freed = n_removed = 0
        for g in groups:
            keep = g["files"][0]
            if not os.path.exists(self.path(keep)) or os.path.getsize(self.path(keep)) != g["size"]:
                continue
            for rel in g["files"][1:]:
                p = self.path(rel)
                try:
                    if os.path.exists(p) and os.path.getsize(p) == g["size"]:
                        os.remove(p)
                        freed += g["size"]
                        n_removed += 1
                    alias[rel] = keep
                except OSError:
                    pass
        self._write_json("media-alias.json", alias)
        self._write_json("duplicates.json", [])
        now = time.time()
        self._write_json("dupes-cleaned.json", {"files": base.get("files", 0) + n_removed, "bytes": base.get("bytes", 0) + freed, "first": base.get("first") or now, "last": now, "runs": base.get("runs", 0) + 1})
        self.dupes.update(groups=0, wasted=0, applied=freed)
        threading.Thread(target=self.tracker.refresh, daemon=True).start()
        self.on_change("dedupe")
        return freed

    # ---------- large files cleaner ----------
    def _post_meta(self, kind, pid):
        try:
            with open(self.path(kind, f"{pid}.json"), encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _recorded(self, con, pid, num):
        """Is this file in the download record (the list the downloader checks before saving anything)?"""
        return bool(con and con.execute("select 1 from archive where entry = ?", (f"instagram{pid}_{num}",)).fetchone())

    def large_files(self, min_bytes, limit=150):
        found = []
        for kind in KINDS:
            try:
                it = os.scandir(self.path(kind))
            except OSError:
                continue
            with it:
                for e in it:
                    if e.name.startswith("._") or e.name.lower().endswith(SKIP_EXT) or not MEDIA_RE.match(f"{kind}/{e.name}"):
                        continue
                    try:
                        sz = e.stat().st_size
                    except OSError:
                        continue
                    if sz >= min_bytes:
                        found.append((sz, kind, e.name))
        found.sort(reverse=True)
        thumbs = self._read_json("thumbs/index.json", {})
        shrunk = self._read_json("media-shrunk.json", {})
        cons = {}
        rows = []
        for sz, kind, name in found[:limit]:
            tid, num = name.rsplit(".", 1)[0].split("_")[:2]
            if kind not in cons:
                ap = self.path(f"{kind}.archive.sqlite3")
                cons[kind] = sqlite3.connect(f"file:{ap}?mode=ro", uri=True) if os.path.exists(ap) else None
            m = self._post_meta(kind, tid)
            rel = f"{kind}/{name}"
            t = thumbs.get(rel) or {}
            rows.append({"path": rel, "size": sz, "kind": kind, "id": tid, "num": num, "author": m.get("fullname") or m.get("username", ""), "handle": m.get("username", ""),
                         "date": str(m.get("date", ""))[:10], "text": (m.get("description") or "")[:110], "video": name.lower().endswith(VIDEO_EXT),
                         "thumb": t.get("t", ""), "dur": t.get("d", 0), "recorded": self._recorded(cons[kind], tid, num), "shrunk": rel in shrunk})
        for c in cons.values():
            if c:
                c.close()
        return {"files": rows, "count": len(found), "bytes": sum(x[0] for x in found), "shown": len(rows)}

    def cleaned(self):
        """Running total of the space freed with the Large files cleaner (kept in media-removed.json, so it survives restarts)."""
        r = self.sidecars().get("removed") or {}
        times = [v.get("at", 0) for v in r.values() if v.get("at")]
        return {"files": len(r), "bytes": sum(v.get("size", 0) for v in r.values()), "first": min(times) if times else 0, "last": max(times) if times else 0}

    # ---------- shrink videos (lower resolution, much smaller file) ----------
    def shrunk_tally(self):
        """Running total of the space saved by shrinking (media-shrunk.json)."""
        r = self._read_json("media-shrunk.json", {})
        times = [v.get("at", 0) for v in r.values() if v.get("at")]
        return {"files": len(r), "bytes": sum(max(0, v.get("from", 0) - v.get("to", 0)) for v in r.values()), "first": min(times) if times else 0, "last": max(times) if times else 0}

    def _duration(self, exe, path):
        try:
            p = subprocess.run([exe, "-hide_banner", "-i", path], capture_output=True, text=True, timeout=60)
            m = re.search(r"Duration: (\d+):(\d+):(\d+\.?\d*)", p.stderr)
            return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0.0
        except Exception:
            return 0.0

    def _encode_cmd(self, exe, src, dst, preset, extra_in=()):
        h, crf = PRESETS[preset]
        return [exe, "-hide_banner", "-loglevel", "error", "-y", *extra_in, "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-vf", f"scale=-2:min(ih\\,{h})",
                "-c:v", "libx264", "-preset", "fast", "-crf", str(crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-f", "mp4", dst]

    def shrink_sample(self, rel, preset):
        """Encode 8 seconds from the middle of a video, so you can judge the quality and get a real size estimate before committing."""
        exe, m = self.ffmpeg(), MEDIA_RE.match(str(rel))
        full = self.file_path(str(rel)) if m else None
        if not exe or not full or preset not in PRESETS or not str(rel).lower().endswith(VIDEO_EXT):
            raise RuntimeError("That video can't be sampled.")
        dur = self._duration(exe, full)
        start = max(0.0, min(dur / 2, dur - 8)) if dur else 0.0
        out_dir = self.path("shrink-sample")
        shutil.rmtree(out_dir, ignore_errors=True)
        os.makedirs(out_dir, exist_ok=True)
        name = os.path.basename(full).rsplit(".", 1)[0] + f"_{preset}.mp4"
        dst = os.path.join(out_dir, name)
        p = subprocess.run(self._encode_cmd(exe, full, dst, preset, ("-ss", f"{start:.1f}", "-t", "8")), capture_output=True, text=True, timeout=120)
        if p.returncode or not os.path.exists(dst):
            raise RuntimeError("The sample couldn't be made: " + (p.stderr or "unknown error")[-160:])
        seg = min(8.0, dur) if dur else 8.0
        sz = os.path.getsize(dst)
        return {"path": f"shrink-sample/{name}", "bytes": sz, "seconds": seg, "est_total": int(sz / seg * dur) if dur else 0, "original": os.path.getsize(full), "duration": dur}

    def start_shrink(self, paths, preset, keep_originals):
        exe = self.ffmpeg()
        if not exe:
            return 400, {"error": "The video tool (ffmpeg) isn't installed yet. Restart the app once and try again."}
        if preset not in PRESETS:
            return 400, {"error": "Pick a quality."}
        if self.state["running"] or self.move["active"] or self.shrink["active"]:
            return 409, {"error": "Wait until the download, move or shrink that is running has finished."}
        done = self._read_json("media-shrunk.json", {})
        items, skipped = [], []
        for rel in list(dict.fromkeys(paths))[:2000]:
            m = MEDIA_RE.match(str(rel))
            full = self.file_path(str(rel)) if m else None
            if not full or not str(rel).lower().endswith(VIDEO_EXT):
                skipped.append({"path": rel, "why": "Not a video in your library."})
            elif rel in done and PRESETS[done[rel].get("preset", "720")][0] <= PRESETS[preset][0]:
                skipped.append({"path": rel, "why": "Already shrunk to this size or smaller."})
            else:
                items.append((rel, full))
        if not items:
            return 400, {"error": "Nothing to shrink. " + (skipped[0]["why"] if skipped else "")}
        self.shrink.update(active=True, total=len(items), done=0, current="", pct=0.0, saved=0, skipped=skipped, failed=[], preset=preset, started=time.time(), stop=False)
        threading.Thread(target=self._shrink_job, args=(exe, items, preset, bool(keep_originals)), daemon=True).start()
        return 200, {"ok": True, "queued": len(items), "skipped": len(skipped)}

    def stop_shrink(self):
        self.shrink["stop"] = True

    def _shrink_job(self, exe, items, preset, keep):
        sh = self.shrink
        done_map = self._read_json("media-shrunk.json", {})
        try:
            for rel, full in items:
                if sh["stop"]:
                    break
                sh.update(current=rel, pct=0.0)
                tmp = full + ".shrinking.part"
                try:
                    old = os.path.getsize(full)
                    free = (self.disk() or {"free": 1 << 60})["free"]
                    if free < old * 0.5 + float(self.cfg["min_free_gb"]) * 1e9:
                        sh["failed"].append({"path": rel, "why": "Not enough free space to shrink this one safely."})
                        continue
                    dur = self._duration(exe, full)
                    cmd = self._encode_cmd(exe, full, tmp, preset)
                    cmd[1:1] = ["-nostats", "-progress", "pipe:1"]
                    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, preexec_fn=lambda: os.nice(10))
                    for line in proc.stdout:  # live progress
                        if sh["stop"]:
                            proc.terminate()
                            break
                        if line.startswith("out_time_us=") and dur:
                            try:
                                sh["pct"] = min(99.0, int(line.split("=")[1]) / 1e6 / dur * 100)
                            except ValueError:
                                pass
                    err = proc.stderr.read()
                    proc.wait()
                    if sh["stop"]:
                        break
                    if proc.returncode or not os.path.exists(tmp):
                        sh["failed"].append({"path": rel, "why": "The video couldn't be converted (the file may be damaged), so the original was kept."})
                        continue
                    new, new_dur = os.path.getsize(tmp), self._duration(exe, tmp)
                    if dur and abs(new_dur - dur) > 2.5:
                        sh["failed"].append({"path": rel, "why": "The result was the wrong length, so the original was kept."})
                        continue
                    if new > old * 0.9:
                        sh["skipped"].append({"path": rel, "why": f"Only {max(0, round(100 - 100 * new / old))}% smaller, so the original was kept."})
                        continue
                    mtime = os.path.getmtime(full)
                    if keep:
                        keep_dir = self.path("_originals", rel.split("/")[0])
                        os.makedirs(keep_dir, exist_ok=True)
                        shutil.move(full, os.path.join(keep_dir, os.path.basename(full)))
                        os.replace(tmp, full)
                    else:
                        os.replace(tmp, full)  # same file name, so the post and the download record are unaffected
                    try:
                        os.utime(full, (mtime, mtime))
                    except OSError:
                        pass
                    done_map[rel] = {"from": old, "to": new, "preset": preset, "at": time.time(), "kept_original": keep}
                    self._write_json("media-shrunk.json", done_map)
                    sh["saved"] += old - new
                finally:
                    if os.path.exists(tmp):
                        try:
                            os.remove(tmp)
                        except OSError:
                            pass
                    sh["done"] += 1
                    threading.Thread(target=self.tracker.refresh, daemon=True).start()
        except Exception as e:
            sh["failed"].append({"path": sh.get("current", ""), "why": str(e)})
        finally:
            sh.update(active=False, current="", pct=0.0)
            n_ok = len([1 for r, _ in items if r in done_map and done_map[r].get("at", 0) >= sh["started"]])
            self.raise_alert("shrunk", "Shrinking stopped" if sh["stop"] else "Shrinking finished",
                             f"Saved {human(sh['saved'])} from {n_ok} video{'s' if n_ok != 1 else ''}." + (f" {len(sh['failed'])} could not be converted and were left as they were." if sh["failed"] else "") + (f" {len(sh['skipped'])} were left alone." if sh["skipped"] else "") + f" In total you have saved {human(self.shrunk_tally()['bytes'])} by shrinking.",
                             False, total=self.tracker.lib["posts"], bytes=sh["saved"])
            self.on_change("shrink")

    def post_preview(self, rel):
        """Everything needed to judge whether a big file belongs to a post worth keeping."""
        m = MEDIA_RE.match(str(rel))
        full = self.file_path(str(rel)) if m else None
        if not full:
            raise RuntimeError("That file isn't in your library.")
        kind, pid = m.group(1), m.group(2)
        meta = self._post_meta(kind, pid)
        handle = meta.get("username", "")
        return {"path": rel, "size": os.path.getsize(full), "id": pid, "author": meta.get("fullname") or handle, "handle": handle,
                "date": str(meta.get("date", "")), "text": meta.get("description") or "", "likes": meta.get("likes", 0),
                "link": f"https://www.instagram.com/p/{meta.get('post_shortcode') or shortcode_from_id(pid)}/"}

    def remove_large(self, paths):
        """Delete big media files for good, WITHOUT them ever being downloaded again.
        For each file the download record is checked (and filled in if it was missing) BEFORE the file is deleted."""
        if self.state["running"] or self.move["active"]:
            raise RuntimeError("Wait until the download or move has finished.")
        removed = self._read_json("media-removed.json", {})
        freed = n = added = 0
        failed = []
        cons = {}
        try:
            for rel in list(dict.fromkeys(paths))[:500]:
                m = MEDIA_RE.match(str(rel))
                full = self.file_path(str(rel)) if m else None
                if not m or not full:
                    failed.append({"path": rel, "why": "That file isn't in your library."})
                    continue
                kind, pid, num = m.group(1), m.group(2), m.group(3)
                try:
                    if kind not in cons:
                        cons[kind] = sqlite3.connect(self.path(f"{kind}.archive.sqlite3"), timeout=15)
                        cons[kind].execute("create table if not exists archive (entry text primary key) without rowid")
                    con = cons[kind]
                    if not self._recorded(con, pid, num):
                        con.execute("insert or ignore into archive (entry) values (?)", (f"instagram{pid}_{num}",))
                        con.commit()
                        added += 1
                    if not self._recorded(con, pid, num):  # never delete unless the record really holds it
                        raise RuntimeError("the download record could not be updated")
                except Exception as e:
                    failed.append({"path": rel, "why": f"Kept, because {e}."})
                    continue
                try:
                    size = os.path.getsize(full)
                    os.remove(full)
                except OSError as e:
                    failed.append({"path": rel, "why": f"Couldn't delete it: {e}"})
                    continue
                removed[rel] = {"size": size, "at": time.time()}
                freed += size
                n += 1
        finally:
            for c in cons.values():
                c.close()
        if n:
            self._write_json("media-removed.json", removed)
            threading.Thread(target=self.tracker.refresh, daemon=True).start()
            self.on_change("clean")
        return {"removed": n, "freed": freed, "record_added": added, "failed": failed, "total": self.cleaned()}

    # ---------- files the library page reads ----------
    def sidecars(self):
        out = {}
        for key, rel in (("thumbs", "thumbs/index.json"), ("alias", "media-alias.json"), ("removed", "media-removed.json")):
            try:
                mt = os.path.getmtime(self.path(rel))
            except OSError:
                out[key] = {}
                continue
            c = self._side_cache.get(rel)
            if not c or c[0] != mt:
                c = self._side_cache[rel] = (mt, self._read_json(rel, {}))
            out[key] = c[1]
        return out

    def manifest(self):
        out = {"": []}
        for sub in KINDS:
            try:
                out[sub] = [n for n in os.listdir(self.path(sub)) if not n.startswith("._")]
            except OSError:
                pass
        return out

    def file_path(self, rel):
        base = os.path.realpath(self.dir)
        full = os.path.realpath(os.path.join(base, rel))
        return full if full.startswith(base + os.sep) and os.path.isfile(full) else None

    # ---------- status + API ----------
    def status(self):
        with self.lock:
            log = self.state["log"][-60:]
        note = ""
        for line in reversed(log[-8:]):
            m = re.search(r"waiting until (.+?) .*rate limit", line, re.I) or re.search(r"rate limit.*(?:until|resets?) (.+)", line, re.I)
            if m:
                note = "Paused by Instagram (rate limit). It resumes automatically around " + m.group(1).strip() + "."
                break
        mv = dict(self.move)
        s = mv.pop("samples")
        mv["speed"] = (s[-1][1] - s[0][1]) / (s[-1][0] - s[0][0]) if len(s) > 1 and s[-1][0] > s[0][0] else 0
        c = self.cfg
        return {"helper": True, "running": self.state["running"], "refreshing": self.state["refreshing"], "log": log, "stats": self.tracker.snapshot(),
                "dir": c["dir"], "available": self.available(), "user": c["user"], "browser": c["browser"], "kinds": c["kinds"], "auto_stop": c["auto_stop"],
                "outcome": self.state["outcome"], "note": note, "disk": self.disk(), "schedule_minutes": c["schedule_minutes"], "next_run": c["next_run"] if c["schedule_minutes"] else 0,
                "notify": c["notify"], "alert": self.alert, "shrink": {k: v for k, v in self.shrink.items() if k != "stop"}, "shrunk": self.shrunk_tally(), "cleaned": self.cleaned(), "dupes_cleaned": self.dupes_cleaned(), "last_run": self._last_run(), "history": self.history[-12:][::-1], "min_free_gb": c["min_free_gb"], "max_per_run": c["max_per_run"], "move": mv, "previews": dict(self.previews),
                "dupes": dict(self.dupes), "ffmpeg": bool(self.ffmpeg())}

    def _last_run(self):
        if self.history:
            return self.history[-1]
        t = self.last_activity()  # nothing recorded yet: fall back to when the library last changed
        return {"id": 0, "status": "inferred", "started": t, "ended": t, "new": None, "bytes": None, "outcome": {"kind": "unknown", "title": "Your most recent download (before history was kept)"}} if t else None

    def handle(self, method, path, body):
        """Handle /api/* requests. Returns (status_code, json) or None if the path isn't ours."""
        if method == "GET":
            if path == "/api/status":
                return 200, self.status()
            if path == "/api/sidecars":
                return 200, self.sidecars()
            if path == "/api/manifest":
                return 200, self.manifest()
            if path == "/api/history":
                return 200, {"history": self.history[::-1]}
            if path == "/api/dupes":
                return 200, {"groups": self._read_json("duplicates.json", [])[:40], "state": dict(self.dupes)}
            return None
        if path == "/api/sizes":  # total size of a list of media files (for the export summary)
            total = missing = 0
            for rel in (body.get("paths") or [])[:200000]:
                full = self.file_path(str(rel))
                if full:
                    try:
                        total += os.path.getsize(full)
                    except OSError:
                        missing += 1
                else:
                    missing += 1
            return 200, {"bytes": total, "missing": missing}
        if path == "/api/start":
            return self.start(body)
        if path == "/api/stop":
            self.stop()
            return 200, {"ok": True}
        if path == "/api/login-check":
            return 200, self.login_check(body.get("browser", self.cfg["browser"]), str(body.get("user", self.cfg["user"])).strip().lstrip("@"))
        if path == "/api/config":
            d = os.path.expanduser(str(body.get("dir", "")).strip()).rstrip("/")
            if self.state["running"] or self.move["active"]:
                return 409, {"error": "Stop the download before changing the folder."}
            if not os.path.isabs(d) or not os.path.isdir(os.path.dirname(d)):
                return 400, {"error": "That location isn't available. Is the drive plugged in? Example: /Volumes/MyDrive/instagram"}
            try:
                os.makedirs(d, exist_ok=True)
            except OSError as e:
                return 400, {"error": f"Can't use that folder: {e}"}
            self.cfg["dir"] = d
            self.save_cfg()
            threading.Thread(target=self.tracker.refresh, daemon=True).start()
            self.on_change("config")
            return 200, {"dir": d}
        if path == "/api/settings":
            c = self.cfg
            if "schedule_minutes" in body:
                m = max(0, int(body["schedule_minutes"]))
                if m != c["schedule_minutes"]:
                    c["next_run"] = time.time() + m * 60
                c["schedule_minutes"] = m
            if "notify" in body:
                c["notify"] = bool(body["notify"])
            if "min_free_gb" in body:
                c["min_free_gb"] = max(0, float(body["min_free_gb"]))
            if "max_per_run" in body:
                c["max_per_run"] = max(0, int(float(body["max_per_run"])))
            self.save_cfg()
            return 200, {"ok": True}
        if path == "/api/move":
            return self.start_move(body.get("dir", ""), body.get("delete_old", False))
        if path == "/api/large":  # scan for the biggest files
            return 200, self.large_files(int(float(body.get("min_mb", 100)) * 1e6), int(body.get("limit", 150)))
        if path == "/api/shrink/start":
            return self.start_shrink(body.get("paths") or [], str(body.get("preset", "720")), body.get("keep_originals", False))
        if path == "/api/shrink/stop":
            self.stop_shrink()
            return 200, {"ok": True}
        if path == "/api/shrink/sample":
            try:
                return 200, self.shrink_sample(body.get("path", ""), str(body.get("preset", "720")))
            except RuntimeError as e:
                return 400, {"error": str(e)}
            except subprocess.TimeoutExpired:
                return 400, {"error": "The sample took too long to make."}
        if path == "/api/large/preview":
            try:
                return 200, self.post_preview(body.get("path", ""))
            except RuntimeError as e:
                return 404, {"error": str(e)}
        if path == "/api/large/remove":
            try:
                return 200, self.remove_large(body.get("paths") or [])
            except RuntimeError as e:
                return 409, {"error": str(e)}
        if path == "/api/previews/start":
            self.start_previews()
            return 200, {"ok": True}
        if path == "/api/dupes/scan":
            self.start_dupe_scan()
            return 200, {"ok": True}
        if path == "/api/dupes/apply":
            if self.state["running"] or self.move["active"]:
                return 409, {"error": "Wait until the download or move has finished."}
            freed = self.apply_dedupe()
            return 200, {"freed": freed, "total": self.dupes_cleaned()}
        return None

    def start_background(self):
        threading.Thread(target=self.tracker.refresh, daemon=True).start()
        threading.Thread(target=self._scheduler, daemon=True).start()

        def later():
            time.sleep(8)
            self.start_previews()
        threading.Thread(target=later, daemon=True).start()
