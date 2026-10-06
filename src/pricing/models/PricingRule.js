'use strict';

const { mongoose } = require('../../common/database/connection');

/**
 * Commercial pricing rules (Phase 12).
 * Secrets never stored here. FIXED rules require currency (no FX).
 */
const PricingRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    ownerScope: {
      type: String,
      enum: ['PLATFORM', 'DSA'],
      required: true,
      index: true,
    },
    /** Required when ownerScope === DSA */
    dsaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dsa',
      index: true,
      default: null,
    },
    /**
     * APL_MARKUP | DSA_MARKUP | DSA_MARKUP_CEILING | SERVICE_FEE |
     * SUPPLIER_COMMISSION | DISCOUNT
     */
    ruleKind: {
      type: String,
      enum: [
        'APL_MARKUP',
        'DSA_MARKUP',
        'DSA_MARKUP_CEILING',
        'SERVICE_FEE',
        'SUPPLIER_COMMISSION',
        'DISCOUNT',
      ],
      required: true,
      index: true,
    },
    /** Lowercase master service code, or null = all services */
    serviceCode: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      index: true,
    },
    /** Uppercase supplier code, or null = all suppliers */
    supplierCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },
    adjustmentType: {
      type: String,
      enum: ['PERCENTAGE', 'FIXED'],
      required: true,
    },
    /** Percent (e.g. 2.5) or major currency units for FIXED */
    value: { type: Number, required: true },
    /** Required for FIXED; ignored for PERCENTAGE */
    currency: { type: String, uppercase: true, default: null },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE',
      index: true,
    },
    /** Higher wins within the same specificity tier */
    priority: { type: Number, default: 100, min: 1, max: 10_000 },
    effectiveFrom: { type: Date, default: null },
    effectiveTo: { type: Date, default: null },
    tripType: {
      type: String,
      enum: ['ONEWAY', 'ROUNDTRIP', null],
      default: null,
    },
    notes: { type: String, default: '', maxlength: 1000 },
  },
  { timestamps: true },
);

PricingRuleSchema.index({
  status: 1,
  ownerScope: 1,
  ruleKind: 1,
  serviceCode: 1,
  supplierCode: 1,
  dsaId: 1,
});

module.exports =
  mongoose.models.PricingRule || mongoose.model('PricingRule', PricingRuleSchema);
