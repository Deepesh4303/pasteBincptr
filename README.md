# cptr.in / pastebin

A minimalistic, lightweight text pastebin built with pure **Vanilla JS + HTML + CSS**.

- **Target URL format**: `cptr.in/pastebin/[hash]`
- **Deployment Strategy**: 
  1. **Phase 1**: Host on **GitHub Static Pages**
  2. **Phase 2**: Move to **VPS** (Linux / Nginx / SQLite backend)

---

## 📁 Project Structure

```text
d:\pastebin/
├── index.html            # Step 1: Minimalist UI (Sender & Receiver)
├── style.css             # Clean, modern dark/light monospace CSS
├── app.js                # Pure Vanilla JS (Sender, Receiver, Hash routing, API client)
├── 404.html              # GitHub Pages SPA router (handles /pastebin/[hash])
├── server.py             # Step 2: Ideal Python 3 + SQLite backend (Zero dependencies!)
├── server.js             # Alternative Node.js backend (Zero dependencies!)
├── nginx.conf            # Production Nginx reverse-proxy config for cptr.in
├── cptr-pastebin.service # Systemd service unit for VPS auto-start
└── .gitignore            # Git ignore file (databases, logs, etc.)
```

---

## 🎨 Step 1 — UI (Vanilla JS + HTML)

The UI is built with zero external dependencies (no frameworks, no bundlers, no build step):

1. **Sender View**:
   - **Text Box**: Large monospace editing area with tab-indent support (`Tab` key inserts 2 spaces) and character/line counters.
   - **Sender Button**: `Send Paste 🚀` (keyboard shortcut: `Ctrl + Enter` / `Cmd + Enter`).
   - **Options**: Custom slug (e.g. `cptr.in/pastebin/my-notes`) and expiration settings (Never, 1 hour, 1 day, 7 days, Burn-after-read).
   - **Link Result**: Displays the target link `https://cptr.in/pastebin/[hash]` with a 1-click **Copy Link** button and instant link-sharing.

2. **Receiver View**:
   - **Receiver Query Bar**: Enter a hash or full URL (e.g. `7kX9a` or `cptr.in/pastebin/7kX9a`).
   - **Receiver Button**: `Receive 📥` fetches the paste immediately.
   - **Receiver Text Box**: Read-only monospace viewer with metadata (hash, creation date, view counter).
   - **Actions**: **Copy Text**, **Download .txt**, and **Fork / Edit** (loads content back into the editor to create a new paste).

3. **Smart Deep Linking**:
   - Visiting `https://cptr.in/pastebin/[hash]` or `index.html?p=[hash]` or `index.html#[hash]` automatically switches to the Receiver tab, queries the backend, and displays the content seamlessly.

---

## ⚙️ Step 2 — Backend Decision & Architecture

### **Why Python 3 + SQLite is Ideal for the VPS:**
1. **Zero External Dependencies**: Uses only standard Python library modules (`http.server`, `sqlite3`, `json`, `secrets`). No `pip install`, no virtual environments, and zero dependency security vulnerabilities.
2. **Pre-installed on Linux**: Virtually every VPS (Ubuntu, Debian, AlmaLinux, Rocky) comes with Python 3 out of the box.
3. **Atomic SQLite Storage**: Pastes are stored in a single, high-performance `pastes.db` file. Sub-millisecond response times, zero server configuration, and effortless backups (simply copy the `.db` file).
4. **Full CORS Support**: Frontends running on GitHub Pages or custom domains can communicate with the backend across domains without restriction.
5. **Raw Text Endpoint**: Supports `curl cptr.in/raw/[hash]` for command-line users.

*(A zero-dependency Node.js equivalent `server.js` is also included if Node is preferred on the VPS).*

---

## 🚀 Deployment Guide

### Phase 1: Hosting on GitHub Static Pages

1. **Create a GitHub Repository**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: cptr.in pastebin"
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git branch -M main
   git push -u origin main
   ```

2. **Enable GitHub Pages**:
   - Go to your repository **Settings** &rarr; **Pages**.
   - Under **Build and deployment** &rarr; **Branch**, select `main` / `root` and click **Save**.
   - Your site is now live at `https://<your-username>.github.io/<repo-name>/`.

3. **How `/pastebin/[hash]` works on GitHub Pages**:
   - Included `404.html` acts as a Single-Page Application (SPA) router.
   - If someone visits `.../pastebin/xyz123`, GitHub Pages loads `404.html`, which immediately routes to `index.html?p=xyz123`.
   - **Zero-Backend Testing**: Before your VPS backend is online, the frontend can store pastes client-side via compressed hashes (`#c~...`), meaning the pastebin is **100% functional immediately on GitHub Pages**!

---

### Phase 2: Moving to your VPS (`cptr.in`)

#### 1. Copy Files to VPS
```bash
# On your VPS
sudo mkdir -p /var/www/pastebin
sudo chown -R $USER:$USER /var/www/pastebin
# Copy the project files into /var/www/pastebin
```

#### 2. Setup Systemd Service (Auto-Start Backend)
```bash
sudo cp /var/www/pastebin/cptr-pastebin.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable cptr-pastebin
sudo systemctl start cptr-pastebin

# Check service status
sudo systemctl status cptr-pastebin
```

#### 3. Setup Nginx Reverse Proxy
```bash
sudo cp /var/www/pastebin/nginx.conf /etc/nginx/sites-available/cptr.in
sudo ln -s /etc/nginx/sites-available/cptr.in /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 4. Enable Free SSL via Certbot (HTTPS)
```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d cptr.in -d www.cptr.in
```

Now visiting `https://cptr.in/pastebin/[hash]` will load directly through your VPS!

---

## 📡 REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check endpoint |
| `POST` | `/api/paste` | Create paste (`{ "content": "...", "slug": "opt", "expiration": "1h" }`) |
| `GET` | `/api/paste/:hash` | Retrieve paste content and metadata |
| `GET` | `/raw/:hash` | Raw plain-text response (ideal for `curl`) |
"# pasteBincptr" 
