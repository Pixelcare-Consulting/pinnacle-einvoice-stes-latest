/**
 * Token Refresh Middleware
 * Automatically refreshes LHDN access tokens before they expire
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { LoggingService, LOG_TYPES, MODULES, ACTIONS, STATUS } = require('../services/logging-prisma.service');

// Helper function to get LHDN config
async function getLHDNConfig() {
    const prisma = require('../src/lib/prisma');

    const config = await prisma.wP_CONFIGURATION.findFirst({
        where: {
            Type: 'LHDN',
            IsActive: true
        },
        orderBy: {
            CreateTS: 'desc'
        }
    });

    if (!config || !config.Settings) {
        throw new Error('LHDN configuration not found');
    }

    let settings = typeof config.Settings === 'string' ? JSON.parse(config.Settings) : config.Settings;

    const baseUrl = settings.environment === 'production'
        ? settings.productionUrl || settings.middlewareUrl
        : settings.sandboxUrl || settings.middlewareUrl;

    if (!baseUrl) {
        throw new Error('LHDN API URL not configured');
    }

    return {
        baseUrl,
        environment: settings.environment,
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
        refreshTokenEnabled: settings.refreshTokenEnabled !== false, // Enable refresh by default
        refreshThreshold: settings.refreshThreshold || 10 * 60 * 1000, // 10 minutes in milliseconds
        maxRetries: settings.maxRetries || 3
    };
}

// Helper function to read token from file
function readTokenFromFile() {
    try {
        const tokenFilePath = path.join(__dirname, '../config/AuthorizeToken.ini');
        if (fs.existsSync(tokenFilePath)) {
            const tokenData = fs.readFileSync(tokenFilePath, 'utf8');
            const tokenMatch = tokenData.match(/AccessToken=(.+)/);
            if (tokenMatch && tokenMatch[1]) {
                return tokenMatch[1].trim();
            }
        }
        return null;
    } catch (error) {
        logger.error('Error reading token from file:', error);
        return null;
    }
}

// Helper function to write token to file
function writeTokenToFile(token) {
    try {
        const tokenFilePath = path.join(__dirname, '../config/AuthorizeToken.ini');
        const tokenData = `AccessToken=${token}`;
        fs.writeFileSync(tokenFilePath, tokenData);
        return true;
    } catch (error) {
        logger.error('Error writing token to file:', error);
        return false;
    }
}

// Helper function to refresh token
async function refreshToken(config, currentToken) {
    try {
        logger.info('Refreshing LHDN access token...');

        // Log the token refresh attempt
        await LoggingService.log({
            description: 'Attempting to refresh LHDN access token',
            logType: LOG_TYPES.INFO,
            module: MODULES.AUTH,
            action: ACTIONS.UPDATE,
            status: STATUS.PENDING
        });

        // Use URLSearchParams for form-encoded data as required by LHDN API
        const httpOptions = new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: 'client_credentials',
            scope: 'InvoicingAPI'
        });

        const response = await axios.post(
            `${config.baseUrl}/connect/token`,
            httpOptions,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        if (response.data && response.data.access_token) {
            const newToken = response.data.access_token;
            const expiresIn = response.data.expires_in || 3600; // Default to 1 hour if not provided

            // Write token to file
            writeTokenToFile(newToken);

            // Log successful token refresh
            await LoggingService.log({
                description: 'Successfully refreshed LHDN access token',
                logType: LOG_TYPES.INFO,
                module: MODULES.AUTH,
                action: ACTIONS.UPDATE,
                status: STATUS.SUCCESS,
                details: { expiresIn }
            });

            return {
                token: newToken,
                expiresIn: expiresIn
            };
        } else {
            throw new Error('Invalid token response from LHDN API');
        }
    } catch (error) {
        // Log token refresh failure
        await LoggingService.log({
            description: `Failed to refresh LHDN access token: ${error.message}`,
            logType: LOG_TYPES.ERROR,
            module: MODULES.AUTH,
            action: ACTIONS.UPDATE,
            status: STATUS.FAILED,
            details: { error: error.message }
        });

        throw error;
    }
}

// Token refresh middleware
const tokenRefreshMiddleware = async (req, res, next) => {
    try {
        // Skip if no user session
        if (!req.session || !req.session.user) {
            return next();
        }

        // Get current token and expiry time
        const currentToken = req.session.accessToken || readTokenFromFile();
        const tokenExpiryTime = req.session.tokenExpiryTime || 0;

        // Skip if no token
        if (!currentToken) {
            return next();
        }

        // Get LHDN config
        const config = await getLHDNConfig();

        // Skip if refresh is disabled
        if (!config.refreshTokenEnabled) {
            return next();
        }

        // Check if token is about to expire
        const now = Date.now();
        const timeUntilExpiry = tokenExpiryTime - now;

        // If token is about to expire, refresh it
        if (timeUntilExpiry < config.refreshThreshold) {
            logger.info(`Token will expire in ${Math.floor(timeUntilExpiry / 1000)} seconds, refreshing...`);

            try {
                const { token, expiresIn } = await refreshToken(config, currentToken);

                // Update session with new token
                req.session.accessToken = token;
                req.session.tokenExpiryTime = now + (expiresIn * 1000);

                logger.info('Token refreshed successfully');
            } catch (refreshError) {
                logger.error('Error refreshing token:', refreshError);
                // Continue with current token if refresh fails
            }
        }

        next();
    } catch (error) {
        logger.error('Error in token refresh middleware:', error);
        next();
    }
};

module.exports = tokenRefreshMiddleware;
