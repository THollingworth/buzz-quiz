# BUZZ! — Blind-test & buzzer multijoueur

Un petit site de jeu de buzzer en temps réel : les joueurs s'inscrivent avec un
pseudo, l'animateur (le créateur de la partie) choisit un fichier vidéo et lance
la partie. Le premier qui buzze met la vidéo en pause partout, un compte à rebours
de 5 s se déclenche, puis les autres votent **bonne réponse / faux**.

Le serveur (Node + WebSocket) fait autorité : c'est lui qui décide du premier
buzz, gère la fenêtre de réponse, la révélation et le vote en temps réel.

## Lancer en local

Prérequis : Node.js 18 ou plus.

```bash
npm install
npm start
```

Puis ouvre http://localhost:3000

Pour changer le port :

```bash
PORT=8080 npm start
```

Variables d'environnement disponibles :
- `PORT` — port d'écoute (défaut : `3000`)
- `COUNTDOWN_MS` — durée du compte à rebours en ms (défaut : `5000`)
- `RESUME_MS` — délai avant la reprise automatique de la vidéo après les votes, en ms (défaut : `4000`)

## Comment on joue

1. Sur l'accueil, deux choix : **Créer une nouvelle partie** ou **Rejoindre une
   partie** avec un code. Pas de pseudo ni de mot de passe à saisir.
2. Celui qui **crée** devient l'**animateur** : un **code d'invitation** (4 lettres)
   s'affiche, à partager (« Copier le code » / « Copier le lien »). Il **joue**
   comme les autres ET contrôle la partie. Si l'animateur quitte, le rôle passe
   automatiquement au plus ancien joueur restant.
3. Dans la file d'attente, chaque joueur **doit choisir un pseudo** (obligatoire :
   le bouton « prêt » est bloqué tant qu'il est vide) et peut se mettre
   **spectateur** (regarde seulement). Le nombre de joueurs est illimité. La liste
   est à gauche, le code d'invitation et les commandes sur le côté.
   Un bouton **Quitter** (en haut) permet de sortir de la partie à tout moment.
   Sur **téléphone**, l'affichage passe automatiquement en **mode buzzer** (juste
   le gros bouton + la saisie de réponse + le vote) : idéal pour jouer autour d'un
   **écran principal** unique. Un bouton en haut bascule entre mode buzzer et complet.
   Quand **tous les joueurs actifs sont prêts**, un compte à rebours de 5 s lance la
   partie automatiquement (l'animateur peut aussi lancer à la main).
4. L'animateur lance la partie, puis choisit la vidéo dans le **sélecteur** :
   il suffit de déposer les fichiers (.mp4 de préférence, aussi .webm/.ogg/.m4v/.mov)
   dans le dossier `public/videos/` du serveur — ils apparaissent dans la liste et
   sont chargés **pour tous les joueurs**. Un bouton **📁 Fichier local** permet aussi
   de jouer un fichier présent seulement sur cet écran. L'animateur peut **retirer la
   vidéo** à tout moment ; elle est aussi déchargée automatiquement au retour en file
   d'attente. Seul l'animateur pilote la lecture (pause / avance) ; les autres ne
   règlent que **leur volume**, et tous les écrans sont **synchronisés**.
5. On peut **buzzer librement**. Au buzz, la vidéo se met en **pause 5 s** et une
   **zone de texte** s'ouvre : chaque joueur qui buzze pendant la fenêtre tape sa
   réponse (gardée en mémoire, masquée aux autres) — le curseur se place **directement**
   dans la case, pas besoin de cliquer. Une fois qu'on a buzzé, son
   bouton se grise jusqu'à la manche suivante. L'ordre et l'**écart en ms** sont
   enregistrés. Après 5 s la vidéo repart.
6. Quand il veut, l'animateur clique **Révélation** (bouton sur l'écran principal) :
   pause pour tout le monde, la **liste des buzz s'affiche dans l'ordre** (écart en
   ms + réponse de chacun), et tout le monde **vote pour le gagnant** (égalité → le
   plus rapide). Le gagnant marque **+1** — ou l'animateur clique **Aucune bonne
   réponse** (personne ne marque). Puis **Manche suivante**.
7. Le bouton **Fin de partie** (options ⚙) affiche le **classement final** : 🏆 pour
   le premier, et le dernier est sacré **« gros looser 💩 »**.

## Dossier des vidéos

Mets tes fichiers vidéo dans `public/videos/`. Ils sont servis par le serveur et
apparaissent dans le sélecteur de l'animateur ; comme ils sont chargés par URL,
tous les joueurs voient la même vidéo. La **lecture est synchronisée** : la
position de l'animateur est diffusée et chaque écran se recale automatiquement
(lecture, pause, avance). Tu peux ajuster la finesse dans `public/app.js` (seuil
de recalage de 0,5 s).

## Déploiement

### VPS avec Docker / Portainer (recommandé : toujours allumé)

Un `Dockerfile` et un `docker-compose.yml` sont fournis.

**Via les Stacks Portainer (le plus simple)** : Stacks > Add stack > Repository,
indique l'URL de ton dépôt Git et `docker-compose.yml` comme chemin du compose,
puis déploie. Le port est `3000` (modifiable côté hôte dans le compose), et tes
vidéos vont dans le volume `buzz-videos` (monté sur `/app/public/videos`) — tu peux
les déposer depuis Portainer (Volumes > buzz-videos > Browse) sans reconstruire.

**En ligne de commande** : `docker compose up -d --build`.

Derrière un reverse proxy (Nginx Proxy Manager, Traefik…) avec un domaine + HTTPS :
pense à **activer le support WebSocket** (case « Websockets Support » dans NPM, ou
les labels équivalents Traefik). La page passe alors en `wss://` automatiquement.

### Autres plateformes



L'appli est un seul service Node qui sert les fichiers statiques **et** la
connexion WebSocket sur le même port. Elle lit le port via `process.env.PORT`,
ce qui la rend compatible avec la plupart des hébergeurs.

> Important : l'état du jeu est gardé **en mémoire**. Faites tourner **une seule
> instance** (pas de réplicas / autoscaling), sinon les joueurs répartis sur
> plusieurs instances ne se verraient pas.

### Render (simple, gratuit pour commencer)
1. Pousse ce dossier sur un dépôt GitHub.
2. Sur render.com → New → **Web Service** → connecte le dépôt.
3. Build command : `npm install` — Start command : `npm start`.
5. Render gère le HTTPS et les WebSockets automatiquement.

### Railway
1. New Project → Deploy from GitHub repo.
2. Railway détecte Node et lance `npm start` tout seul.
3. Génère un domaine public.

### Fly.io (via le Dockerfile fourni)
```bash
fly launch        # détecte le Dockerfile, ne pas ajouter de base de données
fly deploy
fly scale count 1 # garder une seule instance
```

### VPS / serveur perso
```bash
npm install
PORT=3000 node server.js
```
Place-le derrière Nginx (avec `proxy_set_header Upgrade $http_upgrade;` et
`proxy_set_header Connection "upgrade";` pour le WebSocket), ou utilise
`pm2 start server.js` pour le garder en vie.

## Structure
```
buzz-quiz/
  server.js        # serveur Node + Express + WebSocket (autorité du jeu)
  package.json
  Dockerfile
  public/
    index.html
    style.css
    app.js         # client : WebSocket + lecteur video local
```
