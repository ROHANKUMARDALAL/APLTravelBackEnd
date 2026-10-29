'use strict';

const { AppError } = require('../../common/errors/app-error');

const CAB_LEAD_MS = 2 * 60 * 60 * 1000;
const CAB_TIME_ZONE = 'Asia/Kolkata';
const CAB_LEAD_MESSAGE = 'Please select a pickup time at least 2 hours from now.';

function isSupportedTimeZone(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function resolveCabTimeZone(source) {
  const zone = source && (source.timeZone || source.timezone);
  return isSupportedTimeZone(zone) ? zone : CAB_TIME_ZONE;
}

function zonedParts(date, timeZone = CAB_TIME_ZONE) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
    timeZone,
  };
}

function minimumPickup(now = new Date(), timeZone = CAB_TIME_ZONE) {
  return zonedParts(new Date(now.getTime() + CAB_LEAD_MS), timeZone);
}

function isPickupAllowed(dateTime, now = new Date(), timeZone = CAB_TIME_ZONE) {
  const stamp = String(dateTime || '').slice(0, 16);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(stamp)) return false;
  const earliest = minimumPickup(now, timeZone);
  return stamp >= `${earliest.date}T${earliest.time}`;
}

function assertPickupLeadTime(dateTime, source, now = new Date()) {
  const timeZone = resolveCabTimeZone(typeof source === 'string' ? { timeZone: source } : source);
  const earliest = minimumPickup(now, timeZone);
  if (!isPickupAllowed(dateTime, now, timeZone)) {
    throw AppError.validation(CAB_LEAD_MESSAGE, [
      `Earliest pickup is ${earliest.date} ${earliest.time} (${timeZone})`,
    ]);
  }
  return earliest;
}

module.exports = {
  CAB_LEAD_MS,
  CAB_TIME_ZONE,
  CAB_LEAD_MESSAGE,
  isSupportedTimeZone,
  resolveCabTimeZone,
  minimumPickup,
  isPickupAllowed,
  assertPickupLeadTime,
};
