# Mise en route — Supabase, local, GitHub, Vercel

> **Ce document a été réécrit.** Sa version précédente expliquait comment
> échafauder le projet avec `create-next-app` — c'est fait. Le code existe, il
> est vérifié, et il attend un vrai projet Supabase. Voici de quoi le mettre en
> service, dans l'ordre. Comptez **35 à 45 minutes**.

Vous avez déjà les trois comptes nécessaires : Supabase, GitHub, Vercel.

---

## Où se trouve le code

Sur la branche `claude/restaurant-ordering-platform-7xz3p8` de
`madjeiange-collab/nimbaa-crm`, dans le sous-dossier **`nimbaa-resto/`**.

C'est un emplacement provisoire, choisi parce que la session ne peut pousser
que sur cette branche. Il ne compromet rien de ce qui compte : **le projet
Supabase, lui, est séparé dès maintenant**, et c'est là que vivait tout
l'argument de sécurité — deux serveurs Postgres distincts, deux `auth.users`,
aucun chemin de l'un vers l'autre.

Vercel sait déployer depuis un sous-dossier (§4), donc **rien ne vous oblige à
détacher le dépôt pour mettre en ligne**. Quand vous voudrez le faire :

```bash
git subtree split -P nimbaa-resto -b nimbaa-resto-main
# puis pousser cette branche vers un dépôt neuf, l'historique suit
```

Tant que vous me demandez d'ajouter des fonctionnalités depuis cette session,
gardez le sous-dossier : sinon chaque phase demandera une resynchronisation.

---

## 1. Récupérer le code · 3 min

```bash
git clone -b claude/restaurant-ordering-platform-7xz3p8 \
  https://github.com/madjeiange-collab/nimbaa-crm.git
cd nimbaa-crm/nimbaa-resto
pnpm install
```

Vérifiez l'outillage si besoin : `node -v` (≥ 18.18), `pnpm -v` (≥ 9).

---

## 2. Créer le projet Supabase · 10 min

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Nom : `nimbaa-resto`. **Un projet neuf, pas celui du CRM** — c'est tout
   l'intérêt.
3. Mot de passe de la base : conservez-le, il n'est affiché qu'une fois.
4. **Région : Europe (Paris ou Francfort).** Pas les États-Unis. Chaque
   commande écrite, chaque ticket de cuisine et chaque lecture de carte
   traverse ce lien, et depuis l'Afrique de l'Ouest les sauts européens sont
   nettement plus courts. **C'est le seul réglage de cette page qu'on ne peut
   pas changer ensuite sans migrer le projet.**
5. Pas de PostGIS, contrairement au CRM : rien ici n'est géographique.
6. Ne touchez pas à *Authentication → Providers*. La phase 1 a une seule porte,
   identifiant et mot de passe.

### Appliquer le schéma

*SQL Editor* → **New query** → collez tout le contenu de
`nimbaa-resto/supabase/migrations/0001_tenancy.sql` → **Run**.

Attendu : `Success. No rows returned`. Quelques `NOTICE ... does not exist,
skipping` sont normaux — les `drop policy if exists` d'une base vierge.

Vous devez voir trois tables dans *Table Editor*, chacune marquée **RLS
enabled** : `restaurants`, `restaurant_members`, `staff_accounts`.

### Vérifier l'étanchéité — recommandé, 2 min

Toujours dans le SQL Editor, collez et exécutez
`supabase/tests/0001_tenancy_probe.sql`, puis
`supabase/tests/0002_staff_context_probe.sql`.

Attendu : **13 lignes, toutes `OK`**. Les deux sondes tournent dans une
transaction annulée — elles ne laissent rien dans votre base.

> Si une sonde échoue sur une contrainte de `auth.users`, ce n'est pas votre
> schéma : c'est la sonde qui insère des utilisateurs factices. Passez à la
> suite, l'étape 3 vérifie la même chose avec de vrais comptes.

### Relever les clés

*Project Settings → API* :

| Champ Supabase | Variable |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY` |

---

## 3. Lancer en local et se connecter · 10 min

```bash
cp .env.local.example .env.local
```

Renseignez les trois clés, et laissez `STAFF_EMAIL_DOMAIN=staff.nimbaa.app`.
Ce domaine n'a pas besoin d'exister : il ne sert qu'à fabriquer l'adresse
synthétique que Supabase Auth exige et que l'employé ne voit jamais.

`.env.local` est déjà dans `.gitignore`. Vérifiez-le avant votre premier
commit, pas après.

### Créer le restaurant et son patron

```bash
node supabase/seed/bootstrap-owner.mjs le-bambou "Le Bambou" fatou "MotDePasseFort"
```

Attendu :

```
· Restaurant « Le Bambou » créé.
✅ Patron « fatou » créé pour Le Bambou.
   Connexion : /r/le-bambou/login
