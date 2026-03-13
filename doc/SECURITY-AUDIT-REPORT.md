# Rapport d'audit sécurité — Paperclip

**Date:** 2026-03-13  
**Périmètre:** codebase Paperclip (server, ui, packages, cli) — audit statique  
**Auditeur:** Application Security Engineer (audit orienté correctifs)

---

## 1. Contexte et périmètre

- **Stack:** Node.js 20+, TypeScript, Express 5, React + Vite, PostgreSQL (Drizzle), better-auth, JWT agents.
- **Backend:** `server/` (API REST), `packages/db/`, `packages/shared/`.
- **Services tiers:** better-auth, S3/storage, embedded Postgres en dev.
- **Déploiement:** `local_trusted` (sans auth) vs `authenticated` (login + company scoping).
- **Fonctionnalités sensibles:** auth board/agent, clés API agents, secrets chiffrés, uploads (assets/images, pièces jointes issues), activité, coûts, approbations.

**Périmètre explicite:** l’audit couvre le dépôt tel qu’analysé ; les adapteurs externes (claude-local, codex-local, etc.) et la CLI sont partiellement couverts (pas d’exhaustivité sur chaque commande).

---

## 2. Synthèse des findings

| ID    | Catégorie        | Sévérité  | Type            |
|-------|------------------|-----------|-----------------|
| V-01  | Secrets          | Critique  | Vulnérabilité   |
| V-02  | Injection/validation | Élevé  | Vulnérabilité   |
| V-03  | Configuration     | Élevé   | Risque potentiel |
| V-04  | Données/confidentialité | Moyen | Vulnérabilité |
| V-05  | Dépendances       | Moyen   | Risque potentiel |
| V-06  | Auth/Autorisation | Info    | Bonnes pratiques |

---

## 3. Findings détaillés

### V-01 — Secret d’auth par défaut (Better Auth)

- **Sévérité:** Critique (en déploiement `authenticated`).
- **Preuve:**  
  `server/src/auth/better-auth.ts` ligne 69 :
  ```ts
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.PAPERCLIP_AGENT_JWT_SECRET ?? "paperclip-dev-secret";
  ```
- **Risque:** En production sans `BETTER_AUTH_SECRET` ni `PAPERCLIP_AGENT_JWT_SECRET`, la session/cookies sont signées avec une valeur connue → falsification de session, prise de contrôle board.
- **Correctif:** Ne jamais utiliser de fallback secret en mode `authenticated`. Refuser le démarrage si secret manquant.

---

### V-02 — Validation MIME des pièces jointes (issues) basée sur le client

- **Sévérité:** Élevé.
- **Preuve:**  
  `server/src/routes/issues.ts` lignes 1069–1072, 1088–1090 :
  - `contentType = (file.mimetype || "").toLowerCase()` (client).
  - Pas d’usage de `file-type` (magic number) comme pour les assets.
- **Risque:** Upload de fichier malveillant déclaré comme image (ex. `image/png`) alors que le contenu est exécutable ou autre ; stockage et possible exécution/ouverture côté client.
- **Correctif:** Utiliser `fileTypeFromBuffer(file.buffer)` comme dans `server/src/routes/assets.ts`, et n’accepter que les types détectés figurant dans une allow-list.

---

### V-03 — Stack trace et contexte d’erreur dans les logs

- **Sévérité:** Élevé (si les logs sont exposées ou centralisées avec accès large).
- **Preuve:**  
  `server/src/middleware/error-handler.ts` : `attachErrorContext` enregistre `stack` (et `reqBody`/params/query) dans `res.__errorContext`.  
  `server/src/middleware/logger.ts` : `customProps` incluait `ctx.error` (donc `stack`) et `reqBody` brut dans les props pino.
- **Risque:** Les stack traces et corps de requête sont écrites en clair dans les fichiers/logs serveur. Fuite d’informations (chemins, structure, données sensibles) si les logs sont lues par des tiers ou exposées.
- **Correctif appliqué:** Dans `logger.ts`, les props loguées pour les 4xx/5xx n’incluent plus `stack` (uniquement `message` et `name` pour l’erreur), et `reqBody` est passé à `sanitizeRecord()` avant d’être logué.

---

### V-04 — Content-Disposition sur les pièces jointes (issues)

