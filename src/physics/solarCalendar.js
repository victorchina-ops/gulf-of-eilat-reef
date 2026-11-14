/**
 * Authentic Gulf of Eilat (29.55° N) coupled spherical solar geometry.
 * Synchronizes solar elevation angle, solar time of day, and calendar day of year
 * without circular update loops or impossible sun-below-horizon states.
 */

export const EILAT_LATITUDE_DEG = 29.55;
export const AXIAL_TILT_DEG = 23.44;
export const MIN_SOLAR_ELEV_DEG = 2.0;
export const MAX_SOLAR_ELEV_DEG = 90 - (EILAT_LATITUDE_DEG - AXIAL_TILT_DEG); // 83.89°
export const DEFAULT_DAY_OF_YEAR = 87; // Mar 28 (~61.94° at 12:30)

const MIN_TIME_OF_DAY = 5.15;
const MAX_TIME_OF_DAY = 18.85;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const LAT_RAD = EILAT_LATITUDE_DEG * DEG_TO_RAD;
const SIN_LAT = Math.sin(LAT_RAD);
const COS_LAT = Math.cos(LAT_RAD);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeTimeOfDay(timeOfDay, fallback = 12.5) {
  const num =
    typeof timeOfDay === 'number'
      ? timeOfDay
      : typeof timeOfDay === 'string' && timeOfDay.trim() !== ''
        ? Number(timeOfDay)
        : NaN;
  const val = Number.isFinite(num) ? num : fallback;
  return clamp(val, MIN_TIME_OF_DAY, MAX_TIME_OF_DAY);
}

function sanitizeElevationInput(elevDeg, fallback) {
  const num =
    typeof elevDeg === 'number'
      ? elevDeg
      : typeof elevDeg === 'string' && elevDeg.trim() !== ''
        ? Number(elevDeg)
        : NaN;
  return Number.isFinite(num) ? num : fallback;
}

function hasFiniteSolarField(obj, key) {
  if (!obj || !Object.prototype.hasOwnProperty.call(obj, key)) return false;
  const raw = obj[key];
  const num =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : NaN;
  return Number.isFinite(num);
}

/**
 * Clamp and round a finite day-of-year value into integer 1..365.
 */
export function normalizeDayOfYear(dayOfYear) {
  const num =
    typeof dayOfYear === 'number'
      ? dayOfYear
      : typeof dayOfYear === 'string' && dayOfYear.trim() !== ''
        ? Number(dayOfYear)
        : NaN;
  if (!Number.isFinite(num)) return DEFAULT_DAY_OF_YEAR;
  return Math.max(1, Math.min(365, Math.round(num)));
}

/**
 * Earth solar declination (degrees) for calendar day 1..365.
 */
export function solarDeclinationDeg(dayOfYear = DEFAULT_DAY_OF_YEAR) {
  const d = normalizeDayOfYear(dayOfYear);
  return AXIAL_TILT_DEG * Math.sin((2 * Math.PI * (d - 81)) / 365);
}

/**
 * Solar noon peak elevation (degrees) in the Gulf of Eilat for a given day of year.
 */
export function computeNoonElevationDeg(dayOfYear = DEFAULT_DAY_OF_YEAR) {
  return 90 - Math.abs(EILAT_LATITUDE_DEG - solarDeclinationDeg(dayOfYear));
}

/**
 * Raw spherical solar elevation (degrees) from solar hour angle and declination.
 */
export function computeRawSolarElevationDeg(timeOfDay, dayOfYear = DEFAULT_DAY_OF_YEAR) {
  const t = Number.isFinite(timeOfDay) ? timeOfDay : 12.5;
  const deltaRad = solarDeclinationDeg(dayOfYear) * DEG_TO_RAD;
  const hourAngle = (Math.PI / 12) * (t - 12.0);
  const sinAlpha =
    SIN_LAT * Math.sin(deltaRad) +
    COS_LAT * Math.cos(deltaRad) * Math.cos(hourAngle);
  return Math.asin(clamp(sinAlpha, -1, 1)) * RAD_TO_DEG;
}

/**
 * Compute sunrise/sunset hours above minElevDeg and daily noon peak elevation.
 */
export function computeDaylightWindow(dayOfYear = DEFAULT_DAY_OF_YEAR, minElevDeg = MIN_SOLAR_ELEV_DEG) {
  const d = normalizeDayOfYear(dayOfYear);
  const minElev = Number.isFinite(minElevDeg) ? minElevDeg : MIN_SOLAR_ELEV_DEG;
  const deltaRad = solarDeclinationDeg(d) * DEG_TO_RAD;
  const sinMin = Math.sin(minElev * DEG_TO_RAD);
  const sinDecl = Math.sin(deltaRad);
  const cosDecl = Math.cos(deltaRad);
  const denom = COS_LAT * cosDecl;
  const cosHmax = denom > 1e-9
    ? clamp((sinMin - SIN_LAT * sinDecl) / denom, -1, 1)
    : 1;
  const dt = (12 / Math.PI) * Math.acos(cosHmax);
  return {
    sunrise: 12 - dt,
    sunset: 12 + dt,
    maxElevDeg: computeNoonElevationDeg(d),
  };
}

