# Matrice des fonctions

| Attendu                   | Présent et retenu                                                         | Manque / action de cette passe                                               | Preuve attendue                             |
| ------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| Entrer dans la communauté | Inscription email/mot de passe, pseudo facultatif, connexion immédiate    | Contrôler les états visiteurs/membres                                        | Navigateur aux quatre largeurs              |
| Publier et échanger       | Posts/photos/commentaires, suivis, favoris, messages, recherche, épingles | Implémenté : stockage Mongo avec quotas atomiques                            | API réelle, redémarrage et quota concurrent |
| Reprendre après une panne | Brouillons texte/photo/UUID, reprises uniques, CAS, sockets et rattrapage | Vérifier erreurs/chargement et sessions en production                        | HTTP/WS et navigateur multi-onglets         |
| Préserver le compte       | Profil, déconnexion révocable, suppression et cascades                    | Disponibilité DB distincte de la vie du processus                            | Ready503 si base indisponible               |
| Publier gratuitement      | Serveur compilé et frontend même origine                                  | Implémenté : conteneur production et HTTPS/CORS/proxy validés                | Build et démarrage du conteneur             |
| Optionnel                 | —                                                                         | Mot de passe oublié, modération, notifications, pagination : pas implémentés | Limites README exactes                      |
