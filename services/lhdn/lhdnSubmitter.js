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
const { lookupCompanyIndustry } = require('./excelValidator');
const { parseStringPromise } = require('xml2js');
const { getTokenSession, getConfig } = require('../token.service');

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
        ? settings.middlewareUrl || settings.middlewareUrl
        : settings.sandboxUrl || settings.middlewareUrl;

    if (!baseUrl) {
        throw new Error('LHDN API URL not configured');
    }

    return {
        baseUrl,
        environment: settings.environment,
        timeout: parseInt(settings.timeout) || 60000,
        retryEnabled: settings.retryEnabled !== false,
        maxRetries: settings.maxRetries || 3,
        retryDelay: settings.retryDelay || 3000,
        maxRetryDelay: settings.maxRetryDelay || 60000
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
        ? settings.middlewareUrl || settings.middlewareUrl
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
    try {
      await prisma.wP_LOGS.create({
        data: {
          Description: description,
          CreateTS: new Date().toISOString(),
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
      if (!this.req || !this.req.session || !this.req.session.accessToken) {
        throw new Error('No valid authentication token found in session');
      }

      const token = this.req.session.accessToken;
      console.log("Using Login Authentication Token from session");

      // Get settings for validateCustomerTin
      const settings = await getConfig();

      const result = await validateCustomerTin(settings, tin, idType, idValue, token);
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

      const companyIndustry = await lookupCompanyIndustry(company);
      const processedData = processExcelData(rawData, { companyIndustry });
      if (!processedData || !Array.isArray(processedData) || processedData.length === 0) {
        throw new Error('No valid documents found in Excel file');
      }

      return processedData;
    } catch (error) {
      console.error('Error processing document data:', error);
      throw error;
    }
  }

  async getProcessedDataConsolidated(fileName, type, company, date, data = null) {
    try {
      const filePath = await this.constructFilePathConsolidated(fileName, type, company, date);

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

      const companyIndustry = await lookupCompanyIndustry(company);
      const processedData = processExcelData(rawData, { companyIndustry });
      if (!processedData || !Array.isArray(processedData) || processedData.length === 0) {
        throw new Error('No valid documents found in Excel file');
      }

      return processedData;
    } catch (error) {
      console.error('Error processing document data:', error);
      throw error;
    }
  }


  async constructFilePathConsolidated(fileName, type, company, date) {
    try {
      if (!fileName || !type || !company || !date) {
        throw new Error('Missing required parameters for file path construction');
      }


      const networkPath = 'C:\\SFTPRoot_Consolidation';

      const config = await getActiveSAPConfig();
      if (!config.success) {
        throw new Error(config.error || 'Failed to get SAP configuration');
      }

      // Format the date consistently
      const formattedDate = moment(date).format('YYYY-MM-DD');
   //  console.log('Formatted date:', formattedDate);

      // Construct the full path WITHOUT duplicating "Incoming"
      const filePath = path.join(networkPath, 'Incoming', company, formattedDate, fileName);
     // console.log('Constructed file path:', filePath);

      // Verify the file exists
      if (!fs.existsSync(filePath)) {
        console.error(`File not found at path: ${filePath}`);
        console.error('Path components:', {
          networkPath,
          company,
          formattedDate,
          fileName
        });
        throw new Error(`File not found: ${fileName}`);
      }

     // console.log('File found at path:', filePath);
      return filePath;
    } catch (error) {
      if (error.message.includes('File not found')) {
        throw error;
      }
      console.error('Error constructing file path:', error);
      throw new Error(`Failed to construct file path: ${error.message}`);
    }
  }

  async constructFilePath(fileName, type, company, date) {
    try {
      if (!fileName || !type || !company || !date) {
        throw new Error('Missing required parameters for file path construction');
      }

     // console.log('Constructing file path with:', {
     //   fileName,
     //   type,
     //   company,
     //   date,
     // });

      const config = await getActiveSAPConfig();
      if (!config.success) {
        throw new Error(config.error || 'Failed to get SAP configuration');
      }

      // Use the networkPath from config
      const networkPath = config.networkPath;
      if (!networkPath) {
        throw new Error('Network path not found in SAP configuration');
      }

     // console.log('Using network path:', networkPath);

      // Format the date consistently
      const formattedDate = moment(date).format('YYYY-MM-DD');
     // console.log('Formatted date:', formattedDate);

      // Construct the full path
      const filePath = path.join(networkPath, type, company, formattedDate, fileName);
     // console.log('Constructed file path:', filePath);

      // Verify the file exists with enhanced error handling
      if (!fs.existsSync(filePath)) {
        console.error(`File not found at path: ${filePath}`);
        console.error('Path components:', {
          networkPath,
          type,
          company,
          formattedDate,
          fileName
        });

        // Check if the directory exists to provide more specific error information
        const directoryPath = path.join(networkPath, type, company, formattedDate);
        const directoryExists = fs.existsSync(directoryPath);
        const networkPathExists = fs.existsSync(networkPath);
        const typePathExists = fs.existsSync(path.join(networkPath, type));
        const companyPathExists = fs.existsSync(path.join(networkPath, type, company));

        console.error('Directory existence check:', {
          networkPath: networkPathExists,
          typePath: typePathExists,
          companyPath: companyPathExists,
          fullDirectory: directoryExists,
          directoryPath
        });

        // Provide more detailed error message based on what exists
        let errorMessage = `File not found: ${fileName}`;
        let errorDetails = [];

        if (!networkPathExists) {
          errorMessage = `Network path is not accessible: ${networkPath}`;
          errorDetails.push('The configured network path cannot be accessed. Please check your SAP configuration and network connectivity.');
        } else if (!typePathExists) {
          errorMessage = `Document type directory not found: ${type}`;
          errorDetails.push(`The document type directory "${type}" does not exist in the network path.`);
        } else if (!companyPathExists) {
          errorMessage = `Company directory not found: ${company}`;
          errorDetails.push(`The company directory "${company}" does not exist under document type "${type}".`);
        } else if (!directoryExists) {
          errorMessage = `Date directory not found: ${formattedDate}`;
          errorDetails.push(`The date directory "${formattedDate}" does not exist under company "${company}".`);
        } else {
          errorMessage = `File not found in directory: ${fileName}`;
          errorDetails.push(`The file "${fileName}" does not exist in the expected directory.`);

          // Try to list files in the directory to help with debugging
          try {
            const filesInDirectory = fs.readdirSync(directoryPath);
            console.log('Files in directory:', filesInDirectory);
            if (filesInDirectory.length > 0) {
              errorDetails.push(`Available files in directory: ${filesInDirectory.slice(0, 10).join(', ')}${filesInDirectory.length > 10 ? '...' : ''}`);
            } else {
              errorDetails.push('The directory is empty.');
            }
          } catch (readDirError) {
            console.error('Error reading directory:', readDirError);
            errorDetails.push('Unable to read directory contents.');
          }
        }

        const fullErrorMessage = `${errorMessage}\n\nPath Details:\n- Full Path: ${filePath}\n- Network Path: ${networkPath}\n- Type: ${type}\n- Company: ${company}\n- Date: ${formattedDate}\n- File: ${fileName}\n\nTroubleshooting:\n${errorDetails.join('\n')}`;

        throw new Error(fullErrorMessage);
      }

      //console.log('File found at path:', filePath);
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
      // Get token from session
      let token;

      // First try to get token from the request session
      if (this.req && this.req.session && this.req.session.accessToken) {
        console.log('Using existing token from session');
        token = this.req.session.accessToken;
      } else {
        // Fallback to getting a new token only if not available in session
        console.log('No token found in session, getting a new one');
        token = await getTokenSession();
      }

      if (!token) {
        throw new Error('No valid authentication token found');
      }

      // Extract and log the document TIN for debugging
      if (docs && docs.length > 0 && docs[0].document) {
        try {
          const docJson = JSON.parse(Buffer.from(docs[0].document, 'base64').toString());
          const partyIds = docJson?.Invoice?.[0]?.AccountingSupplierParty?.[0]?.Party?.[0]?.PartyIdentification || [];
          const tinNode = partyIds.find((ident) => ident?.ID?.[0]?.schemeID === 'TIN');
          const docTin = tinNode?.ID?.[0]?._ || 'TIN not found';
          console.log('Document Supplier TIN:', docTin);

          if (this.req && this.req.session && this.req.session.user) {
            console.log('Session User TIN:', this.req.session.user.tin || 'Not available');
          }
        } catch (parseError) {
          console.error('Error parsing document to extract TIN:', parseError);
        }
      }

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

      // Check if response is successful but empty
      if (result.status === 'success' && (!result.data || result.data === undefined)) {
        return {
          status: 'failed',
          error: {
            code: 'INVALID_RESPONSE',
            message: 'LHDN returned an invalid response format. No documents were accepted or rejected.',
            details: [{
              code: 'INVALID_RESPONSE',
              message: 'The LHDN API returned a success status but with no document details. Please try again later.',
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

      // Check if the result doesn't have expected properties
      if (result.data && !result.data.acceptedDocuments && !result.data.rejectedDocuments) {
        return {
          status: 'failed',
          error: {
            code: 'UNEXPECTED_RESPONSE',
            message: 'LHDN returned an unexpected response format. Please verify the document status manually.',
            details: [{
              code: 'UNEXPECTED_RESPONSE',
              message: 'The API response did not contain information about accepted or rejected documents.',
              target: docs[0]?.codeNumber || 'Unknown',
              response: JSON.stringify(result)
            }]
          }
        };
      }

      // If we have an empty acceptedDocuments array, inform the user
      if (result.data && Array.isArray(result.data.acceptedDocuments) && result.data.acceptedDocuments.length === 0 &&
          (!result.data.rejectedDocuments || result.data.rejectedDocuments.length === 0)) {
        return {
          status: 'failed',
          error: {
            code: 'NO_DOCUMENT_PROCESSED',
            message: 'No documents were accepted or rejected by LHDN. The submission may not have been processed correctly.',
            details: [{
              code: 'NO_DOCUMENT_PROCESSED',
              message: 'The LHDN API returned empty document lists. Please verify the document status in the LHDN portal.',
              target: docs[0]?.codeNumber || 'Unknown'
            }]
          }
        };
      }

      return result;
    } catch (error) {
      // Improved error logging
      console.error('Error submitting document:', {
        message: error.message,
        code: error.response?.data?.code,
        details: error.response?.data?.error?.details || error.response?.data?.details,
        fullError: JSON.stringify(error.response?.data, null, 2)
      });

      // Handle network errors specifically
      if (error.message && (
          error.message.includes('timeout') ||
          error.message.includes('network') ||
          error.message.includes('ETIMEDOUT') ||
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('ENOTFOUND'))) {
        return {
          status: 'failed',
          error: {
            code: 'NETWORK_ERROR',
            message: 'Network error while connecting to LHDN. Please check your internet connection.',
            details: [{
              code: 'NETWORK_ERROR',
              message: `Network communication error: ${error.message}`,
              target: docs[0]?.codeNumber || 'Unknown'
            }]
          }
        };
      }

      // Handle timeout separately
      if (error.code === 'ECONNABORTED' || (error.message && error.message.includes('timeout'))) {
        return {
          status: 'failed',
          error: {
            code: 'TIMEOUT',
            message: 'The connection to LHDN timed out. Please try again later.',
            details: [{
              code: 'TIMEOUT',
              message: 'Request timed out while waiting for LHDN response. The server might be busy.',
              target: docs[0]?.codeNumber || 'Unknown'
            }]
          }
        };
      }

      return {
        status: 'failed',
        error: {
          code: error.response?.data?.code || 'SUBMISSION_ERROR',
          message: error.message || 'Failed to submit document to LHDN',
          details: error.response?.data?.error?.details || error.response?.data?.details || [{
            code: 'UNKNOWN_ERROR',
            message: error.message || 'An unknown error occurred during submission',
            target: docs[0]?.codeNumber || 'Unknown'
          }]
        }
      };
    }
  }

  async updateSubmissionStatus(data, transaction = null) {
    try {
      const submissionData = {
        invoice_number: data.invoice_number,
        UUID: data.uuid || 'NA',
        submissionUid: data.submissionUid || 'NA',
        fileName: data.fileName,
        filePath: data.filePath,
        status: data.status,
        date_submitted: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      };

      await prisma.wP_OUTBOUND_STATUS.upsert({
        where: { filePath: data.filePath },
        update: submissionData,
        create: submissionData
      });

      await this.logOperation(`Status Updated to ${data.status} for invoice ${data.invoice_number}`, {
        action: 'STATUS_UPDATE',
        status: data.status
      });

    } catch (error) {
      console.error('Error updating submission status:', error);
      throw error;
    }
  }

  extractInvoiceTypeCode(fileName) {
    const match = fileName.match(/^(\d{2})_/);
    return match ? match[1] : null;
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
      const outgoingBasePath = path.join('C:\\SFTPRoot\\Outgoing', type, company, formattedDate);
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

      // Get config for version
      const lhdnConfig = await prisma.wP_CONFIGURATION.findFirst({
        where: {
          Type: 'LHDN',
          IsActive: true
        }
      });

      const lhdnSettings = lhdnConfig?.Settings ?
        (typeof lhdnConfig.Settings === 'string' ?
          JSON.parse(lhdnConfig.Settings) :
          lhdnConfig.Settings) : {};

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

  async updateExcelWithResponseConsolidated(fileName, type, company, date, uuid, invoice_number) {
    try {
      console.log('=== updateExcelWithResponseConsolidated Start ===');
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
      const outgoingBasePath = path.join('C:\\SFTPRoot_Consolidation', 'Outgoing', company, formattedDate);
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
      const incomingPath = path.join('C:\\SFTPRoot_Consolidation', 'Incoming', company, formattedDate, fileName);

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

      // Get processed data for consolidated files
      const processedData = await this.getProcessedDataConsolidated(fileName, type, company, date);
      console.log('Processed Data:', processedData);

      // Get config for version
      const lhdnConfig = await prisma.wP_CONFIGURATION.findFirst({
        where: {
          Type: 'LHDN',
          IsActive: true
        }
      });

      const lhdnSettings = lhdnConfig?.Settings ?
        (typeof lhdnConfig.Settings === 'string' ?
          JSON.parse(lhdnConfig.Settings) :
          lhdnConfig.Settings) : {};

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