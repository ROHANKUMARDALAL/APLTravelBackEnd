'use strict';

const { mongoose } = require('../../common/database/connection');
const { AppError } = require('../../common/errors/app-error');
const WebsiteSettings = require('../models/WebsiteSettings');
const Dsa = require('../../tenant/models/Dsa');

const THEME_REGISTRY = Object.freeze([
  {
    code: 'CLASSIC_TRAVEL',
    name: 'Classic Travel',
    version: 1,
    description: 'Harbor Holidays layout: tropical hero, floating search, sidebar flight results, and a two-column checkout.',
  },
  {
    code: 'MODERN_EXPLORER',
    name: 'Modern Explorer',
    version: 1,
    description: 'Contemporary OTA layout: split hero, horizontal search, timeline results, and a guided checkout.',
  },
  {
    code: 'LUXURY_ESCAPE',
    name: 'Luxury Escape',
    version: 1,
    description: 'Premium layout: cinematic hero, navy and champagne cards, and a booking-review checkout.',
  },
]);

const THEME_CODES = new Set(THEME_REGISTRY.map((theme) => theme.code));
const DEFAULT_THEME = 'CLASSIC_TRAVEL';

const ThemeFlagSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const ThemePermissionSchema = new mongoose.Schema(
  {
    dsaId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
    allowedThemes: { type: [String], default: [DEFAULT_THEME] },
    defaultTheme: { type: String, default: DEFAULT_THEME },
  },
  { timestamps: true },
);

const ThemeAuditSchema = new mongoose.Schema(
  {
    dsaId: { type: mongoose.Schema.Types.ObjectId, index: true },
    action: { type: String, required: true },
    fromCode: { type: String, default: '' },
    toCode: { type: String, default: '' },
    actorId: { type: String, default: '' },
  },
  { timestamps: true },
);

const ThemeFlag = mongoose.models.B2cThemeFlag || mongoose.model('B2cThemeFlag', ThemeFlagSchema);
const ThemePermission =
  mongoose.models.B2cThemePermission || mongoose.model('B2cThemePermission', ThemePermissionSchema);
const ThemeAudit = mongoose.models.B2cThemeAudit || mongoose.model('B2cThemeAudit', ThemeAuditSchema);

function normalizeCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return THEME_CODES.has(code) ? code : '';
}

function themeMeta(code) {
  return THEME_REGISTRY.find((theme) => theme.code === code) || THEME_REGISTRY[0];
}

function publicTheme(code) {
  const meta = themeMeta(code);
  return { code: meta.code, name: meta.name };
}

async function enabledCodes() {
  const rows = await ThemeFlag.find({ enabled: false }).select('code').lean();
  const disabled = new Set(rows.map((row) => row.code));
  return new Set(THEME_REGISTRY.map((theme) => theme.code).filter((code) => !disabled.has(code)));
}

async function allowedFor(dsaId, enabled) {
  const permission = await ThemePermission.findOne({ dsaId }).lean();
  const stored = permission?.allowedThemes?.length
    ? permission.allowedThemes.map(normalizeCode).filter(Boolean)
    : [DEFAULT_THEME];
  const allowed = stored.filter((code) => enabled.has(code));
  if (allowed.length) return { allowed, defaultTheme: normalizeCode(permission?.defaultTheme) };
  return { allowed: enabled.has(DEFAULT_THEME) ? [DEFAULT_THEME] : [...enabled], defaultTheme: '' };
}

function fallbackCode(allowed, preferred) {
  const preferredCode = normalizeCode(preferred);
  if (preferredCode && allowed.includes(preferredCode)) return preferredCode;
  if (allowed.includes(DEFAULT_THEME)) return DEFAULT_THEME;
  return allowed[0] || DEFAULT_THEME;
}

async function resolvePublicTheme(dsaId) {
  const enabled = await enabledCodes();
  const { allowed, defaultTheme } = await allowedFor(dsaId, enabled);
  const settings = await WebsiteSettings.findOne({ dsaId }).select('publishedThemeCode').lean();
  const published = normalizeCode(settings?.publishedThemeCode) || DEFAULT_THEME;
  const code = allowed.includes(published) ? published : fallbackCode(allowed, defaultTheme);
  return publicTheme(code);
}

async function listRegistry() {
  const enabled = await enabledCodes();
  return THEME_REGISTRY.map((theme) => ({
    code: theme.code,
    name: theme.name,
    version: theme.version,
    description: theme.description,
    enabled: enabled.has(theme.code),
  }));
}

async function setThemeEnabled(code, enabled, actorId) {
  const normalized = normalizeCode(code);
  if (!normalized) throw AppError.validation('Unknown theme');
  await ThemeFlag.findOneAndUpdate(
    { code: normalized },
    { code: normalized, enabled: Boolean(enabled) },
    { upsert: true, new: true },
  );
  if (!enabled) {
    const settings = await WebsiteSettings.find({ publishedThemeCode: normalized }).select('dsaId publishedThemeCode').lean();
    for (const row of settings) {
      await applyFallback(row.dsaId, actorId, 'THEME_DISABLED_FALLBACK');
    }
  }
  await ThemeAudit.create({
    action: enabled ? 'THEME_ENABLED' : 'THEME_DISABLED',
    toCode: normalized,
    actorId: actorId || '',
  });
  return listRegistry();
}

