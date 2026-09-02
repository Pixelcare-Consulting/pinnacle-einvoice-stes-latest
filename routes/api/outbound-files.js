const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const XLSX = require('xlsx');
const { processExcelData } = require('../../services/lhdn/processExcelData');
const { mapToLHDNFormat, LhdnMappingError } = require('../../services/lhdn/lhdnMapper');
const { lookupCompanyIndustry } = require('../../services/lhdn/excelValidator');
const prisma = require('../../src/lib/prisma');
const moment = require('moment');
const axios = require('axios');
const { validateAndFormatNetworkPath, testNetworkPathAccessibility } = require('../../config/paths');
const { logDBOperation } = require('../../utils/logger');
const { exec } = require('child_process');
const LHDNSubmitter = require('../../services/lhdn/lhdnSubmitter');
const { getDocumentDetails, cancelValidDocumentBySupplier } = require('../../services/lhdn/lhdnService');
const { getActiveSAPConfig } = require('../../config/paths');
const NodeCache = require('node-cache');
const fileCache = new NodeCache({ stdTTL: 900 }); // 15 minutes cache instead of 1 minute
const { OutboundLoggingService, LOG_TYPES, MODULES, ACTIONS, STATUSES } = require('../../services/outboundLogging-prisma.service');
const { auth } = require('../../middleware/index-prisma');

// Add os module to the beginning of the file
const os = require('os');

const CACHE_KEY_PREFIX = 'outbound_files';
const excelDisplayCache = new NodeCache({ stdTTL: 3600, maxKeys: 5000 });
const HYDRATE_LIST_BATCH_CAP = 25;

const DOC_TYPE_LABELS = {
    '01': 'Invoice',
    '02': 'Credit Note',
    '03': 'Debit Note',
    '04': 'Refund Note',
    '11': 'Self-billed Invoice',
    '12': 'Self-billed Credit Note',
    '13': 'Self-billed Debit Note',
    '14': 'Self-billed Refund Note'
};

function excelDisplayCacheKey(filePath, mtimeMs) {
    return `${filePath}|${mtimeMs}`;
}

function toPublicProcessLog(processLog) {
    return {
        summary: processLog?.summary || { total: 0, valid: 0, invalid: 0, errors: 0 }
    };
}

function hasDisplayValue(value) {
    if (value === null || value === undefined) {
        return false;
    }
    if (typeof value === 'string' && value.trim() === '') {
        return false;
    }
    return true;
}

function needsExcelHydrate(fields) {
    return !hasDisplayValue(fields?.supplierInfo?.registrationName)
        || !hasDisplayValue(fields?.buyerInfo?.registrationName)
        || !hasDisplayValue(fields?.totalAmount);
}

async function readExcelDisplayFields(filePath) {
    const excelData = await readExcelWithLogging(filePath);
    const buyerInfo = extractBuyerInfo(excelData.dataWithHeaders);
    const supplierInfo = extractSupplierInfo(excelData.dataWithHeaders);
    const dates = extractDates(excelData.dataAsObjects);
    const currencyInfo = extractCurrencyInfo(excelData.dataWithHeaders);
    const totalAmount = extractTotalAmount(excelData.dataWithHeaders);

    return {
        buyerInfo,
        supplierInfo,
        issueDate: dates.issueDate,
        issueTime: dates.issueTime,
        totalAmount,
        currency: currencyInfo
    };
}

function getCachedExcelDisplayFields(filePath, mtimeMs) {
    return excelDisplayCache.get(excelDisplayCacheKey(filePath, mtimeMs)) || null;
}

function setCachedExcelDisplayFields(filePath, mtimeMs, fields) {
    excelDisplayCache.set(excelDisplayCacheKey(filePath, mtimeMs), fields);
}

/**
 * Poll LHDN for submission status updates
 * @param {string} submissionUid - The submission UID to poll for
 * @param {string} fileName - The file name
 * @param {string} invoice_number - The invoice number
 * @param {Object} req - The request object for session access
 * @returns {Promise<Object>} - The polling result
 */
async function pollSubmissionStatus(submissionUid, fileName, invoice_number, req, type = null, company = null, date = null) {
    try {
        console.log(`Starting polling for submission ${submissionUid}`);

        // Create a new LHDNSubmitter instance
        const submitter = new LHDNSubmitter(req);

        // Get token from AuthorizeToken.ini file
        const { getTokenSession } = require('../../services/token-prisma.service');
        let token;

        try {
            token = await getTokenSession();
            console.log('Using token from AuthorizeToken.ini for polling');
        } catch (tokenError) {
            console.error('Error getting token from AuthorizeToken.ini for polling:', tokenError);
            throw new Error('Failed to retrieve authentication token from AuthorizeToken.ini');
        }

        if (!token) {
            throw new Error('No valid authentication token available for polling');
        }

        // Check if the document already has a completed status
        const existingStatus = await prisma.wP_OUTBOUND_STATUS.findFirst({
            where: {
                submissionUid,
                status: {
                    in: ['Completed', 'Invalid', 'Partially Valid']
                }
            }
        });

        // If the document already has a completed status, don't poll again
        if (existingStatus) {
            console.log(`Document ${submissionUid} already has status ${existingStatus.status}, skipping polling`);
            return {
                success: true,
                status: existingStatus.status.toLowerCase(),
                documentDetails: {},
                longId: existingStatus.longId || 'NA',
                note: 'Status retrieved from database'
            };
        }

        // Poll for submission details
        const result = await submitter.getSubmissionDetails(submissionUid, token);

        if (result.success) {
            console.log(`Polling successful for ${submissionUid}, status: ${result.status}`);

            // Normalize status to lowercase for consistency
            const normalizedStatus = result.status.toLowerCase();

            // Update the status in the database
            await submitter.updateSubmissionStatus({
                invoice_number,
                uuid: result.documentDetails?.uuid || 'NA',
                submissionUid,
                fileName,
                status: normalizedStatus === 'valid' ? 'Valid' :
                    normalizedStatus === 'invalid' ? 'Invalid' :
                        normalizedStatus === 'partially valid' ? 'Partially Valid' : 'Processing',
                longId: result.longId,
                type,
                company,
                date
            });

            // If the status is valid/invalid/partially valid, we're done polling
            if (normalizedStatus === 'valid' || normalizedStatus === 'invalid' || normalizedStatus === 'partially valid') {
                console.log(`Document ${submissionUid} has final status ${normalizedStatus}, polling complete`);
            }

            return result;
        } else {
            // Special case: If we get an error with "Invalid response format for status: 200",
            // it might be because the document is already valid but the response format is unexpected
            if (result.error && result.error.includes('Invalid response format for status: 200')) {
                console.log(`Received 200 status for ${submissionUid} but with unexpected format, assuming valid`);

                // Update the status to Valid
                await submitter.updateSubmissionStatus({
                    invoice_number,
                    uuid: 'NA',
                    submissionUid,
                    fileName,
                    status: 'Valid',
                    longId: 'NA',
                    type,
                    company,
                    date
                });

                return {
                    success: true,
                    status: 'valid',
                    documentDetails: {},
                    longId: 'NA',
                    note: 'Assumed valid based on 200 response'
                };
            }

            console.error(`Polling failed for ${submissionUid}:`, result.error);
            return result;
        }
    } catch (error) {
        console.error(`Error polling submission ${submissionUid}:`, error);

        // If the error is about "Invalid response format for status: 200", handle it specially
        if (error.message && error.message.includes('Invalid response format for status: 200')) {
            console.log(`Received 200 status for ${submissionUid} but with error, assuming valid`);

            // Update the status to Valid (not Completed)
            await submitter.updateSubmissionStatus({
                invoice_number,
                uuid: 'NA',
                submissionUid,
                fileName,
                status: 'Valid',
                longId: 'NA',
                type,
                company,
                date
            });

            return {
                success: true,
                status: 'valid',
                documentDetails: {},
                longId: 'NA',
                note: 'Assumed valid based on 200 response with error'
            };
        }

        throw error;
    }
}

let lastFilesModifiedTime = null;
let lastStatusUpdateTime = null;

/**
 * Generate a cache key with optional parameters for more granular caching`
 */
function generateCacheKey(params = {}) {
    const baseKey = `${CACHE_KEY_PREFIX}_list`;
    // Add additional cache parameters if needed
    if (Object.keys(params).length > 0) {
        const paramsStr = Object.entries(params)
            .map(([key, value]) => `${key}=${value}`)
            .join('_');
        return `${baseKey}_${paramsStr}`;
    }
    return baseKey;
}

/**
 * Check if there are new or updated files since last check
 * @param {string} networkPath - Path to check for new files
 * @param {Date} lastCheckTime - Timestamp of last check
 * @returns {Promise<boolean>} - Whether there are new files
 */
async function checkForNewOrUpdatedFiles(networkPath, lastCheckTime) {
    try {
        if (!lastCheckTime) return true;

        const lastCheck = new Date(lastCheckTime);
        const checkResult = await checkForNewFiles(networkPath, lastCheck);
        return checkResult;
    } catch (error) {
        console.error('Error checking for new files:', error);
        // If there's an error, assume there might be changes to be safe
        return true;
    }
}

/**
 * Check if any status updates have occurred since the last check
 * @param {string} timestamp - ISO date string of last status update check
 * @returns {Promise<boolean>} - True if there are updates
 */
async function checkForStatusUpdates(timestamp) {
    try {
        if (!timestamp) return true;

        // Convert the date to a simple ISO string without timezone offset
        const date = new Date(timestamp);
        const formattedDate = date.toISOString().slice(0, 19).replace('T', ' ');

        // Use Prisma to query for status updates
        const results = await prisma.$queryRaw`
            SELECT TOP 1 updated_at
            FROM WP_OUTBOUND_STATUS
            WHERE updated_at > ${formattedDate}
            ORDER BY updated_at DESC
        `;

        // Store global last update time if we found one
        if (results && results.length > 0 && results[0].updated_at) {
            lastStatusUpdateTime = results[0].updated_at;
        }

        return results && results.length > 0;
    } catch (error) {
        console.error('Error checking for status updates:', error);
        return true; // Assume there are updates if there's an error
    }
}

/**
 * Get only updated document status since last check
 * @param {Date} since - Timestamp to check updates since
 * @returns {Promise<Array>} - Array of updated statuses
 */
async function getUpdatedStatuses(since) {
    try {
        if (!since) return [];

        // Convert the date to a simple ISO string without timezone offset
        const date = new Date(since);
        const formattedDate = date.toISOString().slice(0, 19).replace('T', ' ');

        // Use Prisma to query for updated statuses
        const updatedStatuses = await prisma.$queryRaw`
            SELECT
                id, UUID, submissionUid, fileName, invoice_number,
                status, date_submitted, date_cancelled, cancellation_reason,
                cancelled_by, updated_at, supplier, receiver, amount
            FROM WP_OUTBOUND_STATUS
            WHERE updated_at > ${formattedDate}
            ORDER BY updated_at DESC
        `;

        return updatedStatuses;
    } catch (error) {
        console.error('Error getting updated statuses:', error);
        return [];
    }
}

/**
 * Invalidate file cache with optional targeted invalidation
 */
function invalidateFileCache(params = {}) {
    if (Object.keys(params).length > 0) {
        // Targeted invalidation
        const cacheKey = generateCacheKey(params);
        fileCache.del(cacheKey);
    } else {
        // Full invalidation
        const cacheKey = generateCacheKey();
        fileCache.del(cacheKey);
    }

    // Log cache invalidation
    // ////console.log('Cache invalidated:', params);
}

// This function is a duplicate and has been removed to avoid confusion.
// The implementation at lines 70-98 is now used for all status update checks.

// Add new function to check for new files
async function checkForNewFiles(networkPath, lastCheck) {
    try {
        const types = ['Manual', 'Schedule'];
        let hasNewFiles = false;
        const lastCheckDate = new Date(lastCheck);

        // Fast check for recent files
        for (const type of types) {
            const typeDir = path.join(networkPath, type);

            // Skip if directory doesn't exist
            if (!fs.existsSync(typeDir)) continue;

            // Get list of company directories
            let companies;
            try {
                companies = await fsPromises.readdir(typeDir);
            } catch (err) {
                console.error(`Error reading type directory ${typeDir}:`, err);
                continue;
            }

            // Check each company directory
            for (const company of companies) {
                const companyDir = path.join(typeDir, company);

                // Skip if not a directory
                try {
                    const stat = await fsPromises.stat(companyDir);
                    if (!stat.isDirectory()) continue;

                    // If the company directory itself is newer than our last check
                    if (new Date(stat.mtime) > lastCheckDate) {
                        return true;
                    }
                } catch (err) {
                    console.error(`Error checking company directory ${companyDir}:`, err);
                    continue;
                }

                // Get list of date directories
                let dates;
                try {
                    dates = await fsPromises.readdir(companyDir);
                } catch (err) {
                    console.error(`Error reading company directory ${companyDir}:`, err);
                    continue;
                }

                // Check each date directory
                for (const date of dates) {
                    const dateDir = path.join(companyDir, date);

                    // Skip if not a directory
                    try {
                        const stat = await fsPromises.stat(dateDir);
                        if (!stat.isDirectory()) continue;

                        // If the date directory itself is newer than our last check
                        if (new Date(stat.mtime) > lastCheckDate) {
                            return true;
                        }
                    } catch (err) {
                        console.error(`Error checking date directory ${dateDir}:`, err);
                        continue;
                    }

                    // Get list of files
                    let files;
                    try {
                        files = await fsPromises.readdir(dateDir);
                    } catch (err) {
                        console.error(`Error reading date directory ${dateDir}:`, err);
                        continue;
                    }

                    // Check if any file is newer than our last check
                    for (const file of files) {
                        const filePath = path.join(dateDir, file);
                        try {
                            const stats = await fsPromises.stat(filePath);

                            // If any file is newer than our last check, return true
                            if (new Date(stats.mtime) > lastCheckDate) {
                                return true;
                            }
                        } catch (err) {
                            console.error(`Error checking file ${filePath}:`, err);
                            continue;
                        }
                    }
                }
            }
        }

        return hasNewFiles;
    } catch (error) {
        console.error('Error checking for new files:', error);
        return false;
    }
}

async function getOutgoingConfig() {
    const config = await prisma.wP_CONFIGURATION.findFirst({
        where: {
            Type: 'OUTGOING',
            IsActive: true
        },
        orderBy: {
            CreateTS: 'desc'
        }
    });

    if (!config || !config.Settings) {

        throw new Error('Outgoing path configuration not found');
    }

    let settings = typeof config.Settings === 'string' ? JSON.parse(config.Settings) : config.Settings;

    if (!settings.networkPath) {
        throw new Error('Outgoing network path not configured');
    }

    return settings;
};
/**
 * Read Excel file with optimized performance
 */
async function readExcelWithLogging(filePath) {
    try {
        // Use a more efficient approach to read Excel files
        // Only read the first sheet and the necessary data
        const workbook = XLSX.readFile(filePath, {
            cellFormula: false,      // Don't parse formulas
            cellHTML: false,         // Don't generate HTML
            cellNF: false,           // Don't parse number formats
            cellStyles: false,       // Don't parse styles
            cellDates: false,        // Don't convert dates
            sheetStubs: false,       // Don't generate stubs for empty cells
            sheetRows: 1000,         // Limit to first 1000 rows for performance
            bookImages: false,       // Don't parse images
            bookVBA: false           // Don't parse VBA
        });

        // Just get the first sheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Convert to JSON objects - only what we need
        const dataAsObjects = XLSX.utils.sheet_to_json(worksheet);
        const dataWithHeaders = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        ////console.log(dataWithHeaders);

        return {
            dataWithHeaders,
            dataAsObjects,
            sheetNames: workbook.SheetNames,
            worksheet
        };
    } catch (error) {
        throw error;
    }
}

/**
 * Helper function to ensure directory exists
 */
async function ensureDirectoryExists(dirPath) {
    try {
        await fsPromises.access(dirPath);
        //////console.log('Directory exists:', dirPath);
    } catch (error) {
        //////console.log('Creating directory:', dirPath);
        await fsPromises.mkdir(dirPath, { recursive: true });
    }
}

/**
 * Helper function to log errors with enhanced details
 * @param {string} description - Error description
 * @param {Error} error - Error object
 * @param {Object} options - Additional logging options
 */
async function logError(description, error, options = {}) {
    try {
        const logEntry = {
            Description: `${description}: ${error.message}`,
            CreateTS: new Date().toISOString(),
            LoggedUser: options.user || 'System',
            IPAddress: options.ip || null,
            LogType: options.logType || 'ERROR',
            Module: 'OUTBOUND_FILES',
            Action: options.action || 'LIST_ALL',
            Status: 'FAILED',
            UserID: options.userId || null
        };

        await prisma.wP_LOGS.create({
            data: logEntry
        });

        console.error('Error logged:', {
            description,
            error: error.message,
            ...options
        });
    } catch (logError) {
        console.error('Error logging to database:', logError);
    }
}

/**
 * List all files from network directories with caching and duplicate filtering
 * Optimized to fetch only the latest timestamp files and handle duplicates
 */
