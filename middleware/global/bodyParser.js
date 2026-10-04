const express = require('express');

const json = express.json({ limit: '1mb' });
const urlencoded = express.urlencoded({ extended: true, limit: '1mb' });

function bodyParser(req, res, next) {
  json(req, res, (err) => {
    if (err) return next(err);
    urlencoded(req, res, next);
  });
}

module.exports = bodyParser;