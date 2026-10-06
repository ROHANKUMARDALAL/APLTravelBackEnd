'use strict';

module.exports = {
  ...require('./services'),
  ...require('./tenant'),
  ...require('./booking'),
  ...require('./payments'),
  ...require('./pricing'),
  ...require('./suppliers'),
  ...require('./auth'),
};
