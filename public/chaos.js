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
let qTimerInterval = null;

// Per-question answer cache (for display only — server uses last value at timer end)
let myAnswers = {};  // qIdx → text | null
let mySusceptible = {}; // qIdx → selected playerId
let myVFChoice = {};    // qIdx → "vrai"|"faux"

const $ = id => document.getElementById(id);

/* ---------- Sections ---------- */
const sections = { home: "secHome", lobby: "secLobby", playing: "secPlaying", correction: "secCorrection", results: "secResults" };
function showSection(name) {
  Object.values(sections).forEach(id => { const el = $(id); if (el) el.style.display = "none"; });
  const el = $(sections[name]);
  if (el) el.style.display = "";
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
function makeAvEl(avatar, name, size = 30) {
  if (avatar) {
    const img = document.createElement("img");
    img.src = "/avatars/" + avatar;
    img.alt = name;
    img.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;`;
    return img;
  }
  const div = document.createElement("div");
  div.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#f472b6);display:flex;align-items:center;justify-content:center;font-family:'Fredoka',sans-serif;font-size:${Math.round(size*.55)}px;font-weight:700;color:#fff;flex-shrink:0;`;
  div.textContent = (name || "?")[0].toUpperCase();
  return div;
}

/* ---------- WS ---------- */
function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(proto + "//" + location.host);
  ws.onopen = () => send({ type: "chaos_listRooms" });
  ws.onmessage = ({ data }) => {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (!m.type || !m.type.startsWith("chaos_")) return;
    handle(m);
  };
  ws.onclose = () => { setTimeout(connect, 2000); toast("Reconnexion…"); };
}

function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

/* ---------- Message handler ---------- */
function handle(m) {
  switch (m.type) {
    case "chaos_welcome":
      myId = m.id; break;
    case "chaos_rooms":
      if (!currentRoom) renderRoomList(m.rooms); break;
    case "chaos_created":
    case "chaos_joined":
      currentRoom = m.room; isAdmin = m.type === "chaos_created";
      $("lobbyCode").textContent = m.room;
      $("ccRoomCode").textContent = m.room; $("ccRoomCode").classList.remove("hidden");
      $("quitBtn").style.display = "";
      showSection("lobby");
      break;
    case "chaos_join_error":
      $("joinErr").style.display = "block"; break;
    case "chaos_promoted":
      isAdmin = true; toast("Tu es maintenant l'hôte !"); break;
    case "chaos_left":
      currentRoom = null; isAdmin = false; myAnswers = {}; mySusceptible = {}; myVFChoice = {};
      $("ccRoomCode").classList.add("hidden"); $("quitBtn").style.display = "none";
      showSection("home"); send({ type: "chaos_listRooms" }); break;
    case "chaos_toast":
      toast(m.msg, 4000); break;
    case "chaos_state":
      gameState = m; renderState(m); break;
  }
}

/* ---------- State router ---------- */
function renderState(s) {
  const ph = s.phase;
  if (ph === "lobby" || ph === "countdown") { showSection("lobby"); renderLobby(s); }
  else if (ph === "playing") { showSection("playing"); renderPlaying(s); }
  else if (ph === "correction") { showSection("correction"); renderCorrection(s); }
  else if (ph === "results" || ph === "ended") { showSection("results"); renderResults(s); }
}

/* ---------- Lobby ---------- */
function renderLobby(s) {
  $("lobbyCode").textContent = s.code || currentRoom;
  const cd = $("countdownBanner");
  if (s.phase === "countdown" && s.lobbyCountdownRemaining > 0) {
    cd.classList.remove("hidden"); $("countdownSec").textContent = Math.ceil(s.lobbyCountdownRemaining / 1000);
  } else { cd.classList.add("hidden"); }

  // Question count — select for admin, display for others
  const sel = $("lobbyQCount");
  const disp = $("lobbyQCountDisplay");
  if (isAdmin) {
    sel.style.display = ""; disp.style.display = "none";
    sel.value = s.questionCount;
  } else {
    sel.style.display = "none"; disp.style.display = "";
    disp.textContent = s.questionCount + " questions";
  }

  const me = s.players.find(p => p.id === myId);
  $("btnReady").textContent = (me && me.ready) ? "✅ Prêt" : "⬜ Pas prêt";
  $("btnForceStart").style.display = isAdmin ? "" : "none";

  const grid = $("lobbyPlayers"); grid.innerHTML = "";
  for (const p of s.players) {
    const card = document.createElement("div");
    card.className = "cc-player-card" + (p.ready ? " ready" : "");
    const av = document.createElement("div"); av.className = "cc-player-avatar";
    av.appendChild(makeAvEl(p.avatar, p.name, 44)); card.appendChild(av);
    const nm = document.createElement("div"); nm.className = "cc-player-name"; nm.textContent = p.name; card.appendChild(nm);
    if (p.isAdmin) { const adm = document.createElement("div"); adm.className = "cc-player-admin"; adm.textContent = "HÔTE"; card.appendChild(adm); }
    const st = document.createElement("div"); st.className = "cc-player-status"; st.textContent = p.ready ? "Prêt ✓" : "En attente…"; card.appendChild(st);
    grid.appendChild(card);
  }
}

function renderRoomList(rooms) {
  const el = $("roomList"); el.innerHTML = "";
  const open = (rooms || []).filter(r => r.phase === "lobby" || r.phase === "countdown");
  if (!open.length) return;
  const title = document.createElement("p"); title.className = "sub"; title.textContent = "Parties ouvertes :"; el.appendChild(title);
  for (const r of open) {
    const card = document.createElement("div"); card.className = "cc-room-card";
    card.innerHTML = `<span style="font-family:var(--display);font-size:20px;font-weight:700;letter-spacing:2px;">${r.code}</span><span class="sub">${r.count} joueur(s) · ${r.questionCount}Q</span><span>→</span>`;
    card.addEventListener("click", () => joinRoom(r.code)); el.appendChild(card);
  }
}

/* ---------- Playing ---------- */
let lastQIdx = -1;

function renderPlaying(s) {
  const qIdx = s.currentQ;
  const q = s.question;
  if (!q) return;

  $("qProgressBar").style.width = ((qIdx + 1) / s.totalQ * 100) + "%";
  $("qNum").textContent = "Q" + (qIdx + 1);
  $("qType").textContent = typeLabel(q.type);
  $("qText").textContent = q.question;
  $("qAnsweredInfo").textContent = s.answeredCount + " / " + s.totalPlayers + " ont répondu";

  if (qIdx !== lastQIdx) {
    lastQIdx = qIdx;
    clearInterval(qTimerInterval);
    $("qChoices").style.display = "none"; $("qChoices").innerHTML = "";
    $("qInput").style.display = "none"; $("answerInput").value = "";
    $("qVF").style.display = "none";
    $("qVF").querySelectorAll(".cc-vf-btn").forEach(b => { b.classList.remove("selected"); });

    // Show input type
    if (q.type === "vrai_faux") {
      $("qVF").style.display = "";
      if (myVFChoice[qIdx]) {
        $("qVF").querySelector(`[data-val="${myVFChoice[qIdx]}"]`).classList.add("selected");
      }
    } else if (q.type === "susceptible") {
      buildSusceptiblePicker(s, qIdx);
    } else if (q.type === "culture_gen" && q.choices && q.choices.length) {
      buildChoicesPicker(q.choices, qIdx);
    } else if (q.type === "chronologie" && q.choices && q.choices.length) {
      buildChronoPicker(q.choices, qIdx);
    } else if (q.type === "anagramme") {
      buildAnagramme(q, qIdx);
    } else if (q.type === "petit_bac") {
      buildPetitBac(q, qIdx);
    } else if (q.type === "blind_test") {
      buildBlindTest(q, qIdx);
    } else if (q.type === "meme_mystere" || q.type === "devine_jeu_img") {
      buildImageQuestion(q, qIdx);
    } else {
      // texte libre
      $("qInput").style.display = "";
      $("answerInput").value = myAnswers[qIdx] || "";
      $("answerInput").focus();
    }
  } else {
    if (q.type === "susceptible") updateSusceptibleSelection(qIdx);
    if (q.type === "chronologie") updateChronoDisplay(qIdx);
  }

  startQTimer(s.qRemaining);
}

function buildSusceptiblePicker(s, qIdx) {
  const container = $("qChoices");
  container.style.display = "";
  container.className = "cc-susc-grid";
  container.innerHTML = "";
  for (const p of s.players) {
    if (p.spectator) continue;
    const btn = document.createElement("button");
    btn.className = "cc-susc-btn" + (mySusceptible[qIdx] === p.id ? " selected" : "");
    btn.dataset.pid = p.id;
    const av = document.createElement("div"); av.className = "cc-susc-av";
    av.appendChild(makeAvEl(p.avatar, p.name, 38)); btn.appendChild(av);
    const nm = document.createElement("div"); nm.className = "cc-susc-name"; nm.textContent = p.name; btn.appendChild(nm);
    btn.addEventListener("click", () => {
      mySusceptible[qIdx] = p.id;
      send({ type: "chaos_answer", text: p.name });
      updateSusceptibleSelection(qIdx);
    });
    container.appendChild(btn);
  }
}

function updateSusceptibleSelection(qIdx) {
  const container = $("qChoices");
  container.querySelectorAll(".cc-susc-btn").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.pid === mySusceptible[qIdx]);
  });
}

