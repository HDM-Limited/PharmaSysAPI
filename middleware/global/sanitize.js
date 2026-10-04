const mongoSanitize = require('express-mongo-sanitize');

const sanitize = mongoSanitize({
  replaceWith: '_',
  allowDots: false,
});

module.exports = sanitize;