/* ============================================================
   BUZZ! — Client (WebSocket + lecteur YouTube iframe manuel)
   ============================================================ */
"use strict";

const COUNTDOWN_MS = 5000;
const $ = (id) => document.getElementById(id);
const show = (id, on) => $(id).classList.toggle("hidden", !on);

/* ---------- Identite / etat local ---------- */
let myId = null;
let myRole = null;            // "player" | "admin"
let myName = "";
let myRoom = "";
let pendingAdminPwd = null;   // pour se reauthentifier apres reconnexion
let state = null;
let muted = true;             // les joueurs sont en sourdine par defaut

/* ---------- WebSocket ---------- */
let ws = null;
let reconnectTimer = null;

function wsURL() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}`;
}
function connect() {
  ws = new WebSocket(wsURL());
  ws.addEventListener("open", () => {
    setBadge();
    // reconnexion : on se re-annonce
    if (myRole === "admin" && pendingAdminPwd) {
      sendMsg({ type: "admin", room: myRoom, password: pendingAdminPwd });
    } else if (myRole === "player") {
      sendMsg({ type: "join", room: myRoom, name: myName });
    }
  });
  ws.addEventListener("message", (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    handleServer(m);
  });
  ws.addEventListener("close", () => {
    setBadge("Reconnexion…");
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  });
  ws.addEventListener("error", () => ws.close());
}
function sendMsg(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function handleServer(m) {
  if (m.type === "welcome") { myId = m.id; return; }
  if (m.type === "admin_result") {
    if (m.ok) { myRole = "admin"; myName = "Animateur"; if (m.id) myId = m.id; $("adminErr").style.display = "none"; }
    else { $("adminErr").style.display = "block"; pendingAdminPwd = null; }
    return;
  }
  if (m.type === "notice") { toast(m.text); return; }
  if (m.type === "state") { state = m; onState(); return; }
}

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(text) {
  const t = $("toast"); t.textContent = text; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

/* ============================================================
   Lecteur YouTube — iframe manuel + postMessage
   ============================================================ */
let ytFrame = null, ytFrameId = null, lastSyncedPhase = null;

function buildEmbedSrc(id, mute) {
  const p = new URLSearchParams({
    enablejsapi: "1", rel: "0", modestbranding: "1", playsinline: "1",
    mute: mute ? "1" : "0", iv_load_policy: "3"
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
    ytFrame.src = buildEmbedSrc(state.videoId, muted);
    ytFrame.addEventListener("load", () => {
      setTimeout(() => { ytListen(); lastSyncedPhase = null; applyPlayback(true); }, 700);
    });
    mount.appendChild(ytFrame);
    ytFrameId = state.videoId;
    lastSyncedPhase = null;
  }
}
function ytPost(func) {
  if (!ytFrame || !ytFrame.contentWindow) return;
  ytFrame.contentWindow.postMessage(JSON.stringify({ event: "command", func, args: [] }), "*");
}
function ytListen() {
  if (!ytFrame || !ytFrame.contentWindow) return;
  ytFrame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: "ytframe" }), "*");
}
function applyPlayback(force) {
  if (!ytFrame) return;
  const playing = state && state.phase === "playing";
  if (force || state.phase !== lastSyncedPhase) {
    ytPost(playing ? "playVideo" : "pauseVideo");
    lastSyncedPhase = state.phase;
  }
}
function reloadVideoMute() {
  // recharge l'iframe avec le nouveau reglage de son
  if (!state || !state.videoId) return;
  ytFrameId = null;
  syncVideo();
}
window.addEventListener("message", (e) => {
  if (typeof e.data !== "string" || !/youtube/.test(e.origin)) return;
  try {
    const d = JSON.parse(e.data);
    const code = d.info && d.info.errorCode ? d.info.errorCode : (d.event === "onError" ? d.info : null);
    if (code != null) showVideoError(code);
  } catch (_) {}
});
function showVideoError(code) {
  const el = $("stageEmpty");
  const msgs = {
    2: "Lien invalide. Vérifie l'URL de la vidéo.",
    5: "Lecteur HTML5 indisponible.",
    100: "Vidéo introuvable, privée ou supprimée.",
    101: "Cette vidéo interdit la lecture intégrée. Essaie-en une autre.",
    150: "Cette vidéo interdit la lecture intégrée. Essaie-en une autre."
  };
  el.textContent = "⚠ " + (msgs[code] || ("Erreur lecteur (" + code + ")"));
  el.classList.remove("hidden");
}

/* ============================================================
   Actions UI
   ============================================================ */
$("joinBtn").onclick = () => {
  const name = $("pseudo").value.trim();
  if (!name) { $("pseudo").focus(); return; }
  myName = name; myRole = "player"; myRoom = $("room").value.trim().toUpperCase() || "PARTY";
  sendMsg({ type: "join", room: myRoom, name: myName });
  setBadge();
};
$("adminBtn").onclick = () => {
  const pwd = $("adminPwd").value;
  if (!pwd) return;
  pendingAdminPwd = pwd;
  myRoom = $("room").value.trim().toUpperCase() || "PARTY";
  sendMsg({ type: "admin", room: myRoom, password: pwd });
};
$("adminPwd").addEventListener("keydown", (e) => { if (e.key === "Enter") $("adminBtn").click(); });
$("pseudo").addEventListener("keydown", (e) => { if (e.key === "Enter") $("joinBtn").click(); });

$("readyBtn").onclick = () => sendMsg({ type: "ready" });
$("setVideo").onclick = () => sendMsg({ type: "setVideo", url: $("vurl").value });
$("setVideo2").onclick = () => { sendMsg({ type: "setVideo", url: $("vurl2").value }); $("vurl2").value = ""; };
$("startBtn").onclick = () => sendMsg({ type: "start" });
$("resetScoresBtn").onclick = () => sendMsg({ type: "resetScores" });
$("voteGo").onclick = () => sendMsg({ type: "vote", value: "go" });
$("voteNo").onclick = () => sendMsg({ type: "vote", value: "no" });

function doBuzz() {
  if (!state || state.phase !== "playing") return;
  $("buzzer").classList.add("pressed");
  setTimeout(() => $("buzzer").classList.remove("pressed"), 150);
  sendMsg({ type: "buzz" });
}
$("buzzer").onclick = doBuzz;
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && myRole && document.activeElement.tagName !== "INPUT") {
    e.preventDefault();
    if (state && state.phase === "playing") doBuzz();
  }
});

$("muteToggle").onclick = () => {
  muted = !muted;
  $("muteToggle").textContent = muted ? "🔇 Activer le son" : "🔊 Couper le son";
  reloadVideoMute();
};

/* ---------- Actions animateur dynamiques ---------- */
function adminAction(label, cls, type) {
  const b = document.createElement("button");
  b.className = "btn " + (cls || "ghost"); b.textContent = label;
  b.onclick = () => (type === "buzz" ? doBuzz() : sendMsg({ type }));
  return b;
}
function renderAdminActions() {
  const box = $("adminActions"); box.innerHTML = "";
  const ph = state.phase;
  if (ph === "playing") box.appendChild(adminAction("Pause / Buzz manuel", "", "buzz"));
  if (ph === "voting") box.appendChild(adminAction("Clôturer le vote", "", "closeVote"));
  if (ph === "result") box.appendChild(adminAction("Reprendre maintenant ▶", "", "continue"));
  if (ph !== "lobby") box.appendChild(adminAction("Salle d'attente", "ghost", "resetLobby"));
}

/* ============================================================
   Rendu
   ============================================================ */
function setBadge(txt) {
  const conn = txt || "En ligne";
  $("badge").textContent = myRole === "admin" ? "Animateur · " + conn
    : myRole === "player" ? (myName + " · " + conn) : conn;
}
function escapeHtml(t) {
  return (t || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderScores(el) {
  if (!el) return;
  const s = (state && state.scores) || [];
  el.innerHTML = "";
  if (s.length === 0) { el.innerHTML = '<span class="empty">Pas encore de points.</span>'; return; }
  s.forEach((row, i) => {
    const d = document.createElement("div");
    d.className = "score-row" + (row.name === myName ? " me" : "");
    d.innerHTML = '<span class="rank">' + (i + 1) + '</span><span class="nm">'
      + escapeHtml(row.name) + '</span><span class="pts">' + row.points + "</span>";
    el.appendChild(d);
  });
}

function onState() {
  setBadge();
  const inGame = ["playing", "buzzed", "voting", "result"].includes(state.phase);
  show("home", myRole === null);
  show("lobby", myRole !== null && !inGame);
  show("game", myRole !== null && inGame);
  if (myRole === null) return;

  if (!inGame) { renderLobby(); return; }
  renderGame();
}

function renderLobby() {
  const list = $("playerList");
  list.innerHTML = "";
  const ready = state.players.filter((p) => p.ready).length;
  $("readyCount").textContent = ready;
  $("totalCount").textContent = state.players.length;
  if (state.players.length === 0) list.innerHTML = '<span class="empty">Personne pour l\'instant…</span>';
  state.players.forEach((p) => {
    const c = document.createElement("span");
    c.className = "chip" + (p.ready ? " ready" : "") + (p.id === myId ? " me" : "");
    c.innerHTML = '<span class="status"></span>' + escapeHtml(p.name) + (p.id === myId ? " (toi)" : "");
    list.appendChild(c);
  });

  show("scoreCard", (state.scores || []).length > 0);
  renderScores($("scoreList"));

  show("readyCard", myRole === "player");
  show("adminLobby", myRole === "admin");

  if (myRole === "player") {
    const me = state.players.find((p) => p.id === myId);
    const r = me && me.ready;
    $("readyBtn").textContent = r ? "Annuler — pas prêt" : "Je suis prêt·e ✋";
    $("readyBtn").className = "btn" + (r ? " ghost" : "");
  }
  if (myRole === "admin") {
    $("videoState").textContent = state.videoId ? "Vidéo prête ✅" : "Aucune vidéo chargée.";
    $("startBtn").disabled = !state.videoId;
  }
}

function renderGame() {
  syncVideo();
  applyPlayback(false);

  const s = state;
  const isBuzzer = s.buzz && s.buzz.id === myId;
  const amPlayer = myRole === "player";

  // son : bouton dispo pour les non-animateurs
  show("muteToggle", myRole !== "admin" && !!s.videoId);

  // overlay countdown
  if (s.phase === "buzzed") {
    show("overlay", true);
    $("overlayWho").textContent = (s.buzz ? s.buzz.name : "") + " a buzzé !";
    startCountdownLoop();
  } else {
    show("overlay", false);
    stopCountdownLoop();
  }

  show("buzzZone", s.phase === "playing" || s.phase === "buzzed");
  show("voteZone", s.phase === "voting");
  show("resultZone", s.phase === "result");

  const buzzer = $("buzzer");
  if (s.phase === "playing") {
    buzzer.disabled = false; buzzer.textContent = "BUZZ";
    $("buzzHint").innerHTML = 'Appuie dès que tu connais la réponse — touche <kbd>Espace</kbd>';
  } else if (s.phase === "buzzed") {
    buzzer.disabled = true; buzzer.textContent = "…";
    $("buzzHint").textContent = isBuzzer ? "À toi ! Donne ta réponse à l'oral 🎤"
      : (s.buzz ? s.buzz.name : "Quelqu'un") + " répond…";
  }

  if (s.phase === "voting") {
    $("voteResp").textContent = (s.buzz ? s.buzz.name : "") + " a donné sa réponse à l'oral.";
    const voted = s.votes.some((v) => v.id === myId);
    const canVote = !isBuzzer && (amPlayer || myRole === "admin");
    $("voteGo").disabled = !canVote || voted;
    $("voteNo").disabled = !canVote || voted;
    show("votedNote", isBuzzer || voted);
    $("votedNote").textContent = isBuzzer ? "Tu as buzzé — les autres votent pour toi."
      : "Vote enregistré. En attente des autres…";
  }

  if (s.phase === "result") {
    const r = s.lastResult || { go: 0, no: 0, correct: false, name: null };
    $("tGo").textContent = r.go;
    $("tNo").textContent = r.no;
    const v = $("verdict");
    if (r.correct) { v.textContent = "Bonne réponse ! +1 pour " + (r.name || "le buzzer") + " 🎉"; v.className = "verdict ok"; }
    else if (r.no > r.go) { v.textContent = "Raté ❌ — pas de point"; v.className = "verdict ko"; }
    else { v.textContent = "Pas de point"; v.className = "verdict"; }
    $("resumeNote").textContent = "La vidéo reprend automatiquement…";
  }

  renderScores($("scoreListGame"));

  show("adminBar", myRole === "admin");
  if (myRole === "admin") renderAdminActions();

  $("gameNote").textContent = "Manche " + (s.round || 1) + (s.buzz ? " · Buzz : " + s.buzz.name : "");
}

/* ---------- Anneau de compte a rebours ---------- */
const CIRC = 2 * Math.PI * 56;
let rafId = null, localEnd = 0, lastBuzzAt = 0;
function startCountdownLoop() {
  // (re)synchronise la fin locale a chaque nouveau buzz
  if (state.buzz && state.buzz.at !== lastBuzzAt) {
    lastBuzzAt = state.buzz.at;
    localEnd = Date.now() + (state.countdownRemaining || COUNTDOWN_MS);
  }
  if (rafId) return;
  tickCountdown();
}
function stopCountdownLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
function tickCountdown() {
  if (!state || state.phase !== "buzzed") { stopCountdownLoop(); return; }
  const remain = Math.max(0, localEnd - Date.now());
  const frac = remain / COUNTDOWN_MS;
  $("ringNum").textContent = Math.ceil(remain / 1000);
  $("ringProg").style.strokeDashoffset = (CIRC * (1 - frac)).toFixed(1);
  rafId = requestAnimationFrame(tickCountdown);
}

/* ---------- Go ---------- */
connect();
