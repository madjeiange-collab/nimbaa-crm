# Mise en service — Supabase, local, GitHub, Vercel

> **Deuxième réécriture.** La version précédente parlait d'un projet Supabase
> *séparé* pour le resto, de trois tables `restaurants / restaurant_members /
> staff_accounts`, d'une migration `0001_tenancy.sql` et de deux sondes. Rien
> de tout cela n'est encore vrai : la plateforme a été décidée entre-temps
> (`platform-architecture.md`), et le schéma a doublé. Suivre l'ancienne
> version aujourd'hui vous ferait perdre une heure.
>
> Comptez **40 à 50 minutes**.

Vous avez déjà les trois comptes : Supabase, GitHub, Vercel.

---

## 0. La seule décision à comprendre avant de cliquer

**Créez un projet Supabase neuf, et appelez-le `nimbaa` — pas `nimbaa-resto`.**

Ce projet n'est pas celui du restaurant : c'est celui de la **plateforme**. Il
porte aujourd'hui deux schémas, `core` (organisations, abonnements, accès) et
`resto`. Il portera `crm` le jour où le CRM y sera migré. C'est la décision du
§2 de `platform-architecture.md`, et c'est elle qui rend possible « un compte
par personne, un abonnement par application ».

**Et surtout : n'installez pas le resto dans le projet Supabase du CRM
existant.** Le CRM a aujourd'hui 83 policies dont **41 écrites
`using (auth.uid() is not null)`** — c'est-à-dire : *toute personne connectée
voit tout*. Tant qu'il n'y avait qu'un client, cela ne se voyait pas. Le jour
où un serveur de restaurant existe dans le même `auth.users`, ces 41 policies
deviennent une porte ouverte sur les données du CRM. Le CRM rejoindra la
plateforme quand ces policies auront été réécrites (§11 de
`platform-architecture.md`), pas avant.

---

## 1. Récupérer le code · 3 min

```bash
git clone -b claude/restaurant-ordering-platform-7xz3p8 \
  https://github.com/madjeiange-collab/nimbaa-crm.git
cd nimbaa-crm/nimbaa-resto
pnpm install
```

`node -v` ≥ 18.18, `pnpm -v` ≥ 9.

Le code vit dans le sous-dossier **`nimbaa-resto/`**, avec son propre
`pnpm-workspace.yaml` : il ne partage pas les dépendances du CRM qui est à la
racine. Vercel sait construire depuis un sous-dossier (§5), donc rien ne vous
oblige à détacher le dépôt.

---

## 2. Créer le projet Supabase · 10 min

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Nom : **`nimbaa`**. Voir le §0.
3. Mot de passe de la base : conservez-le, il n'est affiché qu'une fois.
4. **Région : Europe (Paris `eu-west-3` ou Francfort).** Pas les États-Unis.
   Chaque commande écrite, chaque ticket de cuisine et chaque lecture de carte
   traverse ce lien, et depuis l'Afrique de l'Ouest les sauts européens sont
   nettement plus courts. **C'est le seul réglage de cette page qu'on ne peut
   pas changer ensuite sans migrer le projet.**

Puis trois réglages, dont un que presque tout le monde oublie :

| Où | Quoi | Pourquoi |
|---|---|---|
| *Project Settings → API → Exposed schemas* | ajoutez **`core`** et **`resto`** | ⚠️ **Le réglage oublié.** PostgREST ne sert que les schémas listés ici. Sans lui, l'application se connecte, ne trouve rien, et n'affiche aucune erreur utile. |
| *Authentication → Sessions* | laissez « time-box user sessions » et « inactivity timeout » sur **jamais** | Une tablette posée au passe est connectée une fois et doit le rester. Déconnecter la cuisine un samedi à 3 h du matin n'est pas une politique de sécurité, c'est une panne. |
| *Authentication → Providers* | n'y touchez pas | La phase 1 a une seule porte : identifiant et mot de passe. |

