const {
  getCertificatesHashedParams,
  validateCustomerTin,
  submitDocument
} = require('./lhdnService');
const prisma = require('../../src/lib/prisma');
const moment = require('moment');
const axios = require('axios');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const XLSX = require('xlsx');
const { getActiveSAPConfig } = require('../../config/paths');
const { processExcelData } = require('./processExcelData');
const { parseStringPromise } = require('xml2js');

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

  return {
      baseUrl,
      environment: settings.environment,
      timeout: Math.min(Math.max(parseInt(settings.timeout) || 60000, 30000), 300000),
      retryEnabled: settings.retryEnabled !== false,
      maxRetries: settings.maxRetries || 10, // Increased for polling
      retryDelay: settings.retryDelay || 3000, // 3 seconds base delay
      maxRetryDelay: settings.maxRetryDelay || 5000, // 5 seconds max delay
      rateLimit: {
          submissionRequests: settings.rateLimit?.submissionRequests || 300, // RPM
          minInterval: settings.rateLimit?.minInterval || 200 // ms between requests
      }
  };
}
class LHDNSubmitter {
  constructor(req) {
    this.req = req;
    this.baseUrl = null;  // Will be set after loading config
    this.loadConfig();  // Initialize configuration
  }

  async loadConfig() {
    try {
      // Get LHDN configuration from database
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

      // Parse settings if it's a string
      let settings = typeof config.Settings === 'string' ? JSON.parse(config.Settings) : config.Settings;

      // Set base URL based on environment
      this.baseUrl = settings.environment === 'production'
        ? settings.productionUrl || settings.middlewareUrl
        : settings.sandboxUrl || settings.middlewareUrl;

      if (!this.baseUrl) {
        throw new Error('LHDN API URL not configured');
      }


    } catch (error) {
      console.error('Error loading LHDN configuration:', error);
      throw new Error('Failed to load LHDN configuration: ' + error.message);
    }
  }


  async logOperation(description, options = {}) {
    const now = new Date();
    try {
      await prisma.wP_LOGS.create({
        data: {
          Description: description,
          CreateTS: now.toISOString(),
          LoggedUser: this.req.session?.user?.username || 'System',
          IPAddress: this.req.ip,
          LogType: options.logType || 'INFO',
          Module: 'OUTBOUND',
          Action: options.action || 'SUBMIT',
          Status: options.status || 'SUCCESS',
          UserID: this.req.session?.user?.id
        }
      });
    } catch (error) {
      console.error('Error creating log:', error);
    }
  }

  async validateCustomerTaxInfo(tin, idType, idValue) {
    try {
      const token = this.req.session.accessToken;
      console.log("Using Login Authentication Token", token);
      const result = await validateCustomerTin(tin, idType, idValue, token);
      return result;
    } catch (error) {
      await this.logOperation(`Customer tax validation failed for TIN: ${tin}`, {
        status: 'FAILED',
        logType: 'ERROR'
      });
      throw error;
    }
  }

  async prepareDocumentForSubmission(lhdnJson, version) {
    try {
      console.log('Preparing document for submission with version:', version);

      const invoiceNumber = lhdnJson?.Invoice?.[0]?.ID?.[0]?._;
      if (!invoiceNumber) {
        throw new Error('Invoice number not found in the document');
      }

      // Ensure version is set in the document
      if (lhdnJson?.Invoice?.[0]?.InvoiceTypeCode?.[0]) {
        lhdnJson.Invoice[0].InvoiceTypeCode[0].listVersionID = version;
      }

      // Different handling for v1.0 and v1.1
      if (version === '1.1') {
        console.log('Processing as v1.1 document with digital signature');
        const { certificateJsonPortion_Signature, certificateJsonPortion_UBLExtensions } =
          getCertificatesHashedParams(lhdnJson);

        lhdnJson.Invoice[0].Signature = certificateJsonPortion_Signature;
        lhdnJson.Invoice[0].UBLExtensions = certificateJsonPortion_UBLExtensions;
      } else {
        console.log('Processing as v1.0 document without digital signature');
        // Remove UBLExtensions and Signature if they exist
        if (lhdnJson.Invoice?.[0]) {
          delete lhdnJson.Invoice[0].UBLExtensions;
          delete lhdnJson.Invoice[0].Signature;
        }
      }

      // Create payload
      const payload = {
        "documents": [
          {
            "format": "JSON",
            "documentHash": require('crypto')
              .createHash('sha256')
              .update(JSON.stringify(lhdnJson))
              .digest('hex'),
            "codeNumber": invoiceNumber,
            "document": Buffer.from(JSON.stringify(lhdnJson)).toString('base64')
          }
        ]
      };

      await this.logOperation(`Document prepared for submission: ${invoiceNumber}`, {
        action: 'PREPARE_DOCUMENT'
      });

      return { payload, invoice_number: invoiceNumber };
    } catch (error) {
      console.error('Error preparing document:', error);
      await this.logOperation(`Document preparation failed: ${error.message}`, {
        action: 'PREPARE_ERROR',
        status: 'FAILED',
        logType: 'ERROR'
      });
      throw error;
    }
  }

