/* ============================================================
   Chaos Culture — State Machine
   ============================================================ */
"use strict";

const QUESTION_TIME_MS = 10000;
const BLIND_TEST_TIME_MS = 30000;
const PETIT_BAC_TIME_MS = 30000;
const CHRONOLOGIE_TIME_MS = 20000;
const ANAGRAMME_TIME_MS = 15000;
const ANAGRAMME_HINT_DELAY_MS = 7000;
const GOOGLE_TRAD_TIME_MS = 15000;
const MEME_MYSTERE_TIME_MS = 20000;

function createGame(code, questionCount) {
  return {
    code,
    phase: "lobby",
    questions: [],
    questionCount: questionCount || 20,
    currentQ: -1,
    qTimer: null,
    qEnd: null,
    correctionQ: -1,
    correctionTimer: null,
    correctionEnd: null,
    lobbyTimer: null,
    lobbyCountdownEnd: null,
    answers: [],   // answers[qIdx] = Map<clientId, { name, text, avatar }>
    votes: [],     // votes[qIdx] = Map<voterId, Map<targetId, verdict>>
    results: [],   // results[qIdx] = array of result objects | null
    tieData: null,
    blindSinger: null, // clientId of player who sees blind_test title // { qIdx, tied: [{clientId, name, text}] } — admin picks winner
    scores: new Map(),
    shameScores: new Map(),
    clients: new Map(),
    seq: 0,
  };
}

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

function publicState(game) {
  const q = game.questions[game.currentQ] || null;
  const cq = game.questions[game.correctionQ] || null;

  let correctionAnswers = null;
  if (game.phase === "correction" && game.correctionQ >= 0) {
    const ansMap = game.answers[game.correctionQ] || new Map();
    const cq = game.questions[game.correctionQ];
    correctionAnswers = [...ansMap.entries()].map(([cid, a]) => ({
      clientId: cid, name: a.name, text: a.text, avatar: a.avatar || null,
      // For petit_bac, parse JSON into categories
      petitBacCats: (cq && cq.type === "petit_bac" && a.text) ? (() => { try { return JSON.parse(a.text); } catch { return {}; } })() : null,
    }));
  }

  let correctionVotes = null;
  let voteProgress = null; // { playerId: { done: bool, remaining: int } }
  if (game.phase === "correction" && game.correctionQ >= 0) {
    const vMap = game.votes[game.correctionQ] || new Map();
    const ansMap = game.answers[game.correctionQ] || new Map();
    const answerIds = [...ansMap.keys()];
    const out = {};
    vMap.forEach((targets, voterId) => { out[voterId] = Object.fromEntries(targets); });
    correctionVotes = out;

    // vote progress per active player
    voteProgress = {};
    for (const [cid] of activePlayers(game)) {
      const myVotes = vMap.get(cid) || new Map();
      const total = answerIds.length;
      const done = answerIds.filter(tid => myVotes.has(tid)).length;
      voteProgress[cid] = { done: done >= total && total > 0, remaining: Math.max(0, total - done) };
    }
  }

  const players = [...game.clients.entries()].map(([id, c]) => ({
    id, name: c.name, isAdmin: c.isAdmin, ready: c.ready, spectator: c.spectator,
    avatar: c.avatar || null,
  }));

  // answeredCount for playing phase (how many have submitted)
  let answeredCount = 0;
  if (game.phase === "playing" && game.currentQ >= 0) {
    answeredCount = (game.answers[game.currentQ] || new Map()).size;
  }

  return {
    type: "chaos_state",
    phase: game.phase,
    questionCount: game.questionCount,
    currentQ: game.currentQ,
    totalQ: game.questions.length,
    correctionQ: game.correctionQ,
    qRemaining: game.qEnd ? Math.max(0, game.qEnd - Date.now()) : 0,
    lobbyCountdownRemaining: game.lobbyCountdownEnd ? Math.max(0, game.lobbyCountdownEnd - Date.now()) : 0,
    question: q ? {
      id: q.id, type: q.type, question: q.question, choices: q.choices,
      // blind_test: only singer sees the title
      blindSinger: game.blindSinger || null,
    } : null,
    correctionQuestion: cq ? { id: cq.id, type: cq.type, question: cq.question, answer: cq.answer, choices: cq.choices } : null,
    correctionAnswers,
    correctionVotes,
    voteProgress,
    correctionResults: game.results[game.correctionQ] || null,
    tieData: game.tieData,
    answeredCount,
    totalPlayers: activePlayers(game).length,
    scores: scoreboard(game),
    shameBoard: shameBoard(game),
    players,
  };
}

