# Torrent Stream Server - Copilot Instructions

## Project Overview

A single-page web application for streaming torrents directly in the browser. Built with Node.js backend (Express + WebTorrent) and plain HTML/CSS/JavaScript frontend.

## Tech Stack

- **Backend**: Node.js, Express, WebTorrent
- **Frontend**: HTML, CSS, JavaScript (no frameworks)
- **Port**: 8888

## Key Design Decisions

### Torrent Handling

- One torrent at a time only
- New torrent silently replaces the old one
- Sequential downloading for streaming optimization
- Minimal upload (5 KB/s) to stay connected to peers
- Temp files stored in `./temp`, deleted when torrent is removed

### Video Streaming

- No transcoding - direct streaming only
- HTML5 video player with native controls
- External player support: VLC protocol link (`vlc://`) and raw HTTP stream URL
- Fast start priority: small buffer (2-5 seconds)

### Trackers

- Auto-loaded on server startup
- Sources: `./trackers.txt` (custom) + ngosang best trackers URL
- One tracker per line, empty lines and `#` comments ignored
- UI button to reload trackers

### UI/UX

- Dark theme only
- Mobile-first responsive design
- Player on top, controls below, then file list, then stats
- Skip buttons: -10m, -1m, -10s, +10s, +1m, +10m
- File list always visible (not a popup)
- Auto-select video if only one video file in torrent
- Video files clickable, non-video files greyed out

### Statistics Displayed

- Download speed
- Connected peers
- Downloaded / Total size with percentage
- Buffer health indicator

### What's NOT Included

- No authentication
- No transcoding
- No subtitle support
- No persistence/history
- No multiple simultaneous torrents
- No upload statistics (upload is minimized)

## File Structure

```
torrent_stream_server/
├── server.js           # Express server + WebTorrent client
├── package.json
├── trackers.txt        # Custom tracker list
├── temp/               # Temporary downloads (auto-cleaned)
├── public/
│   ├── index.html      # Single page UI
│   ├── style.css       # Dark theme styles
│   └── app.js          # Frontend logic
├── .github/
│   └── copilot-instructions.md
└── README.md
```

## API Reference

- `GET /api/status` - Torrent status, files, stats
- `POST /api/torrent` - Add torrent `{ magnetOrHash }`
- `DELETE /api/torrent` - Remove torrent and files
- `POST /api/trackers/reload` - Refresh tracker list
- `GET /stream/:fileIndex` - Stream file with range support
