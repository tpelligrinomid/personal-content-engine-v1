# Personal Content Engine

A backend engine that ingests personal content from multiple sources and generates weekly content drafts.

## What It Does

The engine processes three types of input:

1. **Trends/Signals** - Links, social posts, newsletters, and other trend indicators
2. **Meeting Recordings** - Transcripts from meetings where you speak frequently
3. **Voice Notes** - Short personal voice recordings (transcribed)

All inputs are normalized into "assets" and used to generate weekly output:

- 1 newsletter draft
- 1 blog post draft
- 5-6 LinkedIn post drafts

## Project Structure

```
src/
├── ingestion/      # Handlers for each source type
├── processing/     # Normalize inputs to assets
├── generation/     # Weekly batch content generation
├── services/       # Shared services (database, etc.)
└── index.ts        # Entry point

db/
└── migrations_manual/   # SQL files for manual Supabase changes

docs/
├── schema.md            # Database contract
└── development_process.md
```

## Running Locally

### Prerequisites

- Node.js 18+
- A Supabase project with credentials

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file with your Supabase credentials:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=your-service-key
   ```

3. Run in development mode:
   ```bash
   npm run dev
   ```

4. Build for production:
   ```bash
   npm run build
   npm start
   ```

## Deployment to Render

This engine deploys to a single live environment on Render.

### Setup

1. Create a new **Web Service** on Render
2. Connect your GitHub repository
3. Configure:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Environment**: Node
4. Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`

### Deployment Process

- Push to `main` branch triggers automatic deployment
- Render builds and deploys the new version

## Supabase Connection

The engine uses Supabase Postgres as its database.

### Configuration

Set these environment variables:

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service role key (not anon key) for server-side access |

### Schema Management

Schema changes are made manually in the Supabase dashboard, but are documented in:

- `docs/schema.md` - The source of truth for the database contract
- `db/migrations_manual/` - SQL files for each schema change

See `docs/development_process.md` for the workflow.
