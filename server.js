/* ============================================================
   Suce Pute MiniGames — Serveur principal
   Hub + Auth (mail/mdp/cookie) + BlindZik WebSocket
   ============================================================ */
"use strict";

const path = require("path");
const http = require("http");
const fs = require("fs");
const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const { WebSocketServer } = require("ws");
const db = require("./db");

const PORT = process.env.PORT || 3000;
const COLLECT_MS = Number(process.env.COLLECT_MS || 5000);
const COOKIE_SECRET = process.env.COOKIE_SECRET || "spmg-secret-change-in-prod";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const AVATAR_DIR = path.join(DATA_DIR, "avatars");
const VIDEO_DIR = path.join(__dirname, "public", "videos");
const VIDEO_RE = /\.(mp4|webm|ogg|ogv|m4v|mov)$/i;

fs.mkdirSync(AVATAR_DIR, { recursive: true });
fs.mkdirSync(VIDEO_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(cookieParser(COOKIE_SECRET));
app.use(express.static(path.join(__dirname, "public")));
app.use("/avatars", express.static(AVATAR_DIR));

/* ---------- Auth middleware ---------- */
function requireAuth(req, res, next) {
  const token = req.signedCookies && req.signedCookies.session;
  const user = db.userByToken(token);
  if (!user) return res.status(401).json({ error: "auth_required" });
  req.user = user;
  next();
}
function setSession(res, token) {
  res.cookie("session", token, {
    signed: true, httpOnly: true, sameSite: "lax",
    maxAge: 30 * 24 * 3600 * 1000 // 30 jours
  });
}

/* ---------- Avatar upload ---------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, req.user.id + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Image only"));
  }
});

/* ============================================================
   Routes Auth
   ============================================================ */
app.post("/api/auth/register", async (req, res) => {
  const { mail, password, pseudo } = req.body || {};
  if (!db.validMail(mail)) return res.status(400).json({ error: "Mail invalide" });
  if (!db.validPassword(password)) return res.status(400).json({ error: "Mot de passe trop court (6 min)" });
  if (!db.validPseudo(pseudo)) return res.status(400).json({ error: "Pseudo invalide (2-20 caractères)" });
  if (db.findByMail(mail)) return res.status(409).json({ error: "Mail déjà utilisé" });
  if (db.pseudoTaken(pseudo, null)) return res.status(409).json({ error: "Pseudo déjà pris" });
  const user = await db.createUser(mail, password, pseudo);
  const token = db.newSession(user.id);
  setSession(res, token);
  res.json({ ok: true, user: safeUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { mail, password } = req.body || {};
  const user = await db.checkPassword(mail, password);
  if (!user) return res.status(401).json({ error: "Mail ou mot de passe incorrect" });
  const token = db.newSession(user.id);
  setSession(res, token);
  res.json({ ok: true, user: safeUser(user) });
});

app.post("/api/auth/logout", (req, res) => {
  const token = req.signedCookies && req.signedCookies.session;
  db.dropSession(token);
  res.clearCookie("session");
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const token = req.signedCookies && req.signedCookies.session;
  const user = db.userByToken(token);
  if (!user) return res.json({ user: null });
  res.json({ user: safeUser(user) });
});

function safeUser(u) {
  return { id: u.id, mail: u.mail, pseudo: u.pseudo, avatar: u.avatar || null, wins: u.wins || 0 };
}

/* ============================================================
   Routes Profil
   ============================================================ */
app.post("/api/profile/pseudo", requireAuth, (req, res) => {
  const { pseudo } = req.body || {};
  if (!db.validPseudo(pseudo)) return res.status(400).json({ error: "Pseudo invalide" });
  if (db.pseudoTaken(pseudo, req.user.id)) return res.status(409).json({ error: "Pseudo déjà pris" });
  db.setPseudo(req.user.id, pseudo);
  res.json({ ok: true, pseudo: pseudo.trim() });
});

app.post("/api/profile/avatar", requireAuth, (req, res, next) => {
  upload.single("avatar")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "Pas de fichier" });
    const filename = req.file.filename;
    db.setAvatar(req.user.id, filename);
    res.json({ ok: true, avatar: filename });
  });
});

app.get("/api/profile/history", requireAuth, (req, res) => {
  const games = db.userGames(req.user.id, 10);
  res.json({ games });
});

/* ============================================================
   Routes BlindZik
   ============================================================ */
