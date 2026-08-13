# Déploiement — Nimbaa CRM (Vercel + sous-domaine Hostinger)

Cible : `https://app.roedigerventures.de` servi par Vercel, backend Supabase inchangé.

## 0. Prérequis
- Compte GitHub (gratuit) — https://github.com/signup
- Compte Vercel (gratuit ; se connecte AVEC GitHub) — https://vercel.com/signup
- Les 4 variables d'environnement (voir `.env.local`, section 4 ci-dessous)

## 1. Pousser le code sur GitHub
Créer un dépôt **privé** vide sur github.com (sans README/licence), puis, à la racine du projet :

```bash
git remote add origin https://github.com/<votre-utilisateur>/nimbaa-crm.git
git push -u origin main
```
(La 1re authentification ouvre une fenêtre de connexion GitHub via le gestionnaire d'identifiants.)

## 2. Importer dans Vercel
1. vercel.com → **Add New… → Project** → **Import** le dépôt GitHub.
2. Framework : **Next.js** (détecté automatiquement). Build/Output : laisser par défaut.
3. **NE PAS déployer encore** — ajouter d'abord les variables (étape 3).

## 3. Variables d'environnement (Vercel → Project → Settings → Environment Variables)
Copier les valeurs depuis votre `.env.local` local. Cocher les 3 environnements
(Production, Preview, Development) pour chacune.

| Nom | Public ? | Source |
|-----|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | oui | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | oui | idem |
| `SUPABASE_SERVICE_ROLE_KEY` | **NON — secret** | idem (clé service_role) |
| `NEXT_PUBLIC_AUTH_EMAIL_DOMAIN` | oui | `crm.local` |

Puis **Deploy**. Vercel fournit une URL `…vercel.app` fonctionnelle.

## 4. Région (latence Abidjan)
Project → Settings → **Functions** → Region → choisir **Paris (cdg1)** ou Frankfurt
(proche de la Côte d'Ivoire ET de préférence la même région que le projet Supabase).

## 5. Brancher le sous-domaine
1. Vercel → Project → Settings → **Domains** → ajouter `app.roedigerventures.de`.
2. Hostinger hPanel → Domains → roedigerventures.de → **DNS / Nameserver** → ajouter :

| Type | Nom/Host | Valeur | TTL |
|------|----------|--------|-----|
| CNAME | `app` | `cname.vercel-dns.com` | défaut |

3. Attendre la propagation (quelques min). Vercel émet le certificat HTTPS automatiquement.
   → `https://app.roedigerventures.de` en ligne. N'affecte NI le domaine racine NI l'email.

## 6. Après mise en ligne
- Chaque `git push` sur `main` redéploie automatiquement.
- Changer le mot de passe admin (`admin` / bootstrap) via Profil.
- Vérifier les quotas Supabase Storage (photos) — passer en Pro si > 1 Go.
