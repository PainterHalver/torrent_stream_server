import express from 'express';
import WebTorrent from 'webtorrent';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 8888;
const TEMP_DIR = path.join(__dirname, 'temp');
const TRACKERS_FILE = path.join(__dirname, 'trackers.txt');
const NGOSANG_URL = 'https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt';

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// WebTorrent client with minimal upload
const client = new WebTorrent({
  uploadLimit: 5000 // 5 KB/s max upload
});

// Store loaded trackers
let loadedTrackers = [];

// Current torrent reference
let currentTorrent = null;

// Load trackers from file and ngosang URL
async function loadTrackers() {
  const trackers = new Set();

  // Load from local file
  try {
    if (fs.existsSync(TRACKERS_FILE)) {
      const content = fs.readFileSync(TRACKERS_FILE, 'utf-8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          trackers.add(trimmed);
        }
      });
      console.log(`Loaded ${trackers.size} trackers from local file`);
    }
  } catch (err) {
    console.error('Error loading local trackers:', err.message);
  }

  // Load from ngosang URL
  try {
    const response = await fetch(NGOSANG_URL);
    if (response.ok) {
      const content = await response.text();
      let ngosangCount = 0;
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          if (!trackers.has(trimmed)) {
            trackers.add(trimmed);
            ngosangCount++;
          }
        }
      });
      console.log(`Loaded ${ngosangCount} additional trackers from ngosang`);
    }
  } catch (err) {
    console.error('Error loading ngosang trackers:', err.message);
  }

  loadedTrackers = Array.from(trackers);
  console.log(`Total trackers loaded: ${loadedTrackers.length}`);
  return loadedTrackers;
}

// Clean temp directory
function cleanTempDir() {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    for (const file of files) {
      fs.rmSync(path.join(TEMP_DIR, file), { recursive: true, force: true });
    }
    console.log('Temp directory cleaned');
  } catch (err) {
    console.error('Error cleaning temp dir:', err.message);
  }
}

// Destroy current torrent
function destroyCurrentTorrent() {
  return new Promise((resolve) => {
    if (currentTorrent) {
      const torrentToDestroy = currentTorrent;
      currentTorrent = null;
      torrentToDestroy.destroy({ destroyStore: true }, () => {
        cleanTempDir();
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API: Get current status
app.get('/api/status', (req, res) => {
  if (!currentTorrent) {
    return res.json({
      active: false,
      trackerCount: loadedTrackers.length
    });
  }

  const torrent = currentTorrent;
  res.json({
    active: true,
    name: torrent.name,
    infoHash: torrent.infoHash,
    progress: torrent.progress,
    downloaded: torrent.downloaded,
    total: torrent.length,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    numPeers: torrent.numPeers,
    ready: torrent.ready,
    files: torrent.files.map((f, index) => ({
      index,
      name: f.name,
      path: f.path,
      length: f.length,
      downloaded: f.downloaded,
      progress: f.progress
    })),
    trackerCount: loadedTrackers.length
  });
});

// API: Add torrent
app.post('/api/torrent', async (req, res) => {
  const { magnetOrHash } = req.body;

  if (!magnetOrHash) {
    return res.status(400).json({ error: 'Magnet link or hash required' });
  }

  // Destroy existing torrent
  await destroyCurrentTorrent();

  // Normalize input - if it's just a hash, convert to magnet
  let magnetUri = magnetOrHash.trim();
  if (!magnetUri.startsWith('magnet:')) {
    // Assume it's an info hash
    magnetUri = `magnet:?xt=urn:btih:${magnetUri}`;
  }

  // Add trackers to magnet
  if (loadedTrackers.length > 0) {
    const trackerParams = loadedTrackers.map(t => `&tr=${encodeURIComponent(t)}`).join('');
    magnetUri += trackerParams;
  }

  try {
    currentTorrent = client.add(magnetUri, {
      path: TEMP_DIR,
      strategy: 'sequential' // Sequential download for streaming
    });

    currentTorrent.on('error', (err) => {
      console.error('Torrent error:', err.message);
    });

    currentTorrent.on('ready', () => {
      console.log(`Torrent ready: ${currentTorrent.name}`);
    });

    // Wait for metadata with timeout
    const timeout = setTimeout(() => {
      if (!currentTorrent.ready) {
        res.status(408).json({ error: 'Timeout waiting for torrent metadata' });
      }
    }, 30000);

    currentTorrent.on('ready', () => {
      clearTimeout(timeout);
      res.json({
        success: true,
        name: currentTorrent.name,
        infoHash: currentTorrent.infoHash,
        files: currentTorrent.files.map((f, index) => ({
          index,
          name: f.name,
          path: f.path,
          length: f.length
        }))
      });
    });

  } catch (err) {
    console.error('Error adding torrent:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// API: Delete current torrent
app.delete('/api/torrent', async (req, res) => {
  await destroyCurrentTorrent();
  res.json({ success: true });
});

// API: Reload trackers
app.post('/api/trackers/reload', async (req, res) => {
  await loadTrackers();
  res.json({
    success: true,
    count: loadedTrackers.length
  });
});

// API: Get tracker count
app.get('/api/trackers', (req, res) => {
  res.json({
    count: loadedTrackers.length
  });
});

// Stream video file
app.get('/stream/:fileIndex', (req, res) => {
  if (!currentTorrent || !currentTorrent.ready) {
    return res.status(404).json({ error: 'No active torrent' });
  }

  const fileIndex = parseInt(req.params.fileIndex, 10);
  const file = currentTorrent.files[fileIndex];

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  const range = req.headers.range;
  const fileSize = file.length;

  // Get file extension for content type
  const ext = path.extname(file.name).toLowerCase();
  const contentTypes = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
    '.m4v': 'video/x-m4v'
  };
  const contentType = contentTypes[ext] || 'application/octet-stream';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType
    });

    const stream = file.createReadStream({ start, end });
    stream.pipe(res);

    stream.on('error', (err) => {
      console.error('Stream error:', err.message);
      res.end();
    });
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType
    });

    const stream = file.createReadStream();
    stream.pipe(res);

    stream.on('error', (err) => {
      console.error('Stream error:', err.message);
      res.end();
    });
  }
});

// Start server
async function start() {
  // Load trackers on startup
  await loadTrackers();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎬 Torrent Stream Server running at http://localhost:${PORT}`);
    console.log(`   Access from other devices: http://<your-ip>:${PORT}\n`);
  });
}

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await destroyCurrentTorrent();
  client.destroy();
  process.exit(0);
});

start();
