# Concevoir pour une lecture difficile

> Marché visé : la Côte d'Ivoire et l'Afrique de l'Ouest francophone. Une part
> du personnel de salle et de cuisine, et une part des clients, lisent mal ou
> pas du tout. Ce document dit ce que cela change dans l'interface — et ce que
> cela ne change pas.

---

## 0. Le but n'est pas d'ajouter des images

C'est de **sortir la lecture du travail**.

La demande de lecture ne disparaît pas ; elle se déplace. On la concentre là où
elle coûte le moins — le patron, une fois, à l'installation — et on la retire là
où elle coûte le plus : le serveur et le cuisinier, à chaque commande, tout le
service.

| Qui | À quelle fréquence | Texte admis |
|---|---|---|
| Patron / gérant | une fois, à l'installation | **oui** — il saisit la carte, les noms, les prix |
| Serveur | à chaque commande | presque aucun |
| Cuisinier | à chaque ticket | **aucun** |
| Caissier | à chaque addition | des chiffres |
| Client (phase 2, QR) | à chaque visite | presque aucun |

C'est la seule règle dont tout le reste découle.

---

## 1. Ce qui aide réellement

### La photographie bat le pictogramme

Une icône est une littératie de plus. Un pictogramme ne fonctionne que si l'on
connaît déjà la convention — une disquette pour « enregistrer » ne dit rien à
qui n'a jamais vu de disquette. **La photographie du plat réel**, elle, se
reconnaît sans apprentissage.

Donc : pas de galerie d'icônes de nourriture. La photo de **ce** poisson braisé,
prise dans **cette** cuisine.

### Les chiffres battent les mots

La numératie dépasse presque toujours la littératie. `12`, `×2`, `3 500` sont
lisibles par des gens qui ne lisent pas « Poisson braisé ». Partout où une
information peut être un nombre, elle doit l'être — numéro de table, quantité,
prix, minutes d'attente.

### La position est une mémoire

Le même plat au même endroit, tous les jours, devient reconnaissable sans être
lu. Cela interdit deux habitudes courantes :

- **ne jamais réordonner une liste dynamiquement** (« les plus commandés en
  premier » détruit la mémoire spatiale) ;
- **ne rien cacher derrière un menu** — ce qui est masqué est perdu.

Cela impose une contrainte qui n'est pas évidente : **un ordre stable doit être
un ordre décidé**. Tant que `sort` valait 0 partout, Postgres départageait les
ex æquo comme il voulait et la carte bougeait toute seule — pour quelqu'un qui
navigue à la position plutôt qu'à la lecture, c'est pire que pas d'ordre du
tout. D'où, en base : une position par catégorie et par plat, unique dans le
restaurant, et un échange de deux positions dans **une seule** transaction
(`resto.move_category`, `resto.move_item`).

### La couleur est un canal, jamais le seul

Un homme sur douze distingue mal le rouge du vert. La couleur double
l'information ; elle ne la porte pas seule. Chaque état est **couleur +
position + forme**.

### Pas de symbolique abstraite

Le hamburger, l'engrenage, les trois points : ce sont des conventions apprises,
pas des évidences. Un bouton est un rectangle avec une photo ou un chiffre
dedans.

---

## 2. Le vocabulaire visuel

Un seul jeu d'états, identique dans toute l'application. Appris une fois.

| État | Couleur | Forme | Position | Mot (petit, secondaire) |
|---|---|---|---|---|
| En attente | gris | cercle vide | colonne 1 | *en attente* |
| En préparation | ambre | cercle à moitié plein | colonne 2 | *en cuisine* |
| Prêt | vert | cercle plein | colonne 3 | *prêt* |
| Servi | — | disparaît | — | — |

Le mot reste, en petit. Il ne porte rien : il sert à celui qui lit, et
n'encombre pas celui qui ne lit pas.

---

## 3. Écran par écran

### 3.1 La carte (patron) — le seul écran où l'on écrit

Il gagne **une photo par plat**, prise à l'appareil, pas choisie dans un
explorateur de fichiers. Sur un téléphone, `capture="environment"` ouvre
directement la caméra.

La photo n'est pas décorative : c'est **la clé de lecture de tous les autres
écrans**. Un plat sans photo devrait être signalé au patron comme une carte
incomplète.

Trois choses reprises telles quelles de la référence fournie :

- **Le voile « épuisé »** posé sur la photo, plutôt qu'un nom barré. Un voile se
  voit sans se lire — c'est exactement l'interrupteur « 86 », et c'est mieux
  résolu que ce que j'ai construit en P2.
