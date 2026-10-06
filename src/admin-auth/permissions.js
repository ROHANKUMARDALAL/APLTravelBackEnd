'use strict';

/**
 * Extensible permission catalogue for APLAdmin + DSAAdmin.
 * Controllers authorize via requirePermission(...), not raw role string checks.
 */

const Permission = Object.freeze({
  DSA_VIEW: 'dsa.view',
  DSA_CREATE: 'dsa.create',
  DSA_UPDATE: 'dsa.update',
  DSA_SUSPEND: 'dsa.suspend',

  SERVICE_VIEW: 'service.view',
  SERVICE_MANAGE: 'service.manage',
  SERVICE_ASSIGN: 'service.assign',

  BOOKING_VIEW: 'booking.view',
  BOOKING_CANCEL: 'booking.cancel',

  PAYMENT_VIEW: 'payment.view',
  REFUND_VIEW: 'refund.view',

  BLOG_VIEW: 'blog.view',
  BLOG_CREATE: 'blog.create',
  BLOG_UPDATE: 'blog.update',
  BLOG_DELETE: 'blog.delete',

  TESTIMONIAL_VIEW: 'testimonial.view',
  TESTIMONIAL_MANAGE: 'testimonial.manage',

  CMS_VIEW: 'cms.view',
  CMS_MANAGE: 'cms.manage',

  BRANDING_VIEW: 'branding.view',
  BRANDING_MANAGE: 'branding.manage',

  FOOTER_VIEW: 'footer.view',
  FOOTER_MANAGE: 'footer.manage',

  USER_VIEW: 'user.view',
  USER_MANAGE: 'user.manage',

  AUDIT_VIEW: 'audit.view',

  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',

  SUPPLIER_VIEW: 'supplier.view',
  SUPPLIER_MANAGE: 'supplier.manage',
  SUPPLIER_ASSIGN: 'supplier.assign',

  REQUESTLOG_VIEW: 'requestlog.view',

  PRICING_VIEW: 'pricing.view',
  PRICING_MANAGE: 'pricing.manage',

  MARKUP_VIEW: 'markup.view',
  MARKUP_MANAGE: 'markup.manage',
});

const ROLE_SCOPE = Object.freeze({
  APL: 'APL',
  DSA: 'DSA',
});

/** Initial APL system roles → permissions */
const APL_ROLE_DEFINITIONS = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Admin',
    scope: ROLE_SCOPE.APL,
    permissions: Object.values(Permission),
  },
  {
    code: 'ADMIN',
    name: 'Admin',
    scope: ROLE_SCOPE.APL,
    permissions: [
      Permission.DSA_VIEW,
      Permission.DSA_CREATE,
      Permission.DSA_UPDATE,
      Permission.DSA_SUSPEND,
      Permission.SERVICE_VIEW,
      Permission.SERVICE_MANAGE,
      Permission.SERVICE_ASSIGN,
      Permission.SUPPLIER_VIEW,
      Permission.SUPPLIER_MANAGE,
      Permission.SUPPLIER_ASSIGN,
      Permission.REQUESTLOG_VIEW,
      Permission.PRICING_VIEW,
      Permission.PRICING_MANAGE,
      Permission.BOOKING_VIEW,
      Permission.PAYMENT_VIEW,
      Permission.REFUND_VIEW,
      Permission.USER_VIEW,
      Permission.USER_MANAGE,
      Permission.AUDIT_VIEW,
      Permission.SETTINGS_VIEW,
      Permission.SETTINGS_MANAGE,
    ],
  },
  {
    code: 'OPERATIONS',
    name: 'Operations',
    scope: ROLE_SCOPE.APL,
    permissions: [
      Permission.DSA_VIEW,
      Permission.SERVICE_VIEW,
      Permission.SERVICE_ASSIGN,
      Permission.SUPPLIER_VIEW,
      Permission.SUPPLIER_ASSIGN,
      Permission.REQUESTLOG_VIEW,
      Permission.PRICING_VIEW,
      Permission.BOOKING_VIEW,
      Permission.BOOKING_CANCEL,
      Permission.PAYMENT_VIEW,
      Permission.REFUND_VIEW,
      Permission.USER_VIEW,
    ],
  },
  {
    code: 'ACCOUNTS',
    name: 'Accounts',
    scope: ROLE_SCOPE.APL,
    permissions: [
      Permission.DSA_VIEW,
      Permission.BOOKING_VIEW,
      Permission.PAYMENT_VIEW,
      Permission.REFUND_VIEW,
      Permission.USER_VIEW,
      Permission.AUDIT_VIEW,
      Permission.PRICING_VIEW,
    ],
  },
  {
    code: 'SUPPORT',
    name: 'Support',
    scope: ROLE_SCOPE.APL,
    permissions: [
      Permission.DSA_VIEW,
      Permission.SERVICE_VIEW,
      Permission.REQUESTLOG_VIEW,
      Permission.BOOKING_VIEW,
      Permission.PAYMENT_VIEW,
      Permission.REFUND_VIEW,
      Permission.USER_VIEW,
      Permission.PRICING_VIEW,
    ],
  },
  {
    code: 'CONTENT_MANAGER',
    name: 'Content Manager',
    scope: ROLE_SCOPE.APL,
    permissions: [
      Permission.SERVICE_VIEW,
      Permission.BLOG_VIEW,
      Permission.BLOG_CREATE,
      Permission.BLOG_UPDATE,
      Permission.BLOG_DELETE,
      Permission.TESTIMONIAL_VIEW,
      Permission.TESTIMONIAL_MANAGE,
      Permission.CMS_VIEW,
      Permission.CMS_MANAGE,
      Permission.BRANDING_VIEW,
      Permission.BRANDING_MANAGE,
      Permission.FOOTER_VIEW,
      Permission.FOOTER_MANAGE,
      Permission.SETTINGS_VIEW,
    ],
  },
];

