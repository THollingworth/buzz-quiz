/* ============================================================
   BlindZik — Client (WebSocket + lecteur video local)
   ============================================================ */
"use strict";

const COLLECT_MS = 5000;
const $ = (id) => document.getElementById(id);
const show = (id, on) => $(id).classList.toggle("hidden", !on);

/* ---------- Identite / etat ---------- */
let myId = null, myRole = null, myName = "", myRoom = "";
let autoJoinRoom = null, lastRoundSeen = -1;
let buzzerMode = !!(window.matchMedia && window.matchMedia("(max-width:760px)").matches);
let pseudoSet = false;
let activeRooms = [];
let state = null;

(function () { const r = (new URLSearchParams(location.search).get("room") || "").toUpperCase().trim(); if (r) autoJoinRoom = r; })();

/* ---------- WebSocket ---------- */
let ws = null, reconnectTimer = null;
function wsURL() { return (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host; }
function connect() {
  ws = new WebSocket(wsURL());
  ws.addEventListener("open", () => {
    setBadge();
    if (myRoom && myRole) sendMsg({ type: "rejoin", room: myRoom, name: myName, wasAdmin: myRole === "admin" });
    else if (autoJoinRoom) { const r = autoJoinRoom; autoJoinRoom = null; myRole = "player"; sendMsg({ type: "join", room: r }); }
  });
  ws.addEventListener("message", (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } handleServer(m); });
  ws.addEventListener("close", () => { setBadge("Reconnexion…"); clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 1500); });
  ws.addEventListener("error", () => ws.close());
}
function sendMsg(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

function handleServer(m) {
  if (m.type === "welcome") { myId = m.id; return; }
  if (m.type === "created") { myRole = "admin"; myRoom = m.room; if (m.id) myId = m.id; return; }
  if (m.type === "joined") { myRole = "player"; myRoom = m.room; if (m.id) myId = m.id; return; }
  if (m.type === "join_error") { $("joinErr").style.display = "block"; myRole = null; return; }
  if (m.type === "promoted") { myRole = "admin"; applyVideoControls(); toast("Tu es maintenant l'animateur 🎬"); return; }
  if (m.type === "left") { resetToHome(); return; }
  if (m.type === "vsync") { onVsync(m); return; }
  if (m.type === "rooms") { activeRooms = m.rooms || []; renderRooms(); return; }
  if (m.type === "notice") { toast(m.text); return; }
  if (m.type === "state") { state = m; onState(); return; }
}

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(text) { const t = $("toast"); t.textContent = text; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600); }

function isAdmin() { return myRole === "admin"; }

/* ============================================================
   Lecteur video local (fichier .mp4)
   ============================================================ */
const videoEl = $("video");
let hasVideo = false, curVol = 0, lastAppliedPhase = null;
let localFileChosen = false, loadedVideoName = null, videoListLoaded = false;

// fichier local : n'affecte que cet ecran
$("pickVideo").onclick = () => $("videoFile").click();
$("videoFile").addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  if (videoEl.src && localFileChosen) { try { URL.revokeObjectURL(videoEl.src); } catch (_) {} }
  localFileChosen = true; loadedVideoName = null;
  videoEl.src = URL.createObjectURL(f);
  videoEl.load(); hasVideo = true;
  $("stageEmpty").classList.add("hidden");
  applyVideoControls(); applyVolume(); lastAppliedPhase = null; applyPlayback(true);
});

// video du dossier serveur : partagee a tous les joueurs
function loadServerVideo(name) {
  if (!name) return;
  localFileChosen = false; loadedVideoName = name;
  videoEl.src = "videos/" + encodeURIComponent(name);
  videoEl.load(); hasVideo = true;
  $("stageEmpty").classList.add("hidden");
  applyVideoControls(); applyVolume(); lastAppliedPhase = null; applyPlayback(true);
}
function unloadVideo() {
  try { if (localFileChosen && videoEl.src) URL.revokeObjectURL(videoEl.src); } catch (_) {}
  try { videoEl.pause(); videoEl.removeAttribute("src"); videoEl.load(); } catch (_) {}
  hasVideo = false; loadedVideoName = null; localFileChosen = false; lastAppliedPhase = null;
}
function maybeLoadStateVideo() {
  if (buzzerMode) return; // mode telephone : pas de video
  if (!state) return;
  if (!state.video) { if (hasVideo && !localFileChosen) unloadVideo(); return; }
  if (localFileChosen) return;
  if (loadedVideoName !== state.video) loadServerVideo(state.video);
}
async function loadVideoList() {
  try {
    const r = await fetch("api/videos"); const d = await r.json();
    const sel = $("vselect");
    sel.innerHTML = '<option value="">— Choisir une vidéo —</option>';
    (d.videos || []).forEach((v) => { const o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); });
    if (state && state.video) sel.value = state.video;
  } catch (_) {}
}
$("vselectGo").onclick = () => { const name = $("vselect").value; if (name) { localFileChosen = false; sendMsg({ type: "setVideoFile", name }); } };
$("vrefresh").onclick = () => loadVideoList();
$("clearVideo").onclick = () => { unloadVideo(); sendMsg({ type: "clearVideo" }); };