router.get('/list-all', auth.isApiAuthenticated, async (req, res) => {
    ////console.log('Starting list-all endpoint');

    const processLog = {
        details: [],
        summary: { total: 0, valid: 0, invalid: 0, errors: 0 }
    };

    try {
        ////console.log('Generating cache key');
        const cacheKey = generateCacheKey();
        const { polling, initialLoad } = req.query;
        const forceRefresh = req.query.forceRefresh === 'true';
        const manualRefresh = req.query.manualRefresh === 'true'; // New parameter for manual refresh button
        const realTime = req.query.realTime === 'true';

        // Get the latest status update timestamp
        ////console.log('Fetching latest status update');
        const latestStatusUpdate = await prisma.wP_OUTBOUND_STATUS.findFirst({
            select: {
                updated_at: true
            },
            orderBy: {
                updated_at: 'desc'
            }
        });
        ////console.log('Latest status update:', latestStatusUpdate);

        // If initialLoad=true is provided, force cache refresh
        // If forceRefresh=true is provided, force cache refresh
        // If manualRefresh=true is provided, force cache refresh (for the new refresh button)
        if (initialLoad === 'true' || forceRefresh || manualRefresh) {
            ////console.log('Force refresh requested, bypassing cache');
            fileCache.del(cacheKey);
        }
        // Check cache first if not in real-time mode and not a manual refresh
        else if (!realTime && !manualRefresh) {
            ////console.log('Checking cache');
            const cachedData = fileCache.get(cacheKey);
            if (cachedData) {
                ////console.log('Found cached data from:', cachedData.timestamp);

                // For better performance: if we have cached data, check if there are any status changes
                const hasStatusUpdates = await checkForStatusUpdates(cachedData.lastStatusUpdate);
                let updatedFiles = [];

                if (hasStatusUpdates) {
                    ////console.log('Status updates detected, fetching only updated statuses');
                    // Get only the updated statuses
                    const updatedStatuses = await getUpdatedStatuses(cachedData.lastStatusUpdate);

                    if (updatedStatuses.length > 0) {
                        ////console.log(`Found ${updatedStatuses.length} status updates`);

                        // Create a map for easy lookup
                        const statusMap = new Map();
                        updatedStatuses.forEach(status => {
                            if (status.fileName) statusMap.set(status.fileName, status);
                            if (status.invoice_number) statusMap.set(status.invoice_number, status);
                        });

                        // Create a map for easy lookup of existing files
                        const existingFilesMap = new Map();
                        cachedData.files.forEach(file => {
                            existingFilesMap.set(file.fileName, file);
                        });

                        // Update the cached files with new status information
                        updatedFiles = cachedData.files.map(file => {
                            const status = statusMap.get(file.fileName) || statusMap.get(file.invoiceNumber);
                            if (status) {
                                // Update this file with new status
                                const supplierInfo = status.supplier
                                    ? { registrationName: status.supplier }
                                    : file.supplierInfo;
                                const buyerInfo = status.receiver
                                    ? { registrationName: status.receiver }
                                    : file.buyerInfo;
                                const totalAmount = status.amount || file.totalAmount;
                                return {
                                    ...file,
                                    status: status.status || file.status,
                                    statusUpdateTime: status.updated_at || file.statusUpdateTime,
                                    date_submitted: status.date_submitted || file.date_submitted,
                                    date_cancelled: status.date_cancelled || file.date_cancelled,
                                    cancellation_reason: status.cancellation_reason || file.cancellation_reason,
                                    cancelled_by: status.cancelled_by || file.cancelled_by,
                                    uuid: status.UUID || file.uuid,
                                    submissionUid: status.submissionUid || file.submissionUid,
                                    supplier: status.supplier || file.supplier,
                                    receiver: status.receiver || file.receiver,
                                    supplierInfo,
                                    buyerInfo,
                                    totalAmount,
                                    needsHydrate: needsExcelHydrate({ supplierInfo, buyerInfo, totalAmount })
                                };
                            }
                            return file;
                        });

                        // Update the cache with the new data
                        const updatedCache = {
                            ...cachedData,
                            files: updatedFiles,
                            timestamp: new Date().toISOString(),
                            lastStatusUpdate: latestStatusUpdate?.updated_at,
                            cacheUpdatedFromServer: true
                        };
                        fileCache.set(cacheKey, updatedCache);

                        // Return the incrementally updated data
                        return res.json({
                            success: true,
                            files: updatedFiles,
                            processLog: toPublicProcessLog(cachedData.processLog),
                            fromCache: true,
                            incrementalUpdate: true,
                            updatedCount: updatedStatuses.length,
                            timestamp: new Date().toISOString(),
                            cachedAt: cachedData.timestamp
                        });
                    }
                }

                // Check if we need to check for new files (less frequently)
                const cacheAge = new Date() - new Date(cachedData.timestamp);
                const CHECK_FILES_INTERVAL = 60 * 1000; // 1 minute
                let hasNewFiles = false;

                if (cacheAge > CHECK_FILES_INTERVAL) {
                    // Only check if required - this is an expensive operation
                    hasNewFiles = await checkForNewOrUpdatedFiles(cachedData.networkPath, cachedData.timestamp);
                }

                // If no changes needed, return cached data
                if (!hasNewFiles && !hasStatusUpdates) {
                    ////console.log('Returning cached data - no changes detected');
                    return res.json({
                        success: true,
                        files: cachedData.files,
                        processLog: toPublicProcessLog(cachedData.processLog),
                        fromCache: true,
                        cachedAt: cachedData.timestamp,
                        lastStatusUpdate: cachedData.lastStatusUpdate,
                        realTime: realTime
                    });
                }

                // If only new files and no status changes
                if (hasNewFiles && !hasStatusUpdates && updatedFiles.length === 0) {
                    ////console.log('New files detected, proceeding with full refresh');
                    // We'll continue with a full refresh below
                }
            }
        }

        // Get active SAP configuration first since we need it for the network path
        ////console.log('Fetching SAP configuration');
        const config = await prisma.wP_CONFIGURATION.findFirst({
            where: {
                Type: 'SAP',
                IsActive: true
            },
            orderBy: {
                CreateTS: 'desc'
            }
        });

        if (!config || !config.Settings) {
            throw new Error('No active SAP configuration found');
        }

        // Parse Settings if it's a string
        let settings = config.Settings;
        if (typeof settings === 'string') {
            try {
                settings = JSON.parse(settings);
            } catch (parseError) {
                console.error('Error parsing SAP settings:', parseError);
                throw new Error('Invalid SAP configuration format');
            }
        }
        // Get existing submission statuses
        ////console.log('Fetching submission statuses');
        const submissionStatuses = await prisma.wP_OUTBOUND_STATUS.findMany({
            select: {
                id: true,
                UUID: true,
                submissionUid: true,
                fileName: true,
                filePath: true,
                invoice_number: true,
                status: true,
                date_submitted: true,
                date_cancelled: true,
                cancellation_reason: true,
                cancelled_by: true,
                updated_at: true,
                supplier: true,
                receiver: true,
                amount: true
            },
            orderBy: {
                updated_at: 'desc'
            }
        });

        // Create status lookup map
        const statusMap = new Map();
        submissionStatuses.forEach(status => {
            const statusObj = {
                UUID: status.UUID,
                SubmissionUID: status.submissionUid,
                SubmissionStatus: status.status,
                DateTimeSent: status.date_submitted,
                DateTimeUpdated: status.updated_at,
                DateTimeCancelled: status.date_cancelled,
                CancelledReason: status.cancellation_reason,
                CancelledBy: status.cancelled_by,
                FileName: status.fileName,
                DocNum: status.invoice_number,
                Supplier: status.supplier,
                Receiver: status.receiver,
                Amount: status.amount
            };

            if (status.fileName) statusMap.set(status.fileName, statusObj);
            if (status.invoice_number) statusMap.set(status.invoice_number, statusObj);
        });

        const files = [];
        const types = ['Manual', 'Schedule'];

        // Process directories
        ////console.log('Processing directories');
        for (const type of types) {
            const typeDir = path.join(settings.networkPath, type);
            try {
                await processTypeDirectory(typeDir, type, files, processLog, statusMap);
            } catch (dirError) {
                console.error(`Error processing ${type} directory:`, dirError);
                // Continue with other directories even if one fails
            }
        }

        // Create a map for latest documents
        ////console.log('Processing latest documents');
        const latestDocuments = new Map();

        files.forEach(file => {
            const documentKey = file.invoiceNumber || file.fileName;
            const existingDoc = latestDocuments.get(documentKey);

            if (!existingDoc || new Date(file.modifiedTime) > new Date(existingDoc.modifiedTime)) {
                latestDocuments.set(documentKey, file);
            }
        });

        // Convert map to array and merge with status
        const mergedFiles = Array.from(latestDocuments.values()).map(file => {
            const status = statusMap.get(file.fileName) || statusMap.get(file.invoiceNumber);
            const fileStatus = status?.SubmissionStatus || 'Pending';

            return {
                ...file,
                status: fileStatus,
                statusUpdateTime: status?.DateTimeUpdated || null,
                date_submitted: status?.DateTimeSent || null,
                date_cancelled: status?.DateTimeCancelled || null,
                cancellation_reason: status?.CancelledReason || null,
                cancelled_by: status?.CancelledBy || null,
                uuid: status?.UUID || null,
                submissionUid: status?.SubmissionUID || null,
                needsHydrate: needsExcelHydrate(file)
            };
        });

        // Sort by modified time
        mergedFiles.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));

        // Update cache
        ////console.log('Updating cache');
        const publicProcessLog = toPublicProcessLog(processLog);
        const cacheData = {
            files: mergedFiles,
            processLog: publicProcessLog,
            timestamp: new Date().toISOString(),
            lastStatusUpdate: latestStatusUpdate?.updated_at,
            networkPath: settings.networkPath
        };

        // Set shorter TTL for real-time mode
        if (realTime) {
            fileCache.set(cacheKey, cacheData, 15); // 15 seconds TTL for real-time mode
        } else {
            fileCache.set(cacheKey, cacheData);
        }

        ////console.log('Sending response');
        res.json({
            success: true,
            files: mergedFiles,
            processLog: publicProcessLog,
            fromCache: false,
            realTime: realTime
        });

    } catch (error) {
        console.error('Error in list-all:', error);
        try {
            await logError('Error listing outbound files', error, {
                action: 'LIST_ALL',
                userId: req.user ? req.user.id : null // Make user ID optional
            });
        } catch (logError) {
            console.error('Failed to log error:', logError);
        }

        res.status(500).json({
            success: false,
            error: error.message,
            processLog: toPublicProcessLog(processLog),
            stack: error.stack // Include stack trace for debugging
        });
    }
});


/**
 * Fill Supplier / Receiver / Amount / issue date for a visible page of live files.
 * Parses only the requested workbooks (capped) and caches results by path + mtime.
 */
