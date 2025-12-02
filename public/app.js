// DOM Elements
const magnetInput = document.getElementById('magnetInput');
const addBtn = document.getElementById('addBtn');
const loadTrackersBtn = document.getElementById('loadTrackersBtn');
const trackerCount = document.getElementById('trackerCount');
const playerSection = document.getElementById('playerSection');
const videoPlayer = document.getElementById('videoPlayer');
const vlcLink = document.getElementById('vlcLink');
const rawLink = document.getElementById('rawLink');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const fileSection = document.getElementById('fileSection');
const fileList = document.getElementById('fileList');
const deleteBtn = document.getElementById('deleteBtn');
const statsSection = document.getElementById('statsSection');
const downloadSpeedEl = document.getElementById('downloadSpeed');
const peersEl = document.getElementById('peers');
const progressEl = document.getElementById('progress');
const bufferFill = document.getElementById('bufferFill');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');
const pieceMapCanvas = document.getElementById('pieceMap');
const playbackMarker = document.getElementById('playbackMarker');
const pieceMapCtx = pieceMapCanvas.getContext('2d');

// Video file extensions
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.webm', '.mov', '.wmv', '.flv', '.m4v'];

// State
let currentFileIndex = null;
let statusInterval = null;
let player = null;
let lastReportedTime = 0;

// Initialize Plyr
function initPlyr() {
  player = new Plyr('#videoPlayer', {
    controls: [
      'play-large',
      'rewind',
      'play',
      'fast-forward',
      'progress',
      'current-time',
      'duration',
      'mute',
      'volume',
      'fullscreen'
    ],
    keyboard: { focused: true, global: true },
    tooltips: { controls: false, seek: true },
    seekTime: 10
  });

  // Track playback position for piece prioritization
  player.on('timeupdate', () => {
    updatePlaybackMarker();
    if (currentFileIndex !== null && Math.abs(player.currentTime - lastReportedTime) > 5) {
      lastReportedTime = player.currentTime;
      updatePlaybackPosition(currentFileIndex, player.currentTime, player.duration);
    }
  });

  // Report position immediately when seeking
  player.on('seeking', () => {
    if (currentFileIndex !== null) {
      lastReportedTime = player.currentTime;
      updatePlaybackPosition(currentFileIndex, player.currentTime, player.duration);
    }
  });

  // Report initial position
  player.on('loadedmetadata', () => {
    if (currentFileIndex !== null) {
      updatePlaybackPosition(currentFileIndex, 0, player.duration);
    }
  });
}

// Utility Functions
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function isVideoFile(filename) {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return VIDEO_EXTENSIONS.includes(ext);
}

function getStreamUrl(fileIndex) {
  return `${window.location.origin}/stream/${fileIndex}`;
}

function showLoading(text = 'Loading...') {
  loadingText.textContent = text;
  loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

// Render piece map visualization
function renderPieceMap(pieceMap) {
  if (!pieceMap || pieceMap.length === 0) return;

  const canvas = pieceMapCanvas;
  const ctx = pieceMapCtx;

  // Set canvas size to match container
  const container = canvas.parentElement;
  const width = container.clientWidth;
  const height = container.clientHeight;

  // Set actual canvas resolution
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  // Calculate piece width
  const pieceWidth = width / pieceMap.length;

  // Draw pieces
  pieceMap.forEach((downloaded, index) => {
    const x = index * pieceWidth;

    if (downloaded) {
      // Downloaded - cyan
      ctx.fillStyle = '#00d4ff';
    } else {
      // Not downloaded - dark blue
      ctx.fillStyle = '#0f3460';
    }

    ctx.fillRect(x, 0, Math.ceil(pieceWidth), height);
  });
}

// Update playback marker position
function updatePlaybackMarker() {
  if (!player || !player.duration) return;
  const percent = (player.currentTime / player.duration) * 100;
  playbackMarker.style.left = `${percent}%`;
}

// API Functions
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    return await res.json();
  } catch (err) {
    console.error('Error fetching status:', err);
    return null;
  }
}

async function addTorrent(magnetOrHash) {
  const res = await fetch('/api/torrent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magnetOrHash })
  });
  return await res.json();
}

async function deleteTorrent() {
  const res = await fetch('/api/torrent', { method: 'DELETE' });
  return await res.json();
}

async function reloadTrackers() {
  const res = await fetch('/api/trackers/reload', { method: 'POST' });
  return await res.json();
}

async function updatePlaybackPosition(fileIndex, currentTime, duration) {
  try {
    await fetch('/api/playback-position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileIndex, currentTime, duration })
    });
  } catch (err) {
    // Silently fail - not critical
  }
}

// UI Functions
function updateTrackerCount(count) {
  trackerCount.textContent = `Trackers: ${count}`;
}

function renderFileList(files) {
  fileList.innerHTML = '';

  files.forEach((file, index) => {
    const isVideo = isVideoFile(file.name);
    const div = document.createElement('div');
    div.className = `file-item ${isVideo ? 'video' : 'non-video'}`;
    if (index === currentFileIndex) {
      div.classList.add('playing');
    }

    div.innerHTML = `
            <span class="file-name">${file.name}</span>
            <span class="file-size">${formatBytes(file.length)}</span>
            ${index === currentFileIndex ? '<span class="file-status">▶ Playing</span>' : ''}
        `;

    if (isVideo) {
      div.addEventListener('click', () => playFile(index));
    }

    fileList.appendChild(div);
  });
}

