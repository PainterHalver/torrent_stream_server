# 🎬 Torrent Stream Server

Stream torrents directly in your browser. Works on both desktop and mobile.

## Features

- Stream video files from torrents in real-time
- Input via magnet link or info hash
- Sequential downloading optimized for streaming
- Skip controls: ±10s, ±1m, ±10m
- Open in VLC or copy stream URL
- Dark theme UI
- Mobile-friendly responsive design
- Auto-loads trackers from local file + ngosang list

## Requirements

- Node.js 18+
- npm

## Installation

```bash
npm install
```

## Usage

```bash
npm start
```

Server runs at `http://localhost:8888`

Access from other devices on your network using your machine's IP address.

## Configuration

### Trackers

Custom trackers can be added to `trackers.txt` (one per line). The server also loads trackers from the [ngosang tracker list](https://github.com/ngosang/trackerslist).

Trackers are loaded automatically on startup. Click "Reload Trackers" in the UI to refresh.

### Port

Default port is `8888`. Modify in `server.js` if needed.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Get current torrent status and stats |
| POST | `/api/torrent` | Add a new torrent (body: `{ magnetOrHash }`) |
| DELETE | `/api/torrent` | Delete current torrent and files |
| POST | `/api/trackers/reload` | Reload tracker list |
| GET | `/api/trackers` | Get tracker count |
| GET | `/stream/:fileIndex` | Stream a file from the torrent |

## Notes

- Only one torrent at a time
- Files are stored temporarily and deleted when torrent is removed
- Minimal upload (5 KB/s) to maintain peer connections
- No authentication - intended for personal use on trusted networks
