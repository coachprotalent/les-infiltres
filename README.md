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
- Bots IA jouables côté serveur avec contexte filtré et actions validées.
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
ADMIN_USERNAME=aubinaso
ADMIN_PASSWORD=change-me
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

Toutes les variables sont lues par le backend au démarrage. Après modification de `.env` sous PM2, redémarrez avec `pm2 restart les-infiltres-dev --update-env`.

```env
# Port backend Node.js utilise par Express et Socket.IO.
PORT=3020

# Adresse d'ecoute du backend.
HOST=0.0.0.0

# Mode environnement.
NODE_ENV=development

# URL publique utilisee cote frontend.
PUBLIC_URL=https://infiltre-dev.traillearn.org

# Domaine autorise pour CORS.
CORS_ORIGIN=https://infiltre-dev.traillearn.org

# URL frontend utilisee par le client.
CLIENT_URL=https://infiltre-dev.traillearn.org

# Identifiants interface admin.
ADMIN_USERNAME=aubinaso
ADMIN_PASSWORD=change-me

# Endpoint Azure OpenAI de la ressource realtime.
AZURE_OPENAI_ENDPOINT=https://my-resource.openai.azure.com/

# Cle API Azure OpenAI cote serveur.
AZURE_OPENAI_API_KEY=

# Version API Azure OpenAI utilisee.
AZURE_OPENAI_API_VERSION=2024-10-01-preview

# Nom exact du deploiement realtime Azure.
AZURE_OPENAI_REALTIME_DEPLOYMENT=gpt-realtime-1.5

# Active les bots IA.
BOT_AI_ENABLED=true

# Nombre maximum de bots par salon.
BOT_MAX_PER_ROOM=6

# Niveau de participation: discreet | normal | talkative.
BOT_DEFAULT_PARTICIPATION=normal

# Active les voix audio IA des bots. false = texte uniquement.
BOT_AUDIO_ENABLED=false
```

| Variable | Obligatoire | Rôle | Exemple | Comportement attendu |
| --- | --- | --- | --- | --- |
| `PORT` | Oui | Port HTTP du serveur Express et Socket.IO. | `3020` | Nginx ou le navigateur doit pointer vers ce port si le backend est exposé directement. |
| `HOST` | Oui | Adresse d'écoute du serveur. | `0.0.0.0` ou `127.0.0.1` | Utilisez `127.0.0.1` derrière Nginx, `0.0.0.0` si Node écoute sur le réseau. |
| `NODE_ENV` | Oui | Mode Node.js. | `production` | Influence certains comportements de dépendances Node. |
| `PUBLIC_URL` | Oui | URL publique de l'application. | `https://infiltre-dev.traillearn.org` | Sert d'origine par défaut si `CORS_ORIGIN` n'est pas défini. |
| `CORS_ORIGIN` | Oui | Origine autorisée par CORS. | `https://infiltre-dev.traillearn.org` | Doit correspondre à l'origine navigateur réelle. |
| `CLIENT_URL` | Optionnel | Fallback frontend si `CORS_ORIGIN` manque. | `http://localhost:5173` | Utile surtout en développement local. |
| `ADMIN_USERNAME` | Oui | Identifiant admin. | `aubinaso` | Requis pour accéder au dashboard admin. |
| `ADMIN_PASSWORD` | Oui | Mot de passe admin. | `change-me` | À remplacer avant tout déploiement public. |
| `AZURE_OPENAI_ENDPOINT` | Oui pour bots IA | Endpoint de la ressource Azure OpenAI qui contient le déploiement realtime. | `https://my-resource.openai.azure.com/` | Le backend construit l'URL realtime à partir de cet endpoint. |
| `AZURE_OPENAI_API_KEY` | Oui pour bots IA | Clé API Azure OpenAI. | vide dans l'exemple | Reste uniquement côté serveur. Ne jamais l'exposer au frontend. |
| `AZURE_OPENAI_API_VERSION` | Oui pour endpoint preview | Version API realtime Azure. | `2024-10-01-preview` | Le service essaie le format realtime preview et le format GA si nécessaire. |
| `AZURE_OPENAI_REALTIME_DEPLOYMENT` | Oui pour bots IA | Nom exact du déploiement realtime utilisé par les bots. | `gpt-realtime-1.5` | C'est le modèle principal des bots. `AZURE_OPENAI_DEPLOYMENT` n'est pas utilisé pour eux. |
| `BOT_AI_ENABLED` | Oui | Active ou désactive les bots IA. | `true` | Si `false` ou si Azure manque, les contrôles IA sont désactivés. |
| `BOT_MAX_PER_ROOM` | Oui | Limite de bots par salon. | `6` | Empêche de remplir une partie avec trop de bots. |
| `BOT_DEFAULT_PARTICIPATION` | Optionnel | Niveau de prise de parole. | `normal` | Valeurs: `discreet`, `normal`, `talkative`. |
| `BOT_AUDIO_ENABLED` | Oui | Active la future voix IA. | `false` | `false` garde les bots actifs en texte: chat, nominations, votes et actions de nuit. |
| `BOT_AI_TIMEOUT_MS` | Optionnel | Timeout d'une décision Azure. | `12000` | Si Azure ne répond pas, le bot passe son tour et la partie continue. |

