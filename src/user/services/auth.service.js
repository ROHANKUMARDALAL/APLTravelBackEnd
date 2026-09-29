'use strict';

const crypto = require('crypto');
const { AppError } = require('../../common/errors/app-error');
const User = require('../models/User');
const LoginSession = require('../models/LoginSession');

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const next = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== next.length) return false;
  return crypto.timingSafeEqual(expected, next);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function toPublicUser(user) {
  return {
    userId: String(user._id),
    name: user.name,
    email: user.email,
    phoneNumber: user.phoneNumber,
    profilePhoto: user.profilePhoto || null,
    currency: user.currency,
    balance: user.balance,
  };
}

async function issueLoginToken(userId) {
  const loginToken = `lgn_${crypto.randomBytes(24).toString('hex')}`;
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await LoginSession.create({
    userId,
    tokenHash: hashToken(loginToken),
    expiresAt,
  });
  return { loginToken, expiresAt: expiresAt.toISOString() };
}

async function signup(dto) {
  const existing = await User.findOne({ email: dto.email });
  if (existing) {
    throw AppError.validation('Email is already registered');
  }
  const user = await User.create({
    name: dto.name,
    email: dto.email,
    phoneNumber: dto.phoneNumber,
    passwordHash: hashPassword(dto.password),
    profilePhoto: dto.profilePhoto || null,
    currency: dto.currency,
    balance: 0,
  });
  const session = await issueLoginToken(user._id);
  return {
    ...session,
    user: toPublicUser(user),
  };
}

async function login(dto) {
  const user = await User.findOne({ email: dto.email });
  if (!user || !verifyPassword(dto.password, user.passwordHash)) {
    throw AppError.unauthorized('Invalid email or password');
  }
  const session = await issueLoginToken(user._id);
  return {
    ...session,
    user: toPublicUser(user),
  };
}

async function userFromLoginToken(token) {
  if (!token) throw AppError.unauthorized('Login token is required');
  const session = await LoginSession.findOne({ tokenHash: hashToken(token) });
  if (!session || session.expiresAt < new Date()) {
    throw AppError.unauthorized('Login token is invalid or expired');
  }
  const user = await User.findById(session.userId);
  if (!user) throw AppError.unauthorized('Login token is invalid or expired');
  return user;
}

module.exports = {
  signup,
  login,
  userFromLoginToken,
  toPublicUser,
};
