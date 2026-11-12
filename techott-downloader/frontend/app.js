// Tech OTT Downloader — frontend (plain JS, no build step)
//
// CHANGE THIS IF YOUR BACKEND URL IS DIFFERENT:
// - Local test: the page is opened on localhost, so we talk to
//   the backend on http://localhost:8001
// - Production: the GitHub Pages site talks to the backend at
//   https://dl.techott.store (point that subdomain at your
//   downloader server — see ../README.md, "Subdomain" section).
// If your backend lives at another address, put it here.
const API_BASE = (function () {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '') {
    return 'http://localhost:8001';
  }
  return 'https://dl.techott.store';
})();

const form = document.getElementById('dl-form');
const input = document.getElementById('url-input');
const goBtn = document.getElementById('go-btn');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');
const resultEl = document.getElementById('result');
const apiStateEl = document.getElementById('api-state');
const mp3Btn = document.getElementById('mp3-btn');
const mp3Status = document.getElementById('mp3-status');

// The URL of the video currently shown (used by the MP3 button).
let currentUrl = '';

function showStatus(msg) {
  statusEl.hidden = false;
  statusEl.textContent = msg;
}
function hideStatus() { statusEl.hidden = true; }
function showError(msg) {
  errorEl.hidden = false;
  errorEl.textContent = msg;
}
function hideError() { errorEl.hidden = true; }

function fmtSize(bytes) {
  if (typeof bytes !== 'number' || bytes <= 0) return '';
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return Math.round(bytes / 1e3) + ' KB';
}

function renderResult(data) {
  document.getElementById('thumb').src = data.thumbnail || '';
  document.getElementById('thumb').style.display = data.thumbnail ? '' : 'none';
  document.getElementById('v-title').textContent = data.title || 'Video';
  document.getElementById('v-uploader').textContent = data.uploader ? 'By ' + data.uploader : '';
  document.getElementById('v-duration').textContent = data.durationString ? 'Duration: ' + data.durationString : '';
  const src = document.getElementById('v-source');
  src.href = data.webpageUrl || '#';

  const box = document.getElementById('formats');
  box.innerHTML = '';
  data.formats.forEach((f) => {
    const a = document.createElement('a');
    a.className = 'fmt';
    a.href = f.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('download', '');
    const size = fmtSize(f.filesize);
    a.innerHTML =
      '<span class="q"></span>' +
      '<span class="meta"></span>' +
      '<span class="dl">Download ↓</span>';
    a.querySelector('.q').textContent = f.quality + (f.ext ? ' (' + f.ext.toUpperCase() + ')' : '');
    a.querySelector('.meta').textContent = size ? size + ' · direct link' : 'direct link';
    box.appendChild(a);
  });
  // Show the MP3 button for this video.
  currentUrl = data.webpageUrl || '';
  mp3Btn.hidden = false;
  mp3Status.hidden = true;
  resultEl.hidden = false;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  hideError();
  resultEl.hidden = true;
  mp3Btn.hidden = true;
  mp3Status.hidden = true;
  if (!url) { showError('Paste a YouTube or Instagram link first.'); return; }
  goBtn.disabled = true;
  showStatus('Fetching download links… (this can take up to a minute)');
  try {
    const res = await fetch(API_BASE + '/api/info?url=' + encodeURIComponent(url));
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON response */ }
    if (!res.ok || !data || !data.success) {
      showError((data && data.error) || 'Could not fetch this link. Try again.');
      return;
    }
    renderResult(data);
  } catch (err) {
    showError('Backend is not reachable — make sure the downloader server is running (' + API_BASE + ').');
  } finally {
    hideStatus();
    goBtn.disabled = false;
  }
});

// MP3 download: the server converts the audio to MP3 (proxy
// method — the only part that downloads through our server).
// Shows a converting state, then starts the file download.
mp3Btn.addEventListener('click', async () => {
  if (!currentUrl) return;
  mp3Btn.disabled = true;
  mp3Btn.textContent = 'Converting to MP3…';
  mp3Status.hidden = false;
  mp3Status.textContent = 'Converting to MP3… this can take a minute for longer videos.';
  try {
    const res = await fetch(API_BASE + '/api/mp3?url=' + encodeURIComponent(currentUrl));
    const type = res.headers.get('content-type') || '';
    if (!res.ok || type.includes('application/json')) {
      let msg = 'Could not convert this link to MP3.';
      try { const d = await res.json(); if (d && d.error) msg = d.error; } catch { /* ignore */ }
      mp3Status.textContent = msg;
      return;
    }
    const blob = await res.blob();
    let filename = 'audio.mp3';
    const cd = res.headers.get('content-disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/);
    if (m) {
      try { filename = decodeURIComponent(m[1] || m[2]); } catch { filename = m[1] || m[2] || filename; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60 * 1000);
    mp3Status.textContent = 'MP3 download started.';
  } catch (err) {
    mp3Status.textContent = 'Backend is not reachable — make sure the downloader server is running (' + API_BASE + ').';
  } finally {
    mp3Btn.disabled = false;
    mp3Btn.textContent = '🎵 Download MP3';
  }
});

// Footer: show the backend version we are connected to.
// This is how you confirm an update took effect after a deploy.
apiStateEl.textContent = 'Backend: checking…';
fetch(API_BASE + '/api/health')
  .then((r) => r.json())
  .then((d) => {
    apiStateEl.textContent = (d && d.version) ? 'Backend v' + d.version : 'Backend: online';
  })
  .catch(() => { apiStateEl.textContent = 'Backend: offline'; });
