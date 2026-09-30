'use strict';

const { mongoose } = require('../../common/database/connection');

const SavedTravellerSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, default: 'Mr', trim: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    dateOfBirth: { type: String, default: '', trim: true },
    gender: { type: String, default: '', trim: true },
    nationality: { type: String, default: '', trim: true },
    travellerType: {
      type: String,
      enum: ['adult', 'child', 'infant'],
      default: 'adult',
    },
    passportNumber: { type: String, default: '', trim: true },
    passportExpiry: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.SavedTraveller || mongoose.model('SavedTraveller', SavedTravellerSchema);