Pas de PostGIS, contrairement au CRM : rien ici n'est géographique.

### Appliquer le schéma

Cinq migrations doivent passer dans l'ordre. Rassemblez-les en un seul bloc :

```bash
pnpm db:bundle
```

→ `supabase/.bundle.sql`. Ouvrez-le, copiez **tout**, collez dans *SQL Editor →
New query* → **Run**.

Le paquet est enveloppé dans une transaction : **ou tout s'applique, ou rien**.
Un schéma à moitié appliqué est le pire des trois états — l'application démarre
et échoue plus tard, loin de la cause.

Attendu : `Success. No rows returned`. Des `NOTICE ... does not exist,
skipping` sont normaux : ce sont les `drop policy if exists` d'une base vierge.

Vous devez voir dans *Table Editor* **douze tables** — cinq en `core`, sept en
`resto` — et *Storage* doit montrer un seau **`menu`**, public.

### Relever les clés

*Project Settings → API* :

| Champ Supabase | Variable |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY` |

---

## 3. Brancher, et vérifier avant de chercher · 5 min

```bash
cp .env.local.example .env.local   # puis renseignez les trois clés
pnpm db:check
```

Attendu : dix lignes vertes.

```
  ✅ le projet répond
  ✅ schéma « core » exposé, migration 0001 appliquée   8 monnaies, XOF à 0 décimale(s)
  ✅ schéma « resto » exposé, migration 0002 appliquée  lisible
  ✅ RLS active : un visiteur anonyme ne voit rien      0 ligne(s) rendue(s) à la clé anon
  ✅ migration 0003 — carte et salle
  ✅ migration 0004 — photo des plats
  ✅ migration 0005 — ordre et photo des catégories
  ✅ fonction resto.move_category en place
  ✅ seau de stockage « menu », public en lecture       public=true, limite=2048 Ko
  ✅ domaine des comptes personnel
```

Cette commande existe parce que les trois pannes de configuration coûteuses —
**un schéma non exposé**, **une migration à moitié appliquée**, **un seau
absent** — donnent exactement le même symptôme dans le navigateur : une page
vide. Aucune ne se distingue des deux autres sans demander au serveur.

`.env.local` est déjà dans `.gitignore`. Vérifiez-le avant votre premier
commit, pas après.

> `STAFF_EMAIL_DOMAIN` n'a pas besoin d'exister comme domaine réel : il ne sert
> qu'à fabriquer l'adresse synthétique que Supabase Auth exige et que l'employé
> ne voit jamais. Mais il doit être **le même** dans `.env.local` et au moment
> où le compte a été créé, sinon la connexion échoue sans rien dire d'utile.

---

## 4. Créer le premier client, et s'y connecter · 10 min

Une organisation, son abonnement, son premier restaurant, son patron :

```bash
pnpm db:bootstrap -- \
  --org "Le Bambou SARL" --slug le-bambou --resto "Le Bambou Plateau" \
  --user fatou --password "MotDePasseFort" --name "Fatou Camara"
