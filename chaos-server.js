/* ============================================================
   Chaos Culture — Serveur WebSocket + Routes
   ============================================================ */
"use strict";

const {
  createGame, activePlayers, publicState,
  calcVerdicts, applyVerdicts,
  QUESTION_TIME_MS, BLIND_TEST_TIME_MS, PETIT_BAC_TIME_MS,
  CHRONOLOGIE_TIME_MS, ANAGRAMME_TIME_MS, GOOGLE_TRAD_TIME_MS, MEME_MYSTERE_TIME_MS,
} = require("./chaos-game");
const chaosDb = require("./chaos-db");
const db = require("./db");

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
  const state = publicState(game);
  const isBlindTest = game.phase === "playing" &&
    game.questions[game.currentQ] &&
    game.questions[game.currentQ].type === "blind_test";

  for (const [cid, c] of game.clients) {
    if (c.ws.readyState !== 1) continue;
    if (isBlindTest && state.question) {
      // Hide title from everyone except the singer
      const isSinger = cid === game.blindSinger;
      const personalState = { ...state, question: { ...state.question, question: isSinger ? state.question.question : null, isSinger } };
      c.ws.send(JSON.stringify(personalState));
    } else {
      c.ws.send(JSON.stringify(state));
    }
  }
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

/* ---------- Lobby ---------- */
function startCountdown(game) {
  if (game.lobbyTimer) return;
  game.phase = "countdown";
  game.lobbyCountdownEnd = Date.now() + 5000;
  game.lobbyTimer = setTimeout(() => { if (game.phase === "countdown") launchGame(game); }, 5000);
  broadcast(game);
}

function cancelCountdown(game) {
  if (game.lobbyTimer) {
    clearTimeout(game.lobbyTimer); game.lobbyTimer = null; game.lobbyCountdownEnd = null;
    game.phase = "lobby"; broadcast(game); return true;
  }
  return false;
}

function checkAutoStart(game) {
  if (game.phase !== "lobby" && game.phase !== "countdown") return;
  const act = activePlayers(game);
  const allReady = act.length >= 2 && act.every(([, c]) => c.ready);
  if (allReady) { if (game.phase === "lobby") startCountdown(game); }
  else { if (game.phase === "countdown") cancelCountdown(game); }
}

/* ---------- Game flow ---------- */
async function launchGame(game) {
  clearTimeout(game.lobbyTimer);
  game.lobbyTimer = null; game.lobbyCountdownEnd = null;
  let questions = chaosDb.getRandomQuestions(game.questionCount);
  const maxBlindTest = activePlayers(game).length;
  const targetPetitBac = game.questionCount > 40 ? 3 : game.questionCount > 20 ? 2 : 1;

  let petitBacCount = questions.filter(q => q.type === "petit_bac").length;
  let blindTestCount = questions.filter(q => q.type === "blind_test").length;

  // Ensure minimum petit_bac
  while (petitBacCount < targetPetitBac) {
    const extra = chaosDb.getRandomQuestions(1, ["petit_bac"]);
    if (extra.length) { questions.push(extra[0]); petitBacCount++; }
    else break;
  }
  // Limit petit_bac to max 3
  while (petitBacCount > 3) {
    const idxs = questions.map((q,i) => q.type === "petit_bac" ? i : -1).filter(i => i >= 0);
    questions.splice(idxs[Math.floor(Math.random() * idxs.length)], 1);
    petitBacCount--;
  }
  // Limit blind_test to nb players
  while (blindTestCount > maxBlindTest) {
    const idxs = questions.map((q,i) => q.type === "blind_test" ? i : -1).filter(i => i >= 0);
    questions.splice(idxs[Math.floor(Math.random() * idxs.length)], 1);
    blindTestCount--;
  }
  game.questions = questions;
  game.answers = game.questions.map(() => new Map());
  game.votes = game.questions.map(() => new Map());
  game.results = new Array(game.questions.length).fill(null);
  game.currentQ = -1; game.correctionQ = -1;
  game.tieData = null;
  game.scores.clear(); game.shameScores.clear();
  nextQuestion(game);
}