function buildChoicesPicker(choices, qIdx) {
  const container = $("qChoices");
  container.style.display = "";
  container.className = "cc-choices";
  container.innerHTML = "";
  for (const c of choices) {
    const btn = document.createElement("button");
    btn.className = "cc-choice-answer" + (myAnswers[qIdx] === c ? " selected" : "");
    btn.textContent = c;
    btn.addEventListener("click", () => {
      myAnswers[qIdx] = c;
      send({ type: "chaos_answer", text: c });
      container.querySelectorAll(".cc-choice-answer").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
    container.appendChild(btn);
  }
}

/* ---------- Anagramme ---------- */
function buildAnagramme(q, qIdx) {
  const container = $("qChoices");
  container.style.display = "";
  container.className = "";
  container.innerHTML = "";

  const scrambled = document.createElement("div");
  scrambled.style.cssText = "font-family:var(--display);font-size:32px;font-weight:700;letter-spacing:6px;text-align:center;color:var(--spotlight);margin-bottom:16px;";
  scrambled.textContent = q.question;
  container.appendChild(scrambled);

  // Hint countdown — hidden for 7s
  const hintBox = document.createElement("div");
  hintBox.style.cssText = "text-align:center;margin-bottom:16px;min-height:28px;";
  container.appendChild(hintBox);

  // Text input
  const inp = document.createElement("input");
  inp.className = "cc-answer-input";
  inp.placeholder = "Ta réponse…";
  inp.maxLength = 50;
  inp.autocomplete = "off";
  inp.value = myAnswers[qIdx] || "";
  inp.addEventListener("input", () => {
    myAnswers[qIdx] = inp.value;
    send({ type: "chaos_answer", text: inp.value });
  });
  container.appendChild(inp);
  inp.focus();

  // Hint timer
  const HINT_DELAY = 7000;
  const hintText = (q.choices && q.choices.hint) ? q.choices.hint : null;
  if (hintText) {
    const hintEnd = Date.now() + HINT_DELAY;
    const hintTimer = setInterval(() => {
      const left = Math.max(0, Math.ceil((hintEnd - Date.now()) / 1000));
      if (left > 0) {
        hintBox.innerHTML = `<span class="sub" style="font-size:12px;">Indice dans <strong>${left}s</strong></span>`;
      } else {
        clearInterval(hintTimer);
        hintBox.innerHTML = `<div class="sub" style="font-size:13px;color:var(--spotlight);">💡 Indice : ${escHtml(hintText)}</div>`;
      }
    }, 250);
    hintBox.innerHTML = `<span class="sub" style="font-size:12px;">Indice dans <strong>${HINT_DELAY/1000}s</strong></span>`;
  }
}

/* ---------- Chronologie drag ---------- */
// myChronoOrder[qIdx] = array of item strings in current order
let myChronoOrder = {};

function stripDate(str) {
  // Remove trailing "(YYYY)" or "(YYYY-YYYY)" pattern
  return String(str).replace(/\s*\(\d{4}(?:[–\-]\d{2,4})?\)\s*$/, "").trim();
}

function buildChronoPicker(choices, qIdx) {
  if (!myChronoOrder[qIdx]) {
    // Start shuffled
    myChronoOrder[qIdx] = [...choices].sort(() => Math.random() - 0.5);
  }
  const container = $("qChoices");
  container.style.display = "";
  container.className = "";
  container.innerHTML = "";

  const hint = document.createElement("div");
  hint.className = "sub";
  hint.style.cssText = "margin-bottom:10px;font-size:12px;";
  hint.textContent = "Glisse les éléments pour les remettre dans l'ordre.";
  container.appendChild(hint);

  renderChronoList(container, qIdx);
}

function renderChronoList(container, qIdx) {
  let list = container.querySelector(".cc-chrono-list");
  if (!list) { list = document.createElement("div"); list.className = "cc-chrono-list"; container.appendChild(list); }
  list.innerHTML = "";
  const order = myChronoOrder[qIdx];
  order.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "cc-chrono-item";
    row.draggable = true;
    row.dataset.idx = i;
    row.innerHTML = `<span class="cc-chrono-num">${i + 1}</span><span class="cc-chrono-text">${escHtml(stripDate(item))}</span><span class="cc-chrono-drag">⠿</span>`;

    row.addEventListener("dragstart", e => { e.dataTransfer.setData("text/plain", i); row.classList.add("dragging"); });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", e => { e.preventDefault(); row.classList.add("drag-over"); });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", e => {
      e.preventDefault(); row.classList.remove("drag-over");
      const from = parseInt(e.dataTransfer.getData("text/plain"));
      const to = i;
      if (from === to) return;
      const arr = myChronoOrder[qIdx];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      send({ type: "chaos_answer", text: JSON.stringify(arr) });
      renderChronoList(container, qIdx);
    });

    // Mobile: tap to swap with adjacent
    row.addEventListener("click", () => {
      const arr = myChronoOrder[qIdx];
      if (i < arr.length - 1) {
        [arr[i], arr[i+1]] = [arr[i+1], arr[i]];
        send({ type: "chaos_answer", text: JSON.stringify(arr) });
        renderChronoList(container, qIdx);
      }
    });
    list.appendChild(row);
  });
}