- **Sévérité:** Moyen.
- **Preuve:**  
  `server/src/routes/issues.ts` ligne 1141 :
  ```ts
  res.setHeader("Content-Disposition", `inline; filename=\"${filename.replaceAll("\"", "")}\"`);
  ```
  avec `filename = attachment.originalFilename ?? "attachment"` (non sanitisé).  
  Comparaison : `server/src/routes/assets.ts` utilise `sanitizeFilename()` (CR/LF, caractères spéciaux, longueur).
- **Risque:** Injection d’en-têtes HTTP si `originalFilename` contient `\r\n` (ex. `foo\r\nContent-Type: text/html\r\n\r\n<script>…`), ou caractères problématiques.
- **Correctif:** Réutiliser une sanitization de nom de fichier identique à celle des assets (même fonction ou module partagé).

---

### V-05 — Dépendances

- **Sévérité:** Moyen (variable selon CVE).
- **Preuve:** Pas d’exécution de `pnpm audit` dans le cadre de cet audit.
- **Risque:** Vulnérabilités connues dans les dépendances (express, better-auth, drizzle, etc.).
- **Correctif appliqué:** Étape « Audit dependencies » ajoutée dans `.github/workflows/pr-verify.yml` : `pnpm audit --audit-level=high` (les PR échouent si des vulnérabilités high ou critical sont présentes). À exécuter aussi en local et traiter les findings.

---

### V-06 — Auth / autorisation (point positif)

- **Sévérité:** N/A (bonnes pratiques).
- **Preuve:** `assertBoard` / `assertCompanyAccess` utilisés systématiquement sur les routes sensibles ; clés agents hashées (SHA-256) ; JWT agent avec `company_id` et vérification côté DB.
- **Risque:** Aucun identifié sur le périmètre vérifié.
- **Recommandation:** Conserver la règle « pas de correctif client-only sans équivalent serveur » et continuer à imposer les checks côté API.

---

## 4. Autres points (risques potentiels ou hors vulnérabilité)

- **Embedded Postgres (dev):** `server/src/index.ts` utilise `password: "paperclip"` pour l’instance embarquée. Acceptable si l’instance n’est jamais exposée (doc déjà alignée). À ne pas réutiliser pour une base exposée.
- **Health check:** `/api/health` sans auth est cohérent pour un health check ; la réponse ne contient pas de données sensibles.
- **Mermaid / MarkdownBody:** `dangerouslySetInnerHTML` avec sortie Mermaid en `securityLevel: "strict"`. Risque résiduel si le markdown provient d’utilisateurs non de confiance ; à documenter et à réévaluer si le contenu devient user-generated.

---

## 5. Score et verdict

- **Score global:** 3 vulnérabilités confirmées (1 critique, 1 élevée, 1 moyenne) + 2 risques potentiels (config/logs, dépendances).
- **Déployabilité:**
  - **local_trusted:** Déployable pour usage local/dev uniquement (pas d’exposition internet).
  - **authenticated (production):** **À ne pas déployer** tant que V-01 n’est pas corrigé. Après correctif V-01, déploiement acceptable sous réserve de traiter V-02 et V-04 et de sécuriser les logs (V-03) et les dépendances (V-05).

---

## 6. Plan d’action priorisé

1. **Immédiat (bloquant prod):** Corriger V-01 (pas de fallback secret en mode `authenticated`).
2. **Court terme:** Corriger V-02 (MIME par magic number pour les pièces jointes issues) et V-04 (sanitization nom de fichier pour Content-Disposition).
3. **Fait:** Réduction de l’exposition des logs (V-03) : plus de `stack` ni de `reqBody` brut dans les props pino ; `reqBody` est redacté via `sanitizeRecord`.
4. **Fait:** `pnpm audit --audit-level=high` intégré en CI (V-05) dans `pr-verify.yml`.

**Correctifs appliqués (V-01, V-02, V-04) :** voir commits associés. Tests de vérification suggérés :

- **V-01 :** En mode `authenticated`, ne pas définir `BETTER_AUTH_SECRET` ni `PAPERCLIP_AGENT_JWT_SECRET` → le serveur doit refuser de démarrer avec le message d’erreur prévu.
- **V-02 :** POST d’upload de pièce jointe avec un corps binaire non-image mais `Content-Type: image/png` → réponse 422 (type non reconnu ou non autorisé).
- **V-04 :** Télécharger une pièce jointe dont le nom contient `\r\n` → l’en-tête `Content-Disposition` ne doit pas contenir de ligne supplémentaire.
