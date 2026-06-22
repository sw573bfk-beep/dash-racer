const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

// ─── TRACKS ───────────────────────────────────────────────────────────────────
// Each track: name, laps, par time (ms) for DNF, and a series of waypoints
// Waypoints define the centre-line of the track as [x, y] in a 1200x800 canvas
// The client uses these to render walls and checkpoints.

const TRACKS = [
  {
    id: 0,
    name: "Sunset Circuit",
    laps: 3,
    dnfMs: 90000,
    color: "#e07b39",
    waypoints: [
      [100,400],[200,150],[400,80],[700,80],[900,150],[1100,300],
      [1100,500],[900,650],[700,720],[400,720],[200,650],[100,500],[100,400]
    ]
  },
  {
    id: 1,
    name: "Neon Hairpin",
    laps: 5,
    dnfMs: 60000,
    color: "#7b39e0",
    waypoints: [
      [150,600],[150,200],[400,200],[400,400],[600,400],[600,200],
      [900,200],[1050,400],[900,600],[600,600],[400,600],[150,600]
    ]
  },
  {
    id: 2,
    name: "Mountain Pass",
    laps: 1,
    dnfMs: 120000,
    color: "#39a0e0",
    waypoints: [
      [80,700],[80,400],[200,250],[350,150],[500,200],[600,350],
      [700,250],[850,150],[1000,200],[1100,350],[1100,600],[800,700],[400,700],[80,700]
    ]
  },
  {
    id: 3,
    name: "City Sprint",
    laps: 5,
    dnfMs: 45000,
    color: "#e03939",
    waypoints: [
      [100,700],[100,500],[300,500],[300,300],[500,300],[500,500],
      [700,500],[700,300],[900,300],[900,500],[1100,500],[1100,700],[100,700]
    ]
  },
  {
    id: 4,
    name: "Desert Oval",
    laps: 5,
    dnfMs: 50000,
    color: "#e0c039",
    waypoints: [
      [150,400],[200,200],[500,100],[900,100],[1100,300],[1100,500],
      [900,700],[500,700],[200,600],[150,400]
    ]
  },
  {
    id: 5,
    name: "Twisted Jungle",
    laps: 3,
    dnfMs: 100000,
    color: "#39e07b",
    waypoints: [
      [100,400],[100,150],[300,80],[500,200],[500,80],[700,80],
      [900,200],[1100,80],[1100,400],[900,600],[700,720],[500,600],[300,720],[100,600],[100,400]
    ]
  }
];

const TRACK_ROTATE_MS = 10 * 60 * 1000; // 10 minutes
const LOBBY_WAIT_MS   = 2 * 60 * 1000;  // 2 minute max lobby wait
const MIN_PLAYERS     = 2;
const MAX_PLAYERS     = 32;

// ─── ELO ──────────────────────────────────────────────────────────────────────
const K = 32;
function expectedScore(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); }
function newElo(myElo, oppElo, score) {
  return Math.round(myElo + K * (score - expectedScore(myElo, oppElo)));
}
function calcEloGains(results) {
  // results: array of { id, elo } ordered 1st to last
  const updated = results.map(p => ({ id: p.id, elo: p.elo }));
  for (let i = 0; i < results.length; i++) {
    for (let j = 0; j < results.length; j++) {
      if (i === j) continue;
      const score = i < j ? 1 : 0; // lower index = better finish
      updated[i].elo += (K / results.length) * (score - expectedScore(results[i].elo, results[j].elo));
    }
    updated[i].elo = Math.round(updated[i].elo);
  }
  return updated;
}

// ─── STATE ────────────────────────────────────────────────────────────────────
let currentTrackIdx = 0;
let trackStartTime  = Date.now();

// players[socketId] = { id, name, color, elo, rank }
const players = {};

// lobby: waiting room before race starts
let lobby = {
  players: [],         // socket ids
  readySet: new Set(),
  lobbyTimer: null,
  countdownTimer: null,
  phase: "idle"        // idle | waiting | countdown | racing
};

