/* ============================================================
   BUZZ! — Client (WebSocket + lecteur YouTube synchronise)
   ============================================================ */
"use strict";

const COUNTDOWN_MS = 5000;
const $ = (id) => document.getElementById(id);
const show = (id, on) => $(id).classList.toggle("hidden", !on);

/* ---------- Identite / etat ---------- */
let myId = null, myRole = null, myName = "", myRoom = "";
let pendingAdminPwd = null;
let state = null;

/* ---------- WebSocket ---------- */
let ws = null, reconnectTimer = null;
function wsURL() { return (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host; }
function connect() {
  ws = new WebSocket(wsURL());
  ws.addEventListener("open", () => {
    setBadge();
    if (myRole === "admin" && pendingAdminPwd) sendMsg({ type: "admin", room: myRoom, name: myName, password: pendingAdminPwd });
    else if (myRole === "player") sendMsg({ type: "join", room: myRoom, name: myName });
  });
  ws.addEventListener("message", (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } handleServer(m); });
  ws.addEventListener("close", () => { setBadge("Reconnexion…"); clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 1500); });
  ws.addEventListener("error", () => ws.close());
}
function sendMsg(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

function handleServer(m) {
  if (m.type === "welcome") { myId = m.id; return; }
  if (m.type === "admin_result") {
    if (m.ok) { myRole = "admin"; if (m.id) myId = m.id; $("adminErr").style.display = "none"; }
    else { $("adminErr").style.display = "block"; pendingAdminPwd = null; }
    return;
  }
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
$("joinBtn").onclick = () => {
  const name = $("pseudo").value.trim();
  if (!name) { $("pseudo").focus(); return; }
  myName = name; myRole = "player"; myRoom = $("room").value.trim().toUpperCase() || "PARTY";
  sendMsg({ type: "join", room: myRoom, name: myName }); setBadge();
};
$("adminBtn").onclick = () => {
  const name = $("pseudo").value.trim();
  if (!name) { $("pseudo").focus(); toast("Choisis d'abord un pseudo en haut."); return; }
  const pwd = $("adminPwd").value; if (!pwd) return;
  myName = name; myRoom = $("room").value.trim().toUpperCase() || "PARTY"; pendingAdminPwd = pwd;
  sendMsg({ type: "admin", room: myRoom, name: myName, password: pwd });
};
$("adminPwd").addEventListener("keydown", (e) => { if (e.key === "Enter") $("adminBtn").click(); });
$("pseudo").addEventListener("keydown", (e) => { if (e.key === "Enter") $("joinBtn").click(); });

$("readyBtn").onclick = () => sendMsg({ type: "ready" });
$("specBtn").onclick = () => { const me = meEntry(); sendMsg({ type: "spectator", value: !(me && me.spectator) }); };
$("voteGo").onclick = () => sendMsg({ type: "vote", value: "go" });
$("voteNo").onclick = () => sendMsg({ type: "vote", value: "no" });

function meEntry() { return state ? state.players.find((p) => p.id === myId) : null; }

function doBuzz() {
  if (!state || state.phase !== "playing") return;
  const me = meEntry();
  if (me && me.spectator) return;
  if (state.lastBuzzerName && myName === state.lastBuzzerName) { toast("Attends qu'un autre joueur buzze."); return; }
  $("buzzer").classList.add("pressed"); setTimeout(() => $("buzzer").classList.remove("pressed"), 150);
  sendMsg({ type: "buzz" });
}
$("buzzer").onclick = doBuzz;
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && myRole && document.activeElement.tagName !== "INPUT") {
    e.preventDefault(); if (state && state.phase === "playing") doBuzz();
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
  if (ph === "voting") box.appendChild(adminBtnEl("Clôturer le vote", "", "closeVote"));
  if (ph === "result") box.appendChild(adminBtnEl("Reprendre maintenant ▶", "", "continue"));
  if (ph !== "lobby") box.appendChild(adminBtnEl("Revenir à la file d'attente", "ghost", "resetLobby"));
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
  setBadge();
  const inGame = ["playing", "buzzed", "voting", "result"].includes(state.phase);
  show("home", myRole === null);
  show("lobby", myRole !== null && !inGame);
  show("game", myRole !== null && inGame);
  show("adminFab", myRole === "admin");
  if (myRole === "admin" && !$("adminModal").classList.contains("hidden")) renderAdminModal();
  if (myRole === null) return;
  if (!inGame) renderLobby(); else renderGame();
}

function renderLobby() {
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
  const isBuzzer = s.buzz && s.buzz.id === myId;

  show("volCtrl", !!s.videoId);
  show("clickBlock", !isAdmin() && !!s.videoId);

  if (s.phase === "buzzed") { show("overlay", true); $("overlayWho").textContent = (s.buzz ? s.buzz.name : "") + " a buzzé !"; startCountdownLoop(); }
  else { show("overlay", false); stopCountdownLoop(); }

  show("buzzZone", s.phase === "playing" || s.phase === "buzzed");
  show("voteZone", s.phase === "voting");
  show("resultZone", s.phase === "result");

  const buzzer = $("buzzer");
  const lockedDouble = s.lastBuzzerName && myName === s.lastBuzzerName;
  if (s.phase === "playing") {
    buzzer.textContent = "BUZZ";
    buzzer.disabled = spec || lockedDouble;
    $("buzzHint").innerHTML = spec ? "Mode spectateur — tu ne buzzes pas."
      : lockedDouble ? "Tu viens de buzzer : attends qu'un autre joueur buzze."
      : 'Appuie dès que tu connais la réponse — touche <kbd>Espace</kbd>';
  } else if (s.phase === "buzzed") {
    buzzer.disabled = true; buzzer.textContent = "…";
    $("buzzHint").textContent = isBuzzer ? "À toi ! Donne ta réponse à l'oral 🎤" : (s.buzz ? s.buzz.name : "Quelqu'un") + " répond…";
  }

  if (s.phase === "voting") {
    $("voteResp").textContent = (s.buzz ? s.buzz.name : "") + " a donné sa réponse à l'oral.";
    const voted = s.votes.some((v) => v.id === myId);
    const canVote = !isBuzzer && !spec;
    $("voteGo").disabled = !canVote || voted;
    $("voteNo").disabled = !canVote || voted;
    show("votedNote", isBuzzer || spec || voted);
    $("votedNote").textContent = spec ? "Spectateur — tu ne votes pas." : isBuzzer ? "Tu as buzzé — les autres votent pour toi." : "Vote enregistré. En attente des autres…";
  }

  if (s.phase === "result") {
    const r = s.lastResult || { go: 0, no: 0, correct: false, name: null };
    $("tGo").textContent = r.go; $("tNo").textContent = r.no;
    const v = $("verdict");
    if (r.correct) { v.textContent = "Bonne réponse ! +1 pour " + (r.name || "le buzzer") + " 🎉"; v.className = "verdict ok"; }
    else if (r.no > r.go) { v.textContent = "Raté ❌ — pas de point"; v.className = "verdict ko"; }
    else { v.textContent = "Pas de point"; v.className = "verdict"; }
  }

  renderScores($("scoreListGame"));
  $("gameNote").textContent = "Manche " + (s.round || 1) + (s.buzz ? " · Buzz : " + s.buzz.name : "");
}

/* ---------- Anneau de compte a rebours ---------- */
const CIRC = 2 * Math.PI * 56;
let rafId = null, localEnd = 0, lastBuzzAt = 0;
function startCountdownLoop() {
  if (state.buzz && state.buzz.at !== lastBuzzAt) { lastBuzzAt = state.buzz.at; localEnd = Date.now() + (state.countdownRemaining || COUNTDOWN_MS); }
  if (rafId) return; tickCountdown();
}
function stopCountdownLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
function tickCountdown() {
  if (!state || state.phase !== "buzzed") { stopCountdownLoop(); return; }
  const remain = Math.max(0, localEnd - Date.now());
  $("ringNum").textContent = Math.ceil(remain / 1000);
  $("ringProg").style.strokeDashoffset = (CIRC * (1 - remain / COUNTDOWN_MS)).toFixed(1);
  rafId = requestAnimationFrame(tickCountdown);
}

connect();
