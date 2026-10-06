'use strict';

require('dotenv').config();
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  connectDatabase,
  disconnectDatabase,
} = require('../common/database/connection');
const { createApp } = require('../app');
const { seedAdminRoles } = require('../admin-auth/services/seed-roles');
const { seedMasterServices } = require('../tenant/services/seed-master-services');
const { createDsa, setDsaStatus, updateDsa } = require('../tenant/services/dsa.service');
const {
  upsertDsaServiceMapping,
} = require('../tenant/services/dsa-service-mapping.service');
const Service = require('../tenant/models/Service');
const Dsa = require('../tenant/models/Dsa');
const Blog = require('../cms/models/Blog');
const Testimonial = require('../cms/models/Testimonial');
const FooterLink = require('../cms/models/FooterLink');
const CmsPage = require('../cms/models/CmsPage');
const Banner = require('../cms/models/Banner');
const WebsiteSettings = require('../cms/models/WebsiteSettings');
const { normalizeHost, parseDevHostMap } = require('./utils/host');
const { config } = require('../common/config');

const hasUri = Boolean(process.env.MONGODB_URI);
const describeDb = hasUri ? describe : describe.skip;

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function httpJson(port, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('public host helpers', () => {
  it('normalizes domains and keeps local ports', () => {
    assert.equal(normalizeHost('https://WWW.Example.com/path'), 'example.com');
    assert.equal(normalizeHost('localhost:3001'), 'localhost:3001');
    assert.equal(normalizeHost('Example.com:443'), 'example.com');
  });

  it('parses dev host map', () => {
    const map = parseDevHostMap('localhost:3001=APL-DSA-0001, bad');
    assert.equal(map.get('localhost:3001'), 'APL-DSA-0001');
  });

  it('production config clears dev host map when NODE_ENV=production shape', () => {
    // Loaded config for this process: in production map must be empty.
    if (config.isProduction) {
      assert.equal(config.publicDevHostMap.size, 0);
    }
  });
});

describeDb('Phase 8 public site tenant resolution', () => {
  let server;
  let port;
  let dsaA;
  let dsaB;
  let flight;
  let hotel;
  let bus;
  const dsaIds = [];

  before(async () => {
    await connectDatabase();
    await seedAdminRoles();
    await seedMasterServices();
    const app = createApp();
    ({ server, port } = await listen(app));

    const stamp = Date.now();
    dsaA = await createDsa({
      companyName: 'Phase8 DSA A',
      displayName: 'Public A',
      ownerName: 'Owner A',
      email: `p8.a.${stamp}@example.com`,
      phone: '+919800000001',
      domain: `a-${stamp}.example.test`,
      subdomain: `a${stamp}`,
      status: 'ACTIVE',
    });
    dsaB = await createDsa({
      companyName: 'Phase8 DSA B',
      displayName: 'Public B',
      ownerName: 'Owner B',
      email: `p8.b.${stamp}@example.com`,
      phone: '+919800000002',
      domain: `b-${stamp}.example.test`,
      subdomain: `b${stamp}`,
      status: 'ACTIVE',
    });
    dsaIds.push(dsaA.id || dsaA._id, dsaB.id || dsaB._id);

    flight = await Service.findOne({ code: 'flight' }).lean();
    hotel = await Service.findOne({ code: 'hotel' }).lean();
    bus = await Service.findOne({ code: 'bus' }).lean();
    assert.ok(flight && hotel && bus);

    const dsaAId = dsaA._id || dsaA.id;
    await upsertDsaServiceMapping({
      dsaId: dsaAId,
      serviceId: flight._id,
      isAllowedByAPL: true,
      isActiveByDSA: true,
    });
    await upsertDsaServiceMapping({
      dsaId: dsaAId,
      serviceId: hotel._id,
      isAllowedByAPL: true,
      isActiveByDSA: false,
    });
    await upsertDsaServiceMapping({
      dsaId: dsaAId,
      serviceId: bus._id,
      isAllowedByAPL: false,
      isActiveByDSA: true,
    });

    await WebsiteSettings.findOneAndUpdate(
      { dsaId: dsaA._id || dsaA.id },
      {
        $set: {
          websiteName: 'A Travel',
          tagline: 'Only A',
          contact: { email: 'a@example.com', phone: '+91', address: 'City A' },
        },
      },
      { upsert: true },
    );

    await Blog.create({
      dsaId: dsaA._id || dsaA.id,
      title: 'Published A',
      slug: `pub-a-${stamp}`,
      content: 'Hello',
      status: 'PUBLISHED',
      publishDate: new Date(),
    });
    await Blog.create({
      dsaId: dsaA._id || dsaA.id,
      title: 'Draft A',
      slug: `draft-a-${stamp}`,
      content: 'Secret',
      status: 'DRAFT',
    });
    await Blog.create({
      dsaId: dsaB._id || dsaB.id,
      title: 'Published B',
      slug: `pub-b-${stamp}`,
      content: 'B only',
      status: 'PUBLISHED',
      publishDate: new Date(),
    });

    await Testimonial.create({
      dsaId: dsaA._id || dsaA.id,
      customerName: 'Active User',
      message: 'Great',
      rating: 5,
      status: 'ACTIVE',
      displayOrder: 1,
    });
    await Testimonial.create({
      dsaId: dsaA._id || dsaA.id,
      customerName: 'Hidden User',
      message: 'Nope',
      rating: 4,
      status: 'INACTIVE',
      displayOrder: 2,
    });

    await FooterLink.create({
      dsaId: dsaA._id || dsaA.id,
      title: 'About',
      url: '/pages/about',
      group: 'Company',
      status: 'ACTIVE',
      displayOrder: 1,
    });
    await FooterLink.create({
      dsaId: dsaA._id || dsaA.id,
      title: 'Hidden',
      url: '/hidden',
      group: 'Company',
      status: 'INACTIVE',
      displayOrder: 2,
    });

    await CmsPage.create({
      dsaId: dsaA._id || dsaA.id,
      title: 'Privacy',
      slug: `privacy-${stamp}`,
      pageType: 'PRIVACY',
      content: 'Privacy body',
      status: 'PUBLISHED',
    });
    await CmsPage.create({
      dsaId: dsaA._id || dsaA.id,
      title: 'Draft Terms',
      slug: `terms-draft-${stamp}`,
      pageType: 'TERMS',
      content: 'Draft',
      status: 'DRAFT',
    });

    await Banner.create({
      dsaId: dsaA._id || dsaA.id,
      title: 'Hero',
      imageUrl: '/media/dsa/demo/banner/hero.png',
      placement: 'HOME_HERO',
      status: 'ACTIVE',
      displayOrder: 1,
    });
    await Banner.create({
      dsaId: dsaA._id || dsaA.id,
      title: 'Inactive Banner',
      imageUrl: '/media/dsa/demo/banner/x.png',
      placement: 'HOME_HERO',
      status: 'INACTIVE',
      displayOrder: 2,
    });
  });

  after(async () => {
    await Blog.deleteMany({ dsaId: { $in: dsaIds } });
    await Testimonial.deleteMany({ dsaId: { $in: dsaIds } });
    await FooterLink.deleteMany({ dsaId: { $in: dsaIds } });
    await CmsPage.deleteMany({ dsaId: { $in: dsaIds } });
    await Banner.deleteMany({ dsaId: { $in: dsaIds } });
    await WebsiteSettings.deleteMany({ dsaId: { $in: dsaIds } });
    await Dsa.deleteMany({ _id: { $in: dsaIds } });
    if (server) await new Promise((r) => server.close(r));
    await disconnectDatabase();
  });

  it('domain resolves correct DSA', async () => {
    const res = await httpJson(port, 'GET', '/api/v1/public/site/config', {
      headers: { Host: dsaA.domain },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.tenant.code, dsaA.dsaCode);
    assert.equal(res.json.data.branding.websiteName, 'A Travel');
  });

  it('unknown domain rejected safely', async () => {
    const res = await httpJson(port, 'GET', '/api/v1/public/site/config', {
      headers: { Host: `missing-${Date.now()}.example.test` },
    });
    assert.equal(res.status, 404);
  });

  it('suspended DSA unavailable', async () => {
    await setDsaStatus(dsaA._id || dsaA.id, 'SUSPENDED');
    const res = await httpJson(port, 'GET', '/api/v1/public/site/config', {
      headers: { Host: dsaA.domain },
    });
    assert.equal(res.status, 403);
    await setDsaStatus(dsaA._id || dsaA.id, 'ACTIVE');
  });

  it('DSA A cannot receive DSA B content', async () => {
    const res = await httpJson(port, 'GET', '/api/v1/public/blogs', {
      headers: { Host: dsaA.domain },
    });
    assert.equal(res.status, 200);
    const slugs = res.json.data.items.map((b) => b.slug);
    assert.equal(slugs.some((s) => s.startsWith('pub-b-')), false);
    assert.equal(slugs.some((s) => s.startsWith('pub-a-')), true);
  });

  it('only effective services returned; revoked/disabled/global rules apply', async () => {
    const res = await httpJson(port, 'GET', '/api/v1/public/site/config', {
      headers: { Host: dsaA.domain },
    });
    assert.equal(res.status, 200);
    const codes = res.json.data.services.map((s) => s.code);
    assert.deepEqual(codes, ['flight']);
    assert.equal(codes.includes('hotel'), false); // DSA deactivated
    assert.equal(codes.includes('bus'), false); // APL revoked
  });

  it('only published blogs and active footer/testimonials/banners returned', async () => {
    const res = await httpJson(port, 'GET', '/api/v1/public/site/config', {
      headers: { Host: dsaA.domain },
    });
    assert.equal(res.status, 200);
    assert.equal(
      res.json.data.blogs.every((b) => !String(b.slug).startsWith('draft-')),
      true,
    );
    assert.equal(
      res.json.data.testimonials.every((t) => t.customerName !== 'Hidden User'),
      true,
    );
    assert.equal(
      res.json.data.footer.every((f) => f.title !== 'Hidden'),
      true,
    );
    assert.equal(
      res.json.data.banners.every((b) => b.title !== 'Inactive Banner'),
      true,
    );
    assert.ok(
      String(res.json.data.banners[0]?.imageUrl || '').startsWith('/media/'),
    );
  });

  it('draft CMS page is not public', async () => {
    const published = await httpJson(
      port,
      'GET',
      `/api/v1/public/pages/${(await CmsPage.findOne({ dsaId: dsaA._id || dsaA.id, status: 'PUBLISHED' })).slug}`,
      { headers: { Host: dsaA.domain } },
    );
    assert.equal(published.status, 200);

    const draft = await httpJson(
      port,
      'GET',
      `/api/v1/public/pages/${(await CmsPage.findOne({ dsaId: dsaA._id || dsaA.id, status: 'DRAFT' })).slug}`,
      { headers: { Host: dsaA.domain } },
    );
    assert.equal(draft.status, 404);
  });

  it('no private admin fields leaked', async () => {
    const res = await httpJson(port, 'GET', '/api/v1/public/site/config', {
      headers: { Host: dsaA.domain },
    });
    const raw = JSON.stringify(res.json.data);
    assert.equal(raw.includes('password'), false);
    assert.equal(raw.includes('permissions'), false);
    assert.equal(raw.includes('dsaId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(res.json.data.tenant, 'id'), false);
  });

  it('client-supplied dsaId cannot retarget public tenant', async () => {
    const res = await httpJson(
      port,
      'GET',
      `/api/v1/public/site/config?dsaId=${dsaB._id || dsaB.id}`,
      { headers: { Host: dsaA.domain } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.tenant.code, dsaA.dsaCode);
  });

  it('domain uniqueness conflict is rejected', async () => {
    await assert.rejects(
      () =>
        updateDsa(dsaB._id || dsaB.id, {
          domain: dsaA.domain,
        }),
      (err) => err && err.code === 'VALIDATION_ERROR',
    );
  });
});
