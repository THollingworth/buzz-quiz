# BUZZ! — Blind-test & buzzer multijoueur

Un petit site de jeu de buzzer en temps réel : les joueurs s'inscrivent avec un
pseudo, l'animateur (protégé par mot de passe) charge une vidéo YouTube et lance
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

Pour changer le mot de passe animateur ou le port :

```bash
ADMIN_PASSWORD="monMotDePasse" PORT=8080 npm start
```

Variables d'environnement disponibles :
- `ADMIN_PASSWORD` — mot de passe de l'animateur (défaut : `buzz2026`)
- `PORT` — port d'écoute (défaut : `3000`)
- `COUNTDOWN_MS` — durée du compte à rebours en ms (défaut : `5000`)
- `RESUME_MS` — délai avant la reprise automatique de la vidéo après les votes, en ms (défaut : `4000`)

## Comment on joue

1. Chaque participant ouvre le site, met un **pseudo** (et le même **code de
   partie** que les autres, ou laisse vide pour la salle par défaut). Tant que
   l'animateur n'a pas lancé, le nombre de joueurs dans la file d'attente est
   **illimité**. Chacun clique **Je suis prêt·e**.
2. L'**animateur** entre le mot de passe, colle un **lien YouTube**, puis
   **Lance la partie**.
3. La vidéo passe au centre, le **buzzer** dessous. Premier qui appuie → pause
   partout + compte à rebours de 5 s (le buzzer répond à l'oral).
4. Les boutons **vert / rouge** apparaissent pour les autres. Si la majorité
   valide, le buzzer gagne **+1 point**. Le verdict s'affiche, puis **la vidéo
   reprend automatiquement** (ou l'animateur clique « Reprendre maintenant »).

Les **scores** sont cumulés sur toute la partie et affichés en direct pour tout
le monde. L'animateur peut les remettre à zéro depuis la salle d'attente.

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
4. Ajoute la variable d'environnement `ADMIN_PASSWORD`.
5. Render gère le HTTPS et les WebSockets automatiquement.

### Railway
1. New Project → Deploy from GitHub repo.
2. Railway détecte Node et lance `npm start` tout seul.
3. Variables → ajoute `ADMIN_PASSWORD`. Génère un domaine public.

### Fly.io (via le Dockerfile fourni)
```bash
fly launch        # détecte le Dockerfile, ne pas ajouter de base de données
fly secrets set ADMIN_PASSWORD=monMotDePasse
fly deploy
fly scale count 1 # garder une seule instance
```

### VPS / serveur perso
```bash
npm install
ADMIN_PASSWORD=monMotDePasse PORT=3000 node server.js
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
