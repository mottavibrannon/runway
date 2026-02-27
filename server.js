require('dotenv').config();
const express = require('express');
const path    = require('path');
const getAirportByIata = require('airport-data-js');

// ─── Airport coordinate lookup (free, 28k+ airports, in-memory cache) ─────────
const _airportCache = {};
async function lookupAirport(iata) {
  if (!iata) return null;
  if (_airportCache[iata]) return _airportCache[iata];
  try {
    const results = await getAirportByIata.getAirportByIata(iata);
    const apt = Array.isArray(results) ? results[0] : results;
    if (apt?.latitude != null) {
      _airportCache[iata] = { lat: apt.latitude, lon: apt.longitude };
      return _airportCache[iata];
    }
  } catch (_) {}
  return null;
}

const app  = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const scheduledAlerts = new Map();

// ─── Demo flights ──────────────────────────────────────────────────────────────
function getDemoFlights() {
  const now = Date.now(), h = 3600000;
  return {
    'BA178': {
      flightNumber: 'BA 178', airline: 'British Airways', aircraft: 'B77W',
      status: 'active',
      dep: { iata: 'LHR', name: 'London Heathrow', city: 'London',     lat: 51.477,   lon: -0.461,   terminal: 'T5', scheduledTime: new Date(now - 4.8*h).toISOString(), actualTime: new Date(now - 4.8*h).toISOString() },
      arr: { iata: 'JFK', name: 'J.F. Kennedy Intl', city: 'New York', lat: 40.641,   lon: -73.778,  terminal: 'T7', scheduledTime: new Date(now + 3.2*h).toISOString(), estimatedTime: new Date(now + 3.4*h).toISOString() },
      live: { latitude: 52.1, longitude: -32.4, altitude: 36000, speed: 548, heading: 272, is_ground: false },
      progress: 0.60, demo: true
    },
    'AA100': {
      flightNumber: 'AA 100', airline: 'American Airlines', aircraft: 'B77W',
      status: 'active',
      dep: { iata: 'JFK', name: 'J.F. Kennedy Intl', city: 'New York',      lat: 40.641,   lon: -73.778,  terminal: 'T8', scheduledTime: new Date(now - 2.5*h).toISOString(), actualTime: new Date(now - 2.5*h).toISOString() },
      arr: { iata: 'LAX', name: 'Los Angeles Intl',  city: 'Los Angeles',   lat: 33.942,   lon: -118.408, terminal: 'T4', scheduledTime: new Date(now + 3.8*h).toISOString(), estimatedTime: new Date(now + 3.8*h).toISOString() },
      live: { latitude: 39.8, longitude: -97.5, altitude: 37000, speed: 532, heading: 266, is_ground: false },
      progress: 0.40, demo: true
    },
    'QF1': {
      flightNumber: 'QF 1', airline: 'Qantas Airways', aircraft: 'A388',
      status: 'active',
      dep: { iata: 'SYD', name: 'Sydney Airport',    city: 'Sydney',       lat: -33.946,  lon: 151.177,  terminal: 'T1', scheduledTime: new Date(now - 7*h).toISOString(), actualTime: new Date(now - 7*h).toISOString() },
      arr: { iata: 'LAX', name: 'Los Angeles Intl',  city: 'Los Angeles',  lat: 33.942,   lon: -118.408, terminal: 'T4', scheduledTime: new Date(now + 6.5*h).toISOString(), estimatedTime: new Date(now + 6.2*h).toISOString() },
      live: { latitude: 20.5, longitude: -155.2, altitude: 38000, speed: 565, heading: 54, is_ground: false },
      progress: 0.52, demo: true
    },
    'EK202': {
      flightNumber: 'EK 202', airline: 'Emirates', aircraft: 'A388',
      status: 'active',
      dep: { iata: 'DXB', name: 'Dubai International', city: 'Dubai',      lat: 25.253,   lon: 55.365,   terminal: 'T3', scheduledTime: new Date(now - 9*h).toISOString(), actualTime: new Date(now - 9*h).toISOString() },
      arr: { iata: 'JFK', name: 'J.F. Kennedy Intl',   city: 'New York',   lat: 40.641,   lon: -73.778,  terminal: 'T4', scheduledTime: new Date(now + 5.2*h).toISOString(), estimatedTime: new Date(now + 5.0*h).toISOString() },
      live: { latitude: 48.2, longitude: 15.8, altitude: 39000, speed: 558, heading: 298, is_ground: false },
      progress: 0.63, demo: true
    },
    'UA1': {
      flightNumber: 'UA 1', airline: 'United Airlines', aircraft: 'B789',
      status: 'active',
      dep: { iata: 'EWR', name: 'Newark Liberty Intl', city: 'Newark',     lat: 40.689,   lon: -74.174,  terminal: 'C', scheduledTime: new Date(now - 1.2*h).toISOString(), actualTime: new Date(now - 1.2*h).toISOString() },
      arr: { iata: 'SFO', name: 'San Francisco Intl',  city: 'San Francisco', lat: 37.619, lon: -122.374, terminal: '3', scheduledTime: new Date(now + 4.3*h).toISOString(), estimatedTime: new Date(now + 4.3*h).toISOString() },
      live: { latitude: 41.2, longitude: -88.1, altitude: 36000, speed: 520, heading: 270, is_ground: false },
      progress: 0.22, demo: true
    }
  };
}

