// middleware/versionHeader.js
const appVersion = require('../config/version');

/**
 * Middleware to add version information to response headers
 */
function versionHeader(req, res, next) {
  res.set('X-App-Version', appVersion.getSemanticVersion());
  res.set('X-App-Build', appVersion.getFullVersion());
  next();
}

module.exports = versionHeader;