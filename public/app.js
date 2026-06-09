/* ============================================================
   BUZZ! — Client (WebSocket + lecteur YouTube synchronise)
   ============================================================ */
"use strict";

const COUNTDOWN_MS = 5000;
const $ = (id) => document.getElementById(id);
const show = (id, on) => $(id).classList.toggle("hidden", !on);

/* ---------- Identite / etat ---------- */
let myId = null, myRole = null, myName = "", myRoom = "";
let autoJoinRoom = null;
let state = null;

// lien d'invitation : ?room=CODE -> rejoindre automatiquement
(function () {
  const p = new URLSearchParams(location.search);
  const r = (p.get("room") || "").toUpperCase().trim();
  if (r) autoJoinRoom = r;
})();

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
  if (m.type === "created") { myRole = "admin"; myRoom = m.room; if (m.id) myId = m.id; ytFrameId = null; return; }
  if (m.type === "joined") { myRole = "player"; myRoom = m.room; if (m.id) myId = m.id; return; }
  if (m.type === "join_error") { $("joinErr").style.display = "block"; myRole = null; return; }
  if (m.type === "promoted") { myRole = "admin"; ytFrameId = null; toast("Tu es maintenant l'animateur 🎬"); return; }
  if (m.type === "notice") { toast(m.text); return; }
  if (m.type === "sync") { onSync(m); return; }
  if (m.type === "state") { state = m; onState(); return; }
}

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(text) { const t = $("toast"); t.textContent = text; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600); }

/* ============================================================
   Lecteur YouTube — iframe manuel + postMessage + synchro
   ============================================================ */
let ytFrame = null, ytFrameId = null, lastSyncedPhase = null;
let ytCurrentTime = 0, ytPlayerState = -1, lastSentState = null;
let syncBase = null; // { time, playing, at } recu de l'animateur

function isAdmin() { return myRole === "admin"; }

function buildEmbedSrc(id) {
  const p = new URLSearchParams({
    enablejsapi: "1", rel: "0", modestbranding: "1", playsinline: "1",
    iv_load_policy: "3", mute: "1",
    controls: isAdmin() ? "1" : "0",
    disablekb: isAdmin() ? "0" : "1",
    fs: "1"
  });
  return "https://www.youtube-nocookie.com/embed/" + id + "?" + p.toString();
}
function syncVideo() {
  if (!state || !state.videoId) return;
  const mount = $("player");
  if (!ytFrame || state.videoId !== ytFrameId) {
    mount.innerHTML = "";
    $("stageEmpty").classList.add("hidden");
    ytFrame = document.createElement("iframe");
    ytFrame.id = "ytframe";
    ytFrame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    ytFrame.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
    ytFrame.setAttribute("allowfullscreen", "");
    ytFrame.src = buildEmbedSrc(state.videoId);
    ytFrame.addEventListener("load", () => setTimeout(() => { ytListen(); lastSyncedPhase = null; applyPlayback(true); applyVolume(); }, 700));
    mount.appendChild(ytFrame);
    ytFrameId = state.videoId;
    lastSyncedPhase = null;
  }
}
function ytPost(func, args) { if (ytFrame && ytFrame.contentWindow) ytFrame.contentWindow.postMessage(JSON.stringify({ event: "command", func, args: args || [] }), "*"); }
function ytListen() { if (ytFrame && ytFrame.contentWindow) ytFrame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: "ytframe" }), "*"); }
function ytSeek(sec) { ytPost("seekTo", [Math.max(0, sec), true]); }
function applyPlayback(force) {
  if (!ytFrame) return;
  const playing = state && state.phase === "playing";
  if (force || state.phase !== lastSyncedPhase) { ytPost(playing ? "playVideo" : "pauseVideo"); lastSyncedPhase = state.phase; }
}

/* volume (autorise pour tout le monde) */
let curVol = 0;
function applyVolume() { if (curVol > 0) { ytPost("unMute"); ytPost("setVolume", [curVol]); } else { ytPost("mute"); } }
$("volSlider").addEventListener("input", (e) => {
  curVol = Number(e.target.value) || 0;
  $("volIc").textContent = curVol === 0 ? "🔈" : curVol < 50 ? "🔉" : "🔊";
  applyVolume();
});