function applyVideoControls() { videoEl.controls = isAdmin(); }
function applyPlayback(force) {
  if (!hasVideo || !state) return;
  if (!force && state.phase === lastAppliedPhase) return;
  if (state.phase === "playing") videoEl.play().catch(() => {}); else videoEl.pause();
  lastAppliedPhase = state.phase;
}
function applyVolume() { videoEl.volume = Math.min(1, curVol / 100); videoEl.muted = curVol === 0; }
$("volSlider").addEventListener("input", (e) => {
  curVol = Number(e.target.value) || 0;
  $("volIc").textContent = curVol === 0 ? "🔈" : curVol < 50 ? "🔉" : "🔊";
  applyVolume();
});

/* ---- Synchro vidéo : l'animateur est le maître ---- */
let vsyncBase = null;
function sendVsync() {
  if (!isAdmin() || !hasVideo) return;
  sendMsg({ type: "vsync", time: videoEl.currentTime || 0, playing: !videoEl.paused });
}
["play", "pause", "seeked", "ratechange"].forEach((ev) =>
  videoEl.addEventListener(ev, () => { if (isAdmin()) sendVsync(); }));
setInterval(() => { if (isAdmin() && hasVideo && state && state.phase === "playing") sendVsync(); }, 1000);

function onVsync(m) { vsyncBase = { time: m.time || 0, playing: !!m.playing, at: Date.now() }; }
setInterval(() => {
  if (isAdmin() || buzzerMode || !hasVideo || !vsyncBase || !state || state.phase !== "playing") return;
  const expected = vsyncBase.time + (vsyncBase.playing ? (Date.now() - vsyncBase.at) / 1000 : 0);
  if (Math.abs((videoEl.currentTime || 0) - expected) > 0.5) { try { videoEl.currentTime = expected; } catch (_) {} }
  if (vsyncBase.playing && videoEl.paused) videoEl.play().catch(() => {});
  if (!vsyncBase.playing && !videoEl.paused) videoEl.pause();
}, 700);

/* ============================================================
   Actions
   ============================================================ */
$("createBtn").onclick = () => { myRole = "admin"; sendMsg({ type: "create" }); setBadge(); };
$("joinBtn").onclick = () => {
  const code = $("room").value.trim().toUpperCase();
  if (!code) { $("room").focus(); return; }
  $("joinErr").style.display = "none";
  myRole = "player"; sendMsg({ type: "join", room: code }); setBadge();
};
$("room").addEventListener("keydown", (e) => { if (e.key === "Enter") $("joinBtn").click(); });

function joinRoom(code) { $("joinErr").style.display = "none"; myRole = "player"; sendMsg({ type: "join", room: code }); setBadge(); }
function renderRooms() {
  if (myRole !== null) { show("roomsCard", false); return; }
  show("roomsCard", activeRooms.length > 0);
  const list = $("roomsList"); list.innerHTML = "";
  activeRooms.forEach((r) => {
    const row = document.createElement("button");
    row.className = "room-row";
    const status = r.phase === "lobby" ? "en attente" : r.phase === "ended" ? "terminée" : "en jeu";
    row.innerHTML = '<span class="rl">' + escapeHtml(r.label) + '</span><span class="rc">' + r.count + " joueur" + (r.count > 1 ? "s" : "") + '</span><span class="rs">' + status + "</span>";
    row.onclick = () => joinRoom(r.code);
    list.appendChild(row);
  });
}

