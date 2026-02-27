require('dotenv').config();
const express = require('express');
const path = require('path');
const getAirportByIata = require('airport-data-js');

// Airport coords cache — avoids repeat lookups for same IATA during a session
const _airportCache = {};
async function lookupAirport(iata) {
  if (!iata) return null;
  if (_airportCache[iata]) return _airportCache[iata];
  try {
    const results = await getAirportByIata.getAirportByIata(iata);
    const apt = Array.isArray(results) ? results[0] : results;
    if (apt?.latitude != null) {
      _airportCache[iata] = { lat: apt.latitude, lon: apt.longitude, name: apt.airport, city: apt.time?.split('/').pop()?.replace(/_/g, ' ') || '' };
      return _airportCache[iata];
    }
  } catch (_) {}
  return null;
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-memory alert store (use Redis/DB in production) ───────────────────────
const scheduledAlerts = new Map();

// ─── Demo flight data generator ───────────────────────────────────────────────
function getDemoFlights() {
  const now = Date.now();
  const h = 3600000;
  return {
    'BA178': {
      flightNumber: 'BA 178', airline: 'British Airways', aircraft: 'Boeing 777-200ER',
      status: 'en_route',
      dep: { iata: 'LHR', name: 'London Heathrow', city: 'London', lat: 51.477, lon: -0.461, terminal: 'T5', scheduledTime: new Date(now - 4.8*h).toISOString(), actualTime: new Date(now - 4.8*h).toISOString() },
      arr: { iata: 'JFK', name: 'J.F. Kennedy Intl', city: 'New York', lat: 40.641, lon: -73.778, terminal: 'T7', scheduledTime: new Date(now + 3.2*h).toISOString(), estimatedTime: new Date(now + 3.4*h).toISOString() },
      live: { latitude: 52.1, longitude: -32.4, altitude: 36000, speed: 548, heading: 272 },
      progress: 0.60, demo: true
    },
    'AA100': {
      flightNumber: 'AA 100', airline: 'American Airlines', aircraft: 'Boeing 777-300ER',
      status: 'en_route',
      dep: { iata: 'JFK', name: 'J.F. Kennedy Intl', city: 'New York', lat: 40.641, lon: -73.778, terminal: 'T8', scheduledTime: new Date(now - 2.5*h).toISOString(), actualTime: new Date(now - 2.5*h).toISOString() },
      arr: { iata: 'LAX', name: 'Los Angeles Intl', city: 'Los Angeles', lat: 33.942, lon: -118.408, terminal: 'T4', scheduledTime: new Date(now + 3.8*h).toISOString(), estimatedTime: new Date(now + 3.8*h).toISOString() },
      live: { latitude: 39.8, longitude: -97.5, altitude: 37000, speed: 532, heading: 266 },
      progress: 0.40, demo: true
    },
    'QF1': {
      flightNumber: 'QF 1', airline: 'Qantas Airways', aircraft: 'Airbus A380-800',
      status: 'en_route',
      dep: { iata: 'SYD', name: 'Sydney Airport', city: 'Sydney', lat: -33.946, lon: 151.177, terminal: 'T1', scheduledTime: new Date(now - 7*h).toISOString(), actualTime: new Date(now - 7*h).toISOString() },
      arr: { iata: 'LAX', name: 'Los Angeles Intl', city: 'Los Angeles', lat: 33.942, lon: -118.408, terminal: 'T4', scheduledTime: new Date(now + 6.5*h).toISOString(), estimatedTime: new Date(now + 6.2*h).toISOString() },
      live: { latitude: 20.5, longitude: -155.2, altitude: 38000, speed: 565, heading: 54 },
      progress: 0.52, demo: true
    },
    'EK202': {
      flightNumber: 'EK 202', airline: 'Emirates', aircraft: 'Airbus A380-800',
      status: 'en_route',
      dep: { iata: 'DXB', name: 'Dubai International', city: 'Dubai', lat: 25.253, lon: 55.365, terminal: 'T3', scheduledTime: new Date(now - 9*h).toISOString(), actualTime: new Date(now - 9*h).toISOString() },
      arr: { iata: 'JFK', name: 'J.F. Kennedy Intl', city: 'New York', lat: 40.641, lon: -73.778, terminal: 'T4', scheduledTime: new Date(now + 5.2*h).toISOString(), estimatedTime: new Date(now + 5.0*h).toISOString() },
      live: { latitude: 48.2, longitude: 15.8, altitude: 39000, speed: 558, heading: 298 },
      progress: 0.63, demo: true
    },
    'UA1': {
      flightNumber: 'UA 1', airline: 'United Airlines', aircraft: 'Boeing 787-9',
      status: 'en_route',
      dep: { iata: 'EWR', name: 'Newark Liberty Intl', city: 'Newark', lat: 40.689, lon: -74.174, terminal: 'C', scheduledTime: new Date(now - 1.2*h).toISOString(), actualTime: new Date(now - 1.2*h).toISOString() },
      arr: { iata: 'SFO', name: 'San Francisco Intl', city: 'San Francisco', lat: 37.619, lon: -122.374, terminal: '3', scheduledTime: new Date(now + 4.3*h).toISOString(), estimatedTime: new Date(now + 4.3*h).toISOString() },
      live: { latitude: 41.2, longitude: -88.1, altitude: 36000, speed: 520, heading: 270 },
      progress: 0.22, demo: true
    }
  };
}

// ─── Format AviationStack response ────────────────────────────────────────────
function formatAviationstackFlight(raw) {
  const depTime = raw.departure?.scheduled;
  const arrTime = raw.arrival?.estimated || raw.arrival?.scheduled;
  const totalMs = new Date(arrTime) - new Date(depTime);
  const elapsedMs = Date.now() - new Date(raw.departure?.actual || depTime);
  const progress = totalMs > 0 ? Math.min(Math.max(elapsedMs / totalMs, 0), 1) : null;

  return {
    flightNumber: raw.flight?.iata || raw.flight?.icao || 'Unknown',
    airline: raw.airline?.name || 'Unknown',
    aircraft: raw.aircraft?.iata || 'Unknown aircraft',
    status: raw.flight_status || 'unknown',
    dep: {
      iata: raw.departure?.iata,
      name: raw.departure?.airport,
      city: (raw.departure?.timezone || '').split('/').pop()?.replace(/_/g, ' ') || '',
      lat: null, lon: null,
      terminal: raw.departure?.terminal || 'N/A',
      scheduledTime: raw.departure?.scheduled,
      actualTime: raw.departure?.actual || raw.departure?.scheduled
    },
    arr: {
      iata: raw.arrival?.iata,
      name: raw.arrival?.airport,
      city: (raw.arrival?.timezone || '').split('/').pop()?.replace(/_/g, ' ') || '',
      lat: null, lon: null,
      terminal: raw.arrival?.terminal || 'N/A',
      scheduledTime: raw.arrival?.scheduled,
      estimatedTime: raw.arrival?.estimated || raw.arrival?.scheduled
    },
    live: raw.live ? {
      latitude: raw.live.latitude,
      longitude: raw.live.longitude,
      altitude: Math.round(raw.live.altitude * 3.281), // m → ft
      speed: Math.round(raw.live.speed_horizontal * 0.539957), // km/h → knots
      heading: raw.live.direction
    } : null,
    progress,
    demo: false
  };
}

// enrichAirportCoords — fills in lat/lon via airport-data-js (28k+ airports, cached)
async function enrichAirportCoords(flight) {
  if (!flight.dep.lat) {
    const apt = await lookupAirport(flight.dep.iata);
    if (apt) { flight.dep.lat = apt.lat; flight.dep.lon = apt.lon; if (!flight.dep.city) flight.dep.city = apt.city; }
  }
  if (!flight.arr.lat) {
    const apt = await lookupAirport(flight.arr.iata);
    if (apt) { flight.arr.lat = apt.lat; flight.arr.lon = apt.lon; if (!flight.arr.city) flight.arr.city = apt.city; }
  }
  return flight;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/flight/:number
app.get('/api/flight/:number', async (req, res) => {
  const code = req.params.number.toUpperCase().replace(/[\s\-]/g, '');

  if (process.env.AVIATIONSTACK_KEY) {
    try {
      // AviationStack often mislabels in-flight planes as "scheduled".
      // Use evidence-based scoring instead of trusting the status field:
      //   0 = has live GPS coords → definitely airborne
      //   1 = departed today + no arrival actual → in-air, departed today
      //   2 = departed (any day) + no arrival actual → in-air
      //   3 = status explicitly "active"
      //   4 = departed today (any state)
      //   5 = scheduled
      //   6 = landed
      //   7 = other
      const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

      function scoreResult(f) {
        const hasGPS    = f.live && f.live.latitude != null;
        const airborne  = hasGPS && f.live.is_ground === false; // official best-practice signal
        const depActual = f.departure?.actual || '';
        const arrActual = f.arrival?.actual   || '';
        const depToday  = depActual.startsWith(today);
        const inAir     = depActual && !arrActual;

        if (airborne)                        return 0; // GPS + confirmed not on ground
        if (hasGPS)                          return 1; // GPS present (is_ground unknown)
        if (depToday && inAir)               return 2; // departed today, not landed yet
        if (inAir)                           return 3; // departed (any day), not landed
        if (f.flight_status === 'active')    return 4; // status label alone
        if (depToday)                        return 5; // departed today (landed or other)
        if (f.flight_status === 'scheduled') return 6;
        if (f.flight_status === 'landed')    return 7;
        return 8;
      }

      // Single call — fetch all statuses, then pick the best by evidence score
      const allUrl = `http://api.aviationstack.com/v1/flights?access_key=${process.env.AVIATIONSTACK_KEY}&flight_iata=${code}&limit=10`;
      const allRes = await fetch(allUrl, { signal: AbortSignal.timeout(8000) });
      const allData = await allRes.json();

      if (allData.data && allData.data.length > 0) {
        const best = allData.data.slice().sort((a, b) => scoreResult(a) - scoreResult(b))[0];
        console.log(`[flight] Best result for ${code}: score=${scoreResult(best)} status=${best.flight_status} dep=${best.departure?.iata}→${best.arrival?.iata} live=${!!(best.live?.latitude)}`);
        const flight = await enrichAirportCoords(formatAviationstackFlight(best));
        return res.json({ success: true, data: flight });
      }
    } catch (e) {
      console.error('AviationStack error:', e.message);
    }
  }

  const demos = getDemoFlights();
  if (demos[code]) return res.json({ success: true, data: demos[code], demo: true });

  res.json({
    success: false,
    error: 'Flight not found.',
    hint: 'Try BA178, AA100, QF1, EK202 or UA1 in demo mode.'
  });
});

// POST /api/alert — schedule an SMS
app.post('/api/alert', async (req, res) => {
  const { phone, flightNumber, sendAtMs, type, arrivalCity } = req.body;
  if (!phone || !sendAtMs) return res.status(400).json({ success: false, error: 'Missing required fields' });

  const hasTwilio = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER;

  if (!hasTwilio) {
    console.log(`[Demo SMS] Would text ${phone} at ${new Date(sendAtMs).toLocaleTimeString()} about ${flightNumber}`);
    return res.json({ success: true, demo: true, message: 'Alert registered (Twilio not configured — add TWILIO_* vars to go live)' });
  }

  const delayMs = sendAtMs - Date.now();
  if (delayMs < -60000) return res.json({ success: false, error: 'Alert time is in the past' });

  const alertKey = `${phone}:${flightNumber}`;
  if (scheduledAlerts.has(alertKey)) clearTimeout(scheduledAlerts.get(alertKey));

  const messages = {
    leave: `✈️ Runway Alert: Time to head to the airport! ${flightNumber} is arriving in ${arrivalCity} soon. Leave now to be there on time.`,
    landing: `✈️ Runway: ${flightNumber} has landed in ${arrivalCity}! Go pick them up 🎉`,
    both_leave: `✈️ Runway: Time to leave! ${flightNumber} arrives in ${arrivalCity} soon — you're on track.`,
    both_landing: `✈️ Runway: ${flightNumber} has touched down in ${arrivalCity}! They're on the ground.`
  };

  const timeout = setTimeout(async () => {
    try {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilio.messages.create({
        body: messages[type] || messages.leave,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone
      });
      console.log(`✅ SMS sent to ${phone} for ${flightNumber}`);
      scheduledAlerts.delete(alertKey);
    } catch (e) {
      console.error('Twilio send error:', e.message);
    }
  }, Math.max(0, Math.min(delayMs, 2147483647)));

  scheduledAlerts.set(alertKey, timeout);
  res.json({ success: true, message: `SMS scheduled for ${new Date(sendAtMs).toLocaleTimeString()}` });
});

// GET /api/health
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    services: {
      flightData: process.env.AVIATIONSTACK_KEY ? 'live' : 'demo',
      sms: (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) ? 'live' : 'demo'
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🛫  Runway is running → http://localhost:${PORT}`);
  console.log(`    Flight data : ${process.env.AVIATIONSTACK_KEY ? '✅ Live (AviationStack)' : '⚠️  Demo mode'}`);
  console.log(`    SMS alerts  : ${process.env.TWILIO_ACCOUNT_SID ? '✅ Live (Twilio)' : '⚠️  Demo mode'}\n`);
});
