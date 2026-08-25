const axios = require('axios');
const prisma = require('../src/lib/prisma');
const fs = require('fs');
const path = require('path');
const ini = require('ini');

// Global token cache with expiry time
let globalTokenCache = {
  token: null,
  expiryTime: 0,
  safeExpiryTime: 0 // Add safe expiry time for proactive refresh
};

// Path to the AuthorizeToken.ini file
const AUTH_TOKEN_PATH = path.join(__dirname, '..', 'config', 'AuthorizeToken.ini');

/**
 * Get LHDN configuration from database
 */
async function getConfig() {
  try {
    const config = await prisma.wP_CONFIGURATION.findFirst({
      where: {
        Type: 'LHDN',
        IsActive: true
      },
      orderBy: {
        CreateTS: 'desc'
      }
    });

    if (!config) {
      throw new Error('LHDN configuration not found');
    }

    let settings = config.Settings;
    if (typeof settings === 'string') {
      try {
        settings = JSON.parse(settings);
      } catch (parseError) {
        console.error('Error parsing LHDN settings JSON:', parseError);
        throw new Error('Invalid LHDN configuration format');
      }
    }

    // Validate essential settings
    if (!settings || typeof settings !== 'object') {
      throw new Error('Invalid LHDN configuration structure');
    }

    // Validate required fields
    const requiredFields = ['clientId', 'clientSecret', 'middlewareUrl'];
    const missingFields = requiredFields.filter(field => !settings[field]);

    if (missingFields.length > 0) {
      console.warn(`LHDN configuration missing required fields: ${missingFields.join(', ')}`);
    }

    return settings;
  } catch (error) {
    console.error('Error getting LHDN configuration:', error);
    throw error;
  }
}

/**
 * Get token as taxpayer from LHDN
 */
async function getTokenAsTaxPayer() {
  try {
    // Get LHDN configuration
    let settings;
    try {
      settings = await getConfig();
      if (!settings) {
        throw new Error('LHDN configuration is empty or invalid');
      }
    } catch (configError) {
      console.error('Configuration error:', configError);
      throw new Error(`Failed to get LHDN configuration: ${configError.message}`);
    }

    // Validate and construct base URL
    const baseUrl = settings.environment === 'production' ?
      settings.middlewareUrl : settings.middlewareUrl;

    if (!baseUrl) {
      throw new Error(`Missing ${settings.environment === 'production' ? 'middlewareUrl' : 'middlewareUrl'} in configuration`);
    }

    // Check if client credentials are configured
    if (!settings.clientId || !settings.clientSecret) {
      throw new Error('Missing client credentials in LHDN configuration');
    }

    // Ensure URL is properly formatted
    let formattedBaseUrl = baseUrl.trim();
    if (!formattedBaseUrl.startsWith('http://') && !formattedBaseUrl.startsWith('https://')) {
      formattedBaseUrl = 'https://' + formattedBaseUrl;
    }
    formattedBaseUrl = formattedBaseUrl.replace(/\/+$/, ''); // Remove trailing slashes

    const httpOptions = new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      grant_type: 'client_credentials',
      scope: 'InvoicingAPI'
    });

    console.log(`Requesting token from: ${formattedBaseUrl}/connect/token`);

    try {
      const response = await axios.post(
        `${formattedBaseUrl}/connect/token`,
        httpOptions,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          validateStatus: status => status === 200,
          timeout: 10000 // 10 second timeout
        }
      );

      if(response.status === 200) {
        // Save token to AuthorizeToken.ini file
        saveTokenToFile(response.data);
        return response.data;
      }

      throw new Error(`Unexpected response: ${response.status}`);
    } catch (apiError) {
      // Handle API errors
      console.error('API error:', apiError.message);
      throw apiError;
    }
  } catch (err) {
    // Enhanced error message
    const errorMessage = err.message || 'Unknown token generation error';
    console.error('Token generation error:', {
      message: errorMessage,
      stack: err.stack
    });

    throw new Error(`Failed to get token: ${errorMessage}`);
  }
}

/**
 * Save token to AuthorizeToken.ini file
 */
