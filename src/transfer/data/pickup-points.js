'use strict';

function pickupPointsFor(pickup = {}) {
  const kind = String(pickup.kind || '').toUpperCase();
  const name = String(pickup.name || 'Pickup');
  if (kind === 'AIRPORT' || /airport/i.test(name)) {
    return [
      { code: 'T1-ARRIVALS', name: 'Terminal 1 Arrivals', kind: 'AIRPORT' },
      { code: 'T3-ARRIVALS', name: 'Terminal 3 Arrivals', kind: 'AIRPORT' },
    ];
  }
  if (kind === 'STATION' || /station|railway/i.test(name)) {
    return [
      { code: 'STN-MAIN', name: `${name} main entrance`, kind: 'STATION' },
      { code: 'STN-P1', name: `${name} platform 1`, kind: 'STATION' },
    ];
  }
  return [
    { code: 'DOOR', name, kind: kind || 'ADDRESS' },
  ];
}

module.exports = { pickupPointsFor };
