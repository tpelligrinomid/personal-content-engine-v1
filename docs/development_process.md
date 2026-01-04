# Development Process

Lightweight workflow for developing the Personal Content Engine.

## Branch Strategy

1. **Work on feature branches locally**
   - Create a branch for each feature or fix
   - Keep branches short-lived

2. **Merge to main to deploy**
   - Merging to `main` triggers deployment to Render
   - Ensure code works locally before merging

## Database Schema Changes

Schema changes are made manually in Supabase. Follow this process:

### Before Making Changes

1. Plan the change carefully
2. Consider backward compatibility if the engine is running

### Making the Change

1. Apply the change in Supabase dashboard
2. **Immediately** document in `docs/schema.md`
3. **Immediately** save the SQL in `db/migrations_manual/`

### Migration File Naming

Use this format: `YYYYMMDD_NN_description.sql`

Examples:
- `20240115_01_create_assets_table.sql`
- `20240115_02_add_source_type_enum.sql`

### Schema Hygiene

- **Avoid long-lived duplicate columns** - If renaming a column, migrate data and drop the old column in the same session
- **Keep schema changes clean** - Don't leave temporary columns or deprecated fields
- **Document everything** - Future you will thank present you

## Code Quality

- No linter configured yet (keep it simple to start)
- Test locally before pushing
- Keep functions small and focused

## Environment Variables

Never commit secrets. Use:
- `.env` locally (gitignored)
- Render environment variables in production