/* messages du player : suivi position + erreurs */
window.addEventListener("message", (e) => {
  if (typeof e.data !== "string" || !/youtube/.test(e.origin)) return;
  let d; try { d = JSON.parse(e.data); } catch { return; }
  if (d.event === "infoDelivery" && d.info) {
    if (typeof d.info.currentTime === "number") ytCurrentTime = d.info.currentTime;
    if (typeof d.info.playerState === "number") {
      ytPlayerState = d.info.playerState;
      if (isAdmin()) pushSync(true); // propage tout de suite play/pause de l'animateur
    }
  }
  const code = d.info && d.info.errorCode ? d.info.errorCode : (d.event === "onError" ? d.info : null);
  if (code != null) showVideoError(code);
});
function showVideoError(code) {
  const el = $("stageEmpty");
  const msgs = { 2: "Lien invalide.", 5: "Lecteur HTML5 indisponible.", 100: "Vidéo introuvable ou privée.",
    101: "Cette vidéo interdit la lecture intégrée.", 150: "Cette vidéo interdit la lecture intégrée." };
  el.textContent = "⚠ " + (msgs[code] || ("Erreur lecteur (" + code + ")"));
  el.classList.remove("hidden");
}

/* --- Synchro : l'animateur emet, les autres se calent --- */
function pushSync(onChange) {
  if (!isAdmin() || !state || state.phase !== "playing") return;
  const playing = ytPlayerState === 1;
  if (!onChange && playing === lastSentState && Math.abs(0) === 0) { /* periodique quand meme */ }
  lastSentState = playing;
  sendMsg({ type: "sync", time: ytCurrentTime || 0, playing });
}
setInterval(() => pushSync(false), 900); // animateur : envoi periodique

function onSync(m) { syncBase = { time: m.time, playing: m.playing, at: Date.now() }; }
setInterval(() => { // non-animateur : reconciliation
  if (isAdmin() || !ytFrame || !syncBase || !state || state.phase !== "playing") return;
  const expected = syncBase.time + (syncBase.playing ? (Date.now() - syncBase.at) / 1000 : 0);
  if (Math.abs((ytCurrentTime || 0) - expected) > 1.0) ytSeek(expected);
  if (syncBase.playing && ytPlayerState !== 1) ytPost("playVideo");
  if (!syncBase.playing && ytPlayerState === 1) ytPost("pauseVideo");
}, 700);

/* ============================================================
   Actions UI
   ============================================================ */
$("createBtn").onclick = () => { myRole = "admin"; sendMsg({ type: "create" }); setBadge(); };
$("joinBtn").onclick = () => {
  const code = $("room").value.trim().toUpperCase();
  if (!code) { $("room").focus(); return; }
  $("joinErr").style.display = "none";
  myRole = "player"; sendMsg({ type: "join", room: code }); setBadge();
};
$("room").addEventListener("keydown", (e) => { if (e.key === "Enter") $("joinBtn").click(); });

$("readyBtn").onclick = () => sendMsg({ type: "ready" });
$("specBtn").onclick = () => { const me = meEntry(); sendMsg({ type: "spectator", value: !(me && me.spectator) }); };

// reponse ecrite pendant la fenetre de buzz
let answerTimer = null;
$("answerInput").addEventListener("input", () => {
  clearTimeout(answerTimer);
  answerTimer = setTimeout(() => sendMsg({ type: "answer", text: $("answerInput").value }), 200);
});

// pseudo optionnel (renommage)
function sendRename() { const v = $("nameInput").value.trim(); if (v && v !== myName) sendMsg({ type: "rename", name: v }); }
$("nameInput").addEventListener("change", sendRename);
$("nameInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { sendRename(); $("nameInput").blur(); } });

// copie code / lien
function inviteLink() { return location.origin + location.pathname + "?room=" + myRoom; }
function copyText(txt, btn, label) {
  const done = () => { const o = btn.textContent; btn.textContent = "Copié ✓"; setTimeout(() => (btn.textContent = label || o), 1400); };
  if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done).catch(done); else done();
}
$("copyCode").onclick = (e) => copyText(myRoom, e.target, "Copier le code");
$("copyLink").onclick = (e) => copyText(inviteLink(), e.target, "Copier le lien");

function meEntry() { return state ? state.players.find((p) => p.id === myId) : null; }

function doBuzz() {
  if (!state || (state.phase !== "playing" && state.phase !== "collecting")) return;
  const me = meEntry();
  if (me && me.spectator) return;
  if (state.buzzes && state.buzzes.some((b) => b.id === myId)) return; // deja dans la liste
  $("buzzer").classList.add("pressed"); setTimeout(() => $("buzzer").classList.remove("pressed"), 150);
  sendMsg({ type: "buzz" });
}
$("buzzer").onclick = doBuzz;
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && myRole && document.activeElement.tagName !== "INPUT") {
    e.preventDefault(); if (state && (state.phase === "playing" || state.phase === "collecting")) doBuzz();
  }
});

