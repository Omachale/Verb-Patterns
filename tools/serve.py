# Local dev server that tells browsers never to cache, so phones always get the latest files.
# Usage: python tools/serve.py [port]
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
http.server.ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