function updateChronoDisplay(qIdx) {
  const container = $("qChoices");
  if (container.querySelector(".cc-chrono-list")) renderChronoList(container, qIdx);
}

/* ---------- Petit Bac ---------- */
let myPetitBac = {}; // qIdx → { cat: value }

function buildPetitBac(q, qIdx) {
  if (!myPetitBac[qIdx]) myPetitBac[qIdx] = {};
  const container = $("qChoices");
  container.style.display = "";
  container.className = "";
  container.innerHTML = "";

  const letter = document.createElement("div");
  letter.style.cssText = "font-family:var(--display);font-size:56px;font-weight:700;text-align:center;color:var(--buzz);margin-bottom:16px;line-height:1;";
  letter.textContent = q.question;
  container.appendChild(letter);

  const hint = document.createElement("div");
  hint.className = "sub";
  hint.style.cssText = "text-align:center;margin-bottom:16px;font-size:13px;";
  hint.textContent = "Trouve un mot commençant par cette lettre pour chaque catégorie.";
  container.appendChild(hint);

  const cats = q.choices || [];
  const grid = document.createElement("div");
  grid.className = "cc-petitbac-grid";
  cats.forEach(cat => {
    const row = document.createElement("div");
    row.className = "cc-petitbac-row";
    const lbl = document.createElement("label");
    lbl.className = "cc-petitbac-label";
    lbl.textContent = cat;
    const inp = document.createElement("input");
    inp.className = "cc-answer-input cc-petitbac-input";
    inp.placeholder = q.question + "…";
    inp.maxLength = 50;
    inp.autocomplete = "off";
    inp.value = myPetitBac[qIdx][cat] || "";
    inp.addEventListener("input", () => {
      myPetitBac[qIdx][cat] = inp.value;
      send({ type: "chaos_answer", text: JSON.stringify(myPetitBac[qIdx]) });
    });
    row.appendChild(lbl);
    row.appendChild(inp);
    grid.appendChild(row);
  });
  container.appendChild(grid);
}