/* ---------- Modale animateur ---------- */
$("adminFab").onclick = () => { renderAdminModal(); show("adminModal", true); };
$("closeModal").onclick = () => show("adminModal", false);
$("adminModal").addEventListener("click", (e) => { if (e.target.id === "adminModal") show("adminModal", false); });
$("setVideo").onclick = () => { sendMsg({ type: "setVideo", url: $("vurl").value }); };

function adminBtnEl(label, cls, type, disabled) {
  const b = document.createElement("button");
  b.className = "btn " + (cls || "ghost"); b.textContent = label; b.disabled = !!disabled;
  b.onclick = () => sendMsg({ type });
  return b;
}
function renderAdminModal() {
  if (!state) return;
  $("videoState").textContent = state.videoId ? "Vidéo prête ✅" : "Aucune vidéo chargée.";
  const box = $("adminActions"); box.innerHTML = "";
  const ph = state.phase;
  if (ph === "lobby") box.appendChild(adminBtnEl("Lancer la partie", "", "start", !state.videoId));
  if (ph === "playing" || ph === "collecting") box.appendChild(adminBtnEl("🎯 Révélation", "", "reveal", !(state.buzzes && state.buzzes.length)));
  if (ph === "reveal" && !state.revealDecided) box.appendChild(adminBtnEl("Clôturer le vote", "", "closeReveal"));
  if (ph === "reveal" && state.revealDecided) box.appendChild(adminBtnEl("Manche suivante ▶", "", "continue"));
  if (ph !== "lobby") box.appendChild(adminBtnEl("Revenir à la file", "ghost", "resetLobby"));
  box.appendChild(adminBtnEl("Réinitialiser les scores", "ghost", "resetScores"));
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
  setBadge();
  const inGame = ["playing", "collecting", "reveal"].includes(state.phase);
  show("home", myRole === null);
  show("lobby", myRole !== null && !inGame);
  show("game", myRole !== null && inGame);
  show("adminFab", myRole === "admin");
  if (myRole === "admin" && !$("adminModal").classList.contains("hidden")) renderAdminModal();
  if (myRole === null) return;
  if (!inGame) renderLobby(); else renderGame();
}

function renderLobby() {
  $("inviteCode").textContent = myRoom || "----";
  if (document.activeElement !== $("nameInput")) $("nameInput").value = myName;
  const list = $("playerList"); list.innerHTML = "";
  const activeP = state.players.filter((p) => !p.spectator);
  $("totalCount").textContent = activeP.length;
  $("readyCount").textContent = activeP.filter((p) => p.ready).length;
  if (state.players.length === 0) list.innerHTML = '<span class="empty">Personne pour l\'instant…</span>';
  state.players.forEach((p) => {
    const c = document.createElement("span");
    c.className = "chip" + (p.ready && !p.spectator ? " ready" : "") + (p.id === myId ? " me" : "") + (p.isAdmin ? " admin" : "") + (p.spectator ? " spectator" : "");
    const tag = p.isAdmin ? ' <span class="tag">👑</span>' : p.spectator ? ' <span class="tag">👀</span>' : "";
    c.innerHTML = '<span class="status"></span>' + escapeHtml(p.name) + (p.id === myId ? " (toi)" : "") + tag;
    list.appendChild(c);
  });

  show("scoreCard", (state.scores || []).length > 0);
  renderScores($("scoreList"));

  const me = meEntry();
  const spec = me && me.spectator;
  show("readyCard", true);
  show("readyBtn", !spec);
  if (!spec && me) { const r = me.ready; $("readyBtn").textContent = r ? "Annuler — pas prêt" : "Je suis prêt·e ✋"; $("readyBtn").className = "btn" + (r ? " ghost" : ""); }
  $("specBtn").textContent = spec ? "↩ Revenir joueur" : "👀 Passer spectateur";
}

