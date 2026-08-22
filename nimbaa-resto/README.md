# Nimbaa Resto

Prise de commande en salle, cuisine, encaissement. Le restaurant prend ses
propres commandes ; la commande par QR code arrive plus tard.

> **Emplacement provisoire.** Ce projet vit dans un sous-dossier de
> `nimbaa-crm` le temps d'être détaché. Les deux applications sont
> indépendantes par conception : dépôt distinct, projet Supabase distinct,
> aucun appel de l'une vers l'autre. Pour l'extraire avec son historique :
>
> ```bash
> git subtree split -P nimbaa-resto -b nimbaa-resto-main
> ```

## Phase 1 — état

| | |
|---|---|
| ✅ | Socle plateforme `core` : organisations, abonnements, accès produit, monnaies |
| ✅ | Accès conditionné à l'abonnement — résilier ferme l'application, sans déploiement |
| ✅ | Monnaie par organisation, surchargeable par restaurant (`NULL` = héritée) |
| ✅ | Connexion identifiant + mot de passe, par restaurant |
| ✅ | Premier mot de passe imposé à la première connexion |
| ✅ | Accueil routé par rôle |
| ✅ | `bootstrap-owner.mjs` — organisation, abonnement, restaurant, patron |
| ⬜ | Carte et plan de salle · commandes · cuisine · encaissement |

## Démarrer

```bash
pnpm install
cp .env.local.example .env.local     # puis renseigner les clés Supabase
```

Appliquer les migrations dans l'ordre — `0001_core.sql` puis `0002_resto.sql`
(SQL Editor ou `supabase db push`). Dans Supabase, exposer les schémas `core` et
`resto` : *Project Settings → API → Exposed schemas*.

Puis créer l'organisation, son abonnement, son restaurant et son patron :

```bash
node supabase/seed/bootstrap-owner.mjs \
  --org "Le Bambou SARL" --slug le-bambou --resto "Le Bambou Plateau" \
  --user fatou --password "MotDePasseFort" --name "Fatou Camara"
pnpm dev
```

Connexion sur <http://localhost:3000/r/le-bambou/login>. Le patron choisit son
propre mot de passe à la première connexion, puis crée le reste de l'équipe.

Mot de passe perdu :

```bash
node supabase/seed/bootstrap-owner.mjs --slug le-bambou --reset \
  --user fatou --password "NouveauMotDePasse"
```

## Vérifier

```bash
pnpm typecheck && pnpm lint && pnpm build
DATABASE_URL="postgresql://..." pnpm db:probe   # 15 lignes, toutes OK
```

Les sondes de `supabase/tests/` tournent dans une transaction annulée : elles
ne laissent rien derrière elles et se rejouent partout. **Chaque table ajoutée
gagne sa ligne dans une sonde, dans le même commit que sa migration.**

## Conventions

- SQL commenté en français, code TypeScript commenté en anglais — comme le CRM.
- Interface en français uniquement pour l'instant.
- Lectures via RLS, écritures via route handler ou server action : un employé
  authentifié reste un client non fiable.
- Montants : entiers dans l'unité la plus petite, jamais de flottant. Le nombre
  de décimales vient de `core.currencies`, jamais d'une hypothèse.