/* ---------- Blind Test ---------- */
/* ---------- Image questions ---------- */
function buildImageQuestion(q, qIdx) {
  const container = $("qChoices");
  container.style.display = "";
  container.className = "";
  container.innerHTML = "";

  let meta = {};
  if (q.choices && typeof q.choices === "object") meta = q.choices;
  else if (q.choices) { try { meta = JSON.parse(q.choices); } catch {} }

  if (meta.image) {
    const imgWrap = document.createElement("div");
    imgWrap.style.cssText = "text-align:center;margin-bottom:16px;";
    const img = document.createElement("img");
    img.src = meta.image;
    img.alt = "Image question";
    img.style.cssText = `max-width:100%;max-height:280px;border-radius:12px;object-fit:cover;${meta.blur ? `filter:blur(${meta.blur}px);` : ""}`;
    img.onerror = () => { imgWrap.innerHTML = '<div class="sub" style="padding:20px;">⚠️ Image non disponible</div>'; };
    imgWrap.appendChild(img);
    container.appendChild(imgWrap);
  }

  // Text input
  const inp = document.createElement("input");
  inp.className = "cc-answer-input";
  inp.placeholder = q.type === "image_mot" ? "Un mot…" : q.type === "meme_mystere" ? "Nom / contexte du mème…" : "Titre du jeu…";
  inp.maxLength = 100;
  inp.autocomplete = "off";
  inp.value = myAnswers[qIdx] || "";
  inp.addEventListener("input", () => {
    myAnswers[qIdx] = inp.value;
    send({ type: "chaos_answer", text: inp.value });
  });
  container.appendChild(inp);
  inp.focus();
}

function buildBlindTest(q, qIdx) {
  const container = $("qChoices");
  container.style.display = "";
  container.className = "";
  container.innerHTML = "";

  const isSinger = q.isSinger;

  if (isSinger) {
    const titleBox = document.createElement("div");
    titleBox.style.cssText = "background:rgba(255,45,85,.12);border:2px solid var(--buzz);border-radius:16px;padding:24px;text-align:center;margin-bottom:16px;";
    titleBox.innerHTML = `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--buzz);margin-bottom:8px;">🎤 TU CHANTES !</div><div style="font-family:var(--display);font-size:24px;font-weight:700;">${escHtml(q.question)}</div>`;
    container.appendChild(titleBox);

    const note = document.createElement("div");
    note.className = "sub";
    note.style.cssText = "text-align:center;font-size:13px;margin-bottom:16px;";
    note.textContent = "Fredonne ou siffle sur Discord — les autres doivent deviner !";
    container.appendChild(note);

    const extBtn = document.createElement("button");
    extBtn.className = "btn ghost small";
    extBtn.style.cssText = "display:block;margin:0 auto;width:auto;font-size:13px;";
    extBtn.textContent = "⏱️ +10s — je connais pas, faut que j'aille écouter";
    extBtn.addEventListener("click", () => {
      send({ type: "chaos_extend_timer" });
      extBtn.disabled = true;
      extBtn.textContent = "+10s ajoutées !";
    });
    container.appendChild(extBtn);

    send({ type: "chaos_answer", text: "(chanteur)" });
  } else {
    // Singer name
    const singerName = gameState && gameState.players &&
      gameState.players.find(p => p.id === (gameState.question && gameState.question.blindSinger));
    const info = document.createElement("div");
    info.style.cssText = "text-align:center;margin-bottom:16px;";
    info.innerHTML = `<div style="font-size:40px;margin-bottom:8px;">🎵</div><div style="font-size:15px;font-weight:600;">${singerName ? escHtml(singerName.name) + " fredonne…" : "Quelqu'un fredonne…"}</div>`;
    container.appendChild(info);
    // Text input
    const inp = document.createElement("input");
    inp.className = "cc-answer-input";
    inp.placeholder = "Titre de la chanson…";
    inp.maxLength = 100;
    inp.autocomplete = "off";
    inp.value = myAnswers[qIdx] || "";
    inp.addEventListener("input", () => {
      myAnswers[qIdx] = inp.value;
      send({ type: "chaos_answer", text: inp.value });
    });
    container.appendChild(inp);
    inp.focus();
  }
}

function startQTimer(remaining) {
  clearInterval(qTimerInterval);
  const end = Date.now() + remaining;
  function tick() {
    const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    $("qTimer").textContent = left;
    $("qTimer").classList.toggle("urgent", left <= 5);
    if (left <= 0) clearInterval(qTimerInterval);
  }
  tick(); qTimerInterval = setInterval(tick, 250);
}