router.post('/hydrate-list', auth.isApiAuthenticated, async (req, res) => {
    try {
        const requestedFiles = Array.isArray(req.body?.files) ? req.body.files : [];
        const files = requestedFiles.slice(0, HYDRATE_LIST_BATCH_CAP);

        if (files.length === 0) {
            return res.json({ success: true, files: [] });
        }

        const config = await getActiveSAPConfig();
        if (!config.success) {
            throw new Error(config.error || 'Failed to get SAP configuration');
        }

        const hydrated = await Promise.all(files.map(async (file) => {
            const fileName = file.fileName;
            const type = file.type;
            const company = file.company;
            const date = file.date;

            if (!fileName || !type || !company || !date) {
                return {
                    fileName: fileName || null,
                    success: false,
                    error: 'fileName, type, company, and date are required'
                };
            }

            const formattedDate = moment(date).format('YYYY-MM-DD');
            const filePath = path.join(config.networkPath, type, company, formattedDate, fileName);

            try {
                await fsPromises.access(filePath);
                const stats = await fsPromises.stat(filePath);
                const mtimeMs = stats.mtimeMs || new Date(stats.mtime).getTime();

                let displayFields = getCachedExcelDisplayFields(filePath, mtimeMs);
                if (!displayFields) {
                    displayFields = await readExcelDisplayFields(filePath);
                    setCachedExcelDisplayFields(filePath, mtimeMs, displayFields);
                }

                return {
                    fileName,
                    type,
                    company,
                    date: formattedDate,
                    success: true,
                    ...displayFields,
                    needsHydrate: false
                };
            } catch (fileError) {
                console.error(`Error hydrating file ${fileName}:`, fileError);
                return {
                    fileName,
                    type,
                    company,
                    date: formattedDate,
                    success: false,
                    error: fileError.message
                };
            }
        }));

        res.json({
            success: true,
            files: hydrated
        });
    } catch (error) {
        console.error('Error in hydrate-list:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


/**
 * Check if a document has already been submitted
 */
router.get('/check-submission/:docNum', async (req, res) => {
    try {
        const { docNum } = req.params;
        // ////console.log('Checking submission for document:', docNum);

        const existingSubmission = await prisma.wP_OUTBOUND_STATUS.findFirst({
            where: {
                OR: [
                    { UUID: docNum },
                    { invoice_number: docNum },
                    { fileName: { contains: docNum } }
                ]
            }
        });

        if (existingSubmission) {
            return res.json({
                exists: true,
                status: existingSubmission.status,
                submissionDate: existingSubmission.date_submitted,
                uuid: existingSubmission.UUID
            });
        }

        res.json({ exists: false });

    } catch (error) {
        console.error('Error checking submission:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Sync amount data from WP_INBOUND_STATUS to WP_OUTBOUND_STATUS
 * Updates records where UUID matches between the two tables
 */
router.post('/sync-amounts', async (req, res) => {
    try {
        console.log('Starting amount sync from WP_INBOUND_STATUS to WP_OUTBOUND_STATUS');

        // Get all records from WP_INBOUND_STATUS that have amount data
        const inboundRecords = await prisma.wP_INBOUND_STATUS.findMany({
            where: {
                AND: [
                    {
                        uuid: { not: null }
                    },
                    {
                        OR: [
                            { totalSales: { not: null } },
                            { totalExcludingTax: { not: null } },
                            { totalNetAmount: { not: null } },
                            { totalPayableAmount: { not: null } }
                        ]
                    }
                ]
            },
            select: {
                uuid: true,
                internalId: true,
                totalSales: true,
                totalExcludingTax: true,
                totalNetAmount: true,
                totalPayableAmount: true,
                issuerName: true,
                receiverName: true
            }
        });

        console.log(`Found ${inboundRecords.length} inbound records with amount data`);

        let updatedCount = 0;
        let matchedCount = 0;

        // Process each inbound record
        for (const inboundRecord of inboundRecords) {
            try {
                // Find matching outbound record by UUID or invoice_number (internalId)
                const outboundRecord = await prisma.wP_OUTBOUND_STATUS.findFirst({
                    where: {
                        OR: [
                            { UUID: inboundRecord.uuid },
                            { invoice_number: inboundRecord.internalId }
                        ]
                    }
                });

                if (outboundRecord) {
                    matchedCount++;

                    // Determine the best amount to use (prioritize totalPayableAmount)
                    const amount = inboundRecord.totalPayableAmount ||
                        inboundRecord.totalNetAmount ||
                        inboundRecord.totalSales ||
                        inboundRecord.totalExcludingTax;

                    // Update the outbound record with amount and other data
                    const updateData = {};

                    if (amount) {
                        updateData.amount = amount.toString();
                    }

                    if (inboundRecord.issuerName && !outboundRecord.supplier) {
                        updateData.supplier = inboundRecord.issuerName;
                    }

                    if (inboundRecord.receiverName && !outboundRecord.receiver) {
                        updateData.receiver = inboundRecord.receiverName;
                    }

                    // Only update if we have data to update
                    if (Object.keys(updateData).length > 0) {
                        await prisma.wP_OUTBOUND_STATUS.update({
                            where: { id: outboundRecord.id },
                            data: {
                                ...updateData,
                                updated_at: new Date()
                            }
                        });

                        updatedCount++;
                        console.log(`Updated outbound record ${outboundRecord.id} with amount: ${amount}`);
                    }
                }
            } catch (error) {
                console.error(`Error processing record ${inboundRecord.uuid}:`, error);
            }
        }

        console.log(`Sync completed: ${matchedCount} matches found, ${updatedCount} records updated`);

        res.json({
            success: true,
            message: 'Amount sync completed successfully',
            stats: {
                inboundRecordsProcessed: inboundRecords.length,
                matchesFound: matchedCount,
                recordsUpdated: updatedCount
            }
        });

    } catch (error) {
        console.error('Error syncing amounts:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to sync amounts',
            message: error.message
        });
    }
});


/**
 * Auto-sync function to sync with WP_INBOUND_STATUS
 */
async function autoSyncWithInbound() {
    try {
        console.log('Starting auto-sync with WP_INBOUND_STATUS...');

        // Get all records from WP_OUTBOUND_STATUS that need syncing
        const outboundRecords = await prisma.wP_OUTBOUND_STATUS.findMany({
            where: {
                status: {
                    in: ['Submitted', 'Valid']
                }
            }
        });

        console.log(`Found ${outboundRecords.length} outbound records to sync`);

        for (const outboundRecord of outboundRecords) {
            try {
                // Try to find matching record in WP_INBOUND_STATUS by uuid or invoice_number
                // Note: WP_INBOUND_STATUS uses 'uuid' (lowercase) while WP_OUTBOUND_STATUS uses 'UUID' (uppercase)
                const inboundRecord = await prisma.wP_INBOUND_STATUS.findFirst({
                    where: {
                        OR: [
                            { uuid: outboundRecord.UUID },
                            // WP_INBOUND_STATUS doesn't have invoice_number field, so we'll match by uuid only
                            // If needed, we can add more matching criteria based on other fields
                        ]
                    }
                });

                if (inboundRecord) {
                    // Update outbound record with inbound status
                    await prisma.wP_OUTBOUND_STATUS.update({
                        where: { id: outboundRecord.id },
                        data: {
                            status: inboundRecord.status,
                            date_sync: new Date(),
                            updated_at: new Date()
                        }
                    });
                    console.log(`Synced record ${outboundRecord.invoice_number}: ${outboundRecord.status} -> ${inboundRecord.status}`);
                }
            } catch (syncError) {
                console.error(`Error syncing record ${outboundRecord.id}:`, syncError);
            }
        }

        console.log('Auto-sync completed');
    } catch (error) {
        console.error('Error during auto-sync:', error);
    }
}

/**
 * Get staging data from WP_OUTBOUND_STATUS table
 */
router.get('/staging-data', auth.isApiAuthenticated, async (req, res) => {
    try {
        console.log('Fetching staging data from WP_OUTBOUND_STATUS with auto-sync');

        // Auto-sync with inbound status before fetching data
        await autoSyncWithInbound();

        // First, let's try to get a count to see if there are any records
        const recordCount = await prisma.wP_OUTBOUND_STATUS.count();
        console.log(`Total records in WP_OUTBOUND_STATUS: ${recordCount}`);

        // Get all records from WP_OUTBOUND_STATUS with all available fields
        const stagingRecords = await prisma.wP_OUTBOUND_STATUS.findMany({
            select: {
                id: true,
                UUID: true,
                submissionUid: true,
                company: true,
                supplier: true,
                receiver: true,
                fileName: true,
                filePath: true,
                invoice_number: true,
                source: true,
                amount: true,
                document_type: true,
                status: true,
                date_submitted: true,
                date_sync: true,
                date_cancelled: true,
                cancelled_by: true,
                cancellation_reason: true,
                created_at: true,
                updated_at: true,
                submitted_by: true
            },
            orderBy: {
                updated_at: 'desc'
            }
        });

        // Update status based on 72-hour rule before transforming
        const now = new Date();
        const updatedRecords = await Promise.all(stagingRecords.map(async (record) => {
            // Check if status should be updated from Valid to Completed based on 72-hour rule
            if (record.status === 'Valid' && record.date_submitted) {
                const submittedDate = new Date(record.date_submitted);
                const hoursDiff = (now - submittedDate) / (1000 * 60 * 60);

                if (hoursDiff > 72) {
                    // Update status to Completed
                    try {
                        await prisma.wP_OUTBOUND_STATUS.update({
                            where: { id: record.id },
                            data: {
                                status: 'Completed',
                                updated_at: now
                            }
                        });
                        record.status = 'Completed';
                        record.updated_at = now;
                        console.log(`Updated status to Completed for record ${record.id} (${record.invoice_number}) - 72 hours passed`);
                    } catch (updateError) {
                        console.error(`Error updating status for record ${record.id}:`, updateError);
                    }
                }
            }
            return record;
        }));

        // Transform the data to match the expected format with all database fields
        const transformedFiles = updatedRecords.map(record => ({
            // Core identification fields
            id: record.id,
            uuid: record.UUID,
            submissionUid: record.submissionUid,

            // File information
            fileName: record.fileName || 'N/A',
            filePath: record.filePath,

            // Company and parties
            company: record.company || extractCompanyFromPath(record.filePath) || 'Unknown',
            supplierName: record.supplier || 'N/A',
            buyerName: record.receiver || 'N/A',
            supplier: record.supplier,
            receiver: record.receiver,

            // Document details
            invoiceNumber: record.invoice_number || extractInvoiceFromFileName(record.fileName),
            invoice_number: record.invoice_number,
            document_type: record.document_type || 'Invoice',
            typeName: record.document_type || 'Database Record',

            // Financial information
            totalAmount: record.amount || '0.00',
            amount: record.amount,

            // Status and source
            status: record.status || 'Unknown',
            source: record.source || 'Archive Staging',

            // Date information
            uploadedDate: record.created_at || record.updated_at,
            modifiedTime: record.updated_at,
            issueDate: record.date_submitted || record.created_at,
            issueTime: null,
            submittedDate: record.date_submitted,
            date_submitted: record.date_submitted,
            date_sync: record.date_sync,
            date_cancelled: record.date_cancelled,
            statusUpdateTime: record.updated_at,
            created_at: record.created_at,
            updated_at: record.updated_at,

            // Cancellation information
            cancelled_by: record.cancelled_by,
            cancellation_reason: record.cancellation_reason,

            // User information
            submitted_by: record.submitted_by,

            // Additional metadata for table display
            fromStaging: true,
            dataSource: 'WP_OUTBOUND_STATUS'
        }));

        console.log(`Found ${transformedFiles.length} staging records`);

        // Log first record for debugging
        if (transformedFiles.length > 0) {
            console.log('Sample transformed record:', JSON.stringify(transformedFiles[0], null, 2));
        }

        res.json({
            success: true,
            files: transformedFiles,
            fromStaging: true,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error fetching staging data:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Helper function to extract company from file path
 */
function extractCompanyFromPath(filePath) {
    if (!filePath) return null;

    try {
        // Expected path format: /type/company/date/filename
        const pathParts = filePath.split('/').filter(part => part.length > 0);
        if (pathParts.length >= 2) {
            return pathParts[1]; // Company is the second part
        }
    } catch (error) {
        console.error('Error extracting company from path:', error);
    }

    return null;
}

/**
 * Helper function to extract invoice number from filename
 */
function extractInvoiceFromFileName(fileName) {
    if (!fileName) return null;

    try {
        // Expected format: XX_InvoiceNumber_eInvoice_YYYYMMDDHHMMSS.xls
        const baseName = path.parse(fileName).name;
        const parts = baseName.split('_');
        if (parts.length >= 2) {
            return parts[1]; // Invoice number is the second part
        }
    } catch (error) {
        console.error('Error extracting invoice from filename:', error);
    }

    return null;
}

/**
 * Cleanup old files (older than 3 months)
 */
router.post('/cleanup-old', async (req, res) => {
    try {
        console.log('Starting cleanup of old files...');

        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        let filesDeleted = 0;
        let recordsDeleted = 0;
        const errors = [];

        // 1. Delete old database records
        try {
            const deleteResult = await prisma.wP_OUTBOUND_STATUS.deleteMany({
                where: {
                    created_at: {
                        lt: threeMonthsAgo
                    }
                }
            });
            recordsDeleted = deleteResult.count;
            console.log(`Deleted ${recordsDeleted} old database records`);
        } catch (dbError) {
            console.error('Error deleting database records:', dbError);
            errors.push(`Database cleanup failed: ${dbError.message}`);
        }

        // 2. Delete old files from network storage
        try {
            const networkPath = process.env.NETWORK_STORAGE_PATH || 'C:/inetpub/wwwroot/eInvoice/storage/outbound';

            if (fs.existsSync(networkPath)) {
                const companies = fs.readdirSync(networkPath, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => dirent.name);

                for (const company of companies) {
                    const companyPath = path.join(networkPath, company);

                    if (fs.existsSync(companyPath)) {
                        const dateFolders = fs.readdirSync(companyPath, { withFileTypes: true })
                            .filter(dirent => dirent.isDirectory())
                            .map(dirent => dirent.name);

                        for (const dateFolder of dateFolders) {
                            try {
                                // Parse date folder (expected format: YYYY-MM-DD)
                                const folderDate = new Date(dateFolder);

                                if (folderDate < threeMonthsAgo) {
                                    const folderPath = path.join(companyPath, dateFolder);

                                    // Count files before deletion
                                    const files = fs.readdirSync(folderPath);
                                    filesDeleted += files.length;

                                    // Delete the entire folder
                                    fs.rmSync(folderPath, { recursive: true, force: true });
                                    console.log(`Deleted folder: ${folderPath} (${files.length} files)`);
                                }
                            } catch (folderError) {
                                console.error(`Error processing folder ${dateFolder}:`, folderError);
                                errors.push(`Failed to delete folder ${dateFolder}: ${folderError.message}`);
                            }
                        }
                    }
                }
            } else {
                errors.push(`Network storage path not found: ${networkPath}`);
            }
        } catch (fileError) {
            console.error('Error cleaning up files:', fileError);
            errors.push(`File cleanup failed: ${fileError.message}`);
        }

        console.log(`Cleanup completed. Files deleted: ${filesDeleted}, Records deleted: ${recordsDeleted}`);

        res.json({
            success: true,
            filesDeleted,
            recordsDeleted,
            errors: errors.length > 0 ? errors : null,
            cutoffDate: threeMonthsAgo.toISOString()
        });

    } catch (error) {
        console.error('Error during cleanup:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Add route to open Excel file
router.post('/:filename/open', async (req, res) => {
    try {
        const { filename } = req.params;
        const { type, company, date } = req.body;

        // Get SAP configuration
        const config = await getActiveSAPConfig();
        if (!config.success) {
            throw new Error(config.error || 'Failed to get SAP configuration');
        }

        // Construct file path using config
        const formattedDate = moment(date).format('YYYY-MM-DD');
        const filePath = path.join(config.networkPath, type, company, formattedDate, filename);
        //////console.log('Opening file from path:', filePath);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                error: {
                    code: 'FILE_NOT_FOUND',
                    message: 'The requested file was not found'
                }
            });
        }

        // Determine the OS and construct the appropriate command
        let command;
        switch (process.platform) {
            case 'win32':
                command = `start excel "${filePath}"`;
                break;
            case 'darwin':
                command = `open -a "Microsoft Excel" "${filePath}"`;
                break;
            case 'linux':
                command = `xdg-open "${filePath}"`;
                break;
            default:
                throw new Error('Unsupported operating system');
        }

        // Execute the command to open Excel
        exec(command, (error) => {
            if (error) {
                console.error('Error opening Excel file:', error);
                return res.status(500).json({
                    error: {
                        code: 'OPEN_ERROR',
                        message: 'Failed to open Excel file',
                        details: error.message
                    }
                });
            }

            res.json({
                success: true,
                message: 'Excel file opened successfully',
                filePath: filePath
            });
        });

    } catch (error) {
        console.error('Error opening Excel file:', error);
        res.status(500).json({
            error: {
                code: 'INTERNAL_SERVER_ERROR',
                message: 'Failed to open Excel file',
                details: error.message
            }
        });
    }
});
/**
 * Process type directory
 */
async function processTypeDirectory(typeDir, type, files, processLog, statusMap) {
    try {
        // Check if directory exists
        try {
            await fsPromises.access(typeDir, fs.constants.R_OK);
        } catch (accessError) {
            console.error(`Cannot access directory ${typeDir}:`, accessError);
            throw new Error(`Cannot access directory: ${typeDir}. Please check if the directory exists and you have proper permissions.`);
        }

        // Read directory contents
        let companies;
        try {
            companies = await fsPromises.readdir(typeDir);
        } catch (readError) {
            console.error(`Error reading directory ${typeDir}:`, readError);
            throw new Error(`Failed to read directory contents: ${typeDir}`);
        }

        if (!companies || companies.length === 0) {
            ////console.log(`No companies found in directory: ${typeDir}`);
            return;
        }

        // Process all companies in parallel for better performance
        await Promise.all(companies.map(async company => {
            const companyDir = path.join(typeDir, company);
            try {
                const stats = await fsPromises.stat(companyDir);
                if (!stats.isDirectory()) {
                    return; // Skip if not a directory
                }
                await processCompanyDirectory(companyDir, company, type, files, processLog, statusMap);
            } catch (companyError) {
                console.error(`Error processing company ${company}:`, companyError);
                processLog.details.push({
                    company,
                    error: companyError.message,
                    type: 'COMPANY_PROCESSING_ERROR'
                });
                processLog.summary.errors++;
            }
        }));
    } catch (error) {
        console.error(`Error processing ${type} directory:`, error);
        processLog.details.push({
            directory: typeDir,
            error: error.message,
            type: 'DIRECTORY_PROCESSING_ERROR'
        });
        processLog.summary.errors++;
        throw error; // Re-throw to be handled by the main route handler
    }
}

/**
 * Process company directory
 */
async function processCompanyDirectory(companyDir, company, type, files, processLog, statusMap) {
    try {
        // Check if directory exists
        try {
            await fsPromises.access(companyDir, fs.constants.R_OK);
        } catch (accessError) {
            console.error(`Cannot access company directory ${companyDir}:`, accessError);
            throw new Error(`Cannot access directory: ${companyDir}. Please check if the directory exists and you have proper permissions.`);
        }

        // Read directory contents
        let dates;
        try {
            dates = await fsPromises.readdir(companyDir);
        } catch (readError) {
            console.error(`Error reading company directory ${companyDir}:`, readError);
            throw new Error(`Failed to read company directory contents: ${companyDir}`);
        }

        if (!dates || dates.length === 0) {
            ////console.log(`No dates found in company directory: ${companyDir}`);
            return;
        }

        // Process all dates in parallel for better performance
        await Promise.all(dates.map(async date => {
            const dateDir = path.join(companyDir, date);
            try {
                const stats = await fsPromises.stat(dateDir);
                if (!stats.isDirectory()) {
                    return; // Skip if not a directory
                }
                await processDateDirectory(dateDir, date, company, type, files, processLog, statusMap);
            } catch (dateError) {
                console.error(`Error processing date directory ${date}:`, dateError);
                processLog.details.push({
                    company,
                    date,
                    error: dateError.message,
                    type: 'DATE_PROCESSING_ERROR'
                });
                processLog.summary.errors++;
            }
        }));
    } catch (error) {
        console.error(`Error processing company directory ${company}:`, error);
        processLog.details.push({
            company,
            directory: companyDir,
            error: error.message,
            type: 'COMPANY_PROCESSING_ERROR'
        });
        processLog.summary.errors++;
    }
}

/**
 * Process date directory
 */
async function processDateDirectory(dateDir, date, company, type, files, processLog, statusMap) {
    try {
        // Validate and normalize date format
        const normalizedDate = moment(date, ['YYYY-MM-DD', 'YYYY-DD-MM']).format('YYYY-MM-DD');
        if (!normalizedDate || normalizedDate === 'Invalid date') {
            console.error(`Invalid date format in directory: ${date}`);
            processLog.summary.errors++;
            processLog.details.push({
                error: `Invalid date format in directory: ${date}. Expected format: YYYY-MM-DD`
            });
            return;
        }

        await ensureDirectoryExists(dateDir);

        const dirFiles = await fsPromises.readdir(dateDir);

        // Process files in batches to prevent memory overload
        const batchSize = 10;
        for (let i = 0; i < dirFiles.length; i += batchSize) {
            const batch = dirFiles.slice(i, i + batchSize);
            // Process batch of files in parallel
            await Promise.all(batch.map(file =>
                processFile(file, dateDir, normalizedDate, company, type, files, processLog, statusMap)
            ));
        }
    } catch (error) {
        console.error(`Error processing date directory ${date}:`, error);
        processLog.details.push({
            error: error.message,
            type: 'DATE_PROCESSING_ERROR'
        });
        processLog.summary.errors++;
    }
}

/**
 * Validates file name format
 * Format: XX_InvoiceNumber_eInvoice_YYYYMMDDHHMMSS
 * Examples:
 * - 01_ARINV118965_eInvoice_20250127102244.xls (Main format)
 * - 01_IN-LABS-010001_eInvoice_20250128183637.xls (Alternative format)
 * XX - Document type (as per LHDN MyInvois SDK):
 * - 01: Invoice
 * - 02: Credit Note
 * - 03: Debit Note
 * - 04: Refund Note
 * - 11: Self-billed Invoice
 * - 12: Self-billed Credit Note
 * - 13: Self-billed Debit Note
 * - 14: Self-billed Refund Note
 * InvoiceNumber: The actual document number (any length)
 * eInvoice: Fixed text
 * YYYYMMDDHHMMSS: Timestamp
 */
function isValidFileFormat(fileName) {
    try {
        // Remove file extension
        const baseName = path.parse(fileName).name;

        // Define the regex pattern for both formats
        // Updated to be more flexible with invoice number format
        // Allows alphanumeric characters, hyphens, and underscores in the invoice number
        const pattern = /^(0[1-4]|1[1-4])_([A-Z0-9][A-Z0-9-]*[A-Z0-9])_eInvoice_(\d{14})$/;
        const match = baseName.match(pattern);

        if (!match) {
            return false;
        }

        // Extract components
        const [, docType, invoiceNumber, timestamp] = match;

        // Validate document type (already enforced by regex (0[1-4]|1[1-4]))
        const docTypes = {
            '01': 'Invoice',
            '02': 'Credit Note',
            '03': 'Debit Note',
            '04': 'Refund Note',
            '11': 'Self-billed Invoice',
            '12': 'Self-billed Credit Note',
            '13': 'Self-billed Debit Note',
            '14': 'Self-billed Refund Note'
        };

        if (!docTypes[docType]) {
            //////console.log(`Invalid document type: ${docType}`);
            //  ////console.log('Valid document types:');
            Object.entries(docTypes).forEach(([code, type]) => {
                //  ////console.log(`- ${code}: ${type}`);
            });
            return false;
        }

        if (!/^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/.test(invoiceNumber)) {
            return false;
        }

        // Validate timestamp format
        const year = parseInt(timestamp.substring(0, 4));
        const month = parseInt(timestamp.substring(4, 6));
        const day = parseInt(timestamp.substring(6, 8));
        const hour = parseInt(timestamp.substring(8, 10));
        const minute = parseInt(timestamp.substring(10, 12));
        const second = parseInt(timestamp.substring(12, 14));

        const date = new Date(year, month - 1, day, hour, minute, second);

        if (
            date.getFullYear() !== year ||
            date.getMonth() + 1 !== month ||
            date.getDate() !== day ||
            date.getHours() !== hour ||
            date.getMinutes() !== minute ||
            date.getSeconds() !== second ||
            year < 2000 || year > 2100
        ) {
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error validating file name:', error);
        return false;
    }
}

// function extractTotalAmount(data) {
//     try {
//         // Find the row with 'F' identifier (footer row) which contains the total amounts
//         const footerRow = data.find(row => row[0] === 'F');
//         if (footerRow) {
//             // Looking at the raw data, LegalMonetaryTotal_PayableAmount is at index 108
//             const payableAmount = footerRow[108];

//             // Format the amount with currency and handle number formatting
//             if (payableAmount !== undefined && payableAmount !== null) {
//                 const amount = Number(payableAmount);
//                 if (!isNaN(amount)) {
//                     return `MYR ${amount.toLocaleString('en-US', {
//                         minimumFractionDigits: 2,
//                         maximumFractionDigits: 2
//                     })}`;
//                 }
//             }
//         }

//         // Alternative: Look for the amount in the header mapping
//         const headerRow = data.find(row =>
//             row.includes('LegalMonetaryTotal_PayableAmount')
//         );

//         if (headerRow) {
//             const amountIndex = headerRow.indexOf('LegalMonetaryTotal_PayableAmount');
//             // Get the value from the corresponding data row
//             const dataRow = data.find(row => row[0] === 'F');
//             if (dataRow && amountIndex >= 0) {
//                 const amount = Number(dataRow[amountIndex]);
//                 if (!isNaN(amount)) {
//                     return `MYR ${amount.toLocaleString('en-US', {
//                         minimumFractionDigits: 2,
//                         maximumFractionDigits: 2
//                     })}`;
//                 }
//             }
//         }

//         return null;
//     } catch (error) {
//         console.error('Error extracting total amount:', error);
//         console.error('Data structure:', data);
//         return null;
//     }
// }


function extractTotalAmount(data) {
    try {
        // console.log('🔍 [DEBUG] extractTotalAmount - Starting extraction with data length:', data?.length);

        if (!data || !Array.isArray(data) || data.length === 0) {
            //  console.log('❌ [DEBUG] extractTotalAmount - Invalid data structure');
            return null;
        }

        // Initialize variables at function scope
        let amount = null;
        let currency = "MYR"; // Default fallback

        // Method 1: Look for header row to find column mappings
        const headerRow = data.find(
            (row) =>
                Array.isArray(row) &&
                row.some(
                    (cell) =>
                        typeof cell === "string" &&
                        (cell.includes("LegalMonetaryTotal_PayableAmount") ||
                            cell.includes("Total Payable Amount"))
                )
        );

        let amountIndex = -1;
        let currencyIndex = -1;

        if (headerRow) {
            // console.log('🔍 [DEBUG] extractTotalAmount - Found header row');

            // Find amount column index with priority order
            amountIndex = headerRow.findIndex(
                (cell) =>
                    typeof cell === "string" &&
                    cell.includes("LegalMonetaryTotal_PayableAmount")
            );

            if (amountIndex === -1) {
                amountIndex = headerRow.findIndex(
                    (cell) => typeof cell === "string" && cell.includes("Total Payable Amount")
                );
            }

            if (amountIndex === -1) {
                amountIndex = headerRow.findIndex(
                    (cell) => typeof cell === "string" && cell.includes("LegalMonetaryTotal_PayableAmount")
                );
            }

            // Find currency column index
            currencyIndex = headerRow.findIndex(
                (cell) =>
                    typeof cell === "string" &&
                    (cell.includes("DocumentCurrencyCode") ||
                        cell.includes("Currency") ||
                        cell.includes("CurrencyCode"))
            );

            //console.log('🔍 [DEBUG] extractTotalAmount - Column indices - Amount:', amountIndex, 'Currency:', currencyIndex);
        }

        // Method 2: Find the footer row with 'F' identifier
        const footerRow = data.find((row) => Array.isArray(row) && row[0] === "F");

        if (footerRow) {
            // console.log('🔍 [DEBUG] extractTotalAmount - Found footer row with length:', footerRow.length);

            // Try to get amount from mapped index first
            if (amountIndex >= 0 && footerRow[amountIndex] !== undefined) {
                amount = footerRow[amountIndex];
                // console.log('🔍 [DEBUG] extractTotalAmount - Amount from mapped index:', amount);
            } else {
                // Improved fallback: Look for amounts in specific known positions first
                // __EMPTY_69 is typically LegalMonetaryTotal_PayableAmount (index 69)
                if (footerRow[69] && Number(footerRow[69]) > 0) {
                    amount = Number(footerRow[69]);
                    //   console.log(
                    //     "🔍 [DEBUG] extractTotalAmount - Amount found at __EMPTY_69 (index 69):",
                    //     amount
                    //   );
                } else if (
                    footerRow.LegalMonetaryTotal &&
                    Number(footerRow.LegalMonetaryTotal) > 0
                ) {
                    amount = Number(footerRow.LegalMonetaryTotal);
                    //  console.log('🔍 [DEBUG] extractTotalAmount - Amount found in LegalMonetaryTotal:', amount);
                } else {
                    // Last resort: Search for reasonable amounts (> 10 to avoid exchange rates)
                    for (let i = 60; i < footerRow.length; i++) {
                        // Start from index 60 to skip early columns
                        const cell = footerRow[i];
                        if (cell !== null && cell !== undefined && cell !== "") {
                            const numericValue = Number(cell);
                            if (!isNaN(numericValue) && numericValue >= 10) {
                                // Minimum amount threshold
                                amount = numericValue;
                                //   console.log('🔍 [DEBUG] extractTotalAmount - Amount found at index', i, ':', amount);
                                break;
                            }
                        }
                    }
                }
            }

            // Try to get currency from mapped index
            if (currencyIndex >= 0 && footerRow[currencyIndex]) {
                currency = footerRow[currencyIndex];
                // console.log('🔍 [DEBUG] extractTotalAmount - Currency from mapped index:', currency);
            } else {
                // Check for currency in __EMPTY_6 position (DocumentCurrencyCode)
                if (
                    footerRow[6] &&
                    typeof footerRow[6] === "string" &&
                    /^[A-Z]{3}$/.test(footerRow[6])
                ) {
                    currency = footerRow[6];
                    //  console.log('🔍 [DEBUG] extractTotalAmount - Currency found at __EMPTY_6 (index 6):', currency);
                } else {
                    // Fallback: Look for currency in header row or use pattern matching
                    const headerCurrencyRow = data.find(
                        (row) => Array.isArray(row) && row[0] === "H"
                    );

                    if (headerCurrencyRow) {
                        for (let i = 0; i < headerCurrencyRow.length; i++) {
                            const cell = headerCurrencyRow[i];
                            if (typeof cell === "string" && /^[A-Z]{3}$/.test(cell.trim())) {
                                currency = cell.trim();
                                //   console.log('🔍 [DEBUG] extractTotalAmount - Currency found in header:', currency);
                                break;
                            }
                        }
                    }
                }
            }

            // Format and return the amount
            if (amount !== null && amount !== undefined) {
                const numericAmount = Number(amount);
                if (!isNaN(numericAmount)) {
                    const formattedAmount = `${currency} ${numericAmount.toLocaleString(
                        "en-US",
                        {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                        }
                    )}`;
                    // console.log('✅ [DEBUG] extractTotalAmount - Final result:', formattedAmount);
                    return formattedAmount;
                }
            }
        }

        // Method 2.5: Handle object-based data (when Excel is parsed as objects)
        if (
            !amount &&
            data.length > 0 &&
            typeof data[0] === "object" &&
            !Array.isArray(data[0])
        ) {
            // console.log('🔍 [DEBUG] extractTotalAmount - Trying object-based data extraction');

            // Look for footer row in object format
            const footerRowObj = data.find(
                (row) => row.__EMPTY === "F" || row.rowType === "F"
            );

            if (footerRowObj) {
                //  console.log('🔍 [DEBUG] extractTotalAmount - Found footer row object');

                // Try alternative amount index first
                if (alternativeAmountIndex && footerRowObj[alternativeAmountIndex]) {
                    amount = Number(footerRowObj[alternativeAmountIndex]);
                    //   console.log('🔍 [DEBUG] extractTotalAmount - Amount from alternative index:', amount);
                } else if (footerRowObj.__EMPTY_69) {
                    amount = Number(footerRowObj.__EMPTY_69);
                    //   console.log('🔍 [DEBUG] extractTotalAmount - Amount from __EMPTY_69:', amount);
                } else if (footerRowObj.LegalMonetaryTotal) {
                    amount = Number(footerRowObj.LegalMonetaryTotal);
                    //   console.log('🔍 [DEBUG] extractTotalAmount - Amount from LegalMonetaryTotal:', amount);
                }

                // Get currency from object
                if (
                    footerRowObj.__EMPTY_6 &&
                    typeof footerRowObj.__EMPTY_6 === "string"
                ) {
                    currency = footerRowObj.__EMPTY_6;
                    //  console.log('🔍 [DEBUG] extractTotalAmount - Currency from object __EMPTY_6:', currency);
                }

                if (amount && !isNaN(amount)) {
                    const formattedAmount = `${currency} ${amount.toLocaleString(
                        "en-US",
                        {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                        }
                    )}`;
                    //  console.log('✅ [DEBUG] extractTotalAmount - Object method result:', formattedAmount);
                    return formattedAmount;
                }
            }
        }

        // Method 3: Alternative search patterns for different Excel formats
        // console.log('🔍 [DEBUG] extractTotalAmount - Trying alternative search patterns');

        // Look for rows containing total amounts with different patterns
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            if (!Array.isArray(row)) continue;

            // Check if this row contains amount-like data
            for (let j = 0; j < row.length; j++) {
                const cell = row[j];
                if (cell !== null && cell !== undefined) {
                    const numericValue = Number(cell);
                    // Look for reasonable invoice amounts (between 0.01 and 999999999)
                    if (
                        !isNaN(numericValue) &&
                        numericValue >= 0.01 &&
                        numericValue <= 999999999
                    ) {
                        // console.log('🔍 [DEBUG] extractTotalAmount - Found potential amount:', numericValue, 'at row', i, 'col', j);

                        // Try to find currency in the same row or nearby rows
                        currency = "MYR"; // Reset to default

                        // Check same row for currency
                        for (let k = 0; k < row.length; k++) {
                            const currencyCell = row[k];
                            if (
                                typeof currencyCell === "string" &&
                                /^[A-Z]{3}$/.test(currencyCell.trim())
                            ) {
                                currency = currencyCell.trim();
                                break;
                            }
                        }

                        const formattedAmount = `${currency} ${numericValue.toLocaleString(
                            "en-US",
                            {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                            }
                        )}`;
                        // console.log('✅ [DEBUG] extractTotalAmount - Alternative method result:', formattedAmount);
                        return formattedAmount;
                    }
                }
            }
        }

        // console.log('❌ [DEBUG] extractTotalAmount - No valid amount found');
        return null;
    } catch (error) {
        console.error("❌ [ERROR] extractTotalAmount - Error:", error);
        console.error("Data structure sample:", data?.slice(0, 3));
        return null;
    }
}

/**
 * Helper function to extract currency information from Excel data
 */
function extractCurrencyInfo(data) {
    try {
        //console.log('🔍 [DEBUG] extractCurrencyInfo - Starting currency extraction');

        if (!data || !Array.isArray(data) || data.length === 0) {
            //   console.log('❌ [DEBUG] extractCurrencyInfo - Invalid data structure');
            return "MYR";
        }

        // Method 1: Look for currency in header row (H identifier)
        const headerRow = data.find((row) => Array.isArray(row) && row[0] === "H");
        if (headerRow) {
            for (let i = 0; i < headerRow.length; i++) {
                const cell = headerRow[i];
                if (typeof cell === "string" && /^[A-Z]{3}$/.test(cell.trim())) {
                    const currency = cell.trim();
                    //     console.log('✅ [DEBUG] extractCurrencyInfo - Found currency in header:', currency);
                    return currency;
                }
            }
        }

        // Method 2: Look for currency in column headers
        const columnHeaderRow = data.find(
            (row) =>
                Array.isArray(row) &&
                row.some(
                    (cell) =>
                        typeof cell === "string" && cell.includes("DocumentCurrencyCode")
                )
        );

        if (columnHeaderRow) {
            const currencyIndex = columnHeaderRow.findIndex(
                (cell) =>
                    typeof cell === "string" && cell.includes("DocumentCurrencyCode")
            );

            if (currencyIndex >= 0) {
                // Look for the currency value in data rows
                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    if (Array.isArray(row) && row[currencyIndex]) {
                        const currency = row[currencyIndex];
                        if (
                            typeof currency === "string" &&
                            /^[A-Z]{3}$/.test(currency.trim())
                        ) {
                            //  console.log('✅ [DEBUG] extractCurrencyInfo - Found currency in data:', currency);
                            return currency.trim();
                        }
                    }
                }
            }
        }

        // Method 3: Search all rows for currency patterns
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            if (!Array.isArray(row)) continue;

            for (let j = 0; j < row.length; j++) {
                const cell = row[j];
                if (typeof cell === "string") {
                    const trimmed = cell.trim();
                    // Check for common currency codes
                    if (
                        /^(USD|EUR|GBP|SGD|MYR|JPY|CNY|AUD|CAD|CHF|HKD|THB|INR|KRW)$/.test(
                            trimmed
                        )
                    ) {
                        // console.log('✅ [DEBUG] extractCurrencyInfo - Found currency pattern:', trimmed);
                        return trimmed;
                    }
                }
            }
        }

        //    console.log('🔍 [DEBUG] extractCurrencyInfo - No currency found, defaulting to MYR');
        return "MYR";
    } catch (error) {
        console.error("❌ [ERROR] extractCurrencyInfo - Error:", error);
        return "MYR";
    }
}
/**
 * Helper function to extract buyer information
 */
function extractSupplierInfo(data) {
    ////console.log('Data structure:', data);
    //console.log('Data structure:', data[3]);
    try {
        return {
            registrationName: data[3]?.[29] || null,
        };
    } catch (error) {
        console.error('Error extracting buyer info:', error);
        return {};
    }
}


/**
 * Helper function to extract buyer information
 */
function extractBuyerInfo(data) {
    try {
        return {
            registrationName: data[3]?.[41] || null
        };
    } catch (error) {
        console.error('Error extracting buyer info:', error);
        return {};
    }
}

/**
 * Helper function to extract dates
 */
function extractDates(data) {
    try {
        // Look for date in the header row (usually row 3)
        let issueDate = null;
        let issueTime = null;

        if (data && data.length > 0) {
            // Try to find the date in the data array
            for (const row of data) {
                if (row && (row.IssueDate || row.Issue_Date || row.issueDate)) {
                    issueDate = row.IssueDate || row.Issue_Date || row.issueDate;
                    break;
                }
            }

            // If no date found in standard fields, try to find it in the raw data
            if (!issueDate && data[2] && typeof data[2] === 'object') {
                // Look for date in specific columns that might contain the date
                const possibleDateFields = Object.entries(data[2]);
                for (const [key, value] of possibleDateFields) {
                    // Skip if value is not a string or number, or if it's a single character
                    if (!value || (typeof value !== 'string' && typeof value !== 'number') ||
                        (typeof value === 'string' && value.length <= 1)) {
                        continue;
                    }

                    // Try to parse as date with explicit format detection
                    let parsed;
                    if (typeof value === 'string') {
                        // Try common date formats
                        if (value.match(/^\d{4}-\d{2}-\d{2}$/)) {
                            // YYYY-MM-DD
                            parsed = moment(value, 'YYYY-MM-DD');
                        } else if (value.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                            // MM/DD/YYYY
                            parsed = moment(value, 'MM/DD/YYYY');
                        } else if (value.match(/^\d{2}-\d{2}-\d{4}$/)) {
                            // MM-DD-YYYY
                            parsed = moment(value, 'MM-DD-YYYY');
                        } else if (value.match(/^\d{8}$/)) {
                            // YYYYMMDD
                            parsed = moment(value, 'YYYYMMDD');
                        } else if (value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/) || value.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)) {
                            // Only try to parse as ISO date if it looks like an ISO date
                            parsed = moment(value);
                        }
                        // Don't try to parse other string values as dates
                    } else {
                        // For numbers, try to convert to string first
                        const strValue = String(value);

                        // Only try to parse as date if it looks like a date
                        // Check if it's a valid 8-digit date (YYYYMMDD)
                        if (strValue.length === 8 && /^\d{8}$/.test(strValue)) {
                            // Check if it's a plausible date (year between 1900 and 2100)
                            const year = parseInt(strValue.substring(0, 4), 10);
                            if (year >= 1900 && year <= 2100) {
                                parsed = moment(strValue, 'YYYYMMDD');
                            }
                        }
                        // Check if it's a Unix timestamp (10 or 13 digits)
                        else if ((strValue.length === 10 || strValue.length === 13) && /^\d+$/.test(strValue)) {
                            parsed = moment(parseInt(strValue, 10));
                        }
                        // Don't try to parse other numeric values as dates
                    }

                    if (parsed && parsed.isValid()) {
                        issueDate = parsed.format('YYYY-MM-DD');
                        break;
                    }
                }
            }
        }

        // If still no date found, try to extract from filename
        if (!issueDate) {
            const fileName = data.fileName || '';
            const match = fileName.match(/_(\d{8})/);
            if (match && match[1]) {
                const dateStr = match[1];
                // Use explicit format for date parsing
                const parsed = moment(dateStr, 'YYYYMMDD');
                if (parsed.isValid()) {
                    issueDate = parsed.format('YYYY-MM-DD');
                }
            }
        }

        // If still no date, use the directory date
        if (!issueDate && data.date) {
            // Try to parse the directory date with explicit format
            let dirDate;
            if (typeof data.date === 'string') {
                if (data.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    dirDate = moment(data.date, 'YYYY-MM-DD');
                } else if (data.date.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                    dirDate = moment(data.date, 'MM/DD/YYYY');
                } else if (data.date.match(/^\d{2}-\d{2}-\d{4}$/)) {
                    dirDate = moment(data.date, 'MM-DD-YYYY');
                } else if (typeof data.date === 'string' && data.date.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/) ||
                    typeof data.date === 'string' && data.date.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)) {
                    // Only try to parse as ISO date if it looks like an ISO date
                    dirDate = moment(data.date);
                } else if (data.date instanceof Date) {
                    // If it's already a Date object
                    dirDate = moment(data.date);
                }
                // Don't try to parse other values
            } else if (data.date instanceof Date) {
                // If it's already a Date object
                dirDate = moment(data.date);
            }
            // Don't try to parse other values

            if (dirDate && dirDate.isValid()) {
                issueDate = dirDate.format('YYYY-MM-DD');
            }
        }

        return {
            issueDate,
            issueTime: issueTime || '00:00:00'
        };
    } catch (error) {
        console.error('Error extracting dates:', error);
        return {
            issueDate: null,
            issueTime: null
        };
    }
}

/**
 *
 * Process individual file
 */
async function processFile(file, dateDir, date, company, type, files, processLog, statusMap) {
    processLog.summary.total++;
    const logEntry = { file, valid: false, error: null };

    try {
        // Check if it's an Excel file
        if (!file.match(/\.(xls|xlsx)$/i)) {
            logEntry.error = {
                code: 'INVALID_FILE_TYPE',
                message: 'Not an Excel file',
                details: 'Only .xls and .xlsx files are supported'
            };
            processLog.summary.invalid++;
            processLog.details.push(logEntry);
            return;
        }

        // Check file name format
        if (!isValidFileFormat(file)) {
            processLog.summary.invalid++;
            logEntry.error = {
                code: 'INVALID_FILE_FORMAT',
                message: 'Invalid file name format',
                details: 'File name must follow the format: XX_InvoiceNumber_eInvoice_YYYYMMDDHHMMSS'
            };
            processLog.details.push(logEntry);
            return;
        }

        const filePath = path.join(dateDir, file);
        const stats = await fsPromises.stat(filePath);
        const mtimeMs = stats.mtimeMs || new Date(stats.mtime).getTime();

        const baseName = path.parse(file).name;
        const [docType, invoiceNumber] = baseName.split('_');

        const submissionStatus = statusMap.get(file) || (invoiceNumber ? statusMap.get(invoiceNumber) : null);
        const cachedDisplay = getCachedExcelDisplayFields(filePath, mtimeMs);

        const supplierName = submissionStatus?.Supplier || cachedDisplay?.supplierInfo?.registrationName || null;
        const receiverName = submissionStatus?.Receiver || cachedDisplay?.buyerInfo?.registrationName || null;
        const totalAmount = submissionStatus?.Amount || cachedDisplay?.totalAmount || null;
        const supplierInfo = supplierName ? { registrationName: supplierName } : (cachedDisplay?.supplierInfo || { registrationName: null });
        const buyerInfo = receiverName ? { registrationName: receiverName } : (cachedDisplay?.buyerInfo || { registrationName: null });
        const currencyInfo = cachedDisplay?.currency || null;

        files.push({
            type,
            company,
            date,
            fileName: file,
            filePath,
            size: stats.size,
            modifiedTime: stats.mtime,
            uploadedDate: stats.birthtime || stats.mtime,
            issueDate: cachedDisplay?.issueDate || null,
            issueTime: cachedDisplay?.issueTime || null,
            submissionDate: submissionStatus?.DateTimeSent || null,
            lastUpdated: submissionStatus?.DateTimeUpdated || null,
            status: submissionStatus?.SubmissionStatus || 'Pending',
            uuid: submissionStatus?.UUID,
            buyerInfo,
            supplierInfo,
            supplier: supplierName,
            receiver: receiverName,
            totalAmount,
            invoiceNumber,
            documentType: DOC_TYPE_LABELS[docType] || 'Unknown',
            documentTypeCode: docType,
            source: type,
            currency: currencyInfo,
            documentCurrency: currencyInfo,
            currencyCode: currencyInfo,
            documentCurrencyCode: currencyInfo,
            needsHydrate: needsExcelHydrate({ supplierInfo, buyerInfo, totalAmount })
        });

        processLog.summary.valid++;
        logEntry.valid = true;

    } catch (error) {
        processLog.summary.errors++;
        logEntry.error = {
            code: 'PROCESSING_ERROR',
            message: error.message,
            details: error.stack
        };
        console.error(`Error processing file ${file}:`, error);
    }

    processLog.details.push(logEntry);
}

/**
 * Generate JSON preview for document before submission
 */
router.post('/:fileName/generate-preview', async (req, res) => {
    try {
        const { fileName } = req.params;
        const { type, company, date, version } = req.body;

        // Validate all required parameters with more context
        const paramValidation = [
            { name: 'fileName', value: fileName, description: 'Excel file name' },
            { name: 'type', value: type, description: 'Document type (e.g., Manual)' },
            { name: 'company', value: company, description: 'Company identifier' },
            { name: 'date', value: date, description: 'Document date' },
            { name: 'version', value: version, description: 'LHDN version (e.g., 1.0, 1.1)' }
        ];

        const missingParams = paramValidation
            .filter(param => !param.value)
            .map(param => ({
                name: param.name,
                description: param.description
            }));

        if (missingParams.length > 0) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: `Missing required parameters: ${missingParams.map(p => p.name).join(', ')}`,
                    details: missingParams,
                    help: 'Please ensure all required parameters are provided in the request body'
                }
            });
        }

        // Initialize LHDNSubmitter
        const submitter = new LHDNSubmitter(req);

        // Get and process document data
        const processedData = await submitter.getProcessedData(fileName, type, company, date);

        // Ensure processedData is valid before mapping
        if (!processedData || !Array.isArray(processedData) || processedData.length === 0) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'PROCESSING_ERROR',
                    message: 'Failed to process Excel data - no valid documents found'
                }
            });
        }

        // Map to LHDN format
        let lhdnJson;
        try {
            lhdnJson = mapToLHDNFormat(processedData, version);
        } catch (mappingError) {
            if (mappingError instanceof LhdnMappingError) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: mappingError.code,
                        message: mappingError.message,
                        details: [{
                            code: mappingError.code,
                            message: mappingError.message,
                            target: mappingError.target,
                            propertyPath: mappingError.propertyPath
                        }]
                    }
                });
            }
            throw mappingError;
        }
        if (!lhdnJson) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'MAPPING_ERROR',
                    message: 'Failed to map data to LHDN format'
                }
            });
        }

        // Extract invoice number from processed data
        const invoice_number = processedData[0]?.header?.invoiceNo || 'Unknown';

        // Extract summary information
        const summary = {
            invoiceNumber: invoice_number,
            documentType: processedData[0]?.header?.invoiceType || 'Unknown',
            issueDate: processedData[0]?.header?.issueDate?.[0]?._ || 'Unknown',
            supplier: {
                name: processedData[0]?.supplier?.name || 'Unknown',
                id: processedData[0]?.supplier?.id || 'Unknown',
                address: processedData[0]?.supplier?.address?.line || 'Unknown'
            },
            buyer: {
                name: processedData[0]?.buyer?.name || 'Unknown',
                id: processedData[0]?.buyer?.id || 'Unknown',
                address: processedData[0]?.buyer?.address?.line || 'Unknown'
            },
            totalAmount: processedData[0]?.summary?.amounts?.payableAmount || 'Unknown',
            currency: processedData[0]?.header?.documentCurrencyCode || 'MYR',
            itemCount: processedData[0]?.items?.length || 0
        };

        // Return both the summary and the full JSON
        return res.json({
            success: true,
            summary,
            lhdnJson,
            docNum: invoice_number
        });

    } catch (error) {
        console.error('Error generating preview:', error);

        // Handle specific data processing errors
        if (error.message && error.message.includes('trim is not a function')) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'DATA_PROCESSING_ERROR',
                    message: 'Error processing Excel data - invalid data format detected',
                    details: 'Some address fields contain invalid data types. Please ensure all address fields contain text values.'
                }
            });
        }

        // Handle file not found errors specifically
        if (error.message && error.message.includes('File not found')) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'FILE_NOT_FOUND',
                    message: error.message,
                    details: 'The requested file could not be found. Please verify the file exists and try again.'
                }
            });
        }

        // Handle network path errors
        if (error.message && error.message.includes('Network path is not accessible')) {
            return res.status(503).json({
                success: false,
                error: {
                    code: 'NETWORK_PATH_ERROR',
                    message: error.message,
                    details: 'The network path is not accessible. Please check your network configuration and connectivity.'
                }
            });
        }

        // Handle directory not found errors
        if (error.message && (error.message.includes('directory not found') || error.message.includes('does not exist'))) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'DIRECTORY_NOT_FOUND',
                    message: error.message,
                    details: 'The required directory structure was not found. Please verify the file organization.'
                }
            });
        }

        // Handle other errors
        return res.status(500).json({
            success: false,
            error: {
                code: 'PREVIEW_ERROR',
                message: error.message || 'An unexpected error occurred while generating preview',
                details: error.stack
            }
        });
    }
});

