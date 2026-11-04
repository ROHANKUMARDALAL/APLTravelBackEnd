'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase26r';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../common/database/connection');
const Testimonial = require('./models/Testimonial');
const {
  createCustomerReview,
  updateCustomerReview,
  deleteCustomerReview,
  listCustomerReviews,
} = require('./services/testimonial.service');

const URI = 'mongodb://127.0.0.1:27018/apl_test_phase26r';

describe('customer reviews', () => {
  const dsaId = new mongoose.Types.ObjectId();
  const otherDsa = new mongoose.Types.ObjectId();
  const user = { _id: new mongoose.Types.ObjectId(), name: 'Asha Mehta', profilePhoto: '' };
  const stranger = { _id: new mongoose.Types.ObjectId(), name: 'Other Person', profilePhoto: '' };

  before(async () => {
    if (process.env.APL_TEST_MONGODB_URI !== URI) throw new Error('Refusing to run outside apl_test_phase26r');
    await connectDatabase();
    if (mongoose.connection.name !== 'apl_test_phase26r') throw new Error('Wrong database');
    await mongoose.connection.db.dropDatabase();
  });

  after(async () => {
    if (mongoose.connection.name === 'apl_test_phase26r') await mongoose.connection.db.dropDatabase();
    await disconnectDatabase();
  });

  it('publishes a review, blocks another customer, and keeps an inactive review inactive', async () => {
    const review = await createCustomerReview({
      dsaId,
      user,
      input: { rating: 5, title: 'Easy booking', message: 'The desk arranged the tickets quickly.', relatedService: 'flight' },
    });
    assert.equal(review.status, 'ACTIVE');
    assert.equal(review.customerName, 'Asha Mehta');
    const edited = await updateCustomerReview({
      dsaId,
      user,
      reviewId: review.id,
      input: { rating: 4, title: 'Updated', message: 'The desk arranged the tickets carefully.', relatedService: 'holiday' },
    });
    assert.equal(edited.id, review.id);
    assert.equal(edited.rating, 4);
    assert.equal(await Testimonial.countDocuments({ dsaId, customerId: user._id, deletedAt: null }), 1);
    await Testimonial.updateOne({ _id: review.id }, { status: 'INACTIVE' });
    const stillHidden = await updateCustomerReview({
      dsaId,
      user,
      reviewId: review.id,
      input: { rating: 5, title: 'Please publish', message: 'The desk arranged the tickets carefully.', relatedService: 'flight' },
    });
    assert.equal(stillHidden.status, 'INACTIVE');
    await assert.rejects(() => updateCustomerReview({
      dsaId,
      user: stranger,
      reviewId: review.id,
      input: { rating: 1, title: 'No', message: 'This is not my review at all.', relatedService: 'visa' },
    }), /not found/i);
    await assert.rejects(() => deleteCustomerReview({ dsaId: otherDsa, user, reviewId: review.id }), /not found/i);
    const removed = await deleteCustomerReview({ dsaId, user, reviewId: review.id });
    assert.equal(removed.deleted, true);
    assert.equal((await listCustomerReviews(dsaId, user._id)).length, 0);
    assert.equal(await Testimonial.countDocuments({ _id: review.id, status: 'ACTIVE' }), 0);
    const legacy = await Testimonial.create({
      dsaId, customerName: 'Historical Guest', message: 'An older published quote.', rating: 5, status: 'ACTIVE',
    });
    assert.equal(legacy.status, 'ACTIVE');
  });
});
