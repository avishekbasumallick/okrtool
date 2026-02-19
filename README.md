# OKR Tool (GLM z.ai + Vercel-ready)

A Next.js OKR management tool that supports:

- Creating work items/tasks from UI
- Converting them into OKRs
- Batch AI recategorization, reprioritization, and scope/deadline refinement (GLM via z.ai)
- Editing and deleting active OKRs
- Completing OKRs with expected-vs-actual date variance logging
- Archiving completed OKRs

## Run locally

```bash
npm install
cp .env.example .env.local
# add ZAI_API_KEY in .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## GLM (z.ai) API setup

You should provide API details at these two points:

1. Local development
- File: `.env.local`
- Required variable: `ZAI_API_KEY`
- Optional variable: `ZAI_MODEL` (defaults to `glm-5`)
- Optional variable: `ZAI_BASE_URL` (defaults to `https://api.z.ai/api/paas/v4`)

2. Vercel deployment
- Vercel Dashboard -> Project -> Settings -> Environment Variables
- Add `ZAI_API_KEY` (and optional `ZAI_MODEL`, `ZAI_BASE_URL`)
- Apply to Preview (and Production if needed)

## Batch AI behavior

- You can create/edit/delete/complete multiple OKRs first.
- The app sets a pending state and prompts before running recategorization/reprioritization.
- GLM is called only when you click `Run Recategorization/Reprioritization` and confirm.

## Deploy to Vercel (Preview)

```bash
npx vercel deploy . -y
```

If CLI is not authenticated, login first:

```bash
npx vercel login
```

Then redeploy.