/* ---------- Correction ---------- */
function renderCorrection(s) {
  const qIdx = s.correctionQ;
  const cq = s.correctionQuestion;
  if (!cq || qIdx < 0) return;

  $("corrQNum").textContent = "Q" + (qIdx + 1) + " / " + s.totalQ;
  $("corrQType").textContent = typeLabel(cq.type);
  $("corrQText").textContent = cq.question;
  $("corrQAnswer").style.display = "none";

  // Show image for image-based types
  let corrImgEl = $("corrQImg");
  if (!corrImgEl) {
    corrImgEl = document.createElement("div"); corrImgEl.id = "corrQImg";
    $("corrQuestionCard").appendChild(corrImgEl);
  }
  if (["meme_mystere","devine_jeu_img"].includes(cq.type) && cq.choices) {
    let meta = {};
    if (typeof cq.choices === "object") meta = cq.choices;
    else { try { meta = JSON.parse(cq.choices); } catch {} }
    if (meta.image) {
      corrImgEl.style.cssText = "text-align:center;margin-top:12px;";
      corrImgEl.innerHTML = `<img src="${escHtml(meta.image)}" style="max-width:100%;max-height:200px;border-radius:10px;object-fit:cover;" alt="">`; // no blur in correction
    } else { corrImgEl.innerHTML = ""; }
  } else { corrImgEl.innerHTML = ""; }

  $("corrAdminBar").style.display = isAdmin ? "" : "none";
  renderVoteProgress(s);

  // Tie resolution panel
  if (s.tieData && s.tieData.tied && s.tieData.tied.length > 0 && isAdmin) {
    $("tiePanel").classList.remove("hidden");
    renderTiePanel(s.tieData);
    $("btnNextCorr").style.display = "none";
  } else {
    $("tiePanel").classList.add("hidden");
    if (isAdmin) $("btnNextCorr").style.display = "";
  }

  // Btn label
  if (isAdmin) {
    $("btnNextCorr").textContent = s.correctionResults ? "Question suivante →" : "Valider les votes →";
  }

  // Results shown
  if (s.correctionResults) {
    renderCorrResults(s.correctionResults, s.correctionAnswers || []);
    return;
  }

  renderAnswerVotes(s, qIdx, cq);
}

function renderAnswerVotes(s, qIdx, cq) {
  const list = $("corrAnswersList");
  list.innerHTML = "";
  if (!s.correctionAnswers || !s.correctionAnswers.length) {
    list.innerHTML = '<p class="sub">Aucune réponse soumise.</p>'; return;
  }

  // petit_bac: expand per category
  if (cq && cq.type === "petit_bac") {
    renderPetitBacVotes(s, qIdx, cq); return;
  }

  // correct answer banner (generic)
  if (cq && cq.answer) {
    const correctDiv = document.createElement("div");
    correctDiv.style.cssText = "background:rgba(39,211,144,.1);border:1px solid var(--go);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:14px;";
    correctDiv.innerHTML = `<span style="color:var(--go);font-weight:700;">✓ Bonne réponse :</span> ${escHtml(cq.answer)}`;
    list.appendChild(correctDiv);
  }

  // chronologie: correct order
  if (cq && cq.type === "chronologie" && cq.choices && cq.choices.length) {
    const correctDiv = document.createElement("div");
    correctDiv.style.cssText = "background:rgba(39,211,144,.1);border:1px solid var(--go);border-radius:10px;padding:10px 14px;margin-bottom:14px;";
    const title = document.createElement("div");
    title.style.cssText = "color:var(--go);font-weight:700;margin-bottom:6px;font-size:14px;";
    title.textContent = "✓ Ordre correct :";
    correctDiv.appendChild(title);
    cq.choices.forEach((item, i) => {
      const row = document.createElement("div"); row.style.cssText = "font-size:13px;margin-bottom:2px;";
      row.textContent = (i + 1) + ". " + stripDate(item); correctDiv.appendChild(row);
    });
    list.appendChild(correctDiv);
  }

  const isBlindTest = cq && cq.type === "blind_test";
  const votes = s.correctionVotes || {};
  const myVotesMap = votes[myId] || {};

  for (const ans of s.correctionAnswers) {
    const card = document.createElement("div"); card.className = "cc-ans-card";
    const top = document.createElement("div"); top.className = "cc-ans-top";
    const avWrap = document.createElement("div"); avWrap.className = "cc-ans-avatar";
    avWrap.appendChild(makeAvEl(ans.avatar, ans.name, 30)); top.appendChild(avWrap);
    const nm = document.createElement("span"); nm.className = "cc-ans-name";
    nm.textContent = ans.name + (ans.clientId === myId ? " (toi)" : ""); top.appendChild(nm);
    card.appendChild(top);

    // For blind_test singer answer, show differently
    const isSingerRow = isBlindTest && s.question && s.question.blindSinger === ans.clientId;
    const txt = document.createElement("div");
    if (isSingerRow) {
      txt.className = "cc-ans-text";
      txt.style.cssText = "color:var(--buzz);font-style:italic;";
      txt.textContent = "🎤 (chanteur)";
    } else {
      txt.className = "cc-ans-text" + (ans.text ? "" : " empty");
      // chronologie: parse and display order
      if (cq && cq.type === "chronologie" && ans.text) {
        try {
          const order = JSON.parse(ans.text);
          txt.textContent = order.map((item, i) => (i+1) + ". " + stripDate(item)).join(" → ");
        } catch { txt.textContent = ans.text || "(pas de réponse)"; }
      } else {
        txt.textContent = ans.text || "(pas de réponse)";
      }
    }
    card.appendChild(txt);

    // Vote row
    const myV = myVotesMap[ans.clientId];
    const row = document.createElement("div"); row.className = "cc-vote-row";

    // blind_test singer votes differently
    const voteOptions = isBlindTest
      ? ["vrai", "faux", "honte"]
      : ["vrai", "faux", "honte"];
    const voteLabels = isBlindTest
      ? { vrai: "🎵 Reconnu", faux: "❓ Pas reconnu", honte: "🍅 Honteux" }
      : { vrai: "✅ Vrai", faux: "❌ Faux", honte: "🍅 Honte" };

    for (const v of voteOptions) {
      const btn = document.createElement("button");
      btn.className = "cc-vote-btn" + (myV === v ? " v-" + v : "");
      btn.textContent = voteLabels[v];
      btn.addEventListener("click", () => {
        send({ type: "chaos_vote", targetClientId: ans.clientId, verdict: v });
        row.querySelectorAll(".cc-vote-btn").forEach(b => b.className = "cc-vote-btn");
        btn.className = "cc-vote-btn v-" + v;
      });
      row.appendChild(btn);
    }
    card.appendChild(row);
    list.appendChild(card);
  }
}

