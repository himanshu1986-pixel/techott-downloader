// Tech OTT Downloader — backend (direct-link method)
// -----------------------------------------------------------
// This server does NOT download videos and does NOT relay them.
// It only runs yt-dlp once per request to EXTRACT the video's
// direct download URL(s), then hands those URLs to the caller.
// The user's browser downloads the video straight from
// YouTube/Instagram's own servers (Google/Instagram CDN).
// That keeps the home connection almost idle and does not
// compete with the Tech OTT streaming server.
//
// Run:  npm install && npm start   (port 8001 by default)
// Docs: ../README.md
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const express = require('express');
const cors = require('cors');

// ---------- tiny .env loader (no extra dependency) ----------
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
})();

const PORT = parseInt(process.env.PORT || '8001', 10);
const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';
const FFMPEG_PATH = process.env.FFMPEG_PATH || '';
const VERSION = '1.1.0';

// ---------- URL allowlist ----------
const ALLOWED_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
  'youtu.be',
  'instagram.com', 'www.instagram.com',
]);

function isAllowedUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return false;
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  return ALLOWED_HOSTS.has(u.hostname.toLowerCase());
}

// ---------- helpers ----------
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function formatDuration(sec) {
  if (typeof sec !== 'number' || !isFinite(sec) || sec <= 0) return '';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

function fileSizeOf(f) {
  const n = f.filesize || f.filesize_approx;
  return typeof n === 'number' && n > 0 ? n : null;
}

function heightOf(f) {
  if (typeof f.height === 'number' && f.height > 0) return f.height;
  const m = String(f.resolution || '').match(/(\d+)x(\d+)/);
  if (m) return parseInt(m[2], 10);
  return 0;
}

// Pick the best direct download options from yt-dlp's JSON.
// Returns at most ~8 entries: combined video+audio first (best
// quality per height, mp4 preferred), then the best audio-only.
// Only formats that actually carry a direct `url` are kept.
function pickFormats(info) {
  const raw = Array.isArray(info.formats) ? info.formats : [];
  const withUrl = raw.filter((f) => f && typeof f.url === 'string' && f.url.length > 0);

  const combined = withUrl.filter(
    (f) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none'
  );
  const videoOnly = withUrl.filter(
    (f) => f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none')
  );
  const audioOnly = withUrl.filter(
    (f) => (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none'
  );

  // Sort combined: tallest first, mp4 first, biggest file first.
  combined.sort((a, b) => {
    const dh = heightOf(b) - heightOf(a);
    if (dh !== 0) return dh;
    const de = (b.ext === 'mp4' ? 1 : 0) - (a.ext === 'mp4' ? 1 : 0);
    if (de !== 0) return de;
    return (fileSizeOf(b) || 0) - (fileSizeOf(a) || 0);
  });

  // Dedupe by height, keep the first (best) per height.
  const seenHeights = new Set();
  const video = [];
  for (const f of combined) {
    const h = heightOf(f);
    if (!h || seenHeights.has(h)) continue;
    seenHeights.add(h);
    video.push({
      quality: `${h}p`,
      ext: f.ext || 'mp4',
      filesize: fileSizeOf(f),
      url: f.url,
    });
    if (video.length >= 7) break;
  }

  // Fallback: no combined formats (DASH-only video) — offer the
  // best video-only tracks, clearly labelled as video-only.
  if (video.length === 0) {
    videoOnly.sort((a, b) => heightOf(b) - heightOf(a));
    const seen = new Set();
    for (const f of videoOnly) {
      const h = heightOf(f);
      if (!h || seen.has(h)) continue;
      seen.add(h);
      video.push({
        quality: `${h}p (video only)`,
        ext: f.ext || 'mp4',
        filesize: fileSizeOf(f),
        url: f.url,
      });
      if (video.length >= 7) break;
    }
  }

  // Best audio-only track (m4a first, then mp3, then anything).
  const audioRank = (ext) => ({ m4a: 3, mp3: 2, webm: 1, opus: 1 }[String(ext).toLowerCase()] || 0);
  audioOnly.sort((a, b) => {
    const dr = audioRank(b.ext) - audioRank(a.ext);
    if (dr !== 0) return dr;
    return (fileSizeOf(b) || 0) - (fileSizeOf(a) || 0);
  });
  const audio = [];
  if (audioOnly.length > 0) {
    const f = audioOnly[0];
    audio.push({
      quality: `Audio (${String(f.ext || 'm4a').toUpperCase()})`,
      ext: f.ext || 'm4a',
      filesize: fileSizeOf(f),
      url: f.url,
    });
  }

  // Top-level direct URL fallback (e.g. a single Instagram mp4).
  const out = [...video, ...audio];
  if (out.length === 0 && typeof info.url === 'string' && info.url.length > 0) {
    out.push({
      quality: info.height ? `${info.height}p` : 'Video',
      ext: info.ext || 'mp4',
      filesize: fileSizeOf(info),
      url: info.url,
    });
  }
  return out.slice(0, 8);
}

// Map yt-dlp failures to a short, human message.
// The raw stderr is logged server-side, never sent to the client.
function mapYtDlpError(err, stderr) {
  const text = `${stderr || ''} ${err && err.message ? err.message : ''}`.toLowerCase();
  if (err && (err.code === 'ETIMEDOUT' || err.killed)) {
    return 'Timed out — YouTube/Instagram took too long to respond. Try again.';
  }
  if (err && err.code === 'ENOENT') {
    return 'yt-dlp is not installed on the server. Install it and set YT_DLP_PATH.';
  }
  if (text.includes('private video') || text.includes('this video is private')) {
    return 'This video is private.';
  }
  if (text.includes('video unavailable') || text.includes('not available') || text.includes('404')) {
    return 'Video not found or unavailable. Check the link and try again.';
  }
  if (text.includes('age') && text.includes('confirm')) {
    return 'Age-restricted content is not supported.';
  }
  if (text.includes('sign in') || text.includes('log in') || text.includes('login required')) {
    return 'This content needs a login — not supported.';
  }
  if (text.includes('rate') && text.includes('limit')) {
    return 'YouTube/Instagram is rate-limiting requests right now. Try again in a few minutes.';
  }
  if (text.includes('unsupported url') || text.includes('no video')) {
    return 'That link does not look like a video. Paste a YouTube or Instagram video link.';
  }
  return 'Could not fetch this link. Check the URL and try again.';
}

// Run yt-dlp once and parse its JSON output.
function fetchInfo(url) {
  return new Promise((resolve, reject) => {
    execFile(
      YT_DLP,
      ['--no-playlist', '--dump-single-json', '--no-warnings', url],
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          log('yt-dlp FAILED', url, '|', String(stderr || err.message).slice(0, 300));
          return reject(new Error(mapYtDlpError(err, stderr)));
        }
        let info;
        try {
          info = JSON.parse(stdout);
        } catch {
          log('yt-dlp returned unparsable output for', url);
          return reject(new Error('Could not read the video info. Try again.'));
        }
        resolve(info);
      }
    );
  });
}