function renderGame() {
  syncVideo();
  applyPlayback(false);

  const s = state;
  const me = meEntry();
  const spec = me && me.spectator;
  const buzzes = s.buzzes || [];
  const iBuzzed = buzzes.some((b) => b.id === myId);

  show("volCtrl", !!s.videoId);
  show("clickBlock", !isAdmin() && !!s.videoId);

  // overlay = compte a rebours pendant la collecte
  if (s.phase === "collecting") {
    show("overlay", true);
    $("overlayWho").textContent = buzzes.length + (buzzes.length > 1 ? " joueurs ont buzzé" : " joueur a buzzé");
    startCountdownLoop();
  } else { show("overlay", false); stopCountdownLoop(); }

  // zones
  const showBuzzer = (s.phase === "playing") || (s.phase === "collecting" && !iBuzzed);
  show("buzzZone", showBuzzer);
  show("answerZone", s.phase === "collecting" && iBuzzed && !spec);
  show("revealZone", s.phase === "reveal");

  // buzzer
  const buzzer = $("buzzer");
  if (showBuzzer) {
    buzzer.textContent = "BUZZ";
    buzzer.disabled = spec;
    $("buzzHint").innerHTML = spec ? "Mode spectateur — tu ne buzzes pas."
      : s.phase === "collecting" ? "Buzze pour répondre toi aussi !"
      : 'Appuie dès que tu connais la réponse — touche <kbd>Espace</kbd>';
  }

  // zone reponse
  if (s.phase === "collecting" && iBuzzed && !spec) {
    if (document.activeElement !== $("answerInput")) { /* ne pas ecraser la frappe */ }
  } else if (s.phase !== "collecting") {
    $("answerInput").value = "";
  }

  // revelation
  if (s.phase === "reveal") renderReveal(s, spec);

  renderScores($("scoreListGame"));
  $("gameNote").textContent = "Manche " + (s.round || 1)
    + (buzzes.length ? " · " + buzzes.length + " buzz" : "");
}

function renderReveal(s, spec) {
  const buzzes = s.buzzes || [];
  const myVote = (s.revealVotes.find((v) => v.voter === myId) || {}).cand;
  const t0 = buzzes.length ? buzzes[0].at : 0;
  const voteCount = {};
  s.revealVotes.forEach((v) => { voteCount[v.cand] = (voteCount[v.cand] || 0) + 1; });

  $("revealTitle").textContent = s.revealDecided
    ? (s.lastWinner ? "🏆 " + s.lastWinner.name + " gagne la manche ! (+1)" : "Manche terminée")
    : "Révélation — votez pour le gagnant";

  const list = $("buzzList"); list.innerHTML = "";
  buzzes.forEach((b, i) => {
    const row = document.createElement("div");
    const isWin = s.revealDecided && s.lastWinner && s.lastWinner.id === b.id;
    row.className = "buzz-row" + (isWin ? " win" : "") + (b.id === myId ? " mine" : "");
    const dt = i === 0 ? "+0 ms" : "+" + (b.at - t0) + " ms";
    const ans = b.answer ? '<div class="ans">' + escapeHtml(b.answer) + "</div>"
      : '<div class="ans empty">(pas de réponse)</div>';
    const vc = voteCount[b.id] ? '<span class="votes">' + voteCount[b.id] + " vote" + (voteCount[b.id] > 1 ? "s" : "") + "</span>" : "";
    const crown = isWin ? ' <span class="crown">🏆</span>' : "";
    const canVote = !s.revealDecided && !spec;
    const btn = canVote
      ? '<button class="vote-btn" data-id="' + b.id + '"' + (myVote === b.id ? " disabled" : "") + '>'
        + (myVote === b.id ? "Voté ✓" : "Voter") + "</button>"
      : "";
    row.innerHTML = '<div class="rk">' + (i + 1) + '</div>'
      + '<div class="info"><div class="who">' + escapeHtml(b.name) + crown
      + ' <span class="dt">' + dt + "</span>" + vc + "</div>" + ans + "</div>" + btn;
    list.appendChild(row);
  });
  list.querySelectorAll(".vote-btn").forEach((btn) => {
    btn.onclick = () => sendMsg({ type: "voteWinner", candidateId: btn.getAttribute("data-id") });
  });

  const note = $("revealNote");
  if (spec) { show("revealNote", true); note.textContent = "Spectateur — tu ne votes pas."; }
  else if (!s.revealDecided && myVote) { show("revealNote", true); note.textContent = "Vote enregistré. En attente des autres…"; }
  else show("revealNote", false);
}

/* ---------- Anneau de compte a rebours (collecte) ---------- */
const CIRC = 2 * Math.PI * 56;
let rafId = null, localEnd = 0, collectActive = false;
function startCountdownLoop() {
  if (!collectActive) { collectActive = true; localEnd = Date.now() + (state.collectRemaining || COUNTDOWN_MS); }
  if (rafId) return; tickCountdown();
}
function stopCountdownLoop() { collectActive = false; if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
function tickCountdown() {
  if (!state || state.phase !== "collecting") { stopCountdownLoop(); return; }
  const remain = Math.max(0, localEnd - Date.now());
  $("ringNum").textContent = Math.ceil(remain / 1000);
  $("ringProg").style.strokeDashoffset = (CIRC * (1 - remain / COUNTDOWN_MS)).toFixed(1);
  $("answerTimer").textContent = "(" + Math.ceil(remain / 1000) + " s)";
  rafId = requestAnimationFrame(tickCountdown);
}

connect();
