'use strict';

const crypto = require('crypto');
const { AppError } = require('../../common/errors/app-error');
const { hashPassword, verifyPassword } = require('../../common/security/password');
const {
  hashToken,
  issueOpaqueToken,
} = require('../../common/security/opaque-token');
const { ROLE_SCOPE } = require('../../admin-auth/permissions');
const AdminRole = require('../../admin-auth/models/AdminRole');
const Dsa = require('../../tenant/models/Dsa');
const DsaAdminUser = require('../models/DsaAdminUser');
const DsaAdminSession = require('../models/DsaAdminSession');

const TOKEN_PREFIX = 'dsa_';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** One-time credential material for APLAdmin provisioning (never persisted). */
function generateTemporaryAdminPassword() {
  return `Tmp-${crypto.randomBytes(12).toString('base64url')}!Aa1`;
}

function toPublicDsaAdmin(user, role, dsa) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    status: user.status,
    roleCode: role?.code || null,
    roleName: role?.name || null,
    permissions: Array.isArray(role?.permissions) ? [...role.permissions] : [],
    dsaId: String(user.dsaId),
    dsaCode: dsa?.dsaCode || null,
    dsaDisplayName: dsa?.displayName || dsa?.companyName || null,
    lastLoginAt: user.lastLoginAt || null,
  };
}

async function loadActiveDsaRole(roleId) {
  const role = await AdminRole.findById(roleId).lean();
  if (!role || role.status !== 'ACTIVE' || role.scope !== ROLE_SCOPE.DSA) {
    throw AppError.unauthorized('Admin role is invalid');
  }
  return role;
}

async function issueDsaSession(userId, dsaId) {
  const token = issueOpaqueToken(TOKEN_PREFIX);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await DsaAdminSession.create({
    userId,
    dsaId,
    tokenHash: hashToken(token),
    expiresAt,
    lastUsedAt: new Date(),
  });
  return { token, expiresAt: expiresAt.toISOString() };
}

async function loginDsaAdmin({ email, password }) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  if (!normalized || !password) {
    throw AppError.validation('Email and password are required');
  }

  const user = await DsaAdminUser.findOne({ email: normalized }).select(
    '+passwordHash',
  );
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw AppError.unauthorized('Invalid email or password');
  }
  if (user.status !== 'ACTIVE') {
    throw AppError.unauthorized('Admin account is disabled');
  }

  const dsa = await Dsa.findById(user.dsaId).lean();
  if (!dsa) {
    throw AppError.unauthorized('DSA tenant is unavailable');
  }
  if (dsa.status !== 'ACTIVE') {
    throw AppError.unauthorized('DSA tenant is not active');
  }

  const role = await loadActiveDsaRole(user.roleId);
  user.lastLoginAt = new Date();
  await user.save();

  const session = await issueDsaSession(user._id, user.dsaId);
  return {
    ...session,
    user: toPublicDsaAdmin(user, role, dsa),
  };
}