// race state
let race = {
  track: null,
  players: {},         // id -> { laps, checkpoint, finished, dnfTimer, finishTime, dnfed }
  results: [],         // ordered finish list
  raceTimer: null
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function getCurrentTrack() {
  const elapsed = Date.now() - trackStartTime;
  if (elapsed >= TRACK_ROTATE_MS) {
    currentTrackIdx = (currentTrackIdx + 1) % TRACKS.length;
    trackStartTime  = Date.now();
  }
  return TRACKS[currentTrackIdx];
}

function timeUntilRotation() {
  return Math.max(0, TRACK_ROTATE_MS - (Date.now() - trackStartTime));
}

function rankLabel(elo) {
  if (elo >= 2000) return "Diamond";
  if (elo >= 1600) return "Platinum";
  if (elo >= 1300) return "Gold";
  if (elo >= 1000) return "Silver";
  return "Bronze";
}

function broadcastLobby() {
  io.to("lobby").emit("lobbyUpdate", {
    players: lobby.players.map(id => players[id]).filter(Boolean),
    readyIds: [...lobby.readySet],
    phase: lobby.phase,
    track: getCurrentTrack(),
    trackRotateIn: timeUntilRotation()
  });
}

function startCountdown() {
  if (lobby.phase === "countdown") return;
  lobby.phase = "countdown";
  clearTimeout(lobby.lobbyTimer);
  let secs = 5;
  io.to("lobby").emit("countdown", { secs });
  lobby.countdownTimer = setInterval(() => {
    secs--;
    io.to("lobby").emit("countdown", { secs });
    if (secs <= 0) {
      clearInterval(lobby.countdownTimer);
      startRace();
    }
  }, 1000);
}

function startRace() {
  const track = getCurrentTrack();
  race.track   = track;
  race.players = {};
  race.results = [];

  const racers = [...lobby.players];
  racers.forEach(id => {
    const p = players[id];
    if (!p) return;
    race.players[id] = {
      id, laps: 0, checkpoint: 0,
      finished: false, dnfed: false,
      finishTime: null, dnfTimer: null
    };
    // DNF timer per player
    race.players[id].dnfTimer = setTimeout(() => {
      if (!race.players[id]?.finished) dnfPlayer(id);
    }, track.dnfMs);
  });

  lobby.phase   = "racing";
  lobby.players = [];
  lobby.readySet.clear();

  io.to("lobby").emit("raceStart", { track, racers: racers.map(id => players[id]).filter(Boolean) });
  racers.forEach(id => {
    const sock = io.sockets.sockets.get(id);
    if (sock) { sock.leave("lobby"); sock.join("race"); }
  });
}

function dnfPlayer(id) {
  const rp = race.players[id];
  if (!rp || rp.finished || rp.dnfed) return;
  rp.dnfed = true;
  rp.finished = true;
  clearTimeout(rp.dnfTimer);
  race.results.push({ id, dnf: true });
  io.to("race").emit("playerDNF", { id });
  checkRaceOver();
}

function finishPlayer(id) {
  const rp = race.players[id];
  if (!rp || rp.finished) return;
  rp.finished    = true;
  rp.finishTime  = Date.now();
  clearTimeout(rp.dnfTimer);
  race.results.push({ id, dnf: false, finishTime: rp.finishTime });
  const pos = race.results.filter(r => !r.dnf).length;
  io.to("race").emit("playerFinished", { id, pos });
  checkRaceOver();
}

function checkRaceOver() {
  const all = Object.values(race.players);
  if (all.length === 0) return;
  if (all.every(p => p.finished)) endRace();
}

function endRace() {
  // Compute ELO — finishers before DNFs
  const finishers = race.results.filter(r => !r.dnf).map(r => ({
    id: r.id, elo: players[r.id]?.elo ?? 1000
  }));
  const dnfers = race.results.filter(r => r.dnf).map(r => ({
    id: r.id, elo: players[r.id]?.elo ?? 1000
  }));

  const allOrdered = [...finishers, ...dnfers];
  const updated = calcEloGains(allOrdered);

  updated.forEach(u => {
    if (players[u.id]) {
      players[u.id].elo  = u.elo;
      players[u.id].rank = rankLabel(u.elo);
    }
  });

  const summary = allOrdered.map((p, i) => ({
    ...players[p.id],
    position: i + 1,
    dnf: dnfers.some(d => d.id === p.id),
    newElo: updated[i].elo,
    eloDelta: updated[i].elo - (players[p.id]?.elo ?? 1000) + (updated[i].elo - players[p.id]?.elo ?? 0)
  }));

  io.to("race").emit("raceOver", { summary });

  // move everyone back to lobby pool
  const socks = io.sockets.adapter.rooms.get("race") || new Set();
  socks.forEach(id => {
    const sock = io.sockets.sockets.get(id);
    if (sock) { sock.leave("race"); sock.join("lobby"); lobby.players.push(id); }
  });
  lobby.phase = "idle";
  broadcastLobby();
}

// ─── SOCKET EVENTS ────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("connect", socket.id);

  socket.on("join", ({ name, color }) => {
    if (Object.keys(players).length >= MAX_PLAYERS) {
      socket.emit("error", { msg: "Server full (32 players max)" });
      return;
    }
    players[socket.id] = {
      id: socket.id,
      name: name?.slice(0, 16) || "Driver",
      color: color || "#ffffff",
      elo: 1000,
      rank: "Bronze"
    };
    socket.join("lobby");
    lobby.players.push(socket.id);

    socket.emit("joined", { player: players[socket.id], track: getCurrentTrack(), trackRotateIn: timeUntilRotation() });

    if (lobby.players.length >= MIN_PLAYERS && lobby.phase === "idle") {
      lobby.phase = "waiting";
      lobby.lobbyTimer = setTimeout(() => {
        if (lobby.phase === "waiting") startCountdown();
      }, LOBBY_WAIT_MS);
    }
    broadcastLobby();
  });

  socket.on("ready", () => {
    if (!lobby.players.includes(socket.id)) return;
    lobby.readySet.add(socket.id);
    if (lobby.readySet.size === lobby.players.length && lobby.players.length >= MIN_PLAYERS) {
      startCountdown();
    }
    broadcastLobby();
  });

  // Car movement: client sends its own position/angle, server relays to others
  socket.on("carUpdate", (data) => {
    socket.to("race").emit("carUpdate", { id: socket.id, ...data });
  });

  // Client tells server it passed a checkpoint / finished a lap
  socket.on("checkpoint", ({ checkpoint, laps }) => {
    const rp = race.players[socket.id];
    if (!rp || rp.finished) return;
    rp.checkpoint = checkpoint;
    rp.laps = laps;
    io.to("race").emit("progressUpdate", { id: socket.id, laps, checkpoint });
    if (laps >= race.track.laps) finishPlayer(socket.id);
  });

  socket.on("disconnect", () => {
    // Remove from lobby
    lobby.players = lobby.players.filter(id => id !== socket.id);
    lobby.readySet.delete(socket.id);
    // If in race, treat as DNF
    if (race.players[socket.id]) dnfPlayer(socket.id);
    delete players[socket.id];
    broadcastLobby();
  });
});

// ─── TRACK ROTATION BROADCAST ────────────────────────────────────────────────
setInterval(() => {
  const prev = currentTrackIdx;
  const track = getCurrentTrack(); // rotates internally if needed
  if (currentTrackIdx !== prev) {
    io.emit("trackRotated", { track, trackRotateIn: TRACK_ROTATE_MS });
  }
}, 5000);

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🏁 Racer server running on http://localhost:${PORT}`));
