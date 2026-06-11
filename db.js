/* ============================================================
   BlindZik — Stockage persistant (fichier JSON) + comptes
   Comptes : pseudo (unique, modifiable) + PIN 4 chiffres (haché).
   Historique global des parties + nombre de victoires par joueur.
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "db.json");

let data = { users: {}, sessions: {}, games: [] };

function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE)) data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (e) { console.error("db load error:", e.message); }
  data.users = data.users || {};
  data.sessions = data.sessions || {};
  data.games = data.games || [];
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(FILE, JSON.stringify(data)); }
    catch (e) { console.error("db save error:", e.message); }
  }, 120);
}

/* ---------- PIN ---------- */
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(String(pin), salt, 64).toString("hex");
  return salt + ":" + h;
}
function verifyPin(pin, stored) {
  try {
    const [salt, h] = String(stored).split(":");
    const h2 = crypto.scryptSync(String(pin), salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(h, "hex"), Buffer.from(h2, "hex"));
  } catch { return false; }
}
function validPin(pin) { return /^[0-9]{4}$/.test(String(pin)); }
function validPseudo(p) { const s = String(p || "").trim(); return s.length >= 2 && s.length <= 20; }

/* ---------- Comptes ---------- */
function findByPseudo(pseudo) {
  const k = String(pseudo).trim().toLowerCase();
  return Object.values(data.users).find((u) => u.pseudo.toLowerCase() === k) || null;
}
function pseudoTaken(pseudo, exceptId) {
  const k = String(pseudo).trim().toLowerCase();
  return Object.values(data.users).some((u) => u.pseudo.toLowerCase() === k && u.id !== exceptId);
}
function createUser(pseudo, pin) {
  const id = "u" + crypto.randomBytes(6).toString("hex");
  data.users[id] = { id, pseudo: String(pseudo).trim(), pin: hashPin(pin), wins: 0, createdAt: Date.now() };
  save();
  return data.users[id];
}
function getUser(id) { return data.users[id] || null; }
function setPseudo(userId, pseudo) {
  if (data.users[userId]) { data.users[userId].pseudo = String(pseudo).trim(); save(); }
}
function addWin(userId) {
  if (data.users[userId]) { data.users[userId].wins = (data.users[userId].wins || 0) + 1; save(); }
}

/* ---------- Sessions ---------- */
function newSession(userId) {
  const t = crypto.randomBytes(24).toString("hex");
  data.sessions[t] = userId;
  save();
  return t;
}
function userByToken(t) {
  const id = t && data.sessions[t];
  return id ? (data.users[id] || null) : null;
}
function dropSession(t) { if (t && data.sessions[t]) { delete data.sessions[t]; save(); } }

/* ---------- Historique ---------- */
function recordGame(g) {
  data.games.unshift(g);
  if (data.games.length > 500) data.games.length = 500;
  save();
}
function recentGames(n) { return data.games.slice(0, n || 50); }
function winsBoard() {
  return Object.values(data.users)
    .map((u) => ({ pseudo: u.pseudo, wins: u.wins || 0 }))
    .sort((a, b) => b.wins - a.wins || a.pseudo.localeCompare(b.pseudo));
}

module.exports = {
  load, save, hashPin, verifyPin, validPin, validPseudo,
  findByPseudo, pseudoTaken, createUser, getUser, setPseudo, addWin,
  newSession, userByToken, dropSession,
  recordGame, recentGames, winsBoard
};
