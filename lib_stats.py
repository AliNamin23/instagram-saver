"""Counts the posts saved in a library folder and their combined file size.
Library layout: <folder>/saved (post .json + media)."""
import os, threading, time


def scan(dl):
    posts = files = size = 0
    for sub in ("saved",):
        try:
            it = os.scandir(os.path.join(dl, sub))
        except OSError:
            continue
        with it:
            for e in it:
                if e.name.startswith("._"):
                    continue
                try:
                    sz = e.stat().st_size
                except OSError:
                    continue
                size += sz
                if e.name.endswith(".json"):
                    posts += 1
                else:
                    files += 1
    return {"posts": posts, "files": files, "bytes": size}


class Tracker:
    """Keeps live totals for the library, and for the current download run."""

    def __init__(self, get_dl, interval=6):
        self.get_dl, self.interval = get_dl, interval
        self.lib = {"posts": 0, "files": 0, "bytes": 0}
        self.baseline = None
        self.started = None
        self.last_run = None
        self.active = False
        self._lock = threading.Lock()

    def refresh(self):
        lib = scan(self.get_dl())
        with self._lock:
            self.lib = lib

    def start_run(self):
        base = scan(self.get_dl())
        with self._lock:
            self.lib, self.baseline, self.started, self.active = base, dict(base), time.time(), True
            self.last_run = None
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while self.active:
            time.sleep(self.interval)
            if self.active:
                self.refresh()

    def end_run(self):
        self.active = False
        self.refresh()
        with self._lock:
            self.last_run = self._run_numbers()

    def _run_numbers(self):
        b = self.baseline or self.lib
        return {"posts": max(0, self.lib["posts"] - b["posts"]), "files": max(0, self.lib["files"] - b["files"]),
                "bytes": max(0, self.lib["bytes"] - b["bytes"]), "seconds": int(time.time() - (self.started or time.time()))}

    def snapshot(self):
        with self._lock:
            run = dict(self._run_numbers(), active=True) if self.active else (dict(self.last_run, active=False) if self.last_run else None)
            return {"lib": dict(self.lib), "run": run}
