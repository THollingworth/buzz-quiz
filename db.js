/* ============================================================
   Suce Pute MiniGames — SQLite (sql.js) persistence
   Users: mail + bcrypt password + pseudo + avatar
   Sessions: httpOnly cookie tokens
   Games: historique parties BlindZik
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const initSqlJs = require("sql.js");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "app.sqlite");

let db = null;

async function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    const buf = fs.readFileSync(DB_FILE);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      mail TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      pseudo TEXT NOT NULL,
      avatar TEXT DEFAULT NULL,
      wins INTEGER DEFAULT 0,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      game_type TEXT NOT NULL,
      played_at INTEGER,
      players TEXT,
      winner TEXT,
      scores TEXT
    );
  `);
  persist();
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const data = db.export();
      fs.writeFileSync(DB_FILE, Buffer.from(data));
    } catch (e) { console.error("db save error:", e.message); }
  }, 200);
}

function q1(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) { const r = stmt.getAsObject(); stmt.free(); return r; }
  stmt.free(); return null;
}
function qAll(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  stmt.bind(params);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

/* ---------- Validation ---------- */
function validMail(m) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(m || "")); }
function validPseudo(p) { const s = String(p || "").trim(); return s.length >= 2 && s.length <= 20; }
function validPassword(p) { return String(p || "").length >= 6; }

/* ---------- Users ---------- */
function findByMail(mail) {
  return q1("SELECT * FROM users WHERE LOWER(mail)=LOWER(?)", [mail]);
}
function findById(id) {
  return q1("SELECT * FROM users WHERE id=?", [id]);
}
function pseudoTaken(pseudo, exceptId) {
  const r = q1("SELECT id FROM users WHERE LOWER(pseudo)=LOWER(?) AND id!=?", [pseudo, exceptId || ""]);
  return !!r;
}
async function createUser(mail, password, pseudo) {
  const id = "u" + crypto.randomBytes(6).toString("hex");
  const hash = await bcrypt.hash(password, 10);
  run("INSERT INTO users (id,mail,password,pseudo,wins,created_at) VALUES (?,?,?,?,0,?)",
    [id, mail.toLowerCase().trim(), hash, pseudo.trim(), Date.now()]);
  return findById(id);
}
async function checkPassword(mail, password) {
  const user = findByMail(mail);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password);
  return ok ? user : null;
}
function setPseudo(userId, pseudo) {
  run("UPDATE users SET pseudo=? WHERE id=?", [pseudo.trim(), userId]);
}
function setAvatar(userId, filename) {
  run("UPDATE users SET avatar=? WHERE id=?", [filename, userId]);
}
function addWin(userId) {
  run("UPDATE users SET wins=wins+1 WHERE id=?", [userId]);
}
function getUser(id) { return findById(id); }

/* ---------- Sessions ---------- */
function newSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  run("INSERT INTO sessions (token,user_id,created_at) VALUES (?,?,?)",
    [token, userId, Date.now()]);
  return token;
}
function userByToken(token) {
  if (!token) return null;
  const s = q1("SELECT user_id FROM sessions WHERE token=?", [token]);
  if (!s) return null;
  return findById(s.user_id);
}
function dropSession(token) {
  if (token) run("DELETE FROM sessions WHERE token=?", [token]);
}

/* ---------- Games ---------- */
function recordGame(g) {
  const id = "g" + crypto.randomBytes(6).toString("hex");
  run("INSERT INTO games (id,game_type,played_at,players,winner,scores) VALUES (?,?,?,?,?,?)",
    [id, g.game_type || "blindzik", g.played_at || Date.now(),
     JSON.stringify(g.players || []), g.winner || "", JSON.stringify(g.scores || [])]);
}
function recentGames(n) {
  const rows = qAll("SELECT * FROM games ORDER BY played_at DESC LIMIT ?", [n || 50]);
  return rows.map(r => ({
    ...r,
    players: JSON.parse(r.players || "[]"),
    scores: JSON.parse(r.scores || "[]")
  }));
}
function userGames(userId, n) {
  // games where user participated (pseudo stored in scores array)
  const all = recentGames(500);
  // filter by userId presence in scores
  return all.filter(g => g.scores.some(s => s.userId === userId)).slice(0, n || 10);
}

module.exports = {
  load, persist, validMail, validPseudo, validPassword,
  findByMail, findById, pseudoTaken, createUser, checkPassword,
  setPseudo, setAvatar, addWin, getUser,
  newSession, userByToken, dropSession,
  recordGame, recentGames, userGames
};
