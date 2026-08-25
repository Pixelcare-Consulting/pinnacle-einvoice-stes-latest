const express = require('express');
const router = express.Router();
const axios = require('axios');
const NodeCache = require('node-cache'); // Change to NodeCache
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const jsrender = require('jsrender');
const puppeteer = require('puppeteer');
const QRCode = require('qrcode');
const { logger, apiLogger, versionLogger } = require('../../utils/logger');
const { getUnitType } = require('../../utils/UOM');
const { getInvoiceTypes } = require('../../utils/EInvoiceTypes');
const axiosRetry = require('axios-retry');
const moment = require('moment');
const { parseStringPromise, processors } = require('xml2js');
// Removed Sequelize import as we're using Prisma

// Initialize cache with 5 minutes standard TTL
const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes in seconds

// Database models
const prisma = require('../../src/lib/prisma');
const { LoggingService, LOG_TYPES, MODULES, ACTIONS, STATUS } = require('../../services/logging-prisma.service');

// Helper function for delays
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to map invoice type names to codes
const getInvoiceTypeCode = (typeName) => {
    const typeMapping = {
        'Invoice': '01',
        'Credit Note': '02',
        'Debit Note': '03',
        'Refund Note': '04',
        'Self-billed Invoice': '11',
        'Self-billed Credit Note': '12',
        'Self-billed Debit Note': '13',
        'Self-billed Refund Note': '14'
    };

    // If typeName already starts with a valid code (e.g. "01 - Invoice"), extract it
    const codeMatch = typeName?.match(/^(0[1-4]|1[1-4])/);
    if (codeMatch) {
        return codeMatch[1];
    }

    // Otherwise look up the code from the mapping
    return typeMapping[typeName] || '01'; // Default to '01' if not found
};

// Extract DocumentCurrencyCode from a parsed UBL/JSON Invoice node (same source as PDF).
function getDocCurrencyFromInvoice(invoice) {
    if (!invoice || typeof invoice !== 'object') return null;
    const arr = invoice.DocumentCurrencyCode;
    if (!Array.isArray(arr) || !arr.length) return null;
    const v = arr[0];
    return (v && typeof v === 'object' && v._ != null) ? v._ : (typeof v === 'string' ? v : null);
}

// Extract DocumentCurrencyCode from raw document string (UBL XML or JSON). Used to backfill WP_Inbound_Status.documentCurrency.
async function extractDocumentCurrencyFromRaw(docStr) {
    if (typeof docStr !== 'string' || !docStr.trim()) return null;
    const s = docStr.trim();
    try {
        if (s.startsWith('<')) {
            const parsed = await parseStringPromise(docStr, { explicitArray: true, tagNameProcessors: [processors.stripPrefix] });
            const find = (p) => {
                if (!p || typeof p !== 'object') return null;
                for (const k of Object.keys(p)) {
                    const local = (k && k.includes(':')) ? k.split(':').pop() : k;
                    if (local === 'Invoice') {
                        const v = p[k];
                        return (Array.isArray(v) && v.length) ? v[0] : (v && typeof v === 'object' ? v : null);
                    }
                }
                const keys = Object.keys(p);
                if (keys.length === 1) {
                    const v = p[keys[0]];
                    const child = (Array.isArray(v) && v.length) ? v[0] : v;
                    if (child && typeof child === 'object') return find(child);
                }
                return null;
            };
            const inv = find(parsed);
            return inv ? getDocCurrencyFromInvoice(inv) : null;
        }
        if (s.startsWith('{')) {
            const o = JSON.parse(docStr);
            const inv = o?.Invoice?.[0] || o?.invoice?.[0];
            return inv ? getDocCurrencyFromInvoice(inv) : null;
        }
    } catch (e) { /* ignore */ }
    return null;
}

// Persist documentCurrency to WP_Inbound_Status when currently null (fire-and-forget). Use when we obtain currency from UBL (PDF, display-details, or document list).
function persistDocumentCurrencyIfNull(uuid, documentCurrency) {
    if (!uuid || !documentCurrency) return;
    prisma.wP_INBOUND_STATUS.updateMany({
        where: { uuid, documentCurrency: null },
        data: { documentCurrency }
    }).catch(() => {});
}

// Pinnacle-only inbound: hide docs where we are issuer but submitted via another portal (uuid not in WP_OUTBOUND_STATUS). Receiver docs always shown.
// WP_ADMIN_SETTINGS.InboundPinnacleOnly = "0" disables; "1" or missing = on.
async function filterPinnacleOnlyInbound(documents, req) {
    if (!documents?.length || !req) return documents;
    try {
        const setting = await prisma.wP_ADMIN_SETTINGS.findFirst({
            where: { SettingKey: 'InboundPinnacleOnly' },
            select: { SettingValue: true }
        });
        if (setting && String(setting.SettingValue || '').trim() === '0') return documents;
    } catch (e) { /* if table or row missing, treat as on */ }
    let ourTins = [req.session?.user?.TIN].filter(Boolean);
    if (!ourTins.length) {
        const r = await prisma.wP_USER_REGISTRATION.findFirst({
            where: { ValidStatus: '1' },
            select: { TIN: true }
        });
        ourTins = [r?.TIN].filter(Boolean);
    }
    if (!ourTins.length) return documents;
    const outboundRows = await prisma.wP_OUTBOUND_STATUS.findMany({
        where: { UUID: { not: null } },
        select: { UUID: true }
    });
    const outboundUuids = new Set(outboundRows.map(r => r.UUID));
    return documents.filter(doc => {
        const issuerTin = String(doc.issuerTin || doc.supplierTin || doc.issuerTIN || '').trim();
        const isOurIssuer = ourTins.some(t => String(t || '').trim() === issuerTin);
        if (!isOurIssuer) return true;
        return outboundUuids.has(doc.uuid);
    });
}

// Enhanced delay function with exponential backoff
const calculateBackoff = (retryCount, baseDelay = 1000, maxDelay = 60000) => {
    const backoff = Math.min(maxDelay, baseDelay * Math.pow(2, retryCount));
    const jitter = Math.random() * 1000; // Add some randomness to prevent thundering herd
    return backoff + jitter;
};

// Helper function to handle authentication errors
const handleAuthError = (req, res) => {
    // Clear session
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
        }
    });

    // Return error response with redirect flag
    return res.status(401).json({
        success: false,
        message: 'Authentication failed. Please log in again.',
        redirect: '/login'
    });
};

const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    trustProxy: false, // Disable trust proxy
    keyGenerator: function (req) {
        // Use session ID or user ID if available, fallback to IP
        return req.session?.user?.id || req.ip;
    },
    handler: function (req, res) {
        return res.status(429).json({
            success: false,
            message: 'Too many requests. Please try again later.',
            retryAfter: req.rateLimit.resetTime - Date.now()
        });
    }
});


axiosRetry.default(axios, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
               error.response?.status === 429;
    }
});