/**
 * Submit document to LHDN
 */
router.post('/:fileName/submit-to-lhdn', auth.isApiAuthenticated, async (req, res) => {
    try {
        const { fileName } = req.params;
        const { type, company, date, version } = req.body;

        // Log submission start
        await OutboundLoggingService.logSubmissionStart(req, {
            fileName,
            type,
            company,
            date,
            version
        });

        // Authentication is handled by auth.isApiAuthenticated middleware

        // Validate all required parameters with more context
        const paramValidation = [
            { name: 'fileName', value: fileName, description: 'Excel file name' },
            { name: 'type', value: type, description: 'Document type (e.g., Manual)' },
            { name: 'company', value: company, description: 'Company identifier' },
            { name: 'date', value: date, description: 'Document date' },
            { name: 'version', value: version, description: 'LHDN version (e.g., 1.0, 1.1)' }
        ];

        const missingParams = paramValidation
            .filter(param => !param.value)
            .map(param => ({
                name: param.name,
                description: param.description
            }));

        if (missingParams.length > 0) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: `Missing required parameters: ${missingParams.map(p => p.name).join(', ')}`,
                    details: missingParams,
                    help: 'Please ensure all required parameters are provided in the request body'
                }
            });
        }

        // Initialize LHDNSubmitter
        const submitter = new LHDNSubmitter(req);

        // Check for existing submission
        const existingCheck = await submitter.checkExistingSubmission(fileName);
        if (existingCheck.blocked) {
            return res.status(409).json(existingCheck.response);
        }

        try {
            // Get and process document data
            const processedData = await submitter.getProcessedData(fileName, type, company, date);

            // Ensure processedData is valid before mapping
            if (!processedData || !Array.isArray(processedData) || processedData.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'PROCESSING_ERROR',
                        message: 'Failed to process Excel data - no valid documents found'
                    }
                });
            }

            // Map to LHDN format only once
            let lhdnJson;
            try {
                lhdnJson = mapToLHDNFormat(processedData, version);
            } catch (mappingError) {
                if (mappingError instanceof LhdnMappingError) {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: mappingError.code,
                            message: mappingError.message,
                            details: [{
                                code: mappingError.code,
                                message: mappingError.message,
                                target: mappingError.target,
                                propertyPath: mappingError.propertyPath
                            }]
                        }
                    });
                }
                throw mappingError;
            }
            if (!lhdnJson) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'MAPPING_ERROR',
                        message: 'Failed to map data to LHDN format'
                    }
                });
            }

            // Prepare document for submission
            const { payload, invoice_number } = await submitter.prepareDocumentForSubmission(lhdnJson, version);
            if (!payload) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'PREPARATION_ERROR',
                        message: 'Failed to prepare document for submission'
                    }
                });
            }

            // Submit to LHDN using the session token
            const result = await submitter.submitToLHDNDocument(payload.documents);

            // Process result and update status
            if (result.status === 'failed') {
                // Special handling for TIN mismatch error
                if (result.error?.code === 'TIN_MISMATCH') {
                    //console.log('TIN mismatch detected in LHDN response:', JSON.stringify(result, null, 2));

                    await submitter.updateSubmissionStatus({
                        invoice_number,
                        uuid: 'NA',
                        submissionUid: 'NA',
                        fileName,
                        filePath: processedData.filePath || fileName,
                        status: 'Failed',
                        error: 'TIN mismatch between authenticated user and document',
                        type,
                        company,
                        date
                    });

                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'TIN_MISMATCH',
                            message: 'The Tax Identification Number (TIN) in the document does not match the TIN of the authenticated user.',
                            details: [
                                {
                                    code: 'TIN_MISMATCH',
                                    message: 'The TIN in the document must match the TIN of the authenticated user. Please verify the document content or log in with the correct user account.',
                                    target: invoice_number
                                }
                            ]
                        },
                        docNum: invoice_number
                    });
                }

                // Handle validation errors from LHDN
                if (result.error?.error?.details) {
                    const errorDetails = result.error.error.details;
                    await submitter.updateSubmissionStatus({
                        invoice_number,
                        uuid: 'NA',
                        submissionUid: 'NA',
                        fileName,
                        filePath: processedData.filePath || fileName,
                        status: 'Failed',
                        error: JSON.stringify(errorDetails),
                        type,
                        company,
                        date
                    });

                    return res.status(400).json({
                        success: false,
                        error: errorDetails,
                        docNum: invoice_number
                    });
                }

                // Handle server errors (500)
                if (result.error?.response?.status === 500) {
                    const errorMessage = result.error.response.data?.message || 'Internal server error';
                    const activityId = result.error.response.data?.activityId;

                    await submitter.updateSubmissionStatus({
                        invoice_number,
                        uuid: 'NA',
                        submissionUid: 'NA',
                        fileName,
                        filePath: processedData.filePath || fileName,
                        status: 'Failed',
                        error: JSON.stringify({
                            message: errorMessage,
                            activityId,
                            type: 'SERVER_ERROR'
                        }),
                        type,
                        company,
                        date
                    });

                    return res.status(500).json({
                        success: false,
                        error: {
                            code: 'LHDN_SERVER_ERROR',
                            message: errorMessage,
                            activityId,
                            details: 'LHDN server encountered an error. Please try again later or contact support if the issue persists.'
                        },
                        docNum: invoice_number
                    });
                }
            }

            if (!result.data) {
                // Before throwing an error, check if there are rejected documents in the result
                if (result.status === 'failed' && result.error) {
                    // There are validation errors, show them to the user
                    const errorDetails = result.error;
                    console.error('LHDN Error:', errorDetails);

                    return res.status(400).json({
                        success: false,
                        error: {
                            code: errorDetails.code || 'VALIDATION_ERROR',
                            message: errorDetails.message || 'LHDN validation failed',
                            details: errorDetails.details || errorDetails
                        },
                        docNum: invoice_number,
                        rejectedDocuments: errorDetails.details ? [errorDetails.details] : []
                    });
                }

                if (result.status === 'success' && result.data === undefined) {
                    // This is a special case where the result status is success but no data is present
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'LHDN_VALIDATION_ERROR',
                            message: result.error?.message || 'LHDN validation error',
                            details: result.error?.details || 'Document failed validation at LHDN'
                        }
                    });
                }

                // Log the full result for debugging
                console.error('LHDN Error: Invalid response structure', JSON.stringify(result, null, 2));

                return res.status(500).json({
                    success: false,
                    error: {
                        code: 'INVALID_RESPONSE',
                        message: 'Invalid response from LHDN server: No data received',
                        details: 'The LHDN server returned a response without the expected data structure'
                    },
                    docNum: invoice_number
                });
            }

            if (result.data?.acceptedDocuments?.length > 0) {
                const acceptedDoc = result.data.acceptedDocuments[0];
                const submissionUid = result.data.submissionUid;

                // Prepare status data
                const statusData = {
                    invoice_number,
                    uuid: acceptedDoc.uuid,
                    submissionUid: submissionUid,
                    fileName,
                    filePath: processedData.filePath || fileName,
                    status: 'Submitted',
                    type,
                    company,
                    date
                };

                // First update the submission status in database
                await submitter.updateSubmissionStatus(statusData);

                // Log status update
                await OutboundLoggingService.logStatusUpdate(req, statusData);

                // Log successful submission
                await OutboundLoggingService.logSubmissionSuccess(req, result, {
                    fileName,
                    type,
                    company,
                    date,
                    invoiceNumber: invoice_number
                });

                // Then update the Excel file
                const excelUpdateResult = await submitter.updateExcelWithResponse(
                    fileName,
                    type,
                    company,
                    date,
                    acceptedDoc.uuid,
                    invoice_number
                );

                // Start polling for submission status in the background with proper interval
                // This follows the LHDN SDK best practice for polling (3-5 second interval)
                console.log(`Starting delayed polling for ${submissionUid} with 5 second initial delay`);

                // Initial delay of 5 seconds before first poll as recommended by LHDN
                setTimeout(() => {
                    pollSubmissionStatus(submissionUid, fileName, invoice_number, req, type, company, date)
                        .then(pollResult => {
                            console.log(`Polling completed for ${submissionUid}:`, pollResult);
                        })
                        .catch(pollError => {
                            console.error(`Polling error for ${submissionUid}:`, pollError);
                        });
                }, 5000); // 5 second delay

                if (!excelUpdateResult.success) {
                    console.error('Failed to update Excel file:', excelUpdateResult.error);
                    return res.status(500).json({
                        success: false,
                        error: {
                            code: 'EXCEL_UPDATE_ERROR',
                            message: 'Failed to update Excel file',
                            details: excelUpdateResult.error
                        }
                    });
                }

                const response = {
                    success: true,
                    submissionUID: result.data.submissionUid,
                    acceptedDocuments: result.data.acceptedDocuments,
                    docNum: invoice_number,
                    fileUpdates: {
                        success: excelUpdateResult.success,
                        ...(excelUpdateResult.success ?
                            {
                                excelPath: excelUpdateResult.outgoingPath,
                            } :
                            { error: excelUpdateResult.error }
                        )
                    }
                };

                // Invalidate the cache after successful submission
                invalidateFileCache();

                return res.json(response);
            }

            // Handle rejected documents
            if (result.data?.rejectedDocuments?.length > 0) {
                //('Rejected Documents:', JSON.stringify(result.data.rejectedDocuments, null, 2));

                const rejectedDoc = result.data.rejectedDocuments[0];
                await submitter.updateSubmissionStatus({
                    invoice_number,
                    uuid: rejectedDoc.uuid || 'NA',
                    submissionUid: 'NA',
                    fileName,
                    filePath: processedData.filePath || fileName,
                    status: 'Rejected',
                    error: JSON.stringify(rejectedDoc.error || rejectedDoc),
                    type,
                    company,
                    date
                });

                return res.status(400).json({
                    success: false,
                    error: rejectedDoc.error || rejectedDoc,
                    docNum: invoice_number,
                    rejectedDocuments: result.data.rejectedDocuments
                });
            }

            // Update the error handling section
            if (!result.data?.acceptedDocuments?.length && !result.data?.rejectedDocuments?.length) {
                console.error('Full LHDN Response:', JSON.stringify(result, null, 2));

                // Check if there are validation errors in the response
                if (result.data?.errors || result.data?.validationErrors) {
                    const errors = result.data.errors || result.data.validationErrors;
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'VALIDATION_ERROR',
                            message: 'Document validation failed',
                            details: errors
                        },
                        docNum: invoice_number
                    });
                }

                // If we have CF414 phone number validation error in the logs
                if (result.error && result.error.message && result.error.message.includes('Enter valid phone number')) {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'CF414',
                            message: 'Enter valid phone number and the minimum length is 8 characters - SUPPLIER',
                            details: [{
                                code: 'CF414',
                                message: 'Enter valid phone number and the minimum length is 8 characters - SUPPLIER',
                                target: 'ContactNumber',
                                propertyPath: 'Invoice.AccountingSupplierParty.Party.Contact.Telephone'
                            }]
                        },
                        docNum: invoice_number
                    });
                }

                throw new Error(`No documents were accepted or rejected by LHDN. Response: ${JSON.stringify(result.data)}`);
            }

        } catch (processingError) {
            console.error('Error processing document data:', processingError);
            // Handle specific errors as needed
            throw processingError; // Re-throw other errors to be caught by outer catch block
        }

    } catch (error) {
        console.error('=== Submit to LHDN Error ===', {
            error: error.message,
            stack: error.stack
        });

        // Get fileName from params to avoid reference error
        const { fileName } = req.params;
        const { type, company, date } = req.body;

        // Log submission failure
        await OutboundLoggingService.logSubmissionFailure(req, error, {
            fileName,
            type,
            company,
            date,
            invoiceNumber: error.invoice_number || 'unknown'
        });

        // Update status if possible
        if (error.invoice_number) {
            try {
                const statusData = {
                    invoice_number: error.invoice_number,
                    fileName,
                    filePath: error.filePath || fileName,
                    status: 'Failed',
                    error: error.message,
                    type,
                    company,
                    date
                };

                await submitter.updateSubmissionStatus(statusData);

                // Log status update
                await OutboundLoggingService.logStatusUpdate(req, statusData);
            } catch (statusError) {
                console.error('Failed to update status:', statusError);

                // Log status update failure
                await OutboundLoggingService.createLog({
                    description: `Failed to update status for ${error.invoice_number}: ${statusError.message}`,
                    logType: LOG_TYPES.ERROR,
                    module: MODULES.OUTBOUND,
                    action: ACTIONS.STATUS_UPDATE,
                    status: STATUSES.FAILED,
                    details: {
                        invoice_number: error.invoice_number,
                        fileName,
                        originalError: error.message,
                        statusError: statusError.message
                    }
                });
            }
        }

        // Parse error details if they exist in the error object
        let errorDetails = [];

        // Check for structured error details
        if (error.details) {
            errorDetails = Array.isArray(error.details) ? error.details : [error.details];
        }
        // Check for error details in the message (common for LHDN errors)
        else if (error.message && error.message.includes('Enter valid phone number')) {
            errorDetails = [{
                code: 'CF414',
                message: 'Enter valid phone number and the minimum length is 8 characters - SUPPLIER',
                target: 'ContactNumber',
                propertyPath: 'Invoice.AccountingSupplierParty.Party.Contact.Telephone'
            }];
        }
        // Try to extract JSON from the error message if it contains JSON
        else if (error.message && (error.message.includes('{') || error.message.includes('['))) {
            try {
                // Extract JSON from the error message using regex
                const jsonMatch = error.message.match(/(\{.*\}|\[.*\])/s);
                if (jsonMatch) {
                    const parsedJson = JSON.parse(jsonMatch[0]);
                    if (Array.isArray(parsedJson)) {
                        errorDetails = parsedJson;
                    } else if (parsedJson.details) {
                        errorDetails = Array.isArray(parsedJson.details) ? parsedJson.details : [parsedJson.details];
                    } else {
                        errorDetails = [parsedJson];
                    }
                }
            } catch (parseError) {
                console.error('Error parsing JSON from error message:', parseError);
                // If parsing fails, use the original error message
                errorDetails = [{
                    code: 'PARSE_ERROR',
                    message: error.message
                }];
            }
        }

        // Determine appropriate error response
        const errorResponse = {
            success: false,
            error: {
                code: 'SUBMISSION_ERROR',
                message: error.message || 'An unexpected error occurred during submission',
                details: errorDetails.length > 0 ? errorDetails : error.stack
            }
        };

        // Set appropriate status code based on error type
        if (error.response?.status === 401) {
            errorResponse.error.code = 'AUTH_ERROR';
            return res.status(401).json(errorResponse);
        }

        if (error.message.includes('getActiveSAPConfig')) {
            errorResponse.error.code = 'CONFIG_ERROR';
            errorResponse.error.message = 'SAP configuration error: Unable to get active configuration';
            return res.status(500).json(errorResponse);
        }

        // Add document number to the response if available
        if (error.invoice_number) {
            errorResponse.docNum = error.invoice_number;
        }

        res.status(500).json(errorResponse);
    }
});