```

Ajoutez `--currency EUR --country FR` pour un restaurant hors zone franc : la
monnaie descend de l'organisation au lieu, et chaque lieu peut la redéfinir.

Attendu :

```
· Organisation « Le Bambou SARL » créée (XOF).
· Abonnement Resto : active.
· Restaurant « Le Bambou Plateau » créé.
✅ Patron « fatou » créé pour Le Bambou Plateau.
```

Puis :

```bash
pnpm dev
```

<http://localhost:3000/r/le-bambou/login> — identifiant `fatou`, mot de passe
`MotDePasseFort`.

Vous devez être **forcé de choisir un nouveau mot de passe** avant d'atteindre
quoi que ce soit : un mot de passe donné de vive voix ne doit pas survivre au
premier service.

### Trente secondes de vérification à la main

| Essayez | Attendu |
|---|---|
| Un mauvais mot de passe | *Identifiant ou mot de passe incorrect.* |
| Un identifiant inexistant | **Le même message, mot pour mot** — sinon on apprendrait qui travaille ici |
| `/r/le-palmier` (inexistant) | Renvoi vers la connexion, pas une page d'erreur |
| *Administration → La carte* → ajouter une catégorie, puis un plat **avec photo** | La photo part compressée (~40 Ko) et revient sur la vignette : c'est le stockage, les policies et les clés vérifiés d'un coup |
| Les flèches ↑ ↓ sur une catégorie | L'ordre change et **tient** au rechargement |

Mot de passe perdu, à tout moment :

```bash
pnpm db:bootstrap -- --slug le-bambou --reset --user fatou --password "NouveauMotDePasse"
```

---

## 5. Déployer sur Vercel · 10 min

1. [vercel.com/new](https://vercel.com/new) → importez `madjeiange-collab/nimbaa-crm`.
   **C'est un deuxième projet Vercel sur le même dépôt** : le CRM garde le
   sien. Un projet Vercel par application, comme le prévoit le §10 de
   `platform-architecture.md`.
2. Nom du projet : `nimbaa-resto`.
3. **Root Directory : `nimbaa-resto`.** ⚠️ *Le réglage à ne pas manquer.* Sans
   lui, Vercel construit le CRM qui est à la racine et vous obtenez une
   application qui n'a rien à voir. Laissez *« Include files outside of the
   Root Directory »* **décoché**.
4. Framework : **Next.js**, détecté. Gestionnaire : **pnpm**, détecté depuis
   `nimbaa-resto/pnpm-lock.yaml`.
5. *Environment Variables* — **deux, pas trois** :

   ```
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   ```

   **N'ajoutez pas `SUPABASE_SERVICE_ROLE_KEY`.** Rien dans l'application
   déployée ne s'en sert : elle n'existe que pour le script d'amorçage, qui
   tourne sur votre machine. Une clé qui contourne RLS et qui n'a aucun usage
   n'a rien à faire en production ; elle y sera ajoutée le jour où quelque
   chose en aura besoin, pas avant.
6. **Deploy.**

Deux réglages sont déjà dans `nimbaa-resto/vercel.json`, vous n'avez rien à
faire :

- **`"regions": ["cdg1"]`** — les fonctions tournent à Paris. Le rendu se fait
  côté serveur : si la fonction est en Virginie et la base à Paris, chaque page
  paie un aller-retour transatlantique **en plus** de celui du visiteur.
- **`"ignoreCommand"`** — un commit qui ne touche que le CRM ne redéclenche pas
  la construction du resto.

### La branche de production

Vercel déploie la production depuis la branche par défaut du dépôt, ici `main`
— **où `nimbaa-resto/` n'existe pas encore**. Trois options, par ordre de
préférence :

1. **Fusionner la branche de travail dans `main`** (une pull request, puis
   *Merge*). C'est la bonne fin : `main` porte la plateforme, chaque projet
   Vercel construit son sous-dossier, et la CI du §6 tourne sur les deux.
2. *Settings → Git → Production Branch* →
   `claude/restaurant-ordering-platform-7xz3p8`. Marche tout de suite, mais
   fige une branche de travail en production.
3. Ne rien faire et utiliser l'**URL de preview** que Vercel engendre pour la
   branche. Parfaitement fonctionnelle pour montrer le produit.

Déployez dès aujourd'hui, même si l'application ne fait encore que gérer une
carte. **Une chaîne de déploiement qu'on n'exerce qu'à la fin est une chaîne
qui casse à la fin** — le jour où l'on a le moins envie de déboguer des
variables d'environnement.

---

## 6. Ce que GitHub fait déjà pour vous

`.github/workflows/resto-ci.yml` tourne à chaque changement sous
`nimbaa-resto/` :

| Étape | Ce qu'elle attrape |
|---|---|
| Migrations appliquées dans l'ordre sur un Postgres 16 neuf | Une migration qui ne passe que sur *votre* base |
| Le paquet du SQL Editor appliqué d'un bloc | Le chemin de mise en service d'un nouveau client, qui casserait sans qu'on le sache |
| **La sonde : 35 assertions RLS** | Qu'un serveur ne réordonne pas la carte, qu'un patron ne voie pas chez le voisin, qu'un abonnement résilié ferme l'application |
| lint, types, build | Le reste |

La sonde est le morceau qui compte. Un typecheck ne dit **rien** de
l'étanchéité entre deux clients ; seule une base avec de vraies policies peut
le dire, et c'est pour cela qu'elle tourne sur un vrai Postgres et non sur des
doublures d'objets.

Vous pouvez rejouer exactement la même chose localement :

```bash
createdb nimbaa_test
psql nimbaa_test -f supabase/tests/local-postgres.sql   # doublures auth + storage
for f in supabase/migrations/*.sql; do psql nimbaa_test -v ON_ERROR_STOP=1 -f "$f"; done
psql nimbaa_test -f supabase/tests/probe.sql
```

`supabase/tests/local-postgres.sql` **ne doit jamais être appliqué à Supabase** :
là-bas `auth` et `storage` existent déjà et sont tenus par Supabase.

---

## 7. La liste avant de passer à la suite

- [ ] Projet Supabase **`nimbaa`**, région Europe
- [ ] *Exposed schemas* contient `core` **et** `resto`
- [ ] *Authentication → Sessions* : les deux délais sur **jamais**
- [ ] Douze tables, et un seau `menu` public
- [ ] `pnpm db:check` : **dix lignes vertes**
- [ ] `pnpm db:bootstrap` a créé l'organisation, l'abonnement, le restaurant et le patron
- [ ] La connexion locale impose le changement de mot de passe
- [ ] Un identifiant inconnu et un mauvais mot de passe donnent **le même** message
- [ ] Une photo de plat part et revient
- [ ] `.env.local` n'apparaît pas dans `git status`
- [ ] Déploiement Vercel vert, *Root Directory* = `nimbaa-resto`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` **absente** des variables Vercel
- [ ] La CI est verte sur GitHub

---

## 8. Si ça coince

| Symptôme | Cause probable |
|---|---|
| La page se charge mais tout est vide, aucune erreur | `core` ou `resto` absent d'*Exposed schemas*. `pnpm db:check` le dit en une ligne. |
| Vercel construit une application de vente terrain | *Root Directory* n'est pas `nimbaa-resto` |
| `Invalid login credentials` avec le bon mot de passe | `STAFF_EMAIL_DOMAIN` diffère entre le script d'amorçage et `.env.local` : l'adresse synthétique ne correspond plus |
| Boucle sans fin sur `/mot-de-passe` | `resto.clear_must_change_password()` absente — le schéma n'a pas été appliqué en entier |
| `permission denied for table …` | Migration partielle : les `grant` sont en fin de fichier. Réappliquez le paquet. |
| La photo ne part pas | Seau `menu` absent (*Storage*), ou compte sans rôle patron/gérant : l'écriture est tenue par `resto.can_manage()` |
| Les flèches ↑ ↓ ne font rien | Migration 0005 non appliquée — `pnpm db:check` a une ligne pour cela |
| L'application marchait, puis plus rien après une facture impayée | C'est voulu : `past_due` sert pendant la grâce, puis coupe. Voir `core.subscription_live`. |
| La CI échoue sur la sonde | Une policy a changé. Lisez la ligne `ÉCHEC` : elle nomme l'attendu et l'obtenu. |

---

## Ensuite

**P3 — la prise de commande.** Le plan de salle, le panier du serveur construit
sur `DishCard`, les tournées sur une session, l'éclatement vers les postes,
l'écran de cuisine où l'on touche « prêt », la liste à servir, et le temps
réel.

C'est le moment où l'application cesse d'être un back-office et devient
l'outil du service.