$("startBtn").onclick = () => sendMsg({ type: "start" });
$("readyBtn").onclick = () => { sendRename(); if ($("nameInput").value.trim()) sendMsg({ type: "ready" }); };
$("specBtn").onclick = () => { const me = meEntry(); sendMsg({ type: "spectator", value: !(me && me.spectator) }); };
$("endToLobby").onclick = () => sendMsg({ type: "resetLobby" });

$("quitBtn").onclick = () => { sendMsg({ type: "leave" }); resetToHome(); };

function applyMode() {
  document.body.classList.toggle("buzzer-mode", buzzerMode);
  $("modeToggle").textContent = buzzerMode ? "🖥 Mode complet" : "📱 Mode buzzer";
}
$("modeToggle").onclick = () => {
  buzzerMode = !buzzerMode;
  if (buzzerMode) { try { videoEl.pause(); } catch (_) {} }
  applyMode();
  if (state && myRole) onState();
};
applyMode();
function resetToHome() {
  myRole = null; myRoom = ""; state = null; lastRoundSeen = -1;
  videoListLoaded = false; localFileChosen = false; loadedVideoName = null; hasVideo = false;
  try { videoEl.pause(); videoEl.removeAttribute("src"); videoEl.load(); } catch (_) {}
  show("home", true); show("lobby", false); show("game", false); show("endScreen", false);
  show("quitBtn", false); show("adminFab", false); show("adminModal", false); show("modeToggle", false);
  setBadge();
  sendMsg({ type: "listRooms" });
  renderRooms();
}

let answerTimer = null;
$("answerInput").addEventListener("input", () => {
  clearTimeout(answerTimer);
  answerTimer = setTimeout(() => sendMsg({ type: "answer", text: $("answerInput").value }), 200);
});

function meEntry() { return state ? state.players.find((p) => p.id === myId) : null; }
function doBuzz() {
  if (!state || (state.phase !== "playing" && state.phase !== "collecting")) return;
  const me = meEntry();
  if (me && me.spectator) return;
  if (state.buzzes && state.buzzes.some((b) => b.id === myId)) return;
  $("buzzer").classList.add("pressed"); setTimeout(() => $("buzzer").classList.remove("pressed"), 150);
  sendMsg({ type: "buzz" });
  // focus immediat dans la case reponse (dans le geste -> ouvre le clavier mobile, pas de temps perdu)
  const ai = $("answerInput"); ai.value = ""; show("answerZone", true); ai.focus();
}
$("buzzer").onclick = doBuzz;
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && myRole && document.activeElement.tagName !== "INPUT") {
    e.preventDefault(); if (state && (state.phase === "playing" || state.phase === "collecting")) doBuzz();
  }
});

/* pseudo + invitation */
function sendRename() {
  const v = $("nameInput").value.trim();
  if (!v) return;
  pseudoSet = true;
  if (v !== myName) sendMsg({ type: "rename", name: v });
  updateReadyGate();
}
function updateReadyGate() {
  const has = $("nameInput").value.trim().length > 0;
  const me = meEntry(); const spec = me && me.spectator;
  $("readyBtn").disabled = !has || !!spec;
  show("pseudoHint", !has);
}
$("nameInput").addEventListener("input", updateReadyGate);
$("nameInput").addEventListener("change", sendRename);
$("nameInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { sendRename(); $("nameInput").blur(); } });
function inviteLink() { return location.origin + location.pathname + "?room=" + myRoom; }
function copyText(txt, btn, label) {
  const done = () => { btn.textContent = "Copié ✓"; setTimeout(() => (btn.textContent = label), 1400); };
  if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done).catch(done); else done();
}
$("copyCode").onclick = (e) => copyText(myRoom, e.target, "Copier");
$("copyLink").onclick = (e) => copyText(inviteLink(), e.target, "Lien");