/**
 * Cancel document
 */
router.post('/:uuid/cancel', async (req, res) => {
    const loggedUser = req.session.user?.username;
    const uuid = req.params.uuid;
    const reason = req.body.reason;

    await logDBOperation(req.app.get('models'), req, `Started cancellation of document ${uuid}`, {
        module: 'OUTBOUND',
        action: 'CANCEL',
        details: { uuid, reason }
    });

    if (!uuid) {
        await logDBOperation(req.app.get('models'), req, 'Missing UUID for document cancellation', {
            module: 'OUTBOUND',
            action: 'CANCEL',
            status: 'FAILED'
        });

        return res.status(400).json({
            success: false,
            message: 'Missing required parameters: uuid'
        });
    }

    try {
        // Get token from AuthorizeToken.ini file
        const { getTokenSession } = require('../../services/token-prisma.service');
        let token;

        try {
            token = await getTokenSession();
        } catch (tokenError) {
            console.error('Error getting token from AuthorizeToken.ini for document cancellation:', tokenError);
            return res.status(401).json({
                success: false,
                error: {
                    code: 'AUTH_ERROR',
                    message: 'Failed to retrieve authentication token',
                    details: tokenError.message
                }
            });
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'AUTH_ERROR',
                    message: 'No LHDN access token available',
                    details: 'Authentication token is missing in AuthorizeToken.ini'
                }
            });
        }

        // Get document details first
        const documentDetails = await getDocumentDetails(uuid, token);
        if (!documentDetails.status === 'success' || !documentDetails.data) {
            throw new Error('Document not found');
        }

        // Cancel the document using the service function
        const cancelResponse = await cancelValidDocumentBySupplier(uuid, reason, token);

        if (cancelResponse.status === 'success') {
            // Update local database statuses
            await Promise.all([
                prisma.wP_OUTBOUND_STATUS.updateMany({
                    where: { UUID: uuid },
                    data: {
                        status: 'Cancelled',
                        date_cancelled: new Date(),
                        cancelled_by: loggedUser,
                        cancellation_reason: reason,
                        updated_at: new Date(),
                    }
                }),
                prisma.wP_INBOUND_STATUS.updateMany({
                    where: { uuid },
                    data: {
                        status: 'Cancelled',
                        dateTimeReceived: new Date().toISOString(),
                    }
                })
            ]);

            await logDBOperation(req.app.get('models'), req, `Successfully cancelled document ${uuid}`, {
                module: 'OUTBOUND',
                action: 'CANCEL',
                status: 'SUCCESS',
                details: { docNum: documentDetails.data.invoice_number }
            });

            return res.json({
                success: true,
                message: 'Invoice cancelled successfully'
            });
        }

        throw new Error('Unexpected response from cancellation API');

    } catch (error) {
        console.error('Error cancelling invoice:', error);
        await logDBOperation(req.app.get('models'), req, `Error cancelling document: ${error.message}`, {
            module: 'OUTBOUND',
            action: 'CANCEL',
            status: 'FAILED',
            error
        });

        // Handle specific error cases
        if (error.response) {
            const errorData = error.response.data;

            // Check if document is already cancelled
            if (errorData?.error?.code === 'ValidationError' &&
                errorData?.error?.details?.some(d => d.message?.includes('already cancelled'))) {

                // Update local status
                await Promise.all([
                    prisma.wP_OUTBOUND_STATUS.updateMany({
                        where: { UUID: uuid },
                        data: { status: 'Cancelled' }
                    }),
                    prisma.wP_INBOUND_STATUS.updateMany({
                        where: { uuid },
                        data: { status: 'Cancelled' }
                    })
                ]);

                return res.json({
                    success: true,
                    message: 'Document was already cancelled'
                });
            }

            // Handle 404 specifically
            if (error.response.status === 404) {
                return res.status(404).json({
                    success: false,
                    message: 'Document not found in LHDN system',
                    error: errorData?.message || 'Resource not found'
                });
            }

            // Handle other API errors
            return res.status(error.response.status).json({
                success: false,
                message: 'Failed to cancel invoice',
                error: errorData?.error?.message || error.message
            });
        }

        // Log the error
        await prisma.wP_LOGS.create({
            data: {
                Description: `Failed to cancel invoice: ${error.message}`,
                CreateTS: new Date().toISOString(),
                LoggedUser: loggedUser || 'System',
                LogType: 'ERROR',
                Module: 'OUTBOUND',
                Action: 'CANCEL',
                Status: 'FAILED'
            }
        });

        return res.status(500).json({
            success: false,
            message: 'Failed to cancel invoice',
            error: error.message
        });
    }
});

