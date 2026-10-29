'use strict';

const { AppError } = require('../../common/errors/app-error');
const WebsiteSettings = require('../models/WebsiteSettings');
const { ThemeAudit, resolvePublicTheme } = require('./b2c-theme.service');

const HEX = /^#[0-9A-F]{6}$/;
const KEYS = ['color1', 'color2', 'color3', 'color4', 'color5'];

const ROLES = Object.freeze({
  color1: 'Primary brand color',
  color2: 'Secondary brand color',
  color3: 'Accent / highlight color',
  color4: 'Soft background / surface color',
  color5: 'Primary button / action color',
});

const DEFAULTS = Object.freeze({
  CLASSIC_TRAVEL: { color1: '#0E7490', color2: '#0B4F60', color3: '#1490AD', color4: '#E7F7FB', color5: '#0E7490' },
  MODERN_EXPLORER: { color1: '#1D4ED8', color2: '#0B1B4A', color3: '#60A5FA', color4: '#F5F7FB', color5: '#1D4ED8' },
  LUXURY_ESCAPE: { color1: '#0B1F3A', color2: '#16345F', color3: '#C6A15B', color4: '#F6F1E8', color5: '#C6A15B' },
});

function normalizeHex(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  const hex = raw.startsWith('#') ? raw : `#${raw}`;
  return HEX.test(hex) ? hex : '';
}

function luminance(hex) {
  const value = parseInt(hex.slice(1), 16);
  const channel = (part) => {
    const scaled = part / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const red = channel((value >> 16) & 255);
  const green = channel((value >> 8) & 255);
  const blue = channel(value & 255);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function onColor(hex) {
  return luminance(hex) > 0.45 ? '#0C1B24' : '#FFFFFF';
}

function contrastRatio(background, foreground) {
  const lighter = Math.max(luminance(background), luminance(foreground));
  const darker = Math.min(luminance(background), luminance(foreground));
  return (lighter + 0.05) / (darker + 0.05);
}

function defaultsFor(themeCode) {
  return { ...(DEFAULTS[themeCode] || DEFAULTS.CLASSIC_TRAVEL) };
}

function present(colors, customized) {
  const warnings = [];
  if (contrastRatio(colors.color5, onColor(colors.color5)) < 4.5) {
    warnings.push('Color 5 may be hard to read on its action button.');
  }
  if (contrastRatio(colors.color1, onColor(colors.color1)) < 4.5) {
    warnings.push('Color 1 may be hard to read as a brand background.');
  }
  if (contrastRatio(colors.color4, colors.color1) < 3) {
    warnings.push('Color 1 and Color 4 are very close. Text on the soft surface may be faint.');
  }
  return {
    ...colors,
    on1: onColor(colors.color1),
    on5: onColor(colors.color5),
    customized: Boolean(customized),
    warnings,
    roles: ROLES,
  };
}

function mixStored(themeCode, stored) {
  const defaults = defaultsFor(themeCode);
  const colors = {};
  let customized = false;
  for (const key of KEYS) {
    const saved = normalizeHex(stored?.[key]);
    if (saved) customized = true;
    colors[key] = saved || defaults[key];
  }
  return present(colors, customized);
}

async function resolveThemeColors(dsaId) {
  const theme = await resolvePublicTheme(dsaId);
  const settings = await WebsiteSettings.findOne({ dsaId }).select('themeColors').lean();
  return { theme, colors: mixStored(theme.code, settings?.themeColors) };
}

function readSubmitted(body) {
  if (body?.dsaId) {
    throw AppError.forbidden('Cross-tenant color changes are not allowed');
  }
  const colors = {};
  for (const key of KEYS) {
    const hex = normalizeHex(body?.[key]);
    if (!hex) throw AppError.validation(`${key} must be a 6-digit HEX color`);
    colors[key] = hex;
  }
  return colors;
}

async function saveThemeColors(sessionDsaId, body, actorId) {
  const colors = readSubmitted(body || {});
  await WebsiteSettings.updateOne(
    { dsaId: sessionDsaId },
    { $set: Object.fromEntries(KEYS.map((key) => [`themeColors.${key}`, colors[key]])) },
    { upsert: true },
  );
  await ThemeAudit.create({
    dsaId: sessionDsaId,
    action: 'THEME_COLORS_SAVED',
    toCode: KEYS.map((key) => colors[key]).join(','),
    actorId: actorId || '',
  });
  return resolveThemeColors(sessionDsaId);
}

async function restoreThemeColors(sessionDsaId, body, actorId) {
  if (body?.dsaId) throw AppError.forbidden('Cross-tenant color changes are not allowed');
  await WebsiteSettings.updateOne(
    { dsaId: sessionDsaId },
    { $unset: Object.fromEntries(KEYS.map((key) => [`themeColors.${key}`, ''])) },
  );
  await ThemeAudit.create({
    dsaId: sessionDsaId,
    action: 'THEME_COLORS_RESTORED',
    actorId: actorId || '',
  });
  return resolveThemeColors(sessionDsaId);
}

module.exports = {
  KEYS,
  ROLES,
  DEFAULTS,
  normalizeHex,
  onColor,
  defaultsFor,
  resolveThemeColors,
  saveThemeColors,
  restoreThemeColors,
};
