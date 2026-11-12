# Twitch Chat AI Tool

> ⚠️ Disclaimer - It was not designed as a “fake Twitch chat animator.” Its sole purpose is to develop moderator agents that possess their own unique personalities.

A moderation tool that simulates AI personas on Twitch chat activity on a real channel. Twitch **moderator accounts** act as chat participants, each driven by an **Azure AI agent with a configurable persona** (personality, interests, emote style, chattiness). Personas read live chat, can reply to each other and the streamer, and can tag other chatters. Controlled from a local web dashboard with a live chat feed.

> ⚠️ Messages are sent to **real Twitch chat**. Only target a channel you own or have permission to test against, and keep generated content within Twitch's Community Guidelines. `data/` contains OAuth refresh tokens — it is gitignored; never commit it.

## Prerequisites

1. **Node.js 20+** and npm.
2. **Twitch application** — create one at <https://dev.twitch.tv/console/apps>:
   - OAuth Redirect URL: `http://localhost:3000/api/auth/callback`
   - Category: anything (e.g. "Application Integration")
   - Note the **Client ID** and generate a **Client Secret**.
3. **Twitch test accounts** — ordinary Twitch accounts you control, one per simulated chatter. Verify each account's email, or Twitch will silently drop their chat messages on most channels.
4. **Azure AI Foundry project** (optional, required for AI personas):
   - A project in [Azure AI Foundry](https://ai.azure.com) with a chat model deployment (e.g. `gpt-4o-mini`).
   - Your Azure identity needs **Contributor** (or Azure AI User) on the project.
   - Auth is Entra ID only: run `az login` before starting the server (or provide service-principal env vars that `DefaultAzureCredential` picks up).

## Setup

```bash
cp .env.example .env     # fill in Twitch credentials, target channel, Azure endpoint
npm install
npm run dev              # backend on :3000, dashboard on http://localhost:5173
```

`.env` values:

| Variable | Description |
| --- | --- |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | From your registered Twitch app |
| `TARGET_CHANNEL` | Channel login name the simulated chatters join (the customer's channel) |
| `AZURE_AI_PROJECT_ENDPOINT` | Azure AI Foundry project endpoint, e.g. `https://<resource>.services.ai.azure.com/api/projects/<project>` |
| `AZURE_AI_MODEL_DEPLOYMENT` | Model deployment name, e.g. `gpt-4o-mini` |
| `PORT` | Backend port (default 3000) |

If the Azure variables are left empty, the tool still works for manual sends and static message pools — only AI personas are disabled.

## Onboarding a test account

1. Open an **incognito/private window** and log into twitch.tv with the **moderator account**.
2. In the dashboard, click **+ Add account** — approve the authorization in the incognito window.
3. The account appears in the Accounts panel; its refresh token is stored in `data/tokens/<userId>.json` and reused across restarts.

## Using the simulator

- **Live chat** — the right panel mirrors the target channel's chat (anonymous read connection), rendering Twitch emotes and highlighting your simulated accounts.
- **Manual send** — pick an account, type a message (emote codes like `Kappa` are plain words), hit Send.
- **Personas** — create personas (personality, interests, favorite emotes, chattiness, verbosity, language) and assign one to each account. **Preview** generates a sample message without sending anything to Twitch.
- **Scenario** — select participants and start:
  - **AI mode**: each account chats in character at its persona's rate (scaled by the rate multiplier). Agents see the stream context you provide plus the last ~10 live chat messages, so they react to the streamer and each other. Mentions (`@name`) trigger replies; the **Reactivity** slider controls how often personas react to unaddressed messages.
  - **Pool mode**: cheap fallback — random lines from a static message pool at a fixed rate, no Azure required.
  - Scenarios can be saved/loaded and optionally auto-stop after a duration.

## Rate limits & safety rails

- Per-account sends are throttled to **18 messages / 30 s** (Twitch allows 20/30 s for non-mod accounts); excess messages queue (queue depth shown per account).
- At most **3 concurrent AI generations** to bound Azure cost and latency.
- Reply-loop guards: 15 s reactive cooldown per account, max 2 reactive replies between the same pair of accounts per 2 minutes, max 8 reactive replies/minute globally.
- Generated text is sanitized to a single line, ≤450 chars; persona instructions pin agents to Twitch community guidelines.
- Azure agents are created once per persona and reused (cached agent id in `data/personas/*.json`); conversation threads are deleted when a scenario stops.
- Twitch rejections (unverified email, followers-only, duplicate message, bans) surface as error toasts in the dashboard.

## Architecture

```
server/ (Fastify, 127.0.0.1:3000)
  accounts/   OAuth onboarding + RefreshingAuthProvider per account (Twurple)
  chat/       sender pool (one ChatClient per account) · throttle · anonymous channel listener
  ai/         persona store · Azure AI Agents service (agent per persona, thread per run)
  scheduler/  scenario schema · auto-chatter engine (per-persona timers + reactive replies)
  api/        REST routes + WebSocket hub (live feed / status events)
web/    (Vite + React dashboard, :5173, proxies /api and /ws to the server)
data/   (gitignored) accounts.json · tokens/ · personas/ · scenarios/
```