```

### Se connecter

```bash
pnpm dev
```

Ouvrez <http://localhost:3000/r/le-bambou/login>, identifiant `fatou`, mot de
passe `MotDePasseFort`.

Vous devez être **forcé de choisir un nouveau mot de passe** avant d'atteindre
quoi que ce soit — c'est voulu : un mot de passe donné de vive voix ne doit pas
survivre au premier service. Ensuite vient l'accueil : *Bonjour Fatou*,
*patron*, et une carte *Administration*.

### Ce que vous pouvez vérifier vous-même en trente secondes

| Essayez | Attendu |
|---|---|
| Un mauvais mot de passe | *Identifiant ou mot de passe incorrect.* |
| Un identifiant inexistant | **Le même message**, mot pour mot — sinon on apprendrait qui travaille ici |
| `/r/le-palmier` (inexistant) | Renvoi vers la page de connexion, pas d'erreur |
| Recharger `/r/le-bambou` | L'accueil, plus la page de mot de passe |

Mot de passe perdu, à tout moment :

```bash
node supabase/seed/bootstrap-owner.mjs le-bambou --reset fatou "NouveauMotDePasse"
```

---

## 4. Déployer sur Vercel · 10 min

1. [vercel.com/new](https://vercel.com/new) → importez `madjeiange-collab/nimbaa-crm`.
2. **Root Directory : `nimbaa-resto`.** ⚠️ *Le réglage à ne pas manquer.* Sans
   lui, Vercel construit le CRM qui est à la racine, et vous obtiendrez une
   application qui n'a rien à voir.
3. Framework : **Next.js** (détecté automatiquement).
4. *Environment Variables* — **deux seulement** :

   ```
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   ```

   **N'ajoutez pas `SUPABASE_SERVICE_ROLE_KEY`.** Rien dans l'application ne
   s'en sert : elle n'existe que pour le script de démarrage, qui tourne sur
   votre machine. Une clé qui contourne RLS et qui n'a aucun usage n'a rien à
   faire dans un environnement de production ; elle y sera ajoutée le jour où
   quelque chose en aura besoin, pas avant.

5. **Deploy.**

### La branche

Vercel déploie en production depuis la branche par défaut du dépôt, ici `main`
— où `nimbaa-resto/` n'existe pas. Deux options :

- **Le plus simple** : laissez faire et utilisez l'URL de *preview* que Vercel
  génère pour la branche `claude/restaurant-ordering-platform-7xz3p8`. Elle est
  parfaitement fonctionnelle.
- *Settings → Git → Production Branch* → mettez
  `claude/restaurant-ordering-platform-7xz3p8`.

Déployez dès aujourd'hui, même si l'application ne fait encore que connecter
quelqu'un. Une chaîne de déploiement qu'on n'exerce qu'à la fin est une chaîne
qui casse à la fin — le jour où vous avez le moins envie de déboguer des
variables d'environnement.

---

## 5. Vérifier avant de passer à la suite

- [ ] `pnpm build` passe
- [ ] Les trois tables existent, **RLS enabled** sur les trois
- [ ] Les sondes donnent 13 `OK`
- [ ] `bootstrap-owner.mjs` a créé le restaurant et le patron
- [ ] La connexion locale marche, et impose le changement de mot de passe
- [ ] Un identifiant inconnu et un mauvais mot de passe donnent **le même** message
- [ ] `.env.local` n'apparaît pas dans `git status`
- [ ] Le déploiement Vercel est vert et sa page de connexion s'affiche
- [ ] `SUPABASE_SERVICE_ROLE_KEY` **n'est pas** dans les variables Vercel

---

## Si ça coince

| Symptôme | Cause probable |
|---|---|
| Vercel construit une application de vente terrain | *Root Directory* n'est pas `nimbaa-resto` |
| `Invalid login credentials` avec le bon mot de passe | `STAFF_EMAIL_DOMAIN` diffère entre le script et `.env.local` : l'adresse synthétique ne correspond plus |
| Boucle sur `/mot-de-passe` | `clear_must_change_password()` absente — la migration n'a pas été appliquée en entier |
| `permission denied for table restaurants` | Migration partielle : les `grant` sont à la fin du fichier |
| La page de connexion s'affiche mais rien ne se passe | Clés Supabase absentes ou erronées. `NEXT_PUBLIC_*` est figé **à la construction** : après les avoir changées, reconstruire |
| Tout est vide après connexion | Le compte n'a pas de ligne dans `restaurant_members` |

---

## Ensuite

**P2 — la carte et la salle** : catégories, plats avec prix et poste de
préparation, zones, tables, et l'écran du patron pour créer son équipe.

C'est le premier morceau où l'application commence à ressembler à un outil de
restaurant plutôt qu'à un formulaire de connexion.
