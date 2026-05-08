# Les Infiltrés

Application web multijoueur temps réel inspirée du jeu Les Infiltrés, avec lobby, rôles secrets, phases jour/nuit, élection du maire, votes, narrateur automatique et audio optionnel.

## Fonctionnalités

- Lobby avec code de salle et reconnexion par session navigateur.
- Distribution serveur des rôles secrets.
- Ratios d'Infiltres selon le nombre de joueurs.
- Rôles spéciaux configurables selon la composition de partie.
- Élection publique du Maire.
- Phases nuit, annonce du jour, débat, défense individuelle, vote et résultat.
- Pouvoirs serveur : Pasteur, Hackeuse, Avocate, Lanceuse d'Alerte, Ministre, Agent Double, Leader de Louange, Sage.
- Conditions de victoire automatiques.
- Journal de partie visible par l'hôte et en fin de partie.
- Narrateur automatique côté navigateur.
- Audio externe ou audio intégré optionnel.
- WebSocket Socket.IO pour l'état temps réel.

## Prérequis

- Node.js 20 LTS ou 22 LTS.
- npm 10 ou plus récent.
- Git.
- Un navigateur moderne.

Le projet fournit un fichier `.nvmrc` avec Node.js 20 recommandé.

## Installation locale

```bash
git clone https://github.com/<user>/les-infiltres.git
cd les-infiltres
nvm use
npm install
cp .env.example .env
```

Sous Windows PowerShell :

```powershell
Copy-Item .env.example .env
```

Pour le développement local, adaptez `.env` si besoin :

```env
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
PUBLIC_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:5173
CLIENT_URL=http://localhost:5173
```

## Lancement en développement

```bash
npm run dev
```

Services lancés :

- Frontend Vite : `http://localhost:5173`
- Backend Express + Socket.IO : `http://localhost:3000`

En développement, Vite proxifie `/socket.io` et `/health` vers le backend.

## Build production

```bash
npm run build
```

Le build compile dans cet ordre :

1. `shared`
2. `backend`
3. `frontend`

Le backend sert ensuite les fichiers générés dans `frontend/dist`.

## Lancement production

```bash
npm start
```

Par défaut, l'application écoute sur `HOST=0.0.0.0` et `PORT=3000`.

## Variables d'environnement

Variables lues par le backend :

```env
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
PUBLIC_URL=https://infiltre.traillearn.org
CORS_ORIGIN=https://infiltre.traillearn.org
CLIENT_URL=http://localhost:5173
```

- `PORT` : port HTTP du serveur Express et Socket.IO.
- `HOST` : interface d'écoute du serveur.
- `NODE_ENV` : environnement Node.js.
- `PUBLIC_URL` : URL publique de production.
- `CORS_ORIGIN` : origine autorisée par CORS.
- `CLIENT_URL` : origine Vite en développement, utilisée seulement si `CORS_ORIGIN` n'est pas définie.

Le frontend n'utilise pas de variable Vite actuellement. En production, il se connecte au backend par la même origine que la page servie.

## Structure du projet

```text
les-infiltres/
  backend/       Serveur Express, Socket.IO et moteur de jeu
  frontend/      Interface React + Vite
  shared/        Types, rôles, configuration et distribution partagés
  package.json   Scripts racine et workspaces npm
  .env.example   Exemple de configuration
  .nvmrc         Version Node.js recommandée
```

## Scripts disponibles

```bash
npm run dev
```

Lance `shared`, `backend` et `frontend` en mode développement.
Le script compile d'abord `shared` une fois pour générer `shared/dist`, puis démarre les watchers. Cette étape évite les erreurs de résolution de `@les-infiltres/shared` sur un clone propre.

```bash
npm run build
```

Compile tous les workspaces et génère le frontend de production.

```bash
npm run typecheck
```

Vérifie les types TypeScript. Le workspace `shared` est construit avant la vérification du backend pour fournir ses déclarations.

```bash
npm start
```

Lance le serveur Node.js compilé.

Il n'y a pas encore de script `lint` configuré. Ajoutez ESLint avant d'utiliser `npm run lint`.

## Déploiement sur Ubuntu

Ces étapes ciblent Ubuntu 22.04 ou 24.04.

### A. Installer les dépendances système

