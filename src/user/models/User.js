'use strict';

const { mongoose } = require('../../common/database/connection');

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phoneNumber: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    profilePhoto: { type: String, default: null },
    currency: { type: String, required: true, uppercase: true },
    /** Wallet balance in the user's currency. Card/UPI bookings do not spend this. */
    balance: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
