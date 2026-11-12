# Tech OTT Downloader — YouTube & Instagram (direct-link)

**Version 1.1.0** — direct video links + MP3 download.

Paste a YouTube or Instagram link, get direct download links.
The video downloads **straight from YouTube / Instagram servers** —
it never passes through your server.

## How it works (Option 1)

```
User (GitHub Pages site) ──► Backend on your laptop (:8001)
                                └─► yt-dlp extracts the direct
                                    download URL (a few KB of work)
User's browser ──► downloads the video directly from
                   YouTube / Instagram (Google / Instagram CDN)
```

- **Frontend** (`frontend/`): plain HTML/CSS/JS, no build step.
  Hosted on **GitHub Pages**.
- **Backend** (`backend/`): Node.js + Express + yt-dlp, port **8001**.
  Runs on the laptop that stays on 24/7 (the same one as Tech OTT).
- **Direct-link method:** the backend only extracts links. It does
  **not** download the video and does **not** relay it, so your
  BSNL connection stays almost idle and Tech OTT streaming is
  unaffected.

## 1. Install yt-dlp (on the server laptop, Windows)

1. Open https://github.com/yt-dlp/yt-dlp/releases
2. Download `yt-dlp.exe` (under Assets of the latest release).
3. Put `yt-dlp.exe` in the `backend/` folder, **or** put it
   somewhere on PATH (e.g. `C:\tools\` and add that folder to PATH).
4. If you put it in `backend/`, set in `backend/.env`:
   ```
   YT_DLP_PATH=./yt-dlp.exe
   ```
5. Keep it updated — YouTube/Instagram change their systems and
   yt-dlp breaks. Update with `yt-dlp -U` or re-download the .exe.

## 2. Run the backend

```powershell
cd backend
npm install
npm start
```

It listens on port **8001**. Test it in the browser:

```
http://localhost:8001/api/health
```

You should see `{"ok":true,"service":"techott-downloader","version":"1.0.0"}`.

Keep this running on the laptop that stays on 24/7 (same as the
Tech OTT backend — a separate PowerShell window is fine).

## 3. Push the code to GitHub

```powershell
cd techott-downloader
git init
git add .
git commit -m "Tech OTT Downloader v1.0.0"
git branch -M main
git remote add origin https://github.com/<your-username>/techott-downloader.git
git push -u origin main
```

(Replace `<your-username>` with your GitHub username, and create
the empty repo `techott-downloader` on GitHub first.)

## 4. Enable GitHub Pages (frontend)

1. On GitHub, open the repo → **Settings** → **Pages**.
2. Under "Build and deployment", Source: **Deploy from a branch**.
3. Branch: `main`, Folder: **`/frontend`** → Save.
4. After a minute, the site is live at:
   `https://<your-username>.github.io/techott-downloader/`

(If your Pages setup only offers `/ (root)`, put the frontend
files at the repo root instead — `index.html`, `style.css`,
`app.js` — and set the Pages folder to `/ (root)`.)

## 5. Point the subdomain at the backend (so the site can reach it)

The GitHub Pages site calls the backend at
**`https://dl.techott.store`** (see `API_BASE` at the top of
`frontend/app.js`). Point that name at your downloader server:

**Same pattern as app.techott.store → :8000, via Cloudflare Tunnel:**

1. In the Cloudflare dashboard (or your `cloudflared` config),
   add a public hostname route: `dl.techott.store` →
   `http://localhost:8001` (on the laptop running the backend).
   (This is the same tunnel setup already used for
   `app.techott.store` → `:8000`; just add one more hostname.)
2. Wait a minute, then open in a browser:
   `https://dl.techott.store/api/health` — it must show the JSON above.

If your backend lives at a different address, change the
`API_BASE` value at the top of `frontend/app.js` to that address
and re-push (Pages rebuilds automatically).

## 6. Local test (before going live)

1. Start the backend (`npm start` in `backend/`).
2. Open `frontend/index.html` directly in the browser, **or**
   serve it locally: `npx serve frontend` (or any static server).
3. The page auto-detects localhost and talks to
   `http://localhost:8001` (see `API_BASE` in `app.js`).
4. Paste a public YouTube link, click "Get Download Links" —
   the video thumbnail + quality buttons must appear. Click one —
   the video must start downloading from YouTube's servers.

## MP3 download (new in v1.1.0)

The site also has a **🎵 Download MP3** button next to the video
quality buttons. It converts the video's audio to MP3 (best quality)
and downloads it.

- This is the **only part that uses the proxy method**: the backend
  downloads the audio and converts it with ffmpeg (~5–10 MB per
  song), so it uses a little of your home connection — unlike the
  video direct links, which use almost none.
- **ffmpeg must be installed** on the server laptop (WinGet already
  installed it — if yt-dlp cannot find it, set `FFMPEG_PATH` in
  `backend/.env` to the full ffmpeg.exe path).
- The MP3 file is deleted from the server right after it is served
  (plus a 10-minute cleanup timer as a safety net).

## 7. Updating later (site + backend)

**Frontend (GitHub Pages) — automatic, no manual redeploy.**
GitHub Pages **auto-redeploys every time you push a new commit**
to the repo. To update the site, just change the files in
`frontend/`, then:

```powershell
git add .
git commit -m "Update downloader site"
git push
```

Within a minute or two the live site updates by itself. Nothing
else to do — no button to press, no redeploy step.

**Backend — two ways:**

*Easy way (if the project folder is a git clone):*
```powershell
cd backend
update.bat
```
This does `git pull` + `npm install`, then tells you to restart
the server (press `Ctrl+C` in the backend window, then `npm start`).
It does **not** restart the server by itself.

*Manual way (if you copied the files by hand):*
Copy the new `server.js` / files over the old ones in your backend
folder, then restart (`Ctrl+C`, then `npm start`).

**Confirm the update took effect:**
- The site footer shows the backend version, e.g. **"Backend v1.1.0"**
  (or "Backend: offline" if the server is not reachable).
- `https://dl.techott.store/api/health` shows the new version too.
- If the footer still shows the old version, the backend was not
  restarted (or the browser cached the old page — press `Ctrl+F5`).

## Project structure

```
techott-downloader/
├── README.md            ← this file
├── backend/
│   ├── server.js        ← Express server (/api/info, /api/mp3, /api/health)
│   ├── package.json     ← express + cors only
│   ├── .env.example     ← copy to .env (PORT, YT_DLP_PATH, FFMPEG_PATH)
│   ├── update.bat       ← Windows update script (git pull + npm install)
│   └── README.md        ← backend details (endpoints, safety)
└── frontend/
    ├── index.html       ← the site
    ├── style.css        ← dark theme, red accent
    └── app.js           ← API_BASE + fetch + render + MP3 button
```

## Honest notes

- YouTube and Instagram do **not** officially allow downloading.
  This is a personal-use tool. Public videos only — private,
  deleted, age-restricted or login-only content may fail, and
  there is **no login/cookie support** by design.
- yt-dlp breaks when YouTube/Instagram change their systems.
  Update it regularly (`yt-dlp -U` or re-download the .exe).
- The direct links are temporary (they expire after a few hours),
  so use them right away.
- **YouTube format note:** YouTube now serves most videos as
  separate video-only + audio-only streams (DASH). So the quality
  buttons may say "1080p (video only)" — that file has no sound.
  Download the **Audio** link too and merge them with a video
  editor (or `ffmpeg -i video.mp4 -i audio.m4a -c copy out.mp4`).
  Instagram reels/posts usually come as one combined mp4 (with
  sound), so they download fine as a single file.
- The backend accepts only youtube.com / youtu.be / instagram.com
  URLs, rate-limits to 30 requests/minute per IP, and never runs
  anything through a shell.
