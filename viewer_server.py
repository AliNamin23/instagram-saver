"""Tiny local server for the saved-posts viewer.
Serves the folder it lives in (with video seeking) and stores favorites, tags,
hidden and deleted posts in user-data.json next to the downloads."""
import json, mimetypes, os, shutil, sys, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

STATE_FILE = "user-data.json"
KINDS = ("saved",)


def _default():
    return {"fav": {}, "tags": {}, "hidden": {}, "deleted": {}}


def load_state(dl):
    s = _default()
    try:
        with open(os.path.join(dl, STATE_FILE), encoding="utf-8") as f:
            s.update(json.load(f))
    except Exception:
        pass
    return s


def save_state(dl, state):
    clean = {k: state.get(k) if isinstance(state.get(k), dict) else {} for k in _default()}
    path = os.path.join(dl, STATE_FILE)
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(clean, f)
    os.replace(path + ".tmp", path)


def delete_post(dl, kind, pid):
    """Move a post's files into _deleted/ (nothing is erased) and remember it as deleted."""
    if kind not in KINDS or not str(pid).isdigit():
        raise ValueError("bad request")
    src = os.path.join(dl, kind)
    dest = os.path.join(dl, "_deleted", kind)
    os.makedirs(dest, exist_ok=True)
    moved = 0
    for f in os.listdir(src):
        name = f[2:] if f.startswith("._") else f
        if name == f"{pid}.json" or name.startswith(f"{pid}_"):
            shutil.move(os.path.join(src, f), os.path.join(dest, f))
            moved += 1
    state = load_state(dl)
    state["deleted"][str(pid)] = 1
    save_state(dl, state)
    return moved


def serve_file(h, full):
    """Send a file with HTTP Range support (needed for seeking in videos, esp. Safari)."""
    size = os.path.getsize(full)
    start, end, code = 0, size - 1, 200
    rng = h.headers.get("Range", "")
    if rng.startswith("bytes=") and size:
        a, _, b = rng[6:].split(",")[0].partition("-")
        try:
            if a == "":
                start = max(0, size - int(b))
            else:
                start = int(a)
                end = min(int(b), size - 1) if b else size - 1
            code = 206
        except ValueError:
            start, end = 0, size - 1
        if start > end or start >= size:
            h.send_response(416)
            h.send_header("Content-Range", f"bytes */{size}")
            h.end_headers()
            return
    h.send_response(code)
    h.send_header("Content-Type", mimetypes.guess_type(full)[0] or "application/octet-stream")
    h.send_header("Accept-Ranges", "bytes")
    h.send_header("Content-Length", str(max(0, end - start + 1)))
    if code == 206:
        h.send_header("Content-Range", f"bytes {start}-{end}/{size}")
    h.end_headers()
    try:
        with open(full, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(262144, left))
                if not chunk:
                    break
                h.wfile.write(chunk)
                left -= len(chunk)
    except (BrokenPipeError, ConnectionResetError):
        pass


def make_handler(root):
    root = os.path.realpath(root)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send_json(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = unquote(urlparse(self.path).path)
            if path == "/state":
                return self.send_json(200, load_state(root))
            if path == "/":
                path = "/viewer.html"
            full = os.path.realpath(os.path.join(root, path.lstrip("/")))
            if not full.startswith(root + os.sep) or not os.path.isfile(full) or os.path.basename(full) == STATE_FILE:
                return self.send_json(404, {"error": "not found"})
            serve_file(self, full)

        def do_POST(self):
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
                if self.path == "/state":
                    save_state(root, body)
                    return self.send_json(200, {"ok": True})
                if self.path == "/delete":
                    return self.send_json(200, {"ok": True, "moved": delete_post(root, body.get("kind"), body.get("id"))})
            except Exception as e:
                return self.send_json(400, {"error": str(e)})
            self.send_json(404, {"error": "not found"})

    return Handler


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8779
    url = f"http://127.0.0.1:{port}/viewer.html"
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", port), make_handler(here))
    except OSError:
        webbrowser.open(url)  # already running
        sys.exit(0)
    print(f"Your saved posts: {url}\nKeep this window open while browsing. Close it to stop.")
    webbrowser.open(url)
    srv.serve_forever()
