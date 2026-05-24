# BudgetBuddy SG

A personal budgeting tool and financial coach, built for a fresh graduate starting their first full-time job in Singapore. It tracks daily and monthly expenses, runs an envelope budgeting system, tracks goals like a BTO down payment or travel fund, and includes a money coach that understands CPF and Singapore's financial landscape.

This is a standalone web app. Once deployed it runs entirely in your browser, costs nothing, and does not depend on Claude or any subscription.

## Why this repo exists

The tool was first built as a Claude artifact. Artifacts are great but live inside Claude. This repo makes the tool permanent and independent:

- It runs as a normal website you control.
- Your data is saved in your browser's `localStorage` — on your device, private, no account needed.
- Daily use costs zero tokens and zero dollars.
- It keeps working after any Pro plan ends.

## Features

- **Dashboard** — macro view of income, spending pace, budget-vs-actual, net worth, and flagged issues.
- **Net worth tracker** — record current holdings across savings account, fixed deposit, investments, CPF, cash, and other; editable anytime from the Dashboard. Liquid vs. longer-term assets are distinguished so the emergency fund is sized correctly.
- **Salary updates with history** — change your salary anytime in Settings (e.g. when you switch jobs or get a raise); every change is logged with a date and reason so you keep an earning history.
- **Envelopes** — guided spending with a 50/30/20 starter split you can adjust.
- **Subscriptions** — a dedicated tracker for every recurring charge: cost, billing cycle, and next renewal/deduction date. Totals your monthly and yearly spend and can sync that figure into your subscriptions envelope.
- **Owed (reminders)** — track money owed to you: who owes it, what for, and how much. Each reminder can be one-time or recurring (daily/weekly/monthly) with an optional end date. Overdue items are flagged.
- **Ledger** — granular, spreadsheet-style expense tracking; each entry updates its envelope.
- **Goals** — milestone tracking for Emergency Fund, BTO, Renovation, Travel, and investing.
- **AI Coach** — a conversational money coach with two modes (see below).

## The two Coach modes — this is the important part for cost

The AI Coach has a toggle inside the app:

- **Free mode (default).** Answers come from a built-in Singapore finance knowledge base using your real numbers. Instant, completely free, no tokens, no API key, works offline and forever. This is the recommended mode for daily use.
- **AI mode (optional).** Sends your questions to the Anthropic API for richer, more flexible answers. This costs money per message and needs your own API key. Use it occasionally for harder questions, not for daily check-ins.

Everything else in the app — tracking, envelopes, goals, dashboard — is always free regardless of mode.

## Running it locally

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
```

Then open the URL shown in the terminal (usually `http://localhost:5173`).

## Optional: enabling AI mode

AI mode is off by default and not needed. If you want it:

1. Get an Anthropic API key from the Anthropic Console.
2. Create a file named `.env.local` in this folder with one line:
   ```
   VITE_ANTHROPIC_API_KEY=your_key_here
   ```
3. Restart `npm run dev`.

The `.env.local` file is gitignored, so your key never gets committed. If no key is present, AI mode simply falls back to Free mode — nothing breaks.

Note: each AI-mode message costs a small amount on your Anthropic account. Free mode is recommended for everyday use; reserve AI mode for occasional deeper questions.

## Deploying it for free (so it's always available)

This repo includes a GitHub Actions workflow that publishes the app to **GitHub Pages** automatically — free, no server, no maintenance.

1. Push this repo to GitHub.
2. In the repo: **Settings → Pages → Build and deployment → Source → GitHub Actions**.
3. Every push to `main` rebuilds and redeploys automatically.
4. Your app lives at `https://<your-username>.github.io/budgetbuddy/`.

If you deploy somewhere other than a GitHub Pages project site (Vercel, Netlify, custom domain), change `base` in `vite.config.js` from `"/budgetbuddy/"` to `"/"`.

## Keeping it sustainable for daily use

- Use **Free mode** for daily expense logging and check-ins — zero cost.
- The deployed site loads instantly and works on your phone's browser; you can add it to your home screen.
- Your data persists per-browser. To move data between devices, the app's Settings has a reset option; a full export/import feature is a natural next addition if you need it.
- Updating the tool later: edit `src/App.jsx`, push to `main`, and the site redeploys itself.

## Your data and privacy

All financial data stays in your browser's `localStorage`. Nothing is uploaded anywhere in Free mode. In AI mode, only the text of your question and a short summary of your numbers are sent to the Anthropic API to generate a reply.

## A note on the financial content

This tool is for personal education and planning. It is not licensed financial advice. CPF rates, contribution ceilings, and scheme rules change over time — the figures used (2024/25 rates) should be verified against official sources such as the CPF Board and MoneySense before making significant financial decisions.
