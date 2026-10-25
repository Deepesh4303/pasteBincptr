# cptr.in / pastebin

A minimalistic, lightweight text pastebin built with pure **Vanilla JS + HTML + CSS** and a **100% FREE Serverless SQLite backend** (Cloudflare Pages + D1).

- **Target URL format**: `cptr.in/pastebin/[hash]`
- **Frontend**: Pure Vanilla HTML + CSS + JS (Zero bundlers, zero dependencies)
- **Backend**: Cloudflare Pages Functions + D1 (Serverless SQLite running at global edge)
- **Alternative Backend**: Python 3 standard library SQLite server (`server.py`) for traditional Linux VPS

---

## 📁 Project Structure

```text
d:\pastebin/
├── index.html            # Step 1: Minimalist UI (Sender & Receiver)
├── style.css             # Monospace dark/light responsive CSS
├── app.js                # Vanilla JS (Sender, Receiver, Auto-route hash parser, API client)
├── 404.html              # GitHub Pages SPA fallback router
│
├── functions/            # Cloudflare Pages Functions (100% Free Serverless Backend)
│   ├── api/
│   │   ├── health.js     # GET /api/health
│   │   └── paste/
│   │       ├── index.js  # POST /api/paste (Saves to D1 SQLite database)
│   │       └── [hash].js # GET /api/paste/[hash] (Fetches from D1 SQLite)
│   ├── raw/[hash].js     # GET /raw/[hash] (Plain-text response for curl)
│   └── pastebin/[hash].js# GET /pastebin/[hash] (SPA route handler)
│
├── schema.sql            # SQLite database schema for Cloudflare D1
├── wrangler.toml         # Cloudflare configuration file
│
├── server.py             # Optional: Python 3 SQLite backend (for traditional VPS)
├── server.js             # Optional: Node.js backend
├── nginx.conf            # Optional: Nginx reverse-proxy for VPS
└── cptr-pastebin.service # Optional: Systemd service file for VPS
```

---

## 🚀 Setup Guide: 100% Free Cloudflare Pages + D1

With this setup:
- **Cost**: **$0.00 / month forever**
- **Traffic**: 100,000 writes/day & 5,000,000 reads/day free
- **Domain**: `cptr.in` with free enterprise SSL and DDoS protection

---

### Step 1: Push Code to GitHub

```powershell
cd d:\pastebin
git init
git add .
git commit -m "Initial commit: cptr.in pastebin"
git branch -M main
git remote add origin https://github.com/<your-username>/pastebin.git
git push -u origin main
```

---

### Step 2: Create Free D1 Database in Cloudflare

1. Log into your free [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. On the left sidebar, click **Storage & Databases** &rarr; **D1 SQL Database**.
3. Click **Create database**:
   - Name: `pastebin-db`
   - Click **Create**.
4. Click on your newly created `pastebin-db`, go to the **Console** tab, paste the following SQL, and click **Execute**:
   ```sql
   CREATE TABLE IF NOT EXISTS pastes (
       hash TEXT PRIMARY KEY,
       content TEXT NOT NULL,
       created_at TEXT NOT NULL,
       expires_at TEXT,
       burn_after_read INTEGER DEFAULT 0,
       views INTEGER DEFAULT 0
   );
   CREATE INDEX IF NOT EXISTS idx_pastes_hash ON pastes(hash);
   ```

---

### Step 3: Deploy Frontend & Backend with Cloudflare Pages

1. In Cloudflare Dashboard, go to **Compute (Workers) & Pages** &rarr; click **Create application** &rarr; **Pages** &rarr; **Connect to Git**.
2. Select your GitHub repository (`pastebin`).
3. Set Build settings:
   - **Framework preset**: `None`
   - **Build command**: *(leave empty)*
   - **Build output directory**: `.` *(single dot, meaning root directory)*
4. Click **Save and Deploy**. In ~15 seconds, your site is deployed!

---

### Step 4: Bind the D1 Database to your Pages project

1. In your Pages project page, click **Settings** &rarr; **Functions** &rarr; scroll down to **D1 database bindings**.
2. Click **Add binding**:
   - **Variable name**: `DB`  *(Must be uppercase `DB`)*
   - **D1 database**: Select `pastebin-db`
3. Click **Save**.
4. Go to the **Deployments** tab &rarr; click the three dots `...` on the latest deployment &rarr; click **Retry deployment** (this binds the database to the live app).

---

### Step 5: Connect your Domain (`cptr.in`)

1. In your Cloudflare Pages project, click **Custom domains**.
2. Click **Set up a custom domain**.
3. Type `cptr.in` (and optionally `www.cptr.in`).
4. Cloudflare automatically configures the DNS and generates a free SSL certificate.

🎉 Now visiting **`https://cptr.in/pastebin/[hash]`** will work globally with sub-second speed and zero hosting costs!

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check endpoint |
| `POST` | `/api/paste` | Create new paste (`{ "content": "...", "slug": "optional", "expiration": "1h" }`) |
| `GET` | `/api/paste/:hash` | Retrieve paste content and metadata |
| `GET` | `/raw/:hash` | Plain-text response (e.g. `curl https://cptr.in/raw/:hash`) |