- **Le bouton + flottant**, toujours en bas à droite : ajouter est le geste le
  plus fréquent de cet écran.
- **Les onglets comptés**, qui disent combien d'articles sans qu'on ait à
  compter.

Une chose que je ne reprendrais pas : la référence affiche `5.000,00 XOF`, deux
décimales sur une monnaie qui n'en a pas. C'est précisément ce que
`core.currencies` empêche — le nombre de décimales vient de la monnaie, jamais
d'un format écrit en dur. Chez nous ce sera `5 000 F`, et `12,50 €` à Paris,
sans que personne ait à y penser.

### 3.1b Ranger la carte

Les catégories sont décidées par le patron ou le gérant, et l'ordre qu'ils
choisissent est celui que la salle verra. Chaque catégorie est donc une ligne
qui porte tout ce qu'on peut lui faire, au même endroit :

| | |
|---|---|
| **Sa photo** | prise à la caméra, d'un seul geste — l'onglet se reconnaît avant de se lire |
| **Son nom** | modifiable sur place, sans écran intermédiaire |
| **↑ ↓** | monter, descendre ; la flèche est éteinte en bout de liste plutôt qu'absente |
| **🚫 masquer** | la retirer de la salle sans la perdre |
| **🗑 supprimer** | en deux gestes, et sans emporter les plats |

Deux règles qui découlent directement du §1 :

**Masquer plutôt que supprimer.** Une carte de saison revient l'année suivante ;
la supprimer et la retaper fait perdre la place que l'équipe avait apprise.
`active = false` la retire de la salle et garde sa position.

**Supprimer une catégorie ne supprime jamais la nourriture.** Les plats
retombent dans « sans catégorie » (`on delete set null`). Perdre un intitulé ne
doit pas faire disparaître vingt plats.

Et la confirmation est un **dépli**, pas une boîte de dialogue. Une modale de
prose est précisément ce qu'une personne qui lit mal ne peut pas survoler, et
elle s'ouvre loin de la chose visée ; ici la question est posée sur place, en
rouge, à l'endroit du bouton.

L'appareil photo, enfin, est sur la vignette elle-même — pas seulement dans le
formulaire de création. Sans cela la carte annonçait « 7 plats sans photo » et
n'offrait rien pour y remédier : un reproche sans issue.

### 3.2 La prise de commande

**Aujourd'hui** : une liste de noms, un champ de recherche, un formulaire.
**Demain** : de grandes cartes-photo sur **deux colonnes** — nom et prix posés
sur la photo, comme la référence fournie. On tape la photo, elle passe dans la
commande et un badge chiffré remplace le coin ; on tape encore, il passe à 2 ;
un appui long enlève.

- **Deux colonnes, pas trois.** La photo doit être reconnaissable d'un coup
  d'œil, à bout de bras, dans une salle mal éclairée. Ma première maquette en
  proposait trois — c'était trop petit.
- **Nom et prix sur la photo**, jamais dessous : l'œil ne quitte pas la
  vignette.
- Pas de champ de recherche — chercher, c'est écrire.
- Catégories en onglets **comptés** ; le compte est un chiffre, donc lisible.
- Total courant en gros chiffres, en bas, toujours au même endroit.

### 3.2b Voir la description sans quitter la grille

La description existe — allergènes, accompagnement, « piment à part » — et
quelqu'un doit pouvoir la lire. Mais l'ouvrir ne doit pas coûter un geste à
chaque commande.

**La règle du coin : toucher la photo agit, toucher le coin explique.**

Le coin haut-droit porte toujours le même geste, *en savoir plus sur cet
article*. Chez le patron c'est un crayon — modifier ; chez le serveur c'est un
**i** — la fiche. Même position, même idée, deux contextes.

La fiche montre la photo en grand, le nom, le prix, la description, et un seul
bouton large pour ajouter. On y entre par curiosité, on en sort par l'action.

Un appui long ferait la même chose et serait invisible : rien à l'écran ne
l'annonce. Un coin visible s'apprend en le voyant.

### 3.3 Les tables

Des tuiles carrées, grand chiffre au centre, couleur de fond selon l'état :
libre, occupée, addition demandée. Le numéro **est** l'étiquette.

### 3.4 La cuisine

Un ticket = **photo du plat + quantité en chiffres + numéro de table**. Le nom
du plat en petit, sous la photo.

L'attente se lit comme une barre qui se remplit et change de couleur, pas comme
« 12 min ». Un seul bouton, large : **prêt**.

### 3.5 La confirmation

