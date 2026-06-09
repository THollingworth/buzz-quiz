/* ============================================================
   BUZZ! — Serveur de jeu (Node + Express + WebSocket)
   - L'animateur joue aussi (pseudo) et controle la partie.
   - Seul l'animateur pilote le player ; sa position video est
     relayee a tous (synchronisation).
   - Anti double-buzz : on ne peut pas rebuzzer tant qu'un autre
     joueur n'a pas buzze.
   - Mode spectateur : ne buzze pas, ne vote pas, hors scores.
   ============================================================ */
"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "buzz2026";
const COUNTDOWN_MS = Number(process.env.COUNTDOWN_MS || 5000);
const RESUME_MS = Number(process.env.RESUME_MS || 4000);
const DEFAULT_ROOM = "PARTY";

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/* ---------- Modele ---------- */
const rooms = new Map();

function getRoom(code) {
  code = (code || DEFAULT_ROOM).toString().toUpperCase().trim().slice(0, 12) || DEFAULT_ROOM;
  if (!rooms.has(code)) {
    rooms.set(code, {
      code,
      phase: "lobby",
      videoId: null,
      round: 0,
      buzz: null,                 // { id, name, at }
      lastBuzzerName: null,       // anti double-buzz
      countdownEnd: null,
      countdownTimer: null,
      resumeTimer: null,
      resumeEnd: null,
      lastResult: null,
      sync: { time: 0, playing: false, at: Date.now() },
      clients: new Map(),         // id -> { ws, name, isAdmin, ready, spectator }
      votes: new Map(),           // id -> 'go' | 'no'
      scores: new Map()           // name -> points
    });
  }
  return rooms.get(code);
}

// participants actifs (non-spectateurs) : peuvent buzzer / voter / scorer
function active(room) {
  return [...room.clients.entries()].filter(([, c]) => !c.spectator);
}
function eligibleVoters(room) {
  const bid = room.buzz && room.buzz.id;
  return active(room).filter(([id]) => id !== bid);
}
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
  return {
    type: "state",
    room: room.code,
    phase: room.phase,
    videoId: room.videoId,
    round: room.round,
    buzz: room.buzz,
    lastBuzzerName: room.lastBuzzerName,
    countdownRemaining: room.countdownEnd ? Math.max(0, room.countdownEnd - Date.now()) : 0,
    resumeRemaining: room.phase === "result" && room.resumeEnd ? Math.max(0, room.resumeEnd - Date.now()) : 0,
    lastResult: room.lastResult || null,
    players: [...room.clients.entries()].map(([id, c]) => ({
      id, name: c.name, ready: c.ready, isAdmin: c.isAdmin, spectator: c.spectator
    })),
    votes: [...room.votes.entries()].map(([id, v]) => ({ id, v })),
    scores: scoreboard(room),
    sync: room.sync
  };
}
function broadcast(room) {
  const msg = JSON.stringify(publicState(room));
  for (const c of room.clients.values()) if (c.ws.readyState === 1) c.ws.send(msg);
}
function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }

// relaie la position video de l'animateur a tous les autres
function relaySync(room) {
  const msg = JSON.stringify({ type: "sync", time: room.sync.time, playing: room.sync.playing, at: Date.now() });
  for (const c of room.clients.values()) if (!c.isAdmin && c.ws.readyState === 1) c.ws.send(msg);
}

