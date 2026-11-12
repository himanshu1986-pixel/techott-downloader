// Tech OTT Downloader — redesigned frontend.
// API routes and API base selection are intentionally unchanged.
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
const statusText = document.getElementById('status-text');
const errorEl = document.getElementById('error');
const errorText = document.getElementById('error-text');
const resultEl = document.getElementById('result');
const apiStateEl = document.getElementById('api-state');
const mp3Btn = document.getElementById('mp3-btn');
const mp3Status = document.getElementById('mp3-status');
const clearBtn = document.getElementById('clear-btn');
const audioSection = document.getElementById('audio-section');
const audioLink = document.getElementById('audio-link');
let currentUrl = '';

function showStatus(message) {
  statusText.textContent = message;
  statusEl.hidden = false;
}
function hideStatus() { statusEl.hidden = true; }
function showError(message) {
  errorText.textContent = message;
  errorEl.hidden = false;
}
function hideError() { errorEl.hidden = true; }

function fmtSize(bytes) {
  if (typeof bytes !== 'number' || bytes <= 0) return '';
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return Math.round(bytes / 1e3) + ' KB';
}

function isSupportedUrl(raw) {
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return ['youtube.com', 'm.youtube.com', 'youtu.be', 'instagram.com'].includes(host) ||
      host.endsWith('.youtube.com') || host.endsWith('.instagram.com');
  } catch {
    return false;
  }
}

function friendlyError(message) {
  const value = String(message || '').toLowerCase();
  if (/private|login|required|unavailable|not available|deleted|removed|restricted|age/.test(value)) {
    return 'This video may be private, restricted, deleted, or unavailable. Try a public video link that you have permission to download.';
  }
  if (/invalid|unsupported|url/.test(value)) {
    return 'That link does not look valid. Paste a public YouTube or Instagram video URL and try again.';
  }
  return message || 'We could not fetch this video. Please check the link and try again.';
}

function createFormatLink(format) {
  const link = document.createElement('a');
  link.className = 'fmt';
  link.href = format.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('download', '');

  const info = document.createElement('span');
  info.className = 'fmt-info';
  const quality = document.createElement('span');
  quality.className = 'q';
  quality.textContent = (format.quality || format.format_note || format.height && (format.height + 'p') || 'Video') +
    (format.ext ? ' (' + String(format.ext).toUpperCase() + ')' : '');
  const meta = document.createElement('span');
  meta.className = 'meta';
  const size = fmtSize(format.filesize || format.filesize_approx);
  meta.textContent = [size, format.note || 'Direct video link'].filter(Boolean).join(' · ');
  info.append(quality, meta);

  const download = document.createElement('span');
  download.className = 'dl';
  download.textContent = 'Download ↓';
  link.append(info, download);
  return link;
}

function isAudioFormat(item) {
  if (!item) return false;
  return item.type === 'audio' || item.vcodec === 'none' || item.audioOnly === true ||
    (typeof item.quality === 'string' && item.quality.indexOf('Audio (') === 0);
}

function getAudioFormat(data) {
  // Supports the common response shapes without changing the API request.
  const candidate = data.audio || data.audioUrl || data.audio_url ||
    (Array.isArray(data.formats) ? data.formats.find(isAudioFormat) : null);
  if (!candidate) return null;
  if (typeof candidate === 'string') return { url: candidate };
  return candidate.url ? candidate : null;
}

