'use strict';

/**
 * Hostname normalization for public tenant resolution.
 * Safe for custom domains, subdomains, and local development hosts with ports.
 */

function stripProtocolAndPath(value) {
  let raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  raw = raw.replace(/^https?:\/\//, '');
  raw = raw.split('/')[0];
  raw = raw.split('?')[0];
  raw = raw.replace(/\.$/, '');
  return raw;
}

function isLocalHost(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  );
}

/**
 * Normalize a stored or inbound host/domain.
 * - lowercase
 * - strip protocol/path
 * - strip www.
 * - keep port only for local development hosts
 */
function normalizeHost(value) {
  let host = stripProtocolAndPath(value);
  if (!host) return '';

  let hostname = host;
  let port = '';
  if (host.startsWith('[')) {
    // IPv6 literal — rare; keep as-is without port split gymnastics.
    hostname = host;
  } else if (host.includes(':')) {
    const parts = host.split(':');
    if (parts.length === 2 && /^\d+$/.test(parts[1])) {
      hostname = parts[0];
      port = parts[1];
    }
  }

  if (hostname.startsWith('www.')) {
    hostname = hostname.slice(4);
  }

  if (port && isLocalHost(hostname)) {
    return `${hostname}:${port}`;
  }
  return hostname;
}

/**
 * Parse PUBLIC_DEV_HOST_MAP env:
 * "localhost:3001=APL-DSA-0001,127.0.0.1:3001=APL-DSA-0001"
 */
function parseDevHostMap(raw) {
  const map = new Map();
  String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx <= 0) return;
      const host = normalizeHost(pair.slice(0, idx));
      const code = String(pair.slice(idx + 1) || '')
        .trim()
        .toUpperCase();
      if (host && code) map.set(host, code);
    });
  return map;
}

module.exports = {
  normalizeHost,
  parseDevHostMap,
  isLocalHost,
};
