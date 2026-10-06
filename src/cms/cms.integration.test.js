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
const { createDsa } = require('../tenant/services/dsa.service');
const { createDsaAdminUser } = require('../dsa-admin/services/dsa-auth.service');
const { Permission } = require('../admin-auth/permissions');
const WebsiteSettings = require('./models/WebsiteSettings');
const Blog = require('./models/Blog');
const Testimonial = require('./models/Testimonial');
const FooterLink = require('./models/FooterLink');
const CmsPage = require('./models/CmsPage');
const Dsa = require('../tenant/models/Dsa');
const DsaAdminUser = require('../dsa-admin/models/DsaAdminUser');
const DsaAdminSession = require('../dsa-admin/models/DsaAdminSession');
const { validateImageBuffer, storeDsaImage } = require('../common/media/storage');
const { AppError } = require('../common/errors/app-error');

const hasUri = Boolean(process.env.MONGODB_URI);
const describeDb = hasUri ? describe : describe.skip;

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function httpJson(port, method, path, { body, token } = {}) {
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
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

describeDb('Phase 7 CMS tenant isolation & RBAC', () => {
  let server;
  let port;
  let dsaA;
  let dsaB;
  let ownerAToken;
  let ownerBToken;
  let supportToken;
  let contentToken;
  const password = 'Phase7Pass123!';
  const emails = [];
  const dsaIds = [];

  before(async () => {
    await connectDatabase();
    await seedAdminRoles();
    await seedMasterServices();
    const app = createApp({ includeAdminNamespaces: true });
    ({ server, port } = await listen(app));

    dsaA = await createDsa({
      companyName: 'Phase7 DSA A',
      displayName: 'DSA A CMS',
      ownerName: 'Owner A',
      email: `p7.a.${Date.now()}@example.com`,
      phone: '+919700000001',
      status: 'ACTIVE',
    });
    dsaB = await createDsa({
      companyName: 'Phase7 DSA B',
      displayName: 'DSA B CMS',
      ownerName: 'Owner B',
      email: `p7.b.${Date.now()}@example.com`,
      phone: '+919700000002',
      status: 'ACTIVE',
    });
    dsaIds.push(dsaA.id, dsaB.id);

    const ownerAEmail = `p7.owner.a.${Date.now()}@example.com`;
    const ownerBEmail = `p7.owner.b.${Date.now()}@example.com`;
    const supportEmail = `p7.support.${Date.now()}@example.com`;
    const contentEmail = `p7.content.${Date.now()}@example.com`;
    emails.push(ownerAEmail, ownerBEmail, supportEmail, contentEmail);

    await createDsaAdminUser({
      dsaId: dsaA.id,
      name: 'Owner A',
      email: ownerAEmail,
      password,
      roleCode: 'DSA_OWNER',
    });
    await createDsaAdminUser({
      dsaId: dsaB.id,
      name: 'Owner B',
      email: ownerBEmail,
      password,
      roleCode: 'DSA_OWNER',
    });
    await createDsaAdminUser({
      dsaId: dsaA.id,
      name: 'Support A',
      email: supportEmail,
      password,
      roleCode: 'SUPPORT',
    });
    await createDsaAdminUser({
      dsaId: dsaA.id,
      name: 'Content A',
      email: contentEmail,
      password,
      roleCode: 'CONTENT_MANAGER',
    });

    const loginA = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: { email: ownerAEmail, password },
    });
    const loginB = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: { email: ownerBEmail, password },
    });
    const loginS = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: { email: supportEmail, password },
    });
    const loginC = await httpJson(port, 'POST', '/api/dsa-admin/auth/login', {
      body: { email: contentEmail, password },
    });
    assert.equal(loginA.status, 200);
    assert.equal(loginB.status, 200);
    assert.equal(loginS.status, 200);
    assert.equal(loginC.status, 200);
    ownerAToken = loginA.json.data.token;
    ownerBToken = loginB.json.data.token;
    supportToken = loginS.json.data.token;
    contentToken = loginC.json.data.token;
  });

  after(async () => {
    await Blog.deleteMany({ dsaId: { $in: dsaIds } });
    await Testimonial.deleteMany({ dsaId: { $in: dsaIds } });
    await FooterLink.deleteMany({ dsaId: { $in: dsaIds } });
    await CmsPage.deleteMany({ dsaId: { $in: dsaIds } });
    await WebsiteSettings.deleteMany({ dsaId: { $in: dsaIds } });
    await DsaAdminSession.deleteMany({ dsaId: { $in: dsaIds } });
    await DsaAdminUser.deleteMany({ email: { $in: emails } });
    await Dsa.deleteMany({ _id: { $in: dsaIds } });
    if (server) await new Promise((r) => server.close(r));
    await disconnectDatabase();
  });

  it('enforces one WebsiteSettings document per DSA', async () => {
    const a1 = await httpJson(port, 'GET', '/api/dsa-admin/website-settings', {
      token: ownerAToken,
    });
    const a2 = await httpJson(port, 'GET', '/api/dsa-admin/website-settings', {
      token: ownerAToken,
    });
    assert.equal(a1.status, 200);
    assert.equal(a2.status, 200);
    assert.equal(a1.json.data.settings.id, a2.json.data.settings.id);
    const count = await WebsiteSettings.countDocuments({ dsaId: dsaA.id });
    assert.equal(count, 1);
  });

  it('DSA A cannot read DSA B website settings', async () => {
    await httpJson(port, 'PATCH', '/api/dsa-admin/website-settings', {
      token: ownerBToken,
      body: { websiteName: 'Only B Brand' },
    });
    const a = await httpJson(port, 'GET', '/api/dsa-admin/website-settings', {
      token: ownerAToken,
    });
    assert.equal(a.status, 200);
    assert.notEqual(a.json.data.settings.websiteName, 'Only B Brand');
  });

  it('blog slug uniqueness is tenant-scoped and draft/publish persists', async () => {
    const createA = await httpJson(port, 'POST', '/api/dsa-admin/blogs', {
      token: ownerAToken,
      body: {
        title: 'Shared Slug Post',
        slug: 'shared-slug',
        content: 'Hello',
        status: 'DRAFT',
      },
    });
    assert.equal(createA.status, 200);
    assert.equal(createA.json.data.blog.status, 'DRAFT');

    const createB = await httpJson(port, 'POST', '/api/dsa-admin/blogs', {
      token: ownerBToken,
      body: {
        title: 'Shared Slug Post B',
        slug: 'shared-slug',
        content: 'Hello B',
        status: 'DRAFT',
      },
    });
    assert.equal(createB.status, 200);

    const dupA = await httpJson(port, 'POST', '/api/dsa-admin/blogs', {
      token: ownerAToken,
      body: {
        title: 'Dup',
        slug: 'shared-slug',
        content: 'x',
        status: 'DRAFT',
      },
    });
    assert.equal(dupA.status, 400);

    const published = await httpJson(
      port,
      'PATCH',
      `/api/dsa-admin/blogs/${createA.json.data.blog.id}`,
      {
        token: ownerAToken,
        body: { status: 'PUBLISHED' },
      },
    );
    assert.equal(published.status, 200);
    assert.equal(published.json.data.blog.status, 'PUBLISHED');
    assert.ok(published.json.data.blog.publishDate);
  });

  it('DSA A cannot edit DSA B blog', async () => {
    const createB = await httpJson(port, 'POST', '/api/dsa-admin/blogs', {
      token: ownerBToken,
      body: {
        title: 'B Private',
        slug: `b-private-${Date.now()}`,
        content: 'secret',
        status: 'DRAFT',
      },
    });
    const attack = await httpJson(
      port,
      'PATCH',
      `/api/dsa-admin/blogs/${createB.json.data.blog.id}`,
      {
        token: ownerAToken,
        body: { title: 'Hacked' },
      },
    );
    assert.equal(attack.status, 404);
  });

  it('testimonial / footer / cms page CRUD is tenant-isolated', async () => {
    const t = await httpJson(port, 'POST', '/api/dsa-admin/testimonials', {
      token: ownerAToken,
      body: {
        customerName: 'Ada',
        message: 'Great service',
        rating: 5,
        status: 'ACTIVE',
      },
    });
    assert.equal(t.status, 200);

    const f = await httpJson(port, 'POST', '/api/dsa-admin/footer-links', {
      token: ownerAToken,
      body: {
        title: 'About',
        url: '/about',
        group: 'Company',
        displayOrder: 1,
      },
    });
    assert.equal(f.status, 200);

    const p = await httpJson(port, 'POST', '/api/dsa-admin/cms-pages', {
      token: ownerAToken,
      body: {
        title: 'Privacy Policy',
        slug: `privacy-${Date.now()}`,
        pageType: 'PRIVACY',
        content: 'Policy text',
        status: 'DRAFT',
      },
    });
    assert.equal(p.status, 200);

    const tAttack = await httpJson(
      port,
      'PATCH',
      `/api/dsa-admin/testimonials/${t.json.data.item.id}`,
      { token: ownerBToken, body: { status: 'INACTIVE' } },
    );
    const fAttack = await httpJson(
      port,
      'PATCH',
      `/api/dsa-admin/footer-links/${f.json.data.item.id}`,
      { token: ownerBToken, body: { title: 'Stolen' } },
    );
    const pAttack = await httpJson(
      port,
      'PATCH',
      `/api/dsa-admin/cms-pages/${p.json.data.item.id}`,
      { token: ownerBToken, body: { title: 'Stolen' } },
    );
    assert.equal(tAttack.status, 404);
    assert.equal(fAttack.status, 404);
    assert.equal(pAttack.status, 404);
  });

  it('rejects invalid content/status and media types', async () => {
    const badBlog = await httpJson(port, 'POST', '/api/dsa-admin/blogs', {
      token: ownerAToken,
      body: { title: 'x', status: 'WEIRD' },
    });
    assert.equal(badBlog.status, 400);

    const badRating = await httpJson(port, 'POST', '/api/dsa-admin/testimonials', {
      token: ownerAToken,
      body: { customerName: 'Bob', message: 'hi', rating: 9 },
    });
    assert.equal(badRating.status, 400);

    assert.throws(
      () =>
        validateImageBuffer({
          mimetype: 'application/x-msdownload',
          size: 100,
        }),
      (err) => err instanceof AppError,
    );
  });

  it('RBAC: Support denied CMS mutations; Content Manager has intended CMS permissions', async () => {
    const denied = await httpJson(port, 'PATCH', '/api/dsa-admin/website-settings', {
      token: supportToken,
      body: { websiteName: 'Nope' },
    });
    assert.equal(denied.status, 403);

    const blogDenied = await httpJson(port, 'POST', '/api/dsa-admin/blogs', {
      token: supportToken,
      body: { title: 'Nope', slug: 'nope', content: 'x' },
    });
    assert.equal(blogDenied.status, 403);

    const me = await httpJson(port, 'GET', '/api/dsa-admin/auth/me', {
      token: contentToken,
    });
    assert.equal(me.status, 200);
    const perms = new Set(me.json.data.user.permissions || []);
    assert.equal(perms.has(Permission.BLOG_CREATE), true);
    assert.equal(perms.has(Permission.CMS_MANAGE), true);
    assert.equal(perms.has(Permission.BRANDING_MANAGE), true);
    assert.equal(perms.has(Permission.FOOTER_MANAGE), true);
    assert.equal(perms.has(Permission.USER_MANAGE), false);
    assert.equal(perms.has(Permission.BOOKING_CANCEL), false);

    const ok = await httpJson(port, 'PATCH', '/api/dsa-admin/website-settings', {
      token: contentToken,
      body: { websiteName: 'Content Brand', tagline: 'Managed' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.settings.websiteName, 'Content Brand');
  });

  it('existing service-control APIs still work', async () => {
    const services = await httpJson(port, 'GET', '/api/dsa-admin/services', {
      token: ownerAToken,
    });
    assert.equal(services.status, 200);
    assert.ok(Array.isArray(services.json.data.services));
  });

  it('stores media via abstraction for valid images', async () => {
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const stored = await storeDsaImage({
      dsaId: dsaA.id,
      purpose: 'logo',
      file: {
        buffer: png1x1,
        mimetype: 'image/png',
        size: png1x1.length,
        originalname: 'logo.png',
      },
    });
    assert.ok(stored.url.startsWith('/media/dsa/'));
  });
});
