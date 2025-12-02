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

// Track current playback position for buffer calculation
let currentPlaybackPosition = { fileIndex: null, bytePosition: 0 };

// Prioritize pieces from a specific byte position for streaming using critical()
function prioritizePiecesFrom(file, startByte) {
  if (!currentTorrent || !currentTorrent.pieces) return;

  const pieceLength = currentTorrent.pieceLength;
  const fileOffset = file.offset; // Byte offset of file within torrent
  const absoluteStart = fileOffset + startByte;
  const fileEnd = fileOffset + file.length;

  // Calculate piece indices
  const startPiece = Math.floor(absoluteStart / pieceLength);
  const endPiece = Math.floor(fileEnd / pieceLength);

  // Mark critical pieces - enough for ~30 seconds of buffer ahead
  // Assuming ~5MB per 30 seconds of video at decent quality
  const piecesToPrioritize = Math.min(Math.ceil(5 * 1024 * 1024 / pieceLength), 50);
  const criticalEnd = Math.min(startPiece + piecesToPrioritize, endPiece);

  // Use critical() to mark these pieces for immediate download
  currentTorrent.critical(startPiece, criticalEnd);

  console.log(`Marked pieces ${startPiece}-${criticalEnd} as critical (${criticalEnd - startPiece + 1} pieces)`);
}

// Calculate how many bytes are buffered ahead from current position
function getBufferAhead(file, currentByte) {
  if (!currentTorrent || !currentTorrent.bitfield) return 0;

  const pieceLength = currentTorrent.pieceLength;
  const fileOffset = file.offset;
  const absoluteStart = fileOffset + currentByte;
  const fileEnd = fileOffset + file.length;

  let bufferedBytes = 0;
  let currentPiece = Math.floor(absoluteStart / pieceLength);
  const endPiece = Math.floor(fileEnd / pieceLength);

  // Count consecutive downloaded pieces from current position
  while (currentPiece <= endPiece && currentTorrent.bitfield.get(currentPiece)) {
    // Calculate how much of this piece belongs to our range
    const pieceStart = currentPiece * pieceLength;
    const pieceEnd = pieceStart + pieceLength;

    const rangeStart = Math.max(pieceStart, absoluteStart);
    const rangeEnd = Math.min(pieceEnd, fileEnd);

    bufferedBytes += rangeEnd - rangeStart;
    currentPiece++;
  }

  return bufferedBytes;
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

  // Calculate buffer ahead for current file
  let bufferAhead = 0;
  let pieceMap = [];
  if (currentPlaybackPosition.fileIndex !== null && torrent.files[currentPlaybackPosition.fileIndex]) {
    const file = torrent.files[currentPlaybackPosition.fileIndex];
    bufferAhead = getBufferAhead(file, currentPlaybackPosition.bytePosition);

    // Generate piece map for current file (which pieces are downloaded)
    const pieceLength = torrent.pieceLength;
    const fileOffset = file.offset;
    const fileEnd = fileOffset + file.length;
    const startPiece = Math.floor(fileOffset / pieceLength);
    const endPiece = Math.floor(fileEnd / pieceLength);

    for (let i = startPiece; i <= endPiece; i++) {
      pieceMap.push(torrent.bitfield ? torrent.bitfield.get(i) : false);
    }
  }

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
    bufferAhead: bufferAhead,
    pieceMap: pieceMap,
    currentPosition: currentPlaybackPosition,
    pieceLength: torrent.pieceLength,
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

// API: Update playback position (for piece prioritization)
app.post('/api/playback-position', (req, res) => {
  const { fileIndex, currentTime, duration } = req.body;

  if (!currentTorrent || !currentTorrent.ready) {
    return res.status(404).json({ error: 'No active torrent' });
  }

  const file = currentTorrent.files[fileIndex];
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Convert time position to byte position (approximate)
  const bytePosition = duration > 0 ? Math.floor((currentTime / duration) * file.length) : 0;

  currentPlaybackPosition = { fileIndex, bytePosition };

  // Prioritize pieces from this position
  prioritizePiecesFrom(file, bytePosition);

  res.json({ success: true, bytePosition });
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

  // Helper to handle stream with proper cleanup
  const handleStream = (stream) => {
    let destroyed = false;

    const cleanup = () => {
      if (!destroyed) {
        destroyed = true;
        stream.destroy();
      }
    };

    // Client disconnected (seek, close tab, etc) - this is normal
    res.on('close', cleanup);
    res.on('finish', cleanup);

    stream.on('error', (err) => {
      // Only log unexpected errors, not normal browser disconnects
      if (!err.message.includes('Writable stream closed') &&
        !err.message.includes('ECONNRESET') &&
        !err.message.includes('aborted')) {
        console.error('Stream error:', err.message);
      }
      cleanup();
    });

    stream.pipe(res);
  };

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
    handleStream(stream);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType
    });

    const stream = file.createReadStream();
    handleStream(stream);
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
