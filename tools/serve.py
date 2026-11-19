#!/usr/bin/env python3
"""AniRoll on localhost: python3 tools/serve.py [port]. Like python3 -m http.server, but the browser asks
again for every file: the repo's imports carry no version (scripts/deploy.sh fingerprints them), so a
cached module would otherwise outlive an edit.
Only this machine can reach it (127.0.0.1), only under its own name (a website that rebinds its DNS to
127.0.0.1 is refused by the Host check), and only what the site needs: no listings, no dotfiles
(.git and the like), no Markdown notes."""
import functools
import http.server
import pathlib
import re
import sys
import urllib.parse

# Dotfiles and every Markdown file: the site loads none, and the notes are Markdown
PRIVATE = re.compile(r'(^\.|\.md$)', re.I)


class NoCache(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        host = (self.headers.get('Host') or '').lower()
        if host not in (f'localhost:{port}', f'127.0.0.1:{port}'):
            self.send_error(403, 'Only http://localhost:%d' % port)
            return None
        parts = urllib.parse.unquote(self.path.split('?', 1)[0].split('#', 1)[0]).replace('\\', '/').split('/')
        if any(PRIVATE.search(p) for p in parts if p):
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


root = pathlib.Path(__file__).resolve().parent.parent
port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(NoCache, directory=str(root))).serve_forever()
