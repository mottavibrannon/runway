require('dotenv').config();
const express = require('express');
const path = require('path');
const getAirportByIata = require('airport-data-js');

// Derive a human-readable city from an airport's full name
// e.g. "Austin-Bergstrom International Airport" → "Austin"
//      "San Francisco International Airport"    → "San Francisco"
function cityFromAirportName(name) {
  if (!name) return '';
  return name
    .replace(/\s+(International|Intl\.?|Regional|Municipal|Metropolitan|Memorial|National|Executive|General|Commercial|Civil)\b.*$/i, '')
    .replace(/[-–].*$/, '')   // strip hyphenated suffixes like "-Bergstrom"
    .replace(/\s+Airport.*$/i, '')
    .replace(/\bAirport\b.*$/i, '')
    .trim();
}

// Airport coords cache — avoids repeat lookups for same IATA during a session
const _airportCache = {};
async function lookupAirport(iata) {
  if (!iata) return null;
  if (_airportCache[iata]) return _airportCache[iata];
  try {
    const results = await getAirportByIata.getAirportByIata(iata);
    const apt = Array.isArray(results) ? results[0] : results;
    if (apt?.latitude != null) {
      _airportCache[iata] = {
        lat: apt.latitude,
        lon: apt.longitude,
        name: apt.airport,
        city: cityFromAirportName(apt.airport)
      };
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
  let progress = totalMs > 0 ? Math.min(Math.max(elapsedMs / totalMs, 0), 1) : null;

  // If the flight is still active (not landed) but the scheduled arrival has passed,
  // the plane is delayed — don't show it at the destination (100%), cap at 90%.
  if (raw.flight_status === 'active' && !raw.arrival?.actual && progress != null && progress >= 0.9) {
    progress = 0.9;
  }

  return {
    flightNumber: raw.flight?.iata || raw.flight?.icao || 'Unknown',
    airline: raw.airline?.name || 'Unknown',
    aircraft: raw.aircraft?.iata || raw.aircraft?.icao || null,
    status: raw.flight_status || 'unknown',
    _icao24: raw.aircraft?.icao24 || null,       // used for OpenSky lookup, stripped before send
    dep: {
      iata: raw.departure?.iata,
      name: raw.departure?.airport,
      city: '',   // filled in by enrichAirportCoords via airport-data-js
      lat: null, lon: null,
      terminal: raw.departure?.terminal || 'N/A',
      scheduledTime: raw.departure?.scheduled,
      actualTime: raw.departure?.actual || raw.departure?.scheduled
    },
    arr: {
      iata: raw.arrival?.iata,
      name: raw.arrival?.airport,
      city: '',   // filled in by enrichAirportCoords via airport-data-js
      lat: null, lon: null,
      terminal: raw.arrival?.terminal || 'N/A',
      scheduledTime: raw.arrival?.scheduled,
      estimatedTime: raw.arrival?.estimated || raw.arrival?.scheduled
    },
    live: raw.live ? {
      latitude:  raw.live.latitude,
      longitude: raw.live.longitude,
      altitude:  raw.live.altitude  != null ? Math.round(raw.live.altitude  * 3.281)    : null, // m → ft
      speed:     raw.live.speed_horizontal != null ? Math.round(raw.live.speed_horizontal * 0.539957) : null, // km/h → knots
      heading:   raw.live.direction,
      is_ground: raw.live.is_ground ?? (raw.live.altitude != null && raw.live.altitude < 100 ? true : false),
    } : null,
    progress,
    demo: false
  };
}

// enrichAirportCoords — fills in lat/lon + city via airport-data-js (28k+ airports, cached)
async function enrichAirportCoords(flight) {
  const dep = await lookupAirport(flight.dep.iata);
  if (dep) { flight.dep.lat = dep.lat; flight.dep.lon = dep.lon; flight.dep.city = dep.city; }

  const arr = await lookupAirport(flight.arr.iata);
  if (arr) { flight.arr.lat = arr.lat; flight.arr.lon = arr.lon; flight.arr.city = arr.city; }

  return flight;
}

// ─── OpenSky Network — live ADS-B position enrichment ────────────────────────
// Maps airline IATA codes to ICAO operator codes used in ADS-B callsigns
const AIRLINE_ICAO = {
  AA:'AAL', UA:'UAL', DL:'DAL', WN:'SWA', B6:'JBU', AS:'ASA', NK:'NKS',
  F9:'FFT', G4:'AAY', HA:'HAL', SY:'SCX', MX:'MXA', VX:'VRD', OO:'SKW',
  BA:'BAW', LH:'DLH', AF:'AFR', KL:'KLM', EK:'UAE', QR:'QTR', SQ:'SIA',
  CX:'CPA', JL:'JAL', NH:'ANA', KE:'KAL', OZ:'AAR', CA:'CCA', MU:'CES',
  CZ:'CSN', QF:'QFA', NZ:'ANZ', TK:'THY', AY:'FIN', SK:'SAS', LX:'SWR',
  OS:'AUA', IB:'IBE', VY:'VLG', FR:'RYR', U2:'EZY', EI:'EIN', TP:'TAP',
  AC:'ACA', WS:'WJA', LO:'LOT', SN:'BEL', A3:'AEE', TG:'THA', MH:'MAS',
  GA:'GIA', PR:'PAL', VN:'HVN', AI:'AIC', '6E':'IGO', SL:'RLX',
};

function formatOpenSkyState(s) {
  // OpenSky state vector array positions:
  // [0]icao24 [1]callsign [2]origin_country [3]time_position [4]last_contact
  // [5]longitude [6]latitude [7]baro_altitude [8]on_ground [9]velocity
  // [10]true_track [11]vertical_rate [12]sensors [13]geo_altitude
  if (!s || s[5] == null || s[6] == null) return null;
  return {
    latitude:  s[6],
    longitude: s[5],
    altitude:  s[7]  != null ? Math.round(s[7]  * 3.281)    : null, // m → ft
    speed:     s[9]  != null ? Math.round(s[9]  * 1.94384)  : null, // m/s → knots
    heading:   s[10] != null ? Math.round(s[10])             : null,
    is_ground: s[8],
  };
}

async function enrichWithOpenSky(flight) {
  // Enrich any flight that has no live position and isn't confirmed on the ground
  if (flight.live || ['landed', 'cancelled', 'diverted'].includes(flight.status)) return flight;

  try {
    const osUser = process.env.OPENSKY_USER;
    const osPass = process.env.OPENSKY_PASS;
    const auth   = osUser ? `${osUser}:${osPass}@` : '';
    const base   = `https://${auth}opensky-network.org/api`;

    // ── Strategy 1: direct ICAO24 lookup (most precise) ─────────────────────
    if (flight._icao24) {
      const url = `${base}/states/all?icao24=${flight._icao24.toLowerCase()}`;
      const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        const pos  = data.states?.length ? formatOpenSkyState(data.states[0]) : null;
        if (pos && !pos.is_ground) {
          console.log(`[OpenSky] icao24 hit for ${flight.flightNumber}`);
          flight.live = pos;
          const gcProgress = gcPositionFraction(flight.dep.lat, flight.dep.lon, flight.arr.lat, flight.arr.lon, pos.latitude, pos.longitude);
          if (gcProgress != null) flight.progress = gcProgress;
          const eta = computeETA(pos.latitude, pos.longitude, flight.arr.lat, flight.arr.lon, pos.speed);
          if (eta) flight.arr.estimatedTime = eta;
          return flight;
        }
      }
    }

    // ── Strategy 2: callsign search in route bounding box ───────────────────
    const depLat = flight.dep.lat, depLon = flight.dep.lon;
    const arrLat = flight.arr.lat, arrLon = flight.arr.lon;
    if (!depLat || !arrLat) return flight;

    // Build callsign: IATA airline code → ICAO operator + numeric portion
    // e.g. "UA 1326" → "UAL1326 " (padded to 8 chars for ADS-B spec)
    const iataAirline = flight.flightNumber.replace(/\s?\d+$/, '').trim(); // "UA"
    const flightNum   = flight.flightNumber.replace(/[A-Z\s]/g, '');       // "1326"
    const icaoOp      = AIRLINE_ICAO[iataAirline] || iataAirline;
    const callsign    = (icaoOp + flightNum).substring(0, 8).toUpperCase();

    // Pad bounding box by 3° to account for flight being off the direct route
    const lamin = Math.min(depLat, arrLat) - 3;
    const lamax = Math.max(depLat, arrLat) + 3;
    const lomin = Math.min(depLon, arrLon) - 3;
    const lomax = Math.max(depLon, arrLon) + 3;

    const url = `${base}/states/all?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return flight;

    const data = await res.json();
    if (!data.states?.length) return flight;

    // Find the state vector whose callsign matches ours
    const match = data.states.find(s =>
      s[1] && s[1].trim().toUpperCase().startsWith(callsign.trimEnd())
    );

    if (match) {
      const pos = formatOpenSkyState(match);
      if (pos && !pos.is_ground) {
        console.log(`[OpenSky] callsign match "${match[1].trim()}" for ${flight.flightNumber}`);
        flight.live = pos;
        const gcProgress = gcPositionFraction(depLat, depLon, arrLat, arrLon, pos.latitude, pos.longitude);
        if (gcProgress != null) flight.progress = gcProgress;
        const eta = computeETA(pos.latitude, pos.longitude, arrLat, arrLon, pos.speed);
        if (eta) flight.arr.estimatedTime = eta;
      }
    } else {
      console.log(`[OpenSky] no callsign match for "${callsign}" in ${data.states.length} aircraft`);
    }
  } catch (e) {
    console.warn('[OpenSky] error:', e.message);
  }

  return flight;
}

// Compute ETA from current GPS position + ground speed (knots) to destination
function computeETA(curLat, curLon, arrLat, arrLon, speedKnots) {
  if (!speedKnots || speedKnots < 50) return null; // ignore stale/parked data
  const R = 3440.065; // Earth radius in nautical miles
  const φ1 = curLat * Math.PI/180, φ2 = arrLat * Math.PI/180;
  const Δφ = (arrLat - curLat) * Math.PI/180;
  const Δλ = (arrLon - curLon) * Math.PI/180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  const distNm = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const hoursRemaining = distNm / speedKnots;
  return new Date(Date.now() + hoursRemaining * 3600000).toISOString();
}

// Project a GPS point onto the great-circle arc dep→arr, return 0–1 progress fraction
function gcPositionFraction(depLat, depLon, arrLat, arrLon, pLat, pLon) {
  try {
    const R2D = 180 / Math.PI, D2R = Math.PI / 180;
    // Convert to unit vectors
    const toVec = (lat, lon) => {
      const φ = lat * D2R, λ = lon * D2R;
      return [Math.cos(φ)*Math.cos(λ), Math.cos(φ)*Math.sin(λ), Math.sin(φ)];
    };
    const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    const norm = v => { const m = Math.sqrt(dot(v,v)); return [v[0]/m, v[1]/m, v[2]/m]; };

    const A = toVec(depLat, depLon);
    const B = toVec(arrLat, arrLon);
    const P = toVec(pLat, pLon);

    const totalAngle = Math.acos(Math.min(1, Math.max(-1, dot(A, B))));
    if (totalAngle < 0.001) return null;

    const AP = Math.acos(Math.min(1, Math.max(-1, dot(A, P))));
    const fraction = AP / totalAngle;

    return Math.min(0.98, Math.max(0.02, fraction)); // clamp to sane range
  } catch (_) {
    return null;
  }
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

        let flight = await enrichAirportCoords(formatAviationstackFlight(best));

        // Enrich with real ADS-B position from OpenSky if AviationStack has no live data
        flight = await enrichWithOpenSky(flight);

        // If we have live GPS (from either source) and the plane is airborne:
        // • recompute progress from actual position (overrides stale time-based %)
        // • recompute ETA from remaining distance ÷ current speed
        if (flight.live && flight.live.is_ground === false && flight.dep.lat && flight.arr.lat) {
          const gcp = gcPositionFraction(flight.dep.lat, flight.dep.lon, flight.arr.lat, flight.arr.lon, flight.live.latitude, flight.live.longitude);
          if (gcp != null) flight.progress = gcp;
          const eta = computeETA(flight.live.latitude, flight.live.longitude, flight.arr.lat, flight.arr.lon, flight.live.speed);
          if (eta) flight.arr.estimatedTime = eta;
          console.log(`[live] progress=${Math.round(flight.progress*100)}% ETA=${new Date(flight.arr.estimatedTime).toLocaleTimeString()}`);
        }

        // Strip internal fields before sending to client
        delete flight._icao24;

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
