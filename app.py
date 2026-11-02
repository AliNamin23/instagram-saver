"""Instagram Saver: a local web app that downloads your saved posts (captions, photos, videos)
using gallery-dl and your logged-in browser session, and shows them in a searchable library."""
import json, os, shutil, sys, threading, urllib.request, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

import saver_core
import viewer_server as vs

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8767
PAGE_FILES = {"/viewer.js": "text/javascript", "/viewer.css": "text/css", "/panel.js": "text/javascript", "/panel.css": "text/css"}
cache = {"items": None}
build_lock = threading.Lock()
saver = None  # created below, after write_export is defined


def build_index():
    dl = saver.dir
    items = []
    for kind in saver_core.KINDS:
        d = os.path.join(dl, kind)
        if not os.path.isdir(d):
            continue
        media = {}
        names = os.listdir(d)
        for x in names:  # group media files by post once (fast, even with tens of thousands of files)
            if not x.startswith("._") and not x.endswith((".json", ".part", ".tmp")):
                media.setdefault(x.split("_")[0], []).append(x)
        for f in names:
            if f.startswith("._") or not f.endswith(".json"):
                continue
            try:
                with open(os.path.join(d, f), encoding="utf-8") as fh:
                    m = json.load(fh)
            except Exception:
                continue
            pid = f[:-5]  # the file name holds the exact id
            handle = m.get("username") or ""
            items.append({
                "kind": kind, "id": pid, "text": m.get("description") or "",
                "author": m.get("fullname") or handle, "handle": handle,
                "date": str(m.get("date") or m.get("post_date") or ""),
                "likes": m.get("likes") or 0,
                "code": m.get("post_shortcode") or saver_core.shortcode_from_id(pid),
                "place": m.get("location_name") or "",
                "media": [{"url": f"{kind}/{x}", "video": x.lower().endswith((".mp4", ".webm", ".mov"))} for x in sorted(media.get(pid, []), key=media_order)],
            })
    items.sort(key=lambda i: (len(i["id"]), i["id"]), reverse=True)
    return items


def media_order(name):
    """Carousel pictures in their original order: 123_2.jpg comes before 123_10.jpg."""
    try:
        return int(name.rsplit(".", 1)[0].split("_")[1])
    except (IndexError, ValueError):
        return 0


VIEWER_HTML = """<!doctype html><html><head><meta charset="utf-8"><title>My saved posts</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="viewer.css"></head>
<body><div id="v"><p style="color:#536471">Loading your posts...</p></div>
<script>function bootFail(m){document.getElementById('v').innerHTML='<div style="max-width:560px;margin:40px auto;line-height:1.5"><b>Your posts could not be shown.</b><br>'+m+'<br><br>Try double-clicking <b>Open Viewer.command</b> in this folder instead.</div>'}</script>
<script src="data.js" onerror="bootFail('The file data.js is missing or unreadable.')"></script>
<script src="sidecars.js"></script>
<script src="viewer.js" onerror="bootFail('The file viewer.js is missing or unreadable.')"></script>
<script>(async function(){try{
if(!window.POSTS)throw new Error('data.js did not load (it may still be rebuilding - wait a minute and refresh).');
var server=false;try{server=(await fetch('state')).ok}catch(e){}
var V=initViewer(document.getElementById('v'),{
 resolve:function(p){return Promise.resolve(p.split('/').map(encodeURIComponent).join('/'))},
 loadState:async function(){if(server)return (await fetch('state')).json();try{return JSON.parse(localStorage.getItem('igs-state')||'null')}catch(e){return null}},
 saveState:function(s){try{localStorage.setItem('igs-state',JSON.stringify(s))}catch(e){}if(server)fetch('state',{method:'POST',body:JSON.stringify(s)}).catch(function(){})},
 removeFiles:server?async function(i){var r=await fetch('delete',{method:'POST',body:JSON.stringify({kind:i.kind,id:i.id})});if(!r.ok)throw new Error((await r.json()).error||'failed')}:undefined});
await V.set(window.POSTS);V.mergeSidecars(window.SIDECARS||{});
}catch(e){bootFail(String(e.message||e))}})()</script></body></html>"""