// ─── FlightAware AeroAPI ───────────────────────────────────────────────────────
// ICAO operator code → human-readable airline name
const AIRLINE_NAMES = {
  UAL:'United Airlines', AAL:'American Airlines', DAL:'Delta Air Lines',
  SWA:'Southwest Airlines', JBU:'JetBlue Airways', ASA:'Alaska Airlines',
  NKS:'Spirit Airlines', FFT:'Frontier Airlines', HAL:'Hawaiian Airlines',
  BAW:'British Airways', DLH:'Lufthansa', AFR:'Air France', KLM:'KLM',
  UAE:'Emirates', QTR:'Qatar Airways', SIA:'Singapore Airlines',
  CPA:'Cathay Pacific', JAL:'Japan Airlines', ANA:'All Nippon Airways',
  KAL:'Korean Air', QFA:'Qantas', ANZ:'Air New Zealand', THY:'Turkish Airlines',
  ACA:'Air Canada', WJA:'WestJet', IBE:'Iberia', RYR:'Ryanair',
  EZY:'easyJet', TAP:'TAP Air Portugal', AAY:'Allegiant Air',
};

function mapStatus(faStatus) {
  if (!faStatus) return 'unknown';
  const s = faStatus.toLowerCase();
  if (s.includes('en route') || s.includes('departed')) return 'active';
  if (s.includes('arrived'))   return 'landed';
  if (s.includes('cancelled')) return 'cancelled';
  if (s.includes('diverted'))  return 'diverted';
  if (s.includes('scheduled')) return 'scheduled';
  return 'unknown';
}

function formatFlightAwareFlight(f, pos) {
  return {
    flightNumber: f.ident_iata || f.ident || 'Unknown',
    airline:      AIRLINE_NAMES[f.operator] || f.operator || 'Unknown',
    aircraft:     f.aircraft_type || null,
    status:       mapStatus(f.status),
    dep: {
      iata:          f.origin?.code_iata || f.origin?.code,
      name:          f.origin?.name      || '',
      city:          f.origin?.city      || '',
      lat:           null, lon: null,          // filled by lookupAirport
      terminal:      f.terminal_origin   || 'N/A',
      scheduledTime: f.scheduled_out,
      actualTime:    f.actual_out        || f.scheduled_out,
    },
    arr: {
      iata:          f.destination?.code_iata || f.destination?.code,
      name:          f.destination?.name      || '',
      city:          f.destination?.city      || '',
      lat:           null, lon: null,          // filled by lookupAirport
      terminal:      f.terminal_destination   || 'N/A',
      scheduledTime: f.scheduled_in,
      estimatedTime: f.estimated_in || f.scheduled_in,
    },
    live: pos ? {
      latitude:  pos.latitude,
      longitude: pos.longitude,
      altitude:  pos.altitude  != null ? pos.altitude * 100      : null, // FL → feet
      speed:     pos.groundspeed != null ? pos.groundspeed        : null, // already knots
      heading:   pos.heading   != null ? pos.heading              : null,
      is_ground: pos.altitude  != null ? pos.altitude < 10       : null, // FL < 10 = on ground
    } : null,
    progress: f.progress_percent != null ? f.progress_percent / 100 : null,
    demo: false
  };
}

