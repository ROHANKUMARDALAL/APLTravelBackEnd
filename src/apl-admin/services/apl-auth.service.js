'use strict';

const { AppError } = require('../../common/errors/app-error');
const { hashPassword, verifyPassword } = require('../../common/security/password');
const {
  hashToken,
  issueOpaqueToken,
} = require('../../common/security/opaque-token');
const { ROLE_SCOPE } = require('../../admin-auth/permissions');
const AdminRole = require('../../admin-auth/models/AdminRole');
const AplAdminUser = require('../models/AplAdminUser');
const AplAdminSession = require('../models/AplAdminSession');

const TOKEN_PREFIX = 'apl_';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function toPublicAplAdmin(user, role) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    status: user.status,
    roleCode: role?.code || null,
    roleName: role?.name || null,
    permissions: Array.isArray(role?.permissions) ? [...role.permissions] : [],
    lastLoginAt: user.lastLoginAt || null,
  };
}

async function loadActiveAplRole(roleId) {
  const role = await AdminRole.findById(roleId).lean();
  if (!role || role.status !== 'ACTIVE' || role.scope !== ROLE_SCOPE.APL) {
    throw AppError.unauthorized('Admin role is invalid');
  }
  return role;
}

async function issueAplSession(userId) {
  const token = issueOpaqueToken(TOKEN_PREFIX);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await AplAdminSession.create({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    lastUsedAt: new Date(),
  });
  return { token, expiresAt: expiresAt.toISOString() };
}

async function loginAplAdmin({ email, password }) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  if (!normalized || !password) {
    throw AppError.validation('Email and password are required');
  }

  const user = await AplAdminUser.findOne({ email: normalized }).select(
    '+passwordHash',
  );
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw AppError.unauthorized('Invalid email or password');
  }
  if (user.status !== 'ACTIVE') {
    throw AppError.unauthorized('Admin account is disabled');
  }

  const role = await loadActiveAplRole(user.roleId);
  user.lastLoginAt = new Date();
  await user.save();

  const session = await issueAplSession(user._id);
  return {
    ...session,
    user: toPublicAplAdmin(user, role),
  };
}

async function resolveAplAdminFromToken(token) {
  if (!token || !String(token).startsWith(TOKEN_PREFIX)) {
    throw AppError.unauthorized('Invalid APL admin token');
  }

  const session = await AplAdminSession.findOne({
    tokenHash: hashToken(token),
  });
  if (!session) {
    throw AppError.unauthorized('Session is invalid or expired');
  }
  if (session.revokedAt) {
    throw AppError.unauthorized('Session has been revoked');
  }
  if (session.expiresAt < new Date()) {
    throw AppError.unauthorized('Session is invalid or expired');
  }

  const user = await AplAdminUser.findById(session.userId);
  if (!user || user.status !== 'ACTIVE') {
    throw AppError.unauthorized('Admin account is disabled');
  }

  const role = await loadActiveAplRole(user.roleId);
  session.lastUsedAt = new Date();
  await session.save();

  return { user, role, session };
}

async function logoutAplAdmin(token) {
  if (!token) return { revoked: false };
  const session = await AplAdminSession.findOne({
    tokenHash: hashToken(token),
  });
  if (!session || session.revokedAt) return { revoked: false };
  session.revokedAt = new Date();
  await session.save();
  return { revoked: true };
}

async function createAplAdminUser({
  name,
  email,
  phone = '',
  password,
  roleCode = 'SUPER_ADMIN',
}) {
  const role = await AdminRole.findOne({
    scope: ROLE_SCOPE.APL,
    code: String(roleCode).toUpperCase(),
    status: 'ACTIVE',
  });
  if (!role) throw AppError.validation(`APL role not found: ${roleCode}`);

  const normalized = String(email).trim().toLowerCase();
  const existing = await AplAdminUser.findOne({ email: normalized });
  if (existing) {
    throw AppError.validation('APL admin email already exists');
  }

  const user = await AplAdminUser.create({
    name: String(name).trim(),
    email: normalized,
    phone: String(phone || '').trim(),
    passwordHash: hashPassword(password),
    status: 'ACTIVE',
    roleId: role._id,
  });

  return toPublicAplAdmin(user, role);
}

async function findAplAdminByEmail(email) {
  return AplAdminUser.findOne({
    email: String(email).trim().toLowerCase(),
  });
}

module.exports = {
  TOKEN_PREFIX,
  TOKEN_TTL_MS,
  loginAplAdmin,
  resolveAplAdminFromToken,
  logoutAplAdmin,
  createAplAdminUser,
  findAplAdminByEmail,
  toPublicAplAdmin,
  hashToken,
};
