'use strict';

/**
 * Lightweight content sanitizer for CMS text/HTML fragments.
 * Strips script/style tags and on* attributes. Not a full HTML sanitizer library.
 */
function sanitizeRichText(input) {
  let text = String(input || '');
  text = text.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  text = text.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  text = text.replace(/javascript\s*:/gi, '');
  return text.trim();
}

function assertHttpUrl(value, field) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('bad protocol');
    }
    return url.toString();
  } catch {
    const { AppError } = require('../../common/errors/app-error');
    throw AppError.validation(`Invalid URL for ${field}`);
  }
}

module.exports = { sanitizeRichText, assertHttpUrl };
