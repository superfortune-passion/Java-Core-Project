import { loadConfig } from './config.mjs';

export function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function shuffle(array, rng) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function buildYearDays(year) {
  const days = [];
  for (let ts = Date.UTC(year, 0, 1); ts < Date.UTC(year + 1, 0, 1); ts += 86400000) {
    const date = new Date(ts);
    const dayOfWeek = date.getUTCDay();
    days.push({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth(),
      day: date.getUTCDate(),
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      isFirst: date.getUTCDate() === 1,
      active: true,
      count: 0,
    });
  }
  return days;
}

function dayMax(day, config) {
  return day.isFirst ? config.maxFirstOfMonth : config.maxPerDay;
}

function markInactiveDays(days, targetActive, rng) {
  for (const day of days) {
    day.active = true;
    day.count = 0;
  }

  const targetInactive = Math.max(0, days.length - targetActive);
  const candidates = [...days];
  shuffle(candidates, rng);

  let inactive = 0;
  for (const day of candidates) {
    if (inactive >= targetInactive) break;
    const chance = day.isWeekend ? 0.72 : 0.48;
    if (rng() < chance) {
      day.active = false;
      inactive++;
    }
  }

  for (let month = 0; month < 12; month++) {
    const monthDays = days.filter((day) => day.month === month);
    const minActive = Math.max(16, Math.floor(monthDays.length * 0.62));
    const inactiveInMonth = monthDays.filter((day) => !day.active);
    shuffle(inactiveInMonth, rng);
    for (const day of inactiveInMonth) {
      if (monthDays.filter((d) => d.active).length >= minActive) break;
      day.active = true;
    }
  }
}

function buildCountBag(numCommits, numDays, rng, config) {
  const fractions = config.dailyCountWeights ?? [
    { count: 1, weight: 0.18 },
    { count: 2, weight: 0.41 },
    { count: 3, weight: 0.18 },
    { count: 4, weight: 0.11 },
    { count: 5, weight: 0.07 },
    { count: 6, weight: 0.05 },
  ];

  const counts = [];
  for (const entry of fractions) {
    const daysForBucket = Math.max(0, Math.round(numDays * entry.weight));
    for (let i = 0; i < daysForBucket; i++) {
      counts.push(Math.min(entry.count, config.maxPerDay));
    }
  }

  while (counts.length < numDays) counts.push(2);
  while (counts.length > numDays) counts.pop();

  let total = counts.reduce((sum, value) => sum + value, 0);
  let guard = 0;
  while (total !== numCommits && guard < numCommits * 20) {
    guard++;
    if (total > numCommits) {
      const heavy = counts
        .map((value, index) => ({ value, index }))
        .filter((entry) => entry.value > 1);
      if (!heavy.length) break;
      shuffle(heavy, rng);
      counts[heavy[0].index]--;
      total--;
      continue;
    }

    const light = counts
      .map((value, index) => ({ value, index }))
      .filter((entry) => entry.value < config.maxPerDay);
    if (!light.length) break;
    shuffle(light, rng);
    counts[light[0].index]++;
    total++;
  }

  if (total !== numCommits) {
    throw new Error(`Could not distribute ${numCommits} commits across ${numDays} days`);
  }

  shuffle(counts, rng);
  return counts;
}

function assignDailyCounts(days, numCommits, rng, config) {
  const targetActive = Math.min(
    Math.max(Math.floor(numCommits / 2.05), 225),
    330,
  );

  markInactiveDays(days, targetActive, rng);

  for (let attempt = 0; attempt < 8; attempt++) {
    const activeDays = days.filter((day) => day.active);
    const bag = buildCountBag(numCommits, activeDays.length, rng, config);

    for (let i = 0; i < activeDays.length; i++) {
      activeDays[i].count = Math.min(bag[i], dayMax(activeDays[i], config));
    }

    let total = activeDays.reduce((sum, day) => sum + day.count, 0);
    if (total === numCommits) return;

    if (total < numCommits) {
      for (const day of days.filter((entry) => !entry.active)) {
        if (total >= numCommits) break;
        day.active = true;
        day.count = 1;
        total++;
      }
      continue;
    }

    for (const day of activeDays.filter((entry) => entry.count > 1)) {
      if (total <= numCommits) break;
      day.count--;
      total--;
    }
  }

  throw new Error(`Unable to assign ${numCommits} commits naturally`);
}

function buildTimestampsForDay(day, rng) {
  const times = [];
  const dayEnd = Date.UTC(day.year, day.month, day.day, 23, 59, 59);

  for (let i = 0; i < day.count; i++) {
    let ts;
    if (i === 0) {
      const hour = 9 + Math.floor(rng() * 12);
      const minute = Math.floor(rng() * 60);
      const second = Math.floor(rng() * 60);
      ts = Date.UTC(day.year, day.month, day.day, hour, minute, second);
    } else {
      const gapMinutes = 35 + Math.floor(rng() * 130);
      ts = Math.min(times[i - 1].getTime() + gapMinutes * 60 * 1000, dayEnd);
    }
    times.push(new Date(ts));
  }

  return times;
}

export function buildSchedule(numCommits, config) {
  const rng = createRng(config.randomSeed);
  const days = buildYearDays(config.year);

  assignDailyCounts(days, numCommits, rng, config);

  const activeDays = days.filter((day) => day.active && day.count > 0);
  const total = activeDays.reduce((sum, day) => sum + day.count, 0);
  if (total !== numCommits) {
    throw new Error(`Schedule mismatch: expected ${numCommits}, got ${total}`);
  }

  const schedule = [];
  for (const day of days) {
    if (!day.active || day.count === 0) continue;
    for (const time of buildTimestampsForDay(day, rng)) {
      schedule.push({
        iso: time.toISOString(),
        dateKey: time.toISOString().slice(0, 10),
      });
    }
  }

  schedule.sort((a, b) => a.iso.localeCompare(b.iso));
  return schedule.map((entry, index) => ({
    index,
    iso: entry.iso,
    dateKey: entry.dateKey,
    isFirstOfMonth: entry.dateKey.endsWith('-01'),
  }));
}

export function summarizeSchedule(schedule) {
  const perDay = new Map();
  for (const entry of schedule) {
    perDay.set(entry.dateKey, (perDay.get(entry.dateKey) || 0) + 1);
  }
  const counts = [...perDay.values()];
  const maxDay = Math.max(...counts, 0);
  const distribution = {};
  for (const count of counts) {
    distribution[count] = (distribution[count] || 0) + 1;
  }

  return {
    total: schedule.length,
    activeDays: perDay.size,
    inactiveDays: 365 - perDay.size,
    maxDay,
    distribution,
  };
}