  async prepareXMLDocumentForSubmission(xmlData, version) {
    try {
      const preparedXMLData = xmlData.replace(/<\?xml.*?\?>/, '').trim();
      console.log('Preparing document for submission with version:', version);

      // Parse XML data for validation and extraction
      const parsedXml = await parseStringPromise(preparedXMLData, { explicitArray: false });
      const currentDate = new Date();
      const formattedDate = currentDate.toISOString().split('T')[0];
      const formattedTime = currentDate.toISOString().split('T')[1].split('.')[0] + 'Z';

      const codeNumber = parsedXml?.Invoice?.['cbc:ID'];
      if (!codeNumber) {
        throw new Error('Invoice ID not found in the XML');
      }

      // Update the XML string directly using regex replacements
      let updatedXMLData = preparedXMLData;

      // Update IssueDate
      updatedXMLData = updatedXMLData.replace(
        /<cbc:IssueDate>[^<]+<\/cbc:IssueDate>/,
        `<cbc:IssueDate>${formattedDate}</cbc:IssueDate>`
      );

      // Update IssueTime
      updatedXMLData = updatedXMLData.replace(
        /<cbc:IssueTime>[^<]+<\/cbc:IssueTime>/,
        `<cbc:IssueTime>${formattedTime}</cbc:IssueTime>`
      );

      // Update version if needed
      if (version) {
        updatedXMLData = updatedXMLData.replace(
          /<cbc:InvoiceTypeCode[^>]*>/,
          `<cbc:InvoiceTypeCode listVersionID="${version}">`
        );
      }

      console.log('Prepared XML Data:', updatedXMLData);

      const payload = {
        "documents": [
          {
            "format": "XML",
            "documentHash": require('crypto')
              .createHash('sha256')
              .update(updatedXMLData)
              .digest('hex'),
            "codeNumber": codeNumber,
            "document": Buffer.from(updatedXMLData).toString('base64')
          }
        ]
      };

      await this.logOperation(`Document prepared for submission: ${codeNumber}`, {
        action: 'PREPARE_DOCUMENT'
      });

      return { payload, invoice_number: codeNumber };
    } catch (error) {
      console.error('Error preparing document:', error);

      await this.logOperation(`Document preparation failed: ${error.message}`, {
        action: 'PREPARE_ERROR',
        status: 'FAILED',
        logType: 'ERROR'
      });
      throw error;
    }
  }

  async checkExistingSubmission(fileName) {
    try {
      const docNum = this.extractDocNum(fileName);
      const existing = await prisma.wP_OUTBOUND_STATUS.findFirst({
        where: {
          OR: [
            { invoice_number: docNum },
            { fileName: { contains: docNum } }
          ]
        }
      });

      if (existing && ['Submitted', 'Processing'].includes(existing.status)) {
        return {
          blocked: true,
          response: {
            success: false,
            error: {
              code: 'DUPLICATE_SUBMISSION',
              message: 'This document has already been submitted',
              details: [{
                code: 'DUPLICATE',
                message: `Document with ID ${docNum} was submitted on ${existing.date_submitted}`,
                status: existing.status
              }]
            }
          }
        };
      }

      if (existing) {
        await prisma.wP_OUTBOUND_STATUS.update({
          where: { id: existing.id },
          data: {
            status: 'Processing',
            updated_at: new Date()
          }
        });
      }

      return { blocked: false };
    } catch (error) {
      console.error('Error checking existing submission:', error);
      throw error;
    }
  }