function nextQuestion(game) {
  clearTimeout(game.qTimer);

  // Save empty answers for players who didn't respond to previous question
  if (game.currentQ >= 0 && game.currentQ < game.questions.length) {
    const ansMap = game.answers[game.currentQ];
    for (const [cid, c] of activePlayers(game)) {
      if (!ansMap.has(cid)) {
        ansMap.set(cid, { name: c.name, text: "", avatar: c.avatar || null });
      }
    }
  }

  game.currentQ++;
  if (game.currentQ >= game.questions.length) {
    startCorrection(game, 0); return;
  }
  game.phase = "playing";
  const q = game.questions[game.currentQ];

  // blind_test: pick random singer
  if (q.type === "blind_test") {
    const act = activePlayers(game);
    const idx = Math.floor(Math.random() * act.length);
    game.blindSinger = act[idx] ? act[idx][0] : null;
  } else {
    game.blindSinger = null;
  }

  const duration = q.type === "blind_test" ? BLIND_TEST_TIME_MS
    : q.type === "petit_bac" ? PETIT_BAC_TIME_MS
    : q.type === "chronologie" ? CHRONOLOGIE_TIME_MS
    : q.type === "anagramme" ? ANAGRAMME_TIME_MS
    : q.type === "google_trad" ? GOOGLE_TRAD_TIME_MS
    : q.type === "meme_mystere" ? MEME_MYSTERE_TIME_MS
    : QUESTION_TIME_MS;
  game.qEnd = Date.now() + duration;
  broadcast(game);
  game.qTimer = setTimeout(() => {
    if (game.phase === "playing") nextQuestion(game);
  }, duration);
}

function startCorrection(game, qIdx) {
  clearTimeout(game.correctionTimer);
  if (qIdx >= game.questions.length) { showResults(game); return; }
  game.phase = "correction";
  game.correctionQ = qIdx;
  game.tieData = null;
  broadcast(game);
}

function finalizeCorrection(game, qIdx) {
  const results = calcVerdicts(game, qIdx);

  // Check for ties (skip singer and petit_bac which have their own logic)
  const tied = results.filter(r => r.verdict === "tie");
  if (tied.length > 0) {
    game.tieData = { qIdx, tied: tied.map(r => ({ clientId: r.clientId, name: r.name, text: r.text })) };
    game.results[qIdx] = results.map(r => ({
      clientId: r.clientId, name: r.name, text: r.text,
      verdict: r.verdict, vraiCount: r.vraiCount, fauxCount: r.fauxCount, honteCount: r.honteCount,
      catResults: r.catResults || null, isSinger: r.isSinger || false, bonusPetitBac: r.bonusPetitBac || false,
    }));
    broadcast(game);
    return;
  }

  applyVerdicts(game, qIdx, results);
  game.tieData = null;
  game.results[qIdx] = results.map(r => ({
    clientId: r.clientId, name: r.name, text: r.text,
    verdict: r.verdict, tie: r.tie || false,
    vraiCount: r.vraiCount, fauxCount: r.fauxCount, honteCount: r.honteCount,
    catResults: r.catResults || null,
    isSinger: r.isSinger || false,
    bonusPetitBac: r.bonusPetitBac || false,
  }));
  broadcast(game);
}

function showResults(game) {
  game.phase = "results"; game.correctionQ = -1; game.tieData = null;

  // Save to history
  try {
    const scores = [...game.scores.entries()].map(([name, points]) => {
      // find userId by name
      let userId = null;
      for (const c of game.clients.values()) { if (c.name === name) { userId = c.userId; break; } }
      return { name, points, userId };
    }).sort((a, b) => b.points - a.points);
    const winner = scores.length > 0 ? scores[0].name : "";
    db.recordGame({
      game_type: "chaos",
      played_at: Date.now(),
      players: [...game.clients.values()].map(c => c.name),
      winner,
      scores,
    });
  } catch (e) { console.error("chaos recordGame error:", e.message); }

  broadcast(game);
}