Le frontend n'utilise pas de variable Vite actuellement. En production, il se connecte au backend par la même origine que la page servie.

## Bots IA

Les bots IA sont des joueurs serveur. Ils comptent dans le nombre de joueurs, reçoivent un rôle normal, peuvent être nommés, voter, être élus Maire, agir la nuit et écrire dans le chat visible. Ils ne disposent pas de socket navigateur et toutes leurs actions sont validées par le moteur de jeu avant application.

Le service dédié est `BotRealtimeAIService`. Il centralise la communication Azure OpenAI realtime, la génération des messages et actions JSON, les logs Azure, le filtrage anti-triche du contexte, et gardera l'intégration audio temps réel future.

`AZURE_OPENAI_REALTIME_DEPLOYMENT=gpt-realtime-1.5` est le déploiement principal utilisé par les bots. Ne configurez pas `AZURE_OPENAI_DEPLOYMENT=botintelligence` pour les bots si ce déploiement n'existe pas ou n'est pas réellement utilisé.

Même avec `BOT_AUDIO_ENABLED=false`, les bots fonctionnent normalement en texte : ils parlent dans le chat, participent aux débats, nominent, votent, agissent la nuit, reçoivent leur rôle et peuvent devenir Maire.

Contexte envoyé au modèle :

```json
{
  "botName": "Bot Naomi",
  "botRole": "Infiltre",
  "phase": "DEBATE",
  "publicEvents": [],
  "visibleMessages": [],
  "alivePlayers": [],
  "nominatedPlayers": [],
  "currentVoteState": { "votes": [], "totals": [] },
  "privateRoleInfo": [],
  "allowedActions": ["speak", "pass"]
}
```

Sécurité anti-triche :

- La clé Azure reste uniquement dans le backend.
- Le frontend ne reçoit jamais la clé, ni le prompt système.
- Le service `BotRealtimeAIService` ne reçoit jamais l'objet room complet.
- Le contexte envoyé au modèle est limité à `botName`, `botRole`, `phase`, `publicEvents`, `visibleMessages`, `alivePlayers`, `nominatedPlayers`, `currentVoteState`, `privateRoleInfo` et `allowedActions`.
- Les rôles secrets des autres joueurs, l'état complet de la room, les actions privées invisibles et les votes cachés non autorisés ne sont pas envoyés.
- Le modèle retourne uniquement une action JSON structurée (`speak`, `vote`, `nominate`, `nightAction`, etc.).
- Le serveur revalide la phase, la cible, les permissions, l'état du joueur et les règles anti-triche avant d'appliquer l'action.