function playFile(fileIndex) {
  currentFileIndex = fileIndex;
  const streamUrl = getStreamUrl(fileIndex);

  // Update Plyr source
  player.source = {
    type: 'video',
    sources: [{ src: streamUrl, type: 'video/mp4' }]
  };

  // Update external links
  vlcLink.href = `vlc://${streamUrl}`;
  rawLink.href = streamUrl;

  // Show player section
  playerSection.classList.remove('hidden');

  // Start playback
  player.play().catch(err => console.log('Autoplay prevented:', err));

  // Re-render file list to show playing status
  fetchStatus().then(status => {
    if (status && status.files) {
      renderFileList(status.files);
    }
  });
}

function updateStats(status) {
  if (!status || !status.active) return;

  downloadSpeedEl.textContent = `${formatBytes(status.downloadSpeed)}/s`;
  peersEl.textContent = status.numPeers;

  const downloaded = formatBytes(status.downloaded);
  const total = formatBytes(status.total);
  const percent = status.total > 0 ? ((status.downloaded / status.total) * 100).toFixed(1) : 0;
  progressEl.textContent = `${downloaded} / ${total} (${percent}%)`;

  // Render piece map if available
  if (status.pieceMap && status.pieceMap.length > 0) {
    renderPieceMap(status.pieceMap);
  }

  // Buffer health - show how many seconds are buffered ahead
  if (currentFileIndex !== null && status.bufferAhead !== undefined && player && player.duration) {
    const file = status.files[currentFileIndex];
    // Estimate seconds buffered based on byte position
    const bytesPerSecond = file.length / player.duration;
    const secondsBuffered = bytesPerSecond > 0 ? status.bufferAhead / bytesPerSecond : 0;

    // Update buffer bar (cap at 60 seconds = 100%)
    const bufferPercent = Math.min((secondsBuffered / 60) * 100, 100);
    bufferFill.style.width = `${bufferPercent}%`;

    // Update buffer label
    const bufferLabel = document.getElementById('bufferLabel');
    if (bufferLabel) {
      if (secondsBuffered > 60) {
        bufferLabel.textContent = `${Math.floor(secondsBuffered / 60)}m ${Math.floor(secondsBuffered % 60)}s ahead`;
      } else {
        bufferLabel.textContent = `${Math.floor(secondsBuffered)}s ahead`;
      }
    }
  } else if (currentFileIndex !== null && status.files && status.files[currentFileIndex]) {
    // Fallback to file progress if buffer info not available
    const file = status.files[currentFileIndex];
    const fileProgress = (file.progress * 100).toFixed(0);
    bufferFill.style.width = `${fileProgress}%`;
  } else {
    bufferFill.style.width = `${(status.progress * 100).toFixed(0)}%`;
  }
}

function resetUI() {
  playerSection.classList.add('hidden');
  fileSection.classList.add('hidden');
  statsSection.classList.add('hidden');
  if (player) player.stop();
  currentFileIndex = null;
  fileList.innerHTML = '';
}

// Event Handlers
addBtn.addEventListener('click', async () => {
  const input = magnetInput.value.trim();
  if (!input) return;

  showLoading('Loading torrent metadata...');

  try {
    const result = await addTorrent(input);

    if (result.error) {
      alert('Error: ' + result.error);
      hideLoading();
      return;
    }

    // Show file section
    fileSection.classList.remove('hidden');
    statsSection.classList.remove('hidden');
    renderFileList(result.files);

    // Auto-select if only one video file
    const videoFiles = result.files.filter(f => isVideoFile(f.name));
    if (videoFiles.length === 1) {
      const videoIndex = result.files.findIndex(f => isVideoFile(f.name));
      playFile(videoIndex);
    }

    // Start status polling
    if (statusInterval) clearInterval(statusInterval);
    statusInterval = setInterval(async () => {
      const status = await fetchStatus();
      if (status && status.active) {
        updateStats(status);
      }
    }, 1000);

    magnetInput.value = '';
  } catch (err) {
    alert('Error adding torrent: ' + err.message);
  }

  hideLoading();
});

magnetInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addBtn.click();
  }
});

deleteBtn.addEventListener('click', async () => {
  showLoading('Deleting torrent...');

  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }

  await deleteTorrent();
  resetUI();
  hideLoading();
});

loadTrackersBtn.addEventListener('click', async () => {
  showLoading('Reloading trackers...');
  const result = await reloadTrackers();
  updateTrackerCount(result.count);
  hideLoading();
});

copyLinkBtn.addEventListener('click', () => {
  if (currentFileIndex === null) return;
  const url = getStreamUrl(currentFileIndex);
  navigator.clipboard.writeText(url).then(() => {
    const originalText = copyLinkBtn.textContent;
    copyLinkBtn.textContent = '✓ Copied!';
    setTimeout(() => {
      copyLinkBtn.textContent = originalText;
    }, 2000);
  });
});

// Skip buttons
document.querySelectorAll('.skip-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!player) return;
    const skip = parseInt(btn.dataset.skip, 10);
    player.currentTime = Math.max(0, Math.min(player.duration || 0, player.currentTime + skip));
  });
});

// Initialize
async function init() {
  // Initialize Plyr first
  initPlyr();

  const status = await fetchStatus();

  if (status) {
    updateTrackerCount(status.trackerCount);

    if (status.active) {
      fileSection.classList.remove('hidden');
      statsSection.classList.remove('hidden');
      renderFileList(status.files);
      updateStats(status);

      // Start status polling
      statusInterval = setInterval(async () => {
        const s = await fetchStatus();
        if (s && s.active) {
          updateStats(s);
        }
      }, 1000);
    }
  }
}

init();
