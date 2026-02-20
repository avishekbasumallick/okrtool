# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm run dev          # Start development server on http://localhost:3000
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
```

## Environment Setup

Copy `.env.example` to `.env.local` and configure:

- `GEMINI_API_KEY` - Required for AI features (scope generation, reconciliation)
- `GEMINI_MODEL` - Optional (defaults to `gemini-2.5-flash`, will auto-select if unavailable)
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_URL` - Supabase project URL (server-side)
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (server-side)

## Architecture Overview

### Tech Stack
- **Frontend**: Next.js 16.1.6 with React 19 and TypeScript
- **Backend**: Next.js API Routes
- **Database**: Supabase (PostgreSQL) with single `okrs` table
- **Authentication**: Supabase Auth with username → synthetic email mapping (`<username>@okrtool.local`)
- **AI**: Google Gemini API for scope generation and OKR reconciliation

### Key Directories
- `app/api/okrs/` - OKR CRUD endpoints
- `app/api/ai/` - AI-powered features (reconciliation)
- `lib/` - Shared utilities (auth, Supabase clients, types, Gemini integration)

### Authentication Model
All API routes require `x-user-id` header (enforced via `requireUserId()` in `lib/user-id.ts`). Users are authenticated via Supabase using username/password, with usernames mapped to synthetic emails for Supabase compatibility.

### Database Schema
Single `okrs` table with:
- Basic fields: `id`, `user_id`, `title`, `scope`, `deadline`, `category`, `priority`, `notes`
- Status: `active` or `archived` (check constraint)
- Audit: `created_at`, `updated_at`, `completed_at`, `expected_vs_actual_days`
- Priority constraint: P1-P5 only
- Composite index on `(user_id, status, priority, deadline)`

### AI Integration (Gemini)

**Scope Generation** (`lib/gemini-reconcile.ts:generateScopeText`):
- Generates concise OKR scope from title/notes
- No JSON response required

**Reconciliation** (`lib/gemini-reconcile.ts:reconcileWithGemini`):
- Batch reprioritization and deadline recalculation
- Scoped by category (only processes OKRs in specified category)
- Parses potentially malformed JSON responses via `tryParseUpdateArray()`
- Falls back to sensible defaults if AI fails
- Model auto-selection: If configured model is unavailable, queries Gemini ListModels API and scores candidates by name (prefers `gemini-2.*-flash`)

**Categories** (`lib/categories.ts`):
- Fixed set of broad categories: "Uncategorized", "Product", "Engineering", "Growth", "Sales & Marketing", "Customer Success", "Operations", "Finance & Legal", "People & Culture", "Strategy"
- Reconciliation only assigns categories if OKR is "Uncategorized"

### API Route Patterns
- Use `requireUserId()` to extract and validate `x-user-id` header
- Returns `NextResponse` with appropriate status codes
- Use `supabase-admin` client for server-side operations
- Row-level security via `user_id` filtering

### Type Definitions (`lib/types.ts`)
- `Priority`: P1-P5 union type
- `ActiveOKR`: Active OKR with all fields except completion data
- `CompletedOKR`: ActiveOKR + `completedAt` + `expectedVsActualDays`
- `AppState`: Application state with active/archived OKRs and `pendingAiRefresh` flag
- `AiUpdate`: Partial update returned from AI reconciliation

### Important Constraints
- All OKRs must have `title` and `notes` (minimum enforced in UI)
- Deadlines are stored as `date` type (no time component)
- Reconciliation only processes OKRs within the specified category
- Questions endpoint (`/api/okrs/reconcile/questions`) is deprecated (returns 410)
