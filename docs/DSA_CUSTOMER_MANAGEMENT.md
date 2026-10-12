# DSA customer management

A person has one global `User`. Each travel business they use has its own `DsaCustomerMembership` (`dsaId` + `userId`, unique). ABC and XYZ can both know the same email without sharing bookings, wallet, or status.

## Tenant ownership

Membership is created when the customer registers on a website, or when that DSA’s admin adds the customer. The host or the DSAAdmin session is the only authority. Request body, query `dsaId`, and `X-DSA-ID` are ignored.

Signing in does not create a membership. A customer can use only a website where they already have an active membership. An existing global email is reused; a second membership is created for the new DSA. The same email cannot be added twice to one DSA. An existing user’s password is not changed by another DSA.

DSAAdmin customer APIs read `dsaId` from the signed-in DSA session. A membership id from another DSA returns 404.

## Status

`ACTIVE`, `SUSPENDED`, and `REMOVED` live on the membership. Suspending Rahul at ABC blocks abc.com only. xyz.com stays active. The global user is not disabled.

`REMOVED` is “Remove from DSA”. Bookings, payments, refunds, and the wallet ledger stay. The global user is not deleted. A removed membership is not reactivated by the next login.

## Bookings

Customer 360 lists `Booking` rows where `dsaId` is the signed-in DSA and `userId` is that customer. Another DSA’s bookings for the same user are not returned.

## Travellers

Saved travellers are stored on the customer, with an optional `dsaId` set from the trusted host at create time. DSAAdmin sees only saved travellers with that DSA’s `dsaId`, plus passengers already stored on that DSA’s bookings. A traveller with no `dsaId`, or one saved on another website, is not shown. Passport numbers are masked in the admin list. The customer can still see their own saved travellers in the B2C account.

## Wallet

`CustomerWallet` is per DSA and user. Amounts are major currency units, the same as `Booking.totalAmount`. The balance is not edited directly. `WalletTransaction` records `ADMIN_ADJUSTMENT` credits and debits with a reason, actor, and balance after the post. A debit that would go below zero is rejected. This ledger is separate from the global `User.balance`.

## Activity

The timeline is built from records that already exist for that DSA and user: membership join, bookings, payments, refunds, cancellations, searches that stored `userId`, and wallet transactions. Searches made before `userId` was stored are not shown. Supplier payloads and margins are not returned.

## RBAC

DSA Owner receives `customer.view`, `customer.manage`, `customer.status.manage`, `customer.wallet.view`, `customer.wallet.adjust`, and `customer.activity.view`. DSA Admin, manager, and content roles do not. Status changes, removal, and wallet posts are written to `AdminAuditLog`.

## Privacy

Responses omit password hashes, tokens, card data, gateway secrets, supplier credentials, and APL margins.
