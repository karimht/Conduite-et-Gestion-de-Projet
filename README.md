
                              TILTSCAN
              Système de détection de l'énervement du joueur

PRÉSENTATION DU PROJET
-----------------------
TILTSCAN est un système de détection en temps réel de l'énervement d'un joueur
(phénomène aussi appelé "tilt") pendant une session de jeu vidéo.

Le principe : analyser le comportement du joueur via ses frappes clavier, ses
boutons de manette et son expression faciale (webcam), puis calculer un score
d'énervement entre 0 et 100. Lorsque ce score dépasse certains seuils, le
système propose une intervention douce (exercice de respiration, suggestion de
pause, recadrage cognitif...) pour aider le joueur à se calmer avant que la
situation ne dégénère.

Le score est calculé à partir de 4 signaux comportementaux pondérés :
  - Cadence   (35%) : vitesse de frappe comparée à la baseline personnelle
  - Variance  (25%) : irrégularité du rythme
  - Spam      (20%) : répétition obsessionnelle d'une même touche
  - Chaos     (20%) : diversité anarchique des touches sollicitées

5 niveaux sont définis : ZEN / CALME / AGITÉ / ÉNERVÉ / TILT TOTAL


CONTEXTE — POURQUOI CE PROJET ?
---------------------------------
Ce projet a été réalisé dans le cadre du module de Conduite et Gestion de Projet
(CGP) du Master 1 Informatique à l'Université Sorbonne Paris Nord, année
universitaire 2025-2026, sous la direction de M. Nabil Maazouzi.

L'objectif pédagogique était de mettre en pratique l'ensemble des outils de
gestion de projet étudiés en cours sur un projet innovant choisi par l'équipe :
  QQOQCP, SMART, SIPOC, SWOT, Ishikawa (5M), WBS, RACI, PERT, Gantt,
  Matrice des risques.

Le développement d'une application n'était pas obligatoire dans ce cadre —
l'accent était mis sur la rigueur méthodologique. L'équipe a néanmoins choisi
de produire un prototype fonctionnel pour démontrer concrètement la faisabilité
du concept et disposer d'un support de démonstration pour la soutenance.

Durée du projet : 4 semaines (20 jours ouvrés)
Budget simulé   : 50 000 €
Soutenance      : 6 mai 2026


ÉQUIPE
-------
  - Lyes         — Chef de projet
  - Abderahim    — Analyste fonctionnel
  - Karim Mahtout — Responsable technique
  - Hassan       — Responsable planification & risques


CONTENU DU DÉPÔT
-----------------
  /app
    └── tiltscan.jsx          Application React (prototype fonctionnel)

  /docs
    ├── Rapport_Projet_TILTSCAN.pdf     Rapport de 30 pages
    ├── Rapport_Projet_TILTSCAN.tex     Version LaTeX du rapport (Overleaf)
    ├── Expression_de_Besoin.pdf        Bête à cornes + diagramme pieuvre
    └── Cahier_des_charges.pdf          CDC complet

  /diagrammes
    ├── Ishikawa.jpeg                   Diagramme des causes du tilt (5M)
    ├── Matrice_des_risques.jpeg        Matrice criticité R1 à R4
    └── SWOT.pdf                        Analyse stratégique

  /presentation
    └── TILTSCAN_Soutenance.pptx       Support PowerPoint (22 slides)

  README.txt                            Ce fichier


STACK TECHNIQUE
----------------
  - React + JSX       Interface utilisateur
  - Vite              Outil de build
  - DOM Events API    Capture des frappes clavier
  - Gamepad API       Détection des boutons manette (Xbox / PS / génériques)
  - MediaDevices API  Accès webcam avec consentement
  - Canvas 2D         Analyse heuristique du flux vidéo

Tout le traitement est 100% local — aucune donnée n'est envoyée sur un serveur.
Le projet est conforme RGPD : opt-in explicite, pas de stockage, pas de réseau.


COMMENT LANCER L'APPLICATION
------------------------------
Prérequis : Node.js installé sur votre machine.

  1. Cloner le dépôt
       git clone <url-du-repo>

  2. Aller dans le dossier app
       cd app

  3. Installer les dépendances
       npm install

  4. Lancer le serveur de développement
       npm run dev

  5. Ouvrir http://localhost:5173 dans votre navigateur

Conseil : utilisez Chrome ou Edge pour une compatibilité optimale avec
l'API Gamepad et l'accès webcam.


RÉSULTAT
---------
Le prototype détecte en temps réel l'énervement du joueur à partir du clavier,
de la manette et de la webcam. Le score se met à jour toutes les 200 ms et se
réinitialise automatiquement après 3 secondes d'inactivité.

Sur le plan méthodologique, le projet a produit l'intégralité des livrables
attendus (rapport 30 pages, CDC, expression de besoin, diagrammes, slides) et
a été soutenu le 6 mai 2026 devant jury.

Points clés du bilan :
  ✓ Planning respecté (18 jours sur 20 disponibles)
  ✓ 100% des livrables produits
  ✓ Budget respecté (50 000 € simulés)
  ✓ Latence prototype : ~100 ms (cible < 200 ms)
  ✓ Taux de faux positifs : ~12% (cible < 15%)
  ✓ Charge CPU : ~3% (cible < 5%)


Équipe TILTSCAN :
- DJEMAA Lyes
- GHRIS Abderrahim
- MAHTOUT Karim
- CHARAF Hassan

Master 1 — Université Sorbonne Paris Nord — 2025-2026
