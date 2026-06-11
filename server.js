/* ============================================================
   BlindZik — Serveur de jeu (Node + Express + WebSocket)
   La video est un fichier local cote client (pas de synchro reseau).
   ============================================================ */
"use strict";

const path = require("path");
const http = require("http");
const fs = require("fs");
const express = require("express");
const { WebSocketServer } = require("ws");
const db = require("./db");
db.load();

const PORT = process.env.PORT || 3000;
const COLLECT_MS = Number(process.env.COLLECT_MS || 5000);
const VIDEO_DIR = path.join(__dirname, "public", "videos");
const VIDEO_RE = /\.(mp4|webm|ogg|ogv|m4v|mov)$/i;

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (_req, res) => res.json({ ok: true }));
// liste des videos disponibles dans public/videos/
app.get("/api/videos", (_req, res) => {
  fs.readdir(VIDEO_DIR, (err, files) => {
    if (err) return res.json({ videos: [] });
    res.json({ videos: files.filter((f) => VIDEO_RE.test(f)).sort() });
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

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
    code, phase: "lobby", round: 0, seq: 0, video: null,
    vsync: { time: 0, playing: false, at: Date.now() },
    lobbyTimer: null, lobbyCountdownEnd: null,
    buzzes: [], collectTimer: null, collectEnd: null,
    revealVotes: new Map(), revealDecided: false, lastWinner: null, revealOutcome: null,
    clients: new Map(), scores: new Map()
  };
}
function active(room) { return [...room.clients.entries()].filter(([, c]) => !c.spectator); }
function scoreboard(room) {
  const seen = new Map();
  for (const [, c] of active(room)) if (!seen.has(c.name)) seen.set(c.name, room.scores.get(c.name) || 0);
  return [...seen.entries()].map(([name, points]) => ({ name, points }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

function publicState(room) {
  const reveal = room.phase === "reveal";
  return {
    type: "state", room: room.code, phase: room.phase, round: room.round, video: room.video,
    buzzes: room.buzzes.map((b) => ({ id: b.id, name: b.name, at: b.at, answer: reveal ? b.answer : "" })),
    collectRemaining: room.collectEnd ? Math.max(0, room.collectEnd - Date.now()) : 0,
    lobbyCountdownRemaining: room.lobbyCountdownEnd ? Math.max(0, room.lobbyCountdownEnd - Date.now()) : 0,
    revealVotes: [...room.revealVotes.entries()].map(([voter, cand]) => ({ voter, cand })),
    revealDecided: room.revealDecided, lastWinner: room.lastWinner, revealOutcome: room.revealOutcome,
    players: [...room.clients.entries()].map(([id, c]) => ({ id, name: c.name, ready: c.ready, isAdmin: c.isAdmin, spectator: c.spectator })),
    scores: scoreboard(room)
  };
}
function broadcast(room) {
  const msg = JSON.stringify(publicState(room));
  for (const c of room.clients.values()) if (c.ws.readyState === 1) c.ws.send(msg);
}
function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function roomSummary() {
  const out = []; let i = 0;
  for (const room of rooms.values()) { i++; out.push({ code: room.code, label: "Lobby " + i, count: room.clients.size, phase: room.phase }); }
  return out;
}
function broadcastRoomList() {
  const msg = JSON.stringify({ type: "rooms", rooms: roomSummary() });
  for (const client of wss.clients) if (client.readyState === 1 && !client.roomCode) client.send(msg);
}
function relayVsync(room) {
  const msg = JSON.stringify({ type: "vsync", time: room.vsync.time, playing: room.vsync.playing });
  for (const c of room.clients.values()) if (!c.isAdmin && c.ws.readyState === 1) c.ws.send(msg);
}

function startCollect(room) {
  room.phase = "collecting";
  room.collectEnd = Date.now() + COLLECT_MS;
  clearTimeout(room.collectTimer);
  room.collectTimer = setTimeout(() => {
    if (room.phase === "collecting") { room.phase = "playing"; room.collectEnd = null; broadcast(room); }
  }, COLLECT_MS);
}
function addBuzz(room, id, name) {
  if (room.buzzes.some((b) => b.id === id)) return false;
  room.buzzes.push({ id, name, at: Date.now(), answer: "" });
  return true;
}
function doReveal(room) {
  clearTimeout(room.collectTimer); room.collectEnd = null;
  room.phase = "reveal"; room.revealVotes.clear(); room.revealDecided = false; room.lastWinner = null; room.revealOutcome = null;
  broadcast(room);
}
function closeReveal(room) {
  if (room.phase !== "reveal" || room.revealDecided) return;
  const tally = new Map();
  for (const cand of room.revealVotes.values()) tally.set(cand, (tally.get(cand) || 0) + 1);
  let best = -1, winners = [];
  for (const b of room.buzzes) {
    const c = tally.get(b.id) || 0;
    if (c > best) { best = c; winners = [b]; }
    else if (c === best) winners.push(b);
  }
  // point uniquement si UN seul gagnant avec au moins 1 vote ; egalite -> annule
  if (winners.length === 1 && best > 0) {
    const winner = winners[0];
    room.scores.set(winner.name, (room.scores.get(winner.name) || 0) + 1);
    room.lastWinner = { id: winner.id, name: winner.name, votes: best };
    room.revealOutcome = "win";
  } else {
    room.lastWinner = null;
    room.revealOutcome = best > 0 ? "tie" : "none";
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
  clearTimeout(room.collectTimer); room.collectEnd = null;
  room.phase = "playing"; room.buzzes = []; room.revealVotes.clear();
  room.revealDecided = false; room.lastWinner = null; room.revealOutcome = null; room.round = (room.round || 0) + 1;
  broadcast(room);
}
// enregistre la partie terminee dans l'historique global et credite les victoires
function recordEndedGame(room) {
  const board = scoreboard(room); // [{ name, points }] tries
  if (!board.length) return;
  const max = board[0].points;
  const winners = board.filter((b) => b.points === max && max > 0).map((b) => b.name);
  db.recordGame({
    id: "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    mode: "BlindZik",
    endedAt: Date.now(),
    players: board.map((b) => ({ pseudo: b.name, points: b.points })),
    winners
  });
  if (max > 0) {
    const credited = new Set();
    for (const [, c] of active(room)) {
      if (c.userId && !credited.has(c.userId) && (room.scores.get(c.name) || 0) === max) {
        db.addWin(c.userId); credited.add(c.userId);
      }
    }
  }
}

function cancelLobbyCountdown(room) {
  if (room.lobbyTimer) { clearTimeout(room.lobbyTimer); room.lobbyTimer = null; room.lobbyCountdownEnd = null; return true; }
  return false;
}
function startGame(room) {
  cancelLobbyCountdown(room);
  room.phase = "playing"; room.round = (room.round || 0) + 1;
  room.buzzes = []; room.revealVotes.clear(); room.revealDecided = false; room.lastWinner = null; room.revealOutcome = null;
  room.collectEnd = null; clearTimeout(room.collectTimer);
  broadcast(room); broadcastRoomList();
}
// lance un compte a rebours de 5 s quand tous les joueurs actifs (>=2) sont prets
function checkAutoStart(room) {
  if (room.phase !== "lobby") return;
  const act = active(room);
  const allReady = act.length >= 2 && act.every(([, c]) => c.ready);
  if (allReady) {
    if (!room.lobbyTimer) {
      room.lobbyCountdownEnd = Date.now() + 5000;
      room.lobbyTimer = setTimeout(() => { if (room.phase === "lobby") startGame(room); }, 5000);
      broadcast(room);
    }
  } else if (cancelLobbyCountdown(room)) {
    broadcast(room);
  }
}

let idSeq = 1;
wss.on("connection", (ws) => {
  ws.clientId = "c" + idSeq++ + Math.random().toString(36).slice(2, 6);
  ws.roomCode = null;
  ws.userId = null;
  ws.pseudo = null;
  ws.token = null;
  send(ws, { type: "welcome", id: ws.clientId });

  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }

    /* ---------- Authentification ---------- */
    if (m.type === "resume") {
      const u = db.userByToken(m.token);
      if (!u) { send(ws, { type: "auth_error" }); return; }
      ws.userId = u.id; ws.pseudo = u.pseudo; ws.token = m.token;
      send(ws, { type: "authed", token: m.token, pseudo: u.pseudo, userId: u.id });
      send(ws, { type: "rooms", rooms: roomSummary() });
      return;
    }
    if (m.type === "auth") {
      const pseudo = String(m.pseudo || "").trim();
      const pin = String(m.pin || "");
      if (!db.validPseudo(pseudo)) { send(ws, { type: "auth_fail", reason: "Pseudo : entre 2 et 20 caractères." }); return; }
      if (!db.validPin(pin)) { send(ws, { type: "auth_fail", reason: "Le code PIN doit faire 4 chiffres." }); return; }
      let u = db.findByPseudo(pseudo);
      const isNew = !u;
      if (u) { if (!db.verifyPin(pin, u.pin)) { send(ws, { type: "auth_fail", reason: "Code PIN incorrect pour ce pseudo." }); return; } }
      else { u = db.createUser(pseudo, pin); }
      const token = db.newSession(u.id);
      ws.userId = u.id; ws.pseudo = u.pseudo; ws.token = token;
      send(ws, { type: "authed", token, pseudo: u.pseudo, userId: u.id, created: isNew });
      send(ws, { type: "rooms", rooms: roomSummary() });
      return;
    }
    if (m.type === "logout") {
      if (ws.roomCode) leaveRoom(ws);
      db.dropSession(ws.token);
      ws.userId = null; ws.pseudo = null; ws.token = null;
      send(ws, { type: "loggedout" });
      return;
    }

    /* ---------- A partir d'ici : connexion requise ---------- */
    if (!ws.userId) { send(ws, { type: "auth_required" }); return; }

    if (m.type === "setPseudo") {
      const pseudo = String(m.pseudo || "").trim();
      if (!db.validPseudo(pseudo)) { send(ws, { type: "pseudo_error", reason: "Pseudo : entre 2 et 20 caractères." }); return; }
      if (db.pseudoTaken(pseudo, ws.userId)) { send(ws, { type: "pseudo_error", reason: "Ce pseudo est déjà pris." }); return; }
      const old = ws.pseudo;
      db.setPseudo(ws.userId, pseudo);
      ws.pseudo = pseudo;
      send(ws, { type: "pseudo_ok", pseudo });
      const r = ws.roomCode && rooms.get(ws.roomCode);
      if (r) {
        const c = r.clients.get(ws.clientId);
        if (c) {
          c.name = pseudo;
          if (r.scores.has(old)) { r.scores.set(pseudo, r.scores.get(old)); r.scores.delete(old); }
          for (const b of r.buzzes) if (b.id === ws.clientId) b.name = pseudo;
          if (r.lastWinner && r.lastWinner.id === ws.clientId) r.lastWinner.name = pseudo;
          broadcast(r);
        }
      }
      return;
    }
    if (m.type === "history") {
      send(ws, { type: "history", wins: db.winsBoard(), games: db.recentGames(50) });
      return;
    }
    if (m.type === "listRooms") { send(ws, { type: "rooms", rooms: roomSummary() }); return; }

    if (m.type === "create") {
      if (ws.roomCode) leaveRoom(ws);
      const code = genCode(); const room = createRoomObj(code); rooms.set(code, room);
      ws.roomCode = code;
      room.clients.set(ws.clientId, { ws, userId: ws.userId, name: ws.pseudo, isAdmin: true, ready: true, spectator: false });
      send(ws, { type: "created", room: code, id: ws.clientId });
      broadcast(room); broadcastRoomList(); return;
    }
    if (m.type === "join") {
      const code = (m.room || "").toString().toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { send(ws, { type: "join_error" }); return; }
      if (ws.roomCode && ws.roomCode !== code) leaveRoom(ws);
      ws.roomCode = code;
      room.clients.set(ws.clientId, { ws, userId: ws.userId, name: ws.pseudo, isAdmin: false, ready: false, spectator: false });
      send(ws, { type: "joined", room: code, id: ws.clientId });
      broadcast(room);
      send(ws, { type: "vsync", time: room.vsync.time, playing: room.vsync.playing });
      checkAutoStart(room);
      broadcastRoomList();
      return;
    }
    if (m.type === "rejoin") {
      const code = (m.room || "").toString().toUpperCase().trim();
      let room = rooms.get(code);
      if (!room) { if (m.wasAdmin) { room = createRoomObj(code); rooms.set(code, room); } else { send(ws, { type: "join_error" }); return; } }
      if (ws.roomCode && ws.roomCode !== code) leaveRoom(ws);
      ws.roomCode = code;
      const noAdmin = ![...room.clients.values()].some((c) => c.isAdmin);
      const asAdmin = !!m.wasAdmin && noAdmin;
      room.clients.set(ws.clientId, { ws, userId: ws.userId, name: ws.pseudo, isAdmin: asAdmin, ready: asAdmin, spectator: false });
      send(ws, { type: asAdmin ? "created" : "joined", room: code, id: ws.clientId });
      broadcast(room);
      if (!asAdmin) send(ws, { type: "vsync", time: room.vsync.time, playing: room.vsync.playing });
      broadcastRoomList();
      return;
    }
    if (m.type === "leave") { leaveRoom(ws); send(ws, { type: "left" }); return; }

    const room = ws.roomCode && rooms.get(ws.roomCode);
    if (!room) return;
    const me = room.clients.get(ws.clientId);
    if (!me) return;
    const isAdmin = me.isAdmin;

    switch (m.type) {
      case "ready": if (!me.spectator) { me.ready = !me.ready; broadcast(room); checkAutoStart(room); } break;
      case "spectator": me.spectator = !!m.value; if (me.spectator) me.ready = false; broadcast(room); checkAutoStart(room); break;
      case "setVideoFile":
        if (isAdmin) {
          const name = (m.name || "").toString();
          if (/^[^\/\\]+$/.test(name) && VIDEO_RE.test(name)) {
            room.video = name;
            room.vsync = { time: 0, playing: false, at: Date.now() };
            broadcast(room); relayVsync(room);
          }
        } break;
      case "vsync":
        if (isAdmin) { room.vsync = { time: Number(m.time) || 0, playing: !!m.playing, at: Date.now() }; relayVsync(room); }
        break;
      case "start":
        if (isAdmin) startGame(room);
        break;
      case "clearVideo":
        if (isAdmin) { room.video = null; room.vsync = { time: 0, playing: false, at: Date.now() }; broadcast(room); relayVsync(room); }
        break;
      case "buzz":
        if (!me.spectator && (room.phase === "playing" || room.phase === "collecting")) {
          if (room.phase === "playing") startCollect(room);
          addBuzz(room, ws.clientId, me.name); broadcast(room);
        } break;
      case "answer":
        if (room.phase === "collecting") {
          const b = room.buzzes.find((x) => x.id === ws.clientId);
          if (b) b.answer = (m.text || "").toString().slice(0, 120);
        } break;
      case "reveal":
        if (isAdmin && (room.phase === "playing" || room.phase === "collecting") && room.buzzes.length) doReveal(room);
        break;
      case "voteWinner":
        if (room.phase === "reveal" && !room.revealDecided && !me.spectator) {
          if (room.buzzes.some((b) => b.id === m.candidateId)) {
            room.revealVotes.set(ws.clientId, m.candidateId); broadcast(room); maybeAutoCloseReveal(room);
          }
        } break;
      case "closeReveal": if (isAdmin) closeReveal(room); break;
      case "noWinner":
        if (isAdmin && room.phase === "reveal" && !room.revealDecided) {
          room.lastWinner = null; room.revealOutcome = "nogood"; room.revealDecided = true; broadcast(room);
        } break;
      case "continue": if (isAdmin) nextRound(room); break;
      case "endGame": if (isAdmin) { clearTimeout(room.collectTimer); recordEndedGame(room); room.phase = "ended"; room.collectEnd = null; broadcast(room); broadcastRoomList(); } break;
      case "resetScores": if (isAdmin) { room.scores.clear(); broadcast(room); } break;
      case "resetLobby":
        if (isAdmin) {
          cancelLobbyCountdown(room);
          room.phase = "lobby"; room.buzzes = []; room.revealVotes.clear();
          room.revealDecided = false; room.lastWinner = null; room.collectEnd = null;
          room.video = null; room.vsync = { time: 0, playing: false, at: Date.now() };
          clearTimeout(room.collectTimer); broadcast(room); relayVsync(room); broadcastRoomList();
        } break;
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
  if (room.clients.size === 0) { clearTimeout(room.collectTimer); clearTimeout(room.lobbyTimer); rooms.delete(room.code); }
  else {
    if (wasAdmin && ![...room.clients.values()].some((c) => c.isAdmin)) {
      const next = room.clients.values().next().value;
      if (next) { next.isAdmin = true; next.spectator = false; next.ready = true; send(next.ws, { type: "promoted" }); }
    }
    broadcast(room); maybeAutoCloseReveal(room); checkAutoStart(room);
  }
  broadcastRoomList();
}

server.listen(PORT, () => console.log(`BlindZik en ecoute sur le port ${PORT}`));
