'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { groupPublicPopularRoutes } = require('./popular-routes.service');

function route(serviceCode, extra = {}) {
  return {
    _id: `${serviceCode}-1`,
    serviceCode,
    originCode: 'DEL',
    destinationCode: 'BOM',
    originName: 'Delhi',
    destinationName: 'Mumbai',
    isActive: true,
    isFeatured: true,
    searchDefaults: { departOffsetDays: 7, adults: 1 },
    ...extra,
  };
}

describe('groupPublicPopularRoutes', () => {
  it('shows flight routes only when flight is offered', () => {
    const groups = groupPublicPopularRoutes(
      [{ code: 'flight' }, { code: 'hotel' }],
      [route('flight'), route('bus', { _id: 'bus-1' })],
    );
    assert.deepEqual(groups.map((group) => group.serviceCode), ['flight']);
    assert.equal(groups[0].routes.length, 1);
    assert.equal(groups[0].routes[0].originCode, 'DEL');
  });

  it('hides flight routes when flight is not offered', () => {
    const groups = groupPublicPopularRoutes([{ code: 'bus' }], [route('flight')]);
    assert.deepEqual(groups, []);
  });

  it('hides an offered service that has no routes', () => {
    const groups = groupPublicPopularRoutes(
      [{ code: 'flight' }, { code: 'bus' }],
      [],
    );
    assert.deepEqual(groups, []);
  });

  it('shows bus routes only when bus is offered', () => {
    const groups = groupPublicPopularRoutes(
      [{ code: 'bus' }],
      [route('bus', { _id: 'bus-1', originName: 'Delhi', destinationName: 'Jaipur' })],
    );
    assert.deepEqual(groups.map((group) => group.serviceCode), ['bus']);
    assert.equal(groups[0].routes[0].originName, 'Delhi');
  });

  it('keeps a flight route out of the bus section', () => {
    const groups = groupPublicPopularRoutes(
      [{ code: 'flight' }, { code: 'bus' }],
      [route('flight'), route('bus', { _id: 'bus-1' })],
    );
    const flight = groups.find((group) => group.serviceCode === 'flight');
    const bus = groups.find((group) => group.serviceCode === 'bus');
    assert.equal(flight.routes.length, 1);
    assert.equal(bus.routes.length, 1);
    assert.ok(flight.routes.every((item) => item.serviceCode === 'flight'));
    assert.ok(bus.routes.every((item) => item.serviceCode === 'bus'));
  });

  it('hides transfer routes when transfer is not offered', () => {
    const groups = groupPublicPopularRoutes(
      [{ code: 'flight' }],
      [route('transfer', { _id: 'transfer-1' })],
    );
    assert.deepEqual(groups, []);
  });

  it('shows a hotel destination when hotel is offered', () => {
    const groups = groupPublicPopularRoutes(
      [{ code: 'hotel' }],
      [route('hotel', { _id: 'hotel-1', originName: 'New Delhi', originCode: '130443', destinationCode: '' })],
    );
    assert.equal(groups[0].serviceCode, 'hotel');
    assert.equal(groups[0].routes[0].originCode, '130443');
  });

  it('drops inactive and non-featured flight routes', () => {
    const groups = groupPublicPopularRoutes(
      [{ code: 'flight' }],
      [
        route('flight', { _id: 'off', isActive: false }),
        route('flight', { _id: 'plain', isFeatured: false }),
      ],
    );
    assert.deepEqual(groups, []);
  });

  it('returns no section when every service is inactive', () => {
    const groups = groupPublicPopularRoutes([], [route('flight'), route('bus')]);
    assert.deepEqual(groups, []);
  });
});
