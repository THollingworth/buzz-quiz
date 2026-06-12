/* ============================================================
   Chaos Culture — Banque de questions (sql.js)
   Types Lot 1 : culture_gen, vrai_faux, plus_proche, susceptible
   Types Lot 2 : anagramme, google_trad, devine_film, devine_jeu, qui_a_dit, chronologie
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

  // --- anagramme --- (complexes, forcés à reseed)
  { type: "anagramme", question: "TNEMEPPOVEELD", answer: "DÉVELOPPEMENT", choices: JSON.stringify({ hint: "Croissance progressive" }) },
  { type: "anagramme", question: "EUQITATSAMEHM", answer: "MATHÉMATIQUES", choices: JSON.stringify({ hint: "Matière avec des chiffres" }) },
  { type: "anagramme", question: "NOITACIFITREC", answer: "CERTIFICATION", choices: JSON.stringify({ hint: "Document validant une compétence" }) },
  { type: "anagramme", question: "ERTÈMOREHMT", answer: "THERMOMÈTRE", choices: JSON.stringify({ hint: "Mesure la température" }) },
  { type: "anagramme", question: "TNEMEGANÉGRA", answer: "AMÉNAGEMENT", choices: JSON.stringify({ hint: "Organisation d'un espace" }) },
  { type: "anagramme", question: "EUQIGOLOHCYSP", answer: "PSYCHOLOGIQUE", choices: JSON.stringify({ hint: "Relatif au mental" }) },
  { type: "anagramme", question: "NOITARÉDÉFNOC", answer: "CONFÉDÉRATION", choices: JSON.stringify({ hint: "Union d'États ou associations" }) },
  { type: "anagramme", question: "EUQITSALUATCEPS", answer: "SPECTACULAIRE", choices: JSON.stringify({ hint: "Impressionnant à voir" }) },
  { type: "anagramme", question: "NOITASINAGRO", answer: "ORGANISATION", choices: JSON.stringify({ hint: "Mise en ordre systématique" }) },
  { type: "anagramme", question: "TNEMETSEVILBA", answer: "AVEUGLÉMENT", choices: JSON.stringify({ hint: "Sans voir, sans discernement" }) },

  // --- google_trad --- (chansons ultra connues, traductions simples et drôles)
  { type: "google_trad", question: "Arrêtez ! Au nom de l'amour.", answer: "Stop! In the Name of Love — The Supremes", choices: null },
  { type: "google_trad", question: "Si tu aimes beaucoup cet objet, tu aurais dû poser une bague dessus.", answer: "Single Ladies — Beyoncé", choices: null },
  { type: "google_trad", question: "Bébé, bébé, bébé, ohhh.", answer: "Baby — Justin Bieber", choices: null },
  { type: "google_trad", question: "Je suis trop sexy pour ma chemise.", answer: "I'm Too Sexy — Right Said Fred", choices: null },
  { type: "google_trad", question: "Rouler dans la profondeur.", answer: "Rolling in the Deep — Adele", choices: null },
  { type: "google_trad", question: "Vous avez été frappé par un criminel doux.", answer: "Smooth Criminal — Michael Jackson", choices: null },
  { type: "google_trad", question: "Allumer mon feu intérieur.", answer: "Light My Fire — The Doors", choices: null },
  { type: "google_trad", question: "Elle n'est pas une fille, pas encore une femme.", answer: "I'm Not a Girl, Not Yet a Woman — Britney Spears", choices: null },
  { type: "google_trad", question: "Je veux te vouloir. J'ai besoin que tu aies besoin de moi.", answer: "I Want You to Want Me — Cheap Trick", choices: null },
  { type: "google_trad", question: "Quelqu'un comme toi.", answer: "Someone Like You — Adele", choices: null },

  // --- devine_film ---
  // question = synopsis, answer = titre
  { type: "devine_film", question: "Un jouet cowboy est jaloux du nouvel astronaute arrivé dans la chambre et ils se retrouvent perdus ensemble.", answer: "Toy Story", choices: null },
  { type: "devine_film", question: "Un homme se réveille chaque matin le même jour encore et encore dans une petite ville enneigée.", answer: "Un jour sans fin (Groundhog Day)", choices: null },
  { type: "devine_film", question: "Un comptable timide découvre qu'il est en réalité un assassin professionnel ayant perdu la mémoire.", answer: "Wanted", choices: null },
  { type: "devine_film", question: "Des dinosaures sont recréés sur une île touristique et s'échappent de leurs enclos.", answer: "Jurassic Park", choices: null },
  { type: "devine_film", question: "Un enfant seul à la maison doit défendre sa maison contre deux cambrioleurs incompétents.", answer: "Maman j'ai raté l'avion (Home Alone)", choices: null },
  { type: "devine_film", question: "Une princesse aux cheveux magiques est enfermée dans une tour par une sorcière qui lui vole sa jeunesse.", answer: "Raiponce (Tangled)", choices: null },
  { type: "devine_film", question: "Un détective privé est embauché pour retrouver un poisson rouge dans une ville peuplée de personnages animés.", answer: "Qui veut la peau de Roger Rabbit ?", choices: null },
  { type: "devine_film", question: "Un homme construit un radeau de fortune et part en mer avec un tigre du Bengale après un naufrage.", answer: "L'Odyssée de Pi (Life of Pi)", choices: null },

  // --- devine_jeu ---
  // question = description, answer = titre du jeu
  { type: "devine_jeu", question: "Tu construis des abris et ramasses des ressources le jour, et tu combats des monstres la nuit dans un monde de blocs.", answer: "Minecraft", choices: null },
  { type: "devine_jeu", question: "100 joueurs sautent d'un bus volant sur une île et s'éliminent jusqu'au dernier survivant.", answer: "Fortnite", choices: null },
  { type: "devine_jeu", question: "Un plombier moustachu saute sur des champignons et des tortues pour sauver une princesse.", answer: "Super Mario Bros", choices: null },
  { type: "devine_jeu", question: "Tu joues un détective qui résout des meurtres en interrogeant des suspects dans les années 40 à Los Angeles.", answer: "L.A. Noire", choices: null },
  { type: "devine_jeu", question: "Des guerriers de diverses franchises combattent dans des arènes colorées avec des attaques spéciales.", answer: "Super Smash Bros", choices: null },
  { type: "devine_jeu", question: "Un chasseur de primes galactique explore des planètes hostiles en vue à la première personne.", answer: "Metroid Prime", choices: null },
  { type: "devine_jeu", question: "Tu gères une ville en construisant des routes, des maisons et des services publics pour satisfaire tes habitants.", answer: "SimCity", choices: null },
  { type: "devine_jeu", question: "Des petites créatures colorées sont lancées comme des projectiles sur des cochons verts cachés derrière des structures.", answer: "Angry Birds", choices: null },

  // --- qui_a_dit --- (célébrités ultra connues, citations simples)
  { type: "qui_a_dit", question: "\"Je reviendrai.\"", answer: "Terminator / Arnold Schwarzenegger", choices: null },
  { type: "qui_a_dit", question: "\"Que la Force soit avec toi.\"", answer: "Star Wars", choices: null },
  { type: "qui_a_dit", question: "\"La vie, c'est comme une boîte de chocolats.\"", answer: "Forrest Gump", choices: null },
  { type: "qui_a_dit", question: "\"Un petit pas pour l'homme, un grand pas pour l'humanité.\"", answer: "Neil Armstrong", choices: null },
  { type: "qui_a_dit", question: "\"Je suis le roi du monde !\"", answer: "Titanic / Leonardo DiCaprio", choices: null },
  { type: "qui_a_dit", question: "\"Shaken, not stirred.\"", answer: "James Bond", choices: null },
  { type: "qui_a_dit", question: "\"Houston, on a un problème.\"", answer: "Apollo 13", choices: null },
  { type: "qui_a_dit", question: "\"Hakuna Matata.\"", answer: "Le Roi Lion", choices: null },
  { type: "qui_a_dit", question: "\"You shall not pass!\"", answer: "Gandalf / Le Seigneur des Anneaux", choices: null },
  { type: "qui_a_dit", question: "\"Avec grand pouvoir vient grande responsabilité.\"", answer: "Spider-Man", choices: null },
  { type: "qui_a_dit", question: "\"Je suis ton père.\"", answer: "Dark Vador / Star Wars", choices: null },
  { type: "qui_a_dit", question: "\"Yippee-ki-yay.\"", answer: "Die Hard / Bruce Willis", choices: null },

  // --- google_trad --- (chansons ultra connues, traductions drôles)
  { type: "google_trad", question: "Arrêtez ! Au nom de l'amour, avant de me briser le cœur.", answer: "Stop! In the Name of Love — The Supremes", choices: null },
  { type: "google_trad", question: "Elle n'est pas une fille, elle est pas encore une femme.", answer: "I'm Not a Girl, Not Yet a Woman — Britney Spears", choices: null },
  { type: "google_trad", question: "Je veux que tu me veuilles. Je t'ai besoin de me nécessiter.", answer: "I Want You to Want Me — Cheap Trick", choices: null },
  { type: "google_trad", question: "Allumer mon feu intérieur.", answer: "Light My Fire — The Doors", choices: null },
  { type: "google_trad", question: "Si tu aimes beaucoup cet objet, tu aurais dû poser une bague dessus.", answer: "Single Ladies — Beyoncé", choices: null },
  { type: "google_trad", question: "Bébé, bébé, bébé, ohhh.", answer: "Baby — Justin Bieber", choices: null },
  { type: "google_trad", question: "Je suis trop sexy pour ma chemise.", answer: "I'm Too Sexy — Right Said Fred", choices: null },
  { type: "google_trad", question: "Vous avez été frappé par un criminel doux.", answer: "Smooth Criminal — Michael Jackson", choices: null },
  { type: "google_trad", question: "Rouler dans la profondeur.", answer: "Rolling in the Deep — Adele", choices: null },
  { type: "google_trad", question: "Je suis sur le dessus du monde en regardant vers le bas sur la création.", answer: "Top of the World — Carpenters", choices: null },

  // --- anagramme --- (mots complexes, plus difficiles)
  { type: "anagramme", question: "TNEMEPPOVEELD", answer: "DÉVELOPPEMENT", choices: JSON.stringify({ hint: "Croissance progressive" }) },
  { type: "anagramme", question: "EUQITATSAMEHM", answer: "MATHÉMATIQUES", choices: JSON.stringify({ hint: "Matière scolaire avec des chiffres" }) },
  { type: "anagramme", question: "NOITACIFITREC", answer: "CERTIFICATION", choices: JSON.stringify({ hint: "Document qui valide une compétence" }) },
  { type: "anagramme", question: "ERTÈMOREHMT", answer: "THERMOMÈTRE", choices: JSON.stringify({ hint: "Mesure la température" }) },
  { type: "anagramme", question: "TNEMEGANÉGRA", answer: "AMÉNAGEMENT", choices: JSON.stringify({ hint: "Organisation d'un espace" }) },
  { type: "anagramme", question: "EUQIGOLOHCYSP", answer: "PSYCHOLOGIQUE", choices: JSON.stringify({ hint: "Relatif au mental" }) },
  { type: "anagramme", question: "NOITARÉDÉFNOC", answer: "CONFÉDÉRATION", choices: JSON.stringify({ hint: "Union d'États ou d'associations" }) },
  { type: "anagramme", question: "TNEMESUASIRP", answer: "SURPRENAMENT", choices: JSON.stringify({ hint: "De façon inattendue... SURPRENAMMENT !" }) },
  { type: "anagramme", question: "EUQITSALUATCEPS", answer: "SPECTACULAIRE", choices: JSON.stringify({ hint: "Impressionnant à voir" }) },
  { type: "anagramme", question: "NOITASINAGRO", answer: "ORGANISATION", choices: JSON.stringify({ hint: "Mise en ordre systématique" }) },

  // --- blind_test --- (très connues 1990-2020 FR+EN)
  { type: "blind_test", question: "Bohemian Rhapsody — Queen", answer: "Bohemian Rhapsody", choices: null },
  { type: "blind_test", question: "Smells Like Teen Spirit — Nirvana", answer: "Smells Like Teen Spirit", choices: null },
  { type: "blind_test", question: "Rolling in the Deep — Adele", answer: "Rolling in the Deep", choices: null },
  { type: "blind_test", question: "Lose Yourself — Eminem", answer: "Lose Yourself", choices: null },
  { type: "blind_test", question: "Shape of You — Ed Sheeran", answer: "Shape of You", choices: null },
  { type: "blind_test", question: "Blinding Lights — The Weeknd", answer: "Blinding Lights", choices: null },
  { type: "blind_test", question: "Uptown Funk — Bruno Mars", answer: "Uptown Funk", choices: null },
  { type: "blind_test", question: "Someone Like You — Adele", answer: "Someone Like You", choices: null },
  { type: "blind_test", question: "Happy — Pharrell Williams", answer: "Happy", choices: null },
  { type: "blind_test", question: "Thriller — Michael Jackson", answer: "Thriller", choices: null },
  { type: "blind_test", question: "Mr. Brightside — The Killers", answer: "Mr. Brightside", choices: null },
  { type: "blind_test", question: "Toxic — Britney Spears", answer: "Toxic", choices: null },
  { type: "blind_test", question: "Sex on Fire — Kings of Leon", answer: "Sex on Fire", choices: null },
  { type: "blind_test", question: "Somebody That I Used to Know — Gotye", answer: "Somebody That I Used to Know", choices: null },
  { type: "blind_test", question: "Chandelier — Sia", answer: "Chandelier", choices: null },
  { type: "blind_test", question: "Alors on danse — Stromae", answer: "Alors on danse", choices: null },
  { type: "blind_test", question: "Papaoutai — Stromae", answer: "Papaoutai", choices: null },
  { type: "blind_test", question: "Je veux — Zaz", answer: "Je veux", choices: null },
  { type: "blind_test", question: "La boulangère — Aya Nakamura", answer: "Djadja", choices: null },
  { type: "blind_test", question: "Bella — Maître Gims", answer: "Bella", choices: null },
  { type: "blind_test", question: "Alors on danse — Stromae", answer: "Alors on danse", choices: null },
  { type: "blind_test", question: "Mon amour — Kendji Girac", answer: "Mon amour", choices: null },
  { type: "blind_test", question: "Paradise — Coldplay", answer: "Paradise", choices: null },
  { type: "blind_test", question: "Counting Stars — OneRepublic", answer: "Counting Stars", choices: null },
  { type: "blind_test", question: "Stay With Me — Sam Smith", answer: "Stay With Me", choices: null },

  // --- chronologie ---
  // choices = JSON array d'événements dans l'ORDRE CORRECT
  // answer = null (évalué par vote)
  { type: "chronologie", question: "Remets ces événements dans l'ordre chronologique (du plus ancien au plus récent) :", answer: null,
    choices: JSON.stringify(["Invention de l'imprimerie (1450)", "Révolution française (1789)", "Première Guerre mondiale (1914)", "Chute du mur de Berlin (1989)"]) },
  { type: "chronologie", question: "Remets ces films dans l'ordre de sortie (du plus ancien au plus récent) :", answer: null,
    choices: JSON.stringify(["Jurassic Park (1993)", "Titanic (1997)", "The Dark Knight (2008)", "Avengers: Endgame (2019)"]) },
  { type: "chronologie", question: "Remets ces inventions dans l'ordre d'apparition (du plus ancien au plus récent) :", answer: null,
    choices: JSON.stringify(["Téléphone (1876)", "Télévision (1926)", "Internet (1969)", "Smartphone (2007)"]) },
  { type: "chronologie", question: "Remets ces consoles dans l'ordre de sortie (du plus ancien au plus récent) :", answer: null,
    choices: JSON.stringify(["Atari 2600 (1977)", "NES (1983)", "PlayStation (1994)", "Xbox 360 (2005)"]) },
  { type: "chronologie", question: "Remets ces événements spatiaux dans l'ordre (du plus ancien au plus récent) :", answer: null,
    choices: JSON.stringify(["Spoutnik 1 (1957)", "Premier homme dans l'espace (1961)", "Alunissage Apollo 11 (1969)", "Première Station spatiale internationale (2000)"]) },

  // --- petit_bac ---
  { type: "petit_bac", question: "A", answer: null, choices: JSON.stringify(["Prénom", "Ville", "Animal", "Film", "Métier"]) },
  { type: "petit_bac", question: "B", answer: null, choices: JSON.stringify(["Prénom", "Ville", "Animal", "Film", "Métier"]) },
  { type: "petit_bac", question: "C", answer: null, choices: JSON.stringify(["Prénom", "Pays", "Animal", "Série TV", "Marque"]) },
  { type: "petit_bac", question: "D", answer: null, choices: JSON.stringify(["Prénom", "Ville", "Animal", "Film", "Sport"]) },
  { type: "petit_bac", question: "E", answer: null, choices: JSON.stringify(["Prénom", "Pays", "Fruit/Légume", "Film", "Métier"]) },
  { type: "petit_bac", question: "F", answer: null, choices: JSON.stringify(["Prénom", "Ville", "Animal", "Série TV", "Marque"]) },
  { type: "petit_bac", question: "G", answer: null, choices: JSON.stringify(["Prénom", "Pays", "Animal", "Film", "Sport"]) },
  { type: "petit_bac", question: "H", answer: null, choices: JSON.stringify(["Prénom", "Ville", "Animal", "Film", "Métier"]) },
  { type: "petit_bac", question: "L", answer: null, choices: JSON.stringify(["Prénom", "Pays", "Animal", "Série TV", "Marque"]) },
  { type: "petit_bac", question: "M", answer: null, choices: JSON.stringify(["Prénom", "Ville", "Animal", "Film", "Sport"]) },
  { type: "petit_bac", question: "N", answer: null, choices: JSON.stringify(["Prénom", "Pays", "Fruit/Légume", "Film", "Métier"]) },
  { type: "petit_bac", question: "P", answer: null, choices: JSON.stringify(["Prénom", "Ville", "Animal", "Série TV", "Marque"]) },
  { type: "petit_bac", question: "R", answer: null, choices: JSON.stringify(["Prénom", "Pays", "Animal", "Film", "Sport"]) },
  { type: "petit_bac", question: "S", answer: null, choices: JSON.stringify(["Prénom", "Ville", "Animal", "Film", "Métier"]) },
  { type: "petit_bac", question: "T", answer: null, choices: JSON.stringify(["Prénom", "Pays", "Fruit/Légume", "Série TV", "Marque"]) },
  { type: "petit_bac", question: "V", answer: null, choices: JSON.stringify(["Prénom", "Ville", "Animal", "Film", "Sport"]) },

  // --- blind_test ---
  { type: "blind_test", question: "Bohemian Rhapsody — Queen", answer: "Bohemian Rhapsody", choices: null },
  { type: "blind_test", question: "Shape of You — Ed Sheeran", answer: "Shape of You", choices: null },
  { type: "blind_test", question: "Thriller — Michael Jackson", answer: "Thriller", choices: null },
  { type: "blind_test", question: "Hotel California — Eagles", answer: "Hotel California", choices: null },
  { type: "blind_test", question: "Smells Like Teen Spirit — Nirvana", answer: "Smells Like Teen Spirit", choices: null },
  { type: "blind_test", question: "Billie Jean — Michael Jackson", answer: "Billie Jean", choices: null },
  { type: "blind_test", question: "Rolling in the Deep — Adele", answer: "Rolling in the Deep", choices: null },
  { type: "blind_test", question: "Lose Yourself — Eminem", answer: "Lose Yourself", choices: null },
  { type: "blind_test", question: "Sweet Child O'Mine — Guns N' Roses", answer: "Sweet Child O'Mine", choices: null },
  { type: "blind_test", question: "Africa — Toto", answer: "Africa", choices: null },
  { type: "blind_test", question: "Mr. Brightside — The Killers", answer: "Mr. Brightside", choices: null },
  { type: "blind_test", question: "Don't Stop Believin' — Journey", answer: "Don't Stop Believin'", choices: null },
  { type: "blind_test", question: "Take On Me — A-ha", answer: "Take On Me", choices: null },
  { type: "blind_test", question: "Blinding Lights — The Weeknd", answer: "Blinding Lights", choices: null },
  { type: "blind_test", question: "Uptown Funk — Bruno Mars", answer: "Uptown Funk", choices: null },
];

// Image questions — URLs fiables
const IMAGE_SEED_QUESTIONS = [
  // --- devine_jeu_img ---
  { type: 'devine_jeu_img', question: 'Devine le jeu vidéo !', answer: 'Minecraft',
    choices: JSON.stringify({ image: 'https://upload.wikimedia.org/wikipedia/en/5/51/Minecraft_cover.png', blur: 12 }) },
  { type: 'devine_jeu_img', question: 'Devine le jeu vidéo !', answer: 'Grand Theft Auto V',
    choices: JSON.stringify({ image: 'https://upload.wikimedia.org/wikipedia/en/a/a5/GTA_V.png', blur: 12 }) },
  { type: 'devine_jeu_img', question: 'Devine le jeu vidéo !', answer: 'The Witcher 3: Wild Hunt',
    choices: JSON.stringify({ image: 'https://upload.wikimedia.org/wikipedia/en/0/0c/Witcher_3_cover_art.jpg', blur: 12 }) },
  { type: 'devine_jeu_img', question: 'Devine le jeu vidéo !', answer: 'Red Dead Redemption 2',
    choices: JSON.stringify({ image: 'https://upload.wikimedia.org/wikipedia/en/4/44/Red_Dead_Redemption_II.jpg', blur: 12 }) },
  { type: 'devine_jeu_img', question: 'Devine le jeu vidéo !', answer: 'Cyberpunk 2077',
    choices: JSON.stringify({ image: 'https://upload.wikimedia.org/wikipedia/en/9/9f/Cyberpunk_2077_box_art.jpg', blur: 12 }) },
  { type: 'devine_jeu_img', question: 'Devine le jeu vidéo !', answer: 'God of War (2018)',
    choices: JSON.stringify({ image: 'https://upload.wikimedia.org/wikipedia/en/a/a7/God_of_War_4_cover.jpg', blur: 12 }) },
  { type: 'devine_jeu_img', question: 'Devine le jeu vidéo !', answer: 'Among Us',
    choices: JSON.stringify({ image: 'https://upload.wikimedia.org/wikipedia/en/9/9a/Among_Us-cover.jpg', blur: 12 }) },
  { type: 'devine_jeu_img', question: 'Devine le jeu vidéo !', answer: 'The Last of Us',
    choices: JSON.stringify({ image: 'https://upload.wikimedia.org/wikipedia/en/4/46/Video_Game_Cover_-_The_Last_of_Us.jpg', blur: 12 }) },
  { type: 'devine_jeu_img', question: 'Devine le jeu vidéo !', answer: 'Overwatch',
    choices: JSON.stringify({ image: 'https://upload.wikimedia.org/wikipedia/en/5/55/Overwatch_cover_art.jpg', blur: 12 }) },
  { type: 'devine_jeu_img', question: 'Devine le jeu vidéo !', answer: 'Fortnite',
    choices: JSON.stringify({ image: 'https://upload.wikimedia.org/wikipedia/en/1/1e/Fortnite_cover_art.jpg', blur: 12 }) },

  // --- meme_mystere --- imgflip URLs stables
  { type: 'meme_mystere', question: "D'où vient ce mème ? Quel est son nom ?", answer: 'Drake approuve / Hotline Bling',
    choices: JSON.stringify({ image: 'https://i.imgflip.com/30b1gx.jpg' }) },
  { type: 'meme_mystere', question: "D'où vient ce mème ? Quel est son nom ?", answer: 'Woman Yelling at Cat',
    choices: JSON.stringify({ image: 'https://i.imgflip.com/345v97.jpg' }) },
  { type: 'meme_mystere', question: "D'où vient ce mème ? Quel est son nom ?", answer: 'Surprised Pikachu',
    choices: JSON.stringify({ image: 'https://i.imgflip.com/2kbn1e.jpg' }) },
  { type: 'meme_mystere', question: "D'où vient ce mème ? Quel est son nom ?", answer: 'Two Buttons',
    choices: JSON.stringify({ image: 'https://i.imgflip.com/1g8my4.jpg' }) },
  { type: 'meme_mystere', question: "D'où vient ce mème ? Quel est son nom ?", answer: 'Change My Mind',
    choices: JSON.stringify({ image: 'https://i.imgflip.com/24y43o.jpg' }) },
  { type: 'meme_mystere', question: "D'où vient ce mème ? Quel est son nom ?", answer: 'Distracted Boyfriend',
    choices: JSON.stringify({ image: 'https://i.imgflip.com/1ur9b0.jpg' }) },
  { type: 'meme_mystere', question: "D'où vient ce mème ? Quel est son nom ?", answer: 'This is Fine (chien en feu)',
    choices: JSON.stringify({ image: 'https://i.imgflip.com/26am.jpg' }) },
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
  // Seed incrémental : insère les types manquants
  // Force reseed des types mis à jour
  for (const t of ["anagramme", "google_trad", "qui_a_dit", "blind_test", "devine_jeu", "chronologie",
    "devine_jeu_img", "image_mot", "meme_mystere"]) {
    db.run("DELETE FROM chaos_questions WHERE type=?", [t]);
  }

  const existingTypes = new Set(
    qAll("SELECT DISTINCT type FROM chaos_questions").map(r => r.type)
  );

  // Seed standard questions
  const byType = {};
  for (const q of SEED_QUESTIONS) {
    if (!byType[q.type]) byType[q.type] = [];
    byType[q.type].push(q);
  }
  for (const [type, qs] of Object.entries(byType)) {
    if (!existingTypes.has(type)) {
      for (const q of qs) {
        const id = "q" + crypto.randomBytes(4).toString("hex");
        db.run("INSERT INTO chaos_questions (id,type,question,answer,choices,created_at) VALUES (?,?,?,?,?,?)",
          [id, q.type, q.question, q.answer || null, q.choices || null, Date.now()]);
      }
      existingTypes.add(type);
    }
  }

  // Seed image questions
  for (const q of IMAGE_SEED_QUESTIONS) {
    if (!existingTypes.has(q.type)) {
      const id = "q" + crypto.randomBytes(4).toString("hex");
      db.run("INSERT INTO chaos_questions (id,type,question,answer,choices,created_at) VALUES (?,?,?,?,?,?)",
        [id, q.type, q.question, q.answer || null, q.choices || null, Date.now()]);
    }
  }
  // Insert remaining image questions not yet seeded (check by answer uniqueness)
  const existingAnswers = new Set(qAll("SELECT answer FROM chaos_questions WHERE type IN ('devine_jeu_img','meme_mystere')").map(r => r.answer));
  for (const q of IMAGE_SEED_QUESTIONS) {
    if (!existingAnswers.has(q.answer)) {
      const id = "q" + crypto.randomBytes(4).toString("hex");
      db.run("INSERT INTO chaos_questions (id,type,question,answer,choices,created_at) VALUES (?,?,?,?,?,?)",
        [id, q.type, q.question, q.answer || null, q.choices || null, Date.now()]);
    }
  }

  persist();
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
