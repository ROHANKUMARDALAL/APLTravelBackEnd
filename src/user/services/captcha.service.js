'use strict';

const crypto = require('crypto');
const { AppError } = require('../../common/errors/app-error');

const TTL_MS = 5 * 60 * 1000;
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SPECIAL = '@#$%&*!?';
const challenges = new Map();

function hashAnswer(answer) {
  return crypto.createHash('sha256').update(String(answer).trim()).digest('hex');
}

function pick(chars) {
  return chars[crypto.randomInt(chars.length)];
}

function escapeXml(char) {
  return String(char)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sweepExpired() {
  const now = Date.now();
  for (const [id, row] of challenges) {
    if (row.expiresAt <= now) challenges.delete(id);
  }
}

function randomCode() {
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SPECIAL), pick(LOWER + UPPER + DIGITS + SPECIAL)];
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    const swap = chars[i];
    chars[i] = chars[j];
    chars[j] = swap;
  }
  return chars.join('');
}

function buildImage(code) {
  const letters = code
    .split('')
    .map((char, index) => {
      const x = 22 + index * 30;
      const y = 38 + crypto.randomInt(-4, 5);
      const rotate = crypto.randomInt(-22, 23);
      return `<text x="${x}" y="${y}" fill="#0b4f60" font-size="26" font-family="Georgia, serif" font-weight="700" transform="rotate(${rotate} ${x} ${y})">${escapeXml(char)}</text>`;
    })
    .join('');

  const lines = Array.from({ length: 4 }, () => {
    const x1 = crypto.randomInt(8, 40);
    const y1 = crypto.randomInt(8, 52);
    const x2 = crypto.randomInt(140, 188);
    const y2 = crypto.randomInt(8, 52);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#0e7490" stroke-opacity="0.35" stroke-width="1.4"/>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="190" height="58" viewBox="0 0 190 58" role="img"><rect width="190" height="58" rx="10" fill="#f4f8fb"/>${lines}${letters}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function createCaptcha() {
  sweepExpired();
  const code = randomCode();
  const captchaId = crypto.randomBytes(16).toString('hex');
  challenges.set(captchaId, {
    answerHash: hashAnswer(code),
    expiresAt: Date.now() + TTL_MS,
  });
  return { captchaId, image: buildImage(code) };
}

function verifyCaptcha(captchaId, captchaAnswer) {
  const id = typeof captchaId === 'string' ? captchaId.trim() : '';
  const answer = typeof captchaAnswer === 'string' ? captchaAnswer.trim() : '';
  if (!id || !answer) {
    throw AppError.validation('Enter the characters shown in the security image');
  }

  const row = challenges.get(id);
  challenges.delete(id);
  if (!row || row.expiresAt <= Date.now()) {
    throw AppError.validation('Security check expired. Request a new image.');
  }

  const given = Buffer.from(hashAnswer(answer));
  const expected = Buffer.from(row.answerHash);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw AppError.validation('Security check did not match. Try the new image.');
  }
}

module.exports = { createCaptcha, verifyCaptcha };
