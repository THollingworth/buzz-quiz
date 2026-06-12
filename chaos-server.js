/* ============================================================
   Chaos Culture — Serveur WebSocket + Routes
   ============================================================ */
"use strict";

const {
  createGame, activePlayers, publicState, scoreboard,
  calcVerdicts, applyVerdicts, QUESTION_TIME_MS, VOTE_TIME_MS,
} = require("./chaos-game");
const chaosDb = require("./chaos-db");

const CODE_ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const chaosRooms = new Map();

function genCode() {
  let c;
  do {
    c = "";
    for (let i = 0; i < 4; i++) c += CODE_ALPHA[Math.floor(Math.random() * CODE_ALPHA.length)];
  } while (chaosRooms.has(c));
  return c;
}

function broadcast(game) {
  const msg = JSON.stringify(publicState(game));
  for (const c of game.clients.values()) if (c.ws.readyState === 1) c.ws.send(msg);
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function chaosRoomSummary() {
  const out = [];
  for (const g of chaosRooms.values()) {
    out.push({ code: g.code, count: g.clients.size, phase: g.phase, questionCount: g.questionCount });
  }
  return out;
}

/* ---------- Game flow ---------- */

function startCountdown(game) {
  if (game.lobbyTimer) return;
  game.phase = "countdown";
  game.lobbyCountdownEnd = Date.now() + 5000;
  game.lobbyTimer = setTimeout(() => {
    if (game.phase === "countdown") launchGame(game);
  }, 5000);
  broadcast(game);
}

function cancelCountdown(game) {
  if (game.lobbyTimer) {
    clearTimeout(game.lobbyTimer);
    game.lobbyTimer = null;
    game.lobbyCountdownEnd = null;
    game.phase = "lobby";
    broadcast(game);
    return true;
  }
  return false;
}

function checkAutoStart(game) {
  if (game.phase !== "lobby" && game.phase !== "countdown") return;
  const act = activePlayers(game);
  const allReady = act.length >= 2 && act.every(([, c]) => c.ready);
  if (allReady) {
    if (game.phase === "lobby") startCountdown(game);
  } else {
    if (game.phase === "countdown") cancelCountdown(game);
  }
}

async function launchGame(game) {
  clearTimeout(game.lobbyTimer);
  game.lobbyTimer = null;
  game.lobbyCountdownEnd = null;
  // Load questions
  game.questions = chaosDb.getRandomQuestions(game.questionCount);
  game.answers = game.questions.map(() => new Map());
  game.votes = game.questions.map(() => new Map());
  game.results = new Array(game.questions.length).fill(null);
  game.currentQ = -1;
  game.correctionQ = -1;
  game.scores.clear();
  game.shameScores.clear();
  // Start first question
  nextQuestion(game);
}

function nextQuestion(game) {
  clearTimeout(game.qTimer);
  game.currentQ++;
  if (game.currentQ >= game.questions.length) {
    // No more questions → correction phase starts from q0
    startCorrection(game, 0);
    return;
  }
  game.phase = "playing";
  game.qEnd = Date.now() + QUESTION_TIME_MS;
  broadcast(game);
  game.qTimer = setTimeout(() => {
    if (game.phase === "playing") nextQuestion(game);
  }, QUESTION_TIME_MS);
}

function startCorrection(game, qIdx) {
  clearTimeout(game.correctionTimer);
  if (qIdx >= game.questions.length) {
    // All corrections done → results
    showResults(game);
    return;
  }
  game.phase = "correction";
  game.correctionQ = qIdx;
  game.correctionEnd = Date.now() + VOTE_TIME_MS;
  broadcast(game);
  game.correctionTimer = setTimeout(() => {
    if (game.phase === "correction" && game.correctionQ === qIdx) {
      finalizeCorrection(game, qIdx);
    }
  }, VOTE_TIME_MS);
}

function finalizeCorrection(game, qIdx) {
  const results = calcVerdicts(game, qIdx);
  applyVerdicts(game, qIdx, results);
  // Store clean results (no internal _susceptibleWinners)
  game.results[qIdx] = results.map(r => ({
    clientId: r.clientId, name: r.name, text: r.text,
    verdict: r.verdict, vraiCount: r.vraiCount, fauxCount: r.fauxCount, honteCount: r.honteCount,
    votesReceived: r.votesReceived,
  }));
  broadcast(game);
  // Auto-advance after 4s
  setTimeout(() => {
    if (game.phase === "correction" && game.correctionQ === qIdx) {
      startCorrection(game, qIdx + 1);
    }
  }, 4000);
}

function checkAllVoted(game, qIdx) {
  const act = activePlayers(game);
  const ansMap = game.answers[qIdx] || new Map();
  const vMap = game.votes[qIdx] || new Map();
  const q = game.questions[qIdx];

  // susceptible: everyone votes for someone (not correction)
  // vrai_faux / plus_proche: auto, no vote needed
  if (q.type === "vrai_faux" || q.type === "plus_proche") {
    // auto-finalize immediately
    clearTimeout(game.correctionTimer);
    finalizeCorrection(game, qIdx);
    return;
  }
  if (q.type === "susceptible") {
    // check all non-answerers voted (everyone votes for someone)
    const allVoted = act.every(([cid]) => vMap.has(cid));
    if (allVoted) { clearTimeout(game.correctionTimer); finalizeCorrection(game, qIdx); }
    return;
  }

  // culture_gen: every voter has voted on every answer they must vote on
  // voter votes on all answers except their own
  const answerIds = [...ansMap.keys()];
  const allVoted = act.every(([cid]) => {
    const targets = answerIds.filter(id => id !== cid);
    if (targets.length === 0) return true;
    const myVotes = vMap.get(cid) || new Map();
    return targets.every(tid => myVotes.has(tid));
  });
  if (allVoted) { clearTimeout(game.correctionTimer); finalizeCorrection(game, qIdx); }
}

function showResults(game) {
  clearTimeout(game.correctionTimer);
  game.phase = "results";
  game.correctionQ = -1;
  broadcast(game);
}

/* ---------- Mount sur un WSS existant ---------- */
let idSeq = 1;

function handleConnection(ws, req, getUserFromReq) {
  ws.chaosId = "ch" + idSeq++ + Math.random().toString(36).slice(2, 5);
  ws.chaosRoom = null;

  const wsUser = getUserFromReq(req);
  ws.chaosUserId = wsUser ? wsUser.id : null;
  ws.chaosName = wsUser ? wsUser.pseudo : null;
  ws.chaosAvatar = wsUser ? (wsUser.avatar || null) : null;

  send(ws, { type: "chaos_welcome", id: ws.chaosId, pseudo: ws.chaosName, avatar: ws.chaosAvatar });
  send(ws, { type: "chaos_rooms", rooms: chaosRoomSummary() });

  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m.type || !m.type.startsWith("chaos_")) return; // ignore non-chaos messages

    handleMessage(ws, m);
  });

  ws.on("close", () => leaveGame(ws));
}