function renderPetitBacVotes(s, qIdx, cq) {
  const list = $("corrAnswersList");
  const cats = cq.choices || [];
  const votes = s.correctionVotes || {};
  const myVotesMap = votes[myId] || {};

  // One card per player
  for (const ans of s.correctionAnswers) {
    let catData = {};
    try { catData = JSON.parse(ans.text || "{}"); } catch {}

    const card = document.createElement("div"); card.className = "cc-ans-card"; card.style.marginBottom = "14px";
    // Player header
    const top = document.createElement("div"); top.className = "cc-ans-top"; top.style.marginBottom = "12px";
    const avWrap = document.createElement("div"); avWrap.className = "cc-ans-avatar";
    avWrap.appendChild(makeAvEl(ans.avatar, ans.name, 30)); top.appendChild(avWrap);
    const nm = document.createElement("span"); nm.className = "cc-ans-name";
    nm.textContent = ans.name + (ans.clientId === myId ? " (toi)" : ""); top.appendChild(nm);
    card.appendChild(top);

    // Each category
    for (const cat of cats) {
      const targetId = ans.clientId + "___" + cat;
      const val = catData[cat] || "";
      const myV = myVotesMap[targetId];

      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:8px;";

      const catLbl = document.createElement("span");
      catLbl.style.cssText = "font-size:12px;font-weight:700;color:var(--muted);width:110px;flex-shrink:0;text-align:right;";
      catLbl.textContent = cat;
      row.appendChild(catLbl);

      const valLbl = document.createElement("span");
      valLbl.style.cssText = "flex:1;font-size:14px;font-weight:600;padding:4px 10px;background:var(--stage);border-radius:6px;" + (!val ? "color:var(--muted);font-style:italic;" : "");
      valLbl.textContent = val || "(vide)";
      row.appendChild(valLbl);

      const voteBtns = document.createElement("div"); voteBtns.style.cssText = "display:flex;gap:6px;";
      for (const v of ["vrai", "faux", "honte"]) {
        const btn = document.createElement("button");
        btn.className = "cc-vote-btn" + (myV === v ? " v-" + v : "");
        btn.style.cssText = "flex:none;padding:5px 8px;font-size:12px;";
        btn.textContent = v === "vrai" ? "✅" : v === "faux" ? "❌" : "🍅";
        btn.title = v === "vrai" ? "Vrai" : v === "faux" ? "Faux" : "Honte";
        btn.addEventListener("click", () => {
          send({ type: "chaos_vote", targetClientId: targetId, verdict: v });
          voteBtns.querySelectorAll(".cc-vote-btn").forEach(b => b.className = "cc-vote-btn");
          btn.className = "cc-vote-btn v-" + v;
        });
        voteBtns.appendChild(btn);
      }
      row.appendChild(voteBtns);
      card.appendChild(row);
    }
    list.appendChild(card);
  }
}

function renderVoteProgress(s) {
  const panel = $("voteProgressPanel");
  if (!panel) return;
  panel.innerHTML = "";

  const title = document.createElement("div");
  title.className = "cc-vote-sidebar-title";
  title.textContent = "Votes";
  panel.appendChild(title);

  const progress = s.voteProgress || {};
  const players = (s.players || []).filter(p => !p.spectator);

  for (const p of players) {
    const prog = progress[p.id];
    const row = document.createElement("div");
    row.className = "cc-vote-player";

    const av = document.createElement("div");
    av.style.cssText = "flex-shrink:0;";
    av.appendChild(makeAvEl(p.avatar, p.name, 22));
    row.appendChild(av);

    const nm = document.createElement("span");
    nm.className = "cc-vote-player-name";
    nm.textContent = p.name;
    row.appendChild(nm);

    const st = document.createElement("span");
    if (!prog) {
      st.className = "cc-vote-remaining"; st.textContent = "…";
    } else if (prog.done) {
      st.className = "cc-vote-status"; st.textContent = "✅";
    } else {
      st.className = "cc-vote-remaining"; st.textContent = prog.remaining + " restant" + (prog.remaining > 1 ? "s" : "");
    }
    row.appendChild(st);
    panel.appendChild(row);
  }
}