// ---------- MP3 (proxy method — the ONLY part that downloads) ----------
// The backend downloads the best audio and converts it to MP3.
// This uses a little of the home connection (~5-10 MB per song),
// unlike the video direct links. ffmpeg must be installed
// (on PATH, or set FFMPEG_PATH in .env).
const TEMP_DIR = path.join(__dirname, 'temp');
try { fs.mkdirSync(TEMP_DIR, { recursive: true }); } catch { /* ignore */ }

// Delete temp MP3 job folders older than 10 minutes (safety net
// in case a download is abandoned mid-way).
setInterval(() => {
  try {
    for (const entry of fs.readdirSync(TEMP_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(TEMP_DIR, entry.name);
      try {
        const st = fs.statSync(dir);
        if (Date.now() - st.mtimeMs > 10 * 60 * 1000) fs.rmSync(dir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}, 10 * 60 * 1000).unref();

// Clean a title for use as a download filename (Windows-safe).
function sanitizeFilename(name) {
  const base = String(name || 'audio')
    .replace(/[\\/:*?"<>|]/g, '') // illegal in Windows filenames
    .replace(/\s+/g, ' ') // collapse all whitespace (incl. tabs) to one space
    .replace(/[\x00-\x1f\x7f]/g, '') // strip remaining control chars
    .trim();
  const clean = base.length > 0 ? base : 'audio';
  return clean.slice(0, 100);
}

// ---------- simple per-IP rate limit (30 req/min) ----------
const hits = new Map(); // ip -> [timestamps]
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 30;
}

// ---------- app ----------
const app = express();
app.use(cors()); // GitHub Pages frontend is a different origin
app.use(express.json({ limit: '64kb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'techott-downloader', version: VERSION });
});

app.get('/api/info', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) {
    log('rate-limited', ip);
    return res.status(429).json({ success: false, error: 'Too many requests — wait a minute and try again.' });
  }
  const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!url) {
    return res.status(400).json({ success: false, error: 'Paste a YouTube or Instagram link first.' });
  }
  if (!isAllowedUrl(url)) {
    log('rejected URL', url.slice(0, 120));
    return res.status(400).json({ success: false, error: 'Only YouTube and Instagram links are supported.' });
  }
  try {
    const info = await fetchInfo(url);
    const formats = pickFormats(info);
    if (formats.length === 0) {
      return res.status(502).json({ success: false, error: 'No downloadable formats found for this link.' });
    }
    log('OK', url.slice(0, 120), '|', info.title || '(no title)', '|', formats.length, 'formats');
    res.json({
      success: true,
      title: info.title || 'Video',
      thumbnail: info.thumbnail || '',
      duration: typeof info.duration === 'number' ? info.duration : null,
      durationString: formatDuration(info.duration),
      uploader: info.uploader || info.channel || '',
      webpageUrl: info.webpage_url || url,
      formats,
    });
  } catch (e) {
    res.status(502).json({ success: false, error: e.message || 'Could not fetch this link.' });
  }
});

// MP3 download (proxy method). yt-dlp downloads the best audio
// and converts it to MP3 with ffmpeg, then we serve that file.
// Conversion takes longer, so the timeout is 120 seconds.
// The temp file is deleted right after it is served.
app.get('/api/mp3', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ success: false, error: 'Too many requests — wait a minute and try again.' });
  }
  const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!url) {
    return res.status(400).json({ success: false, error: 'Paste a YouTube or Instagram link first.' });
  }
  if (!isAllowedUrl(url)) {
    return res.status(400).json({ success: false, error: 'Only YouTube and Instagram links are supported.' });
  }
  const jobId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const jobDir = path.join(TEMP_DIR, jobId);
  try { fs.mkdirSync(jobDir, { recursive: true }); } catch {
    return res.status(500).json({ success: false, error: 'Server error. Try again.' });
  }
  const args = ['-x', '--audio-format', 'mp3', '--audio-quality', '0',
    '-o', path.join(jobDir, '%(title)s.%(ext)s'), '--no-playlist'];
  if (FFMPEG_PATH) args.push('--ffmpeg-location', FFMPEG_PATH);
  args.push(url);
  log('MP3 start', url.slice(0, 120), '| job', jobId);
  execFile(YT_DLP, args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
    if (err) {
      log('MP3 FAILED', url.slice(0, 120), '|', String(stderr || err.message).slice(0, 300));
      try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch { /* ignore */ }
      const text = String(stderr || '').toLowerCase();
      if (text.includes('ffmpeg') && (text.includes('not found') || text.includes('not installed') || text.includes('no such'))) {
        return res.status(502).json({ success: false, error: 'ffmpeg is not installed on the server. Install ffmpeg and set FFMPEG_PATH if needed.' });
      }
      return res.status(502).json({ success: false, error: mapYtDlpError(err, stderr) });
    }
    // Find the mp3 yt-dlp produced in this job's folder.
    let mp3File = null;
    try {
      const files = fs.readdirSync(jobDir).filter((f) => f.toLowerCase().endsWith('.mp3'));
      if (files.length > 0) {
        files.sort((a, b) => fs.statSync(path.join(jobDir, b)).size - fs.statSync(path.join(jobDir, a)).size);
        mp3File = path.join(jobDir, files[0]);
      }
    } catch { /* ignore */ }
    if (!mp3File) {
      log('MP3 no output file', url.slice(0, 120));
      try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch { /* ignore */ }
      return res.status(502).json({ success: false, error: 'Could not convert this link to MP3. Try again.' });
    }
    const downloadName = sanitizeFilename(path.basename(mp3File, '.mp3')) + '.mp3';
    log('MP3 OK', url.slice(0, 120), '|', downloadName);
    res.download(mp3File, downloadName, (dlErr) => {
      // Delete the temp job folder once the download finishes (or fails).
      try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch { /* ignore */ }
      if (dlErr) log('MP3 send error', dlErr.message);
    });
  });
});

// 404 + error handler
app.use((req, res) => res.status(404).json({ success: false, error: 'Not found.' }));
app.use((err, req, res, next) => {
  log('server error', err && err.message);
  res.status(500).json({ success: false, error: 'Server error. Try again.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    log(`techott-downloader backend v${VERSION} listening on port ${PORT}`);
    log(`yt-dlp: ${YT_DLP}`);
  });
}

module.exports = { app, isAllowedUrl, pickFormats, mapYtDlpError, formatDuration, sanitizeFilename };
