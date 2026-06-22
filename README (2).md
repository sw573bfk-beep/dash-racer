# 🏁 TopRacer

A top-down multiplayer browser racing game. 2–32 players, 6 rotating tracks, ELO ranking system.

---

## Features

- **Top-down racing** — WASD or Arrow keys to drive
- **2–32 players** per lobby
- **Matchmaking** — race starts after 2 minutes OR when all players ready up
- **6 custom tracks** that rotate every 10 minutes
- **1 or 5 laps** depending on the track
- **DNF system** — take too long and you're out
- **ELO ranking** — Bronze → Silver → Gold → Platinum → Diamond
- **AI difficulty variety** — (extend `server.js` to add bot players with varying skill)

---

## Quick Start (Local)

### 1. Install dependencies
```bash
npm install
```

### 2. Start the server
```bash
npm start
```

### 3. Open your browser
```
http://localhost:3000
```

Share your local IP (e.g. `http://192.168.1.x:3000`) with friends on the same network to play together.

---

## Deploy Free Online (so anyone can join)

### Option A — Railway (recommended, free tier)
1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select your repo — Railway auto-detects Node.js
4. Your game will be live at a public URL in ~2 minutes

### Option B — Render
1. Push to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your repo, set **Start Command** to `node server.js`
4. Deploy — free tier available

### Option C — Run locally with public tunnel (quickest for testing)
```bash
npx localtunnel --port 3000
```
Share the generated URL with friends.

---

## Tracks

| # | Name | Laps | DNF After |
|---|------|------|-----------|
| 1 | Sunset Circuit | 3 | 90s |
| 2 | Neon Hairpin | 5 | 60s |
| 3 | Mountain Pass | 1 | 120s |
| 4 | City Sprint | 5 | 45s |
| 5 | Desert Oval | 5 | 50s |
| 6 | Twisted Jungle | 3 | 100s |

Tracks rotate every **10 minutes** automatically.

---

## ELO Tiers

| Tier | ELO Range |
|------|-----------|
| Bronze | < 1000 |
| Silver | 1000–1299 |
| Gold | 1300–1599 |
| Platinum | 1600–1999 |
| Diamond | 2000+ |

All players start at **1000 ELO**.

---

## Project Structure

```
racer/
├── server.js          # Node.js + Socket.io server (game logic, ELO, matchmaking)
├── package.json
├── README.md
└── public/
    └── index.html     # Full client: lobby, race canvas, HUD, results
```

---

## Controls

| Key | Action |
|-----|--------|
| W / ↑ | Accelerate |
| S / ↓ | Brake / Reverse |
| A / ← | Steer Left |
| D / → | Steer Right |

---

## Extending the Game

- **Add bots**: In `server.js`, create fake socket entries with a tick loop that moves them along waypoints
- **Persistent ELO**: Replace the in-memory `players` object with a database (e.g. SQLite with `better-sqlite3`)
- **Custom tracks**: Edit the `TRACKS` array in `server.js` — each track needs `waypoints`, `laps`, `dnfMs`, and a `color`
