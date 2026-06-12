/* ============================================================
   Chaos Culture — Client JS
   ============================================================ */
"use strict";

/* ---------- State ---------- */
let ws = null;
let myId = null;
let myName = null;
let myAvatar = null;
let isAdmin = false;
let currentRoom = null;
let gameState = null;
let timerInterval = null;
let corrTimerInterval = null;
let myAnsweredQ = new Set();      // question indices answered
let myVotes = {};                 // correctionQ → Set of targetClientIds voted

/* ---------- DOM ---------- */
const $ = id => document.getElementById(id);

const screens = {
  lobbyList: $("screenLobbyList"),
  lobby: $("screenLobby"),
  playing: $("screenPlaying"),
  correction: $("screenCorrection"),
  results: $("screenResults"),
};

function showScreen(name) {
  Object.values(screens).forEach(s => { s.classList.remove("active"); s.style.display = "none"; });
  if (screens[name]) { screens[name].classList.add("active"); screens[name].style.display = "block"; }
}

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(msg, ms = 2500) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), ms);
}

/* ---------- Avatar helper ---------- */
function makeAvatarEl(avatar, name, size = 32) {
  if (avatar) {
    const img = document.createElement("img");
    img.src = "/avatars/" + avatar;
    img.alt = name;
    img.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;`;
    return img;
  }
  const div = document.createElement("div");
  div.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#f472b6);display:flex;align-items:center;justify-content:center;font-family:'Fredoka',sans-serif;font-size:${Math.round(size*0.55)}px;font-weight:700;color:#fff;`;
  div.textContent = (name || "?")[0].toUpperCase();
  return div;
}

/* ---------- WS ---------- */
function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(proto + "//" + location.host);

  ws.onopen = () => { ws.send(JSON.stringify({ type: "chaos_listRooms" })); };

  ws.onmessage = ({ data }) => {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (!m.type || !m.type.startsWith("chaos_")) return;
    handle(m);
  };

  ws.onclose = () => {
    setTimeout(connect, 2000);
    toast("Reconnexion…");
  };
}

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

/* ---------- Message handler ---------- */
function handle(m) {
  switch (m.type) {
    case "chaos_welcome":
      myId = m.id;
      myName = m.pseudo;
      myAvatar = m.avatar;
      updateHeaderUser();
      break;

    case "chaos_rooms":
      if (!currentRoom) renderRoomList(m.rooms);
      break;

    case "chaos_created":
    case "chaos_joined":
      currentRoom = m.room;
      isAdmin = m.type === "chaos_created";
      $("lobbyCode").textContent = m.room;
      showScreen("lobby");
      send({ type: "chaos_listRooms" });
      break;

    case "chaos_join_error":
      toast("❌ Salle introuvable");
      break;

    case "chaos_promoted":
      isAdmin = true;
      toast("Tu es maintenant l'hôte !");
      break;

    case "chaos_left":
      currentRoom = null;
      isAdmin = false;
      myAnsweredQ.clear();
      myVotes = {};
      showScreen("lobbyList");
      send({ type: "chaos_listRooms" });
      break;

    case "chaos_state":
      gameState = m;
      renderState(m);
      break;
  }
}

/* ---------- Render state ---------- */
function renderState(s) {
  const phase = s.phase;

  if (phase === "lobby" || phase === "countdown") {
    showScreen("lobby");
    renderLobby(s);
  } else if (phase === "playing") {
    showScreen("playing");
    renderPlaying(s);
  } else if (phase === "correction") {
    showScreen("correction");
    renderCorrection(s);
  } else if (phase === "results" || phase === "ended") {
    showScreen("results");
    renderResults(s);
  }
}

