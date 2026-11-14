"""page.html -> index.html (standalone document for GitHub Pages / any static host).

SITE_URL is the published address. It fills the {{SITE_URL}} placeholders (canonical link, og:url,
og:image, JSON-LD), robots.txt and sitemap.xml, and the "Open on your phone" QR code, which the page
only shows when it is opened at that address.
"""
import datetime
import os
import segno   # pip install segno

SITE_URL = "https://fettuccine-brain2text.github.io/"
SITE = os.path.dirname(os.path.abspath(__file__))   # the website folder


def qr_svg(url):
    m = segno.make(url, error="m").matrix
    n = len(m)
    d = "".join(f"M{x},{y}h1v1h-1z" for y, row in enumerate(m) for x, v in enumerate(row) if v)
    return f'<svg viewBox="-2 -2 {n + 4} {n + 4}" role="img" aria-label="QR code for {url}"><path fill="currentColor" d="{d}"/></svg>'


src = open(f"{SITE}/page.html").read()
src = src.replace("{{SITE_URL}}", SITE_URL)
src = src.replace('<span class="qr-code"></span>', f'<span class="qr-code">{qr_svg(SITE_URL + "#demo")}</span>')
src = src.replace('<a class="qr" id="qr" hidden>', f'<a class="qr" id="qr" href="{SITE_URL}#demo" data-site="{SITE_URL}" hidden>')
if os.path.isdir(f"{SITE}/tools"):
    open(f"{SITE}/tools/page.fragment.html", "w").write(src)   # page body without <html>/<head>, for previews

cut = src.index("<nav")
head, body = src[:cut], src[cut:]
head = head.replace('<link rel="stylesheet" href="https://fonts.googleapis.com', '<link rel="stylesheet" crossorigin="anonymous" href="https://fonts.googleapis.com')
head = head.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '')
doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
<!-- enables multi-threaded WebAssembly on hosts that cannot set COOP/COEP headers (e.g. GitHub Pages) -->
<script src="coi-serviceworker.min.js"></script>
{head.strip()}
</head>
<body>
{body.strip()}
</body>
</html>
"""
open(f"{SITE}/index.html", "w").write(doc)
open(f"{SITE}/robots.txt", "w").write(f"User-agent: *\nAllow: /\n\nSitemap: {SITE_URL}sitemap.xml\n")
open(f"{SITE}/sitemap.xml", "w").write(
    f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    f"  <url><loc>{SITE_URL}</loc><lastmod>{datetime.date.today().isoformat()}</lastmod></url>\n</urlset>\n")
print("index.html", len(doc))
