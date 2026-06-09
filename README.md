# BUZZ! — Blind-test & buzzer multijoueur

Un petit site de jeu de buzzer en temps réel : les joueurs s'inscrivent avec un
pseudo, l'animateur (le créateur de la partie) charge une vidéo YouTube et lance
la partie. Le premier qui buzze met la vidéo en pause partout, un compte à rebours
de 5 s se déclenche, puis les autres votent **bonne réponse / faux**.

Le serveur (Node + WebSocket) fait autorité : c'est lui qui décide du premier
buzz, gère le compte à rebours et synchronise tout le monde en temps réel.

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

1. Sur l'accueil, deux choix : **Créer une nouvelle partie** ou **Rejoindre
   une partie** avec un code. Pas de pseudo ni de mot de passe à saisir.
2. Celui qui **crée** la partie devient l'**animateur** : un **code d'invitation**
   (4 lettres) s'affiche, à partager (bouton « Copier le code » / « Copier le
   lien »). L'animateur **joue** comme les autres ET contrôle la partie via le
   bouton **⚙** (modale) où il charge un **lien YouTube** et clique **Lance la
   partie**. Si l'animateur quitte, le rôle passe automatiquement au plus ancien
   joueur restant.
   Chacun peut, dans la file d'attente, choisir un **pseudo** (optionnel) et se
   mettre **spectateur** (regarde seulement : ne buzze pas, ne vote pas, hors
   classement). Le nombre de joueurs est illimité tant que la partie n'est pas
   lancée.
3. La vidéo s'affiche au centre, le **classement à côté**, le **buzzer en bas**.
   On peut **buzzer librement** (autant qu'on veut). Dès qu'un joueur buzze, la
   vidéo se met en **pause 5 s pour tout le monde** et une **zone de texte**
   s'ouvre : chaque joueur qui buzze pendant la fenêtre tape sa réponse (gardée
   en mémoire, masquée aux autres). L'ordre des buzz et l'écart en millisecondes
   sont enregistrés. Après 5 s, la vidéo repart automatiquement.
4. Quand il veut, l'**animateur** clique **Révélation** (bouton ⚙) : la vidéo se
   met en pause pour tout le monde et la **liste des buzz s'affiche dans l'ordre**
   (avec l'écart en ms et la réponse de chacun). Tout le monde **vote pour le
   gagnant** ; en cas d'égalité, le plus rapide l'emporte. Le gagnant marque
   **+1 point**, puis l'animateur lance la **manche suivante**.

**Lecture synchronisée** : seul l'animateur pilote le lecteur ; sa position est
diffusée à tous les autres, qui ne peuvent que régler **leur volume**. Les
**scores** sont cumulés sur toute la partie, affichés en direct, et
réinitialisables par l'animateur depuis la modale.

Astuce : touche **Espace** pour buzzer. Pour une soirée en présentiel, utilisez
un seul écran (celui de l'animateur) pour l'image et le son ; le son est coupé
par défaut sur les autres appareils (bouton pour le réactiver).

## Déploiement

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
    app.js         # client : WebSocket + lecteur YouTube
```