/* ---------- Lobby ---------- */
function renderLobby(s) {
  const countdown = $("countdownBanner");
  if (s.phase === "countdown" && s.lobbyCountdownRemaining > 0) {
    countdown.classList.remove("hidden");
    $("countdownSec").textContent = Math.ceil(s.lobbyCountdownRemaining / 1000);
  } else {
    countdown.classList.add("hidden");
  }

  $("lobbyQInfo").textContent = s.questionCount + " questions";

  const me = s.players.find(p => p.id === myId);
  const readyBtn = $("btnReady");
  if (me) {
    readyBtn.textContent = me.ready ? "✅ Prêt" : "⬜ Pas prêt";
  }

  $("btnForceStart").classList.toggle("hidden", !isAdmin);

  const grid = $("lobbyPlayers");
  grid.innerHTML = "";
  for (const p of s.players) {
    const card = document.createElement("div");
    card.className = "lobby-player" + (p.ready ? " ready" : "");
    const av = document.createElement("div");
    av.className = "p-avatar";
    av.appendChild(makeAvatarEl(p.avatar, p.name, 48));
    card.appendChild(av);
    const nm = document.createElement("div");
    nm.className = "p-name";
    nm.textContent = p.name;
    card.appendChild(nm);
    if (p.isAdmin) {
      const adm = document.createElement("div");
      adm.className = "p-admin";
      adm.textContent = "HÔTE";
      card.appendChild(adm);
    }
    const st = document.createElement("div");
    st.className = "p-status";
    st.textContent = p.ready ? "Prêt ✓" : "En attente…";
    card.appendChild(st);
    grid.appendChild(card);
  }
}

/* ---------- Room list ---------- */
function renderRoomList(rooms) {
  const el = $("roomList");
  el.innerHTML = "";
  const open = rooms ? rooms.filter(r => r.phase === "lobby" || r.phase === "countdown") : [];
  if (!open.length) {
    el.innerHTML = '<div class="empty-rooms">Aucune salle ouverte</div>';
    return;
  }
  for (const r of open) {
    const card = document.createElement("div");
    card.className = "room-card";
    card.innerHTML = `<span class="room-card-code">${r.code}</span><span class="room-card-info">${r.count} joueur(s) · ${r.questionCount}Q</span><span>→</span>`;
    card.addEventListener("click", () => joinRoom(r.code));
    el.appendChild(card);
  }
}

/* ---------- Playing ---------- */
let lastQIdx = -1;

function renderPlaying(s) {
  const qIdx = s.currentQ;
  const q = s.question;
  if (!q) return;

  // Progress bar
  $("qProgressBar").style.width = ((qIdx + 1) / s.totalQ * 100) + "%";
  $("qNum").textContent = "Q" + (qIdx + 1);
  $("qType").textContent = typeLabel(q.type);

  $("qText").textContent = q.question;

  // Reset UI if new question
  if (qIdx !== lastQIdx) {
    lastQIdx = qIdx;
    clearInterval(timerInterval);
    $("qChoices").classList.add("hidden");
    $("qInput").classList.add("hidden");
    $("qVF").classList.add("hidden");
    $("qAnswered").classList.add("hidden");
    $("qChoices").innerHTML = "";
    $("answerInput").value = "";
  }

  // If already answered this question
  if (myAnsweredQ.has(qIdx)) {
    $("qChoices").classList.add("hidden");
    $("qInput").classList.add("hidden");
    $("qVF").classList.add("hidden");
    $("qAnswered").classList.remove("hidden");
    // Count answered
    startQTimer(s.qRemaining);
    return;
  }

  // Show input based on type
  if (q.type === "vrai_faux") {
    $("qVF").classList.remove("hidden");
  } else if (q.type === "culture_gen" && q.choices && q.choices.length) {
    const container = $("qChoices");
    container.classList.remove("hidden");
    if (!container.children.length) {
      for (const c of q.choices) {
        const btn = document.createElement("button");
        btn.className = "choice-answer-btn";
        btn.textContent = c;
        btn.addEventListener("click", () => submitChoice(c, container));
        container.appendChild(btn);
      }
    }
  } else {
    $("qInput").classList.remove("hidden");
    if (qIdx !== lastQIdx - 1) $("answerInput").focus();
  }

  startQTimer(s.qRemaining);
}

function startQTimer(remaining) {
  clearInterval(timerInterval);
  const end = Date.now() + remaining;
  function tick() {
    const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    $("qTimer").textContent = left;
    $("qTimer").classList.toggle("urgent", left <= 5);
    if (left <= 0) clearInterval(timerInterval);
  }
  tick();
  timerInterval = setInterval(tick, 250);
}