/**
 * Shortest cyclic distance between two calendar days in a 365-day year.
 */
export function circularDayDistance(d1, d2) {
  const a = normalizeDayOfYear(d1);
  const b = normalizeDayOfYear(d2);
  const diff = Math.abs(a - b);
  return Math.min(diff, 365 - diff);
}

/**
 * Solve coupled solar state from a target time of day, keeping the current calendar day
 * when the sun is >= MIN_SOLAR_ELEV_DEG or shifting to the nearest valid season day.
 */
export function solveFromTimeOfDay(targetTime, currentDayOfYear = DEFAULT_DAY_OF_YEAR) {
  const t = sanitizeTimeOfDay(targetTime, 12.5);
  const d0 = normalizeDayOfYear(currentDayOfYear);
  const rawElev = computeRawSolarElevationDeg(t, d0);

  if (rawElev >= MIN_SOLAR_ELEV_DEG) {
    return {
      timeOfDay: t,
      dayOfYear: d0,
      sunElevation: rawElev,
      halfDay: t < 12 ? 'am' : 'pm',
    };
  }

  let dBest = null;
  let bestScore = Infinity;
  for (let d = 1; d <= 365; d++) {
    const elev = computeRawSolarElevationDeg(t, d);
    if (elev < MIN_SOLAR_ELEV_DEG) continue;
    const score = circularDayDistance(d, d0) + d * 1e-6;
    if (score < bestScore) {
      bestScore = score;
      dBest = d;
    }
  }

  if (dBest !== null) {
    return {
      timeOfDay: t,
      dayOfYear: dBest,
      sunElevation: computeRawSolarElevationDeg(t, dBest),
      halfDay: t < 12 ? 'am' : 'pm',
    };
  }

  const solsticeWin = computeDaylightWindow(172, MIN_SOLAR_ELEV_DEG);
  const tClamped = clamp(t, solsticeWin.sunrise, solsticeWin.sunset);
  return {
    timeOfDay: tClamped,
    dayOfYear: 172,
    sunElevation: MIN_SOLAR_ELEV_DEG,
    halfDay: tClamped < 12 ? 'am' : 'pm',
  };
}

/**
 * Solve coupled solar state from a target day of year, clamping time of day into
 * that day's valid daylight window (>= MIN_SOLAR_ELEV_DEG).
 */
export function solveFromDayOfYear(targetDayOfYear, currentTimeOfDay = 12.5) {
  const d = normalizeDayOfYear(targetDayOfYear);
  const t0 = sanitizeTimeOfDay(currentTimeOfDay, 12.5);
  const { sunrise, sunset } = computeDaylightWindow(d, MIN_SOLAR_ELEV_DEG);
  const t = clamp(t0, sunrise, sunset);
  const elev = Math.max(MIN_SOLAR_ELEV_DEG, computeRawSolarElevationDeg(t, d));
  return {
    timeOfDay: t,
    dayOfYear: d,
    sunElevation: elev,
    halfDay: t < 12 ? 'am' : 'pm',
  };
}

/**
 * Solve inverse spherical solar geometry from a target sun elevation angle,
 * preferring minimal movement in time-of-day and calendar day while preserving AM/PM side.
 */
export function solveFromSunElevation(
  targetElevDeg,
  currentTimeOfDay = 12.5,
  currentDayOfYear = DEFAULT_DAY_OF_YEAR,
  preferredHalfDay = null
) {
  const maxPeak = computeNoonElevationDeg(172);
  const t0 = sanitizeTimeOfDay(currentTimeOfDay, 12.5);
  const d0 = normalizeDayOfYear(currentDayOfYear);
  const defaultElev = computeRawSolarElevationDeg(t0, d0);
  const elev = clamp(sanitizeElevationInput(targetElevDeg, defaultElev), MIN_SOLAR_ELEV_DEG, maxPeak);
  const halfPref = Math.abs(t0 - 12.0) > 0.02
    ? (t0 < 12.0 ? 'am' : 'pm')
    : (preferredHalfDay === 'am' || preferredHalfDay === 'pm' ? preferredHalfDay : 'pm');

  const sinElev = Math.sin(elev * DEG_TO_RAD);
  let tBest = null;
  let dBest = null;
  let bestCost = Infinity;

  for (let d = 1; d <= 365; d++) {
    if (computeNoonElevationDeg(d) < elev - 1e-7) continue;

    const deltaRad = solarDeclinationDeg(d) * DEG_TO_RAD;
    const sinDecl = Math.sin(deltaRad);
    const cosDecl = Math.cos(deltaRad);
    const denom = COS_LAT * cosDecl;
    const cosH = denom > 1e-9
      ? clamp((sinElev - SIN_LAT * sinDecl) / denom, -1, 1)
      : 1;
    const dt = (12 / Math.PI) * Math.acos(cosH);
    const dayPenalty = Math.pow(circularDayDistance(d, d0) / 12.0, 2) + d * 1e-7;

    const candidates = [
      { tCand: 12.0 - dt, candHalf: 'am' },
      { tCand: 12.0 + dt, candHalf: 'pm' },
    ];

    for (let i = 0; i < candidates.length; i++) {
      const { tCand, candHalf } = candidates[i];
      const timePenalty = Math.pow((tCand - t0) / 1.2, 2);
      const halfPenalty = candHalf !== halfPref ? 0.02 : 0;
      const cost = timePenalty + dayPenalty + halfPenalty;
      if (cost < bestCost) {
        bestCost = cost;
        tBest = tCand;
        dBest = d;
      }
    }
  }

  if (tBest === null || dBest === null) {
    return {
      timeOfDay: 12.0,
      dayOfYear: 172,
      sunElevation: maxPeak,
      halfDay: halfPref,
    };
  }

  return {
    timeOfDay: tBest,
    dayOfYear: dBest,
    sunElevation: computeRawSolarElevationDeg(tBest, dBest),
    halfDay: tBest < 12 ? 'am' : (tBest > 12 ? 'pm' : halfPref),
  };
}