function renderResult(data) {
  const thumb = document.getElementById('thumb');
  const placeholder = document.getElementById('thumb-placeholder');
  if (data.thumbnail) {
    thumb.src = data.thumbnail;
    thumb.style.display = 'block';
    placeholder.hidden = true;
    thumb.onerror = () => { thumb.style.display = 'none'; placeholder.hidden = false; };
  } else {
    thumb.removeAttribute('src');
    thumb.style.display = 'none';
    placeholder.hidden = false;
  }

  document.getElementById('v-title').textContent = data.title || 'Video ready to download';
  document.getElementById('v-uploader').textContent = data.uploader ? 'By ' + data.uploader : '';
  document.getElementById('v-duration').textContent = data.durationString ? 'Duration: ' + data.durationString : '';
  const source = document.getElementById('v-source');
  if (data.webpageUrl) {
    source.href = data.webpageUrl;
    source.hidden = false;
  } else {
    source.hidden = true;
  }

  const formatsBox = document.getElementById('formats');
  formatsBox.replaceChildren();
  const formats = Array.isArray(data.formats) ? data.formats.filter((f) =>
    f && f.url && !isAudioFormat(f)) : [];
  formats.forEach((format) => formatsBox.appendChild(createFormatLink(format)));
  document.getElementById('no-formats').hidden = formats.length > 0;

  const audio = getAudioFormat(data);
  if (audio && audio.url) {
    audioLink.href = audio.url;
    audioLink.setAttribute('download', '');
    audioSection.hidden = false;
  } else {
    audioLink.removeAttribute('href');
    audioSection.hidden = true;
  }

  currentUrl = data.webpageUrl || input.value.trim();
  mp3Btn.disabled = false;
  mp3Btn.innerHTML = 'Download MP3 <span>↓</span>';
  mp3Status.hidden = true;
  resultEl.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = input.value.trim();
  hideError();
  resultEl.hidden = true;
  mp3Status.hidden = true;

  if (!url) {
    showError('Paste a YouTube or Instagram link first.');
    input.focus();
    return;
  }
  if (!isSupportedUrl(url)) {
    showError('Please enter a valid YouTube or Instagram video URL.');
    input.focus();
    return;
  }

  goBtn.disabled = true;
  goBtn.querySelector('.btn-label').textContent = 'Getting links...';
  goBtn.querySelector('.btn-arrow').textContent = '…';
  showStatus('Fetching download links. This may take up to a minute...');
  try {
    const res = await fetch(API_BASE + '/api/info?url=' + encodeURIComponent(url));
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON response */ }
    if (!res.ok || !data || !data.success) {
      showError(friendlyError(data && data.error));
      return;
    }
    renderResult(data);
  } catch (error) {
    showError('The downloader backend is offline or unreachable. Please try again in a moment.');
  } finally {
    hideStatus();
    goBtn.disabled = false;
    goBtn.querySelector('.btn-label').textContent = 'Get download links';
    goBtn.querySelector('.btn-arrow').textContent = '↗';
  }
});

clearBtn.addEventListener('click', () => {
  input.value = '';
  clearBtn.hidden = true;
  input.focus();
});
input.addEventListener('input', () => { clearBtn.hidden = !input.value; });

// MP3 conversion endpoint is unchanged.
mp3Btn.addEventListener('click', async () => {
  if (!currentUrl) return;
  mp3Btn.disabled = true;
  mp3Btn.textContent = 'Converting...';
  mp3Status.hidden = false;
  mp3Status.textContent = 'Converting to MP3. Longer videos may take a little while.';
  try {
    const res = await fetch(API_BASE + '/api/mp3?url=' + encodeURIComponent(currentUrl));
    const type = res.headers.get('content-type') || '';
    if (!res.ok || type.includes('application/json')) {
      let message = 'Could not convert this link to MP3.';
      try {
        const data = await res.json();
        if (data && data.error) message = friendlyError(data.error);
      } catch { /* ignore non-JSON response */ }
      mp3Status.textContent = message;
      return;
    }
    const blob = await res.blob();
    let filename = 'audio.mp3';
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename\\*=UTF-8''([^;]+)|filename="?([^";]+)"?/);
    if (match) {
      try { filename = decodeURIComponent(match[1] || match[2]); }
      catch { filename = match[1] || match[2] || filename; }
    }
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    mp3Status.textContent = 'Your MP3 download has started.';
  } catch (error) {
    mp3Status.textContent = 'The downloader backend is offline or unreachable. Please try again later.';
  } finally {
    mp3Btn.disabled = false;
    mp3Btn.innerHTML = 'Download MP3 <span>↓</span>';
  }
});

// Health check endpoint is unchanged.
apiStateEl.textContent = 'Backend: checking...';
fetch(API_BASE + '/api/health')
  .then((response) => {
    if (!response.ok) throw new Error('Health check failed');
    return response.json();
  })
  .then((data) => {
    apiStateEl.textContent = (data && data.version) ? 'Backend v' + data.version : 'Backend: online';
    apiStateEl.classList.add('online');
  })
  .catch(() => {
    apiStateEl.textContent = 'Backend: offline';
    apiStateEl.classList.add('offline');
  });
