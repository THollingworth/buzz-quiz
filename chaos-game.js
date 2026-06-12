/* ============================================================
   Chaos Culture — State Machine
   Phases : lobby → playing → correction → results → ended
   ============================================================ */
"use strict";

const QUESTION_TIME_MS = 15000;
const VOTE_TIME_MS = 20000; // temps max par question en correction

/* ---------- Factory ---------- */
function createGame(code, questionCount) {
  return {
    code,
    phase: "lobby",          // lobby | countdown | playing | correction | results | ended
    questions: [],           // liste tirée au sort
    questionCount: questionCount || 20,
    currentQ: -1,            // index question en cours
    qTimer: null,
    qEnd: null,
    correctionQ: -1,         // index question en correction
    correctionTimer: null,
    correctionEnd: null,
    lobbyTimer: null,
    lobbyCountdownEnd: null,
    // answers[questionIdx] = Map<clientId, { name, text, avatar }>
    answers: [],
    // votes[questionIdx][clientId] = Map<targetClientId, "vrai"|"faux"|"honte">
    votes: [],
    // résultats calculés par question
    results: [],             // [{clientId, name, verdict, voteCount}]
    scores: new Map(),       // pseudo → points
    shameScores: new Map(),  // pseudo → points honte (négatifs cumulés)
    clients: new Map(),      // clientId → { ws, name, isAdmin, ready, spectator, userId, avatar }
    seq: 0,
  };
}

/* ---------- Helpers ---------- */
function activePlayers(game) {
  return [...game.clients.entries()].filter(([, c]) => !c.spectator);
}

function scoreboard(game) {
  const seen = new Map();
  for (const [, c] of activePlayers(game)) {
    if (!seen.has(c.name)) seen.set(c.name, game.scores.get(c.name) || 0);
  }
  return [...seen.entries()]
    .map(([name, pts]) => ({ name, pts, shame: game.shameScores.get(name) || 0 }))
    .sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
}

function shameBoard(game) {
  const out = [];
  game.shameScores.forEach((pts, name) => { if (pts < 0) out.push({ name, pts }); });
  return out.sort((a, b) => a.pts - b.pts);
}

/* ---------- Public state ---------- */
function publicState(game) {
  const q = game.questions[game.currentQ] || null;
  const cq = game.questions[game.correctionQ] || null;

  // Answers for current correction question (revealed during correction)
  let correctionAnswers = null;
  if (game.phase === "correction" && game.correctionQ >= 0) {
    const ansMap = game.answers[game.correctionQ] || new Map();
    correctionAnswers = [...ansMap.entries()].map(([cid, a]) => ({
      clientId: cid,
      name: a.name,
      text: a.text,
      avatar: a.avatar || null,
    }));
    // votes cast so far for this question
  }

  let correctionVotes = null;
  if (game.phase === "correction" && game.correctionQ >= 0) {
    const vMap = game.votes[game.correctionQ] || new Map();
    // { voterClientId → { targetClientId → verdict } }
    const out = {};
    vMap.forEach((targets, voterId) => {
      out[voterId] = Object.fromEntries(targets);
    });
    correctionVotes = out;
  }

  const players = [...game.clients.entries()].map(([id, c]) => ({
    id, name: c.name, isAdmin: c.isAdmin, ready: c.ready, spectator: c.spectator,
    avatar: c.avatar || null,
  }));

  return {
    type: "chaos_state",
    phase: game.phase,
    questionCount: game.questionCount,
    currentQ: game.currentQ,
    totalQ: game.questions.length,
    correctionQ: game.correctionQ,
    qRemaining: game.qEnd ? Math.max(0, game.qEnd - Date.now()) : 0,
    correctionRemaining: game.correctionEnd ? Math.max(0, game.correctionEnd - Date.now()) : 0,
    lobbyCountdownRemaining: game.lobbyCountdownEnd ? Math.max(0, game.lobbyCountdownEnd - Date.now()) : 0,
    question: q ? { id: q.id, type: q.type, question: q.question, choices: q.choices } : null,
    correctionQuestion: cq ? { id: cq.id, type: cq.type, question: cq.question, answer: cq.answer, choices: cq.choices } : null,
    correctionAnswers,
    correctionVotes,
    correctionResults: game.results[game.correctionQ] || null,
    scores: scoreboard(game),
    shameBoard: shameBoard(game),
    players,
  };
}