/**
 * Reconcile any partial or complete solar patch against prevState without loops.
 */
export function reconcileSolarState(prevState = {}, patch = {}, preferredHalfDay = null) {
  const maxPeak = computeNoonElevationDeg(172);
  const prevTime = sanitizeTimeOfDay(prevState?.timeOfDay, 12.5);
  const prevDay = normalizeDayOfYear(prevState?.dayOfYear);
  const fallbackElev = clamp(
    sanitizeElevationInput(prevState?.sunElevation, computeRawSolarElevationDeg(prevTime, prevDay)),
    MIN_SOLAR_ELEV_DEG,
    maxPeak
  );

  const hasElev = hasFiniteSolarField(patch, 'sunElevation');
  const hasTime = hasFiniteSolarField(patch, 'timeOfDay');
  const hasDay = hasFiniteSolarField(patch, 'dayOfYear');

  if (hasElev && hasTime && hasDay) {
    const dayOfYear = normalizeDayOfYear(patch.dayOfYear);
    const timeOfDay = sanitizeTimeOfDay(patch.timeOfDay, prevTime);
    const sunElevation = clamp(
      sanitizeElevationInput(patch.sunElevation, computeRawSolarElevationDeg(timeOfDay, dayOfYear)),
      MIN_SOLAR_ELEV_DEG,
      maxPeak
    );
    const fallbackHalf = preferredHalfDay === 'am' || preferredHalfDay === 'pm' ? preferredHalfDay : 'pm';
    return {
      sunElevation,
      timeOfDay,
      dayOfYear,
      halfDay: timeOfDay < 12 ? 'am' : (timeOfDay > 12 ? 'pm' : fallbackHalf),
    };
  }

  if (hasElev) {
    const refTime = hasTime ? sanitizeTimeOfDay(patch.timeOfDay, prevTime) : prevTime;
    const refDay = hasDay ? normalizeDayOfYear(patch.dayOfYear) : prevDay;
    return solveFromSunElevation(patch.sunElevation, refTime, refDay, preferredHalfDay);
  }

  if (hasTime && !hasDay) {
    return solveFromTimeOfDay(patch.timeOfDay, prevDay);
  }

  if (hasDay && !hasTime) {
    return solveFromDayOfYear(patch.dayOfYear, prevTime);
  }

  if (hasTime && hasDay) {
    return solveFromDayOfYear(patch.dayOfYear, patch.timeOfDay);
  }

  const fallbackHalf = preferredHalfDay === 'am' || preferredHalfDay === 'pm' ? preferredHalfDay : 'pm';
  return {
    sunElevation: fallbackElev,
    timeOfDay: prevTime,
    dayOfYear: prevDay,
    halfDay: prevTime < 12 ? 'am' : (prevTime > 12 ? 'pm' : fallbackHalf),
  };
}

/**
 * Format integer day of year (1..365) as "Mon D", e.g. "Mar 28".
 */
export function formatDayOfYear(dayOfYear) {
  let remaining = normalizeDayOfYear(dayOfYear);
  for (let m = 0; m < MONTH_LENGTHS.length; m++) {
    const len = MONTH_LENGTHS[m];
    if (remaining <= len) {
      return `${MONTH_NAMES[m]} ${remaining}`;
    }
    remaining -= len;
  }
  return 'Dec 31';
}

/**
 * Seasonal / astronomical label for calendar day 1..365.
 */
export function getSeasonLabel(dayOfYear) {
  const d = normalizeDayOfYear(dayOfYear);
  if (d >= 79 && d <= 81) return 'Vernal Equinox';
  if (d >= 171 && d <= 173) return 'Summer Solstice';
  if (d >= 264 && d <= 266) return 'Autumnal Equinox';
  if (d >= 354 && d <= 356) return 'Winter Solstice';
  if (d <= 78 || d >= 357) return 'Winter';
  if (d >= 82 && d <= 170) return 'Spring';
  if (d >= 174 && d <= 263) return 'Summer';
  return 'Autumn';
}
