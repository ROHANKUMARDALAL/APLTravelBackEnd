'use strict';

/**
 * New bookings are written only to the canonical `bookings` collection.
 * Older service collections stay readable. Nothing is copied, renamed, or deleted.
 */

const SERVICE_COLLECTIONS = {
  FLIGHT: 'bookings_flight',
  HOTEL: 'bookings_hotel',
  BUS: 'bookings_bus',
  TRANSFER: 'bookings_transfer',
};

const LEGACY_COLLECTION = 'bookings';
const READ_COLLECTIONS = [LEGACY_COLLECTION, ...Object.values(SERVICE_COLLECTIONS)];

function collectionForProduct() {
  return LEGACY_COLLECTION;
}

function duplicateKey(message) {
  const error = new Error(message);
  error.code = 11000;
  return error;
}

function collectionsForFilter(filter) {
  const product = filter && filter.productType;
  if (typeof product === 'string' && SERVICE_COLLECTIONS[product]) {
    return [SERVICE_COLLECTIONS[product], LEGACY_COLLECTION];
  }
  if (product && typeof product === 'object' && Array.isArray(product.$in)) {
    const names = product.$in.map((item) => SERVICE_COLLECTIONS[String(item || '').toUpperCase()]).filter(Boolean);
    return [...new Set([...names, LEGACY_COLLECTION])];
  }
  return READ_COLLECTIONS;
}

function compareDocs(sort) {
  if (!sort || typeof sort !== 'object' || Array.isArray(sort)) return null;
  const keys = Object.entries(sort);
  if (!keys.length) return null;
  return (left, right) => {
    for (const [key, direction] of keys) {
      const a = left[key];
      const b = right[key];
      if (a === b) continue;
      if (a == null) return 1;
      if (b == null) return -1;
      if (a > b) return direction < 0 ? -1 : 1;
      if (a < b) return direction < 0 ? 1 : -1;
    }
    return 0;
  };
}

function selectForQuery(select, sort) {
  if (!select) return null;
  if (typeof select === 'string') {
    const extra = sort && typeof sort === 'object' ? Object.keys(sort).join(' ') : '';
    return `${select} ${extra}`.trim();
  }
  if (typeof select === 'object' && sort && typeof sort === 'object') {
    const next = { ...select };
    for (const key of Object.keys(sort)) {
      if (next[key] === undefined) next[key] = 1;
    }
    return next;
  }
  return select;
}

function preferUnique(rows) {
  const chosen = new Map();
  for (const row of rows) {
    const key = row.doc.aplBookingRef || String(row.doc._id);
    const previous = chosen.get(key);
    if (!previous || (!previous.legacy && row.legacy)) chosen.set(key, row);
  }
  return [...chosen.values()].map((row) => row.doc);
}