function handleMessage(ws, m) {
  if (m.type === "chaos_listRooms") {
    send(ws, { type: "chaos_rooms", rooms: chaosRoomSummary() }); return;
  }
  if (m.type === "chaos_create") {
    if (ws.chaosRoom) leaveGame(ws);
    const qCount = [20, 30, 40, 50].includes(m.questionCount) ? m.questionCount : 20;
    const code = genCode();
    const game = createGame(code, qCount);
    chaosRooms.set(code, game);
    ws.chaosRoom = code;
    const name = ws.chaosName || "Hôte";
    game.clients.set(ws.chaosId, { ws, name, isAdmin: true, ready: true, spectator: false, userId: ws.chaosUserId, avatar: ws.chaosAvatar });
    send(ws, { type: "chaos_created", room: code, id: ws.chaosId });
    broadcast(game); return;
  }
  if (m.type === "chaos_join") {
    const code = (m.room || "").toString().toUpperCase().trim();
    const game = chaosRooms.get(code);
    if (!game) { send(ws, { type: "chaos_join_error" }); return; }
    if (ws.chaosRoom && ws.chaosRoom !== code) leaveGame(ws);
    ws.chaosRoom = code;
    game.seq++;
    const name = ws.chaosName || ("Joueur " + game.seq);
    game.clients.set(ws.chaosId, { ws, name, isAdmin: false, ready: false, spectator: false, userId: ws.chaosUserId, avatar: ws.chaosAvatar });
    send(ws, { type: "chaos_joined", room: code, id: ws.chaosId });
    broadcast(game); return;
  }
  if (m.type === "chaos_leave") { leaveGame(ws); send(ws, { type: "chaos_left" }); return; }

  const game = ws.chaosRoom && chaosRooms.get(ws.chaosRoom);
  if (!game) return;
  const me = game.clients.get(ws.chaosId);
  if (!me) return;
  const isAdm = me.isAdmin;

  switch (m.type) {
    case "chaos_ready":
      if (!me.spectator) { me.ready = !me.ready; broadcast(game); checkAutoStart(game); } break;

    case "chaos_start":
      if (isAdm && (game.phase === "lobby" || game.phase === "countdown")) launchGame(game); break;

    case "chaos_answer":
      if (game.phase === "playing" && !me.spectator) {
        const ansMap = game.answers[game.currentQ];
        if (ansMap && !ansMap.has(ws.chaosId)) {
          ansMap.set(ws.chaosId, { name: me.name, text: (m.text || "").toString().slice(0, 200), avatar: me.avatar || null });
          // Check if all answered
          const act = activePlayers(game);
          if (act.every(([cid]) => ansMap.has(cid))) {
            clearTimeout(game.qTimer);
            nextQuestion(game);
          } else {
            broadcast(game);
          }
        }
      } break;

    case "chaos_vote": {
      // During correction, vote on a specific answer
      // m.targetClientId, m.verdict ("vrai"|"faux"|"honte")
      if (game.phase !== "correction") break;
      const qIdx = game.correctionQ;
      const q = game.questions[qIdx];
      if (!q) break;

      if (!["vrai", "faux", "honte"].includes(m.verdict)) break;

      if (q.type === "susceptible") {
        // vote for a player (targetClientId)
        if (!game.clients.has(m.targetClientId)) break;
        if (!game.votes[qIdx]) game.votes[qIdx] = new Map();
        let myVotes = game.votes[qIdx].get(ws.chaosId);
        if (!myVotes) { myVotes = new Map(); game.votes[qIdx].set(ws.chaosId, myVotes); }
        myVotes.set(m.targetClientId, "vrai"); // only one vote
        broadcast(game);
        checkAllVoted(game, qIdx);
        break;
      }

      // Can't vote on own answer
      if (m.targetClientId === ws.chaosId) break;
      const ansMap = game.answers[qIdx];
      if (!ansMap || !ansMap.has(m.targetClientId)) break;

      if (!game.votes[qIdx]) game.votes[qIdx] = new Map();
      let myVotes = game.votes[qIdx].get(ws.chaosId);
      if (!myVotes) { myVotes = new Map(); game.votes[qIdx].set(ws.chaosId, myVotes); }
      myVotes.set(m.targetClientId, m.verdict);
      broadcast(game);
      checkAllVoted(game, qIdx);
      break;
    }

    case "chaos_next_correction":
      if (isAdm && game.phase === "correction") {
        clearTimeout(game.correctionTimer);
        finalizeCorrection(game, game.correctionQ);
      } break;

    case "chaos_endgame":
      if (isAdm) {
        clearTimeout(game.qTimer);
        clearTimeout(game.correctionTimer);
        game.phase = "ended";
        broadcast(game);
      } break;

    case "chaos_resetlobby":
      if (isAdm) {
        clearTimeout(game.qTimer);
        clearTimeout(game.correctionTimer);
        clearTimeout(game.lobbyTimer);
        const fresh = createGame(game.code, game.questionCount);
        // keep clients
        fresh.clients = game.clients;
        // reset ready
        for (const c of fresh.clients.values()) { c.ready = c.isAdmin; }
        chaosRooms.set(game.code, fresh);
        ws.chaosRoom = game.code;
        broadcast(fresh);
      } break;
  }
}

function leaveGame(ws) {
  const game = ws.chaosRoom && chaosRooms.get(ws.chaosRoom);
  if (!game) return;
  const leaving = game.clients.get(ws.chaosId);
  const wasAdmin = leaving && leaving.isAdmin;
  game.clients.delete(ws.chaosId);
  ws.chaosRoom = null;
  if (game.clients.size === 0) {
    clearTimeout(game.qTimer);
    clearTimeout(game.correctionTimer);
    clearTimeout(game.lobbyTimer);
    chaosRooms.delete(game.code);
  } else {
    if (wasAdmin && ![...game.clients.values()].some(c => c.isAdmin)) {
      const next = game.clients.values().next().value;
      if (next) { next.isAdmin = true; next.ready = true; send(next.ws, { type: "chaos_promoted" }); }
    }
    broadcast(game);
    checkAutoStart(game);
  }
}

module.exports = { handleMessage, leaveGame, chaosRoomSummary };
