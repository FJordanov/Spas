---
name: release-checklist
description: Use before committing, pushing or merging into main.
---
1. `git status` lists only the files you expect. No .env files.
2. `git grep -nE "service_role|sb_secret"` prints nothing.
3. `npm run build` passes in both sender and dashboard.
4. Test the sender in a private window: a normal alert, the rate-limit message, and the cancel code.
5. On Vercel, confirm VITE_IS_TEST_BUILD is set for each environment.
6. Open the pull request, read "Files changed", then merge.
7. After merging, send one test alert from the live link and check that is_test is set correctly.
