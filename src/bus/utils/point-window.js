'use strict';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

const CITY_ZONES = {
  delhi: 'Asia/Kolkata',
  mumbai: 'Asia/Kolkata',
  pune: 'Asia/Kolkata',
  goa: 'Asia/Kolkata',
  'new york': 'America/New_York',
  boston: 'America/New_York',
};

function zoneForCity(city, explicit) {
  if (explicit) return explicit;
  const key = String(city || '').trim().toLowerCase();
  return CITY_ZONES[key] || 'Asia/Kolkata';
}

/**
 * Wall-clock date + HH:MM in an IANA zone, as a UTC instant.
 */
function zonedDeparture(dateStr, timeStr, timeZone) {
  const date = String(dateStr || '').slice(0, 10);
  const time = String(timeStr || '').match(/^(\d{1,2}):(\d{2})/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time) return null;
  const [year, month, day] = date.split('-').map(Number);
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(guess);
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const zonedAsUtc = Date.UTC(
    Number(bag.year),
    Number(bag.month) - 1,
    Number(bag.day),
    Number(bag.hour),
    Number(bag.minute),
    Number(bag.second),
  );
  return new Date(guess.getTime() - (zonedAsUtc - guess.getTime()));
}

function canChangePoints(departureAt, now = new Date()) {
  const departure = departureAt instanceof Date ? departureAt : new Date(departureAt);
  if (Number.isNaN(departure.getTime())) return false;
  return departure.getTime() - now.getTime() >= TWO_HOURS_MS;
}

module.exports = {
  TWO_HOURS_MS,
  zoneForCity,
  zonedDeparture,
  canChangePoints,
};