```bash
sudo apt update
sudo apt install -y git curl build-essential nginx
```

### B. Installer Node.js avec nvm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
node -v
npm -v
```

### C. Cloner le repo

```bash
git clone https://github.com/<user>/les-infiltres.git
cd les-infiltres
```

### D. Installer les dépendances

```bash
npm install
```

### E. Créer le fichier `.env`

```bash
cp .env.example .env
nano .env
```

Exemple production pour `infiltre.traillearn.org` :

```env
PORT=3000
HOST=127.0.0.1
NODE_ENV=production
PUBLIC_URL=https://infiltre.traillearn.org
CORS_ORIGIN=https://infiltre.traillearn.org
CLIENT_URL=http://localhost:5173
```

`HOST=127.0.0.1` est recommandé derrière Nginx. Utilisez `HOST=0.0.0.0` seulement si le serveur Node doit écouter directement sur le réseau.

### F. Build

```bash
npm run build
```

### G. Lancer en production

```bash
npm start
```

Vérifier le backend :

```bash
curl http://127.0.0.1:3000/health
```

## Déploiement avec PM2

Installer PM2 :

```bash
npm install -g pm2
```

Lancer l'application :

```bash
pm2 start npm --name les-infiltres -- start
```

Sauvegarder la configuration PM2 :

```bash
pm2 save
pm2 startup
```

Commandes utiles :

```bash
pm2 logs les-infiltres
pm2 status
pm2 restart les-infiltres
pm2 stop les-infiltres
```

## Configuration Nginx reverse proxy

Créer la configuration :

```bash
sudo nano /etc/nginx/sites-available/les-infiltres
```

Contenu recommandé :

```nginx
server {
    server_name infiltre.traillearn.org;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_cache_bypass $http_upgrade;
    }
}
```

Activer le site :

```bash
sudo ln -s /etc/nginx/sites-available/les-infiltres /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Cette configuration supporte Socket.IO grâce aux en-têtes `Upgrade` et `Connection`.

## Configuration HTTPS avec Certbot

Installer Certbot :

```bash
sudo apt install -y certbot python3-certbot-nginx
```

Créer le certificat :

```bash
sudo certbot --nginx -d infiltre.traillearn.org
```

Tester le renouvellement :

```bash
sudo certbot renew --dry-run
```

## Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

N'exposez pas le port `3000` publiquement si Nginx sert de reverse proxy.

## Mise à jour du projet

```bash
cd les-infiltres
git pull
npm install
npm run build
pm2 restart les-infiltres
```

Après une mise à jour importante :

```bash
pm2 logs les-infiltres
curl http://127.0.0.1:3000/health
```

## Dépannage

### Port déjà utilisé

```bash
lsof -i :3000
```

Arrêter le processus concerné ou changer `PORT` dans `.env`.

### `npm install` échoue

Vérifier Node.js et npm :

```bash
node -v
npm -v
nvm use 20
```

Puis relancer :

```bash
npm install
```

### Problème de version Node.js

Le projet demande Node.js 20 ou plus récent :

```bash
nvm install 20
nvm use 20
```

### WebSocket derrière Nginx

Vérifier que la configuration contient :

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

Puis :

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Erreur CORS

Vérifier `.env` :

```env
CORS_ORIGIN=https://infiltre.traillearn.org
PUBLIC_URL=https://infiltre.traillearn.org
```

Redémarrer ensuite l'application :

```bash
pm2 restart les-infiltres
```

### Site inaccessible

Vérifier :

```bash
pm2 status
pm2 logs les-infiltres
sudo systemctl status nginx
sudo journalctl -u nginx -f
sudo nginx -t
```

### Certificat SSL

```bash
sudo certbot certificates
sudo certbot renew --dry-run
```

### Logs

```bash
pm2 logs les-infiltres
sudo journalctl -u nginx -f
sudo nginx -t
sudo systemctl status nginx
lsof -i :3000
```

## Roadmap

- Ajouter une suite de tests automatisés pour le moteur de jeu.
- Ajouter ESLint et un script `npm run lint`.
- Finaliser les scénarios WebRTC multi-navigateurs et mobile.
- Ajouter une persistance optionnelle des salles si besoin.
- Améliorer les outils d'administration de partie sans changer les règles officielles.