function renderCorrResults(results, answers) {
  const list = $("corrAnswersList");
  list.innerHTML = "";
  for (const r of results) {
    const card = document.createElement("div"); card.className = "cc-ans-card";
    const ans = answers.find(a => a.clientId === r.clientId);
    const top = document.createElement("div"); top.className = "cc-ans-top";
    const avWrap = document.createElement("div"); avWrap.className = "cc-ans-avatar";
    avWrap.appendChild(makeAvEl(ans ? ans.avatar : null, r.name, 30)); top.appendChild(avWrap);
    const nm = document.createElement("span"); nm.className = "cc-ans-name"; nm.textContent = r.name; top.appendChild(nm);
    card.appendChild(top);

    if (r.verdict === "singer") {
      const txt = document.createElement("div"); txt.className = "cc-ans-text"; txt.style.color = "var(--buzz)"; txt.textContent = "🎤 (chanteur)"; card.appendChild(txt);
    } else if (r.verdict === "petit_bac" && r.catResults) {
      // Show per-category results
      for (const [cat, cv] of Object.entries(r.catResults)) {
        const row = document.createElement("div"); row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px;";
        const catL = document.createElement("span"); catL.style.cssText = "font-size:12px;font-weight:700;color:var(--muted);width:100px;flex-shrink:0;text-align:right;"; catL.textContent = cat; row.appendChild(catL);
        const valL = document.createElement("span"); valL.style.cssText = "flex:1;font-size:13px;padding:3px 8px;background:var(--stage);border-radius:6px;"; valL.textContent = cv.text || "(vide)"; row.appendChild(valL);
        const badge = document.createElement("span"); badge.className = "cc-ans-verdict verd-" + cv.verdict;
        badge.textContent = cv.verdict === "vrai" ? "✅ +1" : cv.verdict === "honte" ? "🍅 −1" : cv.verdict === "tie" ? "⚖️" : "❌ 0";
        row.appendChild(badge); card.appendChild(row);
      }
      if (r.bonusPetitBac) {
        const bonusEl = document.createElement("div");
        bonusEl.style.cssText = "margin-top:8px;padding:8px 12px;background:linear-gradient(135deg,rgba(255,201,77,.2),rgba(39,211,144,.2));border:1px solid var(--go);border-radius:10px;text-align:center;font-weight:700;font-size:14px;";
        bonusEl.textContent = "🎯 PERFECT ! +1 bonus";
        card.appendChild(bonusEl);
      }
    } else {
      const txt = document.createElement("div"); txt.className = "cc-ans-text" + (r.text ? "" : " empty");
      txt.textContent = r.text || "(pas de réponse)"; card.appendChild(txt);
      const badge = document.createElement("span");
      badge.className = "cc-ans-verdict verd-" + r.verdict;
      badge.textContent = r.verdict === "vrai" ? "✅ +1" : r.verdict === "honte" ? "🍅 −1" : r.verdict === "tie" ? "⚖️ Égalité" : "❌ 0";
      card.appendChild(badge);
    }
    list.appendChild(card);
  }
}

function renderTiePanel(tieData) {
  const el = $("tieList"); el.innerHTML = "";
  for (const t of tieData.tied) {
    const row = document.createElement("div"); row.className = "cc-tie-btn";
    const nm = document.createElement("span"); nm.className = "cc-tie-name"; nm.textContent = t.name; row.appendChild(nm);
    const tx = document.createElement("span"); tx.className = "cc-tie-text"; tx.textContent = t.text || "(vide)"; row.appendChild(tx);
    for (const v of ["vrai", "honte", "faux"]) {
      const btn = document.createElement("button");
      btn.className = "cc-tie-pick cc-tie-" + v;
      btn.textContent = v === "vrai" ? "+1" : v === "honte" ? "🍅" : "0";
      btn.addEventListener("click", () => send({ type: "chaos_resolve_tie", clientId: t.clientId, verdict: v }));
      row.appendChild(btn);
    }
    el.appendChild(row);
  }
}

/* ---------- Results ---------- */
function renderResults(s) {
  const scores = $("finalScores"); scores.innerHTML = "";
  const rankEmoji = ["🥇","🥈","🥉"];
  (s.scores || []).forEach((sc, i) => {
    const row = document.createElement("div"); row.className = "cc-score-row";
    const rank = document.createElement("span");
    rank.className = "cc-score-rank" + (i===0?" gold":i===1?" silver":i===2?" bronze":"");
    rank.textContent = rankEmoji[i] || (i+1); row.appendChild(rank);
    const nm = document.createElement("span"); nm.className = "cc-score-name"; nm.textContent = sc.name; row.appendChild(nm);
    const pts = document.createElement("span"); pts.className = "cc-score-pts"; pts.textContent = sc.pts + " pt" + (sc.pts!==1?"s":""); row.appendChild(pts);
    scores.appendChild(row);
  });
  const shame = s.shameBoard || [];
  const shameSection = $("shameSection");
  if (shame.length) {
    shameSection.style.display = "";
    const el = $("shameScores"); el.innerHTML = "";
    for (const sh of shame) {
      const row = document.createElement("div"); row.style.cssText = "display:flex;justify-content:space-between;padding:10px 14px;background:rgba(255,201,77,.08);border:1px solid rgba(255,201,77,.2);border-radius:10px;margin-bottom:8px;";
      row.innerHTML = `<span>🍅 ${escHtml(sh.name)}</span><span style="font-family:var(--display);color:var(--spotlight);">${sh.pts} pt</span>`;
      el.appendChild(row);
    }
  } else { shameSection.style.display = "none"; }
  $("resultsAdminBar").style.display = isAdmin ? "" : "none";
}

/* ---------- Utils ---------- */
function typeLabel(type) {
  return {
    culture_gen: "Culture générale",
    vrai_faux: "Vrai ou Faux",
    plus_proche: "Le plus proche",
    susceptible: "Qui est le plus susceptible…",
    anagramme: "Anagramme infernal",
    google_trad: "Google Trad foireux",
    devine_film: "Devine le film / série",
    qui_a_dit: "Qui a dit ça ?",
    chronologie: "Chronologie",
    petit_bac: "Petit Bac",
    meme_mystere: "Mème mystère",
    devine_jeu_img: "Devine la jacquette",
    blind_test: "Blind Test inversé",
  }[type] || type;
}
function escHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

function joinRoom(code) {
  code = (code || "").toUpperCase().trim();
  if (code.length !== 4) { toast("Code à 4 caractères"); return; }
  $("joinErr").style.display = "none";
  send({ type: "chaos_join", room: code });
}