router.post('/:fileName/content-consolidated', auth.isApiAuthenticated, async (req, res) => {
    try {
        const { fileName } = req.params;
        const { type, company, date, uuid, submissionUid, filePath: requestFilePath } = req.body;

        // 1. Get and validate SAP configuration
        const config = await getActiveSAPConfig();

        if (!config.success || !config.networkPath) {
            throw new Error('Invalid SAP configuration: ' + (config.error || 'No network path configured'));
        }

        // 2. Validate network path
        const networkValid = await testNetworkPathAccessibility(config.networkPath, {
            serverName: config.domain || '',
            serverUsername: config.username,
            serverPassword: config.password
        });
        // //console.log('\nNetwork Path Validation:', networkValid);

        if (!networkValid.success) {
            throw new Error(`Network path not accessible: ${networkValid.error}`);
        }

        // 3. Construct and validate file path
        const formattedDate = moment(date).format('YYYY-MM-DD');

        // Use the provided filePath if it exists, otherwise construct it using the standard pattern
        let filePath;
        if (requestFilePath) {
            // If a specific file path is provided (for consolidated files)
            if (requestFilePath.startsWith('Incoming/')) {
                // For consolidated files from SFTPRoot_Consolidation
                filePath = path.join('C:\\SFTPRoot_Consolidation', requestFilePath);
            } else {
                // For regular files
                filePath = path.join(config.networkPath, requestFilePath);
            }
        } else {
            // Standard path construction
            filePath = path.join(config.networkPath, type, company, formattedDate, fileName);
        }

        // Check if file exists
        const fileExists = fs.existsSync(filePath);

        if (!fileExists) {
            console.error('\nFile Not Found:', {
                fileName,
                path: filePath,
                type,
                company,
                date: formattedDate
            });

            // Try alternate path for consolidated files if standard path failed
            if (!requestFilePath) {
                const consolidatedPath = path.join('C:\\SFTPRoot_Consolidation', 'Incoming', company, formattedDate, fileName);
                if (fs.existsSync(consolidatedPath)) {
                    filePath = consolidatedPath;
                } else {
                    return res.status(404).json({
                        success: false,
                        error: {
                            code: 'FILE_NOT_FOUND',
                            message: `File not found: ${fileName}`,
                            details: {
                                path: filePath,
                                alternatePathTried: consolidatedPath,
                                type,
                                company,
                                date: formattedDate
                            }
                        }
                    });
                }
            } else {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'FILE_NOT_FOUND',
                        message: `File not found: ${fileName}`,
                        details: {
                            path: filePath,
                            requestedPath: requestFilePath,
                            type,
                            company,
                            date: formattedDate
                        }
                    }
                });
            }
        }

        // 6. Read Excel file
        // //console.log('\nReading Excel file...');
        let workbook;
        try {
            workbook = XLSX.readFile(filePath);
            //console.log('Excel file read successfully');
        } catch (readError) {
            console.error('Error reading Excel file:', readError);
            throw new Error(`Failed to read Excel file: ${readError.message}`);
        }

        // 7. Process Excel data
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(worksheet, {
            raw: true,
            defval: null,
            blankrows: false
        });

        // 8. Process the data
        const processedData = processExcelData(data, { companyIndustry: await lookupCompanyIndustry(company) });
        // //console.log('\nExcel data processed successfully');

        // 9. Create outgoing directory structure
        const outgoingConfig = await getOutgoingConfig();
        const outgoingPath = 'C:\\SFTPRoot_Consolidation\\Outgoing';
        const outgoingBasePath = path.join(outgoingPath, 'LHDN', company, formattedDate);
        await ensureDirectoryExists(outgoingBasePath);

        // 10. Copy the original Excel file to the outgoing directory
        const outgoingFilePath = path.join(outgoingBasePath, fileName);
        await fsPromises.copyFile(filePath, outgoingFilePath);

        // 11. Update the copied Excel file with UUID and submissionUid
        const outgoingWorkbook = XLSX.readFile(outgoingFilePath);
        const outgoingWorksheet = outgoingWorkbook.Sheets[outgoingWorkbook.SheetNames[0]];

        const range = XLSX.utils.decode_range(outgoingWorksheet['!ref']);
        for (let R = 0; R <= range.e.r; ++R) {
            // Update UUID field (_1)
            const uuidCell = XLSX.utils.encode_cell({ r: R, c: 1 }); // Column _1
            if (outgoingWorksheet[uuidCell]) {
                outgoingWorksheet[uuidCell].v = uuid;
                outgoingWorksheet[uuidCell].w = uuid;
            }

            // Update Internal Reference field (_2)
            const refCell = XLSX.utils.encode_cell({ r: R, c: 2 }); // Column _2
            if (outgoingWorksheet[refCell]) {
                outgoingWorksheet[refCell].v = submissionUid;
                outgoingWorksheet[refCell].w = submissionUid;
            }
        }

        // Save the updated workbook
        XLSX.writeFile(outgoingWorkbook, outgoingFilePath);

        res.json({
            success: true,
            content: processedData,
            outgoingPath: outgoingFilePath
        });

    } catch (error) {
        console.error('\nError in file content endpoint:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'READ_ERROR',
                message: 'Failed to read file content',
                details: error.message,
                stack: error.stack
            }
        });
    }
});

router.post('/:fileName/content', auth.isApiAuthenticated, async (req, res) => {
    try {
        const { fileName } = req.params;
        const { type, company, date, uuid, submissionUid } = req.body;

        // 1. Get and validate SAP configuration
        const config = await getActiveSAPConfig();

        if (!config.success || !config.networkPath) {
            throw new Error('Invalid SAP configuration: ' + (config.error || 'No network path configured'));
        }

        // 2. Validate network path
        const networkValid = await testNetworkPathAccessibility(config.networkPath, {
            serverName: config.domain || '',
            serverUsername: config.username,
            serverPassword: config.password
        });
        // //console.log('\nNetwork Path Validation:', networkValid);

        if (!networkValid.success) {
            throw new Error(`Network path not accessible: ${networkValid.error}`);
        }

        // 3. Construct and validate file path
        const formattedDate = moment(date).format('YYYY-MM-DD');
        const filePath = path.join(config.networkPath, type, company, formattedDate, fileName);

        // 4. Check if directories exist
        const typeDir = path.join(config.networkPath, type);
        const companyDir = path.join(typeDir, company);
        const dateDir = path.join(companyDir, formattedDate);

        // Ensure directories exist
        await ensureDirectoryExists(typeDir);
        await ensureDirectoryExists(companyDir);
        await ensureDirectoryExists(dateDir);

        // 5. Check if file exists
        const fileExists = fs.existsSync(filePath);

        if (!fileExists) {
            console.error('\nFile Not Found:', {
                fileName,
                path: filePath,
                type,
                company,
                date: formattedDate
            });
            return res.status(404).json({
                success: false,
                error: {
                    code: 'FILE_NOT_FOUND',
                    message: `File not found: ${fileName}`,
                    details: {
                        path: filePath,
                        type,
                        company,
                        date: formattedDate,
                        directories: {
                            typeDir: fs.existsSync(typeDir),
                            companyDir: fs.existsSync(companyDir),
                            dateDir: fs.existsSync(dateDir)
                        }
                    }
                }
            });
        }

        // 6. Read Excel file
        // //console.log('\nReading Excel file...');
        let workbook;
        try {
            workbook = XLSX.readFile(filePath);
            //console.log('Excel file read successfully');
        } catch (readError) {
            console.error('Error reading Excel file:', readError);
            throw new Error(`Failed to read Excel file: ${readError.message}`);
        }

        // 7. Process Excel data
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(worksheet, {
            raw: true,
            defval: null,
            blankrows: false
        });

        // 8. Process the data
        const processedData = processExcelData(data, { companyIndustry: await lookupCompanyIndustry(company) });
        //console.log('\nExcel data processed successfully');

        // 9. Create outgoing directory structure
        const outgoingConfig = await getOutgoingConfig();
        const outgoingBasePath = path.join(outgoingConfig.networkPath, type, company, formattedDate);
        await ensureDirectoryExists(outgoingBasePath);

        // 10. Copy the original Excel file to the outgoing directory
        const outgoingFilePath = path.join(outgoingBasePath, fileName);
        await fsPromises.copyFile(filePath, outgoingFilePath);

        // 11. Update the copied Excel file with UUID and submissionUid
        const outgoingWorkbook = XLSX.readFile(outgoingFilePath);
        const outgoingWorksheet = outgoingWorkbook.Sheets[outgoingWorkbook.SheetNames[0]];

        const range = XLSX.utils.decode_range(outgoingWorksheet['!ref']);
        for (let R = 0; R <= range.e.r; ++R) {
            // Update UUID field (_1)
            const uuidCell = XLSX.utils.encode_cell({ r: R, c: 1 }); // Column _1
            if (outgoingWorksheet[uuidCell]) {
                outgoingWorksheet[uuidCell].v = uuid;
                outgoingWorksheet[uuidCell].w = uuid;
            }

            // Update Internal Reference field (_2)
            const refCell = XLSX.utils.encode_cell({ r: R, c: 2 }); // Column _2
            if (outgoingWorksheet[refCell]) {
                outgoingWorksheet[refCell].v = submissionUid;
                outgoingWorksheet[refCell].w = submissionUid;
            }
        }

        // Save the updated workbook
        XLSX.writeFile(outgoingWorkbook, outgoingFilePath);

        res.json({
            success: true,
            content: processedData,
            outgoingPath: outgoingFilePath
        });

    } catch (error) {
        console.error('\nError in file content endpoint:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'READ_ERROR',
                message: 'Failed to read file content',
                details: error.message,
                stack: error.stack
            }
        });
    }
});

/**
 * List all files with fixed paths (optimized version using hardcoded paths)
 */
router.get('/list-fixed-paths', auth.isApiAuthenticated, async (req, res) => {
    console.log('Starting list-fixed-paths endpoint');
    const processLog = {
        details: [],
        summary: { total: 0, valid: 0, invalid: 0, errors: 0 }
    };

    try {
        // Use fixed paths instead of getting from configuration
        const incomingPath = 'C:\\SFTPRoot_Consolidation\\Incoming\\PXC Branch';
        const outgoingPath = 'C:\\SFTPRoot_Consolidation\\Outgoing\\LHDN\\PXC';

        console.log('Using fixed paths:');
        console.log('- Incoming:', incomingPath);
        console.log('- Outgoing:', outgoingPath);

        // Get the latest status update timestamp
        console.log('Fetching latest status update');
        const latestStatusUpdate = await prisma.wP_OUTBOUND_STATUS.findFirst({
            select: {
                updated_at: true
            },
            orderBy: {
                updated_at: 'desc'
            }
        });
        console.log('Latest status update:', latestStatusUpdate);

        // Get existing submission statuses
        console.log('Fetching submission statuses');
        const submissionStatuses = await prisma.wP_OUTBOUND_STATUS.findMany({
            select: {
                id: true,
                UUID: true,
                submissionUid: true,
                fileName: true,
                filePath: true,
                invoice_number: true,
                status: true,
                date_submitted: true,
                date_cancelled: true,
                cancellation_reason: true,
                cancelled_by: true,
                updated_at: true
            },
            orderBy: {
                updated_at: 'desc'
            }
        });

        // Create status lookup map
        const statusMap = new Map();
        submissionStatuses.forEach(status => {
            const statusObj = {
                UUID: status.UUID,
                SubmissionUID: status.submissionUid,
                SubmissionStatus: status.status,
                DateTimeSent: status.date_submitted,
                DateTimeUpdated: status.updated_at,
                DateTimeCancelled: status.date_cancelled,
                CancelledReason: status.cancellation_reason,
                CancelledBy: status.cancelled_by,
                FileName: status.fileName,
                DocNum: status.invoice_number
            };

            if (status.fileName) statusMap.set(status.fileName, statusObj);
            if (status.invoice_number) statusMap.set(status.invoice_number, statusObj);
        });

        const files = [];

        // Process incoming directory directly
        console.log('Processing incoming directory');
        try {
            // For consolidated view, we don't need to process by type/company/date
            // Since files are directly in the Incoming directory
            await processDirectoryFlat(incomingPath, 'Incoming', files, processLog, statusMap);
        } catch (dirError) {
            console.error(`Error processing incoming directory:`, dirError);
            // Continue with partial data if there's an error
        }

        // Create a map for latest documents
        console.log('Processing latest documents');
        const latestDocuments = new Map();

        files.forEach(file => {
            const documentKey = file.invoiceNumber || file.fileName;
            const existingDoc = latestDocuments.get(documentKey);

            if (!existingDoc || new Date(file.modifiedTime) > new Date(existingDoc.modifiedTime)) {
                latestDocuments.set(documentKey, file);
            }
        });

        // Convert map to array and merge with status
        const mergedFiles = Array.from(latestDocuments.values()).map(file => {
            const status = statusMap.get(file.fileName) || statusMap.get(file.invoiceNumber);
            const fileStatus = status?.SubmissionStatus || 'Pending';

            return {
                ...file,
                status: fileStatus,
                statusUpdateTime: status?.DateTimeUpdated || null,
                date_submitted: status?.DateTimeSent || null,
                date_cancelled: status?.DateTimeCancelled || null,
                cancellation_reason: status?.CancelledReason || null,
                cancelled_by: status?.CancelledBy || null,
                uuid: status?.UUID || null,
                submissionUid: status?.SubmissionUID || null
            };
        });

        // Sort by modified time
        mergedFiles.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));

        console.log(`Found ${mergedFiles.length} files`);
        console.log('Sending response');
        res.json({
            success: true,
            files: mergedFiles,
            processLog,
            fromCache: false,
            paths: {
                incoming: incomingPath,
                outgoing: outgoingPath
            }
        });

    } catch (error) {
        console.error('Error in list-fixed-paths:', error);
        await logError('Error listing outbound files with fixed paths', error, {
            action: 'LIST_FIXED_PATHS',
            userId: req.user?.id
        });

        res.status(500).json({
            success: false,
            error: error.message,
            processLog,
            stack: error.stack // Include stack trace for debugging
        });
    }
});

/**
 * Process a flat directory structure (no type/company/date hierarchy)
 */
async function processDirectoryFlat(directory, type, files, processLog, statusMap) {
    try {
        // Check if directory exists
        try {
            await fsPromises.access(directory, fs.constants.R_OK);
        } catch (accessError) {
            console.error(`Cannot access directory ${directory}:`, accessError);
            throw new Error(`Cannot access directory: ${directory}. Please check if the directory exists and you have proper permissions.`);
        }

        // Read all files in the directory
        let dirContents;
        try {
            dirContents = await fsPromises.readdir(directory);
        } catch (readError) {
            console.error(`Error reading directory ${directory}:`, readError);
            throw new Error(`Failed to read directory contents: ${directory}`);
        }

        // Process each item
        for (const item of dirContents) {
            const itemPath = path.join(directory, item);

            try {
                const stats = await fsPromises.stat(itemPath);

                // If it's a directory, process recursively
                if (stats.isDirectory()) {
                    await processDirectoryFlat(itemPath, type, files, processLog, statusMap);
                    continue;
                }

                // If it's a file and Excel file, process it
                if (stats.isFile() && item.match(/\.(xls|xlsx)$/i)) {
                    await processFile(item, directory, 'N/A', 'PXC Branch', type, files, processLog, statusMap);
                }
            } catch (itemError) {
                console.error(`Error processing ${itemPath}:`, itemError);
                processLog.details.push({
                    file: item,
                    path: itemPath,
                    error: itemError.message,
                    type: 'ITEM_PROCESSING_ERROR'
                });
                processLog.summary.errors++;
            }
        }

    } catch (error) {
        console.error(`Error processing directory ${directory}:`, error);
        processLog.details.push({
            directory,
            error: error.message,
            type: 'DIRECTORY_PROCESSING_ERROR'
        });
        processLog.summary.errors++;
        throw error;
    }
}

