---
name: supabase-migration
description: Use when writing, reviewing or applying a Supabase migration in the Spas project.
---
- Apply to spas-test first. Check `npx supabase projects list` shows the dot next to spas-test before any push.
- Never change existing id, uid or seq_number columns or their types.
- Every new table: enable RLS, and add explicit GRANTs (Supabase stops default API access from 30 October 2026). Anonymous users get nothing unless a migration lists it.
- Always run `npx supabase db push --dry-run` first. Push only when it lists the new file.
- Never put keys, passwords or real device IDs in migration files.
- After applying to spas-test, run the checklist query and the test scripts. Production changes need the user's explicit approval.
