# Communauté sportive

Communauté sportive permet de publier une séance, suivre d'autres membres et échanger en privé. Le dépôt conserve son nom technique `SocialBook`.

## Ce que vous pouvez faire

- Créer un compte, vous connecter et vous déconnecter avec un cookie de session.
- Publier un texte ou une photo, modifier et supprimer vos publications, aimer et commenter celles des membres.
- Explorer la communauté, filtrer le fil par abonnements et rechercher des publications ou des pseudos.
- Sauvegarder une publication sur votre appareil et retrouver vos mentions J'aime.
- Modifier votre bio et votre photo, suivre des membres et consulter leurs profils.
- Ouvrir une conversation privée. Les messages sont enregistrés en MongoDB avant leur transmission en direct.
- Supprimer votre compte, ses publications et ses conversations.

L'activité affiche les réactions actuellement présentes sur vos publications et vos abonnés. Ce n'est pas un historique de notifications avec des états lu/non lu.

## Stack et organisation

L'interface utilise React 19, Vite 8, Tailwind CSS 4 pour sa base CSS, Motion et Lucide. L'API utilise Express 5, Mongoose 9, MongoDB, Socket.IO et Sharp. Le frontend et le serveur sont écrits en TypeScript strict. Les modèles persistés sont typés à partir des schémas Mongoose ; `shared/contracts.ts` définit les réponses et les événements validés par Zod à leur réception dans le navigateur.

`controllers/` traite les règles de propriété, les relations et les conversations ; `models/` définit les données ; `middleware/` contrôle la session ; `utils/` valide les entrées et les images. Le client sépare l'accès HTTP, le fil, les profils, l'authentification et la messagerie. Les identifiants et les textes reçus sont validés côté serveur. Le destinataire d'un message doit être membre de sa conversation. Les noms et identifiants d'auteur transmis par le client ne remplacent jamais ceux de la session.

## Installation locale

Prérequis : Node.js 24.15 ou plus récent, npm et MongoDB 7 ou 8 accessible en local. Les vérifications ont été exécutées avec Node.js 24. Le navigateur et l'API doivent utiliser exactement le même nom d'hôte (`127.0.0.1`, pas un mélange avec `localhost`).

```sh
npm ci
cp .env.example .env
cp client/.env.example client/.env
```

Dans `.env`, renseignez :

```dotenv
PORT=5000
CLIENT_URL=http://127.0.0.1:4313
MONGODB_URI=mongodb://127.0.0.1:27017/socialbook
TOKEN_SECRET=un-secret-aleatoire-de-plus-de-32-caracteres
NODE_ENV=development
```

Utilisez votre propre secret aléatoire. Les fichiers `.env` sont ignorés par Git. `client/.env` contient uniquement `VITE_API_URL=http://127.0.0.1:5000` ; aucun secret ne doit commencer par `VITE_`.

Démarrez MongoDB avec votre installation habituelle, puis lancez ces deux commandes dans deux terminaux, depuis la racine :

```sh
npm run dev
npm run client
```

