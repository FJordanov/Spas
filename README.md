<div align="center">

# 🏔️ Spas

**A pilot emergency alert system for mountain rescue (ПСС, Vitosha pilot)**

<img src="https://img.shields.io/badge/status-pilot%20in%20development-orange" alt="Status: pilot in development" />
<img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache 2.0" />
<img src="https://img.shields.io/badge/backend-Supabase-3ECF8E" alt="Backend: Supabase" />

</div>

> ⚠️ **Not for real emergencies yet.** For any real emergency, call **112**. This app does not replace 112.

---

## 🔗 Links

| What | Where |
|------|-------|
| 📱 Hiker app (sender) | [spas-khaki.vercel.app](https://spas-khaki.vercel.app) |
| 🛠️ Staff dashboard | Staff only, not public |

---

## 📖 What is Spas?

A hiker presses and holds an **SOS button** in a web app. The alert, with the hiker's location, is saved to a database. Rescuers see it on a **staff dashboard**.

---

## 🧭 How to use it safely

1. **Keep the app open and the screen on** while sending.
2. **Hold the SOS button until the ring is full.** Releasing early cancels.
3. **Wait for "Sent"** before closing the app. If it stays on "Sending" for more than 20 seconds, **call 112 directly**.
4. **Practise in test mode**, not with real alerts.
5. **If you sent an alert by mistake**, use the cancel option as soon as you notice.

---

## ✅ What has been built

- 🆘 **Anonymous SOS**: hold to send, with a 4-second cancel window.
- 🔐 **Database security**: row-level security on every table. Anonymous users can only insert validated alerts and reports.
- 🚦 **Rate limit**: 5 alerts or reports per minute per device. Developer test devices are exempt.
- 📊 **Repeat score**: each alert gets a 0–100 score against the previous alert from the same device.
- 🗺️ **Dashboard**: loads all alerts in chunks of 1000.
- 🧪 **Test mode**: test alerts are marked `is_test` and hidden from rescue staff.
- 🧱 **Separate test database** (`spas-test`), rebuilt from the migration files, with all security checks passing.

---

## 🗂️ Repository layout

<table>
  <tr><td><b>sender/</b></td><td>The hiker app (React + Vite): SOS button, cancel window, Settings, Alert info</td></tr>
  <tr><td><b>dashboard/</b></td><td>The staff dashboard (React + Vite): alerts for logged-in staff</td></tr>
  <tr><td><b>supabase/</b></td><td>The database: migrations for tables, security rules, rate limit and repeat score</td></tr>
  <tr><td><b>docs/</b></td><td>Planned Terms of Use and Privacy Policy (drafts, not legal advice)</td></tr>
</table>

---

<details>
<summary><b>💻 Running it locally</b></summary>

**Hiker app**

Run these in the `sender` folder, then copy `.env.example` to `.env.local` and fill in the values listed in it.

- Install dependencies: `npm install`
- Start the app: `npm run dev`

**Staff dashboard**

Run these in the `dashboard` folder, using the same `.env.local` approach.

- Install dependencies: `npm install`
- Start the dashboard: `npm run dev`

> Never commit `.env.local`. It is already listed in `.gitignore`.

</details>

<details>
<summary><b>🔒 Security notes</b></summary>

- The Supabase **anon (public) key** is meant to be public. Security comes from the database rules, not from hiding that key.
- Never commit a `service_role` or `sb_secret` key. Check with: `git grep -nE "service_role|sb_secret"`
- Database changes are made through migration files and tested on the test project first.

</details>

<details>
<summary><b>🤝 Contributing</b></summary>

Only the project owner commits to this repository. Changes go through pull requests into `dev`, and `main` is the live version.

</details>

---

## ⚖️ Legal

Terms of Use and the Privacy Policy are **drafts** and must be reviewed by a qualified lawyer before real users use the app. Licence: see [LICENSE](LICENSE).