/* ---------- Modale (options animateur) ---------- */
$("adminFab").onclick = () => { renderAdminModal(); show("adminModal", true); };
$("closeModal").onclick = () => show("adminModal", false);
$("adminModal").addEventListener("click", (e) => { if (e.target.id === "adminModal") show("adminModal", false); });
function adminBtnEl(label, cls, type) {
  const b = document.createElement("button");
  b.className = "btn " + (cls || "ghost"); b.textContent = label;
  b.onclick = () => { sendMsg({ type }); show("adminModal", false); };
  return b;
}
function renderAdminModal() {
  const box = $("adminActions"); box.innerHTML = "";
  box.appendChild(adminBtnEl("🏁 Fin de partie", "", "endGame"));
  box.appendChild(adminBtnEl("Réinitialiser les scores", "ghost", "resetScores"));
  box.appendChild(adminBtnEl("Revenir à la file d'attente", "ghost", "resetLobby"));
}
function mainBtn(bar, label, type, disabled, cls) {
  const b = document.createElement("button");
  b.className = "btn " + (cls || "primary"); b.textContent = label; b.disabled = !!disabled;
  b.onclick = () => sendMsg({ type });
  bar.appendChild(b);
}

/* ============================================================
   Rendu
   ============================================================ */
function setBadge(txt) {
  const conn = txt || "En ligne";
  $("badge").textContent = myRole === "admin" ? (myName + " · animateur · " + conn)
    : myRole === "player" ? (myName + " · " + conn) : conn;
}
function escapeHtml(t) { return (t || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function renderScores(el) {
  if (!el) return;
  const s = (state && state.scores) || [];
  el.innerHTML = "";
  if (s.length === 0) { el.innerHTML = '<span class="empty">Pas encore de points.</span>'; return; }
  s.forEach((row, i) => {
    const d = document.createElement("div");
    d.className = "score-row" + (row.name === myName ? " me" : "");
    d.innerHTML = '<span class="rank">' + (i + 1) + '</span><span class="nm">' + escapeHtml(row.name) + '</span><span class="pts">' + row.points + "</span>";
    el.appendChild(d);
  });
}

function onState() {
  const me0 = meEntry(); if (me0) myName = me0.name;
  if (state.round !== lastRoundSeen) { lastRoundSeen = state.round; $("answerInput").value = ""; }
  setBadge();
  const ph = state.phase;
  const inGame = ["playing", "collecting", "reveal"].includes(ph);
  const ended = ph === "ended";
  if (ph === "lobby" && hasVideo) unloadVideo();
  if (ph !== "lobby") stopLobbyCd();
  show("home", myRole === null);
  show("lobby", myRole !== null && !inGame && !ended);
  show("game", myRole !== null && inGame);
  show("endScreen", myRole !== null && ended);
  show("quitBtn", myRole !== null);
  show("modeToggle", myRole !== null);
  show("adminFab", myRole === "admin");
  if (myRole === "admin" && !$("adminModal").classList.contains("hidden")) renderAdminModal();
  if (myRole === null) return;
  if (ended) renderEnd();
  else if (!inGame) renderLobby();
  else renderGame();
}

function renderLobby() {
  $("inviteCode").textContent = myRoom || "----";
  if (document.activeElement !== $("nameInput") && (isAdmin() || pseudoSet)) $("nameInput").value = myName;
  show("adminLaunch", isAdmin());
  show("readyCard", !isAdmin());

  if (state.lobbyCountdownRemaining > 0) { show("lobbyCountdown", true); if (!lobbyCdTimer) startLobbyCd(state.lobbyCountdownRemaining); }
  else { show("lobbyCountdown", false); stopLobbyCd(); }

  const list = $("playerList"); list.innerHTML = "";
  const activeP = state.players.filter((p) => !p.spectator);
  $("totalCount").textContent = activeP.length;
  $("readyCount").textContent = activeP.filter((p) => p.ready).length;
  if (state.players.length === 0) list.innerHTML = '<span class="empty">Personne pour l\'instant…</span>';
  state.players.forEach((p) => {
    const row = document.createElement("div");
    row.className = "prow" + (p.id === myId ? " me" : "");
    const ok = p.ready && !p.spectator ? " ok" : "";
    const tag = p.isAdmin ? '<span class="ptag">👑 animateur</span>' : p.spectator ? '<span class="ptag">👀 spectateur</span>' : "";
    row.innerHTML = '<span class="pdot' + ok + '"></span><span class="pnm">' + escapeHtml(p.name) + (p.id === myId ? " (toi)" : "") + "</span>" + tag;
    list.appendChild(row);
  });

  const me = meEntry(); const spec = me && me.spectator;
  show("readyBtn", !spec);
  if (!spec && me) { const r = me.ready; $("readyBtn").textContent = r ? "Annuler — pas prêt" : "Je suis prêt·e ✋"; $("readyBtn").className = "btn" + (r ? " ghost" : ""); }
  $("specBtn").textContent = spec ? "↩ Revenir joueur" : "👀 Passer spectateur";
  updateReadyGate();
}

function renderGame() {
  maybeLoadStateVideo();
  applyPlayback(false);
  applyVideoControls();

  const s = state;
  const me = meEntry();
  const spec = me && me.spectator;
  const buzzes = s.buzzes || [];
  const iBuzzed = buzzes.some((b) => b.id === myId);
  const inPlay = s.phase === "playing" || s.phase === "collecting";

  // selecteur video (animateur)
  show("videoBar", isAdmin());
  if (isAdmin() && !videoListLoaded) { videoListLoaded = true; loadVideoList(); }

  show("stageEmpty", !hasVideo);
  $("stageMsg").textContent = isAdmin() ? "Choisis une vidéo ci-dessous ⬇" : "En attente de la vidéo de l'animateur…";
  show("volCtrl", hasVideo);
  show("clickBlock", hasVideo && !isAdmin());

  // compte a rebours
  if (s.phase === "collecting") {
    show("overlay", true);
    $("overlayWho").textContent = buzzes.length + (buzzes.length > 1 ? " joueurs ont buzzé" : " joueur a buzzé");
    startCountdownLoop();
  } else { show("overlay", false); stopCountdownLoop(); }

  // barre animateur (ecran principal)
  const bar = $("adminMain");
  if (isAdmin()) {
    bar.classList.remove("hidden"); bar.innerHTML = "";
    if (inPlay) mainBtn(bar, "🎯 Révélation", "reveal", !buzzes.length);
    else if (s.phase === "reveal" && !s.revealDecided) {
      mainBtn(bar, "Clôturer le vote", "closeReveal");
      mainBtn(bar, "Aucune bonne réponse", "noWinner", false, "ghost");
    } else if (s.phase === "reveal" && s.revealDecided) mainBtn(bar, "Manche suivante ▶", "continue");
  } else bar.classList.add("hidden");

  // buzzer : reste visible, fonce et inactif une fois qu'on a buzze
  show("buzzZone", inPlay);
  show("buzzTimer", buzzerMode && s.phase === "collecting");
  const buzzer = $("buzzer");
  if (inPlay) {
    buzzer.disabled = spec || iBuzzed;
    buzzer.textContent = iBuzzed ? "BUZZÉ ✓" : "BUZZ";
    $("buzzHint").innerHTML = spec ? "Mode spectateur — tu ne buzzes pas."
      : iBuzzed ? "Ton buzz est enregistré — rebuzz possible à la manche suivante."
      : s.phase === "collecting" ? "Buzze pour répondre toi aussi !"
      : 'Appuie dès que tu connais la réponse — touche <kbd>Espace</kbd>';
  }

  // zone reponse (ne se reinitialise plus quand d'autres buzzent)
  show("answerZone", s.phase === "collecting" && iBuzzed && !spec);

  // revelation
  show("revealZone", s.phase === "reveal");
  if (s.phase === "reveal") renderReveal(s, spec);

  renderScores($("scoreListGame"));
  $("gameNote").textContent = "Manche " + (s.round || 1) + (buzzes.length ? " · " + buzzes.length + " buzz" : "");
}

function renderReveal(s, spec) {
  const buzzes = s.buzzes || [];
  const myVote = (s.revealVotes.find((v) => v.voter === myId) || {}).cand;
  const t0 = buzzes.length ? buzzes[0].at : 0;
  const voteCount = {};
  s.revealVotes.forEach((v) => { voteCount[v.cand] = (voteCount[v.cand] || 0) + 1; });

  let decidedMsg = "Manche terminée — pas de point";
  if (s.lastWinner) decidedMsg = "🏆 " + s.lastWinner.name + " gagne la manche ! (+1)";
  else if (s.revealOutcome === "tie") decidedMsg = "⚖️ Égalité — point annulé";
  else if (s.revealOutcome === "nogood") decidedMsg = "Aucune bonne réponse — pas de point";
  $("revealTitle").textContent = s.revealDecided ? decidedMsg : "Révélation — votez pour le gagnant";

  const list = $("buzzList"); list.innerHTML = "";
  buzzes.forEach((b, i) => {
    const row = document.createElement("div");
    const isWin = s.revealDecided && s.lastWinner && s.lastWinner.id === b.id;
    row.className = "buzz-row" + (isWin ? " win" : "") + (b.id === myId ? " mine" : "");
    const dt = i === 0 ? "+0 ms" : "+" + (b.at - t0) + " ms";
    const ans = b.answer ? '<div class="ans">' + escapeHtml(b.answer) + "</div>" : '<div class="ans empty">(pas de réponse)</div>';
    const vc = voteCount[b.id] ? '<span class="votes">' + voteCount[b.id] + " vote" + (voteCount[b.id] > 1 ? "s" : "") + "</span>" : "";
    const crown = isWin ? ' <span class="crown">🏆</span>' : "";
    const canVote = !s.revealDecided && !spec;
    const btn = canVote ? '<button class="vote-btn" data-id="' + b.id + '"' + (myVote === b.id ? " disabled" : "") + ">" + (myVote === b.id ? "Voté ✓" : "Voter") + "</button>" : "";
    row.innerHTML = '<div class="rk">' + (i + 1) + '</div><div class="info"><div class="who">' + escapeHtml(b.name) + crown + ' <span class="dt">' + dt + "</span>" + vc + "</div>" + ans + "</div>" + btn;
    list.appendChild(row);
  });
  list.querySelectorAll(".vote-btn").forEach((btn) => { btn.onclick = () => sendMsg({ type: "voteWinner", candidateId: btn.getAttribute("data-id") }); });

  const note = $("revealNote");
  if (spec) { show("revealNote", true); note.textContent = "Spectateur — tu ne votes pas."; }
  else if (!s.revealDecided && myVote) { show("revealNote", true); note.textContent = "Vote enregistré. En attente des autres…"; }
  else show("revealNote", false);
}

function renderEnd() {
  show("endAdmin", isAdmin());
  const board = $("endBoard"); board.innerHTML = "";
  const sc = state.scores || [];
  if (sc.length === 0) { board.innerHTML = '<span class="empty">Aucun joueur.</span>'; return; }
  sc.forEach((row, i) => {
    const last = i === sc.length - 1 && sc.length > 1;
    const d = document.createElement("div");
    d.className = "score-row" + (row.name === myName ? " me" : "") + (last ? " loser-row" : "");
    const medal = i === 0 ? "🏆" : i === 1 ? "🥈" : i === 2 ? "🥉" : "";
    const loser = last ? ' <span class="loser">gros looser 💩</span>' : "";
    d.innerHTML = '<span class="rank">' + (i + 1) + '</span><span class="medal">' + medal + '</span><span class="nm">' + escapeHtml(row.name) + loser + '</span><span class="pts">' + row.points + "</span>";
    board.appendChild(d);
  });
}

/* ---------- Anneau de compte a rebours ---------- */
const CIRC = 2 * Math.PI * 56;
let rafId = null, localEnd = 0, collectActive = false;
function startCountdownLoop() {
  if (!collectActive) { collectActive = true; localEnd = Date.now() + (state.collectRemaining || COLLECT_MS); }
  if (rafId) return; tickCountdown();
}
function stopCountdownLoop() { collectActive = false; if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
function tickCountdown() {
  if (!state || state.phase !== "collecting") { stopCountdownLoop(); return; }
  const remain = Math.max(0, localEnd - Date.now());
  $("ringNum").textContent = Math.ceil(remain / 1000);
  $("answerTimer").textContent = "(" + Math.ceil(remain / 1000) + " s)";
  $("buzzTimer").textContent = "Plus que " + Math.ceil(remain / 1000) + " s";
  $("ringProg").style.strokeDashoffset = (CIRC * (1 - remain / COLLECT_MS)).toFixed(1);
  rafId = requestAnimationFrame(tickCountdown);
}

let lobbyCdEnd = 0, lobbyCdTimer = null;
function startLobbyCd(remaining) {
  lobbyCdEnd = Date.now() + remaining;
  if (lobbyCdTimer) return;
  lobbyCdTimer = setInterval(() => {
    const r = Math.max(0, lobbyCdEnd - Date.now());
    $("lobbyCdNum").textContent = Math.ceil(r / 1000);
    if (r <= 0) { clearInterval(lobbyCdTimer); lobbyCdTimer = null; }
  }, 200);
}
function stopLobbyCd() { if (lobbyCdTimer) { clearInterval(lobbyCdTimer); lobbyCdTimer = null; } }

connect();