function createBookingRepository({ mongoose, schema }) {
  const legacy = mongoose.models.Booking || mongoose.model('Booking', schema, LEGACY_COLLECTION);
  const serviceModels = new Map();
  const referenceSchema = new mongoose.Schema(
    {
      aplBookingRef: { type: String, required: true, unique: true },
      clientReference: { type: String, unique: true, sparse: true },
      bookingId: { type: mongoose.Schema.Types.ObjectId },
      collectionName: { type: String, required: true },
      productType: { type: String },
    },
    { timestamps: true },
  );
  const Reference = mongoose.models.BookingReference
    || mongoose.model('BookingReference', referenceSchema, 'booking_references');

  function modelFor(collectionName) {
    if (collectionName === LEGACY_COLLECTION) return legacy;
    const cached = serviceModels.get(collectionName);
    if (cached) return cached;
    const modelName = `BookingService_${collectionName}`;
    const model = mongoose.models[modelName] || mongoose.model(modelName, schema.clone(), collectionName);
    serviceModels.set(collectionName, model);
    return model;
  }

  function modelsFor(filter) {
    return collectionsForFilter(filter).map((name) => modelFor(name));
  }

  async function withDsaSnapshot(doc) {
    const next = { ...doc };
    const product = String(next.productType || '').toUpperCase();
    if (!next.serviceCode && product) next.serviceCode = product;
    if (!next.supplierCode && next.items?.[0]?.supplierCode) next.supplierCode = next.items[0].supplierCode;
    if (!next.customerName && next.userId && mongoose.models.User) {
      const user = await mongoose.models.User.findById(next.userId).select('name').lean();
      if (user?.name) next.customerName = user.name;
    }
    if (!next.dsaId) return next;
    const Dsa = mongoose.models.Dsa;
    if (!Dsa) return next;
    const dsa = await Dsa.findById(next.dsaId).select('dsaCode displayName companyName').lean();
    if (!dsa) return next;
    if (dsa.dsaCode) next.dsaCode = dsa.dsaCode;
    next.dsaName = dsa.displayName || dsa.companyName || '';
    return next;
  }

  class BookingQuery {
    constructor(filter, single) {
      this.filter = filter || {};
      this.single = single;
      this._sort = null;
      this._skip = 0;
      this._limit = 0;
      this._select = null;
      this._lean = false;
    }

    sort(value) {
      this._sort = value;
      return this;
    }

    skip(value) {
      this._skip = Number(value) || 0;
      return this;
    }

    limit(value) {
      this._limit = Number(value) || 0;
      return this;
    }

    select(value) {
      this._select = value;
      return this;
    }

    lean() {
      this._lean = true;
      return this;
    }

    async exec() {
      if (this.single) return this.#one();
      return this.#many();
    }

    then(resolve, reject) {
      return this.exec().then(resolve, reject);
    }

    async #one() {
      const rows = await Promise.all(modelsFor(this.filter).map(async (model) => {
        let query = model.findOne(this.filter);
        if (this._select) query = query.select(this._select);
        if (this._lean) query = query.lean();
        const doc = await query;
        return doc ? { doc, legacy: model.collection.collectionName === LEGACY_COLLECTION } : null;
      }));
      return preferUnique(rows.filter(Boolean))[0] || null;
    }

    async #many() {
      const cap = this._limit > 0 ? this._skip + this._limit : 0;
      const projection = selectForQuery(this._select, this._sort);
      const lists = await Promise.all(modelsFor(this.filter).map(async (model) => {
        let query = model.find(this.filter);
        if (this._sort) query = query.sort(this._sort);
        if (projection) query = query.select(projection);
        if (cap) query = query.limit(cap);
        if (this._lean) query = query.lean();
        const docs = await query;
        return docs.map((doc) => ({
          doc,
          legacy: model.collection.collectionName === LEGACY_COLLECTION,
        }));
      }));
      let merged = preferUnique(lists.flat());
      const sorter = compareDocs(this._sort);
      if (sorter) merged.sort(sorter);
      if (this._skip) merged = merged.slice(this._skip);
      if (this._limit > 0) merged = merged.slice(0, this._limit);
      return merged;
    }
  }

  async function createOne(input) {
    const doc = await withDsaSnapshot(input || {});
    const collectionName = collectionForProduct(doc.productType);
    if (doc.aplBookingRef) {
      const existing = await new BookingQuery({ aplBookingRef: doc.aplBookingRef }, true).exec();
      if (existing) throw duplicateKey('E11000 duplicate key error aplBookingRef');
    }
    if (doc.clientReference) {
      const existing = await new BookingQuery({ clientReference: doc.clientReference }, true).exec();
      if (existing) throw duplicateKey('E11000 duplicate key error clientReference');
    }
    const reference = {
      aplBookingRef: doc.aplBookingRef,
      collectionName,
      productType: doc.productType,
    };
    if (doc.clientReference) reference.clientReference = doc.clientReference;
    try {
      await Reference.create(reference);
    } catch (error) {
      if (error && error.code === 11000) throw duplicateKey('E11000 duplicate key error aplBookingRef');
      throw error;
    }
    try {
      const booking = await modelFor(collectionName).create(doc);
      await Reference.updateOne({ aplBookingRef: doc.aplBookingRef }, { $set: { bookingId: booking._id } });
      return booking;
    } catch (error) {
      await Reference.deleteOne({ aplBookingRef: doc.aplBookingRef });
      throw error;
    }
  }

  async function distinct(field, filter = {}) {
    if (!field || typeof field !== 'string' || field.includes('.') || field.startsWith('$')) {
      throw new Error(`Unsupported distinct field: ${field}`);
    }
    const lists = await Promise.all(modelsFor(filter).map(async (model) => {
      const docs = await model.find(filter).select(`${field} aplBookingRef`).lean();
      return docs.map((doc) => ({
        doc,
        legacy: model.collection.collectionName === LEGACY_COLLECTION,
      }));
    }));
    const seen = new Set();
    const values = [];
    for (const doc of preferUnique(lists.flat())) {
      const value = doc[field];
      if (value == null) continue;
      const key = typeof value === 'object' ? String(value) : value;
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(value);
    }
    return values;
  }

  async function countDocuments(filter = {}) {
    const lists = await Promise.all(
      modelsFor(filter).map((model) => model.find(filter).select('aplBookingRef').lean()),
    );
    const refs = new Set();
    let unkeyed = 0;
    for (const doc of lists.flat()) {
      if (doc.aplBookingRef) refs.add(doc.aplBookingRef);
      else unkeyed += 1;
    }
    return refs.size + unkeyed;
  }

  return {
    serviceCollections: SERVICE_COLLECTIONS,
    legacyCollection: LEGACY_COLLECTION,
    find(filter) {
      return new BookingQuery(filter, false);
    },
    findOne(filter) {
      return new BookingQuery(filter, true);
    },
    findById(id) {
      return new BookingQuery({ _id: id }, true);
    },
    countDocuments,
    distinct,
    async create(payload) {
      if (Array.isArray(payload)) {
        const created = [];
        for (const row of payload) created.push(await createOne(row));
        return created;
      }
      return createOne(payload);
    },
    async updateOne(filter, update, options) {
      const results = await Promise.all(modelsFor(filter).map((model) => model.updateOne(filter, update, options)));
      return results.reduce((sum, result) => ({
        acknowledged: true,
        matchedCount: (sum.matchedCount || 0) + (result.matchedCount || 0),
        modifiedCount: (sum.modifiedCount || 0) + (result.modifiedCount || 0),
      }), { acknowledged: true, matchedCount: 0, modifiedCount: 0 });
    },
    async updateMany(filter, update, options) {
      const results = await Promise.all(modelsFor(filter).map((model) => model.updateMany(filter, update, options)));
      return results.reduce((sum, result) => ({
        acknowledged: true,
        matchedCount: (sum.matchedCount || 0) + (result.matchedCount || 0),
        modifiedCount: (sum.modifiedCount || 0) + (result.modifiedCount || 0),
      }), { acknowledged: true, matchedCount: 0, modifiedCount: 0 });
    },
    async findOneAndUpdate(filter, update, options) {
      for (const model of modelsFor(filter)) {
        const doc = await model.findOneAndUpdate(filter, update, options);
        if (doc) return doc;
      }
      return null;
    },
    async deleteMany(filter) {
      const existing = await new BookingQuery(filter, false).select('aplBookingRef').lean().exec();
      const results = await Promise.all(modelsFor(filter).map((model) => model.deleteMany(filter)));
      const refs = existing.map((doc) => doc.aplBookingRef).filter(Boolean);
      if (refs.length) await Reference.deleteMany({ aplBookingRef: { $in: refs } });
      return {
        acknowledged: true,
        deletedCount: results.reduce((sum, result) => sum + (result.deletedCount || 0), 0),
      };
    },
    aggregate(pipeline = []) {
      return legacy.aggregate([
        { $unionWith: { coll: SERVICE_COLLECTIONS.FLIGHT } },
        { $unionWith: { coll: SERVICE_COLLECTIONS.HOTEL } },
        { $unionWith: { coll: SERVICE_COLLECTIONS.BUS } },
        { $unionWith: { coll: SERVICE_COLLECTIONS.TRANSFER } },
        {
          $group: {
            _id: { $ifNull: ['$aplBookingRef', { $toString: '$_id' }] },
            doc: { $first: '$$ROOT' },
          },
        },
        { $replaceRoot: { newRoot: '$doc' } },
        ...pipeline,
      ]);
    },
  };
}

module.exports = {
  SERVICE_COLLECTIONS,
  LEGACY_COLLECTION,
  collectionForProduct,
  createBookingRepository,
};
