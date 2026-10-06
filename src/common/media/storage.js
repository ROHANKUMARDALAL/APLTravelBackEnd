'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AppError } = require('../errors/app-error');

/**
 * Media storage abstraction.
 * Development: local disk under uploads/
 * Production: swap implementation for object storage (S3/R2/etc.) without changing CMS services.
 */

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');

const PURPOSE_DIRS = {
  logo: 'logo',
  favicon: 'favicon',
  blog: 'blog',
  testimonial: 'testimonial',
  banner: 'banner',
  cms: 'cms',
};

function assertPurpose(purpose) {
  if (!PURPOSE_DIRS[purpose]) {
    throw AppError.validation('Invalid upload purpose', [{ purpose }]);
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function extensionForMime(mime) {
  switch (mime) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return '.ico';
    default:
      return '';
  }
}

function validateImageBuffer(file) {
  if (!file) throw AppError.validation('File is required');
  if (!ALLOWED_MIME.has(file.mimetype)) {
    throw AppError.validation('Only JPEG, PNG, WebP, GIF, or ICO images are allowed');
  }
  if (file.size > MAX_BYTES) {
    throw AppError.validation('File exceeds 2MB limit');
  }
}

/**
 * Persist an uploaded image for a DSA and return a public URL path.
 * @returns {{ url: string, relativePath: string, purpose: string }}
 */
async function storeDsaImage({ dsaId, purpose, file }) {
  assertPurpose(purpose);
  validateImageBuffer(file);

  const relativeDir = path.join('dsa', String(dsaId), PURPOSE_DIRS[purpose]);
  const absDir = path.join(UPLOAD_ROOT, relativeDir);
  ensureDir(absDir);

  const ext = extensionForMime(file.mimetype) || path.extname(file.originalname || '');
  const name = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`;
  const relativePath = path.join(relativeDir, name).replace(/\\/g, '/');
  const absPath = path.join(UPLOAD_ROOT, relativePath);

  await fs.promises.writeFile(absPath, file.buffer);

  return {
    url: `/media/${relativePath}`,
    relativePath,
    purpose,
  };
}

function resolveMediaAbsolutePath(relativeUrl) {
  const cleaned = String(relativeUrl || '')
    .replace(/^\/media\//, '')
    .replace(/\.\./g, '');
  const abs = path.join(UPLOAD_ROOT, cleaned);
  if (!abs.startsWith(UPLOAD_ROOT)) {
    throw AppError.forbidden('Invalid media path');
  }
  return abs;
}

module.exports = {
  UPLOAD_ROOT,
  ALLOWED_MIME,
  MAX_BYTES,
  storeDsaImage,
  validateImageBuffer,
  resolveMediaAbsolutePath,
};