def write_export():
    """Rebuild the library index and write a self-contained offline viewer into the library folder."""
    with build_lock:
        dl = saver.dir
        os.makedirs(dl, exist_ok=True)
        for name in ("viewer.css", "viewer.js", "viewer_server.py", "Open Viewer.command"):
            shutil.copy(os.path.join(ROOT, name), os.path.join(dl, name))
        os.chmod(os.path.join(dl, "Open Viewer.command"), 0o755)
        with open(os.path.join(dl, "viewer.html"), "w", encoding="utf-8") as f:
            f.write(VIEWER_HTML)
        items = build_index()
        for name, text in (("data.js", "window.POSTS = " + json.dumps(items) + ";"), ("sidecars.js", "window.SIDECARS = " + json.dumps(saver.sidecars()) + ";")):
            tmp = os.path.join(dl, name + ".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(text)
            os.replace(tmp, os.path.join(dl, name))  # atomic: the viewer never sees a half-written file
        cache["items"] = items
        return items


def on_change(what):
    """Called after a run, a move or a duplicate cleanup: rebuild the library index."""
    if saver.available():
        write_export()


saver = saver_core.Saver(ROOT, os.path.join(ROOT, "config.json"), os.path.join(ROOT, "downloads"), on_change)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json"):
        if not isinstance(body, bytes):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def trusted(self):
        """Only this computer's own page may talk to the app (blocks other websites)."""
        ok = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
        if self.headers.get("Host", "") not in ok:
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin.replace("http://", "") in ok

    def do_GET(self):
        if not self.trusted():
            return self.send(403, {"error": "forbidden"})
        path = unquote(urlparse(self.path).path)
        if path.startswith("/api/"):
            res = saver.handle("GET", path, {})
            return self.send(*res) if res else self.send(404, {"error": "not found"})
        if path == "/":
            with open(os.path.join(ROOT, "index.html"), "rb") as f:
                return self.send(200, f.read(), "text/html; charset=utf-8")
        if path in PAGE_FILES:
            with open(os.path.join(ROOT, path[1:]), "rb") as f:
                return self.send(200, f.read(), PAGE_FILES[path])
        if path == "/items":
            if cache["items"] is None:  # first ever run: build once (later loads are instant)
                write_export()
            return self.send(200, cache["items"])
        if path == "/state":
            return self.send(200, vs.load_state(saver.dir))
        if path.startswith("/files/"):
            full = saver.file_path(path[len("/files/"):])
            if not full:
                return self.send(404, {"error": "not found"})
            return vs.serve_file(self, full)
        self.send(404, {"error": "not found"})

    def do_POST(self):
        if not self.trusted():
            return self.send(403, {"error": "forbidden"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        except ValueError:
            return self.send(400, {"error": "bad request"})
        try:
            if self.path == "/state":
                vs.save_state(saver.dir, body)
                return self.send(200, {"ok": True})
            if self.path == "/rebuild":
                write_export()
                return self.send(200, {"ok": True, "posts": len(cache["items"])})
            if self.path == "/delete":
                return self.send(200, {"ok": True, "moved": vs.delete_post(saver.dir, body.get("kind"), body.get("id"))})
            res = saver.handle("POST", self.path, body)
        except Exception as e:
            return self.send(400, {"error": str(e)})
        self.send(*res) if res else self.send(404, {"error": "not found"})


if __name__ == "__main__":
    try:  # show the last export instantly, then refresh it in the background
        with open(os.path.join(saver.dir, "data.js"), encoding="utf-8") as f:
            cache["items"] = json.loads(f.read()[len("window.POSTS = "):].rstrip().rstrip(";"))
    except Exception:
        pass
    saver.start_background()
    threading.Thread(target=lambda: write_export() if saver.available() else None, daemon=True).start()
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    except OSError:
        print("Instagram Saver is already running in another window. Opening it in your browser.")
        webbrowser.open(f"http://127.0.0.1:{PORT}")
        sys.exit(0)
    print(f"Instagram Saver running at http://127.0.0.1:{PORT}  (Ctrl+C to quit)")
    threading.Timer(1, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}")).start()
    srv.serve_forever()