Exemples d'actions JSON attendues :

```json
{ "action": "speak", "message": "Je pense que ce comportement est etrange." }
```

```json
{ "action": "vote", "targetPlayerId": "player_123", "reason": "Il est tres suspect." }
```

```json
{ "action": "nominate", "targetPlayerId": "player_456" }
```

Logs attendus :

```text
[BotAI] enabled=true audio=false deployment=gpt-realtime-1.5
[BotAI] endpoint=present apiKey=present apiVersion=2024-10-01-preview
[BotAI] Bot Naomi phase=DEBATE called deployment=gpt-realtime-1.5
[BotAI] Bot Naomi phase=DEBATE action=speak accepted
[BotAI] Azure error: ...
```

## Sécurité

- Ne jamais commiter `.env`.
- Ne jamais exposer `AZURE_OPENAI_API_KEY` dans le frontend, les logs, une capture d'écran ou une discussion publique.
- Régénérer immédiatement la clé Azure si elle a été affichée dans un terminal, un log, une capture ou un commit.
- Toutes les requêtes Azure OpenAI passent uniquement par le backend.
- Le navigateur ne doit recevoir ni clé Azure, ni endpoint interne privé, ni prompt système.
- Utiliser HTTPS en production pour protéger les sessions admin, Socket.IO et les échanges de jeu.

## Administration

L'interface administrateur est accessible depuis la page d'accueil avec le bouton discret **Administration**. Elle permet de surveiller les salons actifs et de supprimer un salon bloqué ou ouvert par erreur.

Les identifiants ne doivent jamais être codés en dur dans le code source. Configurez-les dans `.env` :

```env
ADMIN_USERNAME=aubinaso
ADMIN_PASSWORD=change-me
```

Sur un serveur, modifiez ces valeurs avant le lancement et gardez le fichier `.env` hors de Git. Après changement des identifiants, redémarrez l'application (`pm2 restart les-infiltres-dev --update-env` en production PM2).

Après connexion, le dashboard admin affiche :

- le code du salon ;
- le nom de l'hôte ;
- le nombre de joueurs connectés et total ;
- le statut : lobby, partie en cours ou terminée ;
- le mode audio : intégré ou externe ;
- la date et l'heure de création ;
- un bouton **Voir détails** pour consulter les joueurs ;
- un bouton **Supprimer le salon**.

La suppression d'un salon demande confirmation, notifie les joueurs avec le message `Ce salon a été supprimé par l'administrateur.`, arrête la partie si elle était en cours, coupe les flux audio côté client via le retour accueil, puis supprime la room côté serveur.

Sécurité :

- aucune action admin n'est acceptée sans authentification serveur ;
- le mot de passe n'est jamais envoyé au frontend après connexion ;
- le serveur émet un token temporaire stocké uniquement dans `sessionStorage` ;
- utilisez HTTPS en production ;
- choisissez un mot de passe fort et ne partagez pas l'accès admin ;
- utilisez **Déconnexion** après administration, surtout sur un poste partagé.

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

## Déploiement Ubuntu

Ces étapes ciblent Ubuntu 22.04 ou 24.04 avec Node.js 20+, PM2, Nginx et Certbot. Les exemples utilisent `les-infiltres-dev`, `PORT=3020` et `infiltre-dev.traillearn.org`; adaptez les noms à votre environnement.

### 1. Installer les dépendances système

```bash
sudo apt update
sudo apt install -y git curl build-essential nginx
```

### 2. Installer Node.js et npm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
node -v
npm -v
```

Le projet demande Node.js 20 ou plus récent et npm 10 ou plus récent.

### 3. Cloner, installer et builder

```bash
git clone https://github.com/<user>/les-infiltres.git
cd les-infiltres
npm install
cp .env.example .env
nano .env
npm run build
```