  extractDocNum(fileName) {
    const match = fileName.match(/^(?:\d{2})_([^_]+)_/);
    return match ? match[1] : fileName;
  }

  async getProcessedData(fileName, type, company, date, data = null) {
    try {
      const filePath = await this.constructFilePath(fileName, type, company, date);

      if (data) {
        return {
          ...data,
          filePath
        };
      }

      // Process Excel file and return structured data
      const workbook = XLSX.readFile(filePath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(worksheet, {
        raw: true,
        defval: null,
        blankrows: false
      });

      const processedData = processExcelData(rawData);
      if (!processedData || !Array.isArray(processedData) || processedData.length === 0) {
        throw new Error('No valid documents found in Excel file');
      }

      return processedData;
    } catch (error) {
      console.error('Error processing document data:', error);
      throw error;
    }
  }

  async constructFilePath(fileName, type, company, date) {
    try {
      if (!fileName || !type || !company || !date) {
        throw new Error('Missing required parameters for file path construction');
      }

      console.log('Constructing file path with:', {
        fileName,
        type,
        company,
        date,
      });

      const config = await getActiveSAPConfig();
      if (!config.success) {
        throw new Error(config.error || 'Failed to get SAP configuration');
      }

      // Use the networkPath from config
      const networkPath = config.networkPath;
      if (!networkPath) {
        throw new Error('Network path not found in SAP configuration');
      }

      console.log('Using network path:', networkPath);

      // Format the date consistently
      const formattedDate = moment(date).format('YYYY-MM-DD');
      console.log('Formatted date:', formattedDate);

      // Construct the full path
      const filePath = path.join(networkPath, type, company, formattedDate, fileName);
      console.log('Constructed file path:', filePath);

      // Verify the file exists
      if (!fs.existsSync(filePath)) {
        console.error(`File not found at path: ${filePath}`);

        // Try alternate paths
        const alternativePaths = [
          path.join('C:\\SFTPRoot', type, company, formattedDate, fileName),
          path.join('C:\\SFTPRoot_Consolidation', 'Incoming', company, formattedDate, fileName),
          path.join('C:\\SFTPRoot_Consolidation', 'Outgoing', company, formattedDate, fileName)
        ];

        console.log('Trying alternative paths:', alternativePaths);

        for (const altPath of alternativePaths) {
          console.log('Checking alternative path:', altPath);
          if (fs.existsSync(altPath)) {
            console.log('File found at alternative path:', altPath);
            return altPath;
          }
        }

        console.error('Path components:', {
          networkPath,
          type,
          company,
          formattedDate,
          fileName
        });
        throw new Error(`File not found: ${fileName}`);
      }

      console.log('File found at path:', filePath);
      return filePath;
    } catch (error) {
      if (error.message.includes('File not found')) {
        throw error;
      }
      console.error('Error constructing file path:', error);
      throw new Error(`Failed to construct file path: ${error.message}`);
    }
  }

  async submitToLHDNDocument(docs) {
    try {
      console.log('[LHDN Submitter] Starting document submission process');

      // Get token from AuthorizeToken.ini file using getTokenSession
      const { getTokenSession } = require('../token-prisma.service');
      let token;

      try {
        console.log('[LHDN Submitter] Calling getTokenSession to get token from AuthorizeToken.ini');
        token = await getTokenSession();

        // Log token details (first 10 chars only for security)
        if (token) {
          const tokenPreview = token.substring(0, 10) + '...';
          console.log('[LHDN Submitter] Token retrieved successfully (preview):', tokenPreview);
          console.log('[LHDN Submitter] Token length:', token.length);
        } else {
          console.error('[LHDN Submitter] Token is null or empty after getTokenSession call');
        }
      } catch (tokenError) {
        console.error('[LHDN Submitter] Error getting token from AuthorizeToken.ini:', tokenError);
        console.error('[LHDN Submitter] Error details:', tokenError.stack);
        return {
          status: 'failed',
          error: {
            code: 'AUTH_ERROR',
            message: 'No LHDN access token available',
            details: 'Failed to retrieve authentication token from AuthorizeToken.ini. Please check the token configuration.'
          }
        };
      }

      if (!token) {
        console.error('[LHDN Submitter] No access token found in AuthorizeToken.ini');
        return {
          status: 'failed',
          error: {
            code: 'AUTH_ERROR',
            message: 'No LHDN access token available',
            details: 'Authentication token is missing in AuthorizeToken.ini. Please check the token configuration.'
          }
        };
      }

      console.log('[LHDN Submitter] Token used for submission:', token ? 'Present (length: ' + token.length + ')' : 'Missing');
      console.log('[LHDN Submitter] Documents count for submission:', docs.length);

      // Submit document to LHDN
      console.log('[LHDN Submitter] Calling submitDocument function with token and documents');
      const result = await submitDocument(docs, token);
      console.log('Submission result:', JSON.stringify(result, null, 2));

      // Check for undefined or malformed response
      if (!result) {
        return {
          status: 'failed',
          error: {
            code: 'EMPTY_RESPONSE',
            message: 'No response received from LHDN. The service might be unavailable.',
            details: [{
              code: 'EMPTY_RESPONSE',
              message: 'The LHDN API returned an empty response. Please try again later or contact support.',
              target: docs[0]?.codeNumber || 'Unknown'
            }]
          }
        };
      }

      // Check if there are rejected documents
      if (result.data?.rejectedDocuments?.length > 0) {
        const rejectedDoc = result.data.rejectedDocuments[0];
        return {
          status: 'failed',
          error: {
            code: rejectedDoc.code || 'REJECTION',
            message: rejectedDoc.message || 'Document was rejected by LHDN',
            details: rejectedDoc
          }
        };
      }

      return result;
    } catch (error) {
      console.error('Error submitting document:', error);

      // Create a more informative error response
      // Check if this is an Axios error with a response
      if (error.isAxiosError && error.response) {
        const { status, data } = error.response;

        // Handle specific error status codes
        if (status === 400) {
          // Validation error
          return {
            status: 'failed',
            error: {
              code: data.error?.code || 'VALIDATION_ERROR',
              message: data.error?.message || 'Document validation failed',
              details: data.error?.details || data
            }
          };
        } else if (status === 401 || status === 403) {
          // Authentication error
          return {
            status: 'failed',
            error: {
              code: 'AUTH_ERROR',
              message: 'Authentication failed or token expired',
              details: data
            }
          };
        } else if (status === 429) {
          // Rate limiting
          return {
            status: 'failed',
            error: {
              code: 'RATE_LIMIT',
              message: 'Rate limit exceeded. Please try again later.',
              details: data
            }
          };
        } else if (status === 500) {
          // Server error
          return {
            status: 'failed',
            error: {
              code: 'SERVER_ERROR',
              message: 'LHDN server encountered an error',
              details: data
            }
          };
        }

        // Generic response error
        return {
          status: 'failed',
          error: {
            code: `HTTP_${status}`,
            message: data.message || `HTTP error ${status}`,
            details: data
          }
        };
      }

      // Check for specific error messages
      if (error.message && error.message.includes('Enter valid phone number')) {
        return {
          status: 'failed',
          error: {
            code: 'CF414',
            message: 'Enter valid phone number and the minimum length is 8 characters - SUPPLIER',
            details: [{
              code: 'CF414',
              message: 'Enter valid phone number and the minimum length is 8 characters - SUPPLIER',
              target: 'ContactNumber',
              propertyPath: 'Invoice.AccountingSupplierParty.Party.Contact.Telephone'
            }]
          }
        };
      }

      // Generic error
      return {
        status: 'failed',
        error: {
          code: 'SUBMISSION_ERROR',
          message: error.message || 'Error submitting document to LHDN',
          details: error.stack || 'No additional details available'
        }
      };
    }
  }

  async updateSubmissionStatus(data, transaction = null) {
    try {
      const now = new Date();

      // Extract additional data from processed data if available
      let additionalData = {};

      // Try to get processed data to extract supplier, receiver, amount, etc.
      if (data.fileName && data.type && data.company && data.date) {
        try {
          const processedData = await this.getProcessedData(data.fileName, data.type, data.company, data.date);
          if (processedData && Array.isArray(processedData) && processedData.length > 0) {
            const firstDoc = processedData[0];

            additionalData = {
              company: data.company || null,
              supplier: firstDoc.supplier?.name || null,
              receiver: firstDoc.buyer?.name || null,
              source: 'Excel',
              amount: firstDoc.summary?.amounts?.payableAmount?.toString() || null,
              document_type: firstDoc.header?.invoiceType || null,
              submitted_by: this.req?.session?.user?.username || null
            };
          }
        } catch (processError) {
          console.warn('Could not extract additional data from processed file:', processError.message);
          // Set basic additional data
          additionalData = {
            company: data.company || null,
            source: 'Excel',
            submitted_by: this.req?.session?.user?.username || null
          };
        }
      } else {
        // Set basic additional data when file processing is not available
        additionalData = {
          company: data.company || null,
          source: 'Excel',
          submitted_by: this.req?.session?.user?.username || null
        };
      }

      const submissionData = {
        invoice_number: data.invoice_number,
        UUID: data.uuid || 'NA',
        submissionUid: data.submissionUid || 'NA',
        fileName: data.fileName,
        filePath: data.filePath,
        status: data.status,
        date_submitted: now,
        created_at: now,
        updated_at: now,
        ...additionalData
      };

      // Set date_sync when status indicates completion
      if (data.status && ['Completed', 'Valid', 'Synced'].includes(data.status)) {
        submissionData.date_sync = now;
      }

      // Check if record exists
      const existing = await prisma.wP_OUTBOUND_STATUS.findFirst({
        where: {
          OR: [
            { invoice_number: data.invoice_number },
            { filePath: data.filePath }
          ]
        }
      });

      if (existing) {
        // Update existing record
        await prisma.wP_OUTBOUND_STATUS.update({
          where: { id: existing.id },
          data: {
            ...submissionData,
            created_at: undefined // Don't update creation date
          }
        });
      } else {
        // Create new record
        await prisma.wP_OUTBOUND_STATUS.create({
          data: submissionData
        });
      }

      await this.logOperation(`Status Updated to ${data.status} for invoice ${data.invoice_number}`, {
        action: 'STATUS_UPDATE',
        status: data.status
      });

    } catch (error) {
      console.error('Error updating submission status:', error);
      throw error;
    }
  }

async getSubmissionDetails(submissionUid, accessToken = null) {
    try {
        const lhdnConfig = await getLHDNConfig();

        // Get token from AuthorizeToken.ini if not provided
        let token = accessToken;
        if (!token) {
            try {
                const { getTokenSession } = require('../token-prisma.service');
                token = await getTokenSession();
                console.log('[Polling] Using token from AuthorizeToken.ini');
            } catch (tokenError) {
                console.error('[Polling] Error getting token from AuthorizeToken.ini:', tokenError);
                throw new Error('Failed to retrieve authentication token from AuthorizeToken.ini');
            }
        }

        if (!token) {
            throw new Error('No valid authentication token available for polling');
        }

        // Initial delay before first poll (5 seconds)
        await new Promise(resolve => setTimeout(resolve, 5000));

        let attempts = lhdnConfig.maxRetries;
        let lastError;

        // Polling loop with exponential backoff
        while (attempts > 0) {
            try {
                const url = `${lhdnConfig.baseUrl}/api/v1.0/documentsubmissions/${submissionUid}`;
                console.log(`[Polling] Attempt ${lhdnConfig.maxRetries - attempts + 1}:`, url);

                const response = await axios.get(url, {
                    params: { pageNo: 1, pageSize: 10 },
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: lhdnConfig.timeout
                });

                // Process successful response
                if (response.status === 200 && response.data) {
                    // Check for different response formats
                    if (response.data.overallStatus) {
                        // Format 1: Has overallStatus field
                        const status = response.data.overallStatus;
                        console.log('[Polling] Current status:', status);

                        // Check if processing is complete - use case-insensitive comparison
                        const lowerStatus = status.toLowerCase();
                        if (lowerStatus === 'valid' || lowerStatus === 'invalid' || lowerStatus === 'partially valid') {
                            const documentSummary = response.data.documentSummary?.[0];
                            const longId = documentSummary?.longId;

                            if (!longId) {
                                console.log('[Polling] Warning: LongId not found in completed submission, using NA');
                            }

                            console.log(`[Polling] Document processing complete with status: ${status}`);
                            return {
                                success: true,
                                data: response.data,
                                status: lowerStatus,
                                documentCount: response.data.documentCount || 1,
                                longId: longId || 'NA',
                                documentDetails: documentSummary || {}
                            };
                        }

                        // Still in progress, wait before next attempt - use case-insensitive comparison
                        if (lowerStatus === 'in progress') {
                            attempts--;
                            if (attempts === 0) {
                                throw new Error('Maximum polling attempts reached');
                            }

                            // Calculate exponential backoff delay (3-5 seconds as per docs)
                            const backoffDelay = Math.min(
                                5000, // max 5 seconds
                                3000 * Math.pow(1.5, lhdnConfig.maxRetries - attempts) // exponential increase
                            );

                            console.log(`[Polling] Status in progress, waiting ${backoffDelay}ms before next attempt...`);
                            await new Promise(resolve => setTimeout(resolve, backoffDelay));
                            continue;
                        }
                    }
                    else if (response.data.status) {
                        // Format 2: Has status field directly
                        const status = response.data.status;
                        console.log('[Polling] Current status (format 2):', status);

                        // If status is valid, invalid, or partially valid, return success - use case-insensitive comparison
                        const lowerStatus = status.toLowerCase();
                        if (lowerStatus === 'valid' || lowerStatus === 'invalid' || lowerStatus === 'partially valid') {
                            console.log(`[Polling] Document processing complete with status (format 2): ${status}`);
                            return {
                                success: true,
                                status: lowerStatus,
                                documentDetails: response.data.documentDetails || {},
                                longId: response.data.documentDetails?.longId || 'NA'
                            };
                        }
                    }
                    else if (response.data.documentDetails || response.data.longId) {
                        // Format 3: Has documentDetails or longId directly
                        console.log('[Polling] Got response with documentDetails or longId');

                        return {
                            success: true,
                            status: 'valid', // Assume valid since we got documentDetails
                            documentDetails: response.data.documentDetails || {},
                            longId: response.data.longId || 'NA'
                        };
                    }
                    else {
                        // Format 4: Unknown format but still a 200 response
                        console.log('[Polling] Got 200 response with unknown format:',
                            Object.keys(response.data).join(', '));

                        // For any 200 response with the submissionUid in the URL, consider it valid
                        // This is based on the LHDN API behavior where a 200 response means the document exists
                        if (url.includes(submissionUid)) {
                            console.log(`[Polling] Considering document valid based on 200 response for submissionUid: ${submissionUid}`);
                            return {
                                success: true,
                                status: 'valid', // Assume valid since we got a 200 for this specific submissionUid
                                documentDetails: response.data || {},
                                longId: response.data.longId || 'NA'
                            };
                        }
                    }
                }

                // If we get here, it's an unexpected response format
                throw new Error(`Invalid response format for status: ${response.status}`);

            } catch (error) {
                lastError = error;

                // Check if the error occurred after a successful "Valid" status response
                // This is a special case where we might get an error after the document is already valid
                if (error.message?.includes('Invalid response format') &&
                    error.message?.includes('200') &&
                    url.includes(submissionUid)) {
                    console.log('[Polling] Error after 200 response, assuming document is valid');
                    return {
                        success: true,
                        status: 'valid',
                        documentDetails: {},
                        longId: 'NA',
                        note: 'Assumed valid after 200 response with error'
                    };
                }

                // Handle rate limiting (429)
                if (error.response?.status === 429) {
                    const retryAfter = error.response.headers['retry-after'] || 60;
                    console.log(`[Polling] Rate limited, waiting ${retryAfter}s before retry...`);
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                    continue;
                }

                attempts--;
                if (attempts === 0) break;

                // Standard backoff for other errors
                const backoffDelay = Math.min(
                    lhdnConfig.maxRetryDelay,
                    lhdnConfig.retryDelay * Math.pow(2, lhdnConfig.maxRetries - attempts)
                );
                console.log(`[Polling] Error occurred, waiting ${backoffDelay}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
            }
        }

        throw lastError || new Error('Failed to get submission details after all retries');

    } catch (error) {
        console.error('[Polling] Error getting submission details:', error);
        return {
            success: false,
            error: error.message,
            longId: 'NA'
        };
    }
}

  async updateExcelWithResponse(fileName, type, company, date, uuid, invoice_number) {
    try {
      console.log('=== updateExcelWithResponse Start ===');
      console.log('Input Parameters:', { fileName, type, company, date, uuid, invoice_number });

      // Get network path from config
      const config = await getActiveSAPConfig();
      console.log('SAP Config:', config);

      if (!config.success) {
        throw new Error('Failed to get SAP configuration');
      }

      // Format date properly for folder structure
      const formattedDate = moment(date).format('YYYY-MM-DD');

      // Construct base paths for outgoing files
      const outgoingBasePath = path.join('C:\\SFTPRoot\\MindValley\\Outgoing', type, company, formattedDate);
      const outgoingFilePath = path.join(outgoingBasePath, fileName);

      // Generate JSON file in the same folder as Excel
      const baseFileName = fileName.replace('.xls', '');
      const jsonFileName = `${baseFileName}.json`;
      const jsonFilePath = path.join(outgoingBasePath, jsonFileName);

      console.log('File Paths:', {
        outgoingBasePath,
        outgoingFilePath,
        jsonFilePath
      });

      // Create directory structure recursively
      await fsPromises.mkdir(outgoingBasePath, { recursive: true });

      // Construct incoming file path
      const incomingPath = path.join(config.networkPath, type, company, formattedDate, fileName);

      console.log('File Paths:', {
        incomingPath,
        outgoingFilePath
      });

      // Read source Excel file
      const workbook = XLSX.readFile(incomingPath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];

      // Find header row and update UUID and invoice_number
      const range = XLSX.utils.decode_range(worksheet['!ref']);
      for (let R = range.s.r; R <= range.e.r; ++R) {
        const typeCell = XLSX.utils.encode_cell({ r: R, c: 0 });
        if (worksheet[typeCell] && worksheet[typeCell].v === 'H') {
          const uuidCell = XLSX.utils.encode_cell({ r: R, c: 2 });
          worksheet[uuidCell] = { t: 's', v: uuid };
          const invoiceCell = XLSX.utils.encode_cell({ r: R, c: 3 });
          worksheet[invoiceCell] = { t: 's', v: invoice_number };
          break;
        }
      }

      // Write updated Excel file
      XLSX.writeFile(workbook, outgoingFilePath);

      // Get processed data
      const processedData = await this.getProcessedData(fileName, type, company, date);
      console.log('Processed Data:', processedData);

      // Create JSON content with simplified structure
      const jsonContent = {
        "issueDate": moment(date).format('YYYY-MM-DD'),
        "issueTime": new Date().toISOString().split('T')[1].split('.')[0] + 'Z',
        "invoiceTypeCode": processedData.invoiceType || processedData.header?.invoiceType || "01",
        "invoiceNo": invoice_number,
        "uuid": uuid,
      };
      // Write JSON file
      await fsPromises.writeFile(jsonFilePath, JSON.stringify(jsonContent, null, 2));

      const response = {
        success: true,
        outgoingPath: outgoingFilePath,
        jsonPath: jsonFilePath
      };

      console.log('=== updateExcelWithResponse Response ===', response);
      return response;

    } catch (error) {
      console.error('=== updateExcelWithResponse Error ===', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

}

module.exports = LHDNSubmitter;