async function fetchFromFlightAware(ident) {
  const key = process.env.FLIGHTAWARE_API_KEY;
  if (!key) return null;

  const url = `https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(ident)}`;
  const res  = await fetch(url, {
    headers: { 'x-apikey': key },
    signal:  AbortSignal.timeout(10000)
  });

  if (!res.ok) {
    console.error(`[FlightAware] ${res.status} for ${ident}`);
    return null;
  }

  const json    = await res.json();
  const flights = json.flights;
  if (!flights?.length) return null;

  // Prefer the in-flight one; fall back to most recent (array is newest-first)
  const active = flights.find(f => f.progress_percent > 0 && f.progress_percent < 100);
  const chosen = active || flights[0];

  console.log(`[FlightAware] ${chosen.ident_iata} | status="${chosen.status}" | progress=${chosen.progress_percent}% | fa_id=${chosen.fa_flight_id}`);

  // Fetch live position separately — not included in the search response
  let pos = null;
  if (chosen.fa_flight_id && mapStatus(chosen.status) === 'active') {
    try {
      const posRes = await fetch(
        `https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(chosen.fa_flight_id)}/position`,
        { headers: { 'x-apikey': key }, signal: AbortSignal.timeout(5000) }
      );
      if (posRes.ok) {
        const posJson = await posRes.json();
        pos = posJson.last_position || posJson;
        console.log(`[FlightAware] position: alt=${pos.altitude} spd=${pos.groundspeed} hdg=${pos.heading}`);
      }
    } catch (e) {
      console.warn('[FlightAware] position fetch failed:', e.message);
    }
  }

  return formatFlightAwareFlight(chosen, pos);
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/api/flight/:number', async (req, res) => {
  const code = req.params.number.toUpperCase().replace(/[\s\-]/g, '');

  // ── Live: FlightAware AeroAPI ──────────────────────────────────────────────
  if (process.env.FLIGHTAWARE_API_KEY) {
    try {
      const flight = await fetchFromFlightAware(code);

      if (flight) {
        // Fill in airport lat/lon for map rendering
        const dep = await lookupAirport(flight.dep.iata);
        if (dep) { flight.dep.lat = dep.lat; flight.dep.lon = dep.lon; }

        const arr = await lookupAirport(flight.arr.iata);
        if (arr) { flight.arr.lat = arr.lat; flight.arr.lon = arr.lon; }

        // If airborne and we have GPS: recompute ETA from distance ÷ speed
        if (flight.live?.is_ground === false && flight.arr.lat && flight.live.speed > 50) {
          const R  = 3440.065; // Earth radius in nautical miles
          const φ1 = flight.live.latitude  * Math.PI/180;
          const φ2 = flight.arr.lat        * Math.PI/180;
          const Δφ = (flight.arr.lat - flight.live.latitude) * Math.PI/180;
          const Δλ = (flight.arr.lon - flight.live.longitude) * Math.PI/180;
          const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
          const distNm = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          const eta = new Date(Date.now() + (distNm / flight.live.speed) * 3600000).toISOString();
          flight.arr.estimatedTime = eta;
          console.log(`[ETA] ${Math.round(distNm)}nm at ${flight.live.speed}kt → ${new Date(eta).toLocaleTimeString()}`);
        }

        return res.json({ success: true, data: flight });
      }
    } catch (e) {
      console.error('[FlightAware] error:', e.message);
    }
  }

  // ── Demo fallback ──────────────────────────────────────────────────────────
  const demos = getDemoFlights();
  if (demos[code]) return res.json({ success: true, data: demos[code], demo: true });

  res.json({ success: false, error: 'Flight not found.', hint: 'Try BA178, AA100, QF1, EK202 or UA1.' });
});

// ─── SMS alert ─────────────────────────────────────────────────────────────────
app.post('/api/alert', async (req, res) => {
  const { phone, flightNumber, sendAtMs, type, arrivalCity } = req.body;
  if (!phone || !sendAtMs) return res.status(400).json({ success: false, error: 'Missing required fields' });

  const hasTwilio = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER;
  if (!hasTwilio) {
    console.log(`[Demo SMS] Would text ${phone} at ${new Date(sendAtMs).toLocaleTimeString()} about ${flightNumber}`);
    return res.json({ success: true, demo: true });
  }

  const delayMs = sendAtMs - Date.now();
  if (delayMs < -60000) return res.json({ success: false, error: 'Alert time is in the past' });

  const alertKey = `${phone}:${flightNumber}`;
  if (scheduledAlerts.has(alertKey)) clearTimeout(scheduledAlerts.get(alertKey));

  const messages = {
    leave:       `✈️ Runway: Time to head to the airport! ${flightNumber} arrives in ${arrivalCity} soon.`,
    landing:     `✈️ Runway: ${flightNumber} has landed in ${arrivalCity}! Go pick them up 🎉`,
    both_leave:  `✈️ Runway: Time to leave for ${arrivalCity} — ${flightNumber} is on its way.`,
    both_landing:`✈️ Runway: ${flightNumber} touched down in ${arrivalCity}!`,
  };

  const timeout = setTimeout(async () => {
    try {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilio.messages.create({ body: messages[type] || messages.leave, from: process.env.TWILIO_PHONE_NUMBER, to: phone });
      console.log(`✅ SMS sent to ${phone} for ${flightNumber}`);
      scheduledAlerts.delete(alertKey);
    } catch (e) {
      console.error('Twilio error:', e.message);
    }
  }, Math.max(0, Math.min(delayMs, 2147483647)));

  scheduledAlerts.set(alertKey, timeout);
  res.json({ success: true, message: `SMS scheduled for ${new Date(sendAtMs).toLocaleTimeString()}` });
});

// ─── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    services: {
      flightData: process.env.FLIGHTAWARE_API_KEY ? 'live' : 'demo',
      sms:        process.env.TWILIO_ACCOUNT_SID  ? 'live' : 'demo'
    }
  });
});

app.get('/flight/:number', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n🛫  Runway → http://localhost:${PORT}`);
  console.log(`    Flight data : ${process.env.FLIGHTAWARE_API_KEY ? '✅ FlightAware AeroAPI' : '⚠️  Demo mode'}`);
  console.log(`    SMS alerts  : ${process.env.TWILIO_ACCOUNT_SID  ? '✅ Twilio'              : '⚠️  Demo mode'}\n`);
});
