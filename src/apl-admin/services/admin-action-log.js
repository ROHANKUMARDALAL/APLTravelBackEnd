'use strict';

/**
 * Persist + console structured admin mutation/inspection audit (Phase 13).
 */
const { mongoose } = require('../../common/database/connection');

const AdminAuditLogSchema = new mongoose.Schema(
  {
    actor: {
      id: { type: String },
      email: { type: String },
      type: { type: String },
    },
    action: { type: String, required: true, index: true },
    resourceType: { type: String, index: true },
    resourceId: { type: String, index: true },
    dsaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dsa', index: true },
    bookingRef: { type: String, index: true },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

AdminAuditLogSchema.index({ createdAt: -1 });

const AdminAuditLog =
  mongoose.models.AdminAuditLog ||
  mongoose.model('AdminAuditLog', AdminAuditLogSchema);

function logAdminAction({
  actor,
  action,
  resourceType,
  resourceId,
  details = {},
  before,
  after,
  dsaId,
  bookingRef,
}) {
  const payload = {
    at: new Date().toISOString(),
    actor: actor
      ? {
          id: actor.id || actor._id || null,
          email: actor.email || null,
          type: actor.type || 'APL',
        }
      : null,
    action,
    resourceType,
    resourceId: resourceId ? String(resourceId) : null,
    dsaId: dsaId || details.dsaId || null,
    bookingRef: bookingRef || details.bookingRef || details.aplBookingRef || null,
    before: before || undefined,
    after: after || undefined,
    details,
  };
  console.info('[apl-admin-action]', JSON.stringify(payload));
  AdminAuditLog.create({
    actor: payload.actor,
    action: payload.action,
    resourceType: payload.resourceType,
    resourceId: payload.resourceId,
    dsaId: payload.dsaId || undefined,
    bookingRef: payload.bookingRef || undefined,
    before: payload.before,
    after: payload.after,
    details: payload.details,
  }).catch((err) => {
    console.error('AdminAuditLog write failed:', err.message);
  });
  return payload;
}

module.exports = { logAdminAction, AdminAuditLog };