app.get("/api/videos", requireAuth, (_req, res) => {
  fs.readdir(VIDEO_DIR, (err, files) => {
    if (err) return res.json({ videos: [] });
    res.json({ videos: files.filter(f => VIDEO_RE.test(f)).sort() });
  });
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Root + index redirect → hub or auth
function authRedirect(req, res) {
  const token = req.signedCookies && req.signedCookies.session;
  const user = db.userByToken(token);
  if (user) res.redirect("/hub.html");
  else res.redirect("/auth.html");
}
app.get("/", authRedirect);
app.get("/index.html", authRedirect);

/* ============================================================
   BlindZik — Logique jeu WebSocket
   ============================================================ */
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
  // build players list with avatar info
  const players = [...room.clients.entries()].map(([id, c]) => ({
    id, name: c.name, ready: c.ready, isAdmin: c.isAdmin, spectator: c.spectator,
    avatar: c.avatar || null
  }));
  return {
    type: "state", room: room.code, phase: room.phase, round: room.round, video: room.video,
    buzzes: room.buzzes.map(b => ({ id: b.id, name: b.name, at: b.at, answer: reveal ? b.answer : "", avatar: b.avatar || null })),
    collectRemaining: room.collectEnd ? Math.max(0, room.collectEnd - Date.now()) : 0,
    lobbyCountdownRemaining: room.lobbyCountdownEnd ? Math.max(0, room.lobbyCountdownEnd - Date.now()) : 0,
    revealVotes: [...room.revealVotes.entries()].map(([voter, cand]) => ({ voter, cand })),
    revealDecided: room.revealDecided, lastWinner: room.lastWinner, revealOutcome: room.revealOutcome,
    players, scores: scoreboard(room)
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
  room.phase = "collecting"; room.collectEnd = Date.now() + COLLECT_MS;
  clearTimeout(room.collectTimer);
  room.collectTimer = setTimeout(() => {
    if (room.phase === "collecting") { room.phase = "playing"; room.collectEnd = null; broadcast(room); }
  }, COLLECT_MS);
}
function addBuzz(room, id, name, avatar) {
  if (room.buzzes.some(b => b.id === id)) return false;
  room.buzzes.push({ id, name, at: Date.now(), answer: "", avatar: avatar || null });
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

/* ---------- Record game to DB on endGame ---------- */
function recordEndGame(room) {
  const sc = scoreboard(room);
  if (sc.length === 0) return;
  // find winner (top score)
  const winner = sc[0].points > 0 ? sc[0].name : null;
  // add win to DB user
  if (winner) {
    // find user by pseudo in clients
    for (const [, c] of room.clients) {
      if (c.name === winner && c.userId) { db.addWin(c.userId); break; }
    }
  }
  // build scores with userId for history lookup
  const scores = sc.map(s => {
    let userId = null;
    for (const [, c] of room.clients) { if (c.name === s.name) { userId = c.userId; break; } }
    return { name: s.name, points: s.points, userId };
  });
  db.recordGame({
    game_type: "blindzik",
    played_at: Date.now(),
    players: [...room.clients.values()].map(c => c.name),
    winner: winner || "",
    scores
  });
}

/* ============================================================
   WebSocket
   ============================================================ */
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let idSeq = 1;
wss.on("connection", (ws, req) => {
  ws.clientId = "c" + idSeq++ + Math.random().toString(36).slice(2, 6);
  ws.roomCode = null;

  // Auth from cookie
  const rawCookie = req.headers.cookie || "";
  let wsUser = null;
  try {
    // parse signed cookie manually
    const match = rawCookie.match(/session=s%3A([^;]+)/);
    if (match) {
      const raw = decodeURIComponent(match[1]);
      // express signed cookie format: value.signature
      const dot = raw.lastIndexOf(".");
      const val = raw.substring(0, dot);
      wsUser = db.userByToken(val);
    }
  } catch (_) {}

  ws.userId = wsUser ? wsUser.id : null;
  ws.userName = wsUser ? wsUser.pseudo : null;
  ws.userAvatar = wsUser ? (wsUser.avatar || null) : null;

  send(ws, { type: "welcome", id: ws.clientId, authenticated: !!wsUser, pseudo: ws.userName, avatar: ws.userAvatar });
  send(ws, { type: "rooms", rooms: roomSummary() });

  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === "listRooms") { send(ws, { type: "rooms", rooms: roomSummary() }); return; }

    if (m.type === "create") {
      if (ws.roomCode) leaveRoom(ws);
      const code = genCode(); const room = createRoomObj(code); rooms.set(code, room);
      ws.roomCode = code;
      const name = ws.userName || (m.name || "Hôte").toString().slice(0, 20) || "Hôte";
      room.clients.set(ws.clientId, { ws, name, isAdmin: true, ready: true, spectator: false, userId: ws.userId, avatar: ws.userAvatar });
      send(ws, { type: "created", room: code, id: ws.clientId });
      broadcast(room); broadcastRoomList(); return;
    }
    if (m.type === "join") {
      const code = (m.room || "").toString().toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { send(ws, { type: "join_error" }); return; }
      if (ws.roomCode && ws.roomCode !== code) leaveRoom(ws);
      ws.roomCode = code; room.seq = (room.seq || 0) + 1;
      const name = ws.userName || ((m.name && String(m.name).trim()) ? String(m.name).slice(0, 20) : "Joueur " + room.seq);
      room.clients.set(ws.clientId, { ws, name, isAdmin: false, ready: false, spectator: false, userId: ws.userId, avatar: ws.userAvatar });
      send(ws, { type: "joined", room: code, id: ws.clientId });
      broadcast(room);
      send(ws, { type: "vsync", time: room.vsync.time, playing: room.vsync.playing });
      checkAutoStart(room); broadcastRoomList(); return;
    }
    if (m.type === "rejoin") {
      const code = (m.room || "").toString().toUpperCase().trim();
      let room = rooms.get(code);
      if (!room) { if (m.wasAdmin) { room = createRoomObj(code); rooms.set(code, room); } else { send(ws, { type: "join_error" }); return; } }
      if (ws.roomCode && ws.roomCode !== code) leaveRoom(ws);
      ws.roomCode = code;
      const noAdmin = ![...room.clients.values()].some(c => c.isAdmin);
      const asAdmin = !!m.wasAdmin && noAdmin;
      const name = ws.userName || (m.name || "Joueur").toString().slice(0, 20) || "Joueur";
      room.clients.set(ws.clientId, { ws, name, isAdmin: asAdmin, ready: asAdmin, spectator: false, userId: ws.userId, avatar: ws.userAvatar });
      send(ws, { type: asAdmin ? "created" : "joined", room: code, id: ws.clientId });
      broadcast(room);
      if (!asAdmin) send(ws, { type: "vsync", time: room.vsync.time, playing: room.vsync.playing });
      broadcastRoomList(); return;
    }
    if (m.type === "leave") { leaveRoom(ws); send(ws, { type: "left" }); return; }

    const room = ws.roomCode && rooms.get(ws.roomCode);
    if (!room) return;
    const me = room.clients.get(ws.clientId);
    if (!me) return;
    const isAdm = me.isAdmin;

    switch (m.type) {
      case "rename": {
        const newName = (m.name || "").toString().slice(0, 20).trim();
        if (!newName || newName === me.name) break;
        const old = me.name; me.name = newName;
        if (room.scores.has(old)) { room.scores.set(newName, room.scores.get(old)); room.scores.delete(old); }
        for (const b of room.buzzes) if (b.id === ws.clientId) b.name = newName;
        if (room.lastWinner && room.lastWinner.id === ws.clientId) room.lastWinner.name = newName;
        broadcast(room); break;
      }
      case "ready": if (!me.spectator) { me.ready = !me.ready; broadcast(room); checkAutoStart(room); } break;
      case "spectator": me.spectator = !!m.value; if (me.spectator) me.ready = false; broadcast(room); checkAutoStart(room); break;
      case "setVideoFile":
        if (isAdm) {
          const name = (m.name || "").toString();
          if (/^[^\/\\]+$/.test(name) && VIDEO_RE.test(name)) {
            room.video = name; room.vsync = { time: 0, playing: false, at: Date.now() };
            broadcast(room); relayVsync(room);
          }
        } break;
      case "vsync":
        if (isAdm) { room.vsync = { time: Number(m.time) || 0, playing: !!m.playing, at: Date.now() }; relayVsync(room); }
        break;
      case "start": if (isAdm) startGame(room); break;
      case "clearVideo":
        if (isAdm) { room.video = null; room.vsync = { time: 0, playing: false, at: Date.now() }; broadcast(room); relayVsync(room); } break;
      case "buzz":
        if (!me.spectator && (room.phase === "playing" || room.phase === "collecting")) {
          if (room.phase === "playing") startCollect(room);
          addBuzz(room, ws.clientId, me.name, me.avatar); broadcast(room);
        } break;
      case "answer":
        if (room.phase === "collecting") {
          const b = room.buzzes.find(x => x.id === ws.clientId);
          if (b) b.answer = (m.text || "").toString().slice(0, 120);
        } break;
      case "reveal":
        if (isAdm && (room.phase === "playing" || room.phase === "collecting") && room.buzzes.length) doReveal(room); break;
      case "voteWinner":
        if (room.phase === "reveal" && !room.revealDecided && !me.spectator) {
          if (room.buzzes.some(b => b.id === m.candidateId)) {
            room.revealVotes.set(ws.clientId, m.candidateId); broadcast(room); maybeAutoCloseReveal(room);
          }
        } break;
      case "closeReveal": if (isAdm) closeReveal(room); break;
      case "noWinner":
        if (isAdm && room.phase === "reveal" && !room.revealDecided) {
          room.lastWinner = null; room.revealOutcome = "nogood"; room.revealDecided = true; broadcast(room);
        } break;
      case "continue": if (isAdm) nextRound(room); break;
      case "endGame":
        if (isAdm) {
          clearTimeout(room.collectTimer);
          recordEndGame(room);
          room.phase = "ended"; room.collectEnd = null;
          broadcast(room); broadcastRoomList();
        } break;
      case "resetScores": if (isAdm) { room.scores.clear(); broadcast(room); } break;
      case "resetLobby":
        if (isAdm) {
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
    if (wasAdmin && ![...room.clients.values()].some(c => c.isAdmin)) {
      const next = room.clients.values().next().value;
      if (next) { next.isAdmin = true; next.spectator = false; next.ready = true; send(next.ws, { type: "promoted" }); }
    }
    broadcast(room); maybeAutoCloseReveal(room); checkAutoStart(room);
  }
  broadcastRoomList();
}

/* ============================================================
   Start
   ============================================================ */
db.load().then(() => {
  server.listen(PORT, () => console.log(`Suce Pute MiniGames en écoute sur le port ${PORT}`));
}).catch(e => { console.error("DB init failed:", e); process.exit(1); });
