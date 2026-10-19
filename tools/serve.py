#!/usr/bin/env python3
"""AniRoll on localhost: python3 tools/serve.py [port]. Like python3 -m http.server, but the browser asks
again for every file: the repo's imports carry no version (scripts/deploy.sh fingerprints them), so a
cached module would otherwise outlive an edit."""
import functools
import http.server
import pathlib
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


root = pathlib.Path(__file__).resolve().parent.parent
port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
http.server.ThreadingHTTPServer(('', port), functools.partial(NoCache, directory=str(root))).serve_forever()