/* ---------- Transitions ---------- */
function startCountdown(room) {
  room.phase = "buzzed";
  room.countdownEnd = Date.now() + COUNTDOWN_MS;
  clearTimeout(room.countdownTimer);
  room.countdownTimer = setTimeout(() => {
    if (room.phase === "buzzed") { room.phase = "voting"; broadcast(room); maybeAutoResult(room); }
  }, COUNTDOWN_MS);
}
function maybeAutoResult(room) {
  if (room.phase !== "voting") return;
  const voters = eligibleVoters(room);
  const allVoted = voters.length > 0 && voters.every(([id]) => room.votes.has(id));
  if (allVoted) toResult(room);
}
function toResult(room) {
  if (room.phase === "result") return;
  clearTimeout(room.countdownTimer);
  let go = 0, no = 0;
  for (const v of room.votes.values()) { if (v === "go") go++; else if (v === "no") no++; }
  const correct = go > no;
  room.lastResult = { name: room.buzz ? room.buzz.name : null, go, no, correct };
  if (room.buzz && correct) room.scores.set(room.buzz.name, (room.scores.get(room.buzz.name) || 0) + 1);
  room.phase = "result";
  broadcast(room);
  scheduleResume(room);
}
function scheduleResume(room) {
  clearTimeout(room.resumeTimer);
  room.resumeEnd = Date.now() + RESUME_MS;
  room.resumeTimer = setTimeout(() => resumePlay(room), RESUME_MS);
}
function resumePlay(room) {
  clearTimeout(room.resumeTimer);
  room.resumeTimer = null;
  room.resumeEnd = null;
  room.phase = "playing";
  room.buzz = null;
  room.votes.clear();
  room.countdownEnd = null;
  room.lastResult = null;
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

    if (m.type === "join" || m.type === "admin") {
      const room = getRoom(m.room);
      if (ws.roomCode && ws.roomCode !== room.code) leaveRoom(ws);
      ws.roomCode = room.code;
      const name = (m.name || "Joueur").toString().slice(0, 20) || "Joueur";

      if (m.type === "admin") {
        if (m.password !== ADMIN_PASSWORD) { send(ws, { type: "admin_result", ok: false }); return; }
        room.clients.set(ws.clientId, { ws, name, isAdmin: true, ready: true, spectator: false });
        send(ws, { type: "admin_result", ok: true, id: ws.clientId });
      } else {
        room.clients.set(ws.clientId, { ws, name, isAdmin: false, ready: false, spectator: false });
      }
      broadcast(ws.roomCode && rooms.get(ws.roomCode));
      // donne tout de suite la position video courante au nouvel arrivant
      if (!room.clients.get(ws.clientId).isAdmin) {
        send(ws, { type: "sync", time: room.sync.time, playing: room.sync.playing, at: Date.now() });
      }
      return;
    }

    const room = ws.roomCode && rooms.get(ws.roomCode);
    if (!room) return;
    const me = room.clients.get(ws.clientId);
    if (!me) return;
    const isAdmin = me.isAdmin;

    switch (m.type) {
      case "sync": // position video : seul l'animateur fait autorite
        if (isAdmin) {
          room.sync = { time: Number(m.time) || 0, playing: !!m.playing, at: Date.now() };
          relaySync(room);
        }
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
          room.buzz = null;
          room.lastBuzzerName = null;
          room.votes.clear();
          room.countdownEnd = null;
          room.lastResult = null;
          clearTimeout(room.countdownTimer);
          clearTimeout(room.resumeTimer);
          broadcast(room);
        }
        break;

      case "buzz":
        if (room.phase === "playing" && !room.buzz && !me.spectator) {
          if (me.name === room.lastBuzzerName) { send(ws, { type: "notice", text: "Attends qu'un autre joueur buzze." }); break; }
          room.buzz = { id: ws.clientId, name: me.name, at: Date.now() };
          room.lastBuzzerName = me.name;
          room.votes.clear();
          startCountdown(room);
          broadcast(room);
        }
        break;

      case "vote":
        if (room.phase === "voting" && (m.value === "go" || m.value === "no") && !me.spectator) {
          if (ws.clientId !== (room.buzz && room.buzz.id)) {
            room.votes.set(ws.clientId, m.value);
            broadcast(room);
            maybeAutoResult(room);
          }
        }
        break;

      case "closeVote":
        if (isAdmin && room.phase === "voting") toResult(room);
        break;

      case "continue":
        if (isAdmin) resumePlay(room);
        break;

      case "resetScores":
        if (isAdmin) { room.scores.clear(); broadcast(room); }
        break;

      case "resetLobby":
        if (isAdmin) {
          room.phase = "lobby";
          room.buzz = null;
          room.lastBuzzerName = null;
          room.votes.clear();
          room.countdownEnd = null;
          room.lastResult = null;
          clearTimeout(room.countdownTimer);
          clearTimeout(room.resumeTimer);
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
  const wasBuzzer = room.buzz && room.buzz.id === ws.clientId;
  room.clients.delete(ws.clientId);
  room.votes.delete(ws.clientId);
  ws.roomCode = null;

  if (wasBuzzer && (room.phase === "buzzed" || room.phase === "voting")) {
    clearTimeout(room.countdownTimer);
    room.phase = "playing";
    room.buzz = null;
    room.votes.clear();
    room.countdownEnd = null;
  }

  if (room.clients.size === 0) {
    clearTimeout(room.countdownTimer);
    clearTimeout(room.resumeTimer);
    rooms.delete(room.code);
  } else {
    broadcast(room);
    maybeAutoResult(room);
  }
}

server.listen(PORT, () => {
  console.log(`BUZZ! en ecoute sur le port ${PORT} (mot de passe animateur : ${ADMIN_PASSWORD})`);
});
