# OKR Tool (Gemini + Supabase + Vercel-ready)

A Next.js OKR management tool that supports:

- Username/password signup and login via Supabase Auth
- Creating work items/tasks from UI
- Converting them into OKRs
- Batch AI recategorization, reprioritization, and deadline recalculation (Gemini)
- Editing and deleting active OKRs
- Completing OKRs with expected-vs-actual date variance logging
- Persisting OKRs per logged-in user in Supabase

## Run locally

```bash
npm install
cp .env.example .env.local
# set GEMINI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Required environment variables

- `GEMINI_API_KEY` (required)
- `NEXT_PUBLIC_SUPABASE_URL` (required)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (required)
- `SUPABASE_URL` (required)
- `SUPABASE_SERVICE_ROLE_KEY` (required, server-side only)
- `GEMINI_MODEL` (optional; defaults to `gemini-2.5-flash`, then falls back to auto-select)

## Supabase setup

1. Open Supabase SQL Editor.
2. Run `db/schema.sql`.
3. In Supabase Auth settings, disable email confirmation for immediate username/password access (or keep it on and handle confirmations).
4. Copy project URL, anon key, and service role key.
5. Set env vars locally and on Vercel.

## Authentication model

- UI accepts `username` + `password`.
- Username is internally mapped to synthetic email (`<username>@okrtool.local`) for Supabase email/password auth.
- All OKR API calls require Supabase access token.
- Server verifies token and uses authenticated user id as `user_id` for persistence.

## Vercel setup

In Vercel Project -> Settings -> Environment Variables, set:

- `GEMINI_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_MODEL` (optional)

Apply to Preview and Production as needed.
