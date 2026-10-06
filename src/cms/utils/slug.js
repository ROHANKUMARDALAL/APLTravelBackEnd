'use strict';

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function assertSlug(slug) {
  const next = slugify(slug);
  if (!next || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(next)) {
    const { AppError } = require('../../common/errors/app-error');
    throw AppError.validation('Invalid slug format');
  }
  return next;
}

module.exports = { slugify, assertSlug };
