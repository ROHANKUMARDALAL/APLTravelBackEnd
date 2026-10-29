'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase26';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connectDatabase, disconnectDatabase, mongoose } = require('../common/database/connection');
const Dsa = require('../tenant/models/Dsa');
const WebsiteSettings = require('./models/WebsiteSettings');
const themes = require('./services/b2c-theme.service');

const URI = 'mongodb://127.0.0.1:27018/apl_test_phase26';

function assertIsolated() {
  if (process.env.APL_TEST_MONGODB_URI !== URI || mongoose.connection.name !== 'apl_test_phase26') {
    throw new Error('Refusing to run outside apl_test_phase26');
  }
}

async function makeDsa(code, name) {
  return Dsa.create({
    dsaCode: code,
    companyName: name,
    displayName: name,
    ownerName: 'Owner',
    email: `${code.toLowerCase()}@example.test`,
    phone: '9000000000',
    status: 'ACTIVE',
  });
}

describe('Phase 26 B2C themes', { concurrency: 1 }, () => {
  before(async () => {
    await connectDatabase();
    assertIsolated();
    await mongoose.connection.dropDatabase();
  });

  after(async () => {
    assertIsolated();
    await mongoose.connection.dropDatabase();
    await disconnectDatabase();
  });

  it('keeps an existing DSA on Classic Travel until a theme is published', async () => {
    const dsa = await makeDsa('APL-DSA-2601', 'Classic Agency');
    const theme = await themes.resolvePublicTheme(dsa._id);
    assert.deepEqual(theme, { code: 'CLASSIC_TRAVEL', name: 'Classic Travel' });
    const settings = await WebsiteSettings.findOne({ dsaId: dsa._id }).lean();
    assert.equal(settings, null);
  });

  it('rejects a theme APL has not allowed and ignores a client dsaId', async () => {
    const owner = await makeDsa('APL-DSA-2602', 'Owner Agency');
    const other = await makeDsa('APL-DSA-2603', 'Other Agency');
    await assert.rejects(
      () => themes.publishTheme(owner._id, { code: 'MODERN_EXPLORER', dsaId: String(other._id) }, 'staff'),
      /Cross-tenant theme changes are not allowed/,
    );
    await themes.saveAssignment(owner._id, {
      allowedThemes: ['CLASSIC_TRAVEL', 'MODERN_EXPLORER'],
      defaultTheme: 'CLASSIC_TRAVEL',
    }, 'apl');
    await assert.rejects(
      () => themes.publishTheme(owner._id, { code: 'LUXURY_ESCAPE' }, 'staff'),
      /not allowed/,
    );
    const published = await themes.publishTheme(owner._id, { code: 'MODERN_EXPLORER' }, 'staff');
    assert.equal(published.code, 'MODERN_EXPLORER');
    const visible = await themes.themesForDsa(owner._id);
    assert.deepEqual(visible.themes.map((theme) => theme.code).sort(), ['CLASSIC_TRAVEL', 'MODERN_EXPLORER']);
  });

  it('falls back and audits when the published theme is revoked', async () => {
    const dsa = await makeDsa('APL-DSA-2604', 'Fallback Agency');
    await themes.saveAssignment(dsa._id, {
      allowedThemes: ['CLASSIC_TRAVEL', 'LUXURY_ESCAPE'],
      defaultTheme: 'CLASSIC_TRAVEL',
    }, 'apl');
    await themes.publishTheme(dsa._id, { code: 'LUXURY_ESCAPE' }, 'staff');
    const saved = await themes.saveAssignment(dsa._id, {
      allowedThemes: ['CLASSIC_TRAVEL'],
      defaultTheme: 'CLASSIC_TRAVEL',
    }, 'apl');
    assert.equal(saved.publishedTheme, 'CLASSIC_TRAVEL');
    assert.equal(saved.fallback.changed, true);
    const audit = await themes.ThemeAudit.findOne({ dsaId: dsa._id, action: 'THEME_REVOKED_FALLBACK' }).lean();
    assert.equal(audit.fromCode, 'LUXURY_ESCAPE');
    assert.equal(audit.toCode, 'CLASSIC_TRAVEL');
    const afterDisable = await themes.setThemeEnabled('CLASSIC_TRAVEL', false, 'apl');
    assert.equal(afterDisable.find((theme) => theme.code === 'CLASSIC_TRAVEL').enabled, false);
    await themes.setThemeEnabled('CLASSIC_TRAVEL', true, 'apl');
  });
});
