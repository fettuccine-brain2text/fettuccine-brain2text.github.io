#!/usr/bin/env python3
"""Serve the FETTUCCINE site on this computer and open it in the browser.

    python3 serve.py          # http://localhost:8000 (or the next free port)
    python3 serve.py 9000     # pick a port

Sends the right MIME types for the model files and cross-origin isolation headers,
so the in-browser decoder can use several CPU threads. Ctrl+C to stop.
"""
import http.server
import os
import socket
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
        ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml",
        ".png": "image/png", ".md": "text/plain", ".bin": "application/octet-stream",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


def free_port(start):
    for port in range(start, start + 20):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    sys.exit(f"No free port between {start} and {start + 19}.")


if __name__ == "__main__":
    port = free_port(int(sys.argv[1]) if len(sys.argv) > 1 else 8000)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://localhost:{port}/"
    print(f"FETTUCCINE site running at {url}  (Ctrl+C to stop)")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
