'use strict';

function padSeq(n, width = 6) {
  return String(n).padStart(width, '0');
}

function formatAplHotelId(seq) {
  return `APL-HOTEL-${padSeq(seq)}`;
}

function formatAplFlightId(seq) {
  return `APL-FLT-${padSeq(seq)}`;
}

function formatAplOfferId(seq) {
  return `APL-OFFER-${padSeq(seq)}`;
}

function formatAplRoomId(seq) {
  return `APL-ROOM-${padSeq(seq)}`;
}

function formatAplSearchId(token) {
  return `APL-SRCH-${token}`;
}

function formatAplBookingRef(token) {
  return `APL-BK-${token}`;
}

function stableSeqFromKey(key, modulo = 900000) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return (hash % modulo) + 1;
}

module.exports = {
  padSeq,
  formatAplHotelId,
  formatAplFlightId,
  formatAplOfferId,
  formatAplRoomId,
  formatAplSearchId,
  formatAplBookingRef,
  stableSeqFromKey,
};