/** Initial DSA system roles → permissions */
const DSA_ROLE_DEFINITIONS = [
  {
    code: 'DSA_OWNER',
    name: 'DSA Owner',
    scope: ROLE_SCOPE.DSA,
    permissions: Object.values(Permission).filter(
      (p) =>
        !p.startsWith('dsa.create') &&
        p !== Permission.DSA_SUSPEND &&
        !p.startsWith('supplier.') &&
        !p.startsWith('pricing.') &&
        p !== Permission.REQUESTLOG_VIEW,
    ),
  },
  {
    code: 'DSA_ADMIN',
    name: 'DSA Admin',
    scope: ROLE_SCOPE.DSA,
    permissions: [
      Permission.SERVICE_VIEW,
      Permission.SERVICE_MANAGE,
      Permission.BOOKING_VIEW,
      Permission.BOOKING_CANCEL,
      Permission.MARKUP_VIEW,
      Permission.MARKUP_MANAGE,
      Permission.BLOG_VIEW,
      Permission.BLOG_CREATE,
      Permission.BLOG_UPDATE,
      Permission.BLOG_DELETE,
      Permission.TESTIMONIAL_VIEW,
      Permission.TESTIMONIAL_MANAGE,
      Permission.CMS_VIEW,
      Permission.CMS_MANAGE,
      Permission.BRANDING_VIEW,
      Permission.BRANDING_MANAGE,
      Permission.FOOTER_VIEW,
      Permission.FOOTER_MANAGE,
      Permission.USER_VIEW,
      Permission.USER_MANAGE,
      Permission.SETTINGS_VIEW,
      Permission.SETTINGS_MANAGE,
    ],
  },
  {
    code: 'MANAGER',
    name: 'Manager',
    scope: ROLE_SCOPE.DSA,
    permissions: [
      Permission.SERVICE_VIEW,
      Permission.BOOKING_VIEW,
      Permission.BOOKING_CANCEL,
      Permission.MARKUP_VIEW,
      Permission.BLOG_VIEW,
      Permission.BLOG_CREATE,
      Permission.BLOG_UPDATE,
      Permission.TESTIMONIAL_VIEW,
      Permission.TESTIMONIAL_MANAGE,
      Permission.CMS_VIEW,
      Permission.CMS_MANAGE,
      Permission.BRANDING_VIEW,
      Permission.BRANDING_MANAGE,
      Permission.FOOTER_VIEW,
      Permission.FOOTER_MANAGE,
      Permission.USER_VIEW,
      Permission.SETTINGS_VIEW,
    ],
  },
  {
    code: 'SUPPORT',
    name: 'Support',
    scope: ROLE_SCOPE.DSA,
    permissions: [
      Permission.SERVICE_VIEW,
      Permission.BOOKING_VIEW,
      Permission.MARKUP_VIEW,
      Permission.USER_VIEW,
      Permission.BLOG_VIEW,
      Permission.TESTIMONIAL_VIEW,
      Permission.CMS_VIEW,
      Permission.BRANDING_VIEW,
      Permission.FOOTER_VIEW,
    ],
  },
  {
    code: 'CONTENT_MANAGER',
    name: 'Content Manager',
    scope: ROLE_SCOPE.DSA,
    permissions: [
      Permission.BLOG_VIEW,
      Permission.BLOG_CREATE,
      Permission.BLOG_UPDATE,
      Permission.BLOG_DELETE,
      Permission.TESTIMONIAL_VIEW,
      Permission.TESTIMONIAL_MANAGE,
      Permission.CMS_VIEW,
      Permission.CMS_MANAGE,
      Permission.BRANDING_VIEW,
      Permission.BRANDING_MANAGE,
      Permission.FOOTER_VIEW,
      Permission.FOOTER_MANAGE,
      Permission.SETTINGS_VIEW,
      Permission.SERVICE_VIEW,
    ],
  },
];

function hasPermission(permissionSet, required) {
  if (!required) return true;
  const set = permissionSet instanceof Set ? permissionSet : new Set(permissionSet || []);
  if (Array.isArray(required)) {
    return required.every((p) => set.has(p));
  }
  return set.has(required);
}

function hasAnyPermission(permissionSet, candidates) {
  if (!candidates || (Array.isArray(candidates) && candidates.length === 0)) {
    return true;
  }
  const set = permissionSet instanceof Set ? permissionSet : new Set(permissionSet || []);
  const list = Array.isArray(candidates) ? candidates : [candidates];
  return list.some((p) => set.has(p));
}

module.exports = {
  Permission,
  ROLE_SCOPE,
  APL_ROLE_DEFINITIONS,
  DSA_ROLE_DEFINITIONS,
  hasPermission,
  hasAnyPermission,
};