Après l'envoi d'une commande : les photos de ce qui vient d'être envoyé, en
grand, une seconde. Pas un récapitulatif écrit.

### 3.6 Les états vides

Jamais une phrase seule. Une grande illustration, et le mot en dessous.

---

## 4. La tension que personne ne mentionne

**Une interface par l'image, sur un réseau faible, est une contradiction si
elle est mal tenue.**

Le CRM comprime ses photos de preuve à 1024 px et 0,6 Mo. Pour une vignette de
carte, c'est **quinze fois trop lourd** : une grille de vingt plats ferait
12 Mo, injouable en 3G.

La discipline :

| | Cible |
|---|---|
| Vignette de grille | ~400 px, WebP, **25–40 Ko** |
| Photo d'un plat en grand | ~800 px, ~80 Ko |
| Compression | côté client **avant** envoi (`browser-image-compression`, déjà utilisé par le CRM) |
| Chargement | paresseux hors écran ; la carte change rarement, donc cache long |

**Et surtout : l'écran doit rester utilisable quand les images ne chargent
pas.** Chaque plat sans photo — ou dont la photo n'est pas encore arrivée —
s'affiche comme une tuile de couleur stable portant ses deux premières lettres.
La couleur est dérivée du nom, donc toujours la même pour le même plat : elle
devient reconnaissable en soi.

Sans cela, on aurait remplacé « du texte illisible » par « des carrés gris »,
ce qui est pire.

---

## 5. La connexion — la plus grosse victoire, et une décision à prendre

Aujourd'hui : taper un identifiant et un mot de passe. C'est l'écran le plus
hostile de l'application, et il est franchi plusieurs fois par jour.

**Proposition : toucher sa photo, saisir un code à 6 chiffres.**

Le patron prend la photo de chaque employé au moment de créer son compte. Le
personnel ne tape plus qu'un code — et un chiffre se retient quand un mot ne se
retient pas.

Techniquement, rien ne change en profondeur : le code **est** le mot de passe,
l'identifiant se déduit de la photo touchée.

Ce qu'il faut trancher, honnêtement :

- **Un code à 6 chiffres est plus faible qu'un mot de passe.** Sur un appareil
  partagé dans un restaurant, la menace est le collègue, pas l'attaquant
  distant. Cela reste un choix à faire les yeux ouverts, avec limitation des
  tentatives.
- **Afficher les visages avant la connexion révèle qui travaille ici.** Ce
  n'est pas un secret dans une salle où ils sont visibles, mais cela ne doit
  pas être servi à l'internet entier : la grille ne s'affiche que sur un
  appareil déjà rattaché au restaurant.

Le patron et le gérant, eux, gardent identifiant et mot de passe : ils lisent,
et leurs comptes valent plus cher.

---

## 6. Ce que je ne ferais pas

- **La lecture vocale.** Séduisante, mais une salle de restaurant est bruyante,
  et cela coûte cher. Plus tard, si le besoin se confirme.
- **Traduire l'interface en dioula ou en baoulé.** Ces langues sont surtout
  orales : les traduire n'aide pas quelqu'un qui ne lit pas. **Plus d'images
  vaut mieux que plus de traductions.**
- **Des icônes « universelles ».** Voir §1.
- **Un bouton qui se réécrit lui-même pour demander confirmation.** Le réflexe
  — un bouton dont le `type` passe de `button` à `submit` au premier appui — se
  déclenche **au premier appui** : React applique le changement pendant que le
  clic est encore en cours, et le navigateur lit le nouveau type au moment
  d'agir. Une catégorie a été supprimée sans que rien ne soit demandé. Un
  `<details>` fait la même chose nativement, et se comporte pareil avant et
  après hydratation — avant, du côté sûr.

---

## 7. Ordre de marche

**Fait** — la fondation, sans laquelle le reste ne peut pas exister :

1. `photo_path` sur `menu_items` puis sur `menu_categories` (migrations 0004 et
   0005 ; oublié dans la 0003 alors que le plan le prévoyait).
2. Prise de photo à la caméra dans l'écran carte, compression avant envoi —
   1 892 Ko mesurés à l'entrée, 40 Ko envoyés.
3. La tuile de repli colorée, et le vocabulaire d'états du §2.
4. L'ordre de la carte : positions explicites, échange transactionnel, et la
   ligne de gestion du §3.1b.

**En P3** — la prise de commande, la cuisine et les tables se construisent
directement en visuel. Les refaire ensuite coûterait deux fois.

**À décider** — la connexion par photo et code (§5). Elle ne bloque rien, mais
plus elle arrive tard, plus il y a de comptes à photographier.
