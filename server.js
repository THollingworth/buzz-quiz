/* ============================================================
   BUZZ! — Serveur de jeu (Node + Express + WebSocket)
   Mecanique : buzz libre -> fenetre de reponse 5 s -> l'animateur
   declenche la "Revelation" -> vote pour le gagnant.
   ============================================================ */
"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const COLLECT_MS = Number(process.env.COLLECT_MS || process.env.COUNTDOWN_MS || 5000);

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/* ---------- Modele ---------- */
const rooms = new Map();
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function genCode() {
  let c;
  do { c = ""; for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]; }
  while (rooms.has(c));
  return c;
}
function createRoomObj(code) {
  return {
    code,
    phase: "lobby",            // lobby | playing | collecting | reveal
    videoId: null,
    round: 0,
    seq: 0,
    buzzes: [],                // [{ id, name, at, answer }]
    collectTimer: null,
    collectEnd: null,
    revealVotes: new Map(),    // voterId -> candidateId
    revealDecided: false,
    lastWinner: null,          // { id, name, votes }
    sync: { time: 0, playing: false, at: Date.now() },
    clients: new Map(),        // id -> { ws, name, isAdmin, ready, spectator }
    scores: new Map()          // name -> points
  };
}

function active(room) { return [...room.clients.entries()].filter(([, c]) => !c.spectator); }
function scoreboard(room) {
  const seen = new Map();
  for (const [, c] of active(room)) if (!seen.has(c.name)) seen.set(c.name, room.scores.get(c.name) || 0);
  return [...seen.entries()].map(([name, points]) => ({ name, points }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}
function parseYouTubeId(url) {
  if (!url) return null;
  url = String(url).trim();
  if (/^[\w-]{11}$/.test(url)) return url;
  let m;
  if ((m = url.match(/[?&]v=([\w-]{11})/))) return m[1];
  if ((m = url.match(/youtu\.be\/([\w-]{11})/))) return m[1];
  if ((m = url.match(/\/embed\/([\w-]{11})/))) return m[1];
  if ((m = url.match(/\/shorts\/([\w-]{11})/))) return m[1];
  if ((m = url.match(/([\w-]{11})/))) return m[1];
  return null;
}

/* ---------- Diffusion ---------- */
function publicState(room) {
  const reveal = room.phase === "reveal";
  return {
    type: "state",
    room: room.code,
    phase: room.phase,
    videoId: room.videoId,
    round: room.round,
    // les reponses ne sont devoilees qu'au moment de la Revelation
    buzzes: room.buzzes.map((b) => ({ id: b.id, name: b.name, at: b.at, answer: reveal ? b.answer : "" })),
    collectRemaining: room.collectEnd ? Math.max(0, room.collectEnd - Date.now()) : 0,
    revealVotes: [...room.revealVotes.entries()].map(([voter, cand]) => ({ voter, cand })),
    revealDecided: room.revealDecided,
    lastWinner: room.lastWinner,
    players: [...room.clients.entries()].map(([id, c]) => ({ id, name: c.name, ready: c.ready, isAdmin: c.isAdmin, spectator: c.spectator })),
    scores: scoreboard(room),
    sync: room.sync
  };
}
function broadcast(room) {
  const msg = JSON.stringify(publicState(room));
  for (const c of room.clients.values()) if (c.ws.readyState === 1) c.ws.send(msg);
}
function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function relaySync(room) {
  const msg = JSON.stringify({ type: "sync", time: room.sync.time, playing: room.sync.playing, at: Date.now() });
  for (const c of room.clients.values()) if (!c.isAdmin && c.ws.readyState === 1) c.ws.send(msg);
}

/* ---------- Mecanique de manche ---------- */
function startCollect(room) {
  room.phase = "collecting";
  room.collectEnd = Date.now() + COLLECT_MS;
  clearTimeout(room.collectTimer);
  room.collectTimer = setTimeout(() => {
    if (room.phase === "collecting") { room.phase = "playing"; room.collectEnd = null; broadcast(room); }
  }, COLLECT_MS);
}
function addBuzz(room, id, name) {
  if (room.buzzes.some((b) => b.id === id)) return false; // une entree par joueur et par manche
  room.buzzes.push({ id, name, at: Date.now(), answer: "" });
  return true;
}
function doReveal(room) {
  clearTimeout(room.collectTimer);
  room.collectEnd = null;
  room.phase = "reveal";
  room.revealVotes.clear();
  room.revealDecided = false;
  room.lastWinner = null;
  broadcast(room);
}
function closeReveal(room) {
  if (room.phase !== "reveal" || room.revealDecided) return;
  const tally = new Map();
  for (const cand of room.revealVotes.values()) tally.set(cand, (tally.get(cand) || 0) + 1);
  let winner = null, best = -1;
  for (const b of room.buzzes) { // ordre = ordre de buzz : en cas d'egalite, le plus rapide gagne
    const c = tally.get(b.id) || 0;
    if (c > best) { best = c; winner = b; }
  }
  if (winner) {
    room.scores.set(winner.name, (room.scores.get(winner.name) || 0) + 1);
    room.lastWinner = { id: winner.id, name: winner.name, votes: best };
  }
  room.revealDecided = true;
  broadcast(room);
}
function maybeAutoCloseReveal(room) {
  if (room.phase !== "reveal" || room.revealDecided) return;
  const voters = active(room);
  if (voters.length > 0 && voters.every(([id]) => room.revealVotes.has(id))) closeReveal(room);
}
function nextRound(room) {
  clearTimeout(room.collectTimer);
  room.collectEnd = null;
  room.phase = "playing";
  room.buzzes = [];
  room.revealVotes.clear();
  room.revealDecided = false;
  room.lastWinner = null;
  room.round = (room.round || 0) + 1;
  broadcast(room);
}

/* ---------- Connexions ---------- */
let idSeq = 1;

wss.on("connection", (ws) => {
  ws.clientId = "c" + idSeq++ + Math.random().toString(36).slice(2, 6);
  ws.roomCode = null;
  send(ws, { type: "welcome", id: ws.clientId });

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }

    if (m.type === "create") {
      if (ws.roomCode) leaveRoom(ws);
      const code = genCode();
      const room = createRoomObj(code);
      rooms.set(code, room);
      ws.roomCode = code;
      const name = (m.name || "Hôte").toString().slice(0, 20) || "Hôte";
      room.clients.set(ws.clientId, { ws, name, isAdmin: true, ready: true, spectator: false });
      send(ws, { type: "created", room: code, id: ws.clientId });
      broadcast(room);
      return;
    }

    if (m.type === "join") {
      const code = (m.room || "").toString().toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { send(ws, { type: "join_error" }); return; }
      if (ws.roomCode && ws.roomCode !== code) leaveRoom(ws);
      ws.roomCode = code;
      room.seq = (room.seq || 0) + 1;
      const name = (m.name && String(m.name).trim()) ? String(m.name).slice(0, 20) : "Joueur " + room.seq;
      room.clients.set(ws.clientId, { ws, name, isAdmin: false, ready: false, spectator: false });
      send(ws, { type: "joined", room: code, id: ws.clientId });
      broadcast(room);
      send(ws, { type: "sync", time: room.sync.time, playing: room.sync.playing, at: Date.now() });
      return;
    }

    if (m.type === "rejoin") {
      const code = (m.room || "").toString().toUpperCase().trim();
      let room = rooms.get(code);
      if (!room) {
        if (m.wasAdmin) { room = createRoomObj(code); rooms.set(code, room); }
        else { send(ws, { type: "join_error" }); return; }
      }
      if (ws.roomCode && ws.roomCode !== code) leaveRoom(ws);
      ws.roomCode = code;
      const noAdmin = ![...room.clients.values()].some((c) => c.isAdmin);
      const asAdmin = !!m.wasAdmin && noAdmin;
      const name = (m.name || "Joueur").toString().slice(0, 20) || "Joueur";
      room.clients.set(ws.clientId, { ws, name, isAdmin: asAdmin, ready: asAdmin, spectator: false });
      send(ws, { type: asAdmin ? "created" : "joined", room: code, id: ws.clientId });
      broadcast(room);
      if (!asAdmin) send(ws, { type: "sync", time: room.sync.time, playing: room.sync.playing, at: Date.now() });
      return;
    }

    const room = ws.roomCode && rooms.get(ws.roomCode);
    if (!room) return;
    const me = room.clients.get(ws.clientId);
    if (!me) return;
    const isAdmin = me.isAdmin;

    switch (m.type) {
      case "rename": {
        const newName = (m.name || "").toString().slice(0, 20).trim();
        if (!newName || newName === me.name) break;
        const old = me.name;
        me.name = newName;
        if (room.scores.has(old)) { room.scores.set(newName, room.scores.get(old)); room.scores.delete(old); }
        for (const b of room.buzzes) if (b.id === ws.clientId) b.name = newName;
        if (room.lastWinner && room.lastWinner.id === ws.clientId) room.lastWinner.name = newName;
        broadcast(room);
        break;
      }

      case "sync":
        if (isAdmin) { room.sync = { time: Number(m.time) || 0, playing: !!m.playing, at: Date.now() }; relaySync(room); }
        break;

      case "ready":
        if (!me.spectator) { me.ready = !me.ready; broadcast(room); }
        break;

      case "spectator":
        me.spectator = !!m.value;
        if (me.spectator) me.ready = false;
        broadcast(room);
        break;

      case "setVideo":
        if (isAdmin) {
          const id = parseYouTubeId(m.url);
          if (id) { room.videoId = id; room.sync = { time: 0, playing: false, at: Date.now() }; broadcast(room); relaySync(room); }
          else send(ws, { type: "notice", text: "Lien YouTube non reconnu." });
        }
        break;

      case "start":
        if (isAdmin && room.videoId) {
          room.phase = "playing";
          room.round = (room.round || 0) + 1;
          room.buzzes = [];
          room.revealVotes.clear();
          room.revealDecided = false;
          room.lastWinner = null;
          room.collectEnd = null;
          clearTimeout(room.collectTimer);
          broadcast(room);
        }
        break;

      case "buzz": // buzz libre : ouvre / rejoint la fenetre de reponse
        if (!me.spectator && (room.phase === "playing" || room.phase === "collecting")) {
          if (room.phase === "playing") startCollect(room);
          addBuzz(room, ws.clientId, me.name);
          broadcast(room);
        }
        break;

      case "answer": // reponse ecrite pendant la fenetre
        if (room.phase === "collecting") {
          const b = room.buzzes.find((x) => x.id === ws.clientId);
          if (b) { b.answer = (m.text || "").toString().slice(0, 120); }
          // pas de broadcast : les reponses restent secretes jusqu'a la Revelation
        }
        break;

      case "reveal":
        if (isAdmin && (room.phase === "playing" || room.phase === "collecting") && room.buzzes.length) doReveal(room);
        break;

      case "voteWinner":
        if (room.phase === "reveal" && !room.revealDecided && !me.spectator) {
          if (room.buzzes.some((b) => b.id === m.candidateId)) {
            room.revealVotes.set(ws.clientId, m.candidateId);
            broadcast(room);
            maybeAutoCloseReveal(room);
          }
        }
        break;

      case "closeReveal":
        if (isAdmin) closeReveal(room);
        break;

      case "continue":
        if (isAdmin) nextRound(room);
        break;

      case "resetScores":
        if (isAdmin) { room.scores.clear(); broadcast(room); }
        break;

      case "resetLobby":
        if (isAdmin) {
          room.phase = "lobby";
          room.buzzes = [];
          room.revealVotes.clear();
          room.revealDecided = false;
          room.lastWinner = null;
          room.collectEnd = null;
          clearTimeout(room.collectTimer);
          broadcast(room);
        }
        break;
    }
  });

  ws.on("close", () => leaveRoom(ws));
});

function leaveRoom(ws) {
  const room = ws.roomCode && rooms.get(ws.roomCode);
  if (!room) return;
  const leaving = room.clients.get(ws.clientId);
  const wasAdmin = leaving && leaving.isAdmin;
  room.clients.delete(ws.clientId);
  room.revealVotes.delete(ws.clientId);
  ws.roomCode = null;

  if (room.clients.size === 0) {
    clearTimeout(room.collectTimer);
    rooms.delete(room.code);
  } else {
    if (wasAdmin && ![...room.clients.values()].some((c) => c.isAdmin)) {
      const next = room.clients.values().next().value;
      if (next) { next.isAdmin = true; next.spectator = false; next.ready = true; send(next.ws, { type: "promoted" }); }
    }
    broadcast(room);
    maybeAutoCloseReveal(room);
  }
}

server.listen(PORT, () => console.log(`BUZZ! en ecoute sur le port ${PORT}`));
