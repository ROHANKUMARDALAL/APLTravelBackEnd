'use strict';

const { mongoose } = require('../../common/database/connection');

/** Random login token session. The raw token is returned once; only its hash is stored. */
const LoginSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.LoginSession || mongoose.model('LoginSession', LoginSessionSchema);
