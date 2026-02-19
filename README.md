# OKR Tool (Gemini + Supabase + Vercel-ready)

A Next.js OKR management tool that supports:

- Creating work items/tasks from UI
- Converting them into OKRs
- Batch AI recategorization, reprioritization, and deadline recalculation (Gemini)
- Editing and deleting active OKRs
- Completing OKRs with expected-vs-actual date variance logging
- Persisting OKRs per user in Supabase

## Run locally

```bash
npm install
cp .env.example .env.local
# set GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Required environment variables

- `GEMINI_API_KEY` (required)
- `SUPABASE_URL` (required)
- `SUPABASE_SERVICE_ROLE_KEY` (required, server-side only)
- `GEMINI_MODEL` (optional; if omitted defaults to `gemini-2.5-flash`, then falls back to auto-select)

## Supabase setup

1. Open Supabase SQL Editor.
2. Run `db/schema.sql` from this repo.
3. Copy your project URL and service role key.
4. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in local `.env.local` and Vercel project env vars.

## Vercel setup

In Vercel Project -> Settings -> Environment Variables, set:

- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_MODEL` (optional)

Apply to Preview and Production as needed.

## User-level persistence model

The app stores a generated local user identifier in browser localStorage and sends it as `x-user-id` on each API call. All CRUD operations are persisted in Supabase by that user id.

## Batch AI behavior

- You can create/edit/delete/complete multiple OKRs first.
- The app prompts before recategorization/reprioritization.
- Reconcile also recalculates deadlines when needed.

## Deploy to Vercel

```bash
npx vercel deploy . -y
```