/* ---------- Vote calculation ---------- */
function calcVerdicts(game, qIdx) {
  const ansMap = game.answers[qIdx] || new Map();
  const vMap = game.votes[qIdx] || new Map();
  const q = game.questions[qIdx];
  const results = [];

  for (const [cid, ans] of ansMap) {
    // Tally votes for this target
    let vraiCount = 0, fauxCount = 0, honteCount = 0;
    vMap.forEach((targets) => {
      const v = targets.get(cid);
      if (v === "vrai") vraiCount++;
      else if (v === "faux") fauxCount++;
      else if (v === "honte") honteCount++;
    });

    let verdict;
    const total = vraiCount + fauxCount + honteCount;

    if (total === 0) {
      // Auto-types (vrai_faux, plus_proche handled separately)
      verdict = "faux";
    } else if (honteCount > vraiCount && honteCount > fauxCount) {
      verdict = "honte";
    } else if (vraiCount >= fauxCount) {
      verdict = "vrai";
    } else {
      verdict = "faux";
    }

    // Override: auto-correct for vrai_faux
    if (q.type === "vrai_faux" && q.answer) {
      const submitted = (ans.text || "").toLowerCase().trim();
      verdict = submitted === q.answer.toLowerCase().trim() ? "vrai" : "faux";
    }

    // Override: plus_proche → winner gets vrai, others faux
    // (handled after loop)

    results.push({ clientId: cid, name: ans.name, text: ans.text, verdict, vraiCount, fauxCount, honteCount });
  }

  // plus_proche: find closest to answer
  if (q.type === "plus_proche" && q.answer) {
    const target = parseFloat(q.answer);
    let bestDist = Infinity, bestCid = null;
    for (const r of results) {
      const val = parseFloat((r.text || "").replace(/[^\d.,\-]/g, "").replace(",", "."));
      if (!isNaN(val)) {
        const dist = Math.abs(val - target);
        if (dist < bestDist) { bestDist = dist; bestCid = r.clientId; }
      }
    }
    for (const r of results) {
      r.verdict = r.clientId === bestCid ? "vrai" : "faux";
    }
  }

  // susceptible: player with most votes gets +1 (no correction vote, handled by vote susceptible)
  // For susceptible, correctionAnswers = who each player voted for
  if (q.type === "susceptible") {
    // votes = { voterId → { targetClientId: "vrai" } } (target = pseudo voté)
    // Count votes per target name
    const tally = new Map();
    vMap.forEach((targets) => {
      targets.forEach((verdict, tid) => {
        tally.set(tid, (tally.get(tid) || 0) + 1);
      });
    });
    let maxVotes = 0;
    tally.forEach(c => { if (c > maxVotes) maxVotes = c; });
    const winners = [];
    tally.forEach((c, cid) => { if (c === maxVotes && maxVotes > 0) winners.push(cid); });
    // voters who voted for a winner also get +1
    const winnerSet = new Set(winners);
    for (const r of results) {
      if (winnerSet.has(r.clientId)) r.verdict = "vrai";
      else r.verdict = "faux";
      r.votesReceived = tally.get(r.clientId) || 0;
    }
    // Also give +1 to voters who voted for majority
    // We'll handle voter points separately in applyVerdicts
    results._susceptibleWinners = winners;
  }

  return results;
}

function applyVerdicts(game, qIdx, results) {
  const q = game.questions[qIdx];
  const vMap = game.votes[qIdx] || new Map();

  for (const r of results) {
    if (r.verdict === "vrai") {
      game.scores.set(r.name, (game.scores.get(r.name) || 0) + 1);
    } else if (r.verdict === "honte") {
      game.scores.set(r.name, (game.scores.get(r.name) || 0) - 1);
      game.shameScores.set(r.name, (game.shameScores.get(r.name) || 0) - 1);
    }
  }

  // susceptible: voters who voted for winner also get +1
  if (q.type === "susceptible" && results._susceptibleWinners) {
    const winSet = new Set(results._susceptibleWinners);
    vMap.forEach((targets, voterId) => {
      targets.forEach((v, tid) => {
        if (winSet.has(tid)) {
          // find voter name
          const client = game.clients.get(voterId);
          if (client) game.scores.set(client.name, (game.scores.get(client.name) || 0) + 1);
        }
      });
    });
  }
}

module.exports = {
  createGame,
  activePlayers,
  publicState,
  scoreboard,
  shameBoard,
  calcVerdicts,
  applyVerdicts,
  QUESTION_TIME_MS,
  VOTE_TIME_MS,
};
