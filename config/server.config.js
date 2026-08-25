const path = require('path');
const fs = require('fs');
const authConfig = require('./auth.config');

const sessionConfig = {
  secret: process.env.SESSION_SECRET || authConfig.session.secret,
  resave: true,
  saveUninitialized: true,
  name: 'connect.sid',
  proxy: process.env.TRUST_PROXY === 'true',
  cookie: {
    httpOnly: true,
    secure: process.env.SECURE_COOKIE === 'true',
    sameSite: 'lax',
    maxAge: parseInt(process.env.COOKIE_MAX_AGE) || authConfig.session.cookie.maxAge,
    path: '/'
  },
  rolling: true
};

module.exports = {
  port: process.env.PORT || 3000,
  sessionConfig
}; 