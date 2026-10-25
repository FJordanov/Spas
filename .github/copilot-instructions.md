# Spas project rules

## Database
- Apply migrations to spas-test first. Check `npx supabase projects list` shows the dot next to spas-test.
- Always run `npx supabase db push --dry-run` before `db push`.
- Never change existing id, uid or seq_number columns.
- Every new table: enable RLS and add explicit GRANTs. Anonymous users get nothing unless a migration grants it.
- Never put keys, passwords or real device IDs in files.

## Sender app
- Apple-style design: large titles, 44 px tap targets, light and dark mode, VoiceOver labels.
- Keep the hold-to-send ring and the 4-second cancel window.
- While sending or in the cancel window, Settings and Alert info cannot be opened. When idle, they can be switched between directly.
- Never say rescuers received or can see an alert. Use "Sent".
- Every error screen shows a Call 112 button.
- Use "this device", not "phone".

## Legal
- Mark every legal draft "Draft, not legal advice".
- Version every document and store the version and time of consent.
- Include "This app does not replace 112" everywhere.

## Process
- Run the build after changes, and list every changed file with line numbers.
- Keep changes small: one feature per session.
- Use `git diff --stat` before committing.

## Cancel code and input
- The cancel code is a random 4-digit number, generated on the server when an alert is sent. Never generate it in the app and never let the user choose it.
- The cancel input must open the numeric keypad: inputMode="numeric" and pattern="[0-9]*".
- After 5 wrong codes, cancelling is locked for 10 minutes. The cancel window is 15 minutes after sending.
- Cancelling never deletes an alert. It sets status to cancelled with a timestamp.
