/* ============================================================
   BUZZ! — Serveur de jeu (Node + Express + WebSocket)
   Le serveur fait autorite : il decide du premier buzz,
   gere le compte a rebours et diffuse l'etat a tout le monde.
   ============================================================ */
"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "buzz2026";
const COUNTDOWN_MS = Number(process.env.COUNTDOWN_MS || 5000);
const RESUME_MS = Number(process.env.RESUME_MS || 4000); // delai avant reprise auto de la video
const DEFAULT_ROOM = "PARTY";

const app = express();
app.use(express.static(path.join(__dirname, "public")));
// petite route de sante utile pour les hebergeurs
app.get("/healthz", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/* ---------- Modele ---------- */
const rooms = new Map(); // code -> room

function getRoom(code) {
  code = (code || DEFAULT_ROOM).toString().toUpperCase().trim().slice(0, 12) || DEFAULT_ROOM;
  if (!rooms.has(code)) {
    rooms.set(code, {
      code,
      phase: "lobby", // lobby | playing | buzzed | voting | result
      videoId: null,
      round: 0,
      buzz: null, // { id, name, at }
      countdownEnd: null, // timestamp serveur
      countdownTimer: null,
      resumeTimer: null,
      resumeEnd: null,
      lastResult: null, // { name, go, no, correct }
      clients: new Map(), // clientId -> { ws, name, role:'player'|'admin', ready }
      votes: new Map(), // clientId -> 'go' | 'no'
      scores: new Map() // name -> points
    });
  }
  return rooms.get(code);
}

function players(room) {
  return [...room.clients.entries()].filter(([, c]) => c.role === "player");
}
function eligibleVoters(room) {
  const bid = room.buzz && room.buzz.id;
  return players(room).filter(([id]) => id !== bid);
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
    countdownRemaining: room.countdownEnd ? Math.max(0, room.countdownEnd - Date.now()) : 0,
    resumeRemaining: room.phase === "result" && room.resumeEnd ? Math.max(0, room.resumeEnd - Date.now()) : 0,
    lastResult: room.lastResult || null,
    players: players(room).map(([id, c]) => ({ id, name: c.name, ready: c.ready })),
    votes: [...room.votes.entries()].map(([id, v]) => ({ id, v })),
    scores: [...room.scores.entries()]
      .map(([name, points]) => ({ name, points }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
  };
}
function broadcast(room) {
  const msg = JSON.stringify(publicState(room));
  for (const c of room.clients.values()) {
    if (c.ws.readyState === 1) c.ws.send(msg);
  }
}
function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

/* ---------- Transitions ---------- */
function startCountdown(room) {
  room.phase = "buzzed";
  room.countdownEnd = Date.now() + COUNTDOWN_MS;
  clearTimeout(room.countdownTimer);
  room.countdownTimer = setTimeout(() => {
    if (room.phase === "buzzed") {
      room.phase = "voting";
      broadcast(room);
      maybeAutoResult(room);
    }
  }, COUNTDOWN_MS);
}
function maybeAutoResult(room) {
  if (room.phase !== "voting") return;
  const voters = eligibleVoters(room);
  const allVoted = voters.length > 0 && voters.every(([id]) => room.votes.has(id));
  if (allVoted) toResult(room);
}

// Calcule le verdict, attribue les points, puis programme la reprise auto de la video
function toResult(room) {
  if (room.phase === "result") return;
  clearTimeout(room.countdownTimer);
  let go = 0, no = 0;
  for (const v of room.votes.values()) { if (v === "go") go++; else if (v === "no") no++; }
  const correct = go > no;
  room.lastResult = { name: room.buzz ? room.buzz.name : null, go, no, correct };
  if (room.buzz && correct) {
    const cur = room.scores.get(room.buzz.name) || 0;
    room.scores.set(room.buzz.name, cur + 1);
  }
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

    // --- entree dans une salle ---
    if (m.type === "join" || m.type === "admin") {
      const room = getRoom(m.room);
      // si deja dans une autre salle, on nettoie
      if (ws.roomCode && ws.roomCode !== room.code) leaveRoom(ws);
      ws.roomCode = room.code;

      if (m.type === "admin") {
        if (m.password !== ADMIN_PASSWORD) {
          send(ws, { type: "admin_result", ok: false });
          return;
        }
        room.clients.set(ws.clientId, { ws, name: "Animateur", role: "admin", ready: true });
        send(ws, { type: "admin_result", ok: true, id: ws.clientId });
      } else {
        const name = (m.name || "Joueur").toString().slice(0, 20);
        room.clients.set(ws.clientId, { ws, name, role: "player", ready: false });
        if (!room.scores.has(name)) room.scores.set(name, 0);
      }
      broadcast(room);
      return;
    }

    // toutes les autres actions exigent d'etre dans une salle
    const room = ws.roomCode && rooms.get(ws.roomCode);
    if (!room) return;
    const me = room.clients.get(ws.clientId);
    if (!me) return;
    const isAdmin = me.role === "admin";

    switch (m.type) {
      case "ready":
        if (me.role === "player") { me.ready = !me.ready; broadcast(room); }
        break;

      case "setVideo":
        if (isAdmin) {
          const id = parseYouTubeId(m.url);
          if (id) { room.videoId = id; broadcast(room); }
          else send(ws, { type: "notice", text: "Lien YouTube non reconnu." });
        }
        break;

      case "start":
        if (isAdmin && room.videoId) {
          room.phase = "playing";
          room.round = (room.round || 0) + 1;
          room.buzz = null;
          room.votes.clear();
          room.countdownEnd = null;
          room.lastResult = null;
          clearTimeout(room.countdownTimer);
          clearTimeout(room.resumeTimer);
          broadcast(room);
        }
        break;

      case "buzz":
        if (room.phase === "playing" && !room.buzz) {
          room.buzz = { id: ws.clientId, name: me.name, at: Date.now() };
          room.votes.clear();
          startCountdown(room);
          broadcast(room);
        }
        break;

      case "vote":
        if (room.phase === "voting" && (m.value === "go" || m.value === "no")) {
          const bid = room.buzz && room.buzz.id;
          if (ws.clientId !== bid) {
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
        if (isAdmin) {
          room.scores.clear();
          for (const [, c] of players(room)) room.scores.set(c.name, 0);
          broadcast(room);
        }
        break;

      case "resetLobby":
        if (isAdmin) {
          room.phase = "lobby";
          room.buzz = null;
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

  // si l'auteur du buzz part pendant sa manche, on libere le buzzer
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