async function resolveDsaAdminFromToken(token) {
  if (!token || !String(token).startsWith(TOKEN_PREFIX)) {
    throw AppError.unauthorized('Invalid DSA admin token');
  }

  const session = await DsaAdminSession.findOne({
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

  const user = await DsaAdminUser.findById(session.userId);
  if (!user || user.status !== 'ACTIVE') {
    throw AppError.unauthorized('Admin account is disabled');
  }

  // Tenant always from session, never from client input.
  if (String(user.dsaId) !== String(session.dsaId)) {
    throw AppError.unauthorized('Session tenant mismatch');
  }

  const dsa = await Dsa.findById(session.dsaId).lean();
  if (!dsa || dsa.status !== 'ACTIVE') {
    throw AppError.unauthorized('DSA tenant is not active');
  }

  const role = await loadActiveDsaRole(user.roleId);
  session.lastUsedAt = new Date();
  await session.save();

  return { user, role, session, dsa };
}

async function logoutDsaAdmin(token) {
  if (!token) return { revoked: false };
  const session = await DsaAdminSession.findOne({
    tokenHash: hashToken(token),
  });
  if (!session || session.revokedAt) return { revoked: false };
  session.revokedAt = new Date();
  await session.save();
  return { revoked: true };
}

async function createDsaAdminUser({
  dsaId,
  name,
  email,
  phone = '',
  password,
  roleCode = 'DSA_OWNER',
  status = 'ACTIVE',
}) {
  const dsa = await Dsa.findById(dsaId);
  if (!dsa) throw AppError.validation('DSA not found');

  const role = await AdminRole.findOne({
    scope: ROLE_SCOPE.DSA,
    code: String(roleCode).toUpperCase(),
    status: 'ACTIVE',
  });
  if (!role) throw AppError.validation(`DSA role not found: ${roleCode}`);

  const normalized = String(email).trim().toLowerCase();
  if (!normalized || !String(name || '').trim()) {
    throw AppError.validation('name and email are required');
  }
  if (!password || String(password).length < 8) {
    throw AppError.validation('password must be at least 8 characters');
  }

  // Email is globally unique across all DSAs (login resolves one tenant).
  const existing = await DsaAdminUser.findOne({ email: normalized });
  if (existing) {
    throw AppError.validation('DSA admin email already exists');
  }

  const user = await DsaAdminUser.create({
    dsaId: dsa._id,
    name: String(name).trim(),
    email: normalized,
    phone: String(phone || '').trim(),
    passwordHash: hashPassword(password),
    status: status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
    roleId: role._id,
  });

  return toPublicDsaAdmin(user, role, dsa);
}

async function listDsaAdminUsers(dsaId) {
  const dsa = await Dsa.findById(dsaId).lean();
  if (!dsa) throw AppError.notFound('DSA not found');

  const users = await DsaAdminUser.find({ dsaId: dsa._id })
    .sort({ createdAt: -1 })
    .lean();
  const roleIds = [...new Set(users.map((u) => String(u.roleId)))];
  const roles = roleIds.length
    ? await AdminRole.find({ _id: { $in: roleIds } }).lean()
    : [];
  const roleById = new Map(roles.map((r) => [String(r._id), r]));

  return {
    dsa: {
      id: String(dsa._id),
      dsaCode: dsa.dsaCode,
      displayName: dsa.displayName,
      status: dsa.status,
    },
    items: users.map((u) => toPublicDsaAdmin(u, roleById.get(String(u.roleId)), dsa)),
  };
}

/**
 * APLAdmin-controlled first/additional DSA admin provisioning.
 * Returns temporaryPassword once in the response — never stored as plaintext.
 */
async function provisionDsaAdminByApl({
  dsaId,
  name,
  email,
  phone = '',
  roleCode = 'DSA_OWNER',
  password,
}) {
  const temporaryPassword =
    password && String(password).length >= 8
      ? String(password)
      : generateTemporaryAdminPassword();
  const generated = !(password && String(password).length >= 8);

  const admin = await createDsaAdminUser({
    dsaId,
    name,
    email,
    phone,
    roleCode,
    password: temporaryPassword,
  });

  return {
    admin,
    temporaryPassword,
    passwordDelivery: generated
      ? 'RESPONSE_ONCE_DEVELOPMENT'
      : 'RESPONSE_ONCE_PROVIDED',
    note: 'Store this password securely. It is not emailed and cannot be retrieved again.',
  };
}

module.exports = {
  TOKEN_PREFIX,
  TOKEN_TTL_MS,
  loginDsaAdmin,
  resolveDsaAdminFromToken,
  logoutDsaAdmin,
  createDsaAdminUser,
  listDsaAdminUsers,
  provisionDsaAdminByApl,
  generateTemporaryAdminPassword,
  toPublicDsaAdmin,
  hashToken,
};