/* ---------- Events ---------- */
$("btnCreate").addEventListener("click", () => {
  send({ type: "chaos_create", questionCount: 20 }); // default 20, changeable in lobby
});
$("btnJoin").addEventListener("click", () => joinRoom($("joinCode").value));
$("joinCode").addEventListener("keydown", e => { if (e.key === "Enter") joinRoom($("joinCode").value); });
$("btnReady").addEventListener("click", () => send({ type: "chaos_ready" }));
$("btnForceStart").addEventListener("click", () => send({ type: "chaos_start" }));
$("lobbyQCount").addEventListener("change", () => {
  let v = parseInt($("lobbyQCount").value) || 20;
  v = Math.max(5, Math.min(100, v));
  $("lobbyQCount").value = v;
  send({ type: "chaos_set_qcount", count: v });
});
$("quitBtn").addEventListener("click", () => send({ type: "chaos_leave" }));
$("btnNextCorr").addEventListener("click", () => send({ type: "chaos_next_correction" }));
$("btnPlayAgain").addEventListener("click", () => send({ type: "chaos_resetlobby" }));

// Answer input — live update, no submit button
$("answerInput").addEventListener("input", () => {
  const qIdx = gameState ? gameState.currentQ : -1;
  if (qIdx < 0) return;
  myAnswers[qIdx] = $("answerInput").value;
  send({ type: "chaos_answer", text: $("answerInput").value });
});

// VF — re-clickable
$("qVF").addEventListener("click", e => {
  const btn = e.target.closest(".cc-vf-btn");
  if (!btn) return;
  const val = btn.dataset.val;
  const qIdx = gameState ? gameState.currentQ : -1;
  myVFChoice[qIdx] = val;
  $("qVF").querySelectorAll(".cc-vf-btn").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  send({ type: "chaos_answer", text: val });
});

/* ---------- Profile modal ---------- */
let currentUser = null;

function openProfile() {
  $("profileModal").classList.remove("hidden");
  loadHistory();
}
function closeProfile() { $("profileModal").classList.add("hidden"); }

$("bzUserInfo").addEventListener("click", openProfile);
$("closeProfile").addEventListener("click", closeProfile);
$("profileModal").addEventListener("click", e => { if (e.target.id === "profileModal") closeProfile(); });

$("savePseudo").addEventListener("click", async () => {
  const pseudo = $("pseudoInput").value.trim();
  const msg = $("pseudoMsg");
  const r = await fetch("/api/profile/pseudo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pseudo }) });
  const data = await r.json();
  if (r.ok) {
    currentUser.pseudo = pseudo; applyUser(currentUser);
    msg.textContent = "Pseudo mis à jour !"; msg.className = "hint ok";
    setTimeout(() => { msg.textContent = ""; }, 2000);
  } else { msg.textContent = data.error || "Erreur"; msg.className = "hint err"; }
});

$("avatarFile").addEventListener("change", async e => {
  const file = e.target.files && e.target.files[0]; if (!file) return;
  const fd = new FormData(); fd.append("avatar", file);
  const r = await fetch("/api/profile/avatar", { method: "POST", body: fd });
  const data = await r.json();
  if (r.ok) { currentUser.avatar = data.avatar; applyUser(currentUser); toast("Photo mise à jour !"); }
  else toast("Erreur upload : " + (data.error || "?"));
});

$("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  location.href = "/auth.html";
});

function applyUser(user) {
  currentUser = user;
  myName = user.pseudo; myAvatar = user.avatar || null;
  $("headerPseudo").textContent = user.pseudo;
  $("avatarFallback").textContent = user.pseudo[0].toUpperCase();
  $("profileAvatarFallback").textContent = user.pseudo[0].toUpperCase();
  $("pseudoInput").value = user.pseudo;
  if (user.avatar) {
    $("headerAvatar").src = "/avatars/" + user.avatar; $("headerAvatar").style.display = "";
    $("avatarFallback").style.display = "none";
    $("profileAvatarImg").src = "/avatars/" + user.avatar; $("profileAvatarImg").style.display = "block";
    $("profileAvatarFallback").style.display = "none";
  } else {
    $("headerAvatar").style.display = "none"; $("avatarFallback").style.display = "flex";
    $("profileAvatarImg").style.display = "none"; $("profileAvatarFallback").style.display = "flex";
  }
}

async function loadHistory() {
  const r = await fetch("/api/profile/history");
  const { games } = await r.json();
  const list = $("historyList");
  if (!games || !games.length) { list.innerHTML = '<span class="empty">Aucune partie jouée.</span>'; return; }
  list.innerHTML = "";
  games.forEach(g => {
    const date = new Date(g.played_at).toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit", year:"2-digit", hour:"2-digit", minute:"2-digit" });
    const gameName = g.game_type === "blindzik" ? "BlindZik" : g.game_type === "chaos" ? "Chaos Culture" : g.game_type;
    const scoresStr = (g.scores || []).map(s => s.name + " " + s.points + "pt").join(" · ");
    const row = document.createElement("div"); row.className = "history-row";
    row.innerHTML = `<div class="hr-top"><span class="hr-game">${gameName}</span>${g.winner ? '<span class="hr-winner">🏆 ' + escHtml(g.winner) + "</span>" : ""}<span class="hr-date">${date}</span></div><div class="hr-scores">${scoresStr || "Pas de scores"}</div>`;
    list.appendChild(row);
  });
}

/* ---------- Boot ---------- */
fetch("/api/auth/me").then(r => r.json()).then(({ user }) => {
  if (!user) { location.href = "/auth.html"; return; }
  applyUser(user);
  connect();
  showSection("home");
});
