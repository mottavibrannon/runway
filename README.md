# ✈ Runway — Flight Tracker

> Know exactly when to leave for the airport.

A beautiful, real-time flight tracking web app. Enter a flight number, see it on an animated live map, get a personalised leave-by time based on your location, and subscribe to SMS alerts via Twilio.

---

## Features

- Full-screen dark map with animated great-circle flight path
- Moving, glowing plane marker that rotates to face its heading
- Live countdown timer to estimated arrival
- Geolocation-based "when to leave" calculator (drive time + airport buffer)
- SMS alert subscription — text you when it's time to go
- Works out of the box in demo mode (no API keys required)
- Swaps to real live data the moment you add an AviationStack key

---

## Quick Start (local)

```bash
cd runway-app
npm install
cp .env.example .env      # fill in your keys (optional — demo mode works without)
npm start                  # open http://localhost:3000
```

Node 18+ required. Uses `node --watch` for dev mode (`npm run dev`).

---

## Deploy to Railway (recommended — free tier)

1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub**
3. Select your repo
4. Add environment variables in the Railway dashboard (Settings → Variables):
   - `AVIATIONSTACK_KEY`
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_PHONE_NUMBER`
5. Railway auto-detects Node and runs `npm start` — you'll get a live URL in ~60 seconds

---

## Deploy to Render (free tier)

1. Push to GitHub
2. Go to [render.com](https://render.com) → **New → Web Service**
3. Connect your repo, set:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
4. Add environment variables under Environment
5. Deploy

---

## Deploy to Vercel (serverless caveat)

Vercel works but SMS scheduling (`setTimeout`) won't persist between serverless invocations. For SMS alerts on Vercel, use an external job scheduler (e.g. Quirrel, Upstash QStash, or a cron that polls `/api/flight/:number`).

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AVIATIONSTACK_KEY` | Optional | Live flight data. Free tier = 500 req/month. [Get key](https://aviationstack.com) |
| `TWILIO_ACCOUNT_SID` | Optional | Twilio account SID for SMS |
| `TWILIO_AUTH_TOKEN` | Optional | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Optional | Your Twilio number (e.g. `+15551234567`) |
| `PORT` | Optional | Server port (default: 3000) |

All variables are optional — the app runs beautifully in demo mode without any keys.

---

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/flight/:number` | GET | Flight status by IATA number (e.g. `BA178`) |
| `/api/alert` | POST | Schedule an SMS alert |
| `/api/health` | GET | Service status (live vs demo mode) |

### POST /api/alert body

```json
{
  "phone": "+15551234567",
  "flightNumber": "BA 178",
  "sendAtMs": 1740000000000,
  "type": "leave",
  "arrivalCity": "New York"
}
```

`type` can be `leave`, `landing`, `both_leave`, or `both_landing`.

---

## Demo Flights

These work out of the box without any API keys:

| Code | Route |
|---|---|
| `BA178` | London Heathrow → J.F. Kennedy |
| `AA100` | J.F. Kennedy → Los Angeles |
| `QF1` | Sydney → Los Angeles |
| `EK202` | Dubai → J.F. Kennedy |
| `UA1` | Newark → San Francisco |

---

## Tech Stack

- **Backend**: Node.js + Express
- **Flight data**: [AviationStack](https://aviationstack.com) (or demo fallback)
- **SMS**: [Twilio](https://twilio.com)
- **Map**: [Leaflet.js](https://leafletjs.com) + CartoDB Dark Matter tiles
- **Frontend**: Vanilla HTML/CSS/JS — zero build step, zero framework

---

## License

MIT — build something great.