function submitAnswer(text) {
  const qIdx = gameState ? gameState.currentQ : -1;
  if (qIdx < 0 || myAnsweredQ.has(qIdx)) return;
  const t = (text || "").trim();
  if (!t) { toast("Tape une réponse !"); return; }
  myAnsweredQ.add(qIdx);
  send({ type: "chaos_answer", text: t });
  $("qChoices").classList.add("hidden");
  $("qInput").classList.add("hidden");
  $("qVF").classList.add("hidden");
  $("qAnswered").classList.remove("hidden");
}

function submitChoice(text, container) {
  for (const b of container.children) { b.disabled = true; b.classList.remove("selected"); }
  event.target.classList.add("selected");
  submitAnswer(text);
}

/* ---------- Correction ---------- */
function renderCorrection(s) {
  const qIdx = s.correctionQ;
  const cq = s.correctionQuestion;
  if (!cq || qIdx < 0) return;

  $("corrQNum").textContent = "Q" + (qIdx + 1) + " / " + s.totalQ;

  // Timer bar
  clearInterval(corrTimerInterval);
  const totalMs = 20000;
  function updateCorrBar() {
    const pct = Math.max(0, s.correctionRemaining / totalMs * 100);
    $("corrTimerBar").style.width = pct + "%";
  }
  updateCorrBar();
  const end = Date.now() + s.correctionRemaining;
  corrTimerInterval = setInterval(() => {
    const left = Math.max(0, end - Date.now());
    $("corrTimerBar").style.width = (left / totalMs * 100) + "%";
    if (left <= 0) clearInterval(corrTimerInterval);
  }, 250);

  // Question display
  const corrQ = $("corrQuestion");
  corrQ.innerHTML = `<div class="corr-q-type">${typeLabel(cq.type)}</div>${escHtml(cq.question)}`;
  if (cq.answer && (cq.type === "vrai_faux" || cq.type === "plus_proche")) {
    const ans = document.createElement("div");
    ans.className = "corr-q-answer";
    ans.textContent = "Réponse : " + cq.answer;
    corrQ.appendChild(ans);
  }

  // Admin bar
  $("corrAdminBar").classList.toggle("hidden", !isAdmin);

  // Results shown?
  const results = s.correctionResults;
  if (results) {
    $("corrResults").classList.remove("hidden");
    renderCorrResults(results);
    $("corrAnswersList").classList.add("hidden");
    return;
  }

  $("corrResults").classList.add("hidden");
  $("corrAnswersList").classList.remove("hidden");

  // Answers list
  if (!s.correctionAnswers) { $("corrAnswersList").innerHTML = ""; return; }

  if (cq.type === "susceptible") {
    renderSusceptibleVote(s, qIdx);
  } else {
    renderAnswerVotes(s, qIdx);
  }
}

function renderAnswerVotes(s, qIdx) {
  const list = $("corrAnswersList");
  list.innerHTML = "";

  if (!s.correctionAnswers || !s.correctionAnswers.length) {
    list.innerHTML = '<div class="empty-rooms">Aucune réponse soumise</div>';
    return;
  }

  const myVotesQ = myVotes[qIdx] || {};
  const votes = s.correctionVotes || {};
  const myVotesMap = votes[myId] || {};

  for (const ans of s.correctionAnswers) {
    const isMe = ans.clientId === myId;
    const card = document.createElement("div");
    card.className = "ans-card";

    const top = document.createElement("div");
    top.className = "ans-card-top";
    const avWrap = document.createElement("div");
    avWrap.className = "ans-avatar";
    avWrap.appendChild(makeAvatarEl(ans.avatar, ans.name, 32));
    top.appendChild(avWrap);
    const nm = document.createElement("span");
    nm.className = "ans-name";
    nm.textContent = ans.name + (isMe ? " (toi)" : "");
    top.appendChild(nm);
    card.appendChild(top);

    const txt = document.createElement("div");
    txt.className = "ans-text" + (ans.text ? "" : " empty-ans");
    txt.textContent = ans.text || "(pas de réponse)";
    card.appendChild(txt);

    if (!isMe) {
      const myV = myVotesMap[ans.clientId];
      const row = document.createElement("div");
      row.className = "vote-row";
      for (const v of ["vrai", "faux", "honte"]) {
        const btn = document.createElement("button");
        btn.className = "vote-btn" + (myV === v ? " voted voted-" + v : "");
        btn.dataset.v = v;
        btn.textContent = v === "vrai" ? "✅ Vrai" : v === "faux" ? "❌ Faux" : "🍅 Honte";
        btn.disabled = !!myV;
        btn.addEventListener("click", () => {
          if (myV) return;
          if (!myVotes[qIdx]) myVotes[qIdx] = {};
          myVotes[qIdx][ans.clientId] = v;
          send({ type: "chaos_vote", targetClientId: ans.clientId, verdict: v });
        });
        row.appendChild(btn);
      }
      card.appendChild(row);
    }
    list.appendChild(card);
  }
}