/**
 * Submit document to LHDN
 */
router.post('/:fileName/submit-to-lhdn-consolidated', auth.isApiAuthenticated, async (req, res) => {
    try {

        const { fileName } = req.params;
        const { type, company, date, version } = req.body;

        // Authentication is handled by auth.isApiAuthenticated middleware

        // Validate all required parameters with more context
        const paramValidation = [
            { name: 'fileName', value: fileName, description: 'Excel file name' },
            { name: 'type', value: type, description: 'Document type (e.g., Manual)' },
            { name: 'company', value: company, description: 'Company identifier' },
            { name: 'date', value: date, description: 'Document date' },
            { name: 'version', value: version, description: 'LHDN version (e.g., 1.0, 1.1)' }
        ];

        const missingParams = paramValidation
            .filter(param => !param.value)
            .map(param => ({
                name: param.name,
                description: param.description
            }));

        if (missingParams.length > 0) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: `Missing required parameters: ${missingParams.map(p => p.name).join(', ')}`,
                    details: missingParams,
                    help: 'Please ensure all required parameters are provided in the request body'
                }
            });
        }

        // Initialize LHDNSubmitter
        const submitter = new LHDNSubmitter(req);

        // Check for existing submission
        const existingCheck = await submitter.checkExistingSubmission(fileName);
        if (existingCheck.blocked) {
            return res.status(409).json(existingCheck.response);
        }

        try {
            // Get and process document data
            const processedData = await submitter.getProcessedDataConsolidated(fileName, type, company, date);

            // Ensure processedData is valid before mapping
            if (!processedData || !Array.isArray(processedData) || processedData.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'PROCESSING_ERROR',
                        message: 'Failed to process Excel data - no valid documents found'
                    }
                });
            }

            // Map to LHDN format only once
            let lhdnJson;
            try {
                lhdnJson = mapToLHDNFormat(processedData, version);
            } catch (mappingError) {
                if (mappingError instanceof LhdnMappingError) {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: mappingError.code,
                            message: mappingError.message,
                            details: [{
                                code: mappingError.code,
                                message: mappingError.message,
                                target: mappingError.target,
                                propertyPath: mappingError.propertyPath
                            }]
                        }
                    });
                }
                throw mappingError;
            }
            if (!lhdnJson) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'MAPPING_ERROR',
                        message: 'Failed to map data to LHDN format'
                    }
                });
            }

            // Prepare document for submission
            const { payload, invoice_number } = await submitter.prepareDocumentForSubmission(lhdnJson, version);
            if (!payload) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'PREPARATION_ERROR',
                        message: 'Failed to prepare document for submission'
                    }
                });
            }

            // Submit to LHDN using the session token
            const result = await submitter.submitToLHDNDocument(payload.documents);

            // Process result and update status
            if (result.status === 'failed') {
                // Special handling for TIN mismatch error
                if (result.error?.code === 'TIN_MISMATCH') {
                    //console.log('TIN mismatch detected in LHDN response:', JSON.stringify(result, null, 2));

                    await submitter.updateSubmissionStatus({
                        invoice_number,
                        uuid: 'NA',
                        submissionUid: 'NA',
                        fileName,
                        filePath: processedData.filePath || fileName,
                        status: 'Failed',
                        error: 'TIN mismatch between authenticated user and document'
                    });

                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'TIN_MISMATCH',
                            message: 'The Tax Identification Number (TIN) in the document does not match the TIN of the authenticated user.',
                            details: [
                                {
                                    code: 'TIN_MISMATCH',
                                    message: 'The TIN in the document must match the TIN of the authenticated user. Please verify the document content or log in with the correct user account.',
                                    target: invoice_number
                                }
                            ]
                        },
                        docNum: invoice_number
                    });
                }

                // Handle validation errors from LHDN
                if (result.error?.error?.details) {
                    const errorDetails = result.error.error.details;
                    await submitter.updateSubmissionStatus({
                        invoice_number,
                        uuid: 'NA',
                        submissionUid: 'NA',
                        fileName,
                        filePath: processedData.filePath || fileName,
                        status: 'Failed',
                        error: JSON.stringify(errorDetails)
                    });

                    return res.status(400).json({
                        success: false,
                        error: errorDetails,
                        docNum: invoice_number
                    });
                }

                // Handle server errors (500)
                if (result.error?.response?.status === 500) {
                    const errorMessage = result.error.response.data?.message || 'Internal server error';
                    const activityId = result.error.response.data?.activityId;

                    await submitter.updateSubmissionStatus({
                        invoice_number,
                        uuid: 'NA',
                        submissionUid: 'NA',
                        fileName,
                        filePath: processedData.filePath || fileName,
                        status: 'Failed',
                        error: JSON.stringify({
                            message: errorMessage,
                            activityId,
                            type: 'SERVER_ERROR'
                        })
                    });

                    return res.status(500).json({
                        success: false,
                        error: {
                            code: 'LHDN_SERVER_ERROR',
                            message: errorMessage,
                            activityId,
                            details: 'LHDN server encountered an error. Please try again later or contact support if the issue persists.'
                        },
                        docNum: invoice_number
                    });
                }
            }

            if (!result.data) {
                // Before throwing an error, check if there are rejected documents in the result
                if (result.status === 'failed' && result.error?.details?.error?.details?.length > 0) {
                    // There are validation errors, show them to the user
                    const errorDetails = result.error.details;
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'VALIDATION_ERROR',
                            message: errorDetails.message || 'LHDN validation failed',
                            details: errorDetails
                        },
                        docNum: invoice_number,
                        rejectedDocuments: [errorDetails]
                    });
                }

                if (result.status === 'success' && result.data === undefined) {
                    // This is a special case where the result status is success but no data is present
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'LHDN_VALIDATION_ERROR',
                            message: result.error?.message || 'LHDN validation error',
                            details: result.error?.details || 'Document failed validation at LHDN'
                        }
                    });
                }

                throw new Error('Invalid response from LHDN server: No data received');
            }

            if (result.data?.acceptedDocuments?.length > 0) {
                const acceptedDoc = result.data.acceptedDocuments[0];
                const submissionUid = result.data.submissionUid;

                // First update the submission status in database
                await submitter.updateSubmissionStatus({
                    invoice_number,
                    uuid: acceptedDoc.uuid,
                    submissionUid: submissionUid,
                    fileName,
                    filePath: processedData.filePath || fileName,
                    status: 'Submitted',
                    type,
                    company,
                    date
                });

                // Then update the Excel file
                const excelUpdateResult = await submitter.updateExcelWithResponseConsolidated(
                    fileName,
                    type,
                    company,
                    date,
                    acceptedDoc.uuid,
                    acceptedDoc.invoiceCodeNumber,
                    invoice_number
                );

                // Start polling for submission status in the background with proper interval
                // This follows the LHDN SDK best practice for polling (3-5 second interval)
                console.log(`Starting delayed polling for ${submissionUid} with 5 second initial delay`);

                // Initial delay of 5 seconds before first poll as recommended by LHDN
                setTimeout(() => {
                    pollSubmissionStatus(submissionUid, fileName, invoice_number, req, type, company, date)
                        .then(pollResult => {
                            console.log(`Polling completed for ${submissionUid}:`, pollResult);
                        })
                        .catch(pollError => {
                            console.error(`Polling error for ${submissionUid}:`, pollError);
                        });
                }, 5000); // 5 second delay

                if (!excelUpdateResult.success) {
                    console.error('Failed to update Excel file:', excelUpdateResult.error);
                    return res.status(500).json({
                        success: false,
                        error: {
                            code: 'EXCEL_UPDATE_ERROR',
                            message: 'Failed to update Excel file',
                            details: excelUpdateResult.error
                        }
                    });
                }

                const response = {
                    success: true,
                    submissionUID: result.data.submissionUid,
                    acceptedDocuments: result.data.acceptedDocuments,
                    docNum: invoice_number,
                    fileUpdates: {
                        success: excelUpdateResult.success,
                        ...(excelUpdateResult.success ?
                            {
                                excelPath: excelUpdateResult.outgoingPath,
                            } :
                            { error: excelUpdateResult.error }
                        )
                    }
                };

                // Invalidate the cache after successful submission
                invalidateFileCache();

                return res.json(response);
            }

            // Handle rejected documents
            if (result.data?.rejectedDocuments?.length > 0) {
                //('Rejected Documents:', JSON.stringify(result.data.rejectedDocuments, null, 2));

                const rejectedDoc = result.data.rejectedDocuments[0];
                await submitter.updateSubmissionStatus({
                    invoice_number,
                    uuid: rejectedDoc.uuid || 'NA',
                    submissionUid: 'NA',
                    fileName,
                    filePath: processedData.filePath || fileName,
                    status: 'Rejected',
                    error: JSON.stringify(rejectedDoc.error || rejectedDoc),
                    type,
                    company,
                    date
                });

                return res.status(400).json({
                    success: false,
                    error: rejectedDoc.error || rejectedDoc,
                    docNum: invoice_number,
                    rejectedDocuments: result.data.rejectedDocuments
                });
            }

            // Update the error handling section
            if (!result.data?.acceptedDocuments?.length && !result.data?.rejectedDocuments?.length) {
                ////console.log('Full LHDN Response:', JSON.stringify(result, null, 2));
                throw new Error(`No documents were accepted or rejected by LHDN. Response: ${JSON.stringify(result.data)}`);
            }

        } catch (processingError) {
            console.error('Error processing document data:', processingError);
            // Handle specific errors as needed
            throw processingError; // Re-throw other errors to be caught by outer catch block
        }

    } catch (error) {
        console.error('=== Submit to LHDN Error ===', {
            error: error.message,
            stack: error.stack
        });

        // Get fileName from params to avoid reference error
        const { fileName } = req.params;
        const { type, company, date } = req.body;

        // Update status if possible
        if (error.invoice_number) {
            try {
                await submitter.updateSubmissionStatus({
                    invoice_number: error.invoice_number,
                    fileName,
                    filePath: error.filePath || fileName,
                    status: 'Failed',
                    error: error.message,
                    type,
                    company,
                    date
                });
            } catch (statusError) {
                console.error('Failed to update status:', statusError);
            }
        }

        // Determine appropriate error response
        const errorResponse = {
            success: false,
            error: {
                code: 'SUBMISSION_ERROR',
                message: error.message || 'An unexpected error occurred during submission',
                details: error.stack
            }
        };

        // Set appropriate status code based on error type
        if (error.response?.status === 401) {
            errorResponse.error.code = 'AUTH_ERROR';
            return res.status(401).json(errorResponse);
        }

        if (error.message.includes('getActiveSAPConfig')) {
            errorResponse.error.code = 'CONFIG_ERROR';
            errorResponse.error.message = 'SAP configuration error: Unable to get active configuration';
            return res.status(500).json(errorResponse);
        }

        res.status(500).json(errorResponse);
    }
});

/**
 * Get submission details and update longId
 */
router.get('/submission/:submissionUid', auth.isApiAuthenticated, async (req, res) => {
    try {
        const { submissionUid } = req.params;

        // Authentication is handled by auth.isApiAuthenticated middleware

        // Get token from AuthorizeToken.ini file
        const { getTokenSession } = require('../../services/token-prisma.service');
        let token;

        try {
            token = await getTokenSession();
        } catch (tokenError) {
            console.error('Error getting token from AuthorizeToken.ini:', tokenError);
            return res.status(401).json({
                success: false,
                error: {
                    code: 'AUTH_ERROR',
                    message: 'Failed to retrieve authentication token',
                    details: tokenError.message
                }
            });
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'AUTH_ERROR',
                    message: 'No LHDN access token available',
                    details: 'Authentication token is missing in AuthorizeToken.ini'
                }
            });
        }

        // Call LHDN API to get submission details
        const response = await axios.get(
            `https://preprod-api.myinvois.hasil.gov.my/api/v1.0/documentsubmissions/${submissionUid}?pageNo=1&pageSize=10`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const submissionData = response.data;

        // Extract longId from the response
        if (submissionData?.documents?.length > 0) {
            const document = submissionData.documents[0];
            const longId = document.longId;

            // Update the database with the longId
            await prisma.wP_OUTBOUND_STATUS.updateMany({
                where: {
                    submissionUid,
                    status: 'Submitted'
                },
                data: { longId }
            });

            return res.json({
                success: true,
                submissionUid,
                longId,
                status: submissionData.status,
                documents: submissionData.documents
            });
        }

        return res.json({
            success: false,
            error: {
                code: 'NO_DOCUMENTS',
                message: 'No documents found in submission'
            }
        });

    } catch (error) {
        console.error('Error getting submission details:', error);
        return res.status(500).json({
            success: false,
            error: {
                code: 'SUBMISSION_DETAILS_ERROR',
                message: 'Failed to get submission details',
                details: error.message
            }
        });
    }
});

/**
 * Find all files with the same name across different directories
 * @param {string} fileName - The filename to search for
 * @param {string} networkPath - The base network path to search in
 * @returns {Promise<Array>} - Array of file paths to delete
 */
