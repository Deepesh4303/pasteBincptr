#!/usr/bin/env python3
"""
cptr.in / pastebin - Backend Server
Ideal Zero-Dependency Backend: Python 3 Standard Library + SQLite

Features:
- REST API for creating & retrieving pastes
- SQLite persistence with automatic schema creation
- Custom slug & random short-hash generation
- Expiration support (1h, 1d, 7d, burn-after-read)
- View counter
- Raw text endpoint (/raw/<hash>)
- Full CORS support for GitHub Pages / cross-origin calls
- Integrated static file serving for VPS standalone deployment
"""

import http.server
import socketserver
import sqlite3
import json
import os
import sys
import secrets
import string
import time
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone, timedelta

# Ensure UTF-8 output on Windows consoles
if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Configuration
PORT = int(os.environ.get("PORT", 8000))
HOST = os.environ.get("HOST", "0.0.0.0")
DB_FILE = os.environ.get("DB_FILE", "pastes.db")
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))
CANONICAL_DOMAIN = os.environ.get("CANONICAL_DOMAIN", "cptr.in")
CANONICAL_PATH = "/pastebin/"

ALPHABET = string.ascii_letters + string.digits  # Base62 (a-z, A-Z, 0-9)


def get_db():
    conn = sqlite3.connect(DB_FILE, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS pastes (
                hash TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT,
                burn_after_read INTEGER DEFAULT 0,
                views INTEGER DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_pastes_hash ON pastes(hash)")
        conn.commit()


def generate_random_hash(length=6):
    return ''.join(secrets.choice(ALPHABET) for _ in range(length))


class PastebinHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def send_json(self, status_code, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def send_plain_text(self, status_code, text):
        body = text.encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    # --- GET Requests ---
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')

        # 1. API Health Check
        if path == "/api/health":
            return self.send_json(200, {"status": "ok", "time": datetime.now(timezone.utc).isoformat()})

        # 2. API Fetch Paste: /api/paste/<hash>
        if path.startswith("/api/paste/"):
            paste_hash = path[len("/api/paste/"):]
            return self.handle_get_paste(paste_hash)

        # 3. Raw Text Endpoint: /raw/<hash> or /api/raw/<hash> or /pastebin/raw/<hash>
        if path.startswith("/raw/") or path.startswith("/api/raw/") or path.startswith("/pastebin/raw/"):
            parts = path.split("/")
            paste_hash = parts[-1]
            return self.handle_get_raw(paste_hash)

        # 4. Web routing: /pastebin/<hash> -> serve index.html (SPA Fallback)
        if path.startswith("/pastebin/"):
            parts = path.split("/")
            if len(parts) >= 3 and parts[2] not in ["style.css", "app.js", "404.html", "favicon.ico"]:
                self.path = "/index.html"
                return super().do_GET()

        # 5. Root or static files
        if path == "" or path == "/pastebin":
            self.path = "/index.html"
            return super().do_GET()

        return super().do_GET()

    # --- POST Requests ---
    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')

        # API Create Paste: POST /api/paste
        if path == "/api/paste":
            return self.handle_create_paste()

        self.send_json(404, {"error": "Endpoint not found"})

    # --- Handlers ---
    def handle_create_paste(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length <= 0:
                return self.send_json(400, {"error": "Empty request body"})
            if content_length > 10 * 1024 * 1024:  # 10 MB limit
                return self.send_json(413, {"error": "Paste exceeds maximum size limit (10MB)"})

            raw_body = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(raw_body)
            content = data.get("content", "").strip()

            if not content:
                return self.send_json(400, {"error": "Content cannot be empty"})

            custom_slug = data.get("slug", "").strip()
            expiration = data.get("expiration", "never")

            now = datetime.now(timezone.utc)
            expires_at = None
            burn = 1 if expiration == "burn" else 0

            if expiration == "1h":
                expires_at = (now + timedelta(hours=1)).isoformat()
            elif expiration == "1d":
                expires_at = (now + timedelta(days=1)).isoformat()
            elif expiration == "7d":
                expires_at = (now + timedelta(days=7)).isoformat()

            with get_db() as conn:
                # Determine hash
                if custom_slug:
                    # Validate custom slug
                    safe_slug = "".join(c for c in custom_slug if c.isalnum() or c in "-_")
                    if len(safe_slug) < 2 or len(safe_slug) > 32:
                        return self.send_json(400, {"error": "Custom slug must be 2-32 alphanumeric characters"})
                    
                    row = conn.execute("SELECT hash FROM pastes WHERE hash = ?", (safe_slug,)).fetchone()
                    if row:
                        return self.send_json(409, {"error": "Custom slug already taken"})
                    final_hash = safe_slug
                else:
                    # Generate unique random hash
                    for _ in range(10):
                        cand = generate_random_hash(6)
                        row = conn.execute("SELECT hash FROM pastes WHERE hash = ?", (cand,)).fetchone()
                        if not row:
                            final_hash = cand
                            break
                    else:
                        final_hash = generate_random_hash(8)

                conn.execute(
                    """
                    INSERT INTO pastes (hash, content, created_at, expires_at, burn_after_read, views)
                    VALUES (?, ?, ?, ?, ?, 0)
                    """,
                    (final_hash, content, now.isoformat(), expires_at, burn)
                )
                conn.commit()

            target_url = f"https://{CANONICAL_DOMAIN}{CANONICAL_PATH}{final_hash}"
            raw_url = f"https://{CANONICAL_DOMAIN}/raw/{final_hash}"

            return self.send_json(201, {
                "status": "ok",
                "hash": final_hash,
                "url": target_url,
                "raw_url": raw_url,
                "burn_after_read": bool(burn),
                "expires_at": expires_at
            })

        except json.JSONDecodeError:
            return self.send_json(400, {"error": "Invalid JSON format"})
        except Exception as e:
            return self.send_json(500, {"error": str(e)})

    def handle_get_paste(self, paste_hash):
        with get_db() as conn:
            row = conn.execute("SELECT * FROM pastes WHERE hash = ?", (paste_hash,)).fetchone()
            if not row:
                return self.send_json(404, {"error": "Paste not found"})

            # Check expiration
            now = datetime.now(timezone.utc)
            if row["expires_at"]:
                exp = datetime.fromisoformat(row["expires_at"])
                if now > exp:
                    conn.execute("DELETE FROM pastes WHERE hash = ?", (paste_hash,))
                    conn.commit()
                    return self.send_json(404, {"error": "Paste has expired"})

            content = row["content"]
            views = row["views"] + 1

            # Handle burn after reading
            if row["burn_after_read"]:
                conn.execute("DELETE FROM pastes WHERE hash = ?", (paste_hash,))
            else:
                conn.execute("UPDATE pastes SET views = ? WHERE hash = ?", (views, paste_hash))
            conn.commit()

            return self.send_json(200, {
                "status": "ok",
                "hash": paste_hash,
                "content": content,
                "created_at": row["created_at"],
                "views": views,
                "burned": bool(row["burn_after_read"])
            })

    def handle_get_raw(self, paste_hash):
        with get_db() as conn:
            row = conn.execute("SELECT * FROM pastes WHERE hash = ?", (paste_hash,)).fetchone()
            if not row:
                return self.send_plain_text(404, "404 Not Found: Paste does not exist or has expired.\n")

            now = datetime.now(timezone.utc)
            if row["expires_at"]:
                exp = datetime.fromisoformat(row["expires_at"])
                if now > exp:
                    conn.execute("DELETE FROM pastes WHERE hash = ?", (paste_hash,))
                    conn.commit()
                    return self.send_plain_text(404, "404 Not Found: Paste has expired.\n")

            content = row["content"]
            views = row["views"] + 1
            if row["burn_after_read"]:
                conn.execute("DELETE FROM pastes WHERE hash = ?", (paste_hash,))
            else:
                conn.execute("UPDATE pastes SET views = ? WHERE hash = ?", (views, paste_hash))
            conn.commit()

            return self.send_plain_text(200, content)


def run_server():
    init_db()
    server_address = (HOST, PORT)
    with socketserver.ThreadingTCPServer(server_address, PastebinHandler) as httpd:
        print(f"🚀 cptr.in/pastebin backend running at http://{HOST}:{PORT}")
        print(f"   Database: {os.path.abspath(DB_FILE)}")
        print(f"   Target URL format: https://{CANONICAL_DOMAIN}{CANONICAL_PATH}[hash]")
        print("   Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server gracefully...")


if __name__ == "__main__":
    run_server()