function renderSusceptibleVote(s, qIdx) {
  const list = $("corrAnswersList");
  list.innerHTML = "";

  const label = document.createElement("div");
  label.style.cssText = "font-size:15px;font-weight:600;margin-bottom:14px;";
  label.textContent = "Vote pour la personne la plus susceptible 👇";
  list.appendChild(label);

  const grid = document.createElement("div");
  grid.className = "susceptible-grid";

  const votes = s.correctionVotes || {};
  const myVotesMap = votes[myId] || {};
  const myVotedTarget = Object.keys(myVotesMap)[0] || null;

  // Tally votes per target to show counts
  const tally = {};
  for (const [, targets] of Object.entries(votes)) {
    for (const tid of Object.keys(targets)) {
      tally[tid] = (tally[tid] || 0) + 1;
    }
  }

  for (const p of s.players) {
    if (p.id === myId) continue; // can't vote for yourself
    const btn = document.createElement("button");
    btn.className = "susceptible-vote-btn" + (myVotedTarget === p.id ? " voted" : "");
    btn.disabled = !!myVotedTarget;

    const av = document.createElement("div");
    av.className = "s-av";
    av.appendChild(makeAvatarEl(p.avatar, p.name, 40));
    btn.appendChild(av);

    const nm = document.createElement("div");
    nm.className = "s-name";
    nm.textContent = p.name;
    btn.appendChild(nm);

    if (tally[p.id]) {
      const vc = document.createElement("div");
      vc.className = "s-votes";
      vc.textContent = tally[p.id] + " vote(s)";
      btn.appendChild(vc);
    }

    btn.addEventListener("click", () => {
      if (myVotedTarget) return;
      send({ type: "chaos_vote", targetClientId: p.id, verdict: "vrai" });
    });
    grid.appendChild(btn);
  }
  list.appendChild(grid);
}

function renderCorrResults(results) {
  const el = $("corrResults");
  el.innerHTML = '<div class="corr-results-title">Résultats</div>';
  for (const r of results) {
    const row = document.createElement("div");
    row.className = "result-row";
    const nm = document.createElement("span");
    nm.className = "result-name";
    nm.textContent = r.name + (r.text ? ` — "${r.text}"` : "");
    row.appendChild(nm);
    const badge = document.createElement("span");
    badge.className = "result-badge verdict-" + r.verdict;
    badge.textContent = r.verdict === "vrai" ? "✅ +1" : r.verdict === "honte" ? "🍅 −1" : "❌ 0";
    row.appendChild(badge);
    el.appendChild(row);
  }
}