Dans `.env`, renseignez au minimum `PORT`, `HOST`, `PUBLIC_URL`, `CORS_ORIGIN`, les identifiants admin, puis les variables Azure OpenAI si les bots IA doivent être activés. Derrière Nginx, utilisez généralement `HOST=127.0.0.1`.

### 4. Lancer avec PM2

```bash
sudo npm install -g pm2
pm2 start npm --name les-infiltres-dev -- start
pm2 save
pm2 startup
```

Vérifier le backend :

```bash
curl http://127.0.0.1:3020/health
pm2 status
pm2 logs les-infiltres-dev
```

Quand vous modifiez `.env`, redémarrez toujours avec les nouvelles variables :

```bash
pm2 restart les-infiltres-dev --update-env
```

Commandes PM2 utiles :

```bash
pm2 logs les-infiltres-dev
pm2 restart les-infiltres-dev --update-env
pm2 stop les-infiltres-dev
pm2 delete les-infiltres-dev
```

### 5. Configurer Nginx

Créer la configuration :

```bash
sudo nano /etc/nginx/sites-available/les-infiltres-dev
```

Contenu recommandé :

```nginx
server {
    server_name infiltre-dev.traillearn.org;

    location / {
        proxy_pass http://127.0.0.1:3020;
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
sudo ln -s /etc/nginx/sites-available/les-infiltres-dev /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Cette configuration supporte Socket.IO grâce aux en-têtes `Upgrade` et `Connection`.

### 6. Activer HTTPS avec Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d infiltre-dev.traillearn.org
sudo certbot renew --dry-run
```

### 7. Mise à jour d'un déploiement

```bash
cd les-infiltres
git pull
npm install
npm run build
pm2 restart les-infiltres-dev --update-env
pm2 logs les-infiltres-dev
```

### 8. Troubleshooting

Port déjà utilisé :

```bash
sudo lsof -i :3020
```

Logs backend :

```bash
pm2 logs les-infiltres-dev
```

Vérifier Nginx :

```bash
sudo nginx -t
sudo systemctl status nginx
sudo journalctl -u nginx -f
```

Erreur CORS :

```env
PUBLIC_URL=https://infiltre-dev.traillearn.org
CORS_ORIGIN=https://infiltre-dev.traillearn.org
```

Erreur Azure ou bots absents :

```bash
pm2 logs les-infiltres-dev
```

Les logs doivent afficher `enabled=true`, `deployment=gpt-realtime-1.5`, `endpoint=present` et `apiKey=present`. Si `.env` vient d'être modifié, relancez `pm2 restart les-infiltres-dev --update-env`.

## Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

N'exposez pas le port `3020` publiquement si Nginx sert de reverse proxy.

## Mise à jour du projet

```bash
cd les-infiltres
git pull
npm install
npm run build
pm2 restart les-infiltres-dev --update-env
```

Après une mise à jour importante :

```bash
pm2 logs les-infiltres-dev
curl http://127.0.0.1:3020/health
```

## Dépannage

### Port déjà utilisé

```bash
lsof -i :3020
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
CORS_ORIGIN=https://infiltre-dev.traillearn.org
PUBLIC_URL=https://infiltre-dev.traillearn.org
```

Redémarrer ensuite l'application :

```bash
pm2 restart les-infiltres-dev --update-env
```

### Site inaccessible

Vérifier :

```bash
pm2 status
pm2 logs les-infiltres-dev
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
pm2 logs les-infiltres-dev
sudo journalctl -u nginx -f
sudo nginx -t
sudo systemctl status nginx
lsof -i :3020
```

## Roadmap

- Ajouter une suite de tests automatisés pour le moteur de jeu.
- Ajouter ESLint et un script `npm run lint`.
- Finaliser les scénarios WebRTC multi-navigateurs et mobile.
- Ajouter une persistance optionnelle des salles si besoin.
- Améliorer les outils d'administration de partie sans changer les règles officielles.
