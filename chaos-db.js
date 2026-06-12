/* ============================================================
   Chaos Culture — Banque de questions (sql.js)
   Types Lot 1 : culture_gen, vrai_faux, plus_proche, susceptible
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const initSqlJs = require("sql.js");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "chaos.sqlite");

let db = null;

/* ---------- Seed questions ---------- */
const SEED_QUESTIONS = [
  // --- culture_gen (QCM) ---
  { type: "culture_gen", question: "Quelle est la capitale de l'Australie ?", answer: "canberra", choices: JSON.stringify(["Sydney","Melbourne","Canberra","Brisbane"]) },
  { type: "culture_gen", question: "Combien d'os compte le corps humain adulte ?", answer: "206", choices: JSON.stringify(["196","206","215","230"]) },
  { type: "culture_gen", question: "Quel pays a la plus grande superficie du monde ?", answer: "russie", choices: JSON.stringify(["Canada","Chine","Russie","États-Unis"]) },
  { type: "culture_gen", question: "Qui a peint la Joconde ?", answer: "leonard de vinci", choices: JSON.stringify(["Michel-Ange","Raphaël","Leonard de Vinci","Botticelli"]) },
  { type: "culture_gen", question: "En quelle année l'homme a-t-il marché sur la Lune pour la première fois ?", answer: "1969", choices: JSON.stringify(["1965","1967","1969","1971"]) },
  { type: "culture_gen", question: "Quel élément chimique a le symbole 'Au' ?", answer: "or", choices: JSON.stringify(["Argent","Aluminium","Or","Argon"]) },
  { type: "culture_gen", question: "Quelle planète est la plus proche du Soleil ?", answer: "mercure", choices: JSON.stringify(["Vénus","Mercure","Terre","Mars"]) },
  { type: "culture_gen", question: "Qui a écrit 'Les Misérables' ?", answer: "victor hugo", choices: JSON.stringify(["Émile Zola","Gustave Flaubert","Victor Hugo","Alexandre Dumas"]) },
  { type: "culture_gen", question: "Combien de côtés a un hexagone ?", answer: "6", choices: JSON.stringify(["5","6","7","8"]) },
  { type: "culture_gen", question: "Quelle est la langue la plus parlée dans le monde ?", answer: "mandarin", choices: JSON.stringify(["Anglais","Espagnol","Mandarin","Hindi"]) },

  // --- vrai_faux ---
  { type: "vrai_faux", question: "Le Grand Mur de Chine est visible depuis l'espace à l'œil nu.", answer: "faux", choices: null },
  { type: "vrai_faux", question: "Les chauves-souris sont des mammifères.", answer: "vrai", choices: null },
  { type: "vrai_faux", question: "Le soleil est une planète.", answer: "faux", choices: null },
  { type: "vrai_faux", question: "L'eau bout à 100°C au niveau de la mer.", answer: "vrai", choices: null },
  { type: "vrai_faux", question: "L'Afrique est le plus grand continent du monde.", answer: "faux", choices: null },
  { type: "vrai_faux", question: "Mozart était autrichien.", answer: "vrai", choices: null },
  { type: "vrai_faux", question: "Les dauphins sont des poissons.", answer: "faux", choices: null },
  { type: "vrai_faux", question: "Le Mont Everest est la montagne la plus haute du monde.", answer: "vrai", choices: null },
  { type: "vrai_faux", question: "Le sang humain est naturellement bleu dans les veines.", answer: "faux", choices: null },
  { type: "vrai_faux", question: "Paris est la ville la plus visitée du monde.", answer: "vrai", choices: null },

  // --- plus_proche ---
  { type: "plus_proche", question: "En quelle année a été fondée la ville de Paris ?", answer: "250", choices: null },
  { type: "plus_proche", question: "Combien de km sépare Paris de Tokyo ?", answer: "9720", choices: null },
  { type: "plus_proche", question: "Quelle est la vitesse de la lumière en km/s ?", answer: "300000", choices: null },
  { type: "plus_proche", question: "Combien de pays y a-t-il dans l'Union Européenne ?", answer: "27", choices: null },
  { type: "plus_proche", question: "En quelle année a été construit la Tour Eiffel ?", answer: "1889", choices: null },
  { type: "plus_proche", question: "Combien de dents a un adulte humain (y compris les dents de sagesse) ?", answer: "32", choices: null },
  { type: "plus_proche", question: "Quelle est la profondeur maximale de l'océan Pacifique en mètres ?", answer: "11034", choices: null },
  { type: "plus_proche", question: "Combien de litres de sang le cœur pompe-t-il par jour ?", answer: "7500", choices: null },

  // --- susceptible ---
  { type: "susceptible", question: "Qui est le plus susceptible de manger de la nourriture tombée par terre ?", answer: null, choices: null },
  { type: "susceptible", question: "Qui est le plus susceptible de se perdre dans son propre quartier ?", answer: null, choices: null },
  { type: "susceptible", question: "Qui est le plus susceptible de parler à son animal de compagnie comme à un humain ?", answer: null, choices: null },
  { type: "susceptible", question: "Qui est le plus susceptible de pleurer devant un film Disney ?", answer: null, choices: null },
  { type: "susceptible", question: "Qui est le plus susceptible de googler des symptômes et se croire mourant ?", answer: null, choices: null },
  { type: "susceptible", question: "Qui est le plus susceptible d'envoyer un message au mauvais destinataire ?", answer: null, choices: null },
  { type: "susceptible", question: "Qui est le plus susceptible de rater son réveil un jour important ?", answer: null, choices: null },
  { type: "susceptible", question: "Qui est le plus susceptible de finir la nuit à danser sur une table ?", answer: null, choices: null },
  { type: "susceptible", question: "Qui est le plus susceptible de commander une pizza à 3h du matin ?", answer: null, choices: null },
  { type: "susceptible", question: "Qui est le plus susceptible de se battre avec son GPS ?", answer: null, choices: null },
];

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
    CREATE TABLE IF NOT EXISTS chaos_questions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT,
      choices TEXT,
      created_at INTEGER
    );
  `);
  // Seed si vide
  const count = q1("SELECT COUNT(*) as n FROM chaos_questions");
  if (!count || count.n === 0) {
    for (const q of SEED_QUESTIONS) {
      const id = "q" + crypto.randomBytes(4).toString("hex");
      db.run(
        "INSERT INTO chaos_questions (id,type,question,answer,choices,created_at) VALUES (?,?,?,?,?,?)",
        [id, q.type, q.question, q.answer || null, q.choices || null, Date.now()]
      );
    }
    persist();
  }
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const data = db.export();
      fs.writeFileSync(DB_FILE, Buffer.from(data));
    } catch (e) { console.error("chaos-db save error:", e.message); }
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

/* ---------- API ---------- */

function getRandomQuestions(count, types = null) {
  let sql = "SELECT * FROM chaos_questions";
  const params = [];
  if (types && types.length) {
    sql += " WHERE type IN (" + types.map(() => "?").join(",") + ")";
    params.push(...types);
  }
  sql += " ORDER BY RANDOM() LIMIT ?";
  params.push(count);
  return qAll(sql, params).map(parseQuestion);
}

function parseQuestion(r) {
  return {
    id: r.id,
    type: r.type,
    question: r.question,
    answer: r.answer || null,
    choices: r.choices ? JSON.parse(r.choices) : null,
  };
}

function getAllQuestions() {
  return qAll("SELECT * FROM chaos_questions ORDER BY type, question").map(parseQuestion);
}

function addQuestion(type, question, answer, choices) {
  const id = "q" + crypto.randomBytes(4).toString("hex");
  db.run(
    "INSERT INTO chaos_questions (id,type,question,answer,choices,created_at) VALUES (?,?,?,?,?,?)",
    [id, type, question, answer || null, choices ? JSON.stringify(choices) : null, Date.now()]
  );
  persist();
  return id;
}

function deleteQuestion(id) {
  db.run("DELETE FROM chaos_questions WHERE id=?", [id]);
  persist();
}

module.exports = { load, getRandomQuestions, getAllQuestions, addQuestion, deleteQuestion };
