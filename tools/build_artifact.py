#!/usr/bin/env python3
"""Derive the Artifact page from public/index.html.

A published Artifact supplies its own <!doctype>/<html>/<head>/<body> wrapper,
so the page body is written directly. This strips the wrapper from the real
index.html and keeps the <title> and the stylesheet link, which the platform
honours where they sit. Everything else — CSS, JS, the sprite bundle — is
published unchanged as supporting files.

Usage:  python3 tools/build_artifact.py
Writes: build/artifact/index.html
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "index.html"
OUT = ROOT / "build" / "artifact" / "index.html"

# Provided by the Artifact skeleton, or meaningless inside it. Attribute values
# can themselves contain ">" (the favicon is an inline SVG data URI), so the
# patterns step over quoted strings rather than stopping at the first ">".
ATTRS = r'(?:[^>"]|"[^"]*")*'
DROP_PATTERNS = [
    rf'<meta charset={ATTRS}>\s*',
    rf'<meta name="viewport"{ATTRS}>\s*',
    rf'<meta name="color-scheme"{ATTRS}>\s*',
    rf'<link rel="icon"{ATTRS}>\s*',
]


def main():
    html = SRC.read_text(encoding="utf-8")

    head = re.search(r"<head>(.*?)</head>", html, re.S)
    body = re.search(r"<body>(.*?)</body>", html, re.S)
    if not head or not body:
        raise SystemExit("could not find <head>/<body> in public/index.html")

    keep = head.group(1)
    for pattern in DROP_PATTERNS:
        keep = re.sub(pattern, "", keep)
    keep = keep.strip()

    page = f"{keep}\n{body.group(1).strip()}\n"

    # Nothing from the outer document may survive.
    for tag in ("<!doctype", "<html", "</html>", "<head>", "</head>", "<body", "</body>"):
        if tag in page.lower():
            raise SystemExit(f"wrapper tag {tag!r} survived the strip")
    for leftover in ("rel=\"icon\"", "charset=", "name=\"viewport\""):
        if leftover in page:
            raise SystemExit(f"{leftover} should have been stripped")
    # A dangling fragment of a stripped tag would break the page silently.
    first = page.lstrip().split(chr(10), 1)[0]
    if not first.startswith("<title>"):
        raise SystemExit(f"expected the page to open with <title>, got: {first[:80]!r}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page, encoding="utf-8")

    title = re.search(r"<title>(.*?)</title>", page, re.S)
    print(f"wrote {OUT.relative_to(ROOT)}  ({len(page):,} bytes)")
    print(f"title: {title.group(1) if title else '(none)'}")


if __name__ == "__main__":
    main()
