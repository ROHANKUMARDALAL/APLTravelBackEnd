'use strict';

/**
 * Dry-run by default. Pass --apply only against an isolated database.
 * Never points itself at the shared apl_travel URI.
 */
const { assignConfirmationPnr } = require('../src/common/services/booking-pnr');

const ELIGIBLE = new Set(['FLIGHT', 'HOTEL', 'BUS', 'TRANSFER']);

async function backfillTestPnrs(Booking, { apply = false } = {}) {
  const rows = await Booking.find({
    status: 'CONFIRMED',
    productType: { $in: [...ELIGIBLE] },
    $or: [{ pnr: { $exists: false } }, { pnr: '' }],
  }).lean();
  const report = { eligible: 0, skipped: 0, updated: 0, dryRun: !apply };
  for (const row of rows) {
    const supplier = row.items?.[0]?.supplierBookingRef || '';
    const genuine = supplier && !String(supplier).startsWith('PNR') && !String(row.confirmationNotice || '').includes('MOCK');
    if (row.pnr || genuine) {
      report.skipped += 1;
      continue;
    }
    report.eligible += 1;
    if (!apply) continue;
    const payload = { productType: row.productType, status: 'CONFIRMED' };
    await assignConfirmationPnr(Booking, payload, { mock: true });
    await Booking.updateOne(
      { _id: row._id, pnr: { $exists: false } },
      { $set: { pnr: payload.pnr, confirmationNotice: payload.confirmationNotice } },
    );
    report.updated += 1;
  }
  return report;
}

module.exports = { backfillTestPnrs };

if (require.main === module) {
  const uri = process.env.APL_TEST_MONGODB_URI || '';
  if (!process.env.APL_ALLOW_TEST_DB || !uri || /apl_travel/.test(uri)) {
    console.log(JSON.stringify({ eligible: 0, skipped: 0, updated: 0, dryRun: true, ran: false }));
    process.exit(0);
  }
}
