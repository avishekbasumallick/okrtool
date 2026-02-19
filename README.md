# OKR Tool (Gemini + Vercel-ready)

A Next.js OKR management tool that supports:

- Creating work items/tasks from UI
- Converting them into OKRs
- Batch AI recategorization, reprioritization, and scope/deadline refinement (Gemini)
- Editing and deleting active OKRs
- Completing OKRs with expected-vs-actual date variance logging
- Archiving completed OKRs

## Run locally

```bash
npm install
cp .env.example .env.local
# add GEMINI_API_KEY in .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Gemini API setup

You should provide API details at these two points:

1. Local development
- File: `.env.local`
- Required variable: `GEMINI_API_KEY`
- Optional variable: `GEMINI_MODEL` (defaults to `gemini-1.5-flash`)

2. Vercel deployment
- Vercel Dashboard -> Project -> Settings -> Environment Variables
- Add `GEMINI_API_KEY` (and optional `GEMINI_MODEL`)
- Apply to Preview (and Production if needed)

## Batch AI behavior

- You can create/edit/delete/complete multiple OKRs first.
- The app sets a pending state and prompts before running recategorization/reprioritization.
- Gemini is called only when you click `Run Recategorization/Reprioritization` and confirm.

## Deploy to Vercel (Preview)

```bash
npx vercel deploy . -y
```

If CLI is not authenticated, login first:

```bash
npx vercel login
```

Then redeploy.