/* ---------- Results ---------- */
function renderResults(s) {
  const scores = $("finalScores");
  scores.innerHTML = "";
  const rankEmoji = ["🥇","🥈","🥉"];
  s.scores.forEach((sc, i) => {
    const row = document.createElement("div");
    row.className = "score-row";
    const rank = document.createElement("span");
    rank.className = "score-rank" + (i === 0 ? " gold" : i === 1 ? " silver" : i === 2 ? " bronze" : "");
    rank.textContent = rankEmoji[i] || (i + 1);
    row.appendChild(rank);
    const nm = document.createElement("span");
    nm.className = "score-name";
    nm.textContent = sc.name;
    row.appendChild(nm);
    const pts = document.createElement("span");
    pts.className = "score-pts";
    pts.textContent = sc.pts + " pt" + (sc.pts !== 1 ? "s" : "");
    row.appendChild(pts);
    scores.appendChild(row);
  });

  // Shame board
  const shame = s.shameBoard || [];
  const shameSection = $("shameSection");
  if (shame.length) {
    shameSection.classList.remove("hidden");
    const shameEl = $("shameScores");
    shameEl.innerHTML = "";
    for (const sh of shame) {
      const row = document.createElement("div");
      row.className = "shame-row";
      row.innerHTML = `<span class="shame-name">🍅 ${escHtml(sh.name)}</span><span class="shame-pts">${sh.pts} pt</span>`;
      shameEl.appendChild(row);
    }
  } else {
    shameSection.classList.add("hidden");
  }

  $("resultsAdminBar").classList.toggle("hidden", !isAdmin);
}

/* ---------- Type labels ---------- */
function typeLabel(type) {
  return {
    culture_gen: "Culture générale",
    vrai_faux: "Vrai ou Faux",
    plus_proche: "Le plus proche",
    susceptible: "Qui est le plus susceptible…",
  }[type] || type;
}

/* ---------- Utils ---------- */
function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

/* ---------- Header ---------- */
function updateHeaderUser() {
  if (!myName) return;
  $("headerPseudo").textContent = myName;
  const av = $("headerAvatar");
  if (myAvatar) {
    av.outerHTML = `<img class="avatar-img" id="headerAvatar" src="/avatars/${myAvatar}" alt="${myName}">`;
  } else {
    av.textContent = myName[0].toUpperCase();
  }
}

/* ---------- Events ---------- */
$("btnCreate").addEventListener("click", () => {
  $("modalCreate").classList.remove("hidden");
});
$("btnCreateCancel").addEventListener("click", () => {
  $("modalCreate").classList.add("hidden");
});
$("btnCreateConfirm").addEventListener("click", () => {
  const active = document.querySelector("#qCountChoices .choice-btn.active");
  const qCount = active ? parseInt(active.dataset.val) : 20;
  $("modalCreate").classList.add("hidden");
  send({ type: "chaos_create", questionCount: qCount });
});
$("qCountChoices").addEventListener("click", e => {
  if (!e.target.classList.contains("choice-btn")) return;
  document.querySelectorAll("#qCountChoices .choice-btn").forEach(b => b.classList.remove("active"));
  e.target.classList.add("active");
});

$("btnJoin").addEventListener("click", () => joinRoom($("joinCode").value));
$("joinCode").addEventListener("keydown", e => { if (e.key === "Enter") joinRoom($("joinCode").value); });

function joinRoom(code) {
  code = (code || "").toUpperCase().trim();
  if (code.length !== 4) { toast("Code à 4 caractères"); return; }
  send({ type: "chaos_join", room: code });
}

$("btnReady").addEventListener("click", () => send({ type: "chaos_ready" }));
$("btnForceStart").addEventListener("click", () => send({ type: "chaos_start" }));

$("btnAnswer").addEventListener("click", () => submitAnswer($("answerInput").value));
$("answerInput").addEventListener("keydown", e => { if (e.key === "Enter") submitAnswer($("answerInput").value); });

$("qVF").addEventListener("click", e => {
  const btn = e.target.closest(".vf-btn");
  if (!btn) return;
  submitAnswer(btn.dataset.val);
  $("qVF").querySelectorAll(".vf-btn").forEach(b => b.disabled = true);
});

$("btnNextCorr").addEventListener("click", () => send({ type: "chaos_next_correction" }));
$("btnPlayAgain").addEventListener("click", () => send({ type: "chaos_resetlobby" }));

/* ---------- Boot ---------- */
// Check auth
fetch("/api/auth/me").then(r => r.json()).then(({ user }) => {
  if (!user) { location.href = "/auth.html"; return; }
  myName = user.pseudo;
  myAvatar = user.avatar || null;
  updateHeaderUser();
  connect();
  showScreen("lobbyList");
});
