'use strict';

/**
 * Demonstration telecom circles. These are not detected from a mobile number
 * and are not a live operator coverage feed.
 */

const ALL = ['JIO', 'AIRTEL', 'VI', 'BSNL'];
const METRO = ['JIO', 'AIRTEL', 'VI'];
const MTNL = ['JIO', 'AIRTEL', 'VI', 'BSNL', 'MTNL'];

const CIRCLES = {
  IN: [
    { code: 'DELHI', name: 'Delhi NCR', operators: MTNL },
    { code: 'UPW', name: 'Uttar Pradesh West', operators: ALL },
    { code: 'UPE', name: 'Uttar Pradesh East', operators: ALL },
    { code: 'MUMBAI', name: 'Mumbai', operators: MTNL },
    { code: 'MH', name: 'Maharashtra & Goa', operators: ALL },
    { code: 'KA', name: 'Karnataka', operators: ALL },
    { code: 'TN', name: 'Tamil Nadu', operators: ALL },
    { code: 'CHENNAI', name: 'Chennai', operators: METRO },
    { code: 'KL', name: 'Kerala', operators: ALL },
    { code: 'GJ', name: 'Gujarat', operators: ALL },
    { code: 'RJ', name: 'Rajasthan', operators: ALL },
    { code: 'PB', name: 'Punjab', operators: ALL },
    { code: 'HR', name: 'Haryana', operators: ALL },
    { code: 'BR', name: 'Bihar & Jharkhand', operators: ALL },
    { code: 'WB', name: 'West Bengal', operators: ALL },
    { code: 'KOLKATA', name: 'Kolkata', operators: METRO },
    { code: 'MP', name: 'Madhya Pradesh & Chhattisgarh', operators: ALL },
    { code: 'OD', name: 'Odisha', operators: ALL },
    { code: 'AS', name: 'Assam', operators: ALL },
    { code: 'NE', name: 'North East', operators: ALL },
    { code: 'JK', name: 'Jammu & Kashmir', operators: ALL },
    { code: 'HP', name: 'Himachal Pradesh', operators: ALL },
    { code: 'AP', name: 'Andhra Pradesh & Telangana', operators: ALL },
  ],
};

function circlesFor(country, operatorCode) {
  const iso = String(country || '').toUpperCase();
  const code = String(operatorCode || '').toUpperCase();
  const rows = CIRCLES[iso] || [];
  if (!code) return rows;
  return rows.filter((row) => row.operators.includes(code));
}

function findCircle(country, operatorCode, circleCode) {
  const code = String(circleCode || '').toUpperCase();
  return circlesFor(country, operatorCode).find((row) => row.code === code) || null;
}

module.exports = {
  CIRCLES,
  circlesFor,
  findCircle,
};
