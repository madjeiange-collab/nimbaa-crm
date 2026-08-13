# CRM Terrain — Vente B2B & Porte-à-porte

Application web (PWA légère) de gestion commerciale terrain pour équipes B2B et
porte-à-porte (D2D), pensée pour une connectivité faible, des téléphones Android
d'entrée de gamme et une interface **100 % en français**.

> **État : Phase 1 — Fondations** (authentification, routage par capacité,
> dessin des secteurs). Les phases suivantes ajoutent la saisie terrain, le
> pipeline de prospects, le mode hors-ligne, les tableaux de bord manager,
> l'administration, l'anti-fraude et le déploiement.

---

## 1. Prérequis

| Outil | Version | Remarque |
|-------|---------|----------|
| Node.js | **≥ 18.18** | ⚠️ Non installé sur cette machine — [télécharger](https://nodejs.org/) (LTS) |
| pnpm | ≥ 9 | `npm install -g pnpm` (ou utilisez `npm`) |
| Compte Supabase | — | Offre gratuite suffisante |
| Compte Vercel | — | Pour le déploiement (optionnel en local) |

Vérifiez l'installation :

```bash
node -v
pnpm -v
```

---

## 2. Configuration Supabase (avec PostGIS)

1. Créez un projet sur [supabase.com](https://supabase.com).
2. **Activez PostGIS** : Dashboard → *Database* → *Extensions* → recherchez
   `postgis` → *Enable*. (La migration l'active aussi via
   `create extension if not exists postgis`, mais l'activer ici évite les
   surprises de permissions.)
3. Récupérez les clés dans *Project Settings → API* :
   - `Project URL`
   - `anon public`
   - `service_role` (**secrète**)

### Appliquer le schéma

Deux options :

**A. Éditeur SQL (le plus simple)** — copiez-collez le contenu de
`supabase/migrations/0001_init.sql` puis `0002_functions.sql` dans le *SQL
Editor* de Supabase et exécutez, dans cet ordre.

**B. CLI Supabase** :

```bash
supabase link --project-ref <votre-ref>
supabase db push
```

---

## 3. Variables d'environnement

Copiez le modèle et renseignez vos valeurs :

```bash
cp .env.local.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://VOTRE-PROJET.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_AUTH_EMAIL_DOMAIN=crm.local
```

> **Authentification par nom d'utilisateur** : les commerciaux se connectent
> avec un **nom d'utilisateur + mot de passe** (pas d'email). En interne, chaque
> compte est stocké sous `identifiant@crm.local` dans Supabase Auth ; l'utilisateur
> ne voit jamais cette adresse. La clé `service_role` reste **côté serveur
> uniquement**.

---

## 4. Créer le premier administrateur

L'écran de gestion des utilisateurs arrive en Phase 6. Pour tester dès
maintenant, créez un admin via le script de bootstrap :

```bash
pnpm install
node supabase/seed/bootstrap-admin.mjs admin "MotDePasseFort" "Administrateur"
```

Connectez-vous ensuite avec l'identifiant **admin**.

---

## 5. Développement local

```bash
pnpm install
pnpm dev
```

Ouvrez [http://localhost:3000](http://localhost:3000). Vous êtes redirigé vers
`/login`. Après connexion, l'accueil s'adapte à votre rôle et à vos capacités
(`can_do_b2b` / `can_do_d2d`).

Scripts utiles :

| Commande | Rôle |
|----------|------|
| `pnpm dev` | Serveur de développement |
| `pnpm build` | Build de production |
| `pnpm start` | Servir le build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Vérification TypeScript |

---

## 6. Déploiement sur Vercel

1. Poussez le dépôt sur GitHub.
2. Sur [vercel.com](https://vercel.com), *New Project* → importez le dépôt.
3. Ajoutez les variables d'environnement (mêmes clés que `.env.local`) dans
   *Settings → Environment Variables*.
4. Déployez. Le backend reste sur Supabase.

---

## 7. Ce qui est livré en Phase 1

- Ossature Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui
- Internationalisation **next-intl** (français par défaut, anglais en repli)
- Clients Supabase (navigateur / serveur / admin) + middleware de session
- Schéma complet (PostGIS, RLS, index géospatiaux, pipeline, contacts,
  visites, liste ne-pas-frapper, conflits de sync, vue anti-fraude)
- **Authentification identifiant + mot de passe**
- Accueil **routé par capacité** (B2B / D2D / mixte / manager / admin)
- **Dessin des secteurs** (Leaflet + leaflet-draw → GeoJSON → geography)
- Écran de changement de mot de passe

---

## 8. Structure du projet

```
src/
  app/[locale]/        Pages (login, home, profile, admin, dashboard, …)
  components/          UI (shadcn), cartes Leaflet, éléments partagés
  i18n/                Configuration next-intl (routing, navigation, request)
  lib/                 Supabase, auth, secteurs
  messages/            fr.json, en.json
  types/               Types de la base
supabase/
  migrations/          0001_init.sql, 0002_functions.sql
  seed/                bootstrap-admin.mjs (et jeu de données en Phase 8)
```
