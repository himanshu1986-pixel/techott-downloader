# Tech OTT Downloader — backend

**Version 1.1.0** — direct video links + MP3 download.

A small Node.js server that extracts **direct download links** for
YouTube and Instagram videos using [yt-dlp](https://github.com/yt-dlp/yt-dlp).

**Direct-link method:** this server never downloads the video and
never relays it. It runs `yt-dlp --dump-single-json` once per request
(a few KB of work), returns the video's direct URLs, and the user's
browser downloads the video straight from YouTube/Instagram's own
servers (Google/Instagram CDN) at full speed. Your home connection
stays almost idle, and it does not compete with the Tech OTT
streaming server.

## Requirements

- Node.js 18+ (check with `node --version`)
- yt-dlp — see below

## Install yt-dlp (Windows, the server laptop)

1. Open https://github.com/yt-dlp/yt-dlp/releases
2. Download `yt-dlp.exe` (under Assets of the latest release).
3. Put `yt-dlp.exe` in this `backend/` folder, **or** put it
   somewhere on PATH (e.g. `C:\tools\` and add that folder to PATH).
4. If you put it in this folder, set in `.env`:
   ```
   YT_DLP_PATH=./yt-dlp.exe
   ```
   (If it is on PATH, leave the default `yt-dlp`.)
5. Keep it updated — YouTube/Instagram change their systems and
   yt-dlp breaks. Update with `yt-dlp -U` (or re-download the .exe).

## Install + run

```powershell
cd backend
npm install
npm start
```

The server listens on port **8001** by default (change with `PORT`
in `.env`). Keep it running on the laptop that stays on 24/7.

## Endpoints

| Method | URL | What it does |
|---|---|---|
| GET | `/api/health` | Liveness check → `{ok:true, service:"techott-downloader", version:"1.1.0"}` |
| GET | `/api/info?url=<link>` | Video info + direct download links. `url` must be a youtube.com / youtu.be / instagram.com link. |
| GET | `/api/mp3?url=<link>` | **MP3 download (proxy method).** Downloads the best audio, converts it to MP3 with ffmpeg, and serves the file as a download. The temp file is deleted right after serving. Needs ffmpeg (on PATH, or `FFMPEG_PATH` in `.env`). Timeout 120 seconds. |

## Updating the backend

If the project folder is a git clone, run `update.bat` (in this
folder) — it does `git pull` + `npm install`, then tells you to
restart (`Ctrl+C`, then `npm start`). It does not restart the
server by itself. Otherwise copy the new files over by hand and
restart. Confirm the new version in the site footer
("Backend vX.Y.Z") or at `/api/health`.

`/api/info` returns on success:

```json
{
  "success": true,
  "title": "Video title",
  "thumbnail": "https://...",
  "duration": 125,
  "durationString": "2:05",
  "uploader": "Channel name",
  "webpageUrl": "https://www.youtube.com/watch?v=...",
  "formats": [
    { "quality": "1080p", "ext": "mp4", "filesize": 123456789, "url": "https://..." },
    { "quality": "720p", "ext": "mp4", "filesize": 65432100, "url": "https://..." },
    { "quality": "Audio (M4A)", "ext": "m4a", "filesize": 3456789, "url": "https://..." }
  ]
}
```

On failure it returns `{success:false, error:"<clear message>"}`.
The raw yt-dlp error is logged on the server console only — it is
never sent to the client.

**Format note:** `pickFormats` returns combined video+audio
formats first (best quality per height, mp4 preferred), then the
best audio-only track. YouTube now serves most videos as separate
video-only + audio-only streams (DASH), so for many YouTube videos
there are no combined formats and the list falls back to
"1080p (video only)" etc. plus a separate Audio entry — those
video files have no sound until merged with the audio track.
Instagram usually returns a single combined mp4 (with sound).

## Safety notes

- Only youtube.com / youtu.be / instagram.com URLs are accepted
  (anything else gets HTTP 400). URLs over 2048 chars are rejected.
- The URL is passed to yt-dlp as a single argv element via
  `execFile` — never through a shell, so no command injection.
- Light rate limit: 30 requests/minute per IP (in-memory).
- yt-dlp timeout is 60 seconds per request.

## Honest notes

- YouTube and Instagram do **not** officially allow downloading.
  This is a personal-use tool. Public content only — private,
  deleted, age-restricted or login-only content may fail, and there
  is **no login/cookie support** by design.
- yt-dlp breaks when YouTube/Instagram change their systems.
  Update it regularly (`yt-dlp -U` or re-download the .exe).
- The direct links are temporary (they expire after a few hours),
  so use them right away.