async function applyFallback(dsaId, actorId, action) {
  const enabled = await enabledCodes();
  const { allowed, defaultTheme } = await allowedFor(dsaId, enabled);
  const settings = await WebsiteSettings.findOne({ dsaId }).select('publishedThemeCode').lean();
  const current = normalizeCode(settings?.publishedThemeCode) || DEFAULT_THEME;
  const next = fallbackCode(allowed, defaultTheme);
  if (current === next && allowed.includes(current)) return { fromCode: current, toCode: next, changed: false };
  await WebsiteSettings.updateOne(
    { dsaId },
    { $set: { publishedThemeCode: next } },
    { upsert: true },
  );
  await ThemeAudit.create({
    dsaId,
    action,
    fromCode: current,
    toCode: next,
    actorId: actorId || '',
  });
  return { fromCode: current, toCode: next, changed: true };
}

async function saveAssignment(dsaId, input, actorId) {
  if (!mongoose.Types.ObjectId.isValid(dsaId)) throw AppError.validation('Invalid DSA');
  const dsa = await Dsa.findById(dsaId).select('dsaCode displayName companyName').lean();
  if (!dsa) throw AppError.notFound('DSA not found');
  const enabled = await enabledCodes();
  const requested = Array.isArray(input.allowedThemes) ? input.allowedThemes : [];
  const allowed = [...new Set(requested.map(normalizeCode).filter((code) => code && enabled.has(code)))];
  if (!allowed.length) throw AppError.validation('At least one enabled theme must remain allowed');
  const defaultTheme = fallbackCode(allowed, input.defaultTheme);
  await ThemePermission.findOneAndUpdate(
    { dsaId },
    { dsaId, allowedThemes: allowed, defaultTheme },
    { upsert: true, new: true },
  );
  const fallback = await applyFallback(dsaId, actorId, 'THEME_REVOKED_FALLBACK');
  await ThemeAudit.create({
    dsaId,
    action: 'THEME_ASSIGNMENT',
    toCode: allowed.join(','),
    actorId: actorId || '',
  });
  return {
    dsaId: String(dsaId),
    dsaCode: dsa.dsaCode,
    displayName: dsa.displayName || dsa.companyName || dsa.dsaCode,
    allowedThemes: allowed,
    defaultTheme,
    publishedTheme: (await resolvePublicTheme(dsaId)).code,
    fallback,
  };
}

async function listAssignments() {
  const dsas = await Dsa.find({}).select('dsaCode displayName companyName').sort({ dsaCode: 1 }).limit(200).lean();
  const rows = [];
  for (const dsa of dsas) {
    const enabled = await enabledCodes();
    const { allowed, defaultTheme } = await allowedFor(dsa._id, enabled);
    const published = await resolvePublicTheme(dsa._id);
    rows.push({
      dsaId: String(dsa._id),
      dsaCode: dsa.dsaCode,
      displayName: dsa.displayName || dsa.companyName || dsa.dsaCode,
      allowedThemes: allowed,
      defaultTheme: fallbackCode(allowed, defaultTheme),
      publishedTheme: published.code,
    });
  }
  return rows;
}

async function themesForDsa(dsaId) {
  const registry = await listRegistry();
  const enabled = await enabledCodes();
  const { allowed, defaultTheme } = await allowedFor(dsaId, enabled);
  const published = await resolvePublicTheme(dsaId);
  return {
    publishedTheme: published.code,
    defaultTheme: fallbackCode(allowed, defaultTheme),
    themes: registry
      .filter((theme) => allowed.includes(theme.code) && theme.enabled)
      .map((theme) => ({
        ...theme,
        published: theme.code === published.code,
      })),
  };
}

async function publishTheme(sessionDsaId, body, actorId) {
  if (body && body.dsaId && String(body.dsaId) !== String(sessionDsaId)) {
    throw AppError.forbidden('Cross-tenant theme changes are not allowed');
  }
  const code = normalizeCode(body?.code || body?.themeCode);
  if (!code) throw AppError.validation('Select a valid theme');
  const enabled = await enabledCodes();
  if (!enabled.has(code)) throw AppError.validation('That theme is disabled');
  const { allowed } = await allowedFor(sessionDsaId, enabled);
  if (!allowed.includes(code)) throw AppError.forbidden('This theme is not allowed for the website');
  const previous = await resolvePublicTheme(sessionDsaId);
  await WebsiteSettings.updateOne(
    { dsaId: sessionDsaId },
    { $set: { publishedThemeCode: code } },
    { upsert: true },
  );
  await ThemeAudit.create({
    dsaId: sessionDsaId,
    action: 'THEME_PUBLISH',
    fromCode: previous.code,
    toCode: code,
    actorId: actorId || '',
  });
  return publicTheme(code);
}

module.exports = {
  THEME_REGISTRY,
  DEFAULT_THEME,
  normalizeCode,
  publicTheme,
  resolvePublicTheme,
  listRegistry,
  setThemeEnabled,
  saveAssignment,
  listAssignments,
  themesForDsa,
  publishTheme,
  ThemeAudit,
};
