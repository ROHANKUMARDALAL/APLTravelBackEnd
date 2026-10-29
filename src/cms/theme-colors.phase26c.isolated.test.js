'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase26c';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connectDatabase, disconnectDatabase, mongoose } = require('../common/database/connection');
const Dsa = require('../tenant/models/Dsa');
const WebsiteSettings = require('./models/WebsiteSettings');
const colors = require('./services/theme-colors');

const URI = 'mongodb://127.0.0.1:27018/apl_test_phase26c';

function assertIsolated() {
  if (process.env.APL_TEST_MONGODB_URI !== URI || mongoose.connection.name !== 'apl_test_phase26c') {
    throw new Error('Refusing to run outside apl_test_phase26c');
  }
}

async function makeDsa(code) {
  return Dsa.create({
    dsaCode: code,
    companyName: code,
    displayName: code,
    ownerName: 'Owner',
    email: `${code.toLowerCase()}@example.test`,
    phone: '9000000000',
    status: 'ACTIVE',
  });
}

describe('Phase 26C theme colors', { concurrency: 1 }, () => {
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

  it('uses theme defaults until colors are saved', async () => {
    const dsa = await makeDsa('APL-DSA-2611');
    const resolved = await colors.resolveThemeColors(dsa._id);
    assert.equal(resolved.colors.color1, '#0E7490');
    assert.equal(resolved.colors.customized, false);
    assert.equal(await WebsiteSettings.countDocuments({ dsaId: dsa._id }), 0);
  });

  it('rejects invalid HEX and a client dsaId, then stores another DSA separately', async () => {
    const first = await makeDsa('APL-DSA-2612');
    const second = await makeDsa('APL-DSA-2613');
    await assert.rejects(() => colors.saveThemeColors(first._id, { color1: 'blue' }, 'staff'), /color1/);
    await assert.rejects(
      () => colors.saveThemeColors(first._id, { dsaId: String(second._id), color1: '#112233' }, 'staff'),
      /Cross-tenant/,
    );
    await colors.saveThemeColors(first._id, {
      color1: '#112233', color2: '#223344', color3: '#334455', color4: '#AABBCC', color5: '#F58220',
    }, 'staff');
    await colors.saveThemeColors(second._id, {
      color1: '#ABCDEF', color2: '#123456', color3: '#654321', color4: '#F0F0F0', color5: '#010101',
    }, 'staff');
    const savedFirst = await colors.resolveThemeColors(first._id);
    const savedSecond = await colors.resolveThemeColors(second._id);
    assert.equal(savedFirst.colors.color5, '#F58220');
    assert.equal(savedFirst.colors.on5, '#FFFFFF');
    assert.equal(savedSecond.colors.color1, '#ABCDEF');
    assert.notEqual(savedFirst.colors.color1, savedSecond.colors.color1);
    const restored = await colors.restoreThemeColors(first._id, {}, 'staff');
    assert.equal(restored.colors.color1, '#0E7490');
    assert.equal(restored.colors.customized, false);
  });
});