async function findAllFilesWithName(fileName, networkPath) {
    const filePaths = [];
    const types = ['Manual', 'Schedule'];

    for (const type of types) {
        const typeDir = path.join(networkPath, type);

        // Skip if directory doesn't exist
        if (!fs.existsSync(typeDir)) continue;

        try {
            // Get list of company directories
            const companies = await fsPromises.readdir(typeDir);

            // Check each company directory
            for (const company of companies) {
                const companyDir = path.join(typeDir, company);

                // Skip if not a directory
                try {
                    const stat = await fsPromises.stat(companyDir);
                    if (!stat.isDirectory()) continue;
                } catch (err) {
                    console.error(`Error checking company directory ${companyDir}:`, err);
                    continue;
                }

                // Get list of date directories
                let dates;
                try {
                    dates = await fsPromises.readdir(companyDir);
                } catch (err) {
                    console.error(`Error reading company directory ${companyDir}:`, err);
                    continue;
                }

                // Check each date directory
                for (const date of dates) {
                    const dateDir = path.join(companyDir, date);

                    // Skip if not a directory
                    try {
                        const stat = await fsPromises.stat(dateDir);
                        if (!stat.isDirectory()) continue;
                    } catch (err) {
                        console.error(`Error checking date directory ${dateDir}:`, err);
                        continue;
                    }

                    // Get list of files
                    let files;
                    try {
                        files = await fsPromises.readdir(dateDir);
                    } catch (err) {
                        console.error(`Error reading date directory ${dateDir}:`, err);
                        continue;
                    }

                    // Check if any file matches our filename
                    for (const file of files) {
                        if (file === fileName) {
                            const filePath = path.join(dateDir, file);
                            filePaths.push({
                                path: filePath,
                                type,
                                company,
                                date
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing ${type} directory:`, error);
        }
    }

    return filePaths;
}

// Helper to delete all files by InvoiceNumber in the standard directory structure
async function deleteFilesByInvoiceNumber(invoiceNumber, config, type, company, date) {
    const deletedFiles = [];
    const failedFiles = [];
    const formattedDate = moment(date).format('YYYY-MM-DD');
    const dirPath = path.join(config.networkPath, type, company, formattedDate);
    let files;
    try {
        files = await fsPromises.readdir(dirPath);
    } catch (err) {
        return { deletedFiles, failedFiles: [{ path: dirPath, error: err.message }] };
    }
    // Match files containing _{InvoiceNumber}_ in their name
    const matchingFiles = files.filter(f => f.includes(`_${invoiceNumber}_`));
    for (const f of matchingFiles) {
        const filePath = path.join(dirPath, f);
        try {
            await fsPromises.unlink(filePath);
            deletedFiles.push({ path: filePath });
        } catch (error) {
            failedFiles.push({ path: filePath, error: error.message });
        }
    }
    return { deletedFiles, failedFiles };
}

router.delete('/:fileName', async (req, res) => {
    try {
        const { fileName } = req.params;
        const { type, company, date, deleteAll, deleteByInvoice } = req.query;

        //console.log('Delete request received:', { fileName, type, company, date, deleteAll, deleteByInvoice });

        // Check if this is a consolidated file (special handling)
        if (type === 'consolidated') {
            //console.log('Processing consolidated file deletion');

            // Find the file in the consolidated directory structure regardless of date folder
            const fileResult = await findConsolidatedFile(fileName);

            if (!fileResult) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'FILE_NOT_FOUND',
                        message: 'File not found in the consolidated directory'
                    }
                });
            }

            // Delete the file
            try {
                await fsPromises.unlink(fileResult.path);
                //console.log('Consolidated file deleted successfully:', fileResult.path);

                // Log the deletion
                await logDBOperation(req.app.get('models'), req, `Deleted consolidated file: ${fileName} from ${fileResult.path}`, {
                    module: 'OUTBOUND',
                    action: 'DELETE',
                    status: 'SUCCESS'
                });

                return res.json({
                    success: true,
                    message: 'File deleted successfully',
                    path: fileResult.path
                });
            } catch (deleteError) {
                console.error('Error deleting consolidated file:', deleteError);
                throw new Error(`Failed to delete consolidated file: ${deleteError.message}`);
            }
        }

        // Get active SAP configuration for standard files
        const config = await getActiveSAPConfig();
        if (!config.success) {
            throw new Error('Failed to get SAP configuration');
        }

        // If deleteByInvoice is true, extract InvoiceNumber and delete all matching files
        if (deleteByInvoice === 'true') {
            // Try to extract InvoiceNumber from filename (e.g. OUTBOUND_ARDN800058_20240513T130119.xlsx)
            const parts = fileName.split('_');
            let invoiceNumber = null;
            if (parts.length >= 3) {
                invoiceNumber = parts[1];
            }
            if (!invoiceNumber) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'INVALID_FILENAME',
                        message: 'Could not extract InvoiceNumber from filename.'
                    }
                });
            }
            const { deletedFiles, failedFiles } = await deleteFilesByInvoiceNumber(invoiceNumber, config, type, company, date);
            if (deletedFiles.length === 0 && failedFiles.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'FILE_NOT_FOUND',
                        message: 'No files found with the specified InvoiceNumber.'
                    }
                });
            }
            // Log each deletion
            for (const f of deletedFiles) {
                await logDBOperation(req.app.get('models'), req, `Deleted file by InvoiceNumber: ${invoiceNumber} from ${f.path}`, {
                    module: 'OUTBOUND',
                    action: 'DELETE',
                    status: 'SUCCESS'
                });
            }
            return res.json({
                success: true,
                message: `Deleted ${deletedFiles.length} files with InvoiceNumber ${invoiceNumber}${failedFiles.length > 0 ? `, ${failedFiles.length} files failed to delete` : ''}`,
                deletedFiles,
                failedFiles
            });
        }

        // If deleteAll is true, find and delete all files with the same name
        if (deleteAll === 'true') {
            //console.log(`Finding all files with name: ${fileName}`);
            const allFiles = await findAllFilesWithName(fileName, config.networkPath);

            if (allFiles.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'FILE_NOT_FOUND',
                        message: 'No files found with the specified name'
                    }
                });
            }

            // Delete all found files
            const deletedFiles = [];
            const failedFiles = [];

            for (const file of allFiles) {
                try {
                    await fsPromises.unlink(file.path);
                    deletedFiles.push({
                        path: file.path,
                        type: file.type,
                        company: file.company,
                        date: file.date
                    });

                    // Log each deletion
                    await logDBOperation(req.app.get('models'), req, `Deleted file: ${fileName} from ${file.path}`, {
                        module: 'OUTBOUND',
                        action: 'DELETE',
                        status: 'SUCCESS'
                    });
                } catch (error) {
                    console.error(`Error deleting file ${file.path}:`, error);
                    failedFiles.push({
                        path: file.path,
                        error: error.message
                    });
                }
            }

            return res.json({
                success: true,
                message: `Deleted ${deletedFiles.length} files successfully${failedFiles.length > 0 ? `, ${failedFiles.length} files failed to delete` : ''}`,
                deletedFiles,
                failedFiles
            });
        }

        // Original behavior - delete a specific file
        // Construct file path
        const formattedDate = moment(date).format('YYYY-MM-DD');
        const filePath = path.join(config.networkPath, type, company, formattedDate, fileName);
        //console.log('Standard file path:', filePath);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            //console.log('File not found at path:', filePath);
            return res.status(404).json({
                success: false,
                error: {
                    code: 'FILE_NOT_FOUND',
                    message: 'File not found'
                }
            });
        }

        // Delete file
        await fsPromises.unlink(filePath);
        //console.log('Standard file deleted successfully:', filePath);

        // Log the deletion
        await logDBOperation(req.app.get('models'), req, `Deleted file: ${fileName}`, {
            module: 'OUTBOUND',
            action: 'DELETE',
            status: 'SUCCESS'
        });

        res.json({
            success: true,
            message: 'File deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting file:', error);

        await logDBOperation(req.app.get('models'), req, `Error deleting file: ${error.message}`, {
            module: 'OUTBOUND',
            action: 'DELETE',
            status: 'FAILED',
            error
        });

        res.status(500).json({
            success: false,
            error: {
                code: 'DELETE_ERROR',
                message: 'Failed to delete file',
                details: error.message
            }
        });
    }
});

/**
 * Real-time updates endpoint - optimized for frequent polling
 */
router.get('/real-time-updates', auth.isApiAuthenticated, async (req, res) => {
    //console.log('Starting real-time-updates endpoint');

    // Authentication is handled by auth.isApiAuthenticated middleware

    // Check if access token exists
    if (!req.session?.accessToken) {
        return res.status(401).json({
            success: false,
            error: {
                code: 'AUTH_ERROR',
                message: 'Access token required'
            }
        });
    }

    try {
        const { lastUpdate, lastFileCheck } = req.query;

        // Quick check for status updates
        const hasStatusUpdates = await checkForStatusUpdates(lastUpdate);

        // Quick check for new files
        let hasNewFiles = false;
        if (!hasStatusUpdates && lastFileCheck) {
            // Get active SAP configuration
            const config = await prisma.wP_CONFIGURATION.findFirst({
                where: {
                    Type: 'SAP',
                    IsActive: true
                },
                select: {
                    Settings: true
                }
            });

            if (config && config.Settings) {
                // Parse Settings if it's a string
                let settings = config.Settings;
                if (typeof settings === 'string') {
                    try {
                        settings = JSON.parse(settings);
                    } catch (parseError) {
                        console.error('Error parsing SAP settings:', parseError);
                    }
                }

                if (settings && settings.networkPath) {
                    hasNewFiles = await checkForNewFiles(settings.networkPath, lastFileCheck);
                }
            }
        }

        // If there are updates, client should request full data
        if (hasStatusUpdates || hasNewFiles) {
            return res.json({
                success: true,
                hasUpdates: true,
                hasStatusUpdates,
                hasNewFiles,
                timestamp: new Date().toISOString()
            });
        }

        // No updates
        return res.json({
            success: true,
            hasUpdates: false,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error in real-time-updates:', error);
        await logError('Error checking for real-time updates', error, {
            action: 'REAL_TIME_UPDATES',
            userId: req.user?.id
        });

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get document status by fileName - lightweight endpoint for refreshing single document status
 */
router.get('/status/:fileName', auth.isApiAuthenticated, async (req, res) => {
    try {
        const { fileName } = req.params;

        // Authentication is handled by auth.isApiAuthenticated middleware

        const status = await prisma.wP_OUTBOUND_STATUS.findFirst({
            where: {
                OR: [
                    { fileName: fileName },
                    { fileName: { contains: fileName } }
                ]
            },
            select: {
                id: true,
                UUID: true,
                submissionUid: true,
                fileName: true,
                invoice_number: true,
                status: true,
                date_submitted: true,
                date_cancelled: true,
                updated_at: true
            }
        });

        if (!status) {
            return res.json({
                success: true,
                exists: false,
                status: 'Pending',
                fileName
            });
        }

        return res.json({
            success: true,
            exists: true,
            document: {
                fileName: status.fileName,
                status: status.status,
                uuid: status.UUID,
                submissionUid: status.submissionUid,
                date_submitted: status.date_submitted,
                date_cancelled: status.date_cancelled,
                invoice_number: status.invoice_number,
                statusUpdateTime: status.updated_at
            }
        });

    } catch (error) {
        console.error('Error getting document status:', error);
        return res.status(500).json({
            success: false,
            error: {
                code: 'STATUS_FETCH_ERROR',
                message: 'Failed to get document status',
                details: error.message
            }
        });
    }
});

/**
 * Get the status of a single document
 */
router.get('/status/:fileName', async (req, res) => {
    try {
        const { fileName } = req.params;
        //console.log('Fetching status for document:', fileName);

        // Check authentication
        if (!req.session?.user) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'AUTH_ERROR',
                    message: 'Authentication required'
                }
            });
        }

        // Find the document status
        const status = await prisma.wP_OUTBOUND_STATUS.findFirst({
            where: {
                OR: [
                    { fileName: fileName },
                    { fileName: { contains: fileName } },
                    { invoice_number: fileName }
                ]
            },
            select: {
                id: true,
                UUID: true,
                submissionUid: true,
                fileName: true,
                invoice_number: true,
                status: true,
                date_submitted: true,
                date_cancelled: true,
                cancellation_reason: true,
                cancelled_by: true,
                updated_at: true
            }
        });

        if (status) {
            //console.log('Document status found:', status.status);
            return res.json({
                success: true,
                exists: true,
                document: {
                    fileName: status.fileName,
                    invoice_number: status.invoice_number,
                    status: status.status,
                    uuid: status.UUID,
                    submissionUid: status.submissionUid,
                    date_submitted: status.date_submitted,
                    date_cancelled: status.date_cancelled,
                    cancellation_reason: status.cancellation_reason,
                    cancelled_by: status.cancelled_by,
                    statusUpdateTime: status.updated_at
                }
            });
        }

        //console.log('Document status not found for:', fileName);
        return res.json({
            success: true,
            exists: false
        });

    } catch (error) {
        console.error('Error fetching document status:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'FETCH_ERROR',
                message: 'Failed to fetch document status',
                details: error.message
            }
        });
    }
});

// Get a document's status by fileName
router.get('/status/:fileName', async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.session.user) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }

        const { fileName } = req.params;

        if (!fileName) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameter: fileName'
            });
        }

        // Log the request
        //console.log(`Fetching status for document: ${fileName}`);

        // Query the database for this document's status
        const document = await prisma.wP_OUTBOUND_STATUS.findFirst({
            where: {
                fileName: fileName
            },
            select: {
                id: true,
                fileName: true,
                status: true,
                UUID: true,
                date_submitted: true,
                date_cancelled: true,
                cancelled_by: true,
                cancellation_reason: true,
                created_at: true,
                updated_at: true
            }
        });

        if (!document) {
            return res.status(404).json({
                success: false,
                error: `Document with fileName '${fileName}' not found`
            });
        }

        // Format the response
        const formattedDocument = {
            id: document.id,
            fileName: document.fileName,
            status: document.status,
            uuid: document.UUID,
            submissionDate: document.date_submitted,
            date_cancelled: document.date_cancelled,
            cancelled_by: document.cancelled_by,
            cancel_reason: document.cancellation_reason,
            createdAt: document.created_at,
            updatedAt: document.updated_at
        };

        return res.json({
            success: true,
            document: formattedDocument
        });

    } catch (error) {
        console.error(`Error fetching document status: ${error.message}`);
        return res.status(500).json({
            success: false,
            error: `Failed to fetch document status: ${error.message}`
        });
    }
});

const multer = require('multer');
const storage = multer.diskStorage({
    destination: async function (req, file, cb) {
        try {
            const { company, date } = req.body;
            const formattedDate = moment(date).format('YYYY-MM-DD');
            const uploadPath = path.join('C:\\SFTPRoot_Consolidation', 'Incoming', company, formattedDate);

            // Ensure directory exists
            await ensureDirectoryExists(uploadPath);
            cb(null, uploadPath);
        } catch (error) {
            cb(error);
        }
    },
    filename: function (req, file, cb) {
        // Keep original filename
        cb(null, file.originalname);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: function (req, file, cb) {
        // Check file type
        if (!file.originalname.match(/\.(xls|xlsx)$/i)) {
            return cb(new Error('Only Excel files are allowed'));
        }
        cb(null, true);
    }
});

// Configure multer for file upload (completely simplified version)
const uploadFolder = path.join(process.cwd(), 'public/uploads');

// Ensure upload folder exists
try {
    if (!fs.existsSync(uploadFolder)) {
        fs.mkdirSync(uploadFolder, { recursive: true });
        //console.log(`Created upload folder: ${uploadFolder}`);
    }
} catch (err) {
    console.error(`Failed to create upload folder: ${err.message}`);
}

// Define the base path for consolidated uploads
const consolidatedBasePath = 'C:\\SFTPRoot_Consolidation\\Incoming\\PXC Branch';

// Ensure base directory exists
try {
    if (!fs.existsSync(consolidatedBasePath)) {
        fs.mkdirSync(consolidatedBasePath, { recursive: true });
        //console.log(`Created consolidated base path: ${consolidatedBasePath}`);
    }
} catch (err) {
    console.error(`Failed to create consolidated base path: ${err.message}`);
}

const consolidatedStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Create today's folder with format YYYY-MM-DD
        const today = moment().format('YYYY-MM-DD');
        const uploadPath = path.join(consolidatedBasePath, today);

        // Only create the directory if it doesn't exist
        if (!fs.existsSync(uploadPath)) {
            try {
                fs.mkdirSync(uploadPath, { recursive: true });
                //console.log(`Created upload directory: ${uploadPath}`);
            } catch (err) {
                console.error(`Failed to create upload directory: ${err.message}`);
                return cb(err);
            }
        } else {
            //console.log(`Using existing upload directory: ${uploadPath}`);
        }

        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // Keep original filename to maintain format needed for processing
        cb(null, file.originalname);
    }
});

const fileFilter = function (req, file, cb) {
    // Check if it's an Excel file
    if (!file.originalname.match(/\.(xlsx|xls)$/i)) {
        return cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }
    cb(null, true);
};

const consolidatedUpload = multer({
    storage: consolidatedStorage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

/**
 * Diagnostic endpoint to check upload directories and permissions
 */
router.get('/check-upload-dirs', async (req, res) => {
    const results = {
        cwd: process.cwd(),
        temp_dir: os.tmpdir(),
        node_env: process.env.NODE_ENV,
        directories: [],
        success: true
    };

    // Test directories to check
    const dirsToCheck = [
        { path: path.join(process.cwd(), 'public/uploads'), name: 'Public Uploads' },
        { path: path.join(process.cwd(), 'tmp'), name: 'Tmp Folder' },
        { path: 'C:\\SFTPRoot_Consolidation', name: 'SFTP Root' },
        { path: os.tmpdir(), name: 'OS Temp' }
    ];

    // Check each directory
    for (const dir of dirsToCheck) {
        const dirResult = {
            name: dir.name,
            path: dir.path,
            exists: false,
            writable: false,
            created_test_file: false,
            error: null
        };

        try {
            // Check if directory exists
            if (fs.existsSync(dir.path)) {
                dirResult.exists = true;

                // Check if writable by trying to create a test file
                const testFile = path.join(dir.path, `.write-test-${Date.now()}.txt`);
                try {
                    fs.writeFileSync(testFile, 'test');
                    dirResult.writable = true;
                    dirResult.created_test_file = true;

                    // Clean up test file
                    try {
                        fs.unlinkSync(testFile);
                    } catch (cleanupErr) {
                        dirResult.error = `Can write but cannot delete: ${cleanupErr.message}`;
                    }
                } catch (writeErr) {
                    dirResult.error = `Not writable: ${writeErr.message}`;
                }
            } else {
                // Try to create the directory
                try {
                    fs.mkdirSync(dir.path, { recursive: true });
                    dirResult.exists = true;

                    // Check if newly created directory is writable
                    const testFile = path.join(dir.path, `.write-test-${Date.now()}.txt`);
                    try {
                        fs.writeFileSync(testFile, 'test');
                        dirResult.writable = true;
                        dirResult.created_test_file = true;

                        // Clean up test file
                        try {
                            fs.unlinkSync(testFile);
                        } catch (cleanupErr) {
                            dirResult.error = `Can write but cannot delete: ${cleanupErr.message}`;
                        }
                    } catch (writeErr) {
                        dirResult.error = `Directory created but not writable: ${writeErr.message}`;
                    }
                } catch (mkdirErr) {
                    dirResult.error = `Cannot create directory: ${mkdirErr.message}`;
                }
            }
        } catch (err) {
            dirResult.error = `Error checking directory: ${err.message}`;
        }

        results.directories.push(dirResult);

        // If this is the upload folder we're using and it's not writable, mark overall test as failed
        if (dir.path === uploadFolder && !dirResult.writable) {
            results.success = false;
        }
    }

    return res.json(results);
});

/**
 * Simple diagnostic endpoint to check server status
 */
router.get('/ping', (req, res) => {
    try {
        const result = {
            success: true,
            cwd: process.cwd(),
            env: process.env.NODE_ENV || 'development',
            time: new Date().toISOString(),
            server: os.hostname(),
            platform: os.platform(),
            uploadFolderExists: fs.existsSync(path.join(process.cwd(), 'public/uploads'))
        };

        return res.json(result);
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
            stack: error.stack
        });
    }
});

/**
 * Upload consolidated Excel file endpoint
 */
router.post('/upload-consolidated', consolidatedUpload.single('file'), async (req, res) => {
    //console.log('Starting consolidated file upload...');
    try {
        // Basic check if file was uploaded
        if (!req.file) {
            console.error('No file uploaded');
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }
        //console.log('Request body:', req.body);

        // Skip validation for manual uploads (accept either 'manual' or 'manual_upload' parameters)
        if (req.body.manual === 'true' || req.body.manual_upload === 'true') {
            //console.log('Manual upload detected, skipping validation');

            return res.json({
                success: true,
                file: {
                    originalname: req.file.originalname,
                    filename: req.file.filename,
                    path: req.file.path,
                    size: req.file.size
                }
            });
        }

        // For automatic uploads, validate file name format
        const isValidFormat = isValidFileFormat(req.file.originalname);
        if (!isValidFormat) {
            console.error('Invalid filename format:', req.file.originalname);
            try {
                await fsPromises.unlink(req.file.path);
            } catch (unlinkErr) {
                console.error('Error deleting invalid file:', unlinkErr);
            }

            return res.status(400).json({
                success: false,
                message: 'Filename does not follow the required format: XX_InvoiceNumber_eInvoice_YYYYMMDDHHMMSS'
            });
        }

        // Return success response
        return res.json({
            success: true,
            file: {
                originalname: req.file.originalname,
                filename: req.file.filename,
                path: req.file.path,
                size: req.file.size
            }
        });

    } catch (error) {
        console.error('Error uploading file:', error);

        // Clean up - delete file if it was uploaded
        if (req.file) {
            try {
                await fsPromises.unlink(req.file.path);
            } catch (unlinkErr) {
                console.error('Error deleting invalid file:', unlinkErr);
            }
        }

        return res.status(500).json({
            success: false,
            message: error.message || 'An unknown error occurred during upload'
        });
    }
});

/**
 * Helper function to find a file within the consolidated path
 * Searches all date folders for a file with the given name
 */
async function findConsolidatedFile(fileName) {
    const consolidatedBasePath = 'C:\\SFTPRoot_Consolidation\\Incoming\\PXC Branch';

    if (!fs.existsSync(consolidatedBasePath)) {
        //console.log('Consolidated base path does not exist:', consolidatedBasePath);
        return null;
    }

    try {
        // Read all date directories in the base path
        const dateDirs = await fsPromises.readdir(consolidatedBasePath);

        // Search each date directory for the file
        for (const dateDir of dateDirs) {
            const datePathStat = await fsPromises.stat(path.join(consolidatedBasePath, dateDir));

            // Skip if not a directory
            if (!datePathStat.isDirectory()) continue;

            const filePath = path.join(consolidatedBasePath, dateDir, fileName);

            // Check if file exists
            try {
                const fileStat = await fsPromises.stat(filePath);
                if (fileStat.isFile()) {
                    //console.log('Found consolidated file:', filePath);
                    return {
                        path: filePath,
                        dateDir: dateDir
                    };
                }
            } catch (err) {
                // File doesn't exist in this date folder, continue searching
            }
        }
    } catch (error) {
        console.error('Error searching for consolidated file:', error);
    }

    //console.log('Could not find consolidated file:', fileName);
    return null;
}

// Manual status synchronization endpoint
router.post('/sync-status', async (req, res) => {
    try {
        console.log('Manual status synchronization requested');

        // Check if user is logged in
        if (!req.session?.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        // Get all inbound documents with their current status
        const inboundDocuments = await prisma.wP_INBOUND_STATUS.findMany({
            select: {
                uuid: true,
                status: true,
                dateTimeValidated: true,
                dateTimeReceived: true
            }
        });

        let syncCount = 0;
        let errorCount = 0;

        // Process each inbound document
        for (const inboundDoc of inboundDocuments) {
            try {
                // Find corresponding outbound record(s)
                const outboundRecords = await prisma.wP_OUTBOUND_STATUS.findMany({
                    where: { UUID: inboundDoc.uuid }
                });

                if (outboundRecords.length > 0) {
                    // Update outbound status to match inbound status
                    await prisma.wP_OUTBOUND_STATUS.updateMany({
                        where: { UUID: inboundDoc.uuid },
                        data: {
                            status: inboundDoc.status,
                            date_sync: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                            submitted_by: req.session.user.username || 'System'
                        }
                    });

                    syncCount++;
                    console.log(`Synced status for UUID ${inboundDoc.uuid}: ${inboundDoc.status}`);
                }
            } catch (error) {
                console.error(`Error syncing status for UUID ${inboundDoc.uuid}:`, error);
                errorCount++;
            }
        }

        console.log(`Status synchronization completed: ${syncCount} synced, ${errorCount} errors`);

        res.json({
            success: true,
            message: 'Status synchronization completed',
            syncCount,
            errorCount,
            totalProcessed: inboundDocuments.length
        });

    } catch (error) {
        console.error('Error in manual status synchronization:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to synchronize status',
            error: error.message
        });
    }
});

module.exports = router;