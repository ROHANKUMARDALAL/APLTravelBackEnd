'use strict';

const { AppError } = require('../../common/errors/app-error');

function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function validateSignupBody(body) {
  const details = [];
  const data = body || {};
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const phoneNumber = data.phoneNumber != null ? String(data.phoneNumber).trim() : '';
  const password = typeof data.password === 'string' ? data.password : '';
  const currency = typeof data.currency === 'string' ? data.currency.trim().toUpperCase() : '';
  let profilePhoto = null;

  if (name.length < 2) details.push('name is required (at least 2 characters)');
  if (!isEmail(email)) details.push('email must be a valid email');
  if (!/^\+?[0-9]{8,15}$/.test(phoneNumber)) {
    details.push('phoneNumber must be 8 to 15 digits, optional leading +');
  }
  if (password.length < 8) details.push('password must be at least 8 characters');
  if (!/^[A-Z]{3}$/.test(currency)) details.push('currency must be a 3-letter code, e.g. INR');

  if (data.profilePhoto != null && String(data.profilePhoto).trim()) {
    profilePhoto = String(data.profilePhoto).trim();
    if (!/^https?:\/\/\S+$/i.test(profilePhoto)) {
      details.push('profilePhoto must be an http(s) image URL');
    }
  }

  if (details.length) throw AppError.validation('Invalid signup request', details);

  return { name, email, phoneNumber, password, profilePhoto, currency };
}

function validateLoginBody(body) {
  const details = [];
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!isEmail(email)) details.push('email is required');
  if (!password) details.push('password is required');
  if (details.length) throw AppError.validation('Invalid login request', details);
  return { email, password };
}

module.exports = { validateSignupBody, validateLoginBody };
