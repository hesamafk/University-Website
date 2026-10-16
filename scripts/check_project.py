"""Check bundled asset references and JavaScript syntax; not a browser/UI test."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SKIP = {"node_modules", "dist", ".git", ".venv", "__pycache__"}

class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []
    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in ("src", "href") and value:
                self.refs.append(value)

errors = []
count = 0
for file in ROOT.rglob("*"):
    if not file.is_file() or any(part in SKIP for part in file.relative_to(ROOT).parts):
        continue
    if file.suffix not in (".html", ".css", ".js", ".php"):
        continue
    text = file.read_text(encoding="utf-8")
    if file.suffix in (".html", ".php"):
        page = Page()
        page.feed(text)
        refs = page.refs
        count += 1
        for attrs, source in re.findall(r"<script([^>]*)>(.*?)</script>", text, re.S | re.I):
            if "src=" in attrs or "application/ld+json" in attrs or not source.strip():
                continue
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "inline.mjs"
                path.write_text(source, encoding="utf-8")
                result = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
                if result.returncode:
                    errors.append(f"{file.relative_to(ROOT)}: inline JS: {result.stderr}")
    elif file.suffix == ".css":
        refs = re.findall(r"url\([\s'\"]*([^\)'\"\s]+)", text)
    else:
        refs = []
        result = subprocess.run(["node", "--check", str(file)], capture_output=True, text=True)
        if result.returncode:
            errors.append(f"{file.relative_to(ROOT)}: {result.stderr}")
    for ref in refs:
        url = urlsplit(ref)
        if url.scheme or url.netloc or not url.path or "{{" in ref or "<?" in ref:
            continue
        target = ROOT / unquote(url.path.lstrip("/")) if url.path.startswith("/") else file.parent / unquote(url.path)
        if url.path.startswith('/') and (ROOT / 'app.py').exists():
            routes = re.findall(r'@app.route\("([^" ]+)"', (ROOT / 'app.py').read_text())
            if url.path in routes:
                continue
        if not target.exists() and url.path.startswith('/'):
            target = ROOT / 'public' / unquote(url.path.lstrip('/'))
        if not target.exists():
            errors.append(f"{file.relative_to(ROOT)}: missing {ref}")
if errors:
    raise SystemExit("\n".join(errors))
print(f"PASS: {count} HTML pages; bundled HTML/CSS paths and JavaScript syntax checked")