/* ---------- Vote calculation — ALL by vote majority ---------- */
function calcVerdicts(game, qIdx) {
  const ansMap = game.answers[qIdx] || new Map();
  const vMap = game.votes[qIdx] || new Map();
  const q = game.questions[qIdx];
  const results = [];

  for (const [cid, ans] of ansMap) {
    // blind_test: singer has no verdict (they just sang)
    if (q.type === "blind_test" && cid === game.blindSinger) {
      results.push({ clientId: cid, name: ans.name, text: ans.text, verdict: "singer", isSinger: true, vraiCount: 0, fauxCount: 0, honteCount: 0 });
      continue;
    }

    // petit_bac: calculate per-category verdicts
    if (q.type === "petit_bac") {
      const cats = q.choices || [];
      let catData = {};
      try { catData = JSON.parse(ans.text || "{}"); } catch {}
      const catResults = {};
      for (const cat of cats) {
        const targetKey = cid + "___" + cat;
        let vr = 0, fa = 0, ho = 0;
        vMap.forEach(targets => {
          const v = targets.get(targetKey);
          if (v === "vrai") vr++;
          else if (v === "faux") fa++;
          else if (v === "honte") ho++;
        });
        const max = Math.max(vr, fa, ho);
        const total = vr + fa + ho;
        let cv;
        if (total === 0) cv = "faux";
        else {
          const leaders = [];
          if (vr === max) leaders.push("vrai");
          if (fa === max) leaders.push("faux");
          if (ho === max) leaders.push("honte");
          cv = leaders.length === 1 ? leaders[0] : "tie";
        }
        catResults[cat] = { verdict: cv, vraiCount: vr, fauxCount: fa, honteCount: ho, text: catData[cat] || "" };
      }
      results.push({ clientId: cid, name: ans.name, text: ans.text, verdict: "petit_bac", catResults, vraiCount: 0, fauxCount: 0, honteCount: 0 });
      continue;
    }

    // Standard verdict
    let vraiCount = 0, fauxCount = 0, honteCount = 0;
    vMap.forEach((targets) => {
      const v = targets.get(cid);
      if (v === "vrai") vraiCount++;
      else if (v === "faux") fauxCount++;
      else if (v === "honte") honteCount++;
    });
    const max = Math.max(vraiCount, fauxCount, honteCount);
    const total = vraiCount + fauxCount + honteCount;
    let verdict, tie = false;
    if (total === 0) { verdict = "faux"; }
    else {
      const leaders = [];
      if (vraiCount === max) leaders.push("vrai");
      if (fauxCount === max) leaders.push("faux");
      if (honteCount === max) leaders.push("honte");
      verdict = leaders.length === 1 ? leaders[0] : "tie";
      tie = verdict === "tie";
    }
    results.push({ clientId: cid, name: ans.name, text: ans.text, verdict, tie, vraiCount, fauxCount, honteCount });
  }

  return results;
}

function applyVerdicts(game, qIdx, results) {
  for (const r of results) {
    if (r.verdict === "singer") continue; // no points for singer

    if (r.verdict === "petit_bac" && r.catResults) {
      let pts = 0, shame = 0;
      const vals = Object.values(r.catResults);
      for (const cv of vals) {
        if (cv.verdict === "vrai") pts++;
        else if (cv.verdict === "honte") { pts--; shame--; }
      }
      const bonus = vals.length >= 5 && vals.filter(cv => cv.verdict === "vrai").length === vals.length;
      if (bonus) pts++;
      if (pts !== 0) game.scores.set(r.name, (game.scores.get(r.name) || 0) + pts);
      if (shame < 0) game.shameScores.set(r.name, (game.shameScores.get(r.name) || 0) + shame);
      r.bonusPetitBac = bonus;
      continue;
    }

    if (r.verdict === "vrai") {
      game.scores.set(r.name, (game.scores.get(r.name) || 0) + 1);
    } else if (r.verdict === "honte") {
      game.scores.set(r.name, (game.scores.get(r.name) || 0) - 1);
      game.shameScores.set(r.name, (game.shameScores.get(r.name) || 0) - 1);
    }
  }
}

module.exports = {
  createGame, activePlayers, publicState, scoreboard, shameBoard,
  calcVerdicts, applyVerdicts,
  QUESTION_TIME_MS, BLIND_TEST_TIME_MS, PETIT_BAC_TIME_MS,
  CHRONOLOGIE_TIME_MS, ANAGRAMME_TIME_MS, ANAGRAMME_HINT_DELAY_MS, GOOGLE_TRAD_TIME_MS, MEME_MYSTERE_TIME_MS,
};