/* ---------- Message handler ---------- */
function handleMessage(ws, m) {
  if (m.type === "chaos_listRooms") { send(ws, { type: "chaos_rooms", rooms: chaosRoomSummary() }); return; }

  if (m.type === "chaos_create") {
    if (ws.chaosRoom) leaveGame(ws);
    const qCount = [20, 30, 40, 50].includes(m.questionCount) ? m.questionCount : 20;
    const code = genCode();
    const game = createGame(code, qCount);
    chaosRooms.set(code, game);
    ws.chaosRoom = code;
    game.clients.set(ws.chaosId, { ws, name: ws.chaosName || "Hôte", isAdmin: true, ready: true, spectator: false, userId: ws.chaosUserId, avatar: ws.chaosAvatar });
    send(ws, { type: "chaos_created", room: code, id: ws.chaosId });
    broadcast(game); return;
  }

  if (m.type === "chaos_join") {
    const code = (m.room || "").toString().toUpperCase().trim();
    const game = chaosRooms.get(code);
    if (!game) { send(ws, { type: "chaos_join_error" }); return; }
    if (ws.chaosRoom && ws.chaosRoom !== code) leaveGame(ws);
    ws.chaosRoom = code; game.seq++;
    game.clients.set(ws.chaosId, { ws, name: ws.chaosName || ("Joueur " + game.seq), isAdmin: false, ready: false, spectator: false, userId: ws.chaosUserId, avatar: ws.chaosAvatar });
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

    case "chaos_set_qcount":
      if (isAdm && (game.phase === "lobby" || game.phase === "countdown")) {
        const n = (m.count >= 5 && m.count <= 100) ? m.count : game.questionCount;
        game.questionCount = n; broadcast(game);
      } break;

    case "chaos_start":
      if (isAdm && (game.phase === "lobby" || game.phase === "countdown")) launchGame(game); break;

    case "chaos_answer":
      // Modifiable until timer ends — always overwrite
      if (game.phase === "playing" && !me.spectator) {
        const ansMap = game.answers[game.currentQ];
        if (ansMap) {
          ansMap.set(ws.chaosId, { name: me.name, text: (m.text || "").toString().slice(0, 200), avatar: me.avatar || null });
          broadcast(game);
        }
      } break;

    case "chaos_vote": {
      if (game.phase !== "correction") break;
      const qIdx = game.correctionQ;
      const q = game.questions[qIdx];
      if (!q || game.results[qIdx]) break;
      if (!["vrai", "faux", "honte"].includes(m.verdict)) break;
      const ansMap = game.answers[qIdx];
      if (!ansMap) break;
      // petit_bac: targetClientId may be "clientId___catName"
      const baseId = (q.type === "petit_bac" && m.targetClientId && m.targetClientId.includes("___"))
        ? m.targetClientId.split("___")[0] : m.targetClientId;
      if (!ansMap.has(baseId)) break;
      if (!game.votes[qIdx]) game.votes[qIdx] = new Map();
      let myVotes = game.votes[qIdx].get(ws.chaosId);
      if (!myVotes) { myVotes = new Map(); game.votes[qIdx].set(ws.chaosId, myVotes); }
      myVotes.set(m.targetClientId, m.verdict);
      broadcast(game);
      break;
    }

    case "chaos_next_correction":
      if (isAdm && game.phase === "correction") {
        const qIdx = game.correctionQ;
        if (!game.results[qIdx]) {
          finalizeCorrection(game, qIdx);
        } else if (!game.tieData) {
          startCorrection(game, qIdx + 1);
        }
      } break;

    case "chaos_resolve_tie":
      // Admin picks winner for a tied answer
      // m.clientId = winner, m.verdict = "vrai"|"honte" (admin decides)
      if (isAdm && game.tieData && game.phase === "correction") {
        const qIdx = game.tieData.qIdx;
        if (!["vrai", "faux", "honte"].includes(m.verdict)) break;
        // Apply to result
        const r = game.results[qIdx] && game.results[qIdx].find(x => x.clientId === m.clientId);
        if (r) {
          r.verdict = m.verdict;
          // Remove from tied list
          game.tieData.tied = game.tieData.tied.filter(t => t.clientId !== m.clientId);
          if (game.tieData.tied.length === 0) {
            // All ties resolved — apply verdicts
            applyVerdicts(game, qIdx, game.results[qIdx]);
            game.tieData = null;
          }
          broadcast(game);
        }
      } break;

    case "chaos_extend_timer":
      if (game.phase === "playing") {
        const eq = game.questions[game.currentQ];
        if (eq && eq.type === "blind_test" && ws.chaosId === game.blindSinger) {
          const ext = 10000;
          game.qEnd = (game.qEnd || Date.now()) + ext;
          clearTimeout(game.qTimer);
          const remaining = game.qEnd - Date.now();
          game.qTimer = setTimeout(() => {
            if (game.phase === "playing") nextQuestion(game);
          }, remaining);
          // Notify all players
          const singerName = me.name;
          for (const c of game.clients.values()) {
            if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ type: "chaos_toast", msg: `⏱️ ${singerName} ne connaît pas — +10s !` }));
          }
          broadcast(game);
        }
      } break;
      if (isAdm) {
        clearTimeout(game.qTimer);
        game.phase = "ended"; broadcast(game);
      } break;

    case "chaos_resetlobby":
      if (isAdm) {
        clearTimeout(game.qTimer); clearTimeout(game.correctionTimer); clearTimeout(game.lobbyTimer);
        const fresh = createGame(game.code, game.questionCount);
        fresh.clients = game.clients;
        for (const c of fresh.clients.values()) c.ready = c.isAdmin;
        chaosRooms.set(game.code, fresh);
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
    clearTimeout(game.qTimer); clearTimeout(game.correctionTimer); clearTimeout(game.lobbyTimer);
    chaosRooms.delete(game.code);
  } else {
    if (wasAdmin && ![...game.clients.values()].some(c => c.isAdmin)) {
      const next = game.clients.values().next().value;
      if (next) { next.isAdmin = true; next.ready = true; send(next.ws, { type: "chaos_promoted" }); }
    }
    broadcast(game); checkAutoStart(game);
  }
}

module.exports = { handleMessage, leaveGame, chaosRoomSummary };
