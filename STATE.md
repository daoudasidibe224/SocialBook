# État du projet

Communauté sportive : application publique pour partager ses entraînements et échanger avec la communauté sportive. Dépôt https://github.com/daoudasidibe224/communaute-sportive, branche improve/public-2026-10, PR draft existante. Aucune fusion ni publication cloud. Répertoire local `SocialBook` conservé pour les serveurs.

DA sportive conservée sans modification des sources frontend. Les photos de production sont en Mongo : 20 emplacements par compte, 200 au total, index uniques atomiques, limite de 500 Ko traités, compensation et purge des orphelins. Les anciennes photos disque ne sont pas migrées automatiquement.

Frontend et API TypeScript strict, validation des contrats aux frontières. Sessions durables/révocables, isolation des comptes, contrôles multi-onglets et anciennes réponses 401, idempotence des créations et conflits de modifications conservés. FEATURES.md décrit la matrice métier ; README.md contient installation, configuration, tests et limites.

## Validations acquises

Lint, types, compilation, 37 tests API Mongo, 1 test du serveur compilé et E2E HTTP/Socket.IO/Chromium passent. Les parcours publics/privés, formulaires, erreurs, navigation, clavier, rechargement, concurrence et vues de 1440/800/390/320 sont vérifiés. Captures finales relues. Le conteneur réel passe HTTPS local, cookies Secure, readiness, redémarrage et persistance ; photos relues/supprimées et messages WSS avec révocation. Les schémas render.yaml sont validés selon le schéma officiel.

Audit npm du dépôt : 0 ; image finale : 0 avis sur 155 packages installés. Il s’agit des avis npm, pas d’une analyse exhaustive du système d’exploitation. Image Node 24 Bookworm non-root.

## Livraison proposée et limites

render.yaml définit Docker Free, readiness réelle, secrets sync:false, auto-deploy désactivé. MongoDB Atlas M0 externe et photos Mongo. Render partage 750 heures/mois et met en veille après 15 minutes ; deux services actifs en permanence dépassent ce quota. Les accès Render et aux bases, secrets, restrictions réseau, sauvegardes et l’URL publique restent à configurer. Aucun service ni base distante créé.

Aperçu maintenu : http://127.0.0.1:4313, bases locales persistantes. Les preuves détaillées, PID et historiques restent dans work/SocialBook-state.md, work/SocialBook-preview.json et work/logs du dossier de coordination. L’état de publication Git et les runs CI au SHA exact sont consignés dans le checkpoint de coordination.