function saveTokenToFile(tokenData) {
  try {
    const config = {
      Token: {
        access_token: tokenData.access_token,
        token_type: tokenData.token_type,
        expires_in: tokenData.expires_in,
        scope: tokenData.scope,
        timestamp: new Date().toISOString(),
        expiry_time: new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString()
      }
    };

    // Ensure directory exists
    const dir = path.dirname(AUTH_TOKEN_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write to file
    fs.writeFileSync(AUTH_TOKEN_PATH, ini.stringify(config));
    console.log('Token saved to AuthorizeToken.ini');
  } catch (error) {
    console.error('Error saving token to file:', error);
  }
}

/**
 * Read token from AuthorizeToken.ini file
 */
function readTokenFromFile() {
  try {
    console.log('[Token Service] Reading token from file:', AUTH_TOKEN_PATH);

    if (!fs.existsSync(AUTH_TOKEN_PATH)) {
      console.error('[Token Service] AuthorizeToken.ini file does not exist at path:', AUTH_TOKEN_PATH);
      return null;
    }

    const fileContent = fs.readFileSync(AUTH_TOKEN_PATH, 'utf-8');
    console.log('[Token Service] File content length:', fileContent.length);

    const config = ini.parse(fileContent);
    console.log('[Token Service] Parsed config:', Object.keys(config));

    if (!config.Token) {
      console.error('[Token Service] No Token section found in AuthorizeToken.ini');
      return null;
    }

    if (!config.Token.access_token) {
      console.error('[Token Service] No access_token found in Token section');
      return null;
    }

    if (!config.Token.expiry_time) {
      console.error('[Token Service] No expiry_time found in Token section');
      return null;
    }

    const expiryTime = new Date(config.Token.expiry_time).getTime();
    const now = Date.now();
    console.log('[Token Service] Token expiry time:', new Date(expiryTime).toISOString());
    console.log('[Token Service] Current time:', new Date(now).toISOString());
    console.log('[Token Service] Time until expiry:', Math.round((expiryTime - now) / 1000), 'seconds');

    if (expiryTime <= now) {
      console.error('[Token Service] Token has expired');
      return null; // Token expired
    }

    console.log('[Token Service] Valid token found in file');
    return {
      access_token: config.Token.access_token,
      token_type: config.Token.token_type,
      expires_in: config.Token.expires_in,
      scope: config.Token.scope,
      expiry_time: expiryTime
    };
  } catch (error) {
    console.error('[Token Service] Error reading token from file:', error);
    return null;
  }
}

/**
 * Get token session - uses caching and file storage
 */
async function getTokenSession() {
  try {
    console.log('[Token Service] getTokenSession called');
    const now = Date.now();
    const bufferTime = 5 * 60 * 1000; // 5 minutes buffer

    // 1. Check in-memory cache first
    if (globalTokenCache.token && globalTokenCache.safeExpiryTime > now) {
      console.log('[Token Service] Using existing token from in-memory cache (expires in',
        Math.round((globalTokenCache.expiryTime - now) / 1000), 'seconds)');
      return globalTokenCache.token;
    }

    console.log('[Token Service] In-memory cache expired or empty. Checking file...');

    // 2. Check file for the latest valid token
    const fileToken = readTokenFromFile();
    console.log('[Token Service] File token result:', fileToken ? 'Token found' : 'No token found');

    if (fileToken) {
      const fileTokenExpiryTime = new Date(fileToken.expiry_time).getTime();
      const timeUntilExpiry = Math.round((fileTokenExpiryTime - now) / 1000);
      const timeUntilSafeExpiry = Math.round((fileTokenExpiryTime - (now + bufferTime)) / 1000);

      console.log('[Token Service] File token expiry details:');
      console.log('  - Expiry time:', new Date(fileTokenExpiryTime).toISOString());
      console.log('  - Time until expiry:', timeUntilExpiry, 'seconds');
      console.log('  - Time until safe expiry:', timeUntilSafeExpiry, 'seconds');
      console.log('  - Is valid for use:', (fileTokenExpiryTime > (now + bufferTime)) ? 'Yes' : 'No');

      if (fileTokenExpiryTime > (now + bufferTime)) {
        console.log('[Token Service] Using existing token from file (expires in', timeUntilExpiry, 'seconds)');

        // Populate in-memory cache from file
        globalTokenCache.token = fileToken.access_token;
        globalTokenCache.expiryTime = fileTokenExpiryTime;
        globalTokenCache.safeExpiryTime = globalTokenCache.expiryTime - bufferTime;

        // Log token details (first 10 chars only for security)
        const tokenPreview = fileToken.access_token.substring(0, 10) + '...';
        console.log('[Token Service] Token from file (preview):', tokenPreview);

        return globalTokenCache.token;
      }
    }

    console.log('[Token Service] No valid token in cache or file. Generating a new one...');

    // 3. Get a new token if needed
    const tokenData = await getTokenAsTaxPayer();
    console.log('[Token Service] Token generation result:', tokenData ? 'Success' : 'Failed');

    if (!tokenData || !tokenData.access_token) {
      console.error('[Token Service] Failed to obtain access token: Empty response or missing access_token');
      throw new Error('Failed to obtain access token');
    }

    const newToken = tokenData.access_token;
    const newExpiryTime = now + (tokenData.expires_in * 1000);

    // Log token details (first 10 chars only for security)
    const tokenPreview = newToken.substring(0, 10) + '...';
    console.log('[Token Service] New token generated (preview):', tokenPreview);
    console.log('[Token Service] New token expiry:', new Date(newExpiryTime).toISOString());

    // 4. Store in in-memory cache
    globalTokenCache.token = newToken;
    globalTokenCache.expiryTime = newExpiryTime;
    globalTokenCache.safeExpiryTime = newExpiryTime - bufferTime;
    console.log('[Token Service] New token stored in in-memory cache.');

    // 5. Save to database for historical purposes
    try {
      await prisma.lHDN_TOKENS.create({
        data: {
          access_token: newToken,
          expiry_time: new Date(newExpiryTime)
        }
      });
      console.log('[Token Service] New token successfully saved to database.');
    } catch (dbError) {
      console.error('[Token Service] Error saving new token to database:', dbError);
      // Continue even if database save fails
    }

    console.log('[Token Service] New token generated and stored (expires in',
      Math.round(tokenData.expires_in), 'seconds)');

    return newToken;
  } catch (error) {
    console.error('[Token Service] Error getting token session:', error);
    // If token acquisition fails, clear any potentially invalid cached token
    globalTokenCache = { token: null, expiryTime: 0, safeExpiryTime: 0 };
    throw error; // Re-throwing to indicate failure
  }
}

module.exports = {
  getTokenAsTaxPayer,
  getTokenSession,
  readTokenFromFile,
  saveTokenToFile
};