Ouvrez [http://127.0.0.1:4313](http://127.0.0.1:4313). L'API écoute sur le port 5000 et expose `GET /health`. Le démarrage attend la connexion MongoDB et la création des index uniques avant d'accepter des requêtes. Aucun compte n'est précréé.

## Données et images

Les utilisateurs, sessions, publications, relations, conversations et messages sont persistés dans la base indiquée par `MONGODB_URI`. Les sauvegardes de publications sont stockées dans `localStorage`, par utilisateur et par navigateur. Elles ne se synchronisent pas entre appareils. Un stockage local indisponible produit un message visible ; un contenu local invalide est ignoré.

Les photos JPEG/PNG sont limitées à 500 000 octets et 16 millions de pixels. Le serveur les décode, retire les métadonnées, applique leur orientation et limite leur taille à 2400 pixels. Elles sont enregistrées sous un nom aléatoire dans `uploads/posts` ou `uploads/profil`. Ce dossier doit rester accessible en écriture et être sauvegardé avec la base. `UPLOAD_DIRECTORY` permet de choisir un chemin absolu différent. Le remplacement d’une photo de profil et la suppression d’une publication ou d’un compte retirent aussi leurs photos. Une écriture refusée par la base nettoie la nouvelle image. Une purge au démarrage puis toutes les heures retire les fichiers générés sans référence, après une marge d’une heure qui protège les requêtes en cours. En cas d’erreur disque, le serveur journalise l’échec et la purge réessaie ; les images par défaut sont conservées. Le dossier configuré est partagé par les modes de développement et compilé.

Les nouvelles publications et les nouveaux commentaires utilisent une clé UUID conservée lorsque vous réessayez après une erreur réseau. Deux requêtes simultanées avec la même clé ne créent qu’un contenu. Modifier le contenu d’une même requête renvoie un conflit. Les éditions envoient le texte d’origine attendu : si un autre onglet l’a modifié, la réponse 409 conserve votre saisie. Les anciennes routes sans clé ou texte attendu restent acceptées ; ces garanties concernent le contrat du nouveau client.

Après suppression d’une publication, son texte, sa photo, ses mentions J’aime et ses commentaires sont effacés. Une trace minimale (identifiant, compte, clé et empreinte du contenu) empêche une reprise tardive de recréer cette publication. Les commentaires supprimés gardent aussi une trace de leur opération. La suppression complète du compte retire ces traces.

Les messages exigent une clé UUID. Réessayer le même message renvoie son identifiant existant ; réutiliser sa clé avec un texte ou une conversation différente renvoie 409. Après une erreur réseau, le brouillon et sa clé sont conservés pour une nouvelle tentative. Une réponse HTTP perdue peut donc être reprise sans créer un deuxième message. La diffusion aux deux membres inclut leurs autres onglets. Elle peut être répétée lors d’une reprise ; chaque navigateur fusionne les messages par identifiant. Après reconnexion, la conversation ouverte relit l’historique persisté pour rattraper les messages manqués. Une panne après l’écriture du message mais avant la mise à jour de la conversation est réparée par la reprise.

Cette version repart d'une base vide. Les anciennes images de démonstration et les anciens modules CRA/Redux ont été retirés. Elle n'inclut pas de migration des anciens enregistrements ; utilisez une base dédiée pour l'essayer.

## Vérifications

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:compiled
npx playwright install chromium
npm run e2e
npm audit
```

Les tests API utilisent une instance MongoDB isolée, téléchargée automatiquement au premier lancement. Ils vérifient l'authentification, la confidentialité, les autorisations, les formats et limites d'images, les commentaires, les suppressions en cascade, les conversations créées simultanément, les publications et commentaires concurrents, les conflits d’édition, les messages idempotents, les reprises après écriture partielle, la révocation de sessions sur plusieurs sockets, leur expiration et une déconnexion pendant une connexion retardée. Ils n'accèdent pas à votre base configurée.

Le scénario E2E démarre sa propre MongoDB, son API sur 5013 et Vite sur 4513. Ces ports doivent être libres. Il exerce les formulaires et mutations dans Chromium, les doubles soumissions de formulaires, les brouillons conservés et les clés réutilisées après une panne, une édition périmée dans deux onglets, la messagerie dans trois onglets avec une réponse HTTP perdue et une coupure réseau, la persistance après rechargement, les sept vues à 1440, 390 et 320 pixels, les dialogues au clavier et les erreurs réseau. La variable facultative `SOCIAL_SCREENSHOTS` désigne un dossier où enregistrer les captures. Les tests API et E2E utilisent des dossiers temporaires pour les photos, supprimés en fin de scénario. Le test du serveur compilé vérifie aussi l’écriture, la lecture HTTP et la suppression dans un dossier configuré.

La CI reproduit lint, types, tests API, compilation et E2E sous Node.js 24.

## Version compilée

```sh
npm run build
npm start
```

`npm start` exécute le serveur compilé dans `dist/`. Avec `NODE_ENV=production`, Express sert aussi `client/dist` et les routes du navigateur. Pour ce mode, retirez `VITE_API_URL` avant la compilation : le frontend utilisera l'origine de la page. Renseignez `CLIENT_URL` avec cette même origine HTTPS, configurez un reverse proxy pour HTTP et Socket.IO, fournissez un secret privé et un dossier d'uploads persistant. Les cookies sont alors `HttpOnly`, `SameSite=Lax` et `Secure`. Chaque connexion crée une session persistée de trois jours, avec un identifiant unique dans le jeton signé. La déconnexion supprime cette session, refuse ensuite un jeton copié et ferme ses connexions Socket.IO. Les autres appareils restent connectés. La suppression du compte révoque toutes ses sessions. Les sockets se ferment aussi à l’expiration ; la suppression TTL nettoie les sessions expirées, tandis que chaque accès vérifie leur date sans attendre cette purge. Les anciens cookies sans identifiant de session nécessitent une nouvelle connexion. La configuration par défaut cible un frontend et une API sous la même origine en production.

Ce dépôt ne déploie aucun service automatiquement. La récupération de mot de passe, la vérification d'e-mail, la modération, la pagination et les notifications push ne sont pas implémentées. Les conversations restent consultables via HTTP quand la connexion en direct échoue. La reconnexion rattrape automatiquement les messages de la conversation ouverte ; aucune nouvelle tentative d’envoi n’est déclenchée sans votre action. Les brouillons et leurs clés ne survivent pas au rechargement de la page. Les sessions et les salles Socket.IO visent une seule instance API : un déploiement sur plusieurs serveurs demanderait un adaptateur partagé et une coordination de révocation. Les suppressions de compte impliquent plusieurs écritures MongoDB, sans transaction globale. Le projet vise une petite communauté, pas un service à grande échelle.

## Licences et références

L'animation d'entrée adapte [BlurText de React Bits](https://reactbits.dev/text-animations/blur-text), avec une variante sans mouvement. Sa licence MIT avec Commons Clause est conservée dans `licenses/react-bits.txt`. Les autres fichiers du projet suivent la licence indiquée dans `package.json`.

Les migrations suivent les guides [Express 5](https://expressjs.com/en/guide/migrating-5/), [Mongoose 9](https://mongoosejs.com/docs/migrating_to_9.html), [Vite](https://vite.dev/guide/) et [Tailwind CSS 4](https://tailwindcss.com/docs/upgrade-guide). La configuration de types suit [TypeScript strict](https://www.typescriptlang.org/tsconfig/strict.html) ; le traitement des photos utilise [Sharp](https://sharp.pixelplumbing.com/).