// Document retrieval limitations
const getDocumentRetrievalLimits = () => {
    return {
        maxDocuments: 10000, // Maximum number of documents that can be returned
        timeWindowDays: 30,  // Time window in days for document retrieval
        validateTimeWindow: (dateTimeIssued) => {
            if (!dateTimeIssued) return false;
            const currentDate = new Date();
            const documentDate = new Date(dateTimeIssued);
            const diffTime = Math.abs(currentDate - documentDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays <= 30; // Only allow documents within last 30 days
        }
    };
};

// Helper function to get LHDN config
async function getLHDNConfig() {
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

    // Enhanced timeout configuration with reasonable defaults
    const defaultTimeout = 60000; // 60 seconds default
    const minTimeout = 30000;    // 30 seconds minimum
    const maxTimeout = 300000;   // 5 minutes maximum

    let timeout = parseInt(settings.timeout) || defaultTimeout;
    timeout = Math.min(Math.max(timeout, minTimeout), maxTimeout);

    return {
        baseUrl,
        environment: settings.environment,
        timeout: timeout,
        retryEnabled: settings.retryEnabled !== false, // Enable retries by default
        maxRetries: settings.maxRetries || 5,
        retryDelay: settings.retryDelay || 1000, // Base delay for exponential backoff
        maxRetryDelay: settings.maxRetryDelay || 60000 // Maximum retry delay
    };
}

// Helper function to get portal URL based on environment
function getPortalUrl(environment) {
    const portalUrls = {
        production: 'myinvois.hasil.gov.my',
        sandbox: 'preprod.myinvois.hasil.gov.my'
    };

    return portalUrls[environment] || portalUrls.sandbox; // Default to sandbox if environment not specified
}

// Enhanced document fetching function with smart caching
const fetchRecentDocuments = async (req) => {
    console.log('Starting enhanced document fetch process...');

    try {
        // Get LHDN configuration
        const lhdnConfig = await getLHDNConfig();
        console.log('Using LHDN configuration:', {
            environment: lhdnConfig.environment,
            baseUrl: lhdnConfig.baseUrl,
            timeout: lhdnConfig.timeout
        });

        // First, check if we have data in the database
        const dbDocuments = await prisma.wP_INBOUND_STATUS.findMany({
            orderBy: {
                dateTimeReceived: 'desc'
            },
            take: 1000 // Limit to latest 1000 records
        });

        // If we have database records, use them as the initial data source
        if (dbDocuments && dbDocuments.length > 0) {
            console.log(`Found ${dbDocuments.length} documents in database`);

            // Check if we need to refresh from API
            const lastSyncedDocument = await prisma.wP_INBOUND_STATUS.findFirst({
                orderBy: {
                    last_sync_date: 'desc'
                },
                select: {
                    last_sync_date: true
                }
            });

            const currentTime = new Date();
            const syncThreshold = 15 * 60 * 1000; // 15 minutes in milliseconds
            const forceRefresh = req.query.forceRefresh === 'true';

            // Only fetch from API if forced or if last sync is older than threshold
            if (!forceRefresh && lastSyncedDocument && lastSyncedDocument.last_sync_date) {
                const timeSinceLastSync = currentTime - new Date(lastSyncedDocument.last_sync_date);
                if (timeSinceLastSync < syncThreshold) {
                    console.log('Using database records - last sync was', Math.round(timeSinceLastSync/1000/60), 'minutes ago');
                    return {
                        result: dbDocuments,
                        cached: true,
                        fromDatabase: true
                    };
                }
            }

            // If we're here, we need to refresh from API but still have DB records as fallback
            console.log('Database records exist but need refresh from API');
        } else {
            console.log('No documents found in database, will fetch from API');
        }

        // Attempt to fetch from API
        try {
            console.log('Fetching fresh data from LHDN API...');
            const documents = [];
            let pageNo = 1;
            const pageSize = 100; // MyInvois recommended page size
            let hasMorePages = true;
            let consecutiveErrors = 0;
            const maxConsecutiveErrors = 3;

            // Track rate limiting
            let rateLimitRemaining = null;
            let rateLimitReset = null;

            while (hasMorePages) {
                let retryCount = 0;
                let success = false;

                while (!success && retryCount < lhdnConfig.maxRetries) {
                    try {
                        // Check rate limit before making request
                        if (rateLimitRemaining !== null && rateLimitRemaining <= 0) {
                            const waitTime = (new Date(rateLimitReset).getTime() - Date.now()) + 1000; // Add 1s buffer
                            if (waitTime > 0) {
                                console.log(`Rate limit reached. Waiting ${Math.round(waitTime/1000)}s before continuing...`);
                                await delay(waitTime);
                            }
                        }

                        // Get token from session (which should now have the token from file)
                        let token = req.session?.accessToken;

                        // If no token in session, try to get directly from file
                        if (!token) {
                            console.log('No token in session, trying to get from file directly');
                            token = await readTokenFromFile();
                        }

                        // If still no token, throw error
                        if (!token) {
                            console.error('No valid access token found in session or file');
                            throw new Error('No valid access token found');
                        }

                        console.log('Using token for LHDN API request');

                        const response = await axios.get(
                            `${lhdnConfig.baseUrl}/api/v1.0/documents/recent`,
                            {
                                params: {
                                    pageNo: pageNo,
                                    pageSize: pageSize,
                                    sortBy: 'dateTimeValidated',
                                    sortOrder: 'desc'
                                },
                                headers: {
                                    'Authorization': `Bearer ${token}`,
                                    'Accept': 'application/json',
                                    'Content-Type': 'application/json'
                                },
                                timeout: lhdnConfig.timeout
                            }
                        );

                        // Update rate limit tracking from headers
                        rateLimitRemaining = parseInt(response.headers['x-rate-limit-remaining'] || '-1');
                        rateLimitReset = response.headers['x-rate-limit-reset'];

                        // Handle pagination
                        const { result, pagination } = response.data;

                        if (!result || result.length === 0) {
                            console.log(`No more documents found after page ${pageNo-1}`);
                            hasMorePages = false;
                            break;
                        }

                        // [Trace] LHDN API first doc - see if documentCurrencyCode / DocumentCurrencyCode exist
                        if (pageNo === 1 && result[0]) {
                            const d = result[0];
                            console.log('[fetchRecentDocuments] LHDN API first doc - all keys:', Object.keys(d).sort().join(', '));
                            console.log('[fetchRecentDocuments] LHDN API first doc - currency fields:', { documentCurrencyCode: d.documentCurrencyCode, documentCurrency: d.documentCurrency, currencyCode: d.currencyCode, currency: d.currency, DocumentCurrencyCode: d.DocumentCurrencyCode });
                        }

                        // Map the required fields from the API response - IMPORTANT: follow MyInvois API structure
                        const mappedDocuments = result.map(doc => ({
                            ...doc,
                            // Map issuerTin or supplierTin to issuerTin
                            issuerTin: doc.issuerTin || doc.supplierTin || null,

                            // Map issuerName or supplierName to issuerName
                            issuerName: doc.issuerName || doc.supplierName || null,

                            // Map receiverId or buyerTin to receiverId
                            receiverId: doc.receiverId || doc.buyerTin || doc.buyerTIN || null,

                            // Map receiverName or buyerName to receiverName
                            receiverName: doc.receiverName || doc.buyerName || null,

                            // Map receiverTIN or buyerTIN to receiverTIN
                            receiverTIN: doc.receiverTIN || doc.buyerTIN || null,

                            receiverRegistrationNo: doc.receiverRegistrationNo || doc.buyerRegistrationNo || null,
                            receiverAddress: doc.receiverAddress || doc.buyerAddress || null,
                            receiverPostcode: doc.receiverPostcode || doc.buyerPostcode || null,
                            receiverCity: doc.receiverCity || doc.buyerCity || null,
                            receiverState: doc.receiverState || doc.buyerState || null,
                            receiverCountry: doc.receiverCountry || doc.buyerCountry || null,
                            receiverPhone: doc.receiverPhone || doc.buyerPhone || null,

                            uuid: doc.uuid,
                            submissionUid: doc.submissionUid,
                            longId: doc.longId,
                            internalId: doc.internalId,
                            typeName: doc.typeName,
                            typeVersionName: doc.typeVersionName,
                            dateTimeReceived: doc.dateTimeReceived,
                            dateTimeIssued: doc.dateTimeIssued,
                            dateTimeValidated: doc.dateTimeValidated,
                            status: doc.status,
                            documentStatusReason: doc.documentStatusReason,
                            totalSales: doc.totalSales || doc.total || doc.netAmount || 0,
                            totalExcludingTax: doc.totalExcludingTax || 0,
                            totalDiscount: doc.totalDiscount || 0,
                            totalNetAmount: doc.totalNetAmount || doc.netAmount || 0,
                            totalPayableAmount: doc.totalPayableAmount || doc.total || 0,
                            documentCurrencyCode: doc.documentCurrencyCode || doc.documentCurrency || doc.currencyCode || doc.currency || null
                        }));

                        console.log(`Mapped ${mappedDocuments.length} documents from API response`);
                        documents.push(...mappedDocuments);
                        console.log(`Successfully fetched page ${pageNo} with ${mappedDocuments.length} documents`);

                        // Check if we have more pages based on pagination info
                        if (pagination) {
                            hasMorePages = pageNo < pagination.totalPages;
                        } else {
                            hasMorePages = result.length === pageSize;
                        }

                        // Reset consecutive errors counter on success
                        consecutiveErrors = 0;
                        success = true;
                        pageNo++;

                        // LHDN Get Recent Documents: 12 RPM; use 5s between pages to stay within limit
                        if (hasMorePages) {
                            await delay(5000);
                        }

                    } catch (error) {
                        retryCount++;
                        console.error(`Error fetching page ${pageNo}:`, error.message);

                        // Handle authentication errors
                        if (error.response?.status === 401 || error.response?.status === 403) {
                            console.error('Authentication error detected:', error.message);

                            // Try to refresh token first
                            try {
                                console.log('Attempting to refresh token...');

                                // Try to get token from file using our enhanced function
                                const fileToken = await readTokenFromFile();

                                if (fileToken) {
                                    // If file token is different from session token, try using it
                                    if (fileToken !== req.session.accessToken) {
                                        console.log('Found different token in file, trying it...');
                                        req.session.accessToken = fileToken;
                                        retryCount--; // Don't count this as a retry
                                        continue;
                                    }
                                }

                                // If file token didn't work, try to get a fresh token
                                try {
                                    console.log('Attempting to get a fresh token...');
                                    const { getTokenSession } = require('../../services/token-prisma.service');
                                    const freshToken = await getTokenSession();

                                    if (freshToken) {
                                        console.log('Successfully obtained fresh token');
                                        req.session.accessToken = freshToken;
                                        retryCount--; // Don't count this as a retry
                                        continue;
                                    }
                                } catch (tokenError) {
                                    console.error('Error getting fresh token:', tokenError);
                                }

                                // If we couldn't refresh the token, throw authentication error
                                throw new Error('Authentication failed. Please log in again.');
                            } catch (refreshError) {
                                console.error('Token refresh failed:', refreshError.message);
                                throw new Error('Authentication failed. Please log in again.');
                            }
                        }

                        // Handle rate limiting
                        if (error.response?.status === 429) {
                            const resetTime = error.response.headers["x-rate-limit-reset"];
                            rateLimitRemaining = 0;
                            rateLimitReset = resetTime;

                            const waitTime = new Date(resetTime).getTime() - Date.now();
                            if (waitTime > 0) {
                                console.log(`Rate limited. Waiting ${Math.round(waitTime/1000)}s before retry...`);
                                await delay(waitTime);
                                retryCount--; // Don't count rate limit retries
                                continue;
                            }
                        }

                        // Track consecutive errors
                        if (retryCount >= lhdnConfig.maxRetries) {
                            consecutiveErrors++;
                            if (consecutiveErrors >= maxConsecutiveErrors) {
                                console.error(`Max consecutive errors (${maxConsecutiveErrors}) reached. Stopping fetch.`);
                                hasMorePages = false;
                                break;
                            }
                            console.log(`Moving to next page after max retries for page ${pageNo}`);
                            pageNo++;
                            break;
                        }

                        // Exponential backoff for other errors
                        const backoffDelay = Math.min(
                            lhdnConfig.maxRetryDelay,
                            lhdnConfig.retryDelay * Math.pow(2, retryCount)
                        );
                        console.log(`Retrying page ${pageNo} after ${backoffDelay/1000}s delay (attempt ${retryCount + 1}/${lhdnConfig.maxRetries})...`);
                        await delay(backoffDelay);
                    }
                }

                if (!success && consecutiveErrors >= maxConsecutiveErrors) {
                    hasMorePages = false;
                }
            }

            if (documents.length === 0) {
                throw new Error('No documents could be fetched from the API');
            }

            const filtered = await filterPinnacleOnlyInbound(documents, req);
            console.log(`Fetch complete. Total documents retrieved: ${filtered.length}`);

            // Save the fetched documents to database
            await saveInboundStatus({ result: filtered }, req);

            // If we have submission UIDs, poll their status
            const uniqueSubmissionUids = [...new Set(filtered.map(doc => doc.submissionUid).filter(Boolean))];
            if (uniqueSubmissionUids.length > 0) {
                console.log(`Found ${uniqueSubmissionUids.length} unique submission UIDs to poll`);

                // Poll each submission in sequence to avoid rate limiting
                for (const submissionUid of uniqueSubmissionUids) {
                    try {
                        console.log(`Polling submission status for: ${submissionUid}`);
                        await pollSubmissionStatus(submissionUid, 5); // Limit to 5 attempts for background polling
                    } catch (pollError) {
                        console.error(`Error polling submission ${submissionUid}:`, pollError);
                        // Continue with next submission even if this one fails
                    }

                    // Add a small delay between submissions to avoid rate limiting
                    await delay(1000);
                }
            }

            // Log successful document fetch
            await LoggingService.log({
                description: `Successfully fetched ${filtered.length} documents from LHDN`,
                username: req?.session?.user?.username || 'System',
                userId: req?.session?.user?.id,
                ipAddress: req?.ip,
                logType: LOG_TYPES.INFO,
                module: MODULES.API,
                action: ACTIONS.READ,
                status: STATUS.SUCCESS,
                details: { count: filtered.length }
            });

            return {
                result: filtered,
                cached: false,
                fromApi: true
            };
        } catch (error) {
            console.error('Error fetching from LHDN API:', error.message);

            // Log the error
            await LoggingService.log({
                description: `Error fetching documents from LHDN: ${error.message}`,
                username: req?.session?.user?.username || 'System',
                userId: req?.session?.user?.id,
                ipAddress: req?.ip,
                logType: LOG_TYPES.ERROR,
                module: MODULES.API,
                action: ACTIONS.READ,
                status: STATUS.FAILED,
                details: { error: error.message }
            });

            // If we have database records, use them as fallback
            if (dbDocuments && dbDocuments.length > 0) {
                console.log(`Using ${dbDocuments.length} database records as fallback`);
                const filtered = await filterPinnacleOnlyInbound(dbDocuments, req);
                return {
                    result: filtered,
                    cached: true,
                    fromDatabase: true,
                    fallback: true,
                    error: error.message
                };
            }

            // If no database records, rethrow the error
            throw error;
        }
    } catch (error) {
        console.error('Error in document fetch:', error);
        return {
            success: false,
            message: `Error fetching documents: ${error.message}`,
            error: error
        };
    }
};
// Enhanced caching function with better error handling
async function getCachedDocuments(req) {
    const cacheKey = `recentDocuments_${req.session?.user?.TIN || 'default'}`;
    const forceRefresh = req.query.forceRefresh === 'true';
    const useDatabase = req.query.useDatabase === 'true';

    // Get from cache if not forcing refresh
    let data = forceRefresh ? null : cache.get(cacheKey);

    if (!data) {
        try {
            // If useDatabase is true and we're not forcing refresh, try to get from database first
            if (useDatabase && !forceRefresh) {
                try {
                    console.log('Using database as primary data source due to useDatabase parameter');
                    // Get documents from database
                    const dbDocuments = await prisma.wP_INBOUND_STATUS.findMany({
                        orderBy: {
                            dateTimeReceived: 'desc'
                        },
                        take: 1000 // Limit to latest 1000 records
                    });

                    if (dbDocuments && dbDocuments.length > 0) {
                        console.log(`Found ${dbDocuments.length} documents in database`);
                        const filtered = await filterPinnacleOnlyInbound(dbDocuments, req);
                        data = {
                            result: filtered,
                            cached: false,
                            fromDatabase: true,
                            fromApi: false,
                            timestamp: new Date().toISOString()
                        };

                        // Store in cache with shorter TTL for database data
                        cache.set(cacheKey, data, 300); // 5 minutes
                        console.log('Cached database documents for 5 minutes');

                        // Try to fetch from API in the background to update the database
                        try {
                            console.log('Fetching from API in background to update database');
                            fetchRecentDocuments(req).catch(apiError => {
                                console.warn('Background API fetch failed:', apiError.message);
                            });
                        } catch (backgroundError) {
                            console.warn('Error starting background fetch:', backgroundError);
                        }

                        return data;
                    }
                } catch (dbError) {
                    console.error('Error getting documents from database:', dbError);
                    // Continue to API fetch if database fetch fails
                }
            }

            // If not using database or database fetch failed, fetch from API
            data = await fetchRecentDocuments(req);

            // Only cache successful results
            if (data && data.result && data.result.length > 0) {
                // Store in cache with appropriate TTL based on source
                const cacheTTL = data.fromApi ? 900 : 300; // 15 minutes for API data, 5 minutes for DB data
                cache.set(cacheKey, data, cacheTTL);
                console.log(`${forceRefresh ? 'Force refreshed' : 'Fetched'} documents and cached for ${cacheTTL} seconds`);
            }
        } catch (error) {
            console.error('Error in getCachedDocuments:', error);

            // Check if it's an authentication error
            if (error.message?.includes('Authentication failed')) {
                // Log authentication error
                await LoggingService.log({
                    description: `Authentication error in getCachedDocuments: ${error.message}`,
                    username: req.session?.user?.username || 'System',
                    userId: req.session?.user?.id,
                    ipAddress: req.ip,
                    logType: LOG_TYPES.ERROR,
                    module: MODULES.AUTH,
                    action: ACTIONS.READ,
                    status: STATUS.FAILED,
                    details: { error: error.message }
                });

                // Try to refresh token
                try {
                    // Get token from file using our enhanced function
                    const fileToken = await readTokenFromFile();

                    if (fileToken) {
                        // Update session with token from file
                        if (req.session) {
                            req.session.accessToken = fileToken;
                            console.log('Updated session with token from file');

                            // Try fetching again with new token
                            try {
                                data = await fetchRecentDocuments(req);
                                if (data && data.result && data.result.length > 0) {
                                    cache.set(cacheKey, data, 900); // 15 minutes
                                    console.log('Successfully fetched data with refreshed token');
                                }
                            } catch (retryError) {
                                console.error('Retry with refreshed token failed:', retryError);
                            }
                        }
                    } else {
                        // If no token in file, try to get a fresh one
                        try {
                            console.log('No token in file, attempting to get a fresh token');
                            const { getTokenSession } = require('../../services/token-prisma.service');
                            const freshToken = await getTokenSession();

                            if (freshToken && req.session) {
                                req.session.accessToken = freshToken;
                                console.log('Updated session with fresh token');

                                // Try fetching again with fresh token
                                try {
                                    data = await fetchRecentDocuments(req);
                                    if (data && data.result && data.result.length > 0) {
                                        cache.set(cacheKey, data, 900); // 15 minutes
                                        console.log('Successfully fetched data with fresh token');
                                    }
                                } catch (retryError) {
                                    console.error('Retry with fresh token failed:', retryError);
                                }
                            }
                        } catch (tokenError) {
                            console.error('Error getting fresh token:', tokenError);
                        }
                    }
                } catch (tokenError) {
                    console.error('Error refreshing token from file:', tokenError);
                }
            }

            // If we still don't have data, try database fallback
            if (!data || !data.result || data.result.length === 0) {
                try {
                    console.log('Attempting final fallback to database...');
                    const fallbackDocuments = await prisma.wP_INBOUND_STATUS.findMany({
                        orderBy: {
                            dateTimeReceived: 'desc'
                        },
                        take: 1000
                    });

                    if (fallbackDocuments && fallbackDocuments.length > 0) {
                        console.log(`Using ${fallbackDocuments.length} database records as final fallback`);
                        const filtered = await filterPinnacleOnlyInbound(fallbackDocuments, req);
                        data = {
                            result: filtered,
                            cached: false,
                            fromDatabase: true,
                            fallback: true,
                            error: error.message
                        };

                        // Cache fallback data for a shorter period
                        cache.set(cacheKey, data, 120); // 2 minutes
                    } else {
                        throw new Error('No documents found in database');
                    }
                } catch (dbError) {
                    console.error('Database fallback also failed:', dbError);
                    throw error; // Rethrow the original error
                }
            }
        }
    } else {
        console.log(`Using cached data (${data.result?.length || 0} documents)`);
    }

    return data;
}

const generateTemplateHash = (templateData) => {
    const crypto = require('crypto');
    // Create a string of key data that should trigger regeneration when changed
    const keyData = JSON.stringify({
        logo: templateData.CompanyLogo,
        companyInfo: {
            name: templateData.companyName,
            address: templateData.companyAddress,
            phone: templateData.companyPhone,
            email: templateData.companyEmail
        },
        documentInfo: {
            type: templateData.InvoiceType,
            code: templateData.InvoiceCode,
            uuid: templateData.UniqueIdentifier
        },
        items: templateData.items,
        totals: {
            subtotal: templateData.Subtotal,
            tax: templateData.TotalTaxAmount,
            total: templateData.TotalPayableAmount
        }
    });
    return crypto.createHash('md5').update(keyData).digest('hex');
};

// Helper function to generate JSON response file
const generateResponseFile = async (item, req = null) => {
    try {
        // Get username from session if available
        const username = req?.session?.user?.username || 'System';
        // Only generate for valid documents with required fields
        if (!item.uuid || !item.submissionUid || !item.longId || item.status !== 'Valid') {
            console.log(`Skipping response file generation for ${item.uuid}: missing required fields or invalid status`);
            return { success: false, message: 'Skipped: Missing required fields or invalid status' };
        }

         // Get LHDN configuration
        const lhdnConfig = await getLHDNConfig();

        // Get outgoing path configuration using Prisma
        const outgoingConfig = await prisma.wP_CONFIGURATION.findFirst({
            where: {
                Type: 'OUTGOING',
                IsActive: true
            },
            orderBy: {
                CreateTS: 'desc'
            }
        });

        if (!outgoingConfig || !outgoingConfig.Settings) {
            console.log(`No outgoing path configuration found, skipping response file generation for ${item.uuid}`);
            return { success: false, message: 'No outgoing path configuration found' };
        }

        let settings = typeof outgoingConfig.Settings === 'string'
            ? JSON.parse(outgoingConfig.Settings)
            : outgoingConfig.Settings;

        if (!settings.networkPath) {
            console.log(`No network path configured in outgoing settings for ${item.uuid}`);
            return { success: false, message: 'No network path configured' };
        }

        // Try to get user registration details
        const userRegistration = await prisma.wP_USER_REGISTRATION.findFirst({
            where: { ValidStatus: '1' }, // ValidStatus is a CHAR(1) field, not a boolean
            orderBy: {
                CreateTS: 'desc'
            }
        });

        if (!userRegistration || !userRegistration.TIN) {
            console.log(`No active user registration found with TIN`);
            return { success: false, message: 'No active user registration found' };
        }

        // Try to get company settings based on user's TIN
        let companySettings = await prisma.wP_COMPANY_SETTINGS.findFirst({
            where: { TIN: userRegistration.TIN }
        });

        // If no company settings found with user's TIN, try with document TINs
        if (!companySettings) {
            console.log(`No company settings found for user TIN: ${userRegistration.TIN}, trying document TINs`);

            // Check if the document's issuerTin or receiverId matches any company settings
            if (item.issuerTin === userRegistration.TIN || item.receiverId === userRegistration.TIN) {
                companySettings = await prisma.wP_COMPANY_SETTINGS.findFirst({
                    where: {
                        TIN: {
                            in: [item.issuerTin, item.receiverId].filter(Boolean)
                        }
                    }
                });
            }
        }

        if (!companySettings) {
            console.log(`No matching company settings found for TINs: User(${userRegistration.TIN}), Issuer(${item.issuerTin}), Receiver(${item.receiverId})`);
            return { success: false, message: 'No matching company settings found' };
        }

        // Set company name from settings
        const companyName = companySettings.CompanyName;

        // Get document details from outbound status using Prisma
        // Note: UUID is not a unique field, so we need to use findFirst instead of findUnique
        const outboundDoc = await prisma.wP_OUTBOUND_STATUS.findFirst({
            where: { UUID: item.uuid }
        });

        let type, company, date;
        let invoiceTypeCode = "01"; // Default invoice type code
        let invoiceNo = item.internalId || "";

        // Define sanitization function early so we can use it for all path components and IDs
        const sanitizePath = (str) => {
            if (!str) return '';
            // Replace all characters that are problematic in file paths
            return String(str).replace(/[<>:"/\\|?*]/g, '_');
        };

        // Sanitize the invoiceNo immediately
        invoiceNo = sanitizePath(invoiceNo);

        // Always try to get inbound data first using Prisma
        const inboundDoc = await prisma.wP_INBOUND_STATUS.findUnique({
            where: { uuid: item.uuid }
        });

        if (inboundDoc) {
            // Use the helper function to get invoice type code from typeName
            invoiceTypeCode = getInvoiceTypeCode(inboundDoc.typeName);
            // Get and sanitize the internal ID
            invoiceNo = sanitizePath(inboundDoc.internalId || item.internalId || "");
        }

        // Try to use outbound data if available
        if (outboundDoc && outboundDoc.filePath) {
            try {
                // Extract type, company, and date from filePath
                const pathParts = outboundDoc.filePath.split(path.sep);
                if (pathParts.length >= 4) {
                    const dateIndex = pathParts.length - 2;
                    // const companyIndex = pathParts.length - 3; // Not used but kept for reference
                    const typeIndex = pathParts.length - 4;

                    type = pathParts[typeIndex] || 'LHDN';
                    company = companyName;  // Use company name from settings
                    date = pathParts[dateIndex] || moment().format('YYYY-MM-DD');

                    // Only update invoice number if we got it from outbound
                    if (outboundDoc.internalId) {
                        invoiceNo = sanitizePath(outboundDoc.internalId);
                    }

                    // Try to get invoice type code from typeName if available
                    if (outboundDoc.typeName) {
                        const typeMatch = outboundDoc.typeName.match(/^(\d{2})/);
                        if (typeMatch) {
                            invoiceTypeCode = typeMatch[1];
                        }
                    }
                } else {
                    console.log(`Invalid path structure in outbound doc for UUID: ${item.uuid}, using default values`);
                    throw new Error('Invalid path structure');
                }
            } catch (pathError) {
                console.log(`Using default values due to path error for UUID: ${item.uuid}`);
                type = 'LHDN';
                company = companyName;
                date = moment().format('YYYY-MM-DD');
            }
        } else {
            // Use default values if no outbound document
            console.log(`No outbound document or path for UUID: ${item.uuid}, using default values`);
            type = 'LHDN';
            company = companyName;
            date = moment().format('YYYY-MM-DD');
        }

        // Ensure all path components are strings and valid
        type = String(type || 'LHDN');
        company = String(company || companyName);
        date = String(date || moment().format('YYYY-MM-DD'));

        // Sanitize path components
        type = sanitizePath(type);
        company = sanitizePath(company);
        date = sanitizePath(date);

        // Ensure invoiceNo is sanitized again (in case it was updated after initial sanitization)
        invoiceNo = sanitizePath(invoiceNo);

        // Generate filename with new format: {invoiceTypeCode}_{invoiceNo}_{uuid}.json
        const fileName = `${invoiceTypeCode}_${invoiceNo}_${item.uuid}.json`;

        // Construct paths for outgoing files using configured network path
        const outgoingBasePath = path.join(settings.networkPath, type, company);

        // CHANGE: Previously tried to use a specific path from outboundDoc which might not exist
        // Now use a simpler path structure for all documents
        const outgoingJSONPath = outgoingBasePath;

        // Create directory structure recursively
        await fsPromises.mkdir(outgoingBasePath, { recursive: true });

        const jsonFilePath = path.join(outgoingJSONPath, fileName);

        // Check if JSON response file already exists
        try {
            await fsPromises.access(jsonFilePath);
            console.log(`Response file already exists for ${item.uuid}, skipping generation`);
            return {
                success: true,
                message: 'Response file already exists',
                path: jsonFilePath,
                fileName: fileName,
                company: company
            };
        } catch (err) {
            // File doesn't exist, continue with creation
        }

        const portalUrl = getPortalUrl(lhdnConfig.environment);
        const LHDNUrl = `https://${portalUrl}/${item.uuid}/share/${item.longId}`;

        // Create JSON content
        const jsonContent = {
            "issueDate": moment(date).format('YYYY-MM-DD'),
            "issueTime": new Date().toISOString().split('T')[1].split('.')[0] + 'Z',
            "invoiceTypeCode": invoiceTypeCode,
            "invoiceNo": invoiceNo,
            "uuid": item.uuid,
            "submissionUid": item.submissionUid,
            "longId": item.longId,
            "status": item.status,
            "lhdnUrl": LHDNUrl,
        };

        try {
            // Make sure the directory exists (extra check)
            const dirPath = path.dirname(jsonFilePath);
            await fsPromises.mkdir(dirPath, { recursive: true });

            // Write JSON file
            await fsPromises.writeFile(jsonFilePath, JSON.stringify(jsonContent, null, 2));
            console.log(`Generated response file: ${jsonFilePath}`);

            // Update the outbound status record with the username
            try {
                // Find the outbound record first
                const outboundRecord = await prisma.wP_OUTBOUND_STATUS.findFirst({
                    where: { UUID: item.uuid }
                });

                if (outboundRecord) {
                    // Update the record with the username
                    await prisma.wP_OUTBOUND_STATUS.update({
                        where: { id: outboundRecord.id },
                        data: {
                            submitted_by: username,
                            updated_at: new Date()
                        }
                    });
                    console.log(`Updated outbound record with username: ${username} for UUID: ${item.uuid}`);
                }
            } catch (updateError) {
                console.error(`Error updating outbound record with username for ${item.uuid}:`, updateError);
                // Continue even if this fails
            }

            return {
                success: true,
                message: 'Response file generated successfully',
                path: jsonFilePath,
                fileName: fileName,
                company: company
            };
        } catch (writeError) {
            console.error(`Error writing response file for ${item.uuid}:`, writeError);

            // If original path fails, try a fallback path - simplify the path further
            try {
                // Create a simpler fallback path without any potential problematic components
                const fallbackDirName = `LHDN_Fallback_${moment().format('YYYYMMDD')}`;
                const fallbackPath = path.join(settings.networkPath, fallbackDirName);
                await fsPromises.mkdir(fallbackPath, { recursive: true });

                // Use a very simple filename pattern that removes all special characters
                const simplifiedUuid = item.uuid.replace(/[^a-zA-Z0-9]/g, '');
                const fallbackFileName = `document_${simplifiedUuid}.json`;
                const fallbackFilePath = path.join(fallbackPath, fallbackFileName);

                await fsPromises.writeFile(fallbackFilePath, JSON.stringify(jsonContent, null, 2));
                console.log(`Generated response file at fallback location: ${fallbackFilePath}`);

                return {
                    success: true,
                    message: 'Response file generated at fallback location',
                    path: fallbackFilePath,
                    fileName: fallbackFileName,
                    company: company
                };
            } catch (fallbackError) {
                console.error(`Fallback path also failed for ${item.uuid}:`, fallbackError);
                throw writeError; // throw the original error
            }
        }
    } catch (error) {
        console.error(`Error generating response file for ${item.uuid}:`, error);
        return {
            success: false,
            message: `Error generating response file: ${error.message}`,
            error: error
        };
    }
};

// Enhanced save to database function
const saveInboundStatus = async (data, req = null) => {
    if (!data.result || !Array.isArray(data.result)) {
        console.warn("No valid data to process");
        await LoggingService.log({
            description: "No valid data to process for inbound status",
            logType: LOG_TYPES.WARNING,
            module: MODULES.API,
            action: ACTIONS.CREATE,
            status: STATUS.WARNING
        });
        return;
    }

    const batchSize = 100;
    const batches = [];
    // const maxRetries = 3; // Not used but kept for reference
    // const retryDelay = 1000; // Not used but kept for reference
    let successCount = 0;
    let errorCount = 0;
    let responseFileResults = [];

    for (let i = 0; i < data.result.length; i += batchSize) {
        batches.push(data.result.slice(i, i + batchSize));
    }

    console.log(`Processing ${batches.length} batches of ${batchSize} documents each`);

    // Log the start of batch processing
    await LoggingService.log({
        description: `Starting to process ${data.result.length} documents in ${batches.length} batches`,
        logType: LOG_TYPES.INFO,
        module: MODULES.API,
        action: ACTIONS.CREATE,
        status: STATUS.PENDING,
        details: { totalDocuments: data.result.length, batchCount: batches.length }
    });

    // Helper function to format dates
    const formatDate = (date) => {
        if (!date) return null;
        if (typeof date === 'string') return date;
        if (date instanceof Date) return date.toISOString();
        return null;
    };

    // If Prisma client was generated before documentCurrency was added, upsert will throw. We retry without it and log once.
    let documentCurrencySkippedLog = false;

    // Process batches sequentially to reduce concurrency
    for (const batch of batches) {
        // Process documents in smaller chunks to reduce deadlock probability
        const chunkSize = 10;
        for (let i = 0; i < batch.length; i += chunkSize) {
            const chunk = batch.slice(i, i + chunkSize);
            const results = await Promise.all(chunk.map(async item => {
                try {
                    // Ensure issuerName is set from supplierName if missing
                    const issuerName = item.issuerName || item.supplierName || null;

                    // documentCurrency: from LHDN mapping (documentCurrencyCode, etc.) or API DocumentCurrencyCode. Persisted for Total Sales column.
                    const documentCurrency = item.documentCurrency || item.documentCurrencyCode || item.currencyCode || item.currency || item.DocumentCurrencyCode || null;

                    const updatePayload = {
                        submissionUid: item.submissionUid,
                        longId: item.longId,
                        internalId: item.internalId,
                        typeName: item.typeName,
                        typeVersionName: item.typeVersionName,
                        issuerTin: item.issuerTin || item.supplierTin || null,
                        issuerName: issuerName,
                        receiverId: item.receiverId || item.buyerTin || item.buyerTIN || null,
                        receiverName: item.receiverName || item.buyerName || null,
                        dateTimeReceived: formatDate(item.dateTimeReceived),
                        dateTimeValidated: formatDate(item.dateTimeValidated),
                        status: item.status,
                        documentStatusReason: item.documentStatusReason,
                        totalSales: item.totalSales || item.total || item.netAmount || 0,
                        totalExcludingTax: item.totalExcludingTax || 0,
                        totalDiscount: item.totalDiscount || 0,
                        totalNetAmount: item.totalNetAmount || item.netAmount || 0,
                        totalPayableAmount: item.totalPayableAmount || item.total || 0,
                        documentCurrency,
                        last_sync_date: formatDate(new Date()),
                        sync_status: 'success'
                    };
                    const createPayload = {
                        uuid: item.uuid,
                        submissionUid: item.submissionUid,
                        longId: item.longId,
                        internalId: item.internalId,
                        typeName: item.typeName,
                        typeVersionName: item.typeVersionName,
                        issuerTin: item.issuerTin || item.supplierTin || null,
                        issuerName: issuerName,
                        receiverId: item.receiverId || item.buyerTin || item.buyerTIN || null,
                        receiverName: item.receiverName || item.buyerName || null,
                        dateTimeReceived: formatDate(item.dateTimeReceived),
                        dateTimeValidated: formatDate(item.dateTimeValidated),
                        status: item.status,
                        documentStatusReason: item.documentStatusReason,
                        totalSales: item.totalSales || item.total || item.netAmount || 0,
                        totalExcludingTax: item.totalExcludingTax || 0,
                        totalDiscount: item.totalDiscount || 0,
                        totalNetAmount: item.totalNetAmount || item.netAmount || 0,
                        totalPayableAmount: item.totalPayableAmount || item.total || 0,
                        documentCurrency,
                        last_sync_date: formatDate(new Date()),
                        sync_status: 'success'
                    };

                    try {
                        await prisma.wP_INBOUND_STATUS.upsert({
                            where: { uuid: item.uuid },
                            update: updatePayload,
                            create: createPayload
                        });
                    } catch (prismaErr) {
                        // Deployed Prisma client may not include documentCurrency (schema + generate not yet run). Retry without it.
                        if (prismaErr?.name === 'PrismaClientValidationError' && /documentCurrency/i.test(String(prismaErr?.message || ''))) {
                            const { documentCurrency: _u, ...updateWithout } = updatePayload;
                            const { documentCurrency: _c, ...createWithout } = createPayload;
                            await prisma.wP_INBOUND_STATUS.upsert({
                                where: { uuid: item.uuid },
                                update: updateWithout,
                                create: createWithout
                            });
                            if (!documentCurrencySkippedLog) {
                                console.warn('[saveInboundStatus] Prisma client does not include documentCurrency. Run: 1) pnpm prisma migrate deploy 2) pnpm prisma generate 3) restart app. documentCurrency will not be persisted until then.');
                                documentCurrencySkippedLog = true;
                            }
                        } else {
                            throw prismaErr;
                        }
                    }

                    // Log if we fixed a missing issuerName
                    if (!item.issuerName && item.supplierName) {
                        console.log(`Fixed missing issuerName using supplierName for UUID: ${item.uuid}`);
                    }

                    // Generate response file only for valid documents
                    if (item.status === 'Valid') {
                        const responseResult = await generateResponseFile(item, req);
                        responseFileResults.push(responseResult);
                    }

                    // Synchronize status between inbound and outbound tables
                    if (item.status === 'Failed') {
                        // Update the corresponding outbound status record using Prisma
                        // Note: UUID is not a unique field, so we need to use updateMany instead of update
                        await prisma.wP_OUTBOUND_STATUS.updateMany({
                            where: { UUID: item.uuid },
                            data: {
                                status: 'Failed',
                                updated_at: new Date().toISOString(),
                                submitted_by: req?.session?.user?.username || 'System' // Add username from session
                            }
                        });
                    } else if (item.status === 'Valid') {
                        // Update the corresponding outbound status record for Valid documents
                        await prisma.wP_OUTBOUND_STATUS.updateMany({
                            where: { UUID: item.uuid },
                            data: {
                                status: 'Valid',
                                date_sync: new Date().toISOString(),
                                updated_at: new Date().toISOString(),
                                submitted_by: req?.session?.user?.username || 'System'
                            }
                        });
                    } else if (item.status === 'Invalid') {
                        // Update the corresponding outbound status record for Invalid documents
                        await prisma.wP_OUTBOUND_STATUS.updateMany({
                            where: { UUID: item.uuid },
                            data: {
                                status: 'Invalid',
                                updated_at: new Date().toISOString(),
                                submitted_by: req?.session?.user?.username || 'System'
                            }
                        });
                    } else if (item.status === 'Cancelled') {
                        // Update the corresponding outbound status record for Cancelled documents
                        await prisma.wP_OUTBOUND_STATUS.updateMany({
                            where: { UUID: item.uuid },
                            data: {
                                status: 'Cancelled',
                                date_cancelled: new Date().toISOString(),
                                updated_at: new Date().toISOString(),
                                submitted_by: req?.session?.user?.username || 'System'
                            }
                        });
                    }

                    successCount++;
                    return { success: true, item };
                } catch (error) {
                    console.error(`Error processing document ${item.uuid}:`, error);
                    errorCount++;
                    return { success: false, item, error };
                }
            }));

            // Log results for this chunk
            const chunkSuccesses = results.filter(r => r.success).length;
            const chunkErrors = results.filter(r => !r.success).length;
            console.log(`Chunk processed: ${chunkSuccesses} successes, ${chunkErrors} errors`);
        }
    }

    // Summarize response file generation results
    const successfulResponses = responseFileResults.filter(r => r.success);
    if (successfulResponses.length > 0) {
        console.log(`Successfully generated ${successfulResponses.length} response files`);
        successfulResponses.forEach(result => {
            console.log(`Generated: ${result.fileName} for company ${result.company}`);
        });
    }

    console.log(`Save operation completed. Success: ${successCount}, Errors: ${errorCount}`);

    return {
        successCount,
        errorCount,
        responseFiles: {
            total: responseFileResults.length,
            successful: successfulResponses.length,
            results: responseFileResults
        }
    };
};

const requestLogger = async (req, _res, next) => {
    const requestId = Math.random().toString(36).substring(7);
    console.log(`[${requestId}] New request:`, {
        method: req.method,
        path: req.path,
        params: req.params,
        query: req.query,
        user: req.session?.user?.id || 'anonymous'
    });
    req.requestId = requestId;
    next();
};

// Function to poll submission status using GetSubmission API
const pollSubmissionStatus = async (submissionUid, maxAttempts = 10) => {
    try {
        if (!submissionUid) {
            throw new Error('Submission UID is required for polling');
        }

        console.log(`Starting to poll submission status for: ${submissionUid}`);

        // Get LHDN configuration
        const lhdnConfig = await getLHDNConfig();

        // Get token from file - try multiple patterns to be safe
        const tokenFilePath = path.join(__dirname, '../../config/AuthorizeToken.ini');
        let token = null;

        if (fs.existsSync(tokenFilePath)) {
            const tokenData = fs.readFileSync(tokenFilePath, 'utf8');

            // Try different possible token formats in the file
            const tokenPatterns = [
                /AccessToken=(.+)/,
                /access_token=(.+)/,
                /token=(.+)/
            ];

            for (const pattern of tokenPatterns) {
                const tokenMatch = tokenData.match(pattern);
                if (tokenMatch && tokenMatch[1]) {
                    token = tokenMatch[1].trim();
                    console.log(`Found token in AuthorizeToken.ini using pattern: ${pattern}`);
                    break;
                }
            }

            // If we still don't have a token, try parsing as INI
            if (!token && tokenData.includes('[') && tokenData.includes(']')) {
                try {
                    const ini = require('ini');
                    const parsedIni = ini.parse(tokenData);

                    // Check common sections and keys
                    if (parsedIni.Token?.AccessToken) {
                        token = parsedIni.Token.AccessToken;
                    } else if (parsedIni.Token?.access_token) {
                        token = parsedIni.Token.access_token;
                    } else if (parsedIni.LHDN?.token) {
                        token = parsedIni.LHDN.token;
                    }

                    if (token) {
                        console.log('Found token in AuthorizeToken.ini using INI parsing');
                    }
                } catch (iniError) {
                    console.error('Error parsing AuthorizeToken.ini:', iniError);
                }
            }
        }

        // If still no token, try to get it from the token service
        if (!token) {
            try {
                console.log('No token found in file, trying to get from token service...');
                const { getTokenSession } = require('../../services/token-prisma.service');
                token = await getTokenSession();

                if (token) {
                    console.log('Successfully retrieved token from token service');
                }
            } catch (tokenServiceError) {
                console.error('Error getting token from service:', tokenServiceError);
            }
        }

        if (!token) {
            throw new Error('No valid access token found for polling');
        }

        let attempts = 0;
        let inProgress = true;
        let submissionStatus = null;

        while (inProgress && attempts < maxAttempts) {
            attempts++;

            try {
                // Call GetSubmission API with proper polling interval
                const response = await axios.get(
                    `${lhdnConfig.baseUrl}/api/v1.0/documentsubmissions/${submissionUid}`,
                    {
                        params: {
                            pageNo: 1,
                            pageSize: 100 // Maximum allowed page size
                        },
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Accept': 'application/json',
                            'Content-Type': 'application/json'
                        },
                        timeout: lhdnConfig.timeout
                    }
                );

                // Check if submission is still in progress
                submissionStatus = response.data;

                if (submissionStatus.overallStatus && submissionStatus.overallStatus.toLowerCase() !== 'in progress') {
                    inProgress = false;
                    console.log(`Submission ${submissionUid} completed with status: ${submissionStatus.overallStatus}`);

                    // Process documents in the submission
                    if (submissionStatus.documentSummary && Array.isArray(submissionStatus.documentSummary)) {
                        console.log(`Processing ${submissionStatus.documentSummary.length} documents from submission`);

                        // Save documents to database
                        await saveInboundStatus({
                            result: submissionStatus.documentSummary.map(doc => ({
                                ...doc,
                                // Ensure consistent field names
                                uuid: doc.uuid,
                                submissionUid: doc.submissionUid,
                                longId: doc.longId,
                                internalId: doc.internalId,
                                typeName: doc.typeName,
                                typeVersionName: doc.typeVersionName,
                                issuerTin: doc.issuerTin,
                                issuerName: doc.issuerName,
                                receiverId: doc.receiverId,
                                receiverName: doc.receiverName,
                                dateTimeReceived: doc.dateTimeReceived,
                                dateTimeValidated: doc.dateTimeValidated,
                                status: doc.status,
                                documentStatusReason: doc.documentStatusReason,
                                totalSales: doc.totalSales || doc.totalPayableAmount,
                                totalExcludingTax: doc.totalExcludingTax,
                                totalDiscount: doc.totalDiscount,
                                totalNetAmount: doc.totalNetAmount,
                                totalPayableAmount: doc.totalPayableAmount
                            }))
                        });
                    }

                    return {
                        success: true,
                        status: submissionStatus.overallStatus,
                        documentCount: submissionStatus.documentCount,
                        documents: submissionStatus.documentSummary || []
                    };
                }

                console.log(`Submission ${submissionUid} still in progress (attempt ${attempts}/${maxAttempts}), waiting...`);

                // Wait for 5 seconds between polling attempts (as recommended by LHDN)
                await delay(5000);

            } catch (error) {
                console.error(`Error polling submission status (attempt ${attempts}/${maxAttempts}):`, error.message);

                // If we get a rate limit error, wait longer
                if (error.response?.status === 429) {
                    const retryAfter = parseInt(error.response.headers['retry-after'] || '30');
                    console.log(`Rate limited, waiting ${retryAfter} seconds before retry...`);
                    await delay(retryAfter * 1000);
                } else {
                    // For other errors, wait 5 seconds before retry
                    await delay(5000);
                }
            }
        }

        // If we've reached max attempts and still in progress
        if (inProgress) {
            console.log(`Reached maximum polling attempts (${maxAttempts}) for submission ${submissionUid}`);
            return {
                success: false,
                status: 'timeout',
                message: `Polling timed out after ${maxAttempts} attempts`,
                submissionUid
            };
        }

        return {
            success: true,
            status: submissionStatus?.overallStatus || 'unknown',
            documentCount: submissionStatus?.documentCount || 0,
            documents: submissionStatus?.documentSummary || []
        };

    } catch (error) {
        console.error('Error in pollSubmissionStatus:', error);
        return {
            success: false,
            status: 'error',
            message: error.message,
            error
        };
    }
};

// Import token refresh middleware
const tokenRefreshMiddleware = require('../../middleware/token-refresh.middleware');

// Apply middlewares
router.use(requestLogger);
router.use(tokenRefreshMiddleware);

// Document refresh endpoint
router.post('/documents/refresh', async (req, res) => {
    try {
        console.log('LHDN documents/refresh endpoint hit');

        // Check if user is logged in
        if (!req.session?.user) {
            console.log('No user session found');
            return handleAuthError(req, res);
        }

        // Log the refresh request
        await LoggingService.log({
            description: 'Manual refresh of LHDN documents requested',
            username: req.session?.user?.username || 'System',
            userId: req.session?.user?.id,
            ipAddress: req.ip,
            logType: LOG_TYPES.INFO,
            module: MODULES.API,
            action: ACTIONS.READ,
            status: STATUS.PENDING
        });

        // Force refresh by clearing cache
        const cacheKey = `recentDocuments_${req.session?.user?.TIN || 'default'}`;
        cache.del(cacheKey);

        // Fetch fresh data from LHDN API
        const fetchResult = await fetchRecentDocuments(req);

        // Log the result
        await LoggingService.log({
            description: `Manual refresh completed: ${fetchResult.result?.length || 0} documents retrieved`,
            username: req.session?.user?.username || 'System',
            userId: req.session?.user?.id,
            ipAddress: req.ip,
            logType: LOG_TYPES.INFO,
            module: MODULES.API,
            action: ACTIONS.READ,
            status: STATUS.SUCCESS,
            details: {
                count: fetchResult.result?.length || 0,
                fromApi: fetchResult.fromApi || false,
                fromDatabase: fetchResult.fromDatabase || false,
                cached: fetchResult.cached || false
            }
        });

        // Return success response
        return res.json({
            success: true,
            message: 'Documents refreshed successfully',
            count: fetchResult.result?.length || 0,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error refreshing documents:', error);

        // Log the error
        await LoggingService.log({
            description: `Error refreshing LHDN documents: ${error.message}`,
            username: req.session?.user?.username || 'System',
            userId: req.session?.user?.id,
            ipAddress: req.ip,
            logType: LOG_TYPES.ERROR,
            module: MODULES.API,
            action: ACTIONS.READ,
            status: STATUS.FAILED,
            details: { error: error.message }
        });

        // Check if it's an authentication error
        if (error.message === 'Authentication failed. Please log in again.' ||
            error.response?.status === 401 ||
            error.response?.status === 403) {
            return handleAuthError(req, res);
        }

        // Return error response
        return res.status(500).json({
            success: false,
            message: 'Failed to refresh documents',
            error: {
                code: error.code || 'REFRESH_ERROR',
                message: error.message || 'An unexpected error occurred',
                details: error.response?.data?.error || error.stack
            }
        });
    }
});

// Authentication status endpoint - REMOVED DUPLICATE

// Helper function to read token from file
async function readTokenFromFile() {
    try {
        const tokenFilePath = path.join(__dirname, '../../config/AuthorizeToken.ini');
        if (fs.existsSync(tokenFilePath)) {
            const tokenData = await fsPromises.readFile(tokenFilePath, 'utf8');

            // Try different possible token formats in the file
            let tokenMatch = tokenData.match(/AccessToken=(.+)/i) ||
                            tokenData.match(/access_token=(.+)/i) ||
                            tokenData.match(/token=(.+)/i);

            if (tokenMatch && tokenMatch[1]) {
                console.log('Found token in AuthorizeToken.ini file');
                return tokenMatch[1].trim();
            } else {
                console.log('Token pattern not found in AuthorizeToken.ini file');
                // Try to parse as JSON if no match found
                try {
                    const jsonData = JSON.parse(tokenData);
                    if (jsonData.access_token) {
                        console.log('Found token in JSON format in AuthorizeToken.ini file');
                        return jsonData.access_token;
                    }
                } catch (jsonError) {
                    // Not JSON format, continue
                    console.log('AuthorizeToken.ini is not in JSON format');
                }
            }
        } else {
            console.log('AuthorizeToken.ini file not found');
        }
        return null;
    } catch (error) {
        console.error('Error reading token from file:', error);
        return null;
    }
}

// Routes
router.get('/documents/recent', async (req, res) => {
    console.log('LHDN documents/recent endpoint hit');
    try {
        // Check if user is logged in
        if (!req.session?.user) {
            console.log('No user session found');
            return handleAuthError(req, res);
        }

        console.log('User from session:', req.session.user);

        // Check if we should use database only (for fallback)
        const useDatabase = req.query.useDatabase === 'true';
        const fallbackOnly = req.query.fallbackOnly === 'true';
        const useCache = req.query.useCache === 'true';

        // If fallbackOnly is true, skip token check and API call
        if (fallbackOnly) {
            console.log('Fallback only mode requested, skipping token check and API call');
            try {
                // Get documents from database
                const dbDocuments = await prisma.wP_INBOUND_STATUS.findMany({
                    orderBy: {
                        dateTimeReceived: 'desc'
                    },
                    take: 1000 // Limit to latest 1000 records
                });

                if (dbDocuments && dbDocuments.length > 0) {
                    console.log(`Found ${dbDocuments.length} documents in database for fallback`);
                    return res.json({
                        success: true,
                        result: dbDocuments,
                        metadata: {
                            total: dbDocuments.length,
                            fromDatabase: true,
                            fromApi: false,
                            fallback: true,
                            timestamp: new Date().toISOString()
                        }
                    });
                } else {
                    return res.status(404).json({
                        success: false,
                        message: 'No documents found in database',
                        error: {
                            code: 'NO_DATA',
                            message: 'No documents found in database'
                        }
                    });
                }
            } catch (dbError) {
                console.error('Error getting documents from database:', dbError);
                return res.status(500).json({
                    success: false,
                    message: 'Error getting documents from database',
                    error: {
                        code: 'DATABASE_ERROR',
                        message: dbError.message
                    }
                });
            }
        }

        // First try to get token from file (preferred method)
        let accessToken = await readTokenFromFile();

        // If no token in file, try session as fallback
        if (!accessToken && req.session.accessToken) {
            console.log('No token in file, using token from session');
            accessToken = req.session.accessToken;
        }

        // If still no token, try to get a fresh one
        if (!accessToken) {
            try {
                console.log('No token found, attempting to get a fresh token');
                const { getTokenSession } = require('../../services/token-prisma.service');
                accessToken = await getTokenSession();
                if (accessToken) {
                    console.log('Successfully obtained fresh token');
                }
            } catch (tokenError) {
                console.error('Error getting fresh token:', tokenError);
            }
        }

        // Final check if we have a token
        if (!accessToken) {
            console.log('No access token found after all attempts');

            // If useDatabase is true, try to get documents from database instead of returning error
            if (useDatabase) {
                try {
                    // Get documents from database
                    const dbDocuments = await prisma.wP_INBOUND_STATUS.findMany({
                        orderBy: {
                            dateTimeReceived: 'desc'
                        },
                        take: 1000 // Limit to latest 1000 records
                    });

                    if (dbDocuments && dbDocuments.length > 0) {
                        console.log(`Found ${dbDocuments.length} documents in database as fallback for missing token`);
                        return res.json({
                            success: true,
                            result: dbDocuments,
                            metadata: {
                                total: dbDocuments.length,
                                fromDatabase: true,
                                fromApi: false,
                                fallback: true,
                                timestamp: new Date().toISOString()
                            }
                        });
                    }
                } catch (dbError) {
                    console.error('Error getting documents from database:', dbError);
                }
            }

            return handleAuthError(req, res);
        }

        // Always update session with the token we're using
        req.session.accessToken = accessToken;
        console.log('Updated session with token');

        try {
            // If useCache is true, return a signal to use cached data
            if (useCache) {
                console.log('Client requested to use cached data');
                return res.json({
                    success: true,
                    useCache: true,
                    result: [], // Empty result, client will use its cached data
                    metadata: {
                        cached: true,
                        fromCache: true,
                        timestamp: new Date().toISOString()
                    }
                });
            }

            // Get documents using enhanced caching function
            const fetchResult = await getCachedDocuments(req);

            if (!fetchResult.success && fetchResult.error) {
                // If fetch failed and no fallback data, return error
                if (!fetchResult.result || fetchResult.result.length === 0) {
                    const statusCode = fetchResult.error?.response?.status || 500;
                    return res.status(statusCode).json({
                        success: false,
                        error: {
                            code: fetchResult.error.code || 'FETCH_ERROR',
                            message: fetchResult.error.message || 'Failed to fetch documents',
                            details: fetchResult.error.details || fetchResult.error.stack
                        },
                        metadata: {
                            timestamp: new Date().toISOString()
                        }
                    });
                }
                // If fetch failed but fallback data is available, log warning and proceed
                console.warn('Fetch from API failed, but using database fallback:', fetchResult.error.message);
            }

            const documents = fetchResult.result || [];
            console.log('Got documents from fetchResult, count:', documents.length);

            // [Trace] First doc before format - see what we have for documentCurrency
            if (documents.length > 0) {
                const d = documents[0];
                console.log('[documents/recent] Source: fromApi=', fetchResult.fromApi, 'fromDatabase=', fetchResult.fromDatabase);
                console.log('[documents/recent] First doc (before format) - keys:', Object.keys(d).join(', '));
                console.log('[documents/recent] First doc - currency fields:', { documentCurrencyCode: d.documentCurrencyCode, documentCurrency: d.documentCurrency, currencyCode: d.currencyCode, currency: d.currency, hasDocumentDetails: typeof d.documentDetails });
            }

            // Helper function to format dates for display
            const formatDateForDisplay = (dateString) => {
                if (!dateString) return null;
                try {
                    const date = new Date(dateString);
                    if (isNaN(date.getTime())) return dateString; // Return original if invalid
                    return date.toISOString();
                } catch (err) {
                    console.log('Error formatting date:', dateString, err);
                    return dateString;
                }
            };

            // Helper function to format dates for UI display
            const formatDateForUI = (dateString) => {
                if (!dateString) return null;
                try {
                    const date = new Date(dateString);
                    if (isNaN(date.getTime())) return null;

                    // Format as "Apr 07, 2025, 01:14 PM"
                    return date.toLocaleString('en-US', {
                        month: 'short',
                        day: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    });
                } catch (err) {
                    console.log('Error formatting date for UI:', dateString, err);
                    return null;
                }
            };

            const formattedDocuments = await Promise.all(documents.map(async (doc) => {
                // Get submission and validation dates
                const receivedDate = doc.dateTimeReceived || doc.created_at;
                const validatedDate = doc.dateTimeValidated;
                // Calculate processing time in minutes (float)
                let processingTimeMinutes = null;
                if (receivedDate && validatedDate) {
                    try {
                        const received = new Date(receivedDate);
                        const validated = new Date(validatedDate);
                        if (!isNaN(received.getTime()) && !isNaN(validated.getTime())) {
                            processingTimeMinutes = (validated - received) / (1000 * 60);
                        }
                    } catch (e) {
                        processingTimeMinutes = null;
                    }
                }
                // documentCurrency: 1) from API/DB fields, 2) documentDetails JSON, 3) record.document (UBL). Backfill WP_Inbound_Status when we resolve from UBL.
                let documentCurrency = doc.documentCurrencyCode || doc.documentCurrency || doc.currencyCode || doc.currency || null;
                if (!documentCurrency && typeof doc.documentDetails === 'string') {
                    try {
                        const o = JSON.parse(doc.documentDetails);
                        documentCurrency = o.documentCurrencyCode || o.documentCurrency || o.currencyCode || o.currency || null;
                    } catch (e) { /* ignore */ }
                }
                if (!documentCurrency && doc.document && typeof doc.document === 'string') {
                    const fromRaw = await extractDocumentCurrencyFromRaw(doc.document);
                    if (fromRaw) {
                        documentCurrency = fromRaw;
                        if (!doc.documentCurrency) persistDocumentCurrencyIfNull(doc.uuid, fromRaw);
                    }
                }
                return {
                    uuid: doc.uuid,
                    submissionUid: doc.submissionUid,
                    longId: doc.longId,
                    internalId: doc.internalId,
                    dateTimeIssued: formatDateForDisplay(doc.dateTimeIssued),
                    dateTimeReceived: formatDateForDisplay(receivedDate),
                    dateTimeValidated: formatDateForDisplay(validatedDate),
                    submissionDate: formatDateForDisplay(receivedDate),
                    validationDate: formatDateForDisplay(validatedDate),
                    // UI display formatted dates
                    receivedDateFormatted: formatDateForUI(receivedDate),
                    validatedDateFormatted: formatDateForUI(validatedDate),
                    dateInfo: {
                        date: formatDateForUI(validatedDate || receivedDate),
                        type: validatedDate ? 'Validated' : 'Submitted',
                        tooltip: validatedDate ? 'LHDN Validation Date' : 'LHDN Submission Date'
                    },
                    status: doc.status,
                    totalSales: doc.totalSales || 0,
                    totalExcludingTax: doc.totalExcludingTax || 0,
                    totalDiscount: doc.totalDiscount || 0,
                    totalNetAmount: doc.totalNetAmount || 0,
                    totalPayableAmount: doc.totalPayableAmount || 0,
                    issuerTin: doc.issuerTin ,
                    issuerName: doc.issuerName,
                    receiverId: doc.receiverId,
                    receiverName: doc.receiverName,
                    supplierName: doc.issuerName, // Use the potentially updated issuerName
                    typeName: doc.typeName,
                    typeVersionName: doc.typeVersionName,
                    documentStatusReason: doc.documentStatusReason,
                    documentCurrency: documentCurrency || null,
                    processingTimeMinutes
                };
            }));

            // [Trace] Formatted documentCurrency - what we send to the table
            if (formattedDocuments.length > 0) {
                console.log('[documents/recent] Formatted documentCurrency (first 5):', formattedDocuments.slice(0, 5).map(x => ({ internalId: x.internalId, documentCurrency: x.documentCurrency })));
            }
            console.log('Sending response with formatted documents:', formattedDocuments.length);

            res.json({
                success: true,
                result: formattedDocuments,
                metadata: {
                    total: formattedDocuments.length,
                    cached: fetchResult.cached,
                    fromDatabase: fetchResult.fromDatabase,
                    fromApi: fetchResult.fromApi,
                    fallback: fetchResult.fallback,
                    error: fetchResult.error ? { message: fetchResult.error.message } : undefined,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            console.error('Error in documents/recent route processing:', error);

            const statusCode = error.response?.status || 500;
            res.status(statusCode).json({
                success: false,
                error: {
                    code: error.code || 'INTERNAL_SERVER_ERROR',
                    message: error.message || 'An unexpected error occurred',
                    details: error.response?.data?.error || error.original?.message || null,
                    timestamp: new Date().toISOString()
                }
            });
        }
    } catch (error) {
        console.error('Error in route handler:', error);

        // Check if it's an authentication error
        if (error.message === 'Authentication failed. Please log in again.' ||
            error.response?.status === 401 ||
            error.response?.status === 403) {
            return handleAuthError(req, res);
        }

        const statusCode = error.response?.status || 500;
        res.status(statusCode).json({
            success: false,
            error: {
                code: error.code || 'INTERNAL_SERVER_ERROR',
                message: error.message || 'An unexpected error occurred',
                details: error.response?.data?.error || error.original?.message || null,
                timestamp: new Date().toISOString()
            }
        });
    }
});

router.get('/documents/recent-total', async (_req, res) => {
    try {
        const totalCount = await prisma.wP_INBOUND_STATUS.count();
        res.json({ totalCount, success: true });
    } catch (error) {
        console.error('Error getting total count:', error);
        res.json({
            totalCount: 0,
            success: false,
            message: 'Failed to fetch recent documents'
        });
    }
});

// Archive staging endpoint - Get all documents from WP_INBOUND_STATUS table
router.get('/documents/archive-staging', async (req, res) => {
    try {
        console.log('Fetching archive staging data from WP_INBOUND_STATUS');

        // Get all records from WP_INBOUND_STATUS table
        let archiveRecords = await prisma.wP_INBOUND_STATUS.findMany({
            orderBy: {
                dateTimeReceived: 'desc'
            }
        });

        console.log(`Found ${archiveRecords.length} archive staging records`);
        archiveRecords = await filterPinnacleOnlyInbound(archiveRecords, req);

        // Locate Invoice in parsed UBL/XML (handles namespaces, explicitRoot, wrappers). Same logic as display-details.
        const findInvoiceInParsed = (parsed) => {
            if (!parsed || typeof parsed !== 'object') return null;
            if (parsed.root && typeof parsed.root === 'object') return findInvoiceInParsed(parsed.root);
            for (const k of Object.keys(parsed)) {
                const local = (k && k.includes(':')) ? k.split(':').pop() : k;
                if (local === 'Invoice') {
                    const v = parsed[k];
                    return (Array.isArray(v) && v.length) ? v[0] : (v && typeof v === 'object' ? v : null);
                }
            }
            const keys = Object.keys(parsed);
            if (keys.length === 1) {
                const v = parsed[keys[0]];
                const child = (Array.isArray(v) && v.length) ? v[0] : v;
                if (child && typeof child === 'object') return findInvoiceInParsed(child);
            }
            return null;
        };

        // Extract DocumentCurrencyCode from raw UBL/XML string (record.document). Same source as PDF.
        const extractDocumentCurrencyFromXml = async (xmlStr) => {
            if (typeof xmlStr !== 'string' || !xmlStr.trim().startsWith('<')) return null;
            try {
                const parsed = await parseStringPromise(xmlStr, { explicitArray: true, tagNameProcessors: [processors.stripPrefix] });
                const invoice = findInvoiceInParsed(parsed);
                if (!invoice || !invoice.DocumentCurrencyCode || !Array.isArray(invoice.DocumentCurrencyCode) || !invoice.DocumentCurrencyCode.length) return null;
                const v = invoice.DocumentCurrencyCode[0];
                return (typeof v === 'string' ? v : (v && v._)) || null;
            } catch (e) { return null; }
        };

        // 1) record.documentCurrency (persisted from saveInboundStatus), 2) documentDetails (JSON), 3) record.document (UBL/XML). No hardcoded fallback.
        const getDocumentCurrency = async (record) => {
            if (record.documentCurrency) return record.documentCurrency;
            try {
                if (typeof record.documentDetails === 'string') {
                    const o = JSON.parse(record.documentDetails);
                    const c = o.documentCurrencyCode || o.documentCurrency || o.currencyCode || o.currency;
                    if (c) return c;
                }
            } catch (e) { /* documentDetails may be XML or invalid */ }
            if (record.document && typeof record.document === 'string') {
                const c = await extractDocumentCurrencyFromXml(record.document);
                if (c) return c;
            }
            return null;
        };

        // Map the data to match the expected format (async: parse record.document when documentDetails is null)
        const mappedRecords = await Promise.all(archiveRecords.map(async (record) => {
            const documentCurrency = await getDocumentCurrency(record);
            return {
                uuid: record.uuid,
                submissionUid: record.submissionUid,
                longId: record.longId,
                internalId: record.internalId,
                typeName: record.typeName,
                typeVersionName: record.typeVersionName,
                issuerTin: record.issuerTin,
                issuerName: record.issuerName || record.supplierName,
                receiverId: record.receiverId,
                receiverName: record.receiverName,
                receiverTIN: record.receiverTIN,
                receiverRegistrationNo: record.receiverRegistrationNo,
                receiverAddress: record.receiverAddress,
                receiverPostcode: record.receiverPostcode,
                receiverCity: record.receiverCity,
                receiverState: record.receiverState,
                receiverCountry: record.receiverCountry,
                receiverPhone: record.receiverPhone,
                dateTimeReceived: record.dateTimeReceived,
                dateTimeIssued: record.dateTimeIssued,
                dateTimeValidated: record.dateTimeValidated,
                status: record.status,
                documentStatusReason: record.documentStatusReason,
                totalSales: record.totalSales,
                totalExcludingTax: record.totalExcludingTax,
                totalDiscount: record.totalDiscount,
                totalNetAmount: record.totalNetAmount,
                totalPayableAmount: record.totalPayableAmount,
                documentCurrency,
                source: 'Archive Staging', // Mark as archive staging
                last_sync_date: record.last_sync_date
            };
        }));

        // [Trace] documentCurrency in archive-staging — for Total Sales column
        if (mappedRecords.length > 0) {
            const r0 = archiveRecords[0];
            console.log('[archive-staging] First record - documentCurrency:', mappedRecords[0].documentCurrency, 'internalId:', r0.internalId, 'hasDocumentDetails:', !!r0.documentDetails, 'hasDocument:', !!r0.document);
            console.log('[archive-staging] Formatted documentCurrency (first 5):', mappedRecords.slice(0, 5).map(x => ({ internalId: x.internalId, documentCurrency: x.documentCurrency })));
        }

        res.json({
            success: true,
            result: mappedRecords,
            count: mappedRecords.length,
            fromArchive: true,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error fetching archive staging data:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch archive staging data',
            result: []
        });
    }
});

// New endpoint to check submission status using polling
router.get('/submission/:submissionUid', async (req, res) => {
    try {
        const { submissionUid } = req.params;
        const maxAttempts = parseInt(req.query.maxAttempts) || 10;

        if (!submissionUid) {
            return res.status(400).json({
                success: false,
                message: 'Submission UID is required'
            });
        }

        // Check if user is logged in
        if (!req.session?.user) {
            console.log('No user session found');
            return handleAuthError(req, res);
        }

        // Log the request
        await LoggingService.log({
            description: `Checking submission status for: ${submissionUid}`,
            username: req.session?.user?.username || 'System',
            userId: req.session?.user?.id,
            ipAddress: req.ip,
            logType: LOG_TYPES.INFO,
            module: MODULES.API,
            action: ACTIONS.READ,
            status: STATUS.PENDING
        });

        // Poll for submission status
        const result = await pollSubmissionStatus(submissionUid, maxAttempts);

        // Log the result
        await LoggingService.log({
            description: `Submission status check completed for: ${submissionUid}, status: ${result.status}`,
            username: req.session?.user?.username || 'System',
            userId: req.session?.user?.id,
            ipAddress: req.ip,
            logType: LOG_TYPES.INFO,
            module: MODULES.API,
            action: ACTIONS.READ,
            status: result.success ? STATUS.SUCCESS : STATUS.FAILED,
            details: {
                submissionUid,
                status: result.status,
                documentCount: result.documentCount || 0
            }
        });

        return res.json(result);
    } catch (error) {
        console.error('Error checking submission status:', error);

        // Log the error
        await LoggingService.log({
            description: `Error checking submission status: ${error.message}`,
            username: req.session?.user?.username || 'System',
            userId: req.session?.user?.id,
            ipAddress: req.ip,
            logType: LOG_TYPES.ERROR,
            module: MODULES.API,
            action: ACTIONS.READ,
            status: STATUS.FAILED,
            details: { error: error.message }
        });

        return res.status(500).json({
            success: false,
            status: 'error',
            message: error.message
        });
    }
});

// Validation results endpoint
router.get('/documents/:uuid/validation-results', async (req, res) => {
    try {
        const { uuid } = req.params;
        const requestId = req.requestId;

        console.log(`[${requestId}] Fetching validation results for document: ${uuid}`);

        // Check if user is logged in
        if (!req.session?.user) {
            console.log(`[${requestId}] No user session found`);
            return handleAuthError(req, res);
        }

        // Get LHDN configuration
        const lhdnConfig = await getLHDNConfig();

        // Log the request
        await LoggingService.log({
            description: `Fetching validation results for document: ${uuid}`,
            username: req.session?.user?.username || 'System',
            userId: req.session?.user?.id,
            ipAddress: req.ip,
            logType: LOG_TYPES.INFO,
            module: MODULES.API,
            action: ACTIONS.READ,
            status: STATUS.PENDING
        });

        // First check if we have the validation results in the database
        const dbDocument = await prisma.wP_INBOUND_STATUS.findUnique({
            where: { uuid }
        });

        if (dbDocument && dbDocument.validationResults) {
            console.log(`[${requestId}] Found validation results in database for document: ${uuid}`);

            try {
                // Parse validation results
                const validationResults = JSON.parse(dbDocument.validationResults);

                // Log success
                await LoggingService.log({
                    description: `Successfully retrieved validation results from database for document: ${uuid}`,
                    username: req.session?.user?.username || 'System',
                    userId: req.session?.user?.id,
                    ipAddress: req.ip,
                    logType: LOG_TYPES.INFO,
                    module: MODULES.API,
                    action: ACTIONS.READ,
                    status: STATUS.SUCCESS
                });

                return res.json({
                    success: true,
                    validationResults,
                    source: 'database'
                });
            } catch (parseError) {
                console.error(`[${requestId}] Error parsing validation results from database:`, parseError);
                // Continue to fetch from API if parsing fails
            }
        }

        // If not in database or parsing failed, fetch from API
        console.log(`[${requestId}] Fetching validation results from LHDN API for document: ${uuid}`);

        // Get document details from LHDN API
        const response = await axios.get(`${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/details`, {
            headers: {
                'Authorization': `Bearer ${req.session.accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const detailsData = response.data;

        // Process validation results
        let processedValidationResults = null;
        if (detailsData.validationResults) {
            processedValidationResults = {
                status: detailsData.status,
                validationSteps: detailsData.validationResults.validationSteps?.map(step => {
                    let errors = [];
                    if (step.error) {
                        if (Array.isArray(step.error.errors)) {
                            errors = step.error.errors.map(err => ({
                                code: err.code || 'VALIDATION_ERROR',
                                message: err.message || err.toString(),
                                field: err.field || null,
                                value: err.value || null,
                                details: err.details || null
                            }));
                        } else if (typeof step.error === 'object') {
                            errors = [{
                                code: step.error.code || 'VALIDATION_ERROR',
                                message: step.error.message || step.error.toString(),
                                field: step.error.field || null,
                                value: step.error.value || null,
                                details: step.error.details || null
                            }];
                        } else {
                            errors = [{
                                code: 'VALIDATION_ERROR',
                                message: step.error.toString(),
                                field: null,
                                value: null,
                                details: null
                            }];
                        }
                    }

                    return {
                        name: step.name || 'Validation Step',
                        status: step.status || 'Invalid',
                        error: errors.length > 0 ? { errors } : null,
                        timestamp: step.timestamp || new Date().toISOString()
                    };
                }) || [],
                summary: {
                    totalSteps: detailsData.validationResults.validationSteps?.length || 0,
                    failedSteps: detailsData.validationResults.validationSteps?.filter(step => step.status === 'Invalid' || step.error)?.length || 0,
                    lastUpdated: new Date().toISOString()
                }
            };

            // Save validation results to database
            try {
                await prisma.wP_INBOUND_STATUS.update({
                    where: { uuid },
                    data: {
                        validationResults: JSON.stringify(processedValidationResults)
                    }
                });
                console.log(`[${requestId}] Saved validation results to database for document: ${uuid}`);
            } catch (dbError) {
                console.error(`[${requestId}] Error saving validation results to database:`, dbError);
                // Continue even if saving to database fails
            }
        }

        // Log success
        await LoggingService.log({
            description: `Successfully retrieved validation results from API for document: ${uuid}`,
            username: req.session?.user?.username || 'System',
            userId: req.session?.user?.id,
            ipAddress: req.ip,
            logType: LOG_TYPES.INFO,
            module: MODULES.API,
            action: ACTIONS.READ,
            status: STATUS.SUCCESS
        });

        return res.json({
            success: true,
            validationResults: processedValidationResults,
            source: 'api'
        });
    } catch (error) {
        console.error('Error fetching validation results:', error);

        // Log the error
        await LoggingService.log({
            description: `Error fetching validation results: ${error.message}`,
            username: req.session?.user?.username || 'System',
            userId: req.session?.user?.id,
            ipAddress: req.ip,
            logType: LOG_TYPES.ERROR,
            module: MODULES.API,
            action: ACTIONS.READ,
            status: STATUS.FAILED,
            details: { error: error.message }
        });

        // Check if it's an authentication error
        if (error.message === 'Authentication failed. Please log in again.' ||
            error.response?.status === 401 ||
            error.response?.status === 403) {
            return handleAuthError(req, res);
        }

        return res.status(500).json({
            success: false,
            message: 'Failed to fetch validation results',
            error: {
                code: error.code || 'VALIDATION_ERROR',
                message: error.message || 'An unexpected error occurred',
                details: error.response?.data?.error || error.stack
            }
        });
    }
});

// Check LHDN API status
router.get('/status', async (req, res) => {
    try {
        // Get LHDN configuration
        const lhdnConfig = await getLHDNConfig();

        // Get token from session
        const accessToken = await getTokenSession();
        if (!accessToken) {
            return res.status(401).json({
                success: false,
                message: 'Failed to get access token'
            });
        }

        // Try to make a simple API call to check if LHDN API is available
        const response = await axios.get(
            `${lhdnConfig.baseUrl}/api/v1.0/documents/status`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                },
                timeout: 5000 // 5 second timeout
            }
        );

        // If we get here, the API is available
        res.json({
            success: true,
            message: 'LHDN API is available',
            status: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error checking LHDN API status:', error);

        // Determine the specific error
        let errorMessage = 'LHDN API is unavailable';
        let errorStatus = 'disconnected';

        if (error.code === 'ECONNABORTED') {
            errorMessage = 'Connection to LHDN API timed out';
        } else if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            errorMessage = `LHDN API returned error: ${error.response.status} ${error.response.statusText}`;

            if (error.response.status === 401 || error.response.status === 403) {
                errorStatus = 'unauthorized';
            }
        } else if (error.request) {
            // The request was made but no response was received
            errorMessage = 'No response received from LHDN API';
        }

        res.status(503).json({
            success: false,
            message: errorMessage,
            status: errorStatus,
            timestamp: new Date().toISOString()
        });
    }
});

// Authentication status endpoint - Modified to handle unauthenticated requests better
router.get('/auth-status', async (req, res) => {
    try {
        // This endpoint should always return a 200 status with authentication status
        // to avoid frontend errors, even when not authenticated

        // Check if user is logged in
        if (!req.session?.user) {
            console.log('LHDN auth-status: No active user session');
            return res.status(200).json({
                success: true, // Changed to true to avoid frontend errors
                authenticated: false,
                message: 'No active user session',
                code: 'SESSION_MISSING'
            });
        }

        // Try to get token from session or file
        const { getTokenSession, readTokenFromFile } = require('../../services/token-prisma.service');
        let accessToken = req.session.accessToken;

        // If no token in session, try to get from file
        if (!accessToken) {
            try {
                const tokenData = readTokenFromFile();
                if (tokenData && tokenData.access_token) {
                    accessToken = tokenData.access_token;
                    // Update session with token from file
                    req.session.accessToken = accessToken;
                    console.log('LHDN auth-status: Using token from file');
                }
            } catch (fileError) {
                console.warn('LHDN auth-status: Error reading token from file:', fileError);
            }
        }

        // If still no token, try to get a fresh one
        if (!accessToken) {
            try {
                accessToken = await getTokenSession();
                // Update session with new token
                if (accessToken) {
                    req.session.accessToken = accessToken;
                    console.log('LHDN auth-status: Generated new token');
                }
            } catch (tokenError) {
                console.warn('LHDN auth-status: Error getting fresh token:', tokenError);
            }
        }

        // Check if we have a token now
        if (!accessToken) {
            console.log('LHDN auth-status: No token available after all attempts');
            return res.status(200).json({
                success: true, // Changed to true to avoid frontend errors
                authenticated: false,
                message: 'No LHDN access token available',
                code: 'TOKEN_MISSING'
            });
        }

        // Check token expiry if available
        const now = Date.now();
        const tokenExpiry = req.session.tokenExpiryTime || 0;
        const bufferTime = 5 * 60 * 1000; // 5 minutes buffer

        if (tokenExpiry && tokenExpiry < (now + bufferTime)) {
            console.log('LHDN auth-status: Token expired or about to expire');
            // Try to refresh the token
            try {
                const newToken = await getTokenSession();
                if (newToken) {
                    accessToken = newToken;
                    req.session.accessToken = newToken;
                    req.session.tokenExpiryTime = now + (3600 * 1000); // Assume 1 hour validity
                    console.log('LHDN auth-status: Successfully refreshed expired token');
                } else {
                    return res.status(200).json({
                        success: true, // Changed to true to avoid frontend errors
                        authenticated: false,
                        message: 'LHDN access token is expired and refresh failed',
                        code: 'TOKEN_EXPIRED',
                        expiresIn: Math.floor((tokenExpiry - now) / 1000) // seconds until expiry
                    });
                }
            } catch (refreshError) {
                console.warn('LHDN auth-status: Failed to refresh expired token:', refreshError);
                return res.status(200).json({
                    success: true, // Changed to true to avoid frontend errors
                    authenticated: false,
                    message: 'LHDN access token is expired and refresh failed',
                    code: 'TOKEN_EXPIRED',
                    expiresIn: Math.floor((tokenExpiry - now) / 1000) // seconds until expiry
                });
            }
        }

        // Since LHDN API doesn't have a dedicated token verification endpoint,
        // we'll assume the token is valid if it exists and hasn't expired
        console.log('LHDN auth-status: Token exists and appears valid');
        return res.status(200).json({
            authenticated: true,
            success: true,
            message: 'Authentication valid',
            expiresIn: tokenExpiry ? Math.floor((tokenExpiry - now) / 1000) : null
        });
    } catch (error) {
        console.error('LHDN auth-status: Error checking auth status:', error);
        return res.status(200).json({
            success: true, // Changed to true to avoid frontend errors
            authenticated: false,
            message: 'Error checking authentication status',
            error: error.message
        });
    }
});

// Sync endpoint
router.get('/sync', async (req, res) => {
    try {
            const apiData = await fetchRecentDocuments(req);
             // Log the start of document fetching
            await LoggingService.log({
                description: 'Starting document fetch from LHDN',
                username: req?.session?.user?.username || 'System',
                userId: req?.session?.user?.id,
                ipAddress: req?.ip,
                logType: LOG_TYPES.INFO,
                module: MODULES.API,
                action: ACTIONS.READ,
                status: STATUS.PENDING
            });
            await saveInboundStatus(apiData);

            res.json({ success: true });
        } catch (error) {
            console.error('Error syncing with API:', error);
            res.status(500).json({
                success: false,
                message: `Failed to sync with API: ${error.message}`
            });
        }
});

// Refresh documents endpoint - Force refresh from LHDN API
router.post('/documents/refresh', async (req, res) => {
    try {
        // Generate a unique request ID for tracking
        const requestId = `refresh-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
        console.log(`[${requestId}] Starting document refresh from LHDN API`);

        // Clear cache for documents
        cache.del('documents_recent');

        // Log the start of document fetching
        await LoggingService.log({
            description: 'Manually refreshing documents from LHDN',
            username: req?.session?.user?.username || 'System',
            userId: req?.session?.user?.id,
            ipAddress: req?.ip,
            logType: LOG_TYPES.INFO,
            module: MODULES.API,
            action: ACTIONS.READ,
            status: STATUS.PENDING,
            details: { requestId }
        });

        // Force fetch from API by setting forceRefresh flag
        req.query.forceRefresh = 'true';
        const apiData = await fetchRecentDocuments(req);

        // Save to database
        await saveInboundStatus(apiData);

        // Log success
        await LoggingService.log({
            description: 'Successfully refreshed documents from LHDN',
            username: req?.session?.user?.username || 'System',
            userId: req?.session?.user?.id,
            ipAddress: req?.ip,
            logType: LOG_TYPES.INFO,
            module: MODULES.API,
            action: ACTIONS.READ,
            status: STATUS.SUCCESS,
            details: {
                requestId,
                documentCount: apiData?.result?.length || 0
            }
        });

        res.json({
            success: true,
            message: 'Successfully refreshed documents from LHDN',
            count: apiData?.result?.length || 0,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error refreshing documents from LHDN API:', error);

        // Log error
        await LoggingService.log({
            description: 'Error refreshing documents from LHDN',
            username: req?.session?.user?.username || 'System',
            userId: req?.session?.user?.id,
            ipAddress: req?.ip,
            logType: LOG_TYPES.ERROR,
            module: MODULES.API,
            action: ACTIONS.READ,
            status: STATUS.ERROR,
            details: { error: error.message }
        });

        res.status(500).json({
            success: false,
            error: {
                message: `Failed to refresh documents: ${error.message}`,
                code: error.code || 'UNKNOWN_ERROR'
            }
        });
    }
});

// Update display-details endpoint to fetch all required data
router.get('/documents/:uuid/display-details', async (req, res) => {
    const lhdnConfig = await getLHDNConfig();

    try {
        const { uuid } = req.params;

        // Log the request details
        console.log('Fetching details for document:', {
            uuid,
            user: req.session.user,
            timestamp: new Date().toISOString()
        });

        // API route must return JSON (never redirect to HTML login) — fetch() expects JSON.
        if (!req.session?.user) {
            return res.status(401).json({
                success: false,
                message: 'Not authenticated. Please sign in again.',
                code: 'SESSION_MISSING'
            });
        }

        const { getTokenSession, readTokenFromFile } = require('../../services/token-prisma.service');
        let accessToken = req.session.accessToken || req.session.lhdn?.accessToken;

        if (!accessToken) {
            try {
                const tokenData = readTokenFromFile();
                if (tokenData?.access_token) {
                    accessToken = tokenData.access_token;
                    req.session.accessToken = accessToken;
                }
            } catch (fileError) {
                console.warn('display-details: Error reading token from file:', fileError);
            }
        }

        if (!accessToken) {
            try {
                accessToken = await getTokenSession();
                if (accessToken) {
                    req.session.accessToken = accessToken;
                }
            } catch (tokenError) {
                console.warn('display-details: Error getting token:', tokenError);
            }
        }

        if (!accessToken) {
            return res.status(401).json({
                success: false,
                message: 'No LHDN access token. Reconnect LHDN from settings or refresh the page.',
                code: 'TOKEN_MISSING'
            });
        }

        // Get document details directly from LHDN API using raw endpoint
        console.log('Fetching raw document from LHDN API...');
        const response = await axios.get(`${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/raw`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const documentData = response.data;
        console.log('Raw document data:', JSON.stringify(documentData, null, 2));

        // Get document details from LHDN API
        const detailsResponse = await axios.get(`${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/details`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const detailsData = detailsResponse.data;
        console.log('Raw document details:', JSON.stringify(detailsData, null, 2));

        // Helper function to get ID information
        function getPartyIdentification(partyIdentification) {
            const idTypes = ['TIN', 'BRN', 'NRIC', 'Passport', 'Army', 'SST'];
            const result = {
                tin: null,
                registrationNo: null,
                taxRegNo: null,
                idType: 'NA',
                idNumber: 'NA'
            };

            if (!partyIdentification) return result;

            // Get TIN
            const tinInfo = partyIdentification.find(id => id.ID[0].schemeID === 'TIN');
            if (tinInfo) {
                result.tin = tinInfo.ID[0]._;
            }

            // Get Registration Number (try BRN first, then other types)
            const brnInfo = partyIdentification.find(id => id.ID[0].schemeID === 'BRN');
            if (brnInfo) {
                result.registrationNo = brnInfo.ID[0]._;
                result.idType = 'BRN';
                result.idNumber = brnInfo.ID[0]._;
            } else {
                // Try other ID types in order
                for (const idType of idTypes) {
                    if (idType === 'TIN' || idType === 'SST') continue;
                    const idInfo = partyIdentification.find(id => id.ID[0].schemeID === idType);
                    if (idInfo) {
                        result.registrationNo = idInfo.ID[0]._;
                        result.idType = idType;
                        result.idNumber = idInfo.ID[0]._;
                        break;
                    }
                }
            }

            // Get Tax Registration Number (SST)
            const sstInfo = partyIdentification.find(id => id.ID[0].schemeID === 'SST');
            if (sstInfo) {
                result.taxRegNo = sstInfo.ID[0]._;
            }

            return result;
        }

        // Process validation results
        // This section processes validation results but doesn't use them
        // Keeping the code for future reference
        if (detailsData.validationResults) {
            /* Commented out unused code
            const processedResults = {
                status: detailsData.status,
                validationSteps: detailsData.validationResults.validationSteps?.map(step => {
                    let errors = [];
                    if (step.error) {
                        if (Array.isArray(step.error.errors)) {
                            errors = step.error.errors.map(err => ({
                                code: err.code || 'VALIDATION_ERROR',
                                message: err.message || err.toString(),
                                field: err.field || null,
                                value: err.value || null,
                                details: err.details || null
                            }));
                        } else if (typeof step.error === 'object') {
                            errors = [{
                                code: step.error.code || 'VALIDATION_ERROR',
                                message: step.error.message || step.error.toString(),
                                field: step.error.field || null,
                                value: step.error.value || null,
                                details: step.error.details || null
                            }];
                        } else {
                            errors = [{
                                code: 'VALIDATION_ERROR',
                                message: step.error.toString(),
                                field: null,
                                value: null,
                                details: null
                            }];
                        }
                    }

                    return {
                        name: step.name || 'Validation Step',
                        status: step.status || 'Invalid',
                        error: errors.length > 0 ? { errors } : null,
                        timestamp: step.timestamp || new Date().toISOString()
                    };
                }) || [],
                summary: {
                    totalSteps: detailsData.validationResults.validationSteps?.length || 0,
                    failedSteps: detailsData.validationResults.validationSteps?.filter(step => step.status === 'Invalid' || step.error)?.length || 0,
                    lastUpdated: new Date().toISOString()
                }
            };
            */
        }

        // Check if document field exists and can be parsed
        if (!documentData.document) {
            // Handle case when document field is not present
            const supplierIdentification = getPartyIdentification([
                { ID: [{ schemeID: 'TIN', _: documentData.supplierTin }] },
                { ID: [{ schemeID: 'BRN', _: documentData.supplierRegistrationNo }] },
                { ID: [{ schemeID: 'SST', _: documentData.supplierSstNo }] }
            ]);

            const customerIdentification = getPartyIdentification([
                { ID: [{ schemeID: 'TIN', _: documentData.receiverTin }] },
                { ID: [{ schemeID: 'BRN', _: documentData.receiverRegistrationNo }] },
                { ID: [{ schemeID: 'SST', _: documentData.receiverSstNo }] }
            ]);

            const docCurrencyFallback = detailsData.documentCurrencyCode || detailsData.documentCurrency || null;
            persistDocumentCurrencyIfNull(uuid, docCurrencyFallback);

            return res.json({
                success: true,
                documentInfo: {
                    uuid: documentData.uuid,
                    submissionUid: documentData.submissionUid,
                    longId: detailsData.longId,
                    internalId: documentData.internalId,
                    status: documentData.status,
                    documentCurrency: docCurrencyFallback,
                    validationResults: detailsData.validationResults,
                    supplierName: documentData.supplierName,
                    supplierTIN: supplierIdentification.tin,
                    supplierRegistrationNo: supplierIdentification.registrationNo,
                    supplierSstNo: supplierIdentification.taxRegNo,
                    supplierMsicCode: documentData.supplierMsicCode,
                    supplierAddress: documentData.supplierAddress,
                    receiverName: documentData.receiverName,
                    receiverTIN: customerIdentification.tin,
                    receiverRegistrationNo: customerIdentification.registrationNo,
                    receiverSstNo: customerIdentification.taxRegNo,
                    receiverAddress: documentData.receiverAddress
                },
                supplierInfo: {
                    company: documentData.supplierName,
                    tin: supplierIdentification.tin,
                    registrationNo: supplierIdentification.registrationNo,
                    taxRegNo: supplierIdentification.taxRegNo,
                    idType: supplierIdentification.idType,
                    idNumber: supplierIdentification.idNumber,
                    msicCode: documentData.supplierMsicCode,
                    address: documentData.supplierAddress
                },
                customerInfo: {
                    company: documentData.receiverName,
                    tin: customerIdentification.tin,
                    registrationNo: customerIdentification.registrationNo,
                    taxRegNo: customerIdentification.taxRegNo,
                    idType: customerIdentification.idType,
                    idNumber: customerIdentification.idNumber,
                    address: documentData.receiverAddress
                },
                paymentInfo: {
                    totalIncludingTax: documentData.totalSales,
                    totalExcludingTax: documentData.totalExcludingTax,
                    taxAmount: documentData.totalSales - (documentData.totalExcludingTax || 0),
                    irbmUniqueNo: documentData.uuid,
                    irbmlongId: documentData.longId
                }
            });
        }

        // If document field exists, parse it and extract detailed info
        try {
            let parsedDocument;
            const doc = documentData.document;

            // Helper to locate Invoice in parsed result (handles namespaces, explicitRoot, wrappers)
            function findInvoice(parsed) {
                if (!parsed || typeof parsed !== 'object') return null;
                // explicitRoot or 'root' wrapper
                if (parsed.root && typeof parsed.root === 'object') return findInvoice(parsed.root);
                // Direct Invoice key (with or without namespace prefix)
                for (const k of Object.keys(parsed)) {
                    const local = (k && k.includes(':')) ? k.split(':').pop() : k;
                    if (local === 'Invoice') {
                        const v = parsed[k];
                        return (Array.isArray(v) && v.length) ? v[0] : (v && typeof v === 'object' ? v : null);
                    }
                }
                // Single wrapper element, e.g. { Document: [{ Invoice: [...] }] }
                const keys = Object.keys(parsed);
                if (keys.length === 1) {
                    const v = parsed[keys[0]];
                    const child = (Array.isArray(v) && v.length) ? v[0] : v;
                    if (child && typeof child === 'object') return findInvoice(child);
                }
                return null;
            }

            async function parseDoc(input) {
                if (typeof input === 'string' && input.trim().startsWith('<')) {
                    return parseStringPromise(input, {
                        explicitArray: true,
                        tagNameProcessors: [processors.stripPrefix]
                    });
                }
                if (typeof input === 'string') return JSON.parse(input);
                return input;
            }

            if (doc != null && typeof doc === 'object') {
                const xmlStr = doc.content || doc.document || doc.value || doc.data;
                if (typeof xmlStr === 'string' && xmlStr.trim().startsWith('<')) {
                    parsedDocument = await parseDoc(xmlStr);
                } else {
                    parsedDocument = doc;
                }
            } else if (typeof doc === 'string') {
                parsedDocument = await parseDoc(doc);
            } else {
                throw new Error('Invalid document format: document is not a string or object');
            }

            const validationResults = detailsData.validationResults;
            const invoice = findInvoice(parsedDocument);
            if (!invoice) {
                const keys = (parsedDocument && typeof parsedDocument === 'object') ? Object.keys(parsedDocument).join(', ') : 'n/a';
                throw new Error(`Invoice element not found in parsed document. Top-level keys: ${keys}`);
            }
            const supplierParty = invoice.AccountingSupplierParty[0].Party[0];
            const customerParty = invoice.AccountingCustomerParty[0].Party[0];

            // Get identification info for both parties
            const supplierIdentification = getPartyIdentification(supplierParty.PartyIdentification);
            const customerIdentification = getPartyIdentification(customerParty.PartyIdentification);

            // Backfill WP_Inbound_Status.documentCurrency when null (same source as PDF: UBL DocumentCurrencyCode)
            const docCurrency = getDocCurrencyFromInvoice(invoice) || detailsData.documentCurrencyCode || detailsData.documentCurrency || null;
            persistDocumentCurrencyIfNull(uuid, docCurrency);

            return res.json({
                success: true,
                documentInfo: {
                    uuid: documentData.uuid,
                    submissionUid: documentData.submissionUid,
                    longId: detailsData.longId,
                    irbmlongId: documentData.longId,
                    internalId: documentData.internalId,
                    status: documentData.status,
                    documentCurrency: docCurrency,
                    validationResults: validationResults,
                    supplierName: documentData.issuerName,
                    supplierTIN: supplierIdentification.tin,
                    supplierRegistrationNo: supplierIdentification.registrationNo,
                    supplierSstNo: supplierIdentification.taxRegNo,
                    supplierMsicCode: supplierParty.IndustryClassificationCode?.[0]._ || documentData.supplierMsicCode,
                    supplierAddress: supplierParty.PostalAddress[0].AddressLine
                        .map(line => line.Line[0]._)
                        .filter(Boolean)
                        .join(', ') || documentData.supplierAddress,
                    receiverName: documentData.receiverName,
                    receiverTIN: customerIdentification.tin,
                    receiverRegistrationNo: customerIdentification.registrationNo,
                    receiverSstNo: customerIdentification.taxRegNo,
                    receiverAddress: customerParty.PostalAddress[0].AddressLine
                        .map(line => line.Line[0]._)
                        .filter(Boolean)
                        .join(', ') || documentData.receiverAddress
                },
                supplierInfo: {
                    company: supplierParty.PartyLegalEntity[0].RegistrationName[0]._ || documentData.supplierName,
                    tin: supplierIdentification.tin,
                    registrationNo: supplierIdentification.registrationNo,
                    taxRegNo: supplierIdentification.taxRegNo,
                    idType: supplierIdentification.idType,
                    idNumber: supplierIdentification.idNumber,
                    msicCode: supplierParty.IndustryClassificationCode?.[0]._ || documentData.supplierMsicCode,
                    address: supplierParty.PostalAddress[0].AddressLine
                        .map(line => line.Line[0]._)
                        .filter(Boolean)
                        .join(', ') || documentData.supplierAddress
                },
                customerInfo: {
                    company: customerParty.PartyLegalEntity[0].RegistrationName[0]._ || documentData.receiverName,
                    tin: customerIdentification.tin,
                    registrationNo: customerIdentification.registrationNo,
                    taxRegNo: customerIdentification.taxRegNo,
                    idType: customerIdentification.idType,
                    idNumber: customerIdentification.idNumber,
                    address: customerParty.PostalAddress[0].AddressLine
                        .map(line => line.Line[0]._)
                        .filter(Boolean)
                        .join(', ') || documentData.receiverAddress
                },
                paymentInfo: {
                    totalIncludingTax: invoice.LegalMonetaryTotal?.[0]?.TaxInclusiveAmount?.[0]._ || documentData.totalSales,
                    totalExcludingTax: invoice.LegalMonetaryTotal?.[0]?.TaxExclusiveAmount?.[0]._ || documentData.totalExcludingTax,
                    taxAmount: invoice.TaxTotal?.[0]?.TaxAmount?.[0]._ || (documentData.totalSales - (documentData.totalExcludingTax || 0)),
                    irbmUniqueNo: documentData.uuid,
                    irbmlongId: documentData.longId
                }
            });
        } catch (parseError) {
            console.error('Error parsing document:', parseError);
            // Handle parse error by returning basic info
            return res.status(500).json({
                success: false,
                message: 'Failed to parse document data',
                error: {
                    name: parseError.name,
                    details: parseError.message
                }
            });
        }

    } catch (error) {
        console.error('Error fetching document details:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch document details',
            error: {
                name: error.name,
                details: error.response?.data || error.stack
            }
        });
    }
});



// Helper function to get template data
async function getTemplateData(uuid, accessToken, user) {
    // Get LHDN configuration
    const lhdnConfig = await getLHDNConfig();

    // Get raw document data
    const response = await axios.get(`${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/raw`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    });

    // Get company data using Prisma
    const company = await prisma.wP_COMPANY_SETTINGS.findFirst({
        where: { TIN: user.TIN }
    });

    // Handle company logo
    const logoPath = company?.CompanyImage
        ? path.join(__dirname, '../../public', company.CompanyImage)
        : null;

    let logoBase64;
    try {
        const logoBuffer = await fsPromises.readFile(logoPath);
        const logoExt = path.extname(logoPath).substring(1);
        logoBase64 = `data:image/${logoExt};base64,${logoBuffer.toString('base64')}`;
    } catch (error) {
        logoBase64 = null;
    }

    // Parse document data
    const rawData = response.data;
    const documentData = JSON.parse(rawData.document);
    const invoice = documentData.Invoice[0];

    const supplierParty = invoice.AccountingSupplierParty[0].Party[0];
    const customerParty = invoice.AccountingCustomerParty[0].Party[0];

   // Generate QR code
   console.log('Generating QR code...');
   const longId = rawData.longId || rawData.longID;
   const lhdnUuid = rawData.uuid;
   const portalUrl = getPortalUrl(lhdnConfig.environment);
   const qrCodeUrl = `https://${portalUrl}/${lhdnUuid}/share/${longId}`;
   console.log('QR Code URL:', qrCodeUrl);

   const qrCodeDataUrl = await QRCode.toDataURL(qrCodeUrl, {
       width: 200,
       margin: 2,
       color: { dark: '#000000', light: '#ffffff' }
   });
   console.log('✓ QR code generated successfully');


    // Get tax information from UBL structure
    const taxTotal = invoice.TaxTotal?.[0];
    const taxSubtotal = taxTotal?.TaxSubtotal?.[0];
    const taxCategory = taxSubtotal?.TaxCategory?.[0];
    const totalTaxAmount = taxTotal?.TaxAmount?.[0]._ || 0;
    const taxExempReason = taxCategory?.TaxExemptionReason?.[0]._ || 'Not Applicable';

    // Map the tax type according to SDK documentation
    const getTaxTypeDescription = (code) => {
        const taxTypes = {
            '01': 'Sales Tax',
            '02': 'Service Tax',
            '03': 'Tourism Tax',
            '04': 'High-Value Goods Tax',
            '05': 'Sales Tax on Low Value Goods',
            '06': 'Not Applicable',
            'E': 'Tax exemption'
        };
        return taxTypes[code] || code;
    };

    const idTypes = ['TIN', 'BRN', 'NRIC', 'Passport', 'Army', 'SST', 'TTX'];
    function getIdTypeAndNumber(partyIdentification) {
        const tinInfo = partyIdentification?.find(id => id.ID[0].schemeID === 'TIN');
        if (!tinInfo) {
            throw new Error('TIN is mandatory and not found.');
        }

        for (const idType of idTypes) {
            if (idType === 'TIN') continue;
            const idInfo = partyIdentification?.find(id => id.ID[0].schemeID === idType);
            if (idInfo) {
                return { type: idType, number: idInfo.ID[0]._ };
            }
        }
        return { type: 'NA', number: 'NA' };
    }

    const supplierIdInfo = getIdTypeAndNumber(supplierParty.PartyIdentification, idTypes);
    const customerIdInfo = getIdTypeAndNumber(customerParty.PartyIdentification, idTypes);

    // Helper function to get label based on description for AdditionalDocumentReference
    const getReferenceLabel = (description) => {
        if (!description || description === 'Not Applicable' || description === 'NA' || description === '') {
            return 'Additional Document Reference';
        }
        const descUpper = description.toUpperCase();
        if (descUpper.includes('EXEMP')) {
            return 'Exemption Cert. No.';
        } else if (descUpper.includes('PO') || descUpper.includes('PURCHASE')) {
            return 'Cust. P/O No.';
        } else if (descUpper.includes('DO') || descUpper.includes('DELIVERY')) {
            return 'Cust. D/O No.';
        } else if (descUpper.includes('INVOICE')) {
            return 'Invoice Reference No.';
        } else if (descUpper.includes('QUOTE') || descUpper.includes('QUOTATION')) {
            return 'Quotation Reference No.';
        } else if (descUpper.includes('CONTRACT')) {
            return 'Contract Reference No.';
        } else {
            // Use description as label if no match
            return description;
        }
    };

    // Process tax information for each line item
    const taxSummary = {};
    const items = await Promise.all(invoice.InvoiceLine?.map(async (line, index) => {
        const lineAmount = parseFloat(line.LineExtensionAmount?.[0]._ || 0);
        const lineTax = parseFloat(line.TaxTotal?.[0]?.TaxAmount?.[0]._ || 0);
        const quantity = parseFloat(line.InvoicedQuantity?.[0]._ || 0);
        const unitPrice = parseFloat(line.Price?.[0]?.PriceAmount?.[0]._ || 0);
        const discount = parseFloat(line.AllowanceCharge?.[0]?.Amount?.[0]._ || 0);
        const unitCode = line.InvoicedQuantity?.[0]?.unitCode || 'XNA';
        const taxlineCurrency = line.TaxTotal?.[0]?.TaxAmount?.[0]?.currencyID || 'MYR';
        const allowanceCharges = parseFloat(line.AllowanceCharge?.[0]?.Amount?.[0]._ || 0);

        // Get unit type name
        const unitType = await getUnitType(unitCode);

        // Extract tax information for this line
        const lineTaxCategory = line.TaxTotal?.[0]?.TaxSubtotal?.[0]?.TaxCategory?.[0];
        const taxTypeCode = lineTaxCategory?.ID?.[0]._ || '06';
        const taxPercent = parseFloat(lineTaxCategory?.Percent?.[0]._ || 0);

         // Calculate hypothetical tax for exempt items (always 0.00)
         let hypotheticalTax = '0.00';
         let isExempt = taxTypeCode === 'E';

         // Add to tax summary
         const taxKey = `${taxTypeCode}_${taxPercent}`;
         if (!taxSummary[taxKey]) {
             taxSummary[taxKey] = {
                 taxType: taxTypeCode,
                 taxRate: taxPercent,
                 baseAmount: 0,
                 taxAmount: 0,
                 hypotheticalTaxAmount: 0
             };
         }
         taxSummary[taxKey].baseAmount += lineAmount;
         taxSummary[taxKey].taxAmount += lineTax;
         taxSummary[taxKey].hypotheticalTaxAmount += 0; // Always 0


        // Format quantity with exactly 2 decimal places
        const formattedQuantity = quantity.toLocaleString('en-MY', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
            useGrouping: false
        });

        // Format unit price with exactly 4 decimal places
        const formattedUnitPrice = unitPrice.toLocaleString('en-MY', {
            minimumFractionDigits: 4,
            maximumFractionDigits: 4,
            useGrouping: false
        });

        return {
            No: index + 1,
            Cls: line.Item?.[0]?.CommodityClassification?.[0]?.ItemClassificationCode?.[0]._ || 'NA',
            Description: line.Item?.[0]?.Description?.[0]._ || 'NA',
            Quantity: formattedQuantity,
            UOM: unitType, // Display unit type name instead of code
            UnitPrice: formattedUnitPrice,
            QtyAmount: lineAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            Disc: discount === 0 ? '0.00' : discount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            Charges: allowanceCharges.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00',
            LineTaxPercent: taxPercent.toFixed(2),
            LineTaxAmount: lineTax.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            HypotheticalTax: hypotheticalTax,  // Add hypothetical tax to line items
            Total: (parseFloat(line.ItemPriceExtension?.[0]?.Amount?.[0]._ || 0) + lineTax).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            TaxType: getTaxTypeDescription(taxTypeCode)
        };
    }) || []);

    const currentInvoiceType = invoice.InvoiceTypeCode?.[0]._ || 'NA';
    const einvoiceType = await getInvoiceTypes(currentInvoiceType);

    const taxSummaryArray = Object.values(taxSummary).map(summary => ({
        baseAmount: parseFloat(summary.baseAmount).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        taxType: getTaxTypeDescription(summary.taxType),
        taxRate: parseFloat(summary.taxRate).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        taxAmount: parseFloat(summary.taxAmount).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        LHDNtaxExemptionReason: taxExempReason || 'Not Applicable',
        hypotheticalTaxAmount: summary.taxType === 'E' ?
        parseFloat(summary.hypotheticalTaxAmount).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) :
        '0.00'
    }));

    // Sort the taxSummaryArray based on the desired order
    const taxTypeOrder = ['Service Tax', 'Sales Tax', 'Tourism Tax', 'High-Value Goods Tax', 'Sales Tax on Low Value Goods', 'Not Applicable', 'Tax exemption', 'Other'];
    taxSummaryArray.sort((a, b) => taxTypeOrder.indexOf(a.taxType) - taxTypeOrder.indexOf(b.taxType));



    const templateData = {
        CompanyLogo: logoBase64,
        companyName: supplierParty.PartyLegalEntity?.[0]?.RegistrationName?.[0]._ || 'NA',
        companyAddress: supplierParty.PostalAddress?.[0]?.AddressLine?.map(line => line.Line[0]._).join(', ') || 'NA',
        companyPhone: supplierParty.Contact?.[0]?.Telephone?.[0]._ || 'NA',
        companyEmail: supplierParty.Contact?.[0]?.ElectronicMail?.[0]._ || 'NA',

        internalId: rawData.internalId || 'NA',

        InvoiceTypeCode: einvoiceType,
        InvoiceTypeName: rawData.typeName || 'NA',
        InvoiceVersion: rawData.typeVersionName || 'NA',
        InvoiceCode: invoice.ID?.[0]._ || rawData.internalId || 'NA',
        UniqueIdentifier: rawData.uuid || 'NA',
        lhdnLink: qrCodeUrl,

        dateTimeReceived: new Date(invoice.IssueDate[0]._ + 'T' + invoice.IssueTime[0]._).toLocaleString(),
        documentCurrency: invoice.DocumentCurrencyCode?.[0]._ || 'MYR',
        taxCurrency: invoice.TaxCurrencyCode?.[0]._ || 'MYR',
        TaxExchangeRate: invoice.TaxExchangeRate?.[0]?.CalculationRate?.[0]._ || '----',
        issueDate: invoice.IssueDate?.[0]._ || 'NA',
        issueTime: invoice.IssueTime?.[0]._ || 'NA',


        OriginalInvoiceRef: invoice.BillingReference?.[0]?.InvoiceDocumentReference?.[0]?.ID?.[0]._ || 'Not Applicable',
        OriginalInvoiceDateTime: invoice.IssueDate?.[0]._ ? new Date(invoice.IssueDate[0]._ + 'T' + invoice.IssueTime[0]._).toLocaleString() : 'Not Applicable',
        OriginalInvoiceStartDate: invoice.InvoicePeriod?.[0]?.StartDate?.[0]._ || '-- / -- / --',
        OriginalInvoiceEndDate: invoice.InvoicePeriod?.[0]?.EndDate?.[0]._ || '-- / -- / --',
        OriginalInvoiceDescription: invoice.InvoicePeriod?.[0]?.Description?.[0]._ || '',

        // Extract AdditionalDocumentReference entries from LHDN API response
        // Always show all three fields: Exemption Cert. No., Cust. P/O No., Cust. D/O No.
        additionalDocumentReferences: (() => {
            // Initialize the three required fields
            const refsMap = {
                'Exemption Cert. No.': null,
                'Cust. P/O No.': null,
                'Cust. D/O No.': null
            };

            // Process all AdditionalDocumentReference entries from API
            (invoice.AdditionalDocumentReference || []).forEach(ref => {
                const id = ref.ID?.[0]?._ || '';
                const documentType = ref.DocumentType?.[0]?._ || '';
                const documentDescription = ref.DocumentDescription?.[0]?._ || '';
                
                // Only process if ID is valid and not "NA"
                if (id && id !== 'Not Applicable' && id !== 'NA' && id !== '') {
                    const descUpper = (documentDescription || '').toUpperCase();
                    
                    // Categorize based on description (case-insensitive matching)
                    if (descUpper.includes('EXEMP')) {
                        // Exemption Cert - only set if not already set
                        if (!refsMap['Exemption Cert. No.']) {
                            refsMap['Exemption Cert. No.'] = id;
                        }
                    } else if (descUpper.includes('PO') || descUpper.includes('PURCHASE')) {
                        // Purchase Order - only set if not already set
                        if (!refsMap['Cust. P/O No.']) {
                            refsMap['Cust. P/O No.'] = id;
                        }
                    } else if (descUpper.includes('DO') || descUpper.includes('DELIVERY')) {
                        // Delivery Order - only set if not already set
                        if (!refsMap['Cust. D/O No.']) {
                            refsMap['Cust. D/O No.'] = id;
                        }
                    }
                    // Ignore other types to prevent duplicates
                }
            });

            // Always return all three fields in order, with "Not Applicable" if empty
            return [
                {
                    label: 'Exemption Cert. No.',
                    id: refsMap['Exemption Cert. No.'] || 'Not Applicable'
                },
                {
                    label: 'Cust. P/O No.',
                    id: refsMap['Cust. P/O No.'] || 'Not Applicable'
                },
                {
                    label: 'Cust. D/O No.',
                    id: refsMap['Cust. D/O No.'] || 'Not Applicable'
                }
            ];
        })(),

        SupplierTIN: supplierParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'TIN')?.ID[0]._ || 'NA',
        SupplierRegistrationNumber: supplierParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'BRN')?.ID[0]._ || 'NA',
        SupplierSSTID: supplierParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'SST')?.ID[0]._ || 'NA',
        SupplierMSICCode: supplierParty.IndustryClassificationCode?.[0]._ || '00000',
        SupplierBusinessActivity: supplierParty.IndustryClassificationCode?.[0]?.name || 'NOT APPLICABLE',
        SupplierIdType: supplierIdInfo.type,
        SupplierIdNumber: supplierIdInfo.number,

        BuyerTIN: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'TIN')?.ID[0]._ || 'NA',
        BuyerName: customerParty.PartyLegalEntity?.[0]?.RegistrationName?.[0]._ || 'NA',
        BuyerPhone: customerParty.Contact?.[0]?.Telephone?.[0]._ || 'NA',
        BuyerEmail: customerParty.Contact?.[0]?.ElectronicMail?.[0]._ || 'NA',
        BuyerRegistrationNumber: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'BRN')?.ID[0]._ || 'NA',
        BuyerAddress: customerParty.PostalAddress?.[0]?.AddressLine?.map(line => line.Line[0]._).join(', ') || 'NA',
        BuyerSSTID: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'SST')?.ID[0]._ || 'NA',
        BuyerMSICCode: customerParty.IndustryClassificationCode?.[0]._ || '00000',
        BuyerBusinessActivity: customerParty.IndustryClassificationCode?.[0]?.name || 'NOT APPLICABLE',
        BuyerIdType: customerIdInfo.type,
        BuyerIdNumber: customerIdInfo.number,

        Prepayment: parseFloat(invoice.LegalMonetaryTotal?.[0]?.PrepaidAmount?.[0]._ || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        TotalNetAmount: parseFloat(rawData.totalNetAmount).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00',
        Subtotal: parseFloat(invoice.LegalMonetaryTotal?.[0]?.LineExtensionAmount?.[0]._ || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        TotalExcludingTax: parseFloat(invoice.LegalMonetaryTotal?.[0]?.TaxExclusiveAmount?.[0]._ || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        TotalIncludingTax: parseFloat(invoice.LegalMonetaryTotal?.[0]?.TaxInclusiveAmount?.[0]._ || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        TotalPayableAmount: parseFloat(invoice.LegalMonetaryTotal?.[0]?.PayableAmount?.[0]._ || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        TotalTaxAmount: Object.values(taxSummary).reduce((sum, item) => sum + item.taxAmount, 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),

        TaxRate: Object.values(taxSummary).reduce((sum, item) => sum + item.taxRate, 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        TaxAmount: Object.values(taxSummary).reduce((sum, item) => sum + item.taxAmount, 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),

        items: items,

        TaxType: taxCategory?.ID?.[0]._ || '06',
        TaxSchemeId: getTaxTypeDescription(taxCategory?.ID?.[0]._ || '06'),

        // taxSummary: taxSummaryArray.map(item => ({
        //     taxType: item.taxType,
        //     taxRate: item.taxRate,
        //     totalAmount: item.baseAmount || '0.00',
        //     totalTaxAmount: item.taxAmount || '0.00'
        // })),

         taxSummary: taxSummaryArray.map(item => ({
            taxType: item.taxType,
            taxRate: item.taxRate,
            totalAmount: item.baseAmount || '0.00',
            totalTaxAmount: item.taxAmount || '0.00',
            hypotheticalTaxAmount: item.hypotheticalTaxAmount || '0.00',
            LHDNtaxExemptionReason: taxExempReason || 'Not Applicable',
        })),


        companyName: supplierParty.PartyLegalEntity?.[0]?.RegistrationName?.[0]._ || 'NNot ApplicableA',
        companyAddress: supplierParty.PostalAddress?.[0]?.AddressLine?.map(line => line.Line[0]._).join(', ') || 'Not Applicable',
        companyPhone: supplierParty.Contact?.[0]?.Telephone?.[0]._ || 'Not Applicable',
        companyEmail: supplierParty.Contact?.[0]?.ElectronicMail?.[0]._ || 'Not Applicable',

        InvoiceVersionCode: invoice.InvoiceTypeCode?.[0].listVersionID || 'Not Applicable',
        InvoiceVersion: rawData.typeVersionName || 'NA',
        InvoiceCode: invoice.ID?.[0]._ || rawData.internalId || 'Not Applicable',
        UniqueIdentifier: rawData.uuid || 'Not Applicable',
        LHDNlongId: longId || 'Not Applicable',

        dateTimeReceived: new Date(invoice.IssueDate[0]._ + 'T' + invoice.IssueTime[0]._).toLocaleDateString('en-GB'),
        issueDate: invoice.IssueDate?.[0]._ ? new Date(invoice.IssueDate[0]._).toLocaleDateString('en-GB') : 'Not Applicable',
        issueTime: invoice.IssueTime?.[0]._ || 'Not Applicable',

        startPeriodDate: invoice.InvoicePeriod?.[0]?.StartDate?.[0]._ || 'Not Applicable',
        endPeriodDate: invoice.InvoicePeriod?.[0]?.EndDate?.[0]._ || 'Not Applicable',
        dateDescription: invoice.InvoicePeriod?.[0]?.Description?.[0]._ || 'Not Applicable',

        qrCode: qrCodeDataUrl,
        QRLink: qrCodeUrl,
        DigitalSignature: rawData.digitalSignature || '-',
        validationDateTime: new Date(rawData.dateTimeValidated).toLocaleString(),
    };

    // Backfill WP_Inbound_Status.documentCurrency when null (same source as PDF: UBL DocumentCurrencyCode)
    const docCurrency = getDocCurrencyFromInvoice(invoice);
    persistDocumentCurrencyIfNull(uuid, docCurrency);

   return templateData;
}

//route to check if PDF exists
router.get('/documents/:uuid/check-pdf', async (req, res) => {
    const { uuid } = req.params; // longId is not used
    const requestId = req.requestId;

    try {
        console.log(`[${requestId}] Checking PDF existence for ${uuid}`);
        const tempDir = path.join(__dirname, '../../public/temp');
        const pdfPath = path.join(tempDir, `${uuid}.pdf`);
        const hashPath = path.join(tempDir, `${uuid}.hash`);

        console.log(`[${requestId}] Paths:`, {
            pdfPath,
            hashPath
        });

        try {
            await fsPromises.access(pdfPath);
            console.log(`[${requestId}] PDF exists at ${pdfPath}`);
            return res.json({
                exists: true,
                url: `/temp/${uuid}.pdf`
            });
        } catch (error) {
            console.log(`[${requestId}] PDF not found at ${pdfPath}`);
            return res.json({ exists: false });
        }
    } catch (error) {
        console.error(`[${requestId}] Error checking PDF:`, error);
        return res.status(500).json({
            success: false,
            message: 'Failed to check PDF existence',
            error: error.message
        });
    }
});

// Update PDF generation route
router.post('/documents/:uuid/pdf', async (req, res) => {
    const { uuid } = req.params;
    const requestId = req.requestId;

    try {
        console.log(`[${requestId}] Starting PDF Generation Process for ${uuid}`);

        const tempDir = path.join(__dirname, '../../public/temp');
        const pdfPath = path.join(tempDir, `${uuid}.pdf`);
        const hashPath = path.join(tempDir, `${uuid}.hash`);

        console.log(`[${requestId}] Paths:`, {
            tempDir,
            pdfPath,
            hashPath
        });

        // Check directory exists
        try {
            await fsPromises.access(tempDir);
            console.log(`[${requestId}] Temp directory exists`);
        } catch {
            console.log(`[${requestId}] Creating temp directory`);
            await fsPromises.mkdir(tempDir, { recursive: true });
        }

        // Auth check
        if (!req.session?.user) {
            console.log(`[${requestId}] No user session found`);
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        console.log(`[${requestId}] User authenticated:`, {
            id: req.session.user.id,
            TIN: req.session.user.TIN
        });

        const forceRegenerate = req.query.force === 'true';
        console.log(`[${requestId}] Force regenerate:`, forceRegenerate);

        // Get template data
        console.log(`[${requestId}] Fetching template data...`);
        const templateData = await getTemplateData(uuid, req.session.accessToken, req.session.user);
        console.log(`[${requestId}] Template data fetched successfully`);

        // Check if regeneration needed
        if (!forceRegenerate) {
            try {
                const storedHash = await fsPromises.readFile(hashPath, 'utf8');
                const currentHash = generateTemplateHash(templateData);

                console.log(`[${requestId}] Hash comparison:`, {
                    stored: storedHash.substring(0, 8),
                    current: currentHash.substring(0, 8),
                    matches: storedHash === currentHash
                });

                if (storedHash === currentHash) {
                    console.log(`[${requestId}] Using cached PDF`);
                    return res.json({
                        success: true,
                        url: `/temp/${uuid}.pdf`,
                        cached: true,
                        message: 'Loading existing PDF from cache...'
                    });
                }
            } catch (error) {
                console.log(`[${requestId}] Cache check failed:`, error.message);
            }
        }

        // Generate new PDF
        console.log(`[${requestId}] Generating new PDF...`);
        const newHash = generateTemplateHash(templateData);

        const templatePath = path.join(__dirname, '../../src/reports/original-invoice-template.html');
        console.log(`[${requestId}] Using template:`, templatePath);

        const templateContent = await fsPromises.readFile(templatePath, 'utf8');
        const template = jsrender.templates(templateContent);
        const html = template.render(templateData);

        console.log(`[${requestId}] Launching browser...`);
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });

        console.log(`[${requestId}] Setting page content...`);
        await page.setContent(html, { waitUntil: 'networkidle0' });

        console.log(`[${requestId}] Generating PDF...`);
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' }
        });

        await browser.close();
        console.log(`[${requestId}] Browser closed`);

        // Save files
        console.log(`[${requestId}] Saving PDF and hash...`);
        await fsPromises.writeFile(pdfPath, pdfBuffer);
        await fsPromises.writeFile(hashPath, newHash);

        console.log(`[${requestId}] PDF generated successfully:`, {
            path: pdfPath,
            hash: newHash.substring(0, 8),
            size: pdfBuffer.length
        });

        return res.json({
            success: true,
            url: `/temp/${uuid}.pdf`,
            cached: false,
            message: 'New PDF generated successfully'
        });

    } catch (error) {
        console.error(`[${requestId}] PDF Generation Error:`, {
            message: error.message,
            stack: error.stack,
            name: error.name
        });

        if (error.response?.status === 429) {
            return res.status(429).json({
                success: false,
                message: 'Server is busy. Please try again later.',
                retryAfter: error.response.headers['retry-after'] || 30
            });
        }

        return res.status(500).json({
            success: false,
            message: `Failed to generate PDF: ${error.message}`,
            details: error.stack
        });
    }
});

// TIN Validation route
router.get('/taxpayer/validate/:tin', limiter, async (req, res) => {
    const { tin } = req.params;
    const { idType, idValue } = req.query;
    const requestId = req.requestId || req.headers['x-request-id'] || Math.random().toString(36).substring(2, 15);

    console.log(`[${requestId}] TIN Validation Request:`, {
        tin,
        idType,
        idValue
    });

    try {
        // Input validation
        if (!tin || !idType || !idValue) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameters',
                error: {
                    code: 'BAD_ARGUMENT',
                    details: {
                        tin: !tin ? 'TIN is required' : null,
                        idType: !idType ? 'ID Type is required' : null,
                        idValue: !idValue ? 'ID Value is required' : null
                    }
                }
            });
        }

        // Validate ID Type
        const validIdTypes = ['NRIC', 'PASSPORT', 'BRN', 'ARMY'];
        if (!validIdTypes.includes(idType.toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid ID Type',
                error: {
                    code: 'BAD_ARGUMENT',
                    details: {
                        idType: `ID Type must be one of: ${validIdTypes.join(', ')}`
                    }
                }
            });
        }

        // Get LHDN configuration
        const lhdnConfig = await getLHDNConfig();

        // Check cache first
        const cacheKey = `tin_validation_${tin}_${idType}_${idValue}`;
        const cachedResult = cache.get(cacheKey);

        if (cachedResult) {
            console.log(`[${requestId}] Returning cached validation result for TIN: ${tin}`);
            return res.json({
                success: true,
                result: cachedResult,
                cached: true
            });
        }

        // Prepare standard LHDN API headers according to SDK specification
        const headers = {
            'Authorization': `Bearer ${req.session.accessToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Request-ID': requestId,
            'X-Date': req.headers['x-date'] || new Date().toISOString(),
            'X-Client-ID': req.headers['x-client-id'] || 'eInvoice-WebApp',
            'X-Forwarded-For': req.headers['x-forwarded-for'] || req.ip,
            'X-User-Agent': req.headers['x-user-agent'] || req.headers['user-agent'],
            'X-Channel': req.headers['x-channel'] || 'Web'
        };

        // Add User session related headers if available
        if (req.session?.user) {
            headers['X-User-ID'] = req.session.user.id;
            headers['X-User-TIN'] = req.session.user.TIN;
            headers['X-User-Name'] = req.session.user.username;
        }

        // Make API call to LHDN
        console.log(`[${requestId}] Calling LHDN API for TIN validation with standard headers...`);
        await axios.get( // Response is not used directly
            `${lhdnConfig.baseUrl}/api/v1.0/taxpayer/validate/${tin}`,
            {
                params: {
                    idType: idType.toUpperCase(),
                    idValue: idValue
                },
                headers: headers,
                timeout: lhdnConfig.timeout
            }
        );

        // Log successful validation
        await LoggingService.log({
            description: `TIN Validation successful for ${tin}`,
            username: req?.session?.user?.username || 'System',
            userId: req?.session?.user?.id,
            ipAddress: req?.ip,
            logType: LOG_TYPES.INFO,
            module: MODULES.API,
            action: ACTIONS.VALIDATE,
            status: STATUS.SUCCESS,
            details: { tin, idType, idValue, requestId }
        });

        // Cache the successful result
        const validationResult = {
            isValid: true,
            tin: tin,
            idType: idType,
            idValue: idValue,
            timestamp: new Date().toISOString(),
            requestId: requestId
        };
        cache.set(cacheKey, validationResult, 300); // Cache for 5 minutes

        return res.json({
            success: true,
            result: validationResult,
            cached: false
        });

    } catch (error) {
        console.error(`[${requestId}] TIN Validation Error:`, error);

        // Log validation error
        await LoggingService.log({
            description: `TIN Validation failed for ${tin}: ${error.message}`,
            username: req?.session?.user?.username || 'System',
            userId: req?.session?.user?.id,
            ipAddress: req?.ip,
            logType: LOG_TYPES.ERROR,
            module: MODULES.API,
            action: ACTIONS.VALIDATE,
            status: STATUS.FAILED,
            details: { tin, idType, idValue, error: error.message, requestId }
        });

        // Handle specific error cases
        if (error.response?.status === 404) {
            return res.status(404).json({
                success: false,
                message: 'Invalid TIN or ID combination',
                error: {
                    code: 'NOT_FOUND',
                    details: 'The provided TIN and ID combination cannot be found or is invalid',
                    requestId: requestId
                }
            });
        }

        if (error.response?.status === 400) {
            return res.status(400).json({
                success: false,
                message: 'Invalid input parameters',
                error: {
                    code: 'BAD_ARGUMENT',
                    details: error.response.data?.message || 'The provided parameters are invalid',
                    requestId: requestId
                }
            });
        }

        if (error.response?.status === 429) {
            return res.status(429).json({
                success: false,
                message: 'Rate limit exceeded',
                error: {
                    code: 'RATE_LIMIT_EXCEEDED',
                    details: 'Too many validation requests. Please try again later.',
                    retryAfter: error.response.headers['retry-after'] || 60,
                    requestId: requestId
                }
            });
        }

        // Generic error response
        return res.status(500).json({
            success: false,
            message: 'TIN validation failed',
            error: {
                code: 'INTERNAL_SERVER_ERROR',
                details: error.message,
                requestId: requestId
            }
        });
    }
});

// Refresh endpoint
router.post('/documents/refresh', async (req, res) => {
    console.log('LHDN documents refresh endpoint hit');
    try {
        if (!req.session?.user) {
            console.log('No user session found');
            return handleAuthError(req, res);
        }

        console.log('User from session:', req.session.user);

        try {
            // Get LHDN configuration
            const lhdnConfig = await getLHDNConfig();

            // Fetch documents with multiple pages
            console.log('Fetching fresh data from LHDN API with pagination...');

            // First, check for records with missing issuerName using Prisma
            const docsWithMissingData = await prisma.wP_INBOUND_STATUS.findMany({
                where: {
                    OR: [
                        { issuerTin: null },
                        { issuerTin: 'NULL' },
                        { issuerTin: '' },
                        { issuerName: null },
                        { issuerName: 'NULL' },
                        { issuerName: '' }
                    ]
                },
                select: { uuid: true }
            });

            if (docsWithMissingData.length > 0) {
                console.log(`Found ${docsWithMissingData.length} documents with missing issuerName to update`);
            }

            // Create array to hold all documents
            const allDocuments = [];
            let pageNo = 1;
            const pageSize = 100;
            let hasMorePages = true;

            // Fetch up to 5 pages (500 documents)
            const maxPages = 5;

            while (hasMorePages && pageNo <= maxPages) {
                try {
                    console.log(`Fetching page ${pageNo} of LHDN documents...`);
                    const response = await axios.get(
                        `${lhdnConfig.baseUrl}/api/v1.0/documents/recent`,
                        {
                            params: {
                                pageNo: pageNo,
                                pageSize: pageSize,
                                sortBy: 'dateTimeValidated',
                                sortOrder: 'desc'
                            },
                            headers: {
                                'Authorization': `Bearer ${req.session.lhdn?.accessToken || req.session.accessToken}`,
                                'Accept': 'application/json',
                                'Content-Type': 'application/json'
                            },
                            timeout: lhdnConfig.timeout
                        }
                    );

                    const pageDocuments = response.data.result || [];
                    console.log(`Fetched ${pageDocuments.length} documents from page ${pageNo}`);

                    // If we got fewer documents than pageSize, we've reached the end
                    if (pageDocuments.length < pageSize) {
                        hasMorePages = false;
                    }

                    // Process each document to ensure supplier/issuer mapping is correct
                    const processedDocuments = pageDocuments.map(doc => {
                        return {
                            ...doc,
                            // Important: Map supplierName to issuerName if issuerName is missing
                            issuerName: doc.issuerName || doc.supplierName || null,
                            issuerTin:  doc.issuerTIN || doc.issuerTin || doc.supplierTin || doc.supplierTIN ||  null,
                            receiverName: doc.receiverName || doc.buyerName || null,
                            receiverId: doc.receiverId || doc.buyerTin || doc.buyerTIN || null
                        };
                    });

                    console.log("Current Process Documents:", processedDocuments);

                    // Add to our collection
                    allDocuments.push(...processedDocuments);

                    // Move to next page
                    pageNo++;

                    // LHDN Get Recent Documents: 12 RPM; use 5s between pages to stay within limit
                    await delay(5000);

                } catch (pageError) {
                    console.error(`Error fetching page ${pageNo}:`, pageError.message);
                    // Stop fetching more pages on error
                    hasMorePages = false;
                }
            }

            console.log(`Total fetched: ${allDocuments.length} documents from ${pageNo-1} pages`);

            const toSave = await filterPinnacleOnlyInbound(allDocuments, req);

            // Save all fetched documents to database
            if (toSave.length > 0) {
                await saveInboundStatus({ result: toSave }, req);
            }

            // Process documents with missing data separately if API fetch didn't update them
            if (docsWithMissingData.length > 0) {
                console.log(`Fetching individual details for ${docsWithMissingData.length} documents with missing data...`);
                let updatedCount = 0;

                // Process in batches to avoid overwhelming the system
                const batchSize = 10;
                for (let i = 0; i < docsWithMissingData.length; i += batchSize) {
                    const batch = docsWithMissingData.slice(i, i + batchSize);

                    await Promise.all(batch.map(async (doc) => {
                        try {
                            // Fetch individual document details from API
                            const apiEndpoint = `${lhdnConfig.baseUrl}/api/v1.0/documents/${doc.uuid}/details`;
                            const apiResponse = await axios.get(apiEndpoint, {
                                headers: {
                                    'Authorization': `Bearer ${req.session.lhdn?.accessToken || req.session.accessToken}`,
                                    'Content-Type': 'application/json'
                                },
                                timeout: lhdnConfig.timeout
                            });

                            // Look for supplier/issuer name in the response
                            const responseData = apiResponse.data;
                            const supplierName = responseData.supplierName ||
                                                responseData.issuerName ||
                                                (responseData.document?.supplierName) ||
                                                (responseData.document?.issuerName);

                            if (supplierName) {
                                // Update the database record using Prisma
                                await prisma.wP_INBOUND_STATUS.update({
                                    where: { uuid: doc.uuid },
                                    data: {
                                        issuerName: supplierName,
                                        last_sync_date: new Date()
                                    }
                                });
                                updatedCount++;
                                console.log(`Updated issuerName to "${supplierName}" for UUID: ${doc.uuid}`);
                            } else {
                                console.log(`Could not find supplierName in API response for UUID: ${doc.uuid}`);

                                // Try alternate endpoint as fallback
                                try {
                                    const rawDocEndpoint = `${lhdnConfig.baseUrl}/api/v1.0/documents/${doc.uuid}/raw`;
                                    const rawDocResponse = await axios.get(rawDocEndpoint, {
                                        headers: {
                                            'Authorization': `Bearer ${req.session.lhdn?.accessToken || req.session.accessToken}`,
                                            'Content-Type': 'application/json'
                                        },
                                        timeout: lhdnConfig.timeout
                                    });

                                    // Parse raw document for supplier info
                                    const rawData = rawDocResponse.data;
                                    const parsedSupplierName = rawData.AccountingSupplierParty?.Party?.PartyLegalEntity?.RegistrationName?.value ||
                                                               rawData.AccountingSupplierParty?.Party?.PartyName?.Name?.value;

                                    if (parsedSupplierName) {
                                        await prisma.wP_INBOUND_STATUS.update({
                                            where: { uuid: doc.uuid },
                                            data: {
                                                issuerName: parsedSupplierName,
                                                last_sync_date: new Date()
                                            }
                                        });
                                        updatedCount++;
                                        console.log(`Updated issuerName to "${parsedSupplierName}" from raw data for UUID: ${doc.uuid}`);
                                    }
                                } catch (rawError) {
                                    console.error(`Error fetching raw document for ${doc.uuid}:`, rawError.message);
                                }
                            }
                        } catch (detailError) {
                            console.error(`Error fetching details for ${doc.uuid}:`, detailError.message);
                        }

                        // Small delay between requests
                        await delay(200);
                    }));
                }

                console.log(`Updated ${updatedCount} documents with missing issuerName`);
            }

            // Log successful refresh
            await LoggingService.log({
                description: `Successfully refreshed ${allDocuments.length} documents from LHDN`,
                username: req.session.user.username,
                userId: req.session.user.id,
                ipAddress: req.ip,
                logType: LOG_TYPES.INFO,
                module: MODULES.API,
                action: ACTIONS.READ,
                status: STATUS.SUCCESS,
                details: { count: allDocuments.length }
            });

            // Return success response
            res.json({
                success: true,
                message: 'Successfully refreshed data from LHDN',
                count: allDocuments.length,
                missingDataUpdated: docsWithMissingData.length > 0,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error refreshing LHDN data:', error);

            // Log error
            await LoggingService.log({
                description: `Error refreshing LHDN data: ${error.message}`,
                username: req.session.user.username,
                userId: req.session.user.id,
                ipAddress: req.ip,
                logType: LOG_TYPES.ERROR,
                module: MODULES.API,
                action: ACTIONS.READ,
                status: STATUS.FAILED,
                details: { error: error.message }
            });

            // Handle specific error cases
            if (error.response?.status === 429) {
                return res.status(429).json({
                    success: false,
                    error: {
                        code: 'RATE_LIMIT_EXCEEDED',
                        message: 'Rate limit exceeded. Please try again later.',
                        retryAfter: error.response.headers['retry-after'] || 30
                    }
                });
            }

            if (error.code === 'ECONNABORTED') {
                return res.status(504).json({
                    success: false,
                    error: {
                        code: 'TIMEOUT',
                        message: 'Request timed out. Please try again.',
                        details: error.message
                    }
                });
            }

            const statusCode = error.response?.status || 500;
            res.status(statusCode).json({
                success: false,
                error: {
                    code: error.code || 'REFRESH_ERROR',
                    message: error.message || 'Failed to refresh LHDN data',
                    details: error.response?.data?.error || error.message
                }
            });
        }
    } catch (error) {
        console.error('Error in refresh endpoint:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_SERVER_ERROR',
                message: 'An unexpected error occurred',
                details: error.message
            }
        });
    }
});

module.exports = router;



// const express = require('express');
// const router = express.Router();
// const axios = require('axios');
// const NodeCache = require('node-cache'); // Change to NodeCache
// const path = require('path');
// const fs = require('fs');
// const fsPromises = fs.promises;
// const jsrender = require('jsrender');
// const puppeteer = require('puppeteer');
// const QRCode = require('qrcode');
// const { logger, apiLogger, versionLogger } = require('../../utils/logger');
// const { getUnitType } = require('../../utils/UOM');
// const { getInvoiceTypes } = require('../../utils/EInvoiceTypes');
// const axiosRetry = require('axios-retry');
// const moment = require('moment');
// const { parseStringPromise, processors } = require('xml2js');
// // Removed Sequelize import as we're using Prisma

// // Initialize cache with 5 minutes standard TTL
// const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes in seconds

// // Database models
// const prisma = require('../../src/lib/prisma');
// const { LoggingService, LOG_TYPES, MODULES, ACTIONS, STATUS } = require('../../services/logging-prisma.service');

// // Helper function for delays
// const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// // Helper function to map invoice type names to codes
// const getInvoiceTypeCode = (typeName) => {
//     const typeMapping = {
//         'Invoice': '01',
//         'Credit Note': '02',
//         'Debit Note': '03',
//         'Refund Note': '04',
//         'Self-billed Invoice': '11',
//         'Self-billed Credit Note': '12',
//         'Self-billed Debit Note': '13',
//         'Self-billed Refund Note': '14'
//     };

//     // If typeName already starts with a valid code (e.g. "01 - Invoice"), extract it
//     const codeMatch = typeName?.match(/^(0[1-4]|1[1-4])/);
//     if (codeMatch) {
//         return codeMatch[1];
//     }

//     // Otherwise look up the code from the mapping
//     return typeMapping[typeName] || '01'; // Default to '01' if not found
// };

// // Extract DocumentCurrencyCode from a parsed UBL/JSON Invoice node (same source as PDF).
// function getDocCurrencyFromInvoice(invoice) {
//     if (!invoice || typeof invoice !== 'object') return null;
//     const arr = invoice.DocumentCurrencyCode;
//     if (!Array.isArray(arr) || !arr.length) return null;
//     const v = arr[0];
//     return (v && typeof v === 'object' && v._ != null) ? v._ : (typeof v === 'string' ? v : null);
// }

// // Extract DocumentCurrencyCode from raw document string (UBL XML or JSON). Used to backfill WP_Inbound_Status.documentCurrency.
// async function extractDocumentCurrencyFromRaw(docStr) {
//     if (typeof docStr !== 'string' || !docStr.trim()) return null;
//     const s = docStr.trim();
//     try {
//         if (s.startsWith('<')) {
//             const parsed = await parseStringPromise(docStr, { explicitArray: true, tagNameProcessors: [processors.stripPrefix] });
//             const find = (p) => {
//                 if (!p || typeof p !== 'object') return null;
//                 for (const k of Object.keys(p)) {
//                     const local = (k && k.includes(':')) ? k.split(':').pop() : k;
//                     if (local === 'Invoice') {
//                         const v = p[k];
//                         return (Array.isArray(v) && v.length) ? v[0] : (v && typeof v === 'object' ? v : null);
//                     }
//                 }
//                 const keys = Object.keys(p);
//                 if (keys.length === 1) {
//                     const v = p[keys[0]];
//                     const child = (Array.isArray(v) && v.length) ? v[0] : v;
//                     if (child && typeof child === 'object') return find(child);
//                 }
//                 return null;
//             };
//             const inv = find(parsed);
//             return inv ? getDocCurrencyFromInvoice(inv) : null;
//         }
//         if (s.startsWith('{')) {
//             const o = JSON.parse(docStr);
//             const inv = o?.Invoice?.[0] || o?.invoice?.[0];
//             return inv ? getDocCurrencyFromInvoice(inv) : null;
//         }
//     } catch (e) { /* ignore */ }
//     return null;
// }

// // Persist documentCurrency to WP_Inbound_Status when currently null (fire-and-forget). Use when we obtain currency from UBL (PDF, display-details, or document list).
// function persistDocumentCurrencyIfNull(uuid, documentCurrency) {
//     if (!uuid || !documentCurrency) return;
//     prisma.wP_INBOUND_STATUS.updateMany({
//         where: { uuid, documentCurrency: null },
//         data: { documentCurrency }
//     }).catch(() => {});
// }

// // Pinnacle-only inbound: hide docs where we are issuer but submitted via another portal (uuid not in WP_OUTBOUND_STATUS). Receiver docs always shown.
// // WP_ADMIN_SETTINGS.InboundPinnacleOnly = "0" disables; "1" or missing = on.
// async function filterPinnacleOnlyInbound(documents, req) {
//     if (!documents?.length || !req) return documents;
//     try {
//         const setting = await prisma.wP_ADMIN_SETTINGS.findFirst({
//             where: { SettingKey: 'InboundPinnacleOnly' },
//             select: { SettingValue: true }
//         });
//         if (setting && String(setting.SettingValue || '').trim() === '0') return documents;
//     } catch (e) { /* if table or row missing, treat as on */ }
//     let ourTins = [req.session?.user?.TIN].filter(Boolean);
//     if (!ourTins.length) {
//         const r = await prisma.wP_USER_REGISTRATION.findFirst({
//             where: { ValidStatus: '1' },
//             select: { TIN: true }
//         });
//         ourTins = [r?.TIN].filter(Boolean);
//     }
//     if (!ourTins.length) return documents;
//     const outboundRows = await prisma.wP_OUTBOUND_STATUS.findMany({
//         where: { UUID: { not: null } },
//         select: { UUID: true }
//     });
//     const outboundUuids = new Set(outboundRows.map(r => r.UUID));
//     return documents.filter(doc => {
//         const issuerTin = String(doc.issuerTin || doc.supplierTin || doc.issuerTIN || '').trim();
//         const isOurIssuer = ourTins.some(t => String(t || '').trim() === issuerTin);
//         if (!isOurIssuer) return true;
//         return outboundUuids.has(doc.uuid);
//     });
// }

// // Enhanced delay function with exponential backoff
// const calculateBackoff = (retryCount, baseDelay = 1000, maxDelay = 60000) => {
//     const backoff = Math.min(maxDelay, baseDelay * Math.pow(2, retryCount));
//     const jitter = Math.random() * 1000; // Add some randomness to prevent thundering herd
//     return backoff + jitter;
// };

// // Helper function to handle authentication errors
// const handleAuthError = (req, res) => {
//     // Clear session
//     req.session.destroy((err) => {
//         if (err) {
//             console.error('Error destroying session:', err);
//         }
//     });

//     // Return error response with redirect flag
//     return res.status(401).json({
//         success: false,
//         message: 'Authentication failed. Please log in again.',
//         redirect: '/login'
//     });
// };

// const rateLimit = require('express-rate-limit');
// const limiter = rateLimit({
//     windowMs: 15 * 60 * 1000, // 15 minutes
//     max: 100, // limit each IP to 100 requests per windowMs
//     standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
//     legacyHeaders: false, // Disable the `X-RateLimit-*` headers
//     trustProxy: false, // Disable trust proxy
//     keyGenerator: function (req) {
//         // Use session ID or user ID if available, fallback to IP
//         return req.session?.user?.id || req.ip;
//     },
//     handler: function (req, res) {
//         return res.status(429).json({
//             success: false,
//             message: 'Too many requests. Please try again later.',
//             retryAfter: req.rateLimit.resetTime - Date.now()
//         });
//     }
// });


// axiosRetry.default(axios, {
//     retries: 3,
//     retryDelay: axiosRetry.exponentialDelay,
//     retryCondition: (error) => {
//         return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
//                error.response?.status === 429;
//     }
// });

// // Document retrieval limitations
// const getDocumentRetrievalLimits = () => {
//     return {
//         maxDocuments: 10000, // Maximum number of documents that can be returned
//         timeWindowDays: 30,  // Time window in days for document retrieval
//         validateTimeWindow: (dateTimeIssued) => {
//             if (!dateTimeIssued) return false;
//             const currentDate = new Date();
//             const documentDate = new Date(dateTimeIssued);
//             const diffTime = Math.abs(currentDate - documentDate);
//             const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
//             return diffDays <= 30; // Only allow documents within last 30 days
//         }
//     };
// };

// // Helper function to get LHDN config
// async function getLHDNConfig() {
//     const config = await prisma.wP_CONFIGURATION.findFirst({
//         where: {
//             Type: 'LHDN',
//             IsActive: true
//         },
//         orderBy: {
//             CreateTS: 'desc'
//         }
//     });

//     if (!config || !config.Settings) {
//         throw new Error('LHDN configuration not found');
//     }

//     let settings = typeof config.Settings === 'string' ? JSON.parse(config.Settings) : config.Settings;

//     const baseUrl = settings.environment === 'production'
//         ? settings.productionUrl || settings.middlewareUrl
//         : settings.sandboxUrl || settings.middlewareUrl;

//     if (!baseUrl) {
//         throw new Error('LHDN API URL not configured');
//     }

//     // Enhanced timeout configuration with reasonable defaults
//     const defaultTimeout = 60000; // 60 seconds default
//     const minTimeout = 30000;    // 30 seconds minimum
//     const maxTimeout = 300000;   // 5 minutes maximum

//     let timeout = parseInt(settings.timeout) || defaultTimeout;
//     timeout = Math.min(Math.max(timeout, minTimeout), maxTimeout);

//     return {
//         baseUrl,
//         environment: settings.environment,
//         timeout: timeout,
//         retryEnabled: settings.retryEnabled !== false, // Enable retries by default
//         maxRetries: settings.maxRetries || 5,
//         retryDelay: settings.retryDelay || 1000, // Base delay for exponential backoff
//         maxRetryDelay: settings.maxRetryDelay || 60000 // Maximum retry delay
//     };
// }

// // Helper function to get portal URL based on environment
// function getPortalUrl(environment) {
//     const portalUrls = {
//         production: 'myinvois.hasil.gov.my',
//         sandbox: 'preprod.myinvois.hasil.gov.my'
//     };

//     return portalUrls[environment] || portalUrls.sandbox; // Default to sandbox if environment not specified
// }

// // Enhanced document fetching function with smart caching
// const fetchRecentDocuments = async (req) => {
//     console.log('Starting enhanced document fetch process...');

//     try {
//         // Get LHDN configuration
//         const lhdnConfig = await getLHDNConfig();
//         console.log('Using LHDN configuration:', {
//             environment: lhdnConfig.environment,
//             baseUrl: lhdnConfig.baseUrl,
//             timeout: lhdnConfig.timeout
//         });

//         // First, check if we have data in the database
//         const dbDocuments = await prisma.wP_INBOUND_STATUS.findMany({
//             orderBy: {
//                 dateTimeReceived: 'desc'
//             },
//             take: 1000 // Limit to latest 1000 records
//         });

//         // If we have database records, use them as the initial data source
//         if (dbDocuments && dbDocuments.length > 0) {
//             console.log(`Found ${dbDocuments.length} documents in database`);

//             // Check if we need to refresh from API
//             const lastSyncedDocument = await prisma.wP_INBOUND_STATUS.findFirst({
//                 orderBy: {
//                     last_sync_date: 'desc'
//                 },
//                 select: {
//                     last_sync_date: true
//                 }
//             });

//             const currentTime = new Date();
//             const syncThreshold = 15 * 60 * 1000; // 15 minutes in milliseconds
//             const forceRefresh = req.query.forceRefresh === 'true';

//             // Only fetch from API if forced or if last sync is older than threshold
//             if (!forceRefresh && lastSyncedDocument && lastSyncedDocument.last_sync_date) {
//                 const timeSinceLastSync = currentTime - new Date(lastSyncedDocument.last_sync_date);
//                 if (timeSinceLastSync < syncThreshold) {
//                     console.log('Using database records - last sync was', Math.round(timeSinceLastSync/1000/60), 'minutes ago');
//                     return {
//                         result: dbDocuments,
//                         cached: true,
//                         fromDatabase: true
//                     };
//                 }
//             }

//             // If we're here, we need to refresh from API but still have DB records as fallback
//             console.log('Database records exist but need refresh from API');
//         } else {
//             console.log('No documents found in database, will fetch from API');
//         }

//         // Attempt to fetch from API
//         try {
//             console.log('Fetching fresh data from LHDN API...');
//             const documents = [];
//             let pageNo = 1;
//             const pageSize = 100; // MyInvois recommended page size
//             let hasMorePages = true;
//             let consecutiveErrors = 0;
//             const maxConsecutiveErrors = 3;

//             // Track rate limiting
//             let rateLimitRemaining = null;
//             let rateLimitReset = null;

//             while (hasMorePages) {
//                 let retryCount = 0;
//                 let success = false;

//                 while (!success && retryCount < lhdnConfig.maxRetries) {
//                     try {
//                         // Check rate limit before making request
//                         if (rateLimitRemaining !== null && rateLimitRemaining <= 0) {
//                             const waitTime = (new Date(rateLimitReset).getTime() - Date.now()) + 1000; // Add 1s buffer
//                             if (waitTime > 0) {
//                                 console.log(`Rate limit reached. Waiting ${Math.round(waitTime/1000)}s before continuing...`);
//                                 await delay(waitTime);
//                             }
//                         }

//                         // Get token from session (which should now have the token from file)
//                         let token = req.session?.accessToken;

//                         // If no token in session, try to get directly from file
//                         if (!token) {
//                             console.log('No token in session, trying to get from file directly');
//                             token = await readTokenFromFile();
//                         }

//                         // If still no token, throw error
//                         if (!token) {
//                             console.error('No valid access token found in session or file');
//                             throw new Error('No valid access token found');
//                         }

//                         console.log('Using token for LHDN API request');

//                         const response = await axios.get(
//                             `${lhdnConfig.baseUrl}/api/v1.0/documents/recent`,
//                             {
//                                 params: {
//                                     pageNo: pageNo,
//                                     pageSize: pageSize,
//                                     sortBy: 'dateTimeValidated',
//                                     sortOrder: 'desc'
//                                 },
//                                 headers: {
//                                     'Authorization': `Bearer ${token}`,
//                                     'Accept': 'application/json',
//                                     'Content-Type': 'application/json'
//                                 },
//                                 timeout: lhdnConfig.timeout
//                             }
//                         );

//                         // Update rate limit tracking from headers
//                         rateLimitRemaining = parseInt(response.headers['x-rate-limit-remaining'] || '-1');
//                         rateLimitReset = response.headers['x-rate-limit-reset'];

//                         // Handle pagination
//                         const { result, pagination } = response.data;

//                         if (!result || result.length === 0) {
//                             console.log(`No more documents found after page ${pageNo-1}`);
//                             hasMorePages = false;
//                             break;
//                         }

//                         // [Trace] LHDN API first doc - see if documentCurrencyCode / DocumentCurrencyCode exist
//                         if (pageNo === 1 && result[0]) {
//                             const d = result[0];
//                             console.log('[fetchRecentDocuments] LHDN API first doc - all keys:', Object.keys(d).sort().join(', '));
//                             console.log('[fetchRecentDocuments] LHDN API first doc - currency fields:', { documentCurrencyCode: d.documentCurrencyCode, documentCurrency: d.documentCurrency, currencyCode: d.currencyCode, currency: d.currency, DocumentCurrencyCode: d.DocumentCurrencyCode });
//                         }

//                         // Map the required fields from the API response - IMPORTANT: follow MyInvois API structure
//                         const mappedDocuments = result.map(doc => ({
//                             ...doc,
//                             // Map issuerTin or supplierTin to issuerTin
//                             issuerTin: doc.issuerTin || doc.supplierTin || null,

//                             // Map issuerName or supplierName to issuerName
//                             issuerName: doc.issuerName || doc.supplierName || null,

//                             // Map receiverId or buyerTin to receiverId
//                             receiverId: doc.receiverId || doc.buyerTin || doc.buyerTIN || null,

//                             // Map receiverName or buyerName to receiverName
//                             receiverName: doc.receiverName || doc.buyerName || null,

//                             // Map receiverTIN or buyerTIN to receiverTIN
//                             receiverTIN: doc.receiverTIN || doc.buyerTIN || null,

//                             receiverRegistrationNo: doc.receiverRegistrationNo || doc.buyerRegistrationNo || null,
//                             receiverAddress: doc.receiverAddress || doc.buyerAddress || null,
//                             receiverPostcode: doc.receiverPostcode || doc.buyerPostcode || null,
//                             receiverCity: doc.receiverCity || doc.buyerCity || null,
//                             receiverState: doc.receiverState || doc.buyerState || null,
//                             receiverCountry: doc.receiverCountry || doc.buyerCountry || null,
//                             receiverPhone: doc.receiverPhone || doc.buyerPhone || null,

//                             uuid: doc.uuid,
//                             submissionUid: doc.submissionUid,
//                             longId: doc.longId,
//                             internalId: doc.internalId,
//                             typeName: doc.typeName,
//                             typeVersionName: doc.typeVersionName,
//                             dateTimeReceived: doc.dateTimeReceived,
//                             dateTimeIssued: doc.dateTimeIssued,
//                             dateTimeValidated: doc.dateTimeValidated,
//                             status: doc.status,
//                             documentStatusReason: doc.documentStatusReason,
//                             totalSales: doc.totalSales || doc.total || doc.netAmount || 0,
//                             totalExcludingTax: doc.totalExcludingTax || 0,
//                             totalDiscount: doc.totalDiscount || 0,
//                             totalNetAmount: doc.totalNetAmount || doc.netAmount || 0,
//                             totalPayableAmount: doc.totalPayableAmount || doc.total || 0,
//                             documentCurrencyCode: doc.documentCurrencyCode || doc.documentCurrency || doc.currencyCode || doc.currency || null
//                         }));

//                         console.log(`Mapped ${mappedDocuments.length} documents from API response`);
//                         documents.push(...mappedDocuments);
//                         console.log(`Successfully fetched page ${pageNo} with ${mappedDocuments.length} documents`);

//                         // Check if we have more pages based on pagination info
//                         if (pagination) {
//                             hasMorePages = pageNo < pagination.totalPages;
//                         } else {
//                             hasMorePages = result.length === pageSize;
//                         }

//                         // Reset consecutive errors counter on success
//                         consecutiveErrors = 0;
//                         success = true;
//                         pageNo++;

//                         // LHDN Get Recent Documents: 12 RPM; use 5s between pages to stay within limit
//                         if (hasMorePages) {
//                             await delay(5000);
//                         }

//                     } catch (error) {
//                         retryCount++;
//                         console.error(`Error fetching page ${pageNo}:`, error.message);

//                         // Handle authentication errors
//                         if (error.response?.status === 401 || error.response?.status === 403) {
//                             console.error('Authentication error detected:', error.message);

//                             // Try to refresh token first
//                             try {
//                                 console.log('Attempting to refresh token...');

//                                 // Try to get token from file using our enhanced function
//                                 const fileToken = await readTokenFromFile();

//                                 if (fileToken) {
//                                     // If file token is different from session token, try using it
//                                     if (fileToken !== req.session.accessToken) {
//                                         console.log('Found different token in file, trying it...');
//                                         req.session.accessToken = fileToken;
//                                         retryCount--; // Don't count this as a retry
//                                         continue;
//                                     }
//                                 }

//                                 // If file token didn't work, try to get a fresh token
//                                 try {
//                                     console.log('Attempting to get a fresh token...');
//                                     const { getTokenSession } = require('../../services/token-prisma.service');
//                                     const freshToken = await getTokenSession();

//                                     if (freshToken) {
//                                         console.log('Successfully obtained fresh token');
//                                         req.session.accessToken = freshToken;
//                                         retryCount--; // Don't count this as a retry
//                                         continue;
//                                     }
//                                 } catch (tokenError) {
//                                     console.error('Error getting fresh token:', tokenError);
//                                 }

//                                 // If we couldn't refresh the token, throw authentication error
//                                 throw new Error('Authentication failed. Please log in again.');
//                             } catch (refreshError) {
//                                 console.error('Token refresh failed:', refreshError.message);
//                                 throw new Error('Authentication failed. Please log in again.');
//                             }
//                         }

//                         // Handle rate limiting
//                         if (error.response?.status === 429) {
//                             const resetTime = error.response.headers["x-rate-limit-reset"];
//                             rateLimitRemaining = 0;
//                             rateLimitReset = resetTime;

//                             const waitTime = new Date(resetTime).getTime() - Date.now();
//                             if (waitTime > 0) {
//                                 console.log(`Rate limited. Waiting ${Math.round(waitTime/1000)}s before retry...`);
//                                 await delay(waitTime);
//                                 retryCount--; // Don't count rate limit retries
//                                 continue;
//                             }
//                         }

//                         // Track consecutive errors
//                         if (retryCount >= lhdnConfig.maxRetries) {
//                             consecutiveErrors++;
//                             if (consecutiveErrors >= maxConsecutiveErrors) {
//                                 console.error(`Max consecutive errors (${maxConsecutiveErrors}) reached. Stopping fetch.`);
//                                 hasMorePages = false;
//                                 break;
//                             }
//                             console.log(`Moving to next page after max retries for page ${pageNo}`);
//                             pageNo++;
//                             break;
//                         }

//                         // Exponential backoff for other errors
//                         const backoffDelay = Math.min(
//                             lhdnConfig.maxRetryDelay,
//                             lhdnConfig.retryDelay * Math.pow(2, retryCount)
//                         );
//                         console.log(`Retrying page ${pageNo} after ${backoffDelay/1000}s delay (attempt ${retryCount + 1}/${lhdnConfig.maxRetries})...`);
//                         await delay(backoffDelay);
//                     }
//                 }

//                 if (!success && consecutiveErrors >= maxConsecutiveErrors) {
//                     hasMorePages = false;
//                 }
//             }

//             if (documents.length === 0) {
//                 throw new Error('No documents could be fetched from the API');
//             }

//             const filtered = await filterPinnacleOnlyInbound(documents, req);
//             console.log(`Fetch complete. Total documents retrieved: ${filtered.length}`);

//             // Save the fetched documents to database
//             await saveInboundStatus({ result: filtered }, req);

//             // If we have submission UIDs, poll their status
//             const uniqueSubmissionUids = [...new Set(filtered.map(doc => doc.submissionUid).filter(Boolean))];
//             if (uniqueSubmissionUids.length > 0) {
//                 console.log(`Found ${uniqueSubmissionUids.length} unique submission UIDs to poll`);

//                 // Poll each submission in sequence to avoid rate limiting
//                 for (const submissionUid of uniqueSubmissionUids) {
//                     try {
//                         console.log(`Polling submission status for: ${submissionUid}`);
//                         await pollSubmissionStatus(submissionUid, 5); // Limit to 5 attempts for background polling
//                     } catch (pollError) {
//                         console.error(`Error polling submission ${submissionUid}:`, pollError);
//                         // Continue with next submission even if this one fails
//                     }

//                     // Add a small delay between submissions to avoid rate limiting
//                     await delay(1000);
//                 }
//             }

//             // Log successful document fetch
//             await LoggingService.log({
//                 description: `Successfully fetched ${filtered.length} documents from LHDN`,
//                 username: req?.session?.user?.username || 'System',
//                 userId: req?.session?.user?.id,
//                 ipAddress: req?.ip,
//                 logType: LOG_TYPES.INFO,
//                 module: MODULES.API,
//                 action: ACTIONS.READ,
//                 status: STATUS.SUCCESS,
//                 details: { count: filtered.length }
//             });

//             return {
//                 result: filtered,
//                 cached: false,
//                 fromApi: true
//             };
//         } catch (error) {
//             console.error('Error fetching from LHDN API:', error.message);

//             // Log the error
//             await LoggingService.log({
//                 description: `Error fetching documents from LHDN: ${error.message}`,
//                 username: req?.session?.user?.username || 'System',
//                 userId: req?.session?.user?.id,
//                 ipAddress: req?.ip,
//                 logType: LOG_TYPES.ERROR,
//                 module: MODULES.API,
//                 action: ACTIONS.READ,
//                 status: STATUS.FAILED,
//                 details: { error: error.message }
//             });

//             // If we have database records, use them as fallback
//             if (dbDocuments && dbDocuments.length > 0) {
//                 console.log(`Using ${dbDocuments.length} database records as fallback`);
//                 const filtered = await filterPinnacleOnlyInbound(dbDocuments, req);
//                 return {
//                     result: filtered,
//                     cached: true,
//                     fromDatabase: true,
//                     fallback: true,
//                     error: error.message
//                 };
//             }

//             // If no database records, rethrow the error
//             throw error;
//         }
//     } catch (error) {
//         console.error('Error in document fetch:', error);
//         return {
//             success: false,
//             message: `Error fetching documents: ${error.message}`,
//             error: error
//         };
//     }
// };
// // Enhanced caching function with better error handling
// async function getCachedDocuments(req) {
//     const cacheKey = `recentDocuments_${req.session?.user?.TIN || 'default'}`;
//     const forceRefresh = req.query.forceRefresh === 'true';
//     const useDatabase = req.query.useDatabase === 'true';

//     // Get from cache if not forcing refresh
//     let data = forceRefresh ? null : cache.get(cacheKey);

//     if (!data) {
//         try {
//             // If useDatabase is true and we're not forcing refresh, try to get from database first
//             if (useDatabase && !forceRefresh) {
//                 try {
//                     console.log('Using database as primary data source due to useDatabase parameter');
//                     // Get documents from database
//                     const dbDocuments = await prisma.wP_INBOUND_STATUS.findMany({
//                         orderBy: {
//                             dateTimeReceived: 'desc'
//                         },
//                         take: 1000 // Limit to latest 1000 records
//                     });

//                     if (dbDocuments && dbDocuments.length > 0) {
//                         console.log(`Found ${dbDocuments.length} documents in database`);
//                         const filtered = await filterPinnacleOnlyInbound(dbDocuments, req);
//                         data = {
//                             result: filtered,
//                             cached: false,
//                             fromDatabase: true,
//                             fromApi: false,
//                             timestamp: new Date().toISOString()
//                         };

//                         // Store in cache with shorter TTL for database data
//                         cache.set(cacheKey, data, 300); // 5 minutes
//                         console.log('Cached database documents for 5 minutes');

//                         // Try to fetch from API in the background to update the database
//                         try {
//                             console.log('Fetching from API in background to update database');
//                             fetchRecentDocuments(req).catch(apiError => {
//                                 console.warn('Background API fetch failed:', apiError.message);
//                             });
//                         } catch (backgroundError) {
//                             console.warn('Error starting background fetch:', backgroundError);
//                         }

//                         return data;
//                     }
//                 } catch (dbError) {
//                     console.error('Error getting documents from database:', dbError);
//                     // Continue to API fetch if database fetch fails
//                 }
//             }

//             // If not using database or database fetch failed, fetch from API
//             data = await fetchRecentDocuments(req);

//             // Only cache successful results
//             if (data && data.result && data.result.length > 0) {
//                 // Store in cache with appropriate TTL based on source
//                 const cacheTTL = data.fromApi ? 900 : 300; // 15 minutes for API data, 5 minutes for DB data
//                 cache.set(cacheKey, data, cacheTTL);
//                 console.log(`${forceRefresh ? 'Force refreshed' : 'Fetched'} documents and cached for ${cacheTTL} seconds`);
//             }
//         } catch (error) {
//             console.error('Error in getCachedDocuments:', error);

//             // Check if it's an authentication error
//             if (error.message?.includes('Authentication failed')) {
//                 // Log authentication error
//                 await LoggingService.log({
//                     description: `Authentication error in getCachedDocuments: ${error.message}`,
//                     username: req.session?.user?.username || 'System',
//                     userId: req.session?.user?.id,
//                     ipAddress: req.ip,
//                     logType: LOG_TYPES.ERROR,
//                     module: MODULES.AUTH,
//                     action: ACTIONS.READ,
//                     status: STATUS.FAILED,
//                     details: { error: error.message }
//                 });

//                 // Try to refresh token
//                 try {
//                     // Get token from file using our enhanced function
//                     const fileToken = await readTokenFromFile();

//                     if (fileToken) {
//                         // Update session with token from file
//                         if (req.session) {
//                             req.session.accessToken = fileToken;
//                             console.log('Updated session with token from file');

//                             // Try fetching again with new token
//                             try {
//                                 data = await fetchRecentDocuments(req);
//                                 if (data && data.result && data.result.length > 0) {
//                                     cache.set(cacheKey, data, 900); // 15 minutes
//                                     console.log('Successfully fetched data with refreshed token');
//                                 }
//                             } catch (retryError) {
//                                 console.error('Retry with refreshed token failed:', retryError);
//                             }
//                         }
//                     } else {
//                         // If no token in file, try to get a fresh one
//                         try {
//                             console.log('No token in file, attempting to get a fresh token');
//                             const { getTokenSession } = require('../../services/token-prisma.service');
//                             const freshToken = await getTokenSession();

//                             if (freshToken && req.session) {
//                                 req.session.accessToken = freshToken;
//                                 console.log('Updated session with fresh token');

//                                 // Try fetching again with fresh token
//                                 try {
//                                     data = await fetchRecentDocuments(req);
//                                     if (data && data.result && data.result.length > 0) {
//                                         cache.set(cacheKey, data, 900); // 15 minutes
//                                         console.log('Successfully fetched data with fresh token');
//                                     }
//                                 } catch (retryError) {
//                                     console.error('Retry with fresh token failed:', retryError);
//                                 }
//                             }
//                         } catch (tokenError) {
//                             console.error('Error getting fresh token:', tokenError);
//                         }
//                     }
//                 } catch (tokenError) {
//                     console.error('Error refreshing token from file:', tokenError);
//                 }
//             }

//             // If we still don't have data, try database fallback
//             if (!data || !data.result || data.result.length === 0) {
//                 try {
//                     console.log('Attempting final fallback to database...');
//                     const fallbackDocuments = await prisma.wP_INBOUND_STATUS.findMany({
//                         orderBy: {
//                             dateTimeReceived: 'desc'
//                         },
//                         take: 1000
//                     });

//                     if (fallbackDocuments && fallbackDocuments.length > 0) {
//                         console.log(`Using ${fallbackDocuments.length} database records as final fallback`);
//                         const filtered = await filterPinnacleOnlyInbound(fallbackDocuments, req);
//                         data = {
//                             result: filtered,
//                             cached: false,
//                             fromDatabase: true,
//                             fallback: true,
//                             error: error.message
//                         };

//                         // Cache fallback data for a shorter period
//                         cache.set(cacheKey, data, 120); // 2 minutes
//                     } else {
//                         throw new Error('No documents found in database');
//                     }
//                 } catch (dbError) {
//                     console.error('Database fallback also failed:', dbError);
//                     throw error; // Rethrow the original error
//                 }
//             }
//         }
//     } else {
//         console.log(`Using cached data (${data.result?.length || 0} documents)`);
//     }

//     return data;
// }

// const generateTemplateHash = (templateData) => {
//     const crypto = require('crypto');
//     // Create a string of key data that should trigger regeneration when changed
//     const keyData = JSON.stringify({
//         logo: templateData.CompanyLogo,
//         companyInfo: {
//             name: templateData.companyName,
//             address: templateData.companyAddress,
//             phone: templateData.companyPhone,
//             email: templateData.companyEmail
//         },
//         documentInfo: {
//             type: templateData.InvoiceType,
//             code: templateData.InvoiceCode,
//             uuid: templateData.UniqueIdentifier
//         },
//         items: templateData.items,
//         totals: {
//             subtotal: templateData.Subtotal,
//             tax: templateData.TotalTaxAmount,
//             total: templateData.TotalPayableAmount
//         }
//     });
//     return crypto.createHash('md5').update(keyData).digest('hex');
// };

// // Helper function to generate JSON response file
// const generateResponseFile = async (item, req = null) => {
//     try {
//         // Get username from session if available
//         const username = req?.session?.user?.username || 'System';
//         // Only generate for valid documents with required fields
//         if (!item.uuid || !item.submissionUid || !item.longId || item.status !== 'Valid') {
//             console.log(`Skipping response file generation for ${item.uuid}: missing required fields or invalid status`);
//             return { success: false, message: 'Skipped: Missing required fields or invalid status' };
//         }

//          // Get LHDN configuration
//         const lhdnConfig = await getLHDNConfig();

//         // Get outgoing path configuration using Prisma
//         const outgoingConfig = await prisma.wP_CONFIGURATION.findFirst({
//             where: {
//                 Type: 'OUTGOING',
//                 IsActive: true
//             },
//             orderBy: {
//                 CreateTS: 'desc'
//             }
//         });

//         if (!outgoingConfig || !outgoingConfig.Settings) {
//             console.log(`No outgoing path configuration found, skipping response file generation for ${item.uuid}`);
//             return { success: false, message: 'No outgoing path configuration found' };
//         }

//         let settings = typeof outgoingConfig.Settings === 'string'
//             ? JSON.parse(outgoingConfig.Settings)
//             : outgoingConfig.Settings;

//         if (!settings.networkPath) {
//             console.log(`No network path configured in outgoing settings for ${item.uuid}`);
//             return { success: false, message: 'No network path configured' };
//         }

//         // Try to get user registration details
//         const userRegistration = await prisma.wP_USER_REGISTRATION.findFirst({
//             where: { ValidStatus: '1' }, // ValidStatus is a CHAR(1) field, not a boolean
//             orderBy: {
//                 CreateTS: 'desc'
//             }
//         });

//         if (!userRegistration || !userRegistration.TIN) {
//             console.log(`No active user registration found with TIN`);
//             return { success: false, message: 'No active user registration found' };
//         }

//         // Try to get company settings based on user's TIN
//         let companySettings = await prisma.wP_COMPANY_SETTINGS.findFirst({
//             where: { TIN: userRegistration.TIN }
//         });

//         // If no company settings found with user's TIN, try with document TINs
//         if (!companySettings) {
//             console.log(`No company settings found for user TIN: ${userRegistration.TIN}, trying document TINs`);

//             // Check if the document's issuerTin or receiverId matches any company settings
//             if (item.issuerTin === userRegistration.TIN || item.receiverId === userRegistration.TIN) {
//                 companySettings = await prisma.wP_COMPANY_SETTINGS.findFirst({
//                     where: {
//                         TIN: {
//                             in: [item.issuerTin, item.receiverId].filter(Boolean)
//                         }
//                     }
//                 });
//             }
//         }

//         if (!companySettings) {
//             console.log(`No matching company settings found for TINs: User(${userRegistration.TIN}), Issuer(${item.issuerTin}), Receiver(${item.receiverId})`);
//             return { success: false, message: 'No matching company settings found' };
//         }

//         // Set company name from settings
//         const companyName = companySettings.CompanyName;

//         // Get document details from outbound status using Prisma
//         // Note: UUID is not a unique field, so we need to use findFirst instead of findUnique
//         const outboundDoc = await prisma.wP_OUTBOUND_STATUS.findFirst({
//             where: { UUID: item.uuid }
//         });

//         let type, company, date;
//         let invoiceTypeCode = "01"; // Default invoice type code
//         let invoiceNo = item.internalId || "";

//         // Define sanitization function early so we can use it for all path components and IDs
//         const sanitizePath = (str) => {
//             if (!str) return '';
//             // Replace all characters that are problematic in file paths
//             return String(str).replace(/[<>:"/\\|?*]/g, '_');
//         };

//         // Sanitize the invoiceNo immediately
//         invoiceNo = sanitizePath(invoiceNo);

//         // Always try to get inbound data first using Prisma
//         const inboundDoc = await prisma.wP_INBOUND_STATUS.findUnique({
//             where: { uuid: item.uuid }
//         });

//         if (inboundDoc) {
//             // Use the helper function to get invoice type code from typeName
//             invoiceTypeCode = getInvoiceTypeCode(inboundDoc.typeName);
//             // Get and sanitize the internal ID
//             invoiceNo = sanitizePath(inboundDoc.internalId || item.internalId || "");
//         }

//         // Try to use outbound data if available
//         if (outboundDoc && outboundDoc.filePath) {
//             try {
//                 // Extract type, company, and date from filePath
//                 const pathParts = outboundDoc.filePath.split(path.sep);
//                 if (pathParts.length >= 4) {
//                     const dateIndex = pathParts.length - 2;
//                     // const companyIndex = pathParts.length - 3; // Not used but kept for reference
//                     const typeIndex = pathParts.length - 4;

//                     type = pathParts[typeIndex] || 'LHDN';
//                     company = companyName;  // Use company name from settings
//                     date = pathParts[dateIndex] || moment().format('YYYY-MM-DD');

//                     // Only update invoice number if we got it from outbound
//                     if (outboundDoc.internalId) {
//                         invoiceNo = sanitizePath(outboundDoc.internalId);
//                     }

//                     // Try to get invoice type code from typeName if available
//                     if (outboundDoc.typeName) {
//                         const typeMatch = outboundDoc.typeName.match(/^(\d{2})/);
//                         if (typeMatch) {
//                             invoiceTypeCode = typeMatch[1];
//                         }
//                     }
//                 } else {
//                     console.log(`Invalid path structure in outbound doc for UUID: ${item.uuid}, using default values`);
//                     throw new Error('Invalid path structure');
//                 }
//             } catch (pathError) {
//                 console.log(`Using default values due to path error for UUID: ${item.uuid}`);
//                 type = 'LHDN';
//                 company = companyName;
//                 date = moment().format('YYYY-MM-DD');
//             }
//         } else {
//             // Use default values if no outbound document
//             console.log(`No outbound document or path for UUID: ${item.uuid}, using default values`);
//             type = 'LHDN';
//             company = companyName;
//             date = moment().format('YYYY-MM-DD');
//         }

//         // Ensure all path components are strings and valid
//         type = String(type || 'LHDN');
//         company = String(company || companyName);
//         date = String(date || moment().format('YYYY-MM-DD'));

//         // Sanitize path components
//         type = sanitizePath(type);
//         company = sanitizePath(company);
//         date = sanitizePath(date);

//         // Ensure invoiceNo is sanitized again (in case it was updated after initial sanitization)
//         invoiceNo = sanitizePath(invoiceNo);

//         // Generate filename with new format: {invoiceTypeCode}_{invoiceNo}_{uuid}.json
//         const fileName = `${invoiceTypeCode}_${invoiceNo}_${item.uuid}.json`;

//         // Construct paths for outgoing files using configured network path
//         const outgoingBasePath = path.join(settings.networkPath, type, company);

//         // CHANGE: Previously tried to use a specific path from outboundDoc which might not exist
//         // Now use a simpler path structure for all documents
//         const outgoingJSONPath = outgoingBasePath;

//         // Create directory structure recursively
//         await fsPromises.mkdir(outgoingBasePath, { recursive: true });

//         const jsonFilePath = path.join(outgoingJSONPath, fileName);

//         // Check if JSON response file already exists
//         try {
//             await fsPromises.access(jsonFilePath);
//             console.log(`Response file already exists for ${item.uuid}, skipping generation`);
//             return {
//                 success: true,
//                 message: 'Response file already exists',
//                 path: jsonFilePath,
//                 fileName: fileName,
//                 company: company
//             };
//         } catch (err) {
//             // File doesn't exist, continue with creation
//         }

//         const portalUrl = getPortalUrl(lhdnConfig.environment);
//         const LHDNUrl = `https://${portalUrl}/${item.uuid}/share/${item.longId}`;

//         // Create JSON content
//         const jsonContent = {
//             "issueDate": moment(date).format('YYYY-MM-DD'),
//             "issueTime": new Date().toISOString().split('T')[1].split('.')[0] + 'Z',
//             "invoiceTypeCode": invoiceTypeCode,
//             "invoiceNo": invoiceNo,
//             "uuid": item.uuid,
//             "submissionUid": item.submissionUid,
//             "longId": item.longId,
//             "status": item.status,
//             "lhdnUrl": LHDNUrl,
//         };

//         try {
//             // Make sure the directory exists (extra check)
//             const dirPath = path.dirname(jsonFilePath);
//             await fsPromises.mkdir(dirPath, { recursive: true });

//             // Write JSON file
//             await fsPromises.writeFile(jsonFilePath, JSON.stringify(jsonContent, null, 2));
//             console.log(`Generated response file: ${jsonFilePath}`);

//             // Update the outbound status record with the username
//             try {
//                 // Find the outbound record first
//                 const outboundRecord = await prisma.wP_OUTBOUND_STATUS.findFirst({
//                     where: { UUID: item.uuid }
//                 });

//                 if (outboundRecord) {
//                     // Update the record with the username
//                     await prisma.wP_OUTBOUND_STATUS.update({
//                         where: { id: outboundRecord.id },
//                         data: {
//                             submitted_by: username,
//                             updated_at: new Date()
//                         }
//                     });
//                     console.log(`Updated outbound record with username: ${username} for UUID: ${item.uuid}`);
//                 }
//             } catch (updateError) {
//                 console.error(`Error updating outbound record with username for ${item.uuid}:`, updateError);
//                 // Continue even if this fails
//             }

//             return {
//                 success: true,
//                 message: 'Response file generated successfully',
//                 path: jsonFilePath,
//                 fileName: fileName,
//                 company: company
//             };
//         } catch (writeError) {
//             console.error(`Error writing response file for ${item.uuid}:`, writeError);

//             // If original path fails, try a fallback path - simplify the path further
//             try {
//                 // Create a simpler fallback path without any potential problematic components
//                 const fallbackDirName = `LHDN_Fallback_${moment().format('YYYYMMDD')}`;
//                 const fallbackPath = path.join(settings.networkPath, fallbackDirName);
//                 await fsPromises.mkdir(fallbackPath, { recursive: true });

//                 // Use a very simple filename pattern that removes all special characters
//                 const simplifiedUuid = item.uuid.replace(/[^a-zA-Z0-9]/g, '');
//                 const fallbackFileName = `document_${simplifiedUuid}.json`;
//                 const fallbackFilePath = path.join(fallbackPath, fallbackFileName);

//                 await fsPromises.writeFile(fallbackFilePath, JSON.stringify(jsonContent, null, 2));
//                 console.log(`Generated response file at fallback location: ${fallbackFilePath}`);

//                 return {
//                     success: true,
//                     message: 'Response file generated at fallback location',
//                     path: fallbackFilePath,
//                     fileName: fallbackFileName,
//                     company: company
//                 };
//             } catch (fallbackError) {
//                 console.error(`Fallback path also failed for ${item.uuid}:`, fallbackError);
//                 throw writeError; // throw the original error
//             }
//         }
//     } catch (error) {
//         console.error(`Error generating response file for ${item.uuid}:`, error);
//         return {
//             success: false,
//             message: `Error generating response file: ${error.message}`,
//             error: error
//         };
//     }
// };

// // Enhanced save to database function
// const saveInboundStatus = async (data, req = null) => {
//     if (!data.result || !Array.isArray(data.result)) {
//         console.warn("No valid data to process");
//         await LoggingService.log({
//             description: "No valid data to process for inbound status",
//             logType: LOG_TYPES.WARNING,
//             module: MODULES.API,
//             action: ACTIONS.CREATE,
//             status: STATUS.WARNING
//         });
//         return;
//     }

//     const batchSize = 100;
//     const batches = [];
//     // const maxRetries = 3; // Not used but kept for reference
//     // const retryDelay = 1000; // Not used but kept for reference
//     let successCount = 0;
//     let errorCount = 0;
//     let responseFileResults = [];

//     for (let i = 0; i < data.result.length; i += batchSize) {
//         batches.push(data.result.slice(i, i + batchSize));
//     }

//     console.log(`Processing ${batches.length} batches of ${batchSize} documents each`);

//     // Log the start of batch processing
//     await LoggingService.log({
//         description: `Starting to process ${data.result.length} documents in ${batches.length} batches`,
//         logType: LOG_TYPES.INFO,
//         module: MODULES.API,
//         action: ACTIONS.CREATE,
//         status: STATUS.PENDING,
//         details: { totalDocuments: data.result.length, batchCount: batches.length }
//     });

//     // Helper function to format dates
//     const formatDate = (date) => {
//         if (!date) return null;
//         if (typeof date === 'string') return date;
//         if (date instanceof Date) return date.toISOString();
//         return null;
//     };

//     // If Prisma client was generated before documentCurrency was added, upsert will throw. We retry without it and log once.
//     let documentCurrencySkippedLog = false;

//     // Process batches sequentially to reduce concurrency
//     for (const batch of batches) {
//         // Process documents in smaller chunks to reduce deadlock probability
//         const chunkSize = 10;
//         for (let i = 0; i < batch.length; i += chunkSize) {
//             const chunk = batch.slice(i, i + chunkSize);
//             const results = await Promise.all(chunk.map(async item => {
//                 try {
//                     // Ensure issuerName is set from supplierName if missing
//                     const issuerName = item.issuerName || item.supplierName || null;

//                     // documentCurrency: from LHDN mapping (documentCurrencyCode, etc.) or API DocumentCurrencyCode. Persisted for Total Sales column.
//                     const documentCurrency = item.documentCurrency || item.documentCurrencyCode || item.currencyCode || item.currency || item.DocumentCurrencyCode || null;

//                     const updatePayload = {
//                         submissionUid: item.submissionUid,
//                         longId: item.longId,
//                         internalId: item.internalId,
//                         typeName: item.typeName,
//                         typeVersionName: item.typeVersionName,
//                         issuerTin: item.issuerTin || item.supplierTin || null,
//                         issuerName: issuerName,
//                         receiverId: item.receiverId || item.buyerTin || item.buyerTIN || null,
//                         receiverName: item.receiverName || item.buyerName || null,
//                         dateTimeReceived: formatDate(item.dateTimeReceived),
//                         dateTimeValidated: formatDate(item.dateTimeValidated),
//                         status: item.status,
//                         documentStatusReason: item.documentStatusReason,
//                         totalSales: item.totalSales || item.total || item.netAmount || 0,
//                         totalExcludingTax: item.totalExcludingTax || 0,
//                         totalDiscount: item.totalDiscount || 0,
//                         totalNetAmount: item.totalNetAmount || item.netAmount || 0,
//                         totalPayableAmount: item.totalPayableAmount || item.total || 0,
//                         documentCurrency,
//                         last_sync_date: formatDate(new Date()),
//                         sync_status: 'success'
//                     };
//                     const createPayload = {
//                         uuid: item.uuid,
//                         submissionUid: item.submissionUid,
//                         longId: item.longId,
//                         internalId: item.internalId,
//                         typeName: item.typeName,
//                         typeVersionName: item.typeVersionName,
//                         issuerTin: item.issuerTin || item.supplierTin || null,
//                         issuerName: issuerName,
//                         receiverId: item.receiverId || item.buyerTin || item.buyerTIN || null,
//                         receiverName: item.receiverName || item.buyerName || null,
//                         dateTimeReceived: formatDate(item.dateTimeReceived),
//                         dateTimeValidated: formatDate(item.dateTimeValidated),
//                         status: item.status,
//                         documentStatusReason: item.documentStatusReason,
//                         totalSales: item.totalSales || item.total || item.netAmount || 0,
//                         totalExcludingTax: item.totalExcludingTax || 0,
//                         totalDiscount: item.totalDiscount || 0,
//                         totalNetAmount: item.totalNetAmount || item.netAmount || 0,
//                         totalPayableAmount: item.totalPayableAmount || item.total || 0,
//                         documentCurrency,
//                         last_sync_date: formatDate(new Date()),
//                         sync_status: 'success'
//                     };

//                     try {
//                         await prisma.wP_INBOUND_STATUS.upsert({
//                             where: { uuid: item.uuid },
//                             update: updatePayload,
//                             create: createPayload
//                         });
//                     } catch (prismaErr) {
//                         // Deployed Prisma client may not include documentCurrency (schema + generate not yet run). Retry without it.
//                         if (prismaErr?.name === 'PrismaClientValidationError' && /documentCurrency/i.test(String(prismaErr?.message || ''))) {
//                             const { documentCurrency: _u, ...updateWithout } = updatePayload;
//                             const { documentCurrency: _c, ...createWithout } = createPayload;
//                             await prisma.wP_INBOUND_STATUS.upsert({
//                                 where: { uuid: item.uuid },
//                                 update: updateWithout,
//                                 create: createWithout
//                             });
//                             if (!documentCurrencySkippedLog) {
//                                 console.warn('[saveInboundStatus] Prisma client does not include documentCurrency. Run: 1) pnpm prisma migrate deploy 2) pnpm prisma generate 3) restart app. documentCurrency will not be persisted until then.');
//                                 documentCurrencySkippedLog = true;
//                             }
//                         } else {
//                             throw prismaErr;
//                         }
//                     }

//                     // Log if we fixed a missing issuerName
//                     if (!item.issuerName && item.supplierName) {
//                         console.log(`Fixed missing issuerName using supplierName for UUID: ${item.uuid}`);
//                     }

//                     // Generate response file only for valid documents
//                     if (item.status === 'Valid') {
//                         const responseResult = await generateResponseFile(item, req);
//                         responseFileResults.push(responseResult);
//                     }

//                     // Synchronize status between inbound and outbound tables
//                     if (item.status === 'Failed') {
//                         // Update the corresponding outbound status record using Prisma
//                         // Note: UUID is not a unique field, so we need to use updateMany instead of update
//                         await prisma.wP_OUTBOUND_STATUS.updateMany({
//                             where: { UUID: item.uuid },
//                             data: {
//                                 status: 'Failed',
//                                 updated_at: new Date().toISOString(),
//                                 submitted_by: req?.session?.user?.username || 'System' // Add username from session
//                             }
//                         });
//                     } else if (item.status === 'Valid') {
//                         // Update the corresponding outbound status record for Valid documents
//                         await prisma.wP_OUTBOUND_STATUS.updateMany({
//                             where: { UUID: item.uuid },
//                             data: {
//                                 status: 'Valid',
//                                 date_sync: new Date().toISOString(),
//                                 updated_at: new Date().toISOString(),
//                                 submitted_by: req?.session?.user?.username || 'System'
//                             }
//                         });
//                     } else if (item.status === 'Invalid') {
//                         // Update the corresponding outbound status record for Invalid documents
//                         await prisma.wP_OUTBOUND_STATUS.updateMany({
//                             where: { UUID: item.uuid },
//                             data: {
//                                 status: 'Invalid',
//                                 updated_at: new Date().toISOString(),
//                                 submitted_by: req?.session?.user?.username || 'System'
//                             }
//                         });
//                     } else if (item.status === 'Cancelled') {
//                         // Update the corresponding outbound status record for Cancelled documents
//                         await prisma.wP_OUTBOUND_STATUS.updateMany({
//                             where: { UUID: item.uuid },
//                             data: {
//                                 status: 'Cancelled',
//                                 date_cancelled: new Date().toISOString(),
//                                 updated_at: new Date().toISOString(),
//                                 submitted_by: req?.session?.user?.username || 'System'
//                             }
//                         });
//                     }

//                     successCount++;
//                     return { success: true, item };
//                 } catch (error) {
//                     console.error(`Error processing document ${item.uuid}:`, error);
//                     errorCount++;
//                     return { success: false, item, error };
//                 }
//             }));

//             // Log results for this chunk
//             const chunkSuccesses = results.filter(r => r.success).length;
//             const chunkErrors = results.filter(r => !r.success).length;
//             console.log(`Chunk processed: ${chunkSuccesses} successes, ${chunkErrors} errors`);
//         }
//     }

//     // Summarize response file generation results
//     const successfulResponses = responseFileResults.filter(r => r.success);
//     if (successfulResponses.length > 0) {
//         console.log(`Successfully generated ${successfulResponses.length} response files`);
//         successfulResponses.forEach(result => {
//             console.log(`Generated: ${result.fileName} for company ${result.company}`);
//         });
//     }

//     console.log(`Save operation completed. Success: ${successCount}, Errors: ${errorCount}`);

//     return {
//         successCount,
//         errorCount,
//         responseFiles: {
//             total: responseFileResults.length,
//             successful: successfulResponses.length,
//             results: responseFileResults
//         }
//     };
// };

// const requestLogger = async (req, _res, next) => {
//     const requestId = Math.random().toString(36).substring(7);
//     console.log(`[${requestId}] New request:`, {
//         method: req.method,
//         path: req.path,
//         params: req.params,
//         query: req.query,
//         user: req.session?.user?.id || 'anonymous'
//     });
//     req.requestId = requestId;
//     next();
// };

// // Function to poll submission status using GetSubmission API
// const pollSubmissionStatus = async (submissionUid, maxAttempts = 10) => {
//     try {
//         if (!submissionUid) {
//             throw new Error('Submission UID is required for polling');
//         }

//         console.log(`Starting to poll submission status for: ${submissionUid}`);

//         // Get LHDN configuration
//         const lhdnConfig = await getLHDNConfig();

//         // Get token from file - try multiple patterns to be safe
//         const tokenFilePath = path.join(__dirname, '../../config/AuthorizeToken.ini');
//         let token = null;

//         if (fs.existsSync(tokenFilePath)) {
//             const tokenData = fs.readFileSync(tokenFilePath, 'utf8');

//             // Try different possible token formats in the file
//             const tokenPatterns = [
//                 /AccessToken=(.+)/,
//                 /access_token=(.+)/,
//                 /token=(.+)/
//             ];

//             for (const pattern of tokenPatterns) {
//                 const tokenMatch = tokenData.match(pattern);
//                 if (tokenMatch && tokenMatch[1]) {
//                     token = tokenMatch[1].trim();
//                     console.log(`Found token in AuthorizeToken.ini using pattern: ${pattern}`);
//                     break;
//                 }
//             }

//             // If we still don't have a token, try parsing as INI
//             if (!token && tokenData.includes('[') && tokenData.includes(']')) {
//                 try {
//                     const ini = require('ini');
//                     const parsedIni = ini.parse(tokenData);

//                     // Check common sections and keys
//                     if (parsedIni.Token?.AccessToken) {
//                         token = parsedIni.Token.AccessToken;
//                     } else if (parsedIni.Token?.access_token) {
//                         token = parsedIni.Token.access_token;
//                     } else if (parsedIni.LHDN?.token) {
//                         token = parsedIni.LHDN.token;
//                     }

//                     if (token) {
//                         console.log('Found token in AuthorizeToken.ini using INI parsing');
//                     }
//                 } catch (iniError) {
//                     console.error('Error parsing AuthorizeToken.ini:', iniError);
//                 }
//             }
//         }

//         // If still no token, try to get it from the token service
//         if (!token) {
//             try {
//                 console.log('No token found in file, trying to get from token service...');
//                 const { getTokenSession } = require('../../services/token-prisma.service');
//                 token = await getTokenSession();

//                 if (token) {
//                     console.log('Successfully retrieved token from token service');
//                 }
//             } catch (tokenServiceError) {
//                 console.error('Error getting token from service:', tokenServiceError);
//             }
//         }

//         if (!token) {
//             throw new Error('No valid access token found for polling');
//         }

//         let attempts = 0;
//         let inProgress = true;
//         let submissionStatus = null;

//         while (inProgress && attempts < maxAttempts) {
//             attempts++;

//             try {
//                 // Call GetSubmission API with proper polling interval
//                 const response = await axios.get(
//                     `${lhdnConfig.baseUrl}/api/v1.0/documentsubmissions/${submissionUid}`,
//                     {
//                         params: {
//                             pageNo: 1,
//                             pageSize: 100 // Maximum allowed page size
//                         },
//                         headers: {
//                             'Authorization': `Bearer ${token}`,
//                             'Accept': 'application/json',
//                             'Content-Type': 'application/json'
//                         },
//                         timeout: lhdnConfig.timeout
//                     }
//                 );

//                 // Check if submission is still in progress
//                 submissionStatus = response.data;

//                 if (submissionStatus.overallStatus && submissionStatus.overallStatus.toLowerCase() !== 'in progress') {
//                     inProgress = false;
//                     console.log(`Submission ${submissionUid} completed with status: ${submissionStatus.overallStatus}`);

//                     // Process documents in the submission
//                     if (submissionStatus.documentSummary && Array.isArray(submissionStatus.documentSummary)) {
//                         console.log(`Processing ${submissionStatus.documentSummary.length} documents from submission`);

//                         // Save documents to database
//                         await saveInboundStatus({
//                             result: submissionStatus.documentSummary.map(doc => ({
//                                 ...doc,
//                                 // Ensure consistent field names
//                                 uuid: doc.uuid,
//                                 submissionUid: doc.submissionUid,
//                                 longId: doc.longId,
//                                 internalId: doc.internalId,
//                                 typeName: doc.typeName,
//                                 typeVersionName: doc.typeVersionName,
//                                 issuerTin: doc.issuerTin,
//                                 issuerName: doc.issuerName,
//                                 receiverId: doc.receiverId,
//                                 receiverName: doc.receiverName,
//                                 dateTimeReceived: doc.dateTimeReceived,
//                                 dateTimeValidated: doc.dateTimeValidated,
//                                 status: doc.status,
//                                 documentStatusReason: doc.documentStatusReason,
//                                 totalSales: doc.totalSales || doc.totalPayableAmount,
//                                 totalExcludingTax: doc.totalExcludingTax,
//                                 totalDiscount: doc.totalDiscount,
//                                 totalNetAmount: doc.totalNetAmount,
//                                 totalPayableAmount: doc.totalPayableAmount
//                             }))
//                         });
//                     }

//                     return {
//                         success: true,
//                         status: submissionStatus.overallStatus,
//                         documentCount: submissionStatus.documentCount,
//                         documents: submissionStatus.documentSummary || []
//                     };
//                 }

//                 console.log(`Submission ${submissionUid} still in progress (attempt ${attempts}/${maxAttempts}), waiting...`);

//                 // Wait for 5 seconds between polling attempts (as recommended by LHDN)
//                 await delay(5000);

//             } catch (error) {
//                 console.error(`Error polling submission status (attempt ${attempts}/${maxAttempts}):`, error.message);

//                 // If we get a rate limit error, wait longer
//                 if (error.response?.status === 429) {
//                     const retryAfter = parseInt(error.response.headers['retry-after'] || '30');
//                     console.log(`Rate limited, waiting ${retryAfter} seconds before retry...`);
//                     await delay(retryAfter * 1000);
//                 } else {
//                     // For other errors, wait 5 seconds before retry
//                     await delay(5000);
//                 }
//             }
//         }

//         // If we've reached max attempts and still in progress
//         if (inProgress) {
//             console.log(`Reached maximum polling attempts (${maxAttempts}) for submission ${submissionUid}`);
//             return {
//                 success: false,
//                 status: 'timeout',
//                 message: `Polling timed out after ${maxAttempts} attempts`,
//                 submissionUid
//             };
//         }

//         return {
//             success: true,
//             status: submissionStatus?.overallStatus || 'unknown',
//             documentCount: submissionStatus?.documentCount || 0,
//             documents: submissionStatus?.documentSummary || []
//         };

//     } catch (error) {
//         console.error('Error in pollSubmissionStatus:', error);
//         return {
//             success: false,
//             status: 'error',
//             message: error.message,
//             error
//         };
//     }
// };

// // Import token refresh middleware
// const tokenRefreshMiddleware = require('../../middleware/token-refresh.middleware');

// // Apply middlewares
// router.use(requestLogger);
// router.use(tokenRefreshMiddleware);

// // Document refresh endpoint
// router.post('/documents/refresh', async (req, res) => {
//     try {
//         console.log('LHDN documents/refresh endpoint hit');

//         // Check if user is logged in
//         if (!req.session?.user) {
//             console.log('No user session found');
//             return handleAuthError(req, res);
//         }

//         // Log the refresh request
//         await LoggingService.log({
//             description: 'Manual refresh of LHDN documents requested',
//             username: req.session?.user?.username || 'System',
//             userId: req.session?.user?.id,
//             ipAddress: req.ip,
//             logType: LOG_TYPES.INFO,
//             module: MODULES.API,
//             action: ACTIONS.READ,
//             status: STATUS.PENDING
//         });

//         // Force refresh by clearing cache
//         const cacheKey = `recentDocuments_${req.session?.user?.TIN || 'default'}`;
//         cache.del(cacheKey);

//         // Fetch fresh data from LHDN API
//         const fetchResult = await fetchRecentDocuments(req);

//         // Log the result
//         await LoggingService.log({
//             description: `Manual refresh completed: ${fetchResult.result?.length || 0} documents retrieved`,
//             username: req.session?.user?.username || 'System',
//             userId: req.session?.user?.id,
//             ipAddress: req.ip,
//             logType: LOG_TYPES.INFO,
//             module: MODULES.API,
//             action: ACTIONS.READ,
//             status: STATUS.SUCCESS,
//             details: {
//                 count: fetchResult.result?.length || 0,
//                 fromApi: fetchResult.fromApi || false,
//                 fromDatabase: fetchResult.fromDatabase || false,
//                 cached: fetchResult.cached || false
//             }
//         });

//         // Return success response
//         return res.json({
//             success: true,
//             message: 'Documents refreshed successfully',
//             count: fetchResult.result?.length || 0,
//             timestamp: new Date().toISOString()
//         });
//     } catch (error) {
//         console.error('Error refreshing documents:', error);

//         // Log the error
//         await LoggingService.log({
//             description: `Error refreshing LHDN documents: ${error.message}`,
//             username: req.session?.user?.username || 'System',
//             userId: req.session?.user?.id,
//             ipAddress: req.ip,
//             logType: LOG_TYPES.ERROR,
//             module: MODULES.API,
//             action: ACTIONS.READ,
//             status: STATUS.FAILED,
//             details: { error: error.message }
//         });

//         // Check if it's an authentication error
//         if (error.message === 'Authentication failed. Please log in again.' ||
//             error.response?.status === 401 ||
//             error.response?.status === 403) {
//             return handleAuthError(req, res);
//         }

//         // Return error response
//         return res.status(500).json({
//             success: false,
//             message: 'Failed to refresh documents',
//             error: {
//                 code: error.code || 'REFRESH_ERROR',
//                 message: error.message || 'An unexpected error occurred',
//                 details: error.response?.data?.error || error.stack
//             }
//         });
//     }
// });

// // Authentication status endpoint - REMOVED DUPLICATE

// // Helper function to read token from file
// async function readTokenFromFile() {
//     try {
//         const tokenFilePath = path.join(__dirname, '../../config/AuthorizeToken.ini');
//         if (fs.existsSync(tokenFilePath)) {
//             const tokenData = await fsPromises.readFile(tokenFilePath, 'utf8');

//             // Try different possible token formats in the file
//             let tokenMatch = tokenData.match(/AccessToken=(.+)/i) ||
//                             tokenData.match(/access_token=(.+)/i) ||
//                             tokenData.match(/token=(.+)/i);

//             if (tokenMatch && tokenMatch[1]) {
//                 console.log('Found token in AuthorizeToken.ini file');
//                 return tokenMatch[1].trim();
//             } else {
//                 console.log('Token pattern not found in AuthorizeToken.ini file');
//                 // Try to parse as JSON if no match found
//                 try {
//                     const jsonData = JSON.parse(tokenData);
//                     if (jsonData.access_token) {
//                         console.log('Found token in JSON format in AuthorizeToken.ini file');
//                         return jsonData.access_token;
//                     }
//                 } catch (jsonError) {
//                     // Not JSON format, continue
//                     console.log('AuthorizeToken.ini is not in JSON format');
//                 }
//             }
//         } else {
//             console.log('AuthorizeToken.ini file not found');
//         }
//         return null;
//     } catch (error) {
//         console.error('Error reading token from file:', error);
//         return null;
//     }
// }

// // Routes
// router.get('/documents/recent', async (req, res) => {
//     console.log('LHDN documents/recent endpoint hit');
//     try {
//         // Check if user is logged in
//         if (!req.session?.user) {
//             console.log('No user session found');
//             return handleAuthError(req, res);
//         }

//         console.log('User from session:', req.session.user);

//         // Check if we should use database only (for fallback)
//         const useDatabase = req.query.useDatabase === 'true';
//         const fallbackOnly = req.query.fallbackOnly === 'true';
//         const useCache = req.query.useCache === 'true';

//         // If fallbackOnly is true, skip token check and API call
//         if (fallbackOnly) {
//             console.log('Fallback only mode requested, skipping token check and API call');
//             try {
//                 // Get documents from database
//                 const dbDocuments = await prisma.wP_INBOUND_STATUS.findMany({
//                     orderBy: {
//                         dateTimeReceived: 'desc'
//                     },
//                     take: 1000 // Limit to latest 1000 records
//                 });

//                 if (dbDocuments && dbDocuments.length > 0) {
//                     console.log(`Found ${dbDocuments.length} documents in database for fallback`);
//                     return res.json({
//                         success: true,
//                         result: dbDocuments,
//                         metadata: {
//                             total: dbDocuments.length,
//                             fromDatabase: true,
//                             fromApi: false,
//                             fallback: true,
//                             timestamp: new Date().toISOString()
//                         }
//                     });
//                 } else {
//                     return res.status(404).json({
//                         success: false,
//                         message: 'No documents found in database',
//                         error: {
//                             code: 'NO_DATA',
//                             message: 'No documents found in database'
//                         }
//                     });
//                 }
//             } catch (dbError) {
//                 console.error('Error getting documents from database:', dbError);
//                 return res.status(500).json({
//                     success: false,
//                     message: 'Error getting documents from database',
//                     error: {
//                         code: 'DATABASE_ERROR',
//                         message: dbError.message
//                     }
//                 });
//             }
//         }

//         // First try to get token from file (preferred method)
//         let accessToken = await readTokenFromFile();

//         // If no token in file, try session as fallback
//         if (!accessToken && req.session.accessToken) {
//             console.log('No token in file, using token from session');
//             accessToken = req.session.accessToken;
//         }

//         // If still no token, try to get a fresh one
//         if (!accessToken) {
//             try {
//                 console.log('No token found, attempting to get a fresh token');
//                 const { getTokenSession } = require('../../services/token-prisma.service');
//                 accessToken = await getTokenSession();
//                 if (accessToken) {
//                     console.log('Successfully obtained fresh token');
//                 }
//             } catch (tokenError) {
//                 console.error('Error getting fresh token:', tokenError);
//             }
//         }

//         // Final check if we have a token
//         if (!accessToken) {
//             console.log('No access token found after all attempts');

//             // If useDatabase is true, try to get documents from database instead of returning error
//             if (useDatabase) {
//                 try {
//                     // Get documents from database
//                     const dbDocuments = await prisma.wP_INBOUND_STATUS.findMany({
//                         orderBy: {
//                             dateTimeReceived: 'desc'
//                         },
//                         take: 1000 // Limit to latest 1000 records
//                     });

//                     if (dbDocuments && dbDocuments.length > 0) {
//                         console.log(`Found ${dbDocuments.length} documents in database as fallback for missing token`);
//                         return res.json({
//                             success: true,
//                             result: dbDocuments,
//                             metadata: {
//                                 total: dbDocuments.length,
//                                 fromDatabase: true,
//                                 fromApi: false,
//                                 fallback: true,
//                                 timestamp: new Date().toISOString()
//                             }
//                         });
//                     }
//                 } catch (dbError) {
//                     console.error('Error getting documents from database:', dbError);
//                 }
//             }

//             return handleAuthError(req, res);
//         }

//         // Always update session with the token we're using
//         req.session.accessToken = accessToken;
//         console.log('Updated session with token');

//         try {
//             // If useCache is true, return a signal to use cached data
//             if (useCache) {
//                 console.log('Client requested to use cached data');
//                 return res.json({
//                     success: true,
//                     useCache: true,
//                     result: [], // Empty result, client will use its cached data
//                     metadata: {
//                         cached: true,
//                         fromCache: true,
//                         timestamp: new Date().toISOString()
//                     }
//                 });
//             }

//             // Get documents using enhanced caching function
//             const fetchResult = await getCachedDocuments(req);

//             if (!fetchResult.success && fetchResult.error) {
//                 // If fetch failed and no fallback data, return error
//                 if (!fetchResult.result || fetchResult.result.length === 0) {
//                     const statusCode = fetchResult.error?.response?.status || 500;
//                     return res.status(statusCode).json({
//                         success: false,
//                         error: {
//                             code: fetchResult.error.code || 'FETCH_ERROR',
//                             message: fetchResult.error.message || 'Failed to fetch documents',
//                             details: fetchResult.error.details || fetchResult.error.stack
//                         },
//                         metadata: {
//                             timestamp: new Date().toISOString()
//                         }
//                     });
//                 }
//                 // If fetch failed but fallback data is available, log warning and proceed
//                 console.warn('Fetch from API failed, but using database fallback:', fetchResult.error.message);
//             }

//             const documents = fetchResult.result || [];
//             console.log('Got documents from fetchResult, count:', documents.length);

//             // [Trace] First doc before format - see what we have for documentCurrency
//             if (documents.length > 0) {
//                 const d = documents[0];
//                 console.log('[documents/recent] Source: fromApi=', fetchResult.fromApi, 'fromDatabase=', fetchResult.fromDatabase);
//                 console.log('[documents/recent] First doc (before format) - keys:', Object.keys(d).join(', '));
//                 console.log('[documents/recent] First doc - currency fields:', { documentCurrencyCode: d.documentCurrencyCode, documentCurrency: d.documentCurrency, currencyCode: d.currencyCode, currency: d.currency, hasDocumentDetails: typeof d.documentDetails });
//             }

//             // Helper function to format dates for display
//             const formatDateForDisplay = (dateString) => {
//                 if (!dateString) return null;
//                 try {
//                     const date = new Date(dateString);
//                     if (isNaN(date.getTime())) return dateString; // Return original if invalid
//                     return date.toISOString();
//                 } catch (err) {
//                     console.log('Error formatting date:', dateString, err);
//                     return dateString;
//                 }
//             };

//             // Helper function to format dates for UI display
//             const formatDateForUI = (dateString) => {
//                 if (!dateString) return null;
//                 try {
//                     const date = new Date(dateString);
//                     if (isNaN(date.getTime())) return null;

//                     // Format as "Apr 07, 2025, 01:14 PM"
//                     return date.toLocaleString('en-US', {
//                         month: 'short',
//                         day: '2-digit',
//                         year: 'numeric',
//                         hour: '2-digit',
//                         minute: '2-digit',
//                         hour12: true
//                     });
//                 } catch (err) {
//                     console.log('Error formatting date for UI:', dateString, err);
//                     return null;
//                 }
//             };

//             const formattedDocuments = await Promise.all(documents.map(async (doc) => {
//                 // Get submission and validation dates
//                 const receivedDate = doc.dateTimeReceived || doc.created_at;
//                 const validatedDate = doc.dateTimeValidated;
//                 // Calculate processing time in minutes (float)
//                 let processingTimeMinutes = null;
//                 if (receivedDate && validatedDate) {
//                     try {
//                         const received = new Date(receivedDate);
//                         const validated = new Date(validatedDate);
//                         if (!isNaN(received.getTime()) && !isNaN(validated.getTime())) {
//                             processingTimeMinutes = (validated - received) / (1000 * 60);
//                         }
//                     } catch (e) {
//                         processingTimeMinutes = null;
//                     }
//                 }
//                 // documentCurrency: 1) from API/DB fields, 2) documentDetails JSON, 3) record.document (UBL). Backfill WP_Inbound_Status when we resolve from UBL.
//                 let documentCurrency = doc.documentCurrencyCode || doc.documentCurrency || doc.currencyCode || doc.currency || null;
//                 if (!documentCurrency && typeof doc.documentDetails === 'string') {
//                     try {
//                         const o = JSON.parse(doc.documentDetails);
//                         documentCurrency = o.documentCurrencyCode || o.documentCurrency || o.currencyCode || o.currency || null;
//                     } catch (e) { /* ignore */ }
//                 }
//                 if (!documentCurrency && doc.document && typeof doc.document === 'string') {
//                     const fromRaw = await extractDocumentCurrencyFromRaw(doc.document);
//                     if (fromRaw) {
//                         documentCurrency = fromRaw;
//                         if (!doc.documentCurrency) persistDocumentCurrencyIfNull(doc.uuid, fromRaw);
//                     }
//                 }
//                 return {
//                     uuid: doc.uuid,
//                     submissionUid: doc.submissionUid,
//                     longId: doc.longId,
//                     internalId: doc.internalId,
//                     dateTimeIssued: formatDateForDisplay(doc.dateTimeIssued),
//                     dateTimeReceived: formatDateForDisplay(receivedDate),
//                     dateTimeValidated: formatDateForDisplay(validatedDate),
//                     submissionDate: formatDateForDisplay(receivedDate),
//                     validationDate: formatDateForDisplay(validatedDate),
//                     // UI display formatted dates
//                     receivedDateFormatted: formatDateForUI(receivedDate),
//                     validatedDateFormatted: formatDateForUI(validatedDate),
//                     dateInfo: {
//                         date: formatDateForUI(validatedDate || receivedDate),
//                         type: validatedDate ? 'Validated' : 'Submitted',
//                         tooltip: validatedDate ? 'LHDN Validation Date' : 'LHDN Submission Date'
//                     },
//                     status: doc.status,
//                     totalSales: doc.totalSales || 0,
//                     totalExcludingTax: doc.totalExcludingTax || 0,
//                     totalDiscount: doc.totalDiscount || 0,
//                     totalNetAmount: doc.totalNetAmount || 0,
//                     totalPayableAmount: doc.totalPayableAmount || 0,
//                     issuerTin: doc.issuerTin ,
//                     issuerName: doc.issuerName,
//                     receiverId: doc.receiverId,
//                     receiverName: doc.receiverName,
//                     supplierName: doc.issuerName, // Use the potentially updated issuerName
//                     typeName: doc.typeName,
//                     typeVersionName: doc.typeVersionName,
//                     documentStatusReason: doc.documentStatusReason,
//                     documentCurrency: documentCurrency || null,
//                     processingTimeMinutes
//                 };
//             }));

//             // [Trace] Formatted documentCurrency - what we send to the table
//             if (formattedDocuments.length > 0) {
//                 console.log('[documents/recent] Formatted documentCurrency (first 5):', formattedDocuments.slice(0, 5).map(x => ({ internalId: x.internalId, documentCurrency: x.documentCurrency })));
//             }
//             console.log('Sending response with formatted documents:', formattedDocuments.length);

//             res.json({
//                 success: true,
//                 result: formattedDocuments,
//                 metadata: {
//                     total: formattedDocuments.length,
//                     cached: fetchResult.cached,
//                     fromDatabase: fetchResult.fromDatabase,
//                     fromApi: fetchResult.fromApi,
//                     fallback: fetchResult.fallback,
//                     error: fetchResult.error ? { message: fetchResult.error.message } : undefined,
//                     timestamp: new Date().toISOString()
//                 }
//             });
//         } catch (error) {
//             console.error('Error in documents/recent route processing:', error);

//             const statusCode = error.response?.status || 500;
//             res.status(statusCode).json({
//                 success: false,
//                 error: {
//                     code: error.code || 'INTERNAL_SERVER_ERROR',
//                     message: error.message || 'An unexpected error occurred',
//                     details: error.response?.data?.error || error.original?.message || null,
//                     timestamp: new Date().toISOString()
//                 }
//             });
//         }
//     } catch (error) {
//         console.error('Error in route handler:', error);

//         // Check if it's an authentication error
//         if (error.message === 'Authentication failed. Please log in again.' ||
//             error.response?.status === 401 ||
//             error.response?.status === 403) {
//             return handleAuthError(req, res);
//         }

//         const statusCode = error.response?.status || 500;
//         res.status(statusCode).json({
//             success: false,
//             error: {
//                 code: error.code || 'INTERNAL_SERVER_ERROR',
//                 message: error.message || 'An unexpected error occurred',
//                 details: error.response?.data?.error || error.original?.message || null,
//                 timestamp: new Date().toISOString()
//             }
//         });
//     }
// });

// router.get('/documents/recent-total', async (_req, res) => {
//     try {
//         const totalCount = await prisma.wP_INBOUND_STATUS.count();
//         res.json({ totalCount, success: true });
//     } catch (error) {
//         console.error('Error getting total count:', error);
//         res.json({
//             totalCount: 0,
//             success: false,
//             message: 'Failed to fetch recent documents'
//         });
//     }
// });

// // Archive staging endpoint - Get all documents from WP_INBOUND_STATUS table
// router.get('/documents/archive-staging', async (req, res) => {
//     try {
//         console.log('Fetching archive staging data from WP_INBOUND_STATUS');

//         // Get all records from WP_INBOUND_STATUS table
//         let archiveRecords = await prisma.wP_INBOUND_STATUS.findMany({
//             orderBy: {
//                 dateTimeReceived: 'desc'
//             }
//         });

//         console.log(`Found ${archiveRecords.length} archive staging records`);
//         archiveRecords = await filterPinnacleOnlyInbound(archiveRecords, req);

//         // Locate Invoice in parsed UBL/XML (handles namespaces, explicitRoot, wrappers). Same logic as display-details.
//         const findInvoiceInParsed = (parsed) => {
//             if (!parsed || typeof parsed !== 'object') return null;
//             if (parsed.root && typeof parsed.root === 'object') return findInvoiceInParsed(parsed.root);
//             for (const k of Object.keys(parsed)) {
//                 const local = (k && k.includes(':')) ? k.split(':').pop() : k;
//                 if (local === 'Invoice') {
//                     const v = parsed[k];
//                     return (Array.isArray(v) && v.length) ? v[0] : (v && typeof v === 'object' ? v : null);
//                 }
//             }
//             const keys = Object.keys(parsed);
//             if (keys.length === 1) {
//                 const v = parsed[keys[0]];
//                 const child = (Array.isArray(v) && v.length) ? v[0] : v;
//                 if (child && typeof child === 'object') return findInvoiceInParsed(child);
//             }
//             return null;
//         };

//         // Extract DocumentCurrencyCode from raw UBL/XML string (record.document). Same source as PDF.
//         const extractDocumentCurrencyFromXml = async (xmlStr) => {
//             if (typeof xmlStr !== 'string' || !xmlStr.trim().startsWith('<')) return null;
//             try {
//                 const parsed = await parseStringPromise(xmlStr, { explicitArray: true, tagNameProcessors: [processors.stripPrefix] });
//                 const invoice = findInvoiceInParsed(parsed);
//                 if (!invoice || !invoice.DocumentCurrencyCode || !Array.isArray(invoice.DocumentCurrencyCode) || !invoice.DocumentCurrencyCode.length) return null;
//                 const v = invoice.DocumentCurrencyCode[0];
//                 return (typeof v === 'string' ? v : (v && v._)) || null;
//             } catch (e) { return null; }
//         };

//         // 1) record.documentCurrency (persisted from saveInboundStatus), 2) documentDetails (JSON), 3) record.document (UBL/XML). No hardcoded fallback.
//         const getDocumentCurrency = async (record) => {
//             if (record.documentCurrency) return record.documentCurrency;
//             try {
//                 if (typeof record.documentDetails === 'string') {
//                     const o = JSON.parse(record.documentDetails);
//                     const c = o.documentCurrencyCode || o.documentCurrency || o.currencyCode || o.currency;
//                     if (c) return c;
//                 }
//             } catch (e) { /* documentDetails may be XML or invalid */ }
//             if (record.document && typeof record.document === 'string') {
//                 const c = await extractDocumentCurrencyFromXml(record.document);
//                 if (c) return c;
//             }
//             return null;
//         };

//         // Map the data to match the expected format (async: parse record.document when documentDetails is null)
//         const mappedRecords = await Promise.all(archiveRecords.map(async (record) => {
//             const documentCurrency = await getDocumentCurrency(record);
//             return {
//                 uuid: record.uuid,
//                 submissionUid: record.submissionUid,
//                 longId: record.longId,
//                 internalId: record.internalId,
//                 typeName: record.typeName,
//                 typeVersionName: record.typeVersionName,
//                 issuerTin: record.issuerTin,
//                 issuerName: record.issuerName || record.supplierName,
//                 receiverId: record.receiverId,
//                 receiverName: record.receiverName,
//                 receiverTIN: record.receiverTIN,
//                 receiverRegistrationNo: record.receiverRegistrationNo,
//                 receiverAddress: record.receiverAddress,
//                 receiverPostcode: record.receiverPostcode,
//                 receiverCity: record.receiverCity,
//                 receiverState: record.receiverState,
//                 receiverCountry: record.receiverCountry,
//                 receiverPhone: record.receiverPhone,
//                 dateTimeReceived: record.dateTimeReceived,
//                 dateTimeIssued: record.dateTimeIssued,
//                 dateTimeValidated: record.dateTimeValidated,
//                 status: record.status,
//                 documentStatusReason: record.documentStatusReason,
//                 totalSales: record.totalSales,
//                 totalExcludingTax: record.totalExcludingTax,
//                 totalDiscount: record.totalDiscount,
//                 totalNetAmount: record.totalNetAmount,
//                 totalPayableAmount: record.totalPayableAmount,
//                 documentCurrency,
//                 source: 'Archive Staging', // Mark as archive staging
//                 last_sync_date: record.last_sync_date
//             };
//         }));

//         // [Trace] documentCurrency in archive-staging — for Total Sales column
//         if (mappedRecords.length > 0) {
//             const r0 = archiveRecords[0];
//             console.log('[archive-staging] First record - documentCurrency:', mappedRecords[0].documentCurrency, 'internalId:', r0.internalId, 'hasDocumentDetails:', !!r0.documentDetails, 'hasDocument:', !!r0.document);
//             console.log('[archive-staging] Formatted documentCurrency (first 5):', mappedRecords.slice(0, 5).map(x => ({ internalId: x.internalId, documentCurrency: x.documentCurrency })));
//         }

//         res.json({
//             success: true,
//             result: mappedRecords,
//             count: mappedRecords.length,
//             fromArchive: true,
//             timestamp: new Date().toISOString()
//         });

//     } catch (error) {
//         console.error('Error fetching archive staging data:', error);
//         res.status(500).json({
//             success: false,
//             error: error.message || 'Failed to fetch archive staging data',
//             result: []
//         });
//     }
// });

// // New endpoint to check submission status using polling
// router.get('/submission/:submissionUid', async (req, res) => {
//     try {
//         const { submissionUid } = req.params;
//         const maxAttempts = parseInt(req.query.maxAttempts) || 10;

//         if (!submissionUid) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Submission UID is required'
//             });
//         }

//         // Check if user is logged in
//         if (!req.session?.user) {
//             console.log('No user session found');
//             return handleAuthError(req, res);
//         }

//         // Log the request
//         await LoggingService.log({
//             description: `Checking submission status for: ${submissionUid}`,
//             username: req.session?.user?.username || 'System',
//             userId: req.session?.user?.id,
//             ipAddress: req.ip,
//             logType: LOG_TYPES.INFO,
//             module: MODULES.API,
//             action: ACTIONS.READ,
//             status: STATUS.PENDING
//         });

//         // Poll for submission status
//         const result = await pollSubmissionStatus(submissionUid, maxAttempts);

//         // Log the result
//         await LoggingService.log({
//             description: `Submission status check completed for: ${submissionUid}, status: ${result.status}`,
//             username: req.session?.user?.username || 'System',
//             userId: req.session?.user?.id,
//             ipAddress: req.ip,
//             logType: LOG_TYPES.INFO,
//             module: MODULES.API,
//             action: ACTIONS.READ,
//             status: result.success ? STATUS.SUCCESS : STATUS.FAILED,
//             details: {
//                 submissionUid,
//                 status: result.status,
//                 documentCount: result.documentCount || 0
//             }
//         });

//         return res.json(result);
//     } catch (error) {
//         console.error('Error checking submission status:', error);

//         // Log the error
//         await LoggingService.log({
//             description: `Error checking submission status: ${error.message}`,
//             username: req.session?.user?.username || 'System',
//             userId: req.session?.user?.id,
//             ipAddress: req.ip,
//             logType: LOG_TYPES.ERROR,
//             module: MODULES.API,
//             action: ACTIONS.READ,
//             status: STATUS.FAILED,
//             details: { error: error.message }
//         });

//         return res.status(500).json({
//             success: false,
//             status: 'error',
//             message: error.message
//         });
//     }
// });

// // Validation results endpoint
// router.get('/documents/:uuid/validation-results', async (req, res) => {
//     try {
//         const { uuid } = req.params;
//         const requestId = req.requestId;

//         console.log(`[${requestId}] Fetching validation results for document: ${uuid}`);

//         // Check if user is logged in
//         if (!req.session?.user) {
//             console.log(`[${requestId}] No user session found`);
//             return handleAuthError(req, res);
//         }

//         // Get LHDN configuration
//         const lhdnConfig = await getLHDNConfig();

//         // Log the request
//         await LoggingService.log({
//             description: `Fetching validation results for document: ${uuid}`,
//             username: req.session?.user?.username || 'System',
//             userId: req.session?.user?.id,
//             ipAddress: req.ip,
//             logType: LOG_TYPES.INFO,
//             module: MODULES.API,
//             action: ACTIONS.READ,
//             status: STATUS.PENDING
//         });

//         // First check if we have the validation results in the database
//         const dbDocument = await prisma.wP_INBOUND_STATUS.findUnique({
//             where: { uuid }
//         });

//         if (dbDocument && dbDocument.validationResults) {
//             console.log(`[${requestId}] Found validation results in database for document: ${uuid}`);

//             try {
//                 // Parse validation results
//                 const validationResults = JSON.parse(dbDocument.validationResults);

//                 // Log success
//                 await LoggingService.log({
//                     description: `Successfully retrieved validation results from database for document: ${uuid}`,
//                     username: req.session?.user?.username || 'System',
//                     userId: req.session?.user?.id,
//                     ipAddress: req.ip,
//                     logType: LOG_TYPES.INFO,
//                     module: MODULES.API,
//                     action: ACTIONS.READ,
//                     status: STATUS.SUCCESS
//                 });

//                 return res.json({
//                     success: true,
//                     validationResults,
//                     source: 'database'
//                 });
//             } catch (parseError) {
//                 console.error(`[${requestId}] Error parsing validation results from database:`, parseError);
//                 // Continue to fetch from API if parsing fails
//             }
//         }

//         // If not in database or parsing failed, fetch from API
//         console.log(`[${requestId}] Fetching validation results from LHDN API for document: ${uuid}`);

//         // Get document details from LHDN API
//         const response = await axios.get(`${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/details`, {
//             headers: {
//                 'Authorization': `Bearer ${req.session.accessToken}`,
//                 'Content-Type': 'application/json'
//             }
//         });

//         const detailsData = response.data;

//         // Process validation results
//         let processedValidationResults = null;
//         if (detailsData.validationResults) {
//             processedValidationResults = {
//                 status: detailsData.status,
//                 validationSteps: detailsData.validationResults.validationSteps?.map(step => {
//                     let errors = [];
//                     if (step.error) {
//                         if (Array.isArray(step.error.errors)) {
//                             errors = step.error.errors.map(err => ({
//                                 code: err.code || 'VALIDATION_ERROR',
//                                 message: err.message || err.toString(),
//                                 field: err.field || null,
//                                 value: err.value || null,
//                                 details: err.details || null
//                             }));
//                         } else if (typeof step.error === 'object') {
//                             errors = [{
//                                 code: step.error.code || 'VALIDATION_ERROR',
//                                 message: step.error.message || step.error.toString(),
//                                 field: step.error.field || null,
//                                 value: step.error.value || null,
//                                 details: step.error.details || null
//                             }];
//                         } else {
//                             errors = [{
//                                 code: 'VALIDATION_ERROR',
//                                 message: step.error.toString(),
//                                 field: null,
//                                 value: null,
//                                 details: null
//                             }];
//                         }
//                     }

//                     return {
//                         name: step.name || 'Validation Step',
//                         status: step.status || 'Invalid',
//                         error: errors.length > 0 ? { errors } : null,
//                         timestamp: step.timestamp || new Date().toISOString()
//                     };
//                 }) || [],
//                 summary: {
//                     totalSteps: detailsData.validationResults.validationSteps?.length || 0,
//                     failedSteps: detailsData.validationResults.validationSteps?.filter(step => step.status === 'Invalid' || step.error)?.length || 0,
//                     lastUpdated: new Date().toISOString()
//                 }
//             };

//             // Save validation results to database
//             try {
//                 await prisma.wP_INBOUND_STATUS.update({
//                     where: { uuid },
//                     data: {
//                         validationResults: JSON.stringify(processedValidationResults)
//                     }
//                 });
//                 console.log(`[${requestId}] Saved validation results to database for document: ${uuid}`);
//             } catch (dbError) {
//                 console.error(`[${requestId}] Error saving validation results to database:`, dbError);
//                 // Continue even if saving to database fails
//             }
//         }

//         // Log success
//         await LoggingService.log({
//             description: `Successfully retrieved validation results from API for document: ${uuid}`,
//             username: req.session?.user?.username || 'System',
//             userId: req.session?.user?.id,
//             ipAddress: req.ip,
//             logType: LOG_TYPES.INFO,
//             module: MODULES.API,
//             action: ACTIONS.READ,
//             status: STATUS.SUCCESS
//         });

//         return res.json({
//             success: true,
//             validationResults: processedValidationResults,
//             source: 'api'
//         });
//     } catch (error) {
//         console.error('Error fetching validation results:', error);

//         // Log the error
//         await LoggingService.log({
//             description: `Error fetching validation results: ${error.message}`,
//             username: req.session?.user?.username || 'System',
//             userId: req.session?.user?.id,
//             ipAddress: req.ip,
//             logType: LOG_TYPES.ERROR,
//             module: MODULES.API,
//             action: ACTIONS.READ,
//             status: STATUS.FAILED,
//             details: { error: error.message }
//         });

//         // Check if it's an authentication error
//         if (error.message === 'Authentication failed. Please log in again.' ||
//             error.response?.status === 401 ||
//             error.response?.status === 403) {
//             return handleAuthError(req, res);
//         }

//         return res.status(500).json({
//             success: false,
//             message: 'Failed to fetch validation results',
//             error: {
//                 code: error.code || 'VALIDATION_ERROR',
//                 message: error.message || 'An unexpected error occurred',
//                 details: error.response?.data?.error || error.stack
//             }
//         });
//     }
// });

// // Check LHDN API status
// router.get('/status', async (req, res) => {
//     try {
//         // Get LHDN configuration
//         const lhdnConfig = await getLHDNConfig();

//         // Get token from session
//         const accessToken = await getTokenSession();
//         if (!accessToken) {
//             return res.status(401).json({
//                 success: false,
//                 message: 'Failed to get access token'
//             });
//         }

//         // Try to make a simple API call to check if LHDN API is available
//         const response = await axios.get(
//             `${lhdnConfig.baseUrl}/api/v1.0/documents/status`,
//             {
//                 headers: {
//                     'Authorization': `Bearer ${accessToken}`
//                 },
//                 timeout: 5000 // 5 second timeout
//             }
//         );

//         // If we get here, the API is available
//         res.json({
//             success: true,
//             message: 'LHDN API is available',
//             status: 'connected',
//             timestamp: new Date().toISOString()
//         });
//     } catch (error) {
//         console.error('Error checking LHDN API status:', error);

//         // Determine the specific error
//         let errorMessage = 'LHDN API is unavailable';
//         let errorStatus = 'disconnected';

//         if (error.code === 'ECONNABORTED') {
//             errorMessage = 'Connection to LHDN API timed out';
//         } else if (error.response) {
//             // The request was made and the server responded with a status code
//             // that falls out of the range of 2xx
//             errorMessage = `LHDN API returned error: ${error.response.status} ${error.response.statusText}`;

//             if (error.response.status === 401 || error.response.status === 403) {
//                 errorStatus = 'unauthorized';
//             }
//         } else if (error.request) {
//             // The request was made but no response was received
//             errorMessage = 'No response received from LHDN API';
//         }

//         res.status(503).json({
//             success: false,
//             message: errorMessage,
//             status: errorStatus,
//             timestamp: new Date().toISOString()
//         });
//     }
// });

// // Authentication status endpoint - Modified to handle unauthenticated requests better
// router.get('/auth-status', async (req, res) => {
//     try {
//         // This endpoint should always return a 200 status with authentication status
//         // to avoid frontend errors, even when not authenticated

//         // Check if user is logged in
//         if (!req.session?.user) {
//             console.log('LHDN auth-status: No active user session');
//             return res.status(200).json({
//                 success: true, // Changed to true to avoid frontend errors
//                 authenticated: false,
//                 message: 'No active user session',
//                 code: 'SESSION_MISSING'
//             });
//         }

//         // Try to get token from session or file
//         const { getTokenSession, readTokenFromFile } = require('../../services/token-prisma.service');
//         let accessToken = req.session.accessToken;

//         // If no token in session, try to get from file
//         if (!accessToken) {
//             try {
//                 const tokenData = readTokenFromFile();
//                 if (tokenData && tokenData.access_token) {
//                     accessToken = tokenData.access_token;
//                     // Update session with token from file
//                     req.session.accessToken = accessToken;
//                     console.log('LHDN auth-status: Using token from file');
//                 }
//             } catch (fileError) {
//                 console.warn('LHDN auth-status: Error reading token from file:', fileError);
//             }
//         }

//         // If still no token, try to get a fresh one
//         if (!accessToken) {
//             try {
//                 accessToken = await getTokenSession();
//                 // Update session with new token
//                 if (accessToken) {
//                     req.session.accessToken = accessToken;
//                     console.log('LHDN auth-status: Generated new token');
//                 }
//             } catch (tokenError) {
//                 console.warn('LHDN auth-status: Error getting fresh token:', tokenError);
//             }
//         }

//         // Check if we have a token now
//         if (!accessToken) {
//             console.log('LHDN auth-status: No token available after all attempts');
//             return res.status(200).json({
//                 success: true, // Changed to true to avoid frontend errors
//                 authenticated: false,
//                 message: 'No LHDN access token available',
//                 code: 'TOKEN_MISSING'
//             });
//         }

//         // Check token expiry if available
//         const now = Date.now();
//         const tokenExpiry = req.session.tokenExpiryTime || 0;
//         const bufferTime = 5 * 60 * 1000; // 5 minutes buffer

//         if (tokenExpiry && tokenExpiry < (now + bufferTime)) {
//             console.log('LHDN auth-status: Token expired or about to expire');
//             // Try to refresh the token
//             try {
//                 const newToken = await getTokenSession();
//                 if (newToken) {
//                     accessToken = newToken;
//                     req.session.accessToken = newToken;
//                     req.session.tokenExpiryTime = now + (3600 * 1000); // Assume 1 hour validity
//                     console.log('LHDN auth-status: Successfully refreshed expired token');
//                 } else {
//                     return res.status(200).json({
//                         success: true, // Changed to true to avoid frontend errors
//                         authenticated: false,
//                         message: 'LHDN access token is expired and refresh failed',
//                         code: 'TOKEN_EXPIRED',
//                         expiresIn: Math.floor((tokenExpiry - now) / 1000) // seconds until expiry
//                     });
//                 }
//             } catch (refreshError) {
//                 console.warn('LHDN auth-status: Failed to refresh expired token:', refreshError);
//                 return res.status(200).json({
//                     success: true, // Changed to true to avoid frontend errors
//                     authenticated: false,
//                     message: 'LHDN access token is expired and refresh failed',
//                     code: 'TOKEN_EXPIRED',
//                     expiresIn: Math.floor((tokenExpiry - now) / 1000) // seconds until expiry
//                 });
//             }
//         }

//         // Since LHDN API doesn't have a dedicated token verification endpoint,
//         // we'll assume the token is valid if it exists and hasn't expired
//         console.log('LHDN auth-status: Token exists and appears valid');
//         return res.status(200).json({
//             authenticated: true,
//             success: true,
//             message: 'Authentication valid',
//             expiresIn: tokenExpiry ? Math.floor((tokenExpiry - now) / 1000) : null
//         });
//     } catch (error) {
//         console.error('LHDN auth-status: Error checking auth status:', error);
//         return res.status(200).json({
//             success: true, // Changed to true to avoid frontend errors
//             authenticated: false,
//             message: 'Error checking authentication status',
//             error: error.message
//         });
//     }
// });

// // Sync endpoint
// router.get('/sync', async (req, res) => {
//     try {
//             const apiData = await fetchRecentDocuments(req);
//              // Log the start of document fetching
//             await LoggingService.log({
//                 description: 'Starting document fetch from LHDN',
//                 username: req?.session?.user?.username || 'System',
//                 userId: req?.session?.user?.id,
//                 ipAddress: req?.ip,
//                 logType: LOG_TYPES.INFO,
//                 module: MODULES.API,
//                 action: ACTIONS.READ,
//                 status: STATUS.PENDING
//             });
//             await saveInboundStatus(apiData);

//             res.json({ success: true });
//         } catch (error) {
//             console.error('Error syncing with API:', error);
//             res.status(500).json({
//                 success: false,
//                 message: `Failed to sync with API: ${error.message}`
//             });
//         }
// });

// // Refresh documents endpoint - Force refresh from LHDN API
// router.post('/documents/refresh', async (req, res) => {
//     try {
//         // Generate a unique request ID for tracking
//         const requestId = `refresh-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
//         console.log(`[${requestId}] Starting document refresh from LHDN API`);

//         // Clear cache for documents
//         cache.del('documents_recent');

//         // Log the start of document fetching
//         await LoggingService.log({
//             description: 'Manually refreshing documents from LHDN',
//             username: req?.session?.user?.username || 'System',
//             userId: req?.session?.user?.id,
//             ipAddress: req?.ip,
//             logType: LOG_TYPES.INFO,
//             module: MODULES.API,
//             action: ACTIONS.READ,
//             status: STATUS.PENDING,
//             details: { requestId }
//         });

//         // Force fetch from API by setting forceRefresh flag
//         req.query.forceRefresh = 'true';
//         const apiData = await fetchRecentDocuments(req);

//         // Save to database
//         await saveInboundStatus(apiData);

//         // Log success
//         await LoggingService.log({
//             description: 'Successfully refreshed documents from LHDN',
//             username: req?.session?.user?.username || 'System',
//             userId: req?.session?.user?.id,
//             ipAddress: req?.ip,
//             logType: LOG_TYPES.INFO,
//             module: MODULES.API,
//             action: ACTIONS.READ,
//             status: STATUS.SUCCESS,
//             details: {
//                 requestId,
//                 documentCount: apiData?.result?.length || 0
//             }
//         });

//         res.json({
//             success: true,
//             message: 'Successfully refreshed documents from LHDN',
//             count: apiData?.result?.length || 0,
//             timestamp: new Date().toISOString()
//         });
//     } catch (error) {
//         console.error('Error refreshing documents from LHDN API:', error);

//         // Log error
//         await LoggingService.log({
//             description: 'Error refreshing documents from LHDN',
//             username: req?.session?.user?.username || 'System',
//             userId: req?.session?.user?.id,
//             ipAddress: req?.ip,
//             logType: LOG_TYPES.ERROR,
//             module: MODULES.API,
//             action: ACTIONS.READ,
//             status: STATUS.ERROR,
//             details: { error: error.message }
//         });

//         res.status(500).json({
//             success: false,
//             error: {
//                 message: `Failed to refresh documents: ${error.message}`,
//                 code: error.code || 'UNKNOWN_ERROR'
//             }
//         });
//     }
// });

// // Update display-details endpoint to fetch all required data
// router.get('/documents/:uuid/display-details', async (req, res) => {
//     const lhdnConfig = await getLHDNConfig();

//     try {
//         const { uuid } = req.params;

//         // Log the request details
//         console.log('Fetching details for document:', {
//             uuid,
//             user: req.session.user,
//             timestamp: new Date().toISOString()
//         });

//         // Check if user is logged in
//         if (!req.session.user || !req.session.accessToken) {
//             return res.redirect('/login');
//         }

//         // Get document details directly from LHDN API using raw endpoint
//         console.log('Fetching raw document from LHDN API...');
//         const response = await axios.get(`${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/raw`, {
//             headers: {
//                 'Authorization': `Bearer ${req.session.accessToken}`,
//                 'Content-Type': 'application/json'
//             }
//         });

//         const documentData = response.data;
//         console.log('Raw document data:', JSON.stringify(documentData, null, 2));

//         // Get document details from LHDN API
//         const detailsResponse = await axios.get(`${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/details`, {
//             headers: {
//                 'Authorization': `Bearer ${req.session.accessToken}`,
//                 'Content-Type': 'application/json'
//             }
//         });

//         const detailsData = detailsResponse.data;
//         console.log('Raw document details:', JSON.stringify(detailsData, null, 2));

//         // Helper function to get ID information
//         function getPartyIdentification(partyIdentification) {
//             const idTypes = ['TIN', 'BRN', 'NRIC', 'Passport', 'Army', 'SST'];
//             const result = {
//                 tin: null,
//                 registrationNo: null,
//                 taxRegNo: null,
//                 idType: 'NA',
//                 idNumber: 'NA'
//             };

//             if (!partyIdentification) return result;

//             // Get TIN
//             const tinInfo = partyIdentification.find(id => id.ID[0].schemeID === 'TIN');
//             if (tinInfo) {
//                 result.tin = tinInfo.ID[0]._;
//             }

//             // Get Registration Number (try BRN first, then other types)
//             const brnInfo = partyIdentification.find(id => id.ID[0].schemeID === 'BRN');
//             if (brnInfo) {
//                 result.registrationNo = brnInfo.ID[0]._;
//                 result.idType = 'BRN';
//                 result.idNumber = brnInfo.ID[0]._;
//             } else {
//                 // Try other ID types in order
//                 for (const idType of idTypes) {
//                     if (idType === 'TIN' || idType === 'SST') continue;
//                     const idInfo = partyIdentification.find(id => id.ID[0].schemeID === idType);
//                     if (idInfo) {
//                         result.registrationNo = idInfo.ID[0]._;
//                         result.idType = idType;
//                         result.idNumber = idInfo.ID[0]._;
//                         break;
//                     }
//                 }
//             }

//             // Get Tax Registration Number (SST)
//             const sstInfo = partyIdentification.find(id => id.ID[0].schemeID === 'SST');
//             if (sstInfo) {
//                 result.taxRegNo = sstInfo.ID[0]._;
//             }

//             return result;
//         }

//         // Process validation results
//         // This section processes validation results but doesn't use them
//         // Keeping the code for future reference
//         if (detailsData.validationResults) {
//             /* Commented out unused code
//             const processedResults = {
//                 status: detailsData.status,
//                 validationSteps: detailsData.validationResults.validationSteps?.map(step => {
//                     let errors = [];
//                     if (step.error) {
//                         if (Array.isArray(step.error.errors)) {
//                             errors = step.error.errors.map(err => ({
//                                 code: err.code || 'VALIDATION_ERROR',
//                                 message: err.message || err.toString(),
//                                 field: err.field || null,
//                                 value: err.value || null,
//                                 details: err.details || null
//                             }));
//                         } else if (typeof step.error === 'object') {
//                             errors = [{
//                                 code: step.error.code || 'VALIDATION_ERROR',
//                                 message: step.error.message || step.error.toString(),
//                                 field: step.error.field || null,
//                                 value: step.error.value || null,
//                                 details: step.error.details || null
//                             }];
//                         } else {
//                             errors = [{
//                                 code: 'VALIDATION_ERROR',
//                                 message: step.error.toString(),
//                                 field: null,
//                                 value: null,
//                                 details: null
//                             }];
//                         }
//                     }

//                     return {
//                         name: step.name || 'Validation Step',
//                         status: step.status || 'Invalid',
//                         error: errors.length > 0 ? { errors } : null,
//                         timestamp: step.timestamp || new Date().toISOString()
//                     };
//                 }) || [],
//                 summary: {
//                     totalSteps: detailsData.validationResults.validationSteps?.length || 0,
//                     failedSteps: detailsData.validationResults.validationSteps?.filter(step => step.status === 'Invalid' || step.error)?.length || 0,
//                     lastUpdated: new Date().toISOString()
//                 }
//             };
//             */
//         }

//         // Check if document field exists and can be parsed
//         if (!documentData.document) {
//             // Handle case when document field is not present
//             const supplierIdentification = getPartyIdentification([
//                 { ID: [{ schemeID: 'TIN', _: documentData.supplierTin }] },
//                 { ID: [{ schemeID: 'BRN', _: documentData.supplierRegistrationNo }] },
//                 { ID: [{ schemeID: 'SST', _: documentData.supplierSstNo }] }
//             ]);

//             const customerIdentification = getPartyIdentification([
//                 { ID: [{ schemeID: 'TIN', _: documentData.receiverTin }] },
//                 { ID: [{ schemeID: 'BRN', _: documentData.receiverRegistrationNo }] },
//                 { ID: [{ schemeID: 'SST', _: documentData.receiverSstNo }] }
//             ]);

//             const docCurrencyFallback = detailsData.documentCurrencyCode || detailsData.documentCurrency || null;
//             persistDocumentCurrencyIfNull(uuid, docCurrencyFallback);

//             return res.json({
//                 success: true,
//                 documentInfo: {
//                     uuid: documentData.uuid,
//                     submissionUid: documentData.submissionUid,
//                     longId: detailsData.longId,
//                     internalId: documentData.internalId,
//                     status: documentData.status,
//                     documentCurrency: docCurrencyFallback,
//                     validationResults: detailsData.validationResults,
//                     supplierName: documentData.supplierName,
//                     supplierTIN: supplierIdentification.tin,
//                     supplierRegistrationNo: supplierIdentification.registrationNo,
//                     supplierSstNo: supplierIdentification.taxRegNo,
//                     supplierMsicCode: documentData.supplierMsicCode,
//                     supplierAddress: documentData.supplierAddress,
//                     receiverName: documentData.receiverName,
//                     receiverTIN: customerIdentification.tin,
//                     receiverRegistrationNo: customerIdentification.registrationNo,
//                     receiverSstNo: customerIdentification.taxRegNo,
//                     receiverAddress: documentData.receiverAddress
//                 },
//                 supplierInfo: {
//                     company: documentData.supplierName,
//                     tin: supplierIdentification.tin,
//                     registrationNo: supplierIdentification.registrationNo,
//                     taxRegNo: supplierIdentification.taxRegNo,
//                     idType: supplierIdentification.idType,
//                     idNumber: supplierIdentification.idNumber,
//                     msicCode: documentData.supplierMsicCode,
//                     address: documentData.supplierAddress
//                 },
//                 customerInfo: {
//                     company: documentData.receiverName,
//                     tin: customerIdentification.tin,
//                     registrationNo: customerIdentification.registrationNo,
//                     taxRegNo: customerIdentification.taxRegNo,
//                     idType: customerIdentification.idType,
//                     idNumber: customerIdentification.idNumber,
//                     address: documentData.receiverAddress
//                 },
//                 paymentInfo: {
//                     totalIncludingTax: documentData.totalSales,
//                     totalExcludingTax: documentData.totalExcludingTax,
//                     taxAmount: documentData.totalSales - (documentData.totalExcludingTax || 0),
//                     irbmUniqueNo: documentData.uuid,
//                     irbmlongId: documentData.longId
//                 }
//             });
//         }

//         // If document field exists, parse it and extract detailed info
//         try {
//             let parsedDocument;
//             const doc = documentData.document;

//             // Helper to locate Invoice in parsed result (handles namespaces, explicitRoot, wrappers)
//             function findInvoice(parsed) {
//                 if (!parsed || typeof parsed !== 'object') return null;
//                 // explicitRoot or 'root' wrapper
//                 if (parsed.root && typeof parsed.root === 'object') return findInvoice(parsed.root);
//                 // Direct Invoice key (with or without namespace prefix)
//                 for (const k of Object.keys(parsed)) {
//                     const local = (k && k.includes(':')) ? k.split(':').pop() : k;
//                     if (local === 'Invoice') {
//                         const v = parsed[k];
//                         return (Array.isArray(v) && v.length) ? v[0] : (v && typeof v === 'object' ? v : null);
//                     }
//                 }
//                 // Single wrapper element, e.g. { Document: [{ Invoice: [...] }] }
//                 const keys = Object.keys(parsed);
//                 if (keys.length === 1) {
//                     const v = parsed[keys[0]];
//                     const child = (Array.isArray(v) && v.length) ? v[0] : v;
//                     if (child && typeof child === 'object') return findInvoice(child);
//                 }
//                 return null;
//             }

//             async function parseDoc(input) {
//                 if (typeof input === 'string' && input.trim().startsWith('<')) {
//                     return parseStringPromise(input, {
//                         explicitArray: true,
//                         tagNameProcessors: [processors.stripPrefix]
//                     });
//                 }
//                 if (typeof input === 'string') return JSON.parse(input);
//                 return input;
//             }

//             if (doc != null && typeof doc === 'object') {
//                 const xmlStr = doc.content || doc.document || doc.value || doc.data;
//                 if (typeof xmlStr === 'string' && xmlStr.trim().startsWith('<')) {
//                     parsedDocument = await parseDoc(xmlStr);
//                 } else {
//                     parsedDocument = doc;
//                 }
//             } else if (typeof doc === 'string') {
//                 parsedDocument = await parseDoc(doc);
//             } else {
//                 throw new Error('Invalid document format: document is not a string or object');
//             }

//             const validationResults = detailsData.validationResults;
//             const invoice = findInvoice(parsedDocument);
//             if (!invoice) {
//                 const keys = (parsedDocument && typeof parsedDocument === 'object') ? Object.keys(parsedDocument).join(', ') : 'n/a';
//                 throw new Error(`Invoice element not found in parsed document. Top-level keys: ${keys}`);
//             }
//             const supplierParty = invoice.AccountingSupplierParty[0].Party[0];
//             const customerParty = invoice.AccountingCustomerParty[0].Party[0];

//             // Get identification info for both parties
//             const supplierIdentification = getPartyIdentification(supplierParty.PartyIdentification);
//             const customerIdentification = getPartyIdentification(customerParty.PartyIdentification);

//             // Backfill WP_Inbound_Status.documentCurrency when null (same source as PDF: UBL DocumentCurrencyCode)
//             const docCurrency = getDocCurrencyFromInvoice(invoice) || detailsData.documentCurrencyCode || detailsData.documentCurrency || null;
//             persistDocumentCurrencyIfNull(uuid, docCurrency);

//             return res.json({
//                 success: true,
//                 documentInfo: {
//                     uuid: documentData.uuid,
//                     submissionUid: documentData.submissionUid,
//                     longId: detailsData.longId,
//                     irbmlongId: documentData.longId,
//                     internalId: documentData.internalId,
//                     status: documentData.status,
//                     documentCurrency: docCurrency,
//                     validationResults: validationResults,
//                     supplierName: documentData.issuerName,
//                     supplierTIN: supplierIdentification.tin,
//                     supplierRegistrationNo: supplierIdentification.registrationNo,
//                     supplierSstNo: supplierIdentification.taxRegNo,
//                     supplierMsicCode: supplierParty.IndustryClassificationCode?.[0]._ || documentData.supplierMsicCode,
//                     supplierAddress: supplierParty.PostalAddress[0].AddressLine
//                         .map(line => line.Line[0]._)
//                         .filter(Boolean)
//                         .join(', ') || documentData.supplierAddress,
//                     receiverName: documentData.receiverName,
//                     receiverTIN: customerIdentification.tin,
//                     receiverRegistrationNo: customerIdentification.registrationNo,
//                     receiverSstNo: customerIdentification.taxRegNo,
//                     receiverAddress: customerParty.PostalAddress[0].AddressLine
//                         .map(line => line.Line[0]._)
//                         .filter(Boolean)
//                         .join(', ') || documentData.receiverAddress
//                 },
//                 supplierInfo: {
//                     company: supplierParty.PartyLegalEntity[0].RegistrationName[0]._ || documentData.supplierName,
//                     tin: supplierIdentification.tin,
//                     registrationNo: supplierIdentification.registrationNo,
//                     taxRegNo: supplierIdentification.taxRegNo,
//                     idType: supplierIdentification.idType,
//                     idNumber: supplierIdentification.idNumber,
//                     msicCode: supplierParty.IndustryClassificationCode?.[0]._ || documentData.supplierMsicCode,
//                     address: supplierParty.PostalAddress[0].AddressLine
//                         .map(line => line.Line[0]._)
//                         .filter(Boolean)
//                         .join(', ') || documentData.supplierAddress
//                 },
//                 customerInfo: {
//                     company: customerParty.PartyLegalEntity[0].RegistrationName[0]._ || documentData.receiverName,
//                     tin: customerIdentification.tin,
//                     registrationNo: customerIdentification.registrationNo,
//                     taxRegNo: customerIdentification.taxRegNo,
//                     idType: customerIdentification.idType,
//                     idNumber: customerIdentification.idNumber,
//                     address: customerParty.PostalAddress[0].AddressLine
//                         .map(line => line.Line[0]._)
//                         .filter(Boolean)
//                         .join(', ') || documentData.receiverAddress
//                 },
//                 paymentInfo: {
//                     totalIncludingTax: invoice.LegalMonetaryTotal?.[0]?.TaxInclusiveAmount?.[0]._ || documentData.totalSales,
//                     totalExcludingTax: invoice.LegalMonetaryTotal?.[0]?.TaxExclusiveAmount?.[0]._ || documentData.totalExcludingTax,
//                     taxAmount: invoice.TaxTotal?.[0]?.TaxAmount?.[0]._ || (documentData.totalSales - (documentData.totalExcludingTax || 0)),
//                     irbmUniqueNo: documentData.uuid,
//                     irbmlongId: documentData.longId
//                 }
//             });
//         } catch (parseError) {
//             console.error('Error parsing document:', parseError);
//             // Handle parse error by returning basic info
//             return res.status(500).json({
//                 success: false,
//                 message: 'Failed to parse document data',
//                 error: {
//                     name: parseError.name,
//                     details: parseError.message
//                 }
//             });
//         }

//     } catch (error) {
//         console.error('Error fetching document details:', error);
//         return res.status(500).json({
//             success: false,
//             message: error.message || 'Failed to fetch document details',
//             error: {
//                 name: error.name,
//                 details: error.response?.data || error.stack
//             }
//         });
//     }
// });



// // Helper function to get template data
// async function getTemplateData(uuid, accessToken, user) {
//     // Get LHDN configuration
//     const lhdnConfig = await getLHDNConfig();

//     // Get raw document data
//     const response = await axios.get(`${lhdnConfig.baseUrl}/api/v1.0/documents/${uuid}/raw`, {
//         headers: {
//             'Authorization': `Bearer ${accessToken}`,
//             'Content-Type': 'application/json'
//         }
//     });

//     // Get company data using Prisma
//     const company = await prisma.wP_COMPANY_SETTINGS.findFirst({
//         where: { TIN: user.TIN }
//     });

//     // Handle company logo
//     const logoPath = company?.CompanyImage
//         ? path.join(__dirname, '../../public', company.CompanyImage)
//         : null;

//     let logoBase64;
//     try {
//         const logoBuffer = await fsPromises.readFile(logoPath);
//         const logoExt = path.extname(logoPath).substring(1);
//         logoBase64 = `data:image/${logoExt};base64,${logoBuffer.toString('base64')}`;
//     } catch (error) {
//         logoBase64 = null;
//     }

//     // Parse document data
//     const rawData = response.data;
//     const documentData = JSON.parse(rawData.document);
//     const invoice = documentData.Invoice[0];

//     const supplierParty = invoice.AccountingSupplierParty[0].Party[0];
//     const customerParty = invoice.AccountingCustomerParty[0].Party[0];

//    // Generate QR code
//    console.log('Generating QR code...');
//    const longId = rawData.longId || rawData.longID;
//    const lhdnUuid = rawData.uuid;
//    const portalUrl = getPortalUrl(lhdnConfig.environment);
//    const qrCodeUrl = `https://${portalUrl}/${lhdnUuid}/share/${longId}`;
//    console.log('QR Code URL:', qrCodeUrl);

//    const qrCodeDataUrl = await QRCode.toDataURL(qrCodeUrl, {
//        width: 200,
//        margin: 2,
//        color: { dark: '#000000', light: '#ffffff' }
//    });
//    console.log('✓ QR code generated successfully');


//     // Get tax information from UBL structure
//     const taxTotal = invoice.TaxTotal?.[0];
//     const taxSubtotal = taxTotal?.TaxSubtotal?.[0];
//     const taxCategory = taxSubtotal?.TaxCategory?.[0];
//     const totalTaxAmount = taxTotal?.TaxAmount?.[0]._ || 0;
//     const taxExempReason = taxCategory?.TaxExemptionReason?.[0]._ || 'Not Applicable';

//     // Map the tax type according to SDK documentation
//     const getTaxTypeDescription = (code) => {
//         const taxTypes = {
//             '01': 'Sales Tax',
//             '02': 'Service Tax',
//             '03': 'Tourism Tax',
//             '04': 'High-Value Goods Tax',
//             '05': 'Sales Tax on Low Value Goods',
//             '06': 'Not Applicable',
//             'E': 'Tax exemption'
//         };
//         return taxTypes[code] || code;
//     };

//     const idTypes = ['TIN', 'BRN', 'NRIC', 'Passport', 'Army', 'SST', 'TTX'];
//     function getIdTypeAndNumber(partyIdentification) {
//         const tinInfo = partyIdentification?.find(id => id.ID[0].schemeID === 'TIN');
//         if (!tinInfo) {
//             throw new Error('TIN is mandatory and not found.');
//         }

//         for (const idType of idTypes) {
//             if (idType === 'TIN') continue;
//             const idInfo = partyIdentification?.find(id => id.ID[0].schemeID === idType);
//             if (idInfo) {
//                 return { type: idType, number: idInfo.ID[0]._ };
//             }
//         }
//         return { type: 'NA', number: 'NA' };
//     }

//     const supplierIdInfo = getIdTypeAndNumber(supplierParty.PartyIdentification, idTypes);
//     const customerIdInfo = getIdTypeAndNumber(customerParty.PartyIdentification, idTypes);

//     // Helper function to get label based on description for AdditionalDocumentReference
//     const getReferenceLabel = (description) => {
//         if (!description || description === 'Not Applicable' || description === 'NA' || description === '') {
//             return 'Additional Document Reference';
//         }
//         const descUpper = description.toUpperCase();
//         if (descUpper.includes('EXEMP')) {
//             return 'Exemption Cert. No.';
//         } else if (descUpper.includes('PO') || descUpper.includes('PURCHASE')) {
//             return 'Cust. P/O No.';
//         } else if (descUpper.includes('DO') || descUpper.includes('DELIVERY')) {
//             return 'Cust. D/O No.';
//         } else if (descUpper.includes('INVOICE')) {
//             return 'Invoice Reference No.';
//         } else if (descUpper.includes('QUOTE') || descUpper.includes('QUOTATION')) {
//             return 'Quotation Reference No.';
//         } else if (descUpper.includes('CONTRACT')) {
//             return 'Contract Reference No.';
//         } else {
//             // Use description as label if no match
//             return description;
//         }
//     };

//     // Process tax information for each line item
//     const taxSummary = {};
//     const items = await Promise.all(invoice.InvoiceLine?.map(async (line, index) => {
//         const lineAmount = parseFloat(line.LineExtensionAmount?.[0]._ || 0);
//         const lineTax = parseFloat(line.TaxTotal?.[0]?.TaxAmount?.[0]._ || 0);
//         const quantity = parseFloat(line.InvoicedQuantity?.[0]._ || 0);
//         const unitPrice = parseFloat(line.Price?.[0]?.PriceAmount?.[0]._ || 0);
//         const discount = parseFloat(line.AllowanceCharge?.[0]?.Amount?.[0]._ || 0);
//         const unitCode = line.InvoicedQuantity?.[0]?.unitCode || 'XNA';
//         const taxlineCurrency = line.TaxTotal?.[0]?.TaxAmount?.[0]?.currencyID || 'MYR';
//         const allowanceCharges = parseFloat(line.AllowanceCharge?.[0]?.Amount?.[0]._ || 0);

//         // Get unit type name
//         const unitType = await getUnitType(unitCode);

//         // Extract tax information for this line
//         const lineTaxCategory = line.TaxTotal?.[0]?.TaxSubtotal?.[0]?.TaxCategory?.[0];
//         const taxTypeCode = lineTaxCategory?.ID?.[0]._ || '06';
//         const taxPercent = parseFloat(lineTaxCategory?.Percent?.[0]._ || 0);

//          // Calculate hypothetical tax for exempt items (always 0.00)
//          let hypotheticalTax = '0.00';
//          let isExempt = taxTypeCode === 'E';

//          // Add to tax summary
//          const taxKey = `${taxTypeCode}_${taxPercent}`;
//          if (!taxSummary[taxKey]) {
//              taxSummary[taxKey] = {
//                  taxType: taxTypeCode,
//                  taxRate: taxPercent,
//                  baseAmount: 0,
//                  taxAmount: 0,
//                  hypotheticalTaxAmount: 0
//              };
//          }
//          taxSummary[taxKey].baseAmount += lineAmount;
//          taxSummary[taxKey].taxAmount += lineTax;
//          taxSummary[taxKey].hypotheticalTaxAmount += 0; // Always 0


//         // Format quantity with exactly 2 decimal places
//         const formattedQuantity = quantity.toLocaleString('en-MY', {
//             minimumFractionDigits: 2,
//             maximumFractionDigits: 2,
//             useGrouping: false
//         });

//         // Format unit price with exactly 4 decimal places
//         const formattedUnitPrice = unitPrice.toLocaleString('en-MY', {
//             minimumFractionDigits: 4,
//             maximumFractionDigits: 4,
//             useGrouping: false
//         });

//         return {
//             No: index + 1,
//             Cls: line.Item?.[0]?.CommodityClassification?.[0]?.ItemClassificationCode?.[0]._ || 'NA',
//             Description: line.Item?.[0]?.Description?.[0]._ || 'NA',
//             Quantity: formattedQuantity,
//             UOM: unitType, // Display unit type name instead of code
//             UnitPrice: formattedUnitPrice,
//             QtyAmount: lineAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
//             Disc: discount === 0 ? '0.00' : discount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
//             Charges: allowanceCharges.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00',
//             LineTaxPercent: taxPercent.toFixed(2),
//             LineTaxAmount: lineTax.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
//             HypotheticalTax: hypotheticalTax,  // Add hypothetical tax to line items
//             Total: (parseFloat(line.ItemPriceExtension?.[0]?.Amount?.[0]._ || 0) + lineTax).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
//             TaxType: getTaxTypeDescription(taxTypeCode)
//         };
//     }) || []);

//     const currentInvoiceType = invoice.InvoiceTypeCode?.[0]._ || 'NA';
//     const einvoiceType = await getInvoiceTypes(currentInvoiceType);

//     const taxSummaryArray = Object.values(taxSummary).map(summary => ({
//         baseAmount: parseFloat(summary.baseAmount).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
//         taxType: getTaxTypeDescription(summary.taxType),
//         taxRate: parseFloat(summary.taxRate).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
//         taxAmount: parseFloat(summary.taxAmount).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
//         LHDNtaxExemptionReason: taxExempReason || 'Not Applicable',
//         hypotheticalTaxAmount: summary.taxType === 'E' ?
//         parseFloat(summary.hypotheticalTaxAmount).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) :
//         '0.00'
//     }));

//     // Sort the taxSummaryArray based on the desired order
//     const taxTypeOrder = ['Service Tax', 'Sales Tax', 'Tourism Tax', 'High-Value Goods Tax', 'Sales Tax on Low Value Goods', 'Not Applicable', 'Tax exemption', 'Other'];
//     taxSummaryArray.sort((a, b) => taxTypeOrder.indexOf(a.taxType) - taxTypeOrder.indexOf(b.taxType));



//     const templateData = {
//         CompanyLogo: logoBase64,
//         companyName: supplierParty.PartyLegalEntity?.[0]?.RegistrationName?.[0]._ || 'NA',
//         companyAddress: supplierParty.PostalAddress?.[0]?.AddressLine?.map(line => line.Line[0]._).join(', ') || 'NA',
//         companyPhone: supplierParty.Contact?.[0]?.Telephone?.[0]._ || 'NA',
//         companyEmail: supplierParty.Contact?.[0]?.ElectronicMail?.[0]._ || 'NA',

//         internalId: rawData.internalId || 'NA',

//         InvoiceTypeCode: einvoiceType,
//         InvoiceTypeName: rawData.typeName || 'NA',
//         InvoiceVersion: rawData.typeVersionName || 'NA',
//         InvoiceCode: invoice.ID?.[0]._ || rawData.internalId || 'NA',
//         UniqueIdentifier: rawData.uuid || 'NA',
//         lhdnLink: qrCodeUrl,

//         dateTimeReceived: new Date(invoice.IssueDate[0]._ + 'T' + invoice.IssueTime[0]._).toLocaleString(),
//         documentCurrency: invoice.DocumentCurrencyCode?.[0]._ || 'MYR',
//         taxCurrency: invoice.TaxCurrencyCode?.[0]._ || 'MYR',
//         TaxExchangeRate: invoice.TaxExchangeRate?.[0]?.CalculationRate?.[0]._ || '----',
//         issueDate: invoice.IssueDate?.[0]._ || 'NA',
//         issueTime: invoice.IssueTime?.[0]._ || 'NA',


//         OriginalInvoiceRef: invoice.BillingReference?.[0]?.InvoiceDocumentReference?.[0]?.ID?.[0]._ || 'Not Applicable',
//         OriginalInvoiceDateTime: invoice.IssueDate?.[0]._ ? new Date(invoice.IssueDate[0]._ + 'T' + invoice.IssueTime[0]._).toLocaleString() : 'Not Applicable',
//         OriginalInvoiceStartDate: invoice.InvoicePeriod?.[0]?.StartDate?.[0]._ || '-- / -- / --',
//         OriginalInvoiceEndDate: invoice.InvoicePeriod?.[0]?.EndDate?.[0]._ || '-- / -- / --',
//         OriginalInvoiceDescription: invoice.InvoicePeriod?.[0]?.Description?.[0]._ || '',

//         // Extract AdditionalDocumentReference entries from LHDN API response
//         // Always show all three fields: Exemption Cert. No., Cust. P/O No., Cust. D/O No.
//         additionalDocumentReferences: (() => {
//             // Initialize the three required fields
//             const refsMap = {
//                 'Exemption Cert. No.': null,
//                 'Cust. P/O No.': null,
//                 'Cust. D/O No.': null
//             };

//             // Process all AdditionalDocumentReference entries from API
//             (invoice.AdditionalDocumentReference || []).forEach(ref => {
//                 const id = ref.ID?.[0]?._ || '';
//                 const documentType = ref.DocumentType?.[0]?._ || '';
//                 const documentDescription = ref.DocumentDescription?.[0]?._ || '';
                
//                 // Only process if ID is valid and not "NA"
//                 if (id && id !== 'Not Applicable' && id !== 'NA' && id !== '') {
//                     const descUpper = (documentDescription || '').toUpperCase();
                    
//                     // Categorize based on description (case-insensitive matching)
//                     if (descUpper.includes('EXEMP')) {
//                         // Exemption Cert - only set if not already set
//                         if (!refsMap['Exemption Cert. No.']) {
//                             refsMap['Exemption Cert. No.'] = id;
//                         }
//                     } else if (descUpper.includes('PO') || descUpper.includes('PURCHASE')) {
//                         // Purchase Order - only set if not already set
//                         if (!refsMap['Cust. P/O No.']) {
//                             refsMap['Cust. P/O No.'] = id;
//                         }
//                     } else if (descUpper.includes('DO') || descUpper.includes('DELIVERY')) {
//                         // Delivery Order - only set if not already set
//                         if (!refsMap['Cust. D/O No.']) {
//                             refsMap['Cust. D/O No.'] = id;
//                         }
//                     }
//                     // Ignore other types to prevent duplicates
//                 }
//             });

//             // Always return all three fields in order, with "Not Applicable" if empty
//             return [
//                 {
//                     label: 'Exemption Cert. No.',
//                     id: refsMap['Exemption Cert. No.'] || 'Not Applicable'
//                 },
//                 {
//                     label: 'Cust. P/O No.',
//                     id: refsMap['Cust. P/O No.'] || 'Not Applicable'
//                 },
//                 {
//                     label: 'Cust. D/O No.',
//                     id: refsMap['Cust. D/O No.'] || 'Not Applicable'
//                 }
//             ];
//         })(),

//         SupplierTIN: supplierParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'TIN')?.ID[0]._ || 'NA',
//         SupplierRegistrationNumber: supplierParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'BRN')?.ID[0]._ || 'NA',
//         SupplierSSTID: supplierParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'SST')?.ID[0]._ || 'NA',
//         SupplierMSICCode: supplierParty.IndustryClassificationCode?.[0]._ || '00000',
//         SupplierBusinessActivity: supplierParty.IndustryClassificationCode?.[0]?.name || 'NOT APPLICABLE',
//         SupplierIdType: supplierIdInfo.type,
//         SupplierIdNumber: supplierIdInfo.number,

//         BuyerTIN: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'TIN')?.ID[0]._ || 'NA',
//         BuyerName: customerParty.PartyLegalEntity?.[0]?.RegistrationName?.[0]._ || 'NA',
//         BuyerPhone: customerParty.Contact?.[0]?.Telephone?.[0]._ || 'NA',
//         BuyerEmail: customerParty.Contact?.[0]?.ElectronicMail?.[0]._ || 'NA',
//         BuyerRegistrationNumber: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'BRN')?.ID[0]._ || 'NA',
//         BuyerAddress: customerParty.PostalAddress?.[0]?.AddressLine?.map(line => line.Line[0]._).join(', ') || 'NA',
//         BuyerSSTID: customerParty.PartyIdentification?.find(id => id.ID[0].schemeID === 'SST')?.ID[0]._ || 'NA',
//         BuyerMSICCode: customerParty.IndustryClassificationCode?.[0]._ || '00000',
//         BuyerBusinessActivity: customerParty.IndustryClassificationCode?.[0]?.name || 'NOT APPLICABLE',
//         BuyerIdType: customerIdInfo.type,
//         BuyerIdNumber: customerIdInfo.number,

//         Prepayment: parseFloat(invoice.LegalMonetaryTotal?.[0]?.PrepaidAmount?.[0]._ || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
//         TotalNetAmount: parseFloat(rawData.totalNetAmount).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00',
//         Subtotal: parseFloat(invoice.LegalMonetaryTotal?.[0]?.LineExtensionAmount?.[0]._ || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
//         TotalExcludingTax: parseFloat(invoice.LegalMonetaryTotal?.[0]?.TaxExclusiveAmount?.[0]._ || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
//         TotalIncludingTax: parseFloat(invoice.LegalMonetaryTotal?.[0]?.TaxInclusiveAmount?.[0]._ || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
//         TotalPayableAmount: parseFloat(invoice.LegalMonetaryTotal?.[0]?.PayableAmount?.[0]._ || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
//         TotalTaxAmount: Object.values(taxSummary).reduce((sum, item) => sum + item.taxAmount, 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),

//         TaxRate: Object.values(taxSummary).reduce((sum, item) => sum + item.taxRate, 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
//         TaxAmount: Object.values(taxSummary).reduce((sum, item) => sum + item.taxAmount, 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),

//         items: items,

//         TaxType: taxCategory?.ID?.[0]._ || '06',
//         TaxSchemeId: getTaxTypeDescription(taxCategory?.ID?.[0]._ || '06'),

//         // taxSummary: taxSummaryArray.map(item => ({
//         //     taxType: item.taxType,
//         //     taxRate: item.taxRate,
//         //     totalAmount: item.baseAmount || '0.00',
//         //     totalTaxAmount: item.taxAmount || '0.00'
//         // })),

//          taxSummary: taxSummaryArray.map(item => ({
//             taxType: item.taxType,
//             taxRate: item.taxRate,
//             totalAmount: item.baseAmount || '0.00',
//             totalTaxAmount: item.taxAmount || '0.00',
//             hypotheticalTaxAmount: item.hypotheticalTaxAmount || '0.00',
//             LHDNtaxExemptionReason: taxExempReason || 'Not Applicable',
//         })),


//         companyName: supplierParty.PartyLegalEntity?.[0]?.RegistrationName?.[0]._ || 'NNot ApplicableA',
//         companyAddress: supplierParty.PostalAddress?.[0]?.AddressLine?.map(line => line.Line[0]._).join(', ') || 'Not Applicable',
//         companyPhone: supplierParty.Contact?.[0]?.Telephone?.[0]._ || 'Not Applicable',
//         companyEmail: supplierParty.Contact?.[0]?.ElectronicMail?.[0]._ || 'Not Applicable',

//         InvoiceVersionCode: invoice.InvoiceTypeCode?.[0].listVersionID || 'Not Applicable',
//         InvoiceVersion: rawData.typeVersionName || 'NA',
//         InvoiceCode: invoice.ID?.[0]._ || rawData.internalId || 'Not Applicable',
//         UniqueIdentifier: rawData.uuid || 'Not Applicable',
//         LHDNlongId: longId || 'Not Applicable',

//         dateTimeReceived: new Date(invoice.IssueDate[0]._ + 'T' + invoice.IssueTime[0]._).toLocaleDateString('en-GB'),
//         issueDate: invoice.IssueDate?.[0]._ ? new Date(invoice.IssueDate[0]._).toLocaleDateString('en-GB') : 'Not Applicable',
//         issueTime: invoice.IssueTime?.[0]._ || 'Not Applicable',

//         startPeriodDate: invoice.InvoicePeriod?.[0]?.StartDate?.[0]._ || 'Not Applicable',
//         endPeriodDate: invoice.InvoicePeriod?.[0]?.EndDate?.[0]._ || 'Not Applicable',
//         dateDescription: invoice.InvoicePeriod?.[0]?.Description?.[0]._ || 'Not Applicable',

//         qrCode: qrCodeDataUrl,
//         QRLink: qrCodeUrl,
//         DigitalSignature: rawData.digitalSignature || '-',
//         validationDateTime: new Date(rawData.dateTimeValidated).toLocaleString(),
//     };

//     // Backfill WP_Inbound_Status.documentCurrency when null (same source as PDF: UBL DocumentCurrencyCode)
//     const docCurrency = getDocCurrencyFromInvoice(invoice);
//     persistDocumentCurrencyIfNull(uuid, docCurrency);

//    return templateData;
// }

// //route to check if PDF exists
// router.get('/documents/:uuid/check-pdf', async (req, res) => {
//     const { uuid } = req.params; // longId is not used
//     const requestId = req.requestId;

//     try {
//         console.log(`[${requestId}] Checking PDF existence for ${uuid}`);
//         const tempDir = path.join(__dirname, '../../public/temp');
//         const pdfPath = path.join(tempDir, `${uuid}.pdf`);
//         const hashPath = path.join(tempDir, `${uuid}.hash`);

//         console.log(`[${requestId}] Paths:`, {
//             pdfPath,
//             hashPath
//         });

//         try {
//             await fsPromises.access(pdfPath);
//             console.log(`[${requestId}] PDF exists at ${pdfPath}`);
//             return res.json({
//                 exists: true,
//                 url: `/temp/${uuid}.pdf`
//             });
//         } catch (error) {
//             console.log(`[${requestId}] PDF not found at ${pdfPath}`);
//             return res.json({ exists: false });
//         }
//     } catch (error) {
//         console.error(`[${requestId}] Error checking PDF:`, error);
//         return res.status(500).json({
//             success: false,
//             message: 'Failed to check PDF existence',
//             error: error.message
//         });
//     }
// });

// // Update PDF generation route
// router.post('/documents/:uuid/pdf', async (req, res) => {
//     const { uuid } = req.params;
//     const requestId = req.requestId;

//     try {
//         console.log(`[${requestId}] Starting PDF Generation Process for ${uuid}`);

//         const tempDir = path.join(__dirname, '../../public/temp');
//         const pdfPath = path.join(tempDir, `${uuid}.pdf`);
//         const hashPath = path.join(tempDir, `${uuid}.hash`);

//         console.log(`[${requestId}] Paths:`, {
//             tempDir,
//             pdfPath,
//             hashPath
//         });

//         // Check directory exists
//         try {
//             await fsPromises.access(tempDir);
//             console.log(`[${requestId}] Temp directory exists`);
//         } catch {
//             console.log(`[${requestId}] Creating temp directory`);
//             await fsPromises.mkdir(tempDir, { recursive: true });
//         }

//         // Auth check
//         if (!req.session?.user) {
//             console.log(`[${requestId}] No user session found`);
//             return res.status(401).json({
//                 success: false,
//                 message: 'User not authenticated'
//             });
//         }

//         console.log(`[${requestId}] User authenticated:`, {
//             id: req.session.user.id,
//             TIN: req.session.user.TIN
//         });

//         const forceRegenerate = req.query.force === 'true';
//         console.log(`[${requestId}] Force regenerate:`, forceRegenerate);

//         // Get template data
//         console.log(`[${requestId}] Fetching template data...`);
//         const templateData = await getTemplateData(uuid, req.session.accessToken, req.session.user);
//         console.log(`[${requestId}] Template data fetched successfully`);

//         // Check if regeneration needed
//         if (!forceRegenerate) {
//             try {
//                 const storedHash = await fsPromises.readFile(hashPath, 'utf8');
//                 const currentHash = generateTemplateHash(templateData);

//                 console.log(`[${requestId}] Hash comparison:`, {
//                     stored: storedHash.substring(0, 8),
//                     current: currentHash.substring(0, 8),
//                     matches: storedHash === currentHash
//                 });

//                 if (storedHash === currentHash) {
//                     console.log(`[${requestId}] Using cached PDF`);
//                     return res.json({
//                         success: true,
//                         url: `/temp/${uuid}.pdf`,
//                         cached: true,
//                         message: 'Loading existing PDF from cache...'
//                     });
//                 }
//             } catch (error) {
//                 console.log(`[${requestId}] Cache check failed:`, error.message);
//             }
//         }

//         // Generate new PDF
//         console.log(`[${requestId}] Generating new PDF...`);
//         const newHash = generateTemplateHash(templateData);

//         const templatePath = path.join(__dirname, '../../src/reports/original-invoice-template.html');
//         console.log(`[${requestId}] Using template:`, templatePath);

//         const templateContent = await fsPromises.readFile(templatePath, 'utf8');
//         const template = jsrender.templates(templateContent);
//         const html = template.render(templateData);

//         console.log(`[${requestId}] Launching browser...`);
//         const browser = await puppeteer.launch({
//             headless: 'new',
//             args: ['--no-sandbox', '--disable-setuid-sandbox']
//         });

//         const page = await browser.newPage();
//         await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });

//         console.log(`[${requestId}] Setting page content...`);
//         await page.setContent(html, { waitUntil: 'networkidle0' });

//         console.log(`[${requestId}] Generating PDF...`);
//         const pdfBuffer = await page.pdf({
//             format: 'A4',
//             printBackground: true,
//             margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' }
//         });

//         await browser.close();
//         console.log(`[${requestId}] Browser closed`);

//         // Save files
//         console.log(`[${requestId}] Saving PDF and hash...`);
//         await fsPromises.writeFile(pdfPath, pdfBuffer);
//         await fsPromises.writeFile(hashPath, newHash);

//         console.log(`[${requestId}] PDF generated successfully:`, {
//             path: pdfPath,
//             hash: newHash.substring(0, 8),
//             size: pdfBuffer.length
//         });

//         return res.json({
//             success: true,
//             url: `/temp/${uuid}.pdf`,
//             cached: false,
//             message: 'New PDF generated successfully'
//         });

//     } catch (error) {
//         console.error(`[${requestId}] PDF Generation Error:`, {
//             message: error.message,
//             stack: error.stack,
//             name: error.name
//         });

//         if (error.response?.status === 429) {
//             return res.status(429).json({
//                 success: false,
//                 message: 'Server is busy. Please try again later.',
//                 retryAfter: error.response.headers['retry-after'] || 30
//             });
//         }

//         return res.status(500).json({
//             success: false,
//             message: `Failed to generate PDF: ${error.message}`,
//             details: error.stack
//         });
//     }
// });

// // TIN Validation route
// router.get('/taxpayer/validate/:tin', limiter, async (req, res) => {
//     const { tin } = req.params;
//     const { idType, idValue } = req.query;
//     const requestId = req.requestId || req.headers['x-request-id'] || Math.random().toString(36).substring(2, 15);

//     console.log(`[${requestId}] TIN Validation Request:`, {
//         tin,
//         idType,
//         idValue
//     });

//     try {
//         // Input validation
//         if (!tin || !idType || !idValue) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Missing required parameters',
//                 error: {
//                     code: 'BAD_ARGUMENT',
//                     details: {
//                         tin: !tin ? 'TIN is required' : null,
//                         idType: !idType ? 'ID Type is required' : null,
//                         idValue: !idValue ? 'ID Value is required' : null
//                     }
//                 }
//             });
//         }

//         // Validate ID Type
//         const validIdTypes = ['NRIC', 'PASSPORT', 'BRN', 'ARMY'];
//         if (!validIdTypes.includes(idType.toUpperCase())) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Invalid ID Type',
//                 error: {
//                     code: 'BAD_ARGUMENT',
//                     details: {
//                         idType: `ID Type must be one of: ${validIdTypes.join(', ')}`
//                     }
//                 }
//             });
//         }

//         // Get LHDN configuration
//         const lhdnConfig = await getLHDNConfig();

//         // Check cache first
//         const cacheKey = `tin_validation_${tin}_${idType}_${idValue}`;
//         const cachedResult = cache.get(cacheKey);

//         if (cachedResult) {
//             console.log(`[${requestId}] Returning cached validation result for TIN: ${tin}`);
//             return res.json({
//                 success: true,
//                 result: cachedResult,
//                 cached: true
//             });
//         }

//         // Prepare standard LHDN API headers according to SDK specification
//         const headers = {
//             'Authorization': `Bearer ${req.session.accessToken}`,
//             'Accept': 'application/json',
//             'Content-Type': 'application/json',
//             'X-Request-ID': requestId,
//             'X-Date': req.headers['x-date'] || new Date().toISOString(),
//             'X-Client-ID': req.headers['x-client-id'] || 'eInvoice-WebApp',
//             'X-Forwarded-For': req.headers['x-forwarded-for'] || req.ip,
//             'X-User-Agent': req.headers['x-user-agent'] || req.headers['user-agent'],
//             'X-Channel': req.headers['x-channel'] || 'Web'
//         };

//         // Add User session related headers if available
//         if (req.session?.user) {
//             headers['X-User-ID'] = req.session.user.id;
//             headers['X-User-TIN'] = req.session.user.TIN;
//             headers['X-User-Name'] = req.session.user.username;
//         }

//         // Make API call to LHDN
//         console.log(`[${requestId}] Calling LHDN API for TIN validation with standard headers...`);
//         await axios.get( // Response is not used directly
//             `${lhdnConfig.baseUrl}/api/v1.0/taxpayer/validate/${tin}`,
//             {
//                 params: {
//                     idType: idType.toUpperCase(),
//                     idValue: idValue
//                 },
//                 headers: headers,
//                 timeout: lhdnConfig.timeout
//             }
//         );

//         // Log successful validation
//         await LoggingService.log({
//             description: `TIN Validation successful for ${tin}`,
//             username: req?.session?.user?.username || 'System',
//             userId: req?.session?.user?.id,
//             ipAddress: req?.ip,
//             logType: LOG_TYPES.INFO,
//             module: MODULES.API,
//             action: ACTIONS.VALIDATE,
//             status: STATUS.SUCCESS,
//             details: { tin, idType, idValue, requestId }
//         });

//         // Cache the successful result
//         const validationResult = {
//             isValid: true,
//             tin: tin,
//             idType: idType,
//             idValue: idValue,
//             timestamp: new Date().toISOString(),
//             requestId: requestId
//         };
//         cache.set(cacheKey, validationResult, 300); // Cache for 5 minutes

//         return res.json({
//             success: true,
//             result: validationResult,
//             cached: false
//         });

//     } catch (error) {
//         console.error(`[${requestId}] TIN Validation Error:`, error);

//         // Log validation error
//         await LoggingService.log({
//             description: `TIN Validation failed for ${tin}: ${error.message}`,
//             username: req?.session?.user?.username || 'System',
//             userId: req?.session?.user?.id,
//             ipAddress: req?.ip,
//             logType: LOG_TYPES.ERROR,
//             module: MODULES.API,
//             action: ACTIONS.VALIDATE,
//             status: STATUS.FAILED,
//             details: { tin, idType, idValue, error: error.message, requestId }
//         });

//         // Handle specific error cases
//         if (error.response?.status === 404) {
//             return res.status(404).json({
//                 success: false,
//                 message: 'Invalid TIN or ID combination',
//                 error: {
//                     code: 'NOT_FOUND',
//                     details: 'The provided TIN and ID combination cannot be found or is invalid',
//                     requestId: requestId
//                 }
//             });
//         }

//         if (error.response?.status === 400) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Invalid input parameters',
//                 error: {
//                     code: 'BAD_ARGUMENT',
//                     details: error.response.data?.message || 'The provided parameters are invalid',
//                     requestId: requestId
//                 }
//             });
//         }

//         if (error.response?.status === 429) {
//             return res.status(429).json({
//                 success: false,
//                 message: 'Rate limit exceeded',
//                 error: {
//                     code: 'RATE_LIMIT_EXCEEDED',
//                     details: 'Too many validation requests. Please try again later.',
//                     retryAfter: error.response.headers['retry-after'] || 60,
//                     requestId: requestId
//                 }
//             });
//         }

//         // Generic error response
//         return res.status(500).json({
//             success: false,
//             message: 'TIN validation failed',
//             error: {
//                 code: 'INTERNAL_SERVER_ERROR',
//                 details: error.message,
//                 requestId: requestId
//             }
//         });
//     }
// });

// // Refresh endpoint
// router.post('/documents/refresh', async (req, res) => {
//     console.log('LHDN documents refresh endpoint hit');
//     try {
//         if (!req.session?.user) {
//             console.log('No user session found');
//             return handleAuthError(req, res);
//         }

//         console.log('User from session:', req.session.user);

//         try {
//             // Get LHDN configuration
//             const lhdnConfig = await getLHDNConfig();

//             // Fetch documents with multiple pages
//             console.log('Fetching fresh data from LHDN API with pagination...');

//             // First, check for records with missing issuerName using Prisma
//             const docsWithMissingData = await prisma.wP_INBOUND_STATUS.findMany({
//                 where: {
//                     OR: [
//                         { issuerTin: null },
//                         { issuerTin: 'NULL' },
//                         { issuerTin: '' },
//                         { issuerName: null },
//                         { issuerName: 'NULL' },
//                         { issuerName: '' }
//                     ]
//                 },
//                 select: { uuid: true }
//             });

//             if (docsWithMissingData.length > 0) {
//                 console.log(`Found ${docsWithMissingData.length} documents with missing issuerName to update`);
//             }

//             // Create array to hold all documents
//             const allDocuments = [];
//             let pageNo = 1;
//             const pageSize = 100;
//             let hasMorePages = true;

//             // Fetch up to 5 pages (500 documents)
//             const maxPages = 5;

//             while (hasMorePages && pageNo <= maxPages) {
//                 try {
//                     console.log(`Fetching page ${pageNo} of LHDN documents...`);
//                     const response = await axios.get(
//                         `${lhdnConfig.baseUrl}/api/v1.0/documents/recent`,
//                         {
//                             params: {
//                                 pageNo: pageNo,
//                                 pageSize: pageSize,
//                                 sortBy: 'dateTimeValidated',
//                                 sortOrder: 'desc'
//                             },
//                             headers: {
//                                 'Authorization': `Bearer ${req.session.lhdn?.accessToken || req.session.accessToken}`,
//                                 'Accept': 'application/json',
//                                 'Content-Type': 'application/json'
//                             },
//                             timeout: lhdnConfig.timeout
//                         }
//                     );

//                     const pageDocuments = response.data.result || [];
//                     console.log(`Fetched ${pageDocuments.length} documents from page ${pageNo}`);

//                     // If we got fewer documents than pageSize, we've reached the end
//                     if (pageDocuments.length < pageSize) {
//                         hasMorePages = false;
//                     }

//                     // Process each document to ensure supplier/issuer mapping is correct
//                     const processedDocuments = pageDocuments.map(doc => {
//                         return {
//                             ...doc,
//                             // Important: Map supplierName to issuerName if issuerName is missing
//                             issuerName: doc.issuerName || doc.supplierName || null,
//                             issuerTin:  doc.issuerTIN || doc.issuerTin || doc.supplierTin || doc.supplierTIN ||  null,
//                             receiverName: doc.receiverName || doc.buyerName || null,
//                             receiverId: doc.receiverId || doc.buyerTin || doc.buyerTIN || null
//                         };
//                     });

//                     console.log("Current Process Documents:", processedDocuments);

//                     // Add to our collection
//                     allDocuments.push(...processedDocuments);

//                     // Move to next page
//                     pageNo++;

//                     // LHDN Get Recent Documents: 12 RPM; use 5s between pages to stay within limit
//                     await delay(5000);

//                 } catch (pageError) {
//                     console.error(`Error fetching page ${pageNo}:`, pageError.message);
//                     // Stop fetching more pages on error
//                     hasMorePages = false;
//                 }
//             }

//             console.log(`Total fetched: ${allDocuments.length} documents from ${pageNo-1} pages`);

//             const toSave = await filterPinnacleOnlyInbound(allDocuments, req);

//             // Save all fetched documents to database
//             if (toSave.length > 0) {
//                 await saveInboundStatus({ result: toSave }, req);
//             }

//             // Process documents with missing data separately if API fetch didn't update them
//             if (docsWithMissingData.length > 0) {
//                 console.log(`Fetching individual details for ${docsWithMissingData.length} documents with missing data...`);
//                 let updatedCount = 0;

//                 // Process in batches to avoid overwhelming the system
//                 const batchSize = 10;
//                 for (let i = 0; i < docsWithMissingData.length; i += batchSize) {
//                     const batch = docsWithMissingData.slice(i, i + batchSize);

//                     await Promise.all(batch.map(async (doc) => {
//                         try {
//                             // Fetch individual document details from API
//                             const apiEndpoint = `${lhdnConfig.baseUrl}/api/v1.0/documents/${doc.uuid}/details`;
//                             const apiResponse = await axios.get(apiEndpoint, {
//                                 headers: {
//                                     'Authorization': `Bearer ${req.session.lhdn?.accessToken || req.session.accessToken}`,
//                                     'Content-Type': 'application/json'
//                                 },
//                                 timeout: lhdnConfig.timeout
//                             });

//                             // Look for supplier/issuer name in the response
//                             const responseData = apiResponse.data;
//                             const supplierName = responseData.supplierName ||
//                                                 responseData.issuerName ||
//                                                 (responseData.document?.supplierName) ||
//                                                 (responseData.document?.issuerName);

//                             if (supplierName) {
//                                 // Update the database record using Prisma
//                                 await prisma.wP_INBOUND_STATUS.update({
//                                     where: { uuid: doc.uuid },
//                                     data: {
//                                         issuerName: supplierName,
//                                         last_sync_date: new Date()
//                                     }
//                                 });
//                                 updatedCount++;
//                                 console.log(`Updated issuerName to "${supplierName}" for UUID: ${doc.uuid}`);
//                             } else {
//                                 console.log(`Could not find supplierName in API response for UUID: ${doc.uuid}`);

//                                 // Try alternate endpoint as fallback
//                                 try {
//                                     const rawDocEndpoint = `${lhdnConfig.baseUrl}/api/v1.0/documents/${doc.uuid}/raw`;
//                                     const rawDocResponse = await axios.get(rawDocEndpoint, {
//                                         headers: {
//                                             'Authorization': `Bearer ${req.session.lhdn?.accessToken || req.session.accessToken}`,
//                                             'Content-Type': 'application/json'
//                                         },
//                                         timeout: lhdnConfig.timeout
//                                     });

//                                     // Parse raw document for supplier info
//                                     const rawData = rawDocResponse.data;
//                                     const parsedSupplierName = rawData.AccountingSupplierParty?.Party?.PartyLegalEntity?.RegistrationName?.value ||
//                                                                rawData.AccountingSupplierParty?.Party?.PartyName?.Name?.value;

//                                     if (parsedSupplierName) {
//                                         await prisma.wP_INBOUND_STATUS.update({
//                                             where: { uuid: doc.uuid },
//                                             data: {
//                                                 issuerName: parsedSupplierName,
//                                                 last_sync_date: new Date()
//                                             }
//                                         });
//                                         updatedCount++;
//                                         console.log(`Updated issuerName to "${parsedSupplierName}" from raw data for UUID: ${doc.uuid}`);
//                                     }
//                                 } catch (rawError) {
//                                     console.error(`Error fetching raw document for ${doc.uuid}:`, rawError.message);
//                                 }
//                             }
//                         } catch (detailError) {
//                             console.error(`Error fetching details for ${doc.uuid}:`, detailError.message);
//                         }

//                         // Small delay between requests
//                         await delay(200);
//                     }));
//                 }

//                 console.log(`Updated ${updatedCount} documents with missing issuerName`);
//             }

//             // Log successful refresh
//             await LoggingService.log({
//                 description: `Successfully refreshed ${allDocuments.length} documents from LHDN`,
//                 username: req.session.user.username,
//                 userId: req.session.user.id,
//                 ipAddress: req.ip,
//                 logType: LOG_TYPES.INFO,
//                 module: MODULES.API,
//                 action: ACTIONS.READ,
//                 status: STATUS.SUCCESS,
//                 details: { count: allDocuments.length }
//             });

//             // Return success response
//             res.json({
//                 success: true,
//                 message: 'Successfully refreshed data from LHDN',
//                 count: allDocuments.length,
//                 missingDataUpdated: docsWithMissingData.length > 0,
//                 timestamp: new Date().toISOString()
//             });

//         } catch (error) {
//             console.error('Error refreshing LHDN data:', error);

//             // Log error
//             await LoggingService.log({
//                 description: `Error refreshing LHDN data: ${error.message}`,
//                 username: req.session.user.username,
//                 userId: req.session.user.id,
//                 ipAddress: req.ip,
//                 logType: LOG_TYPES.ERROR,
//                 module: MODULES.API,
//                 action: ACTIONS.READ,
//                 status: STATUS.FAILED,
//                 details: { error: error.message }
//             });

//             // Handle specific error cases
//             if (error.response?.status === 429) {
//                 return res.status(429).json({
//                     success: false,
//                     error: {
//                         code: 'RATE_LIMIT_EXCEEDED',
//                         message: 'Rate limit exceeded. Please try again later.',
//                         retryAfter: error.response.headers['retry-after'] || 30
//                     }
//                 });
//             }

//             if (error.code === 'ECONNABORTED') {
//                 return res.status(504).json({
//                     success: false,
//                     error: {
//                         code: 'TIMEOUT',
//                         message: 'Request timed out. Please try again.',
//                         details: error.message
//                     }
//                 });
//             }

//             const statusCode = error.response?.status || 500;
//             res.status(statusCode).json({
//                 success: false,
//                 error: {
//                     code: error.code || 'REFRESH_ERROR',
//                     message: error.message || 'Failed to refresh LHDN data',
//                     details: error.response?.data?.error || error.message
//                 }
//             });
//         }
//     } catch (error) {
//         console.error('Error in refresh endpoint:', error);
//         res.status(500).json({
//             success: false,
//             error: {
//                 code: 'INTERNAL_SERVER_ERROR',
//                 message: 'An unexpected error occurred',
//                 details: error.message
//             }
//         });
//     }
// });

// module.exports = router;
