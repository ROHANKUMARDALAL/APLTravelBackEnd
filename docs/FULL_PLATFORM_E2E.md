# Full platform E2E (Phase 15E–15G)

Automated proof: `src/tenant/services/three-backend-hierarchy.integration.test.js`

That suite starts **three independent Express apps** (B2C / DSAAdmin / APLAdmin) against **one MongoDB** and verifies:

- B2C does not mount `/api/apl-admin` or `/api/dsa-admin`
- APLAdmin creates DSA + `dsaCode` + allows Flight/Hotel/Bus/Transfer + provisions DSAAdmin
- DSAAdmin session tenant; client `dsaId` ignored
- DSAAdmin activates services → shared `isServiceOffered` true → B2C public config
- APL revoke Bus → DSA cannot reactivate → B2C Bus search fails closed
- APL suspend → DSAAdmin/B2C fail closed → restore

Travel product search/book/pay/cancel remain covered by existing Flight/Hotel/Bus/Transfer/payment suites on B2C `createApp()`.

**Manual UI check required** for pixel-level page smoke on :3001/:3002/:3003 (Next.js). Hierarchy and authority are API-verified.

DEV bootstrap (if still seeded):

- APLAdmin: `admin@apltravel.local` / `AplAdmin123!`
- DSAAdmin: provisioned per-DSA (one-time `temporaryPassword`)
