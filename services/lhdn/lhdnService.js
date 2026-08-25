const path = require('path')
const axios = require('axios');
const CryptoJS = require('crypto-js');
const fs = require('fs');
const forge = require('node-forge');
const jsonminify = require('jsonminify');
const crypto = require('crypto');
require('dotenv').config();
const prisma = require('../../src/lib/prisma');
const { getTokenSession } = require('../token-prisma.service');

async function getConfig() {
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

  return settings;
}

async function getTokenAsIntermediary() {
  try {
    const settings = await getConfig();
    const baseUrl = settings.environment === 'production' ?
      settings.middlewareUrl : settings.middlewareUrl;

    const httpOptions = {
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      grant_type: 'client_credentials',
      scope: 'InvoicingAPI'
    };

    const response = await axios.post(
      `${baseUrl}/connect/token`,
      httpOptions,
      {
        headers: {
          'onbehalfof': settings.tin,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    if(response.status === 200) return response.data;
  } catch (err) {
    if (err.response?.status === 429) {
      const rateLimitReset = err.response.headers["x-rate-limit-reset"];
      if (rateLimitReset) {
        const resetTime = new Date(rateLimitReset).getTime();
        const currentTime = Date.now();
        const waitTime = resetTime - currentTime;

        if (waitTime > 0) {
          console.log('=======================================================================================');
          console.log('              LHDN Intermediary Token API hitting rate limit HTTP 429                  ');
          console.log(`              Refetching................. (Waiting time: ${waitTime} ms)                  `);
          console.log('=======================================================================================');
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return await getTokenAsIntermediary();
        }
      }
    }
    throw new Error(`Failed to get token: ${err.message}`);
  }
}

async function submitDocument(docs, token) {
  try {
    console.log('[LHDN Service] submitDocument called');

    if (!token) {
      console.error('[LHDN Service] Authentication token is missing in submitDocument call');
      return {
        status: 'failed',
        error: {
          code: 'AUTH_ERROR',
          message: 'Authentication token is required',
          details: 'No token was provided for LHDN API authentication. Please try logging out and logging in again.'
        }
      };
    }

    if (!docs || !Array.isArray(docs) || docs.length === 0) {
      console.error('[LHDN Service] Invalid or empty documents array provided to submitDocument');
      return {
        status: 'failed',
        error: {
          code: 'INVALID_DOCUMENT',
          message: 'No valid documents provided for submission',
          details: 'The document data is missing or invalid. Please check the document format.'
        }
      };
    }

    const settings = await getConfig();
    const baseUrl = settings.environment === 'production' ?
      settings.middlewareUrl : settings.middlewareUrl;

    console.log('[LHDN Service] LHDN API URL:', `${baseUrl}/api/v1.0/documentsubmissions`);
    console.log('[LHDN Service] Token present:', !!token);
    console.log('[LHDN Service] Token length:', token ? token.length : 0);
    console.log('[LHDN Service] Documents count:', docs.length);

    // Log token preview (first 10 chars only for security)
    if (token) {
      const tokenPreview = token.substring(0, 10) + '...';
      console.log('[LHDN Service] Token preview:', tokenPreview);
    }

    console.log('[LHDN Service] Making API request to LHDN...');

    // Add timeout to prevent hanging requests
    const response = await axios.post(
      `${baseUrl}/api/v1.0/documentsubmissions`,
      { documents: docs },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        timeout: 30000 // 30 seconds timeout
      }
    );

    if (!response.data) {
      console.error('Empty response data from LHDN API');
      return {
        status: 'failed',
        error: {
          code: 'EMPTY_RESPONSE',
          message: 'LHDN API returned an empty response',
          details: 'The server returned a successful status but with no data. Please try again.'
        }
      };
    }

    console.log('LHDN API Response:', JSON.stringify(response.data, null, 2));
    return { status: 'success', data: response.data };
  } catch (err) {
    // Improved error logging - handle LHDN standard error structure
    // According to LHDN standard: https://sdk.myinvois.hasil.gov.my/standard-error-response/
    // Structure: {error: {errorCode: "...", error: "...", innerError: [...]}}
    const errorData = err.response?.data;
    const lhdnError = errorData?.error;
    const errorDetails = lhdnError?.innerError || lhdnError?.details || errorData?.details || [];
    
    console.error('LHDN Submission Error:', {
      status: err.response?.status,
      message: err.message,
      errorCode: lhdnError?.errorCode || errorData?.code,
      error: lhdnError?.error || lhdnError?.message || errorData?.message,
      innerError: lhdnError?.innerError,
      details: errorDetails,
      fullResponse: JSON.stringify(err.response?.data, null, 2)
    });

    // Handle rate limiting
    if (err.response?.status === 429) {
      const rateLimitReset = err.response.headers["x-rate-limit-reset"];
      if (rateLimitReset) {
        const resetTime = new Date(rateLimitReset).getTime();
        const currentTime = Date.now();
        const waitTime = resetTime - currentTime;

        console.log('=======================================================================================');
        console.log('              LHDN SubmitDocument API hitting rate limit HTTP 429                      ');
        console.log('                 Retrying for current iteration.................                       ');
        console.log(`                     (Waiting time: ${waitTime} ms)                                       `);
        console.log('=======================================================================================');

        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return await submitDocument(docs, token);
        }
      }
    }

    // Enhanced error handling with human-readable messages
    // According to LHDN standard: https://sdk.myinvois.hasil.gov.my/standard-error-response/
    // Structure: {error: {errorCode: "...", error: "...", innerError: [...]}}
    const getHumanReadableError = (errorData, defaultMessage = 'Failed to submit document to LHDN. Please check your document and try again.') => {
      // Handle LHDN standard error structure
      const lhdnError = errorData?.error || {};
      
      // Extract errorCode (LHDN standard) or fallback to legacy code field
      const errorCode = lhdnError.errorCode || errorData?.errorCode || errorData?.code || lhdnError.code || 'UNKNOWN_ERROR';
      
      // Extract error message (LHDN uses "error" field for English message)
      // Ensure errorMessage is always a string
      let errorMessage = lhdnError.error || lhdnError.errorMS || errorData?.error || errorData?.message || lhdnError.message || defaultMessage;
      if (typeof errorMessage !== 'string') {
        // If errorMessage is an object, try to extract a string from it
        if (errorMessage && typeof errorMessage === 'object') {
          errorMessage = errorMessage.message || errorMessage.error || errorMessage.errorMS || JSON.stringify(errorMessage);
        } else {
          errorMessage = String(errorMessage || defaultMessage);
        }
      }
      
      // Extract innerError array (LHDN standard) or fallback to details
      let errorDetails = [];
      if (lhdnError.innerError && Array.isArray(lhdnError.innerError) && lhdnError.innerError.length > 0) {
        // Convert LHDN innerError structure to our details format
        errorDetails = lhdnError.innerError.map(innerErr => ({
          code: innerErr.errorCode || errorCode,
          errorCode: innerErr.errorCode,
          message: innerErr.error || innerErr.errorMS || errorMessage,
          error: innerErr.error,
          errorMS: innerErr.errorMS,
          propertyName: innerErr.propertyName,
          propertyPath: innerErr.propertyPath,
          target: innerErr.target || innerErr.propertyName || docs[0]?.codeNumber || 'Unknown'
        }));
      } else if (lhdnError.details && Array.isArray(lhdnError.details)) {
        errorDetails = lhdnError.details;
      } else if (errorData?.details && Array.isArray(errorData.details)) {
        errorDetails = errorData.details;
      }

      // Map of LHDN error codes to user-friendly messages and potential details
      const errorMap = {
        'DS302': { message: 'This document has already been submitted to LHDN. Please check the document status in LHDN portal.' },
        'CF321': { message: 'Document issue date is invalid. Documents must be submitted within 7 days of issuance.' },
        'CF364': { message: 'Invalid item classification code. Please ensure all items have valid classification codes.' },
        'CF401': { message: 'Tax calculation error. Please verify all tax amounts and calculations in your document.' },
        'CF402': { message: 'Currency error. Please check that all monetary values use the correct currency code.' },
        'CF403': { message: 'Invalid tax code. Please verify the tax codes used in your document.' },
        'CF404': { message: 'Invalid identification. Please check all party identification numbers (TIN, BRN, etc.).' },
        'CF405': { message: 'Invalid party information. Please verify supplier/customer details are complete and valid.' },
        'AUTH001': { message: 'Authentication failure. Your session may have expired, please try logging in again.' },
        'AUTH003': { message: 'Unauthorized access. Your account does not have permission to submit this document.' },
        'VALIDATION_ERROR': { message: 'Document validation failed. Please review the document and correct all errors.' },
        'DUPLICATE_SUBMISSION': { message: 'This document has already been submitted or is being processed.' },
        'E-INVOICE-TIN-VALIDATION-PARTY-VALIDATION': { message: 'TIN validation failed. The document TIN doesn\'t match with your authenticated TIN.' },
        'INVALID_PARAMETER': { message: 'Invalid parameters provided. Please check your document formatting.' },
        'TIN_MISMATCH': { message: 'The Tax Identification Number (TIN) in the document does not match the TIN of the authenticated user.' },
        'SYSTEM_ERROR': { message: 'LHDN system is currently experiencing technical issues. Please try again later or contact LHDN support.' },
        'SystemError': { message: 'LHDN system is currently experiencing technical issues. Please try again later or contact LHDN support.' },
        'Error03': { message: 'Duplicated Submission Validator. This document has already been submitted.' }
      };

      const mappedError = errorMap[errorCode];

      // Prioritize error message from details if available (contains specific error like TIN mismatch)
      let finalMessage = mappedError?.message || errorMessage;
      let finalErrorCode = errorCode;
      
      // If we have error details with a message, prioritize it over generic messages
      if (errorDetails.length > 0 && errorDetails[0].message) {
        const detailMessage = String(errorDetails[0].message || '').trim();
        const detailCode = errorDetails[0].code || errorDetails[0].errorCode;
        
        if (detailMessage) {
          // Check if this is a TIN mismatch error
          const isTINMismatch = detailMessage.toLowerCase().includes('authenticated tin') && 
                                detailMessage.toLowerCase().includes('documents tin') &&
                                detailMessage.toLowerCase().includes('not matching');
          
          if (isTINMismatch) {
            // Use TIN_MISMATCH error code for TIN mismatch errors
            finalErrorCode = 'TIN_MISMATCH';
            finalMessage = detailMessage;
          } else if (errorMessage === defaultMessage || 
              (typeof errorMessage === 'string' && (errorMessage.includes('status code') || errorMessage.includes('HTTP'))) ||
              detailMessage.toLowerCase().includes('tin') || 
              detailMessage.toLowerCase().includes('matching') ||
              detailMessage.toLowerCase().includes('authenticated')) {
            // Use detail message for other specific errors
            finalMessage = detailMessage;
            // Use detail code if available and more specific than generic error code
            if (detailCode && detailCode !== 'UNKNOWN_ERROR' && detailCode !== errorCode) {
              finalErrorCode = detailCode;
            }
          }
        }
      }

      return {
        code: finalErrorCode,
        errorCode: finalErrorCode, // Include both for compatibility
        message: finalMessage,
        error: finalMessage, // Include LHDN standard field
        details: errorDetails.length > 0 ? errorDetails.map(detail => ({
          code: detail.code || finalErrorCode,
          errorCode: detail.errorCode || detail.code || finalErrorCode,
          message: detail.message || finalMessage,
          error: detail.error || detail.message || finalMessage,
          target: detail.target || docs[0]?.codeNumber || 'Unknown'
        })) : [{
          code: finalErrorCode,
          errorCode: finalErrorCode,
          message: finalMessage,
          error: finalMessage,
          target: docs[0]?.codeNumber || 'Unknown'
        }],
        // Include full response for frontend parsing
        fullResponse: JSON.stringify(errorData, null, 2)
      };
    };

    // Handle specific HTTP status codes
    if (err.response) {
      const { status, data } = err.response;

      switch (status) {
        case 400: // Bad Request
          return {
            status: 'failed',
            error: getHumanReadableError(data, 'Invalid document data provided.')
          };
        case 401: // Unauthorized
        case 403: // Forbidden
          return {
            status: 'failed',
            error: getHumanReadableError(data, 'Authentication failed or unauthorized access.')
          };
        case 404: // Not Found
          return {
            status: 'failed',
            error: getHumanReadableError(data, 'The requested resource was not found.')
          };
        case 500: // Internal Server Error
          return {
            status: 'failed',
            error: getHumanReadableError(data, 'LHDN internal server error.')
          };
        default:
          // Handle other HTTP errors
          return {
            status: 'failed',
            error: {
              code: `HTTP_ERROR_${status}`,
              message: `LHDN API returned HTTP status ${status}`,
              details: data?.message || err.message
            }
          };
      }
    } else if (err.request) {
      // The request was made but no response was received
      console.error('LHDN Submission Error: No response received', err.request);
      return {
        status: 'failed',
        error: {
          code: 'NO_RESPONSE',
          message: 'No response received from LHDN API. Please check your network connection or try again later.',
          details: err.message
        }
      };
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('LHDN Submission Error: Request setup error', err.message);
      return {
        status: 'failed',
        error: {
          code: 'REQUEST_ERROR',
          message: 'Error setting up request to LHDN API.',
          details: err.message
        }
      };
    }
  }
}

async function getDocumentDetails(irb_uuid, token) {
  try {
    const settings = await getConfig();
    const baseUrl = settings.environment === 'production' ?
      settings.middlewareUrl : settings.middlewareUrl;

    const response = await axios.get(
      `${baseUrl}/api/v1.0/documents/${irb_uuid}/details`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        }
      }
    );

    return { status: 'success', data: response.data };
  } catch (err) {
    if (err.response?.status === 429) {
      const rateLimitReset = err.response.headers["x-rate-limit-reset"];
      if (rateLimitReset) {
        const resetTime = new Date(rateLimitReset).getTime();
        const currentTime = Date.now();
        const waitTime = resetTime - currentTime;

        console.log('=======================================================================================');
        console.log('              LHDN DocumentDetails API hitting rate limit HTTP 429                      ');
        console.log('                 Retrying for current iteration.................                       ');
        console.log(`                     (Waiting time: ${waitTime} ms)                                       `);
        console.log('=======================================================================================');

        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return await getDocumentDetails(irb_uuid, token);
        }
      }
    }
    console.error(`Failed to get IRB document details for document UUID ${irb_uuid}:`, err.message);
    throw err;
  }
}

async function cancelValidDocumentBySupplier(irb_uuid, cancellation_reason, token) {
  try {
    const settings = await getConfig();
    const baseUrl = settings.environment === 'production' ?
      settings.middlewareUrl : settings.middlewareUrl;

    const payload = {
      status: 'cancelled',
      reason: cancellation_reason || 'NA'
    };

    const response = await axios.put(
      `${baseUrl}/api/v1.0/documents/state/${irb_uuid}/state`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        }
      }
    );

    return { status: 'success', data: response.data };
  } catch (err) {
    if (err.response?.status === 429) {
      const rateLimitReset = err.response.headers["x-rate-limit-reset"];
      if (rateLimitReset) {
        const resetTime = new Date(rateLimitReset).getTime();
        const currentTime = Date.now();
        const waitTime = resetTime - currentTime;

        console.log('=======================================================================================');
        console.log('              LHDN Cancel Document API hitting rate limit HTTP 429                      ');
        console.log('                 Retrying for current iteration.................                       ');
        console.log(`                     (Waiting time: ${waitTime} ms)                                       `);
        console.log('=======================================================================================');

        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return await cancelValidDocumentBySupplier(irb_uuid, cancellation_reason, token);
        }
      }
    }
    console.error(`Failed to cancel document for IRB UUID ${irb_uuid}:`, err.message);
    throw err;
  }
}

function jsonToBase64(jsonObj) {
    const jsonString = JSON.stringify(jsonObj);
    const base64String = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(jsonString));
    return base64String;
}

function calculateSHA256(jsonObj) {
    const jsonString = JSON.stringify(jsonObj);
    const hash = CryptoJS.SHA256(jsonString);
    return hash.toString(CryptoJS.enc.Hex);
}

function getCertificatesHashedParams(documentJson) {
  //Note: Supply your JSON without Signature and UBLExtensions
  let jsonStringifyData = JSON.stringify(documentJson)
  const minifiedJsonData = jsonminify(jsonStringifyData);

  const sha256Hash = crypto.createHash('sha256').update(minifiedJsonData, 'utf8').digest('base64');
  const docDigest = sha256Hash;

  const privateKeyPath = path.join(__dirname, 'eInvoiceCertificates', process.env.PRIVATE_KEY_FILE_PATH);
  const certificatePath = path.join(__dirname, 'eInvoiceCertificates', process.env.PRIVATE_CERT_FILE_PATH);

  const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');
  const certificatePem = fs.readFileSync(certificatePath, 'utf8');

  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);

  const md = forge.md.sha256.create();
  //NOTE DEV: 12/7/2024 - sign the raw json instead of hashed json
  // md.update(docDigest, 'utf8'); //disable this (no longer work)
  md.update(minifiedJsonData, 'utf8'); //enable this
  const signature = privateKey.sign(md);
  const signatureBase64 = forge.util.encode64(signature);

  // =============================================================
  // Calculate cert Digest
  // =============================================================
  const certificate = forge.pki.certificateFromPem(certificatePem);
  const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();

  const sha256 = crypto.createHash('sha256').update(derBytes, 'binary').digest('base64');
  const certDigest = sha256;

  // =============================================================
  // Calculate the signed properties section digest
  // =============================================================
  let signingTime = new Date().toISOString()
  let signedProperties =
  {
    "Target": "signature",
    "SignedProperties": [
      {
        "Id": "id-xades-signed-props",
        "SignedSignatureProperties": [
            {
              "SigningTime": [
                {
                  "_": signingTime
                }
              ],
              "SigningCertificate": [
                {
                  "Cert": [
                    {
                      "CertDigest": [
                        {
                          "DigestMethod": [
                            {
                              "_": "",
                              "Algorithm": "http://www.w3.org/2001/04/xmlenc#sha256"
                            }
                          ],
                          "DigestValue": [
                            {
                              "_": certDigest
                            }
                          ]
                        }
                      ],
                      "IssuerSerial": [
                        {
                          "X509IssuerName": [
                            {
                              "_": process.env.X509IssuerName_VALUE
                            }
                          ],
                          "X509SerialNumber": [
                            {
                              "_": process.env.X509SerialNumber_VALUE
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
      }
    ]
  }

  const signedpropsString = JSON.stringify(signedProperties);
  const signedpropsHash = crypto.createHash('sha256').update(signedpropsString, 'utf8').digest('base64');

  // return ({
  //     docDigest, // docDigest
  //     signatureBase64, // sig,
  //     certDigest,
  //     signedpropsHash, // propsDigest
  //     signingTime
  // })

  let certificateJsonPortion_Signature = [
      {
          "ID": [
            {
                "_": "urn:oasis:names:specification:ubl:signature:Invoice"
            }
          ],
          "SignatureMethod": [
            {
                "_": "urn:oasis:names:specification:ubl:dsig:enveloped:xades"
            }
          ]
      }
  ]

  let certificateJsonPortion_UBLExtensions = [
    {
      "UBLExtension": [
        {
          "ExtensionURI": [
            {
              "_": "urn:oasis:names:specification:ubl:dsig:enveloped:xades"
            }
          ],
          "ExtensionContent": [
            {
              "UBLDocumentSignatures": [
                {
                  "SignatureInformation": [
                    {
                      "ID": [
                        {
                          "_": "urn:oasis:names:specification:ubl:signature:1"
                        }
                      ],
                      "ReferencedSignatureID": [
                        {
                          "_": "urn:oasis:names:specification:ubl:signature:Invoice"
                        }
                      ],
                      "Signature": [
                        {
                          "Id": "signature",
                          "SignedInfo": [
                            {
                              "SignatureMethod": [
                                {
                                  "_": "",
                                  "Algorithm": "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"
                                }
                              ],
                              "Reference": [
                                {
                                  "Id": "id-doc-signed-data",
                                  "URI": "",
                                  "DigestMethod": [
                                    {
                                      "_": "",
                                      "Algorithm": "http://www.w3.org/2001/04/xmlenc#sha256"
                                    }
                                  ],
                                  "DigestValue": [
                                    {
                                      "_": docDigest
                                    }
                                  ]
                                },
                                {
                                  "Id": "id-xades-signed-props",
                                  "Type": "http://uri.etsi.org/01903/v1.3.2#SignedProperties",
                                  "URI": "#id-xades-signed-props",
                                  "DigestMethod": [
                                    {
                                      "_": "",
                                      "Algorithm": "http://www.w3.org/2001/04/xmlenc#sha256"
                                    }
                                  ],
                                  "DigestValue": [
                                    {
                                      "_": signedpropsHash
                                    }
                                  ]
                                }
                              ]
                            }
                          ],
                          "SignatureValue": [
                            {
                              "_": signatureBase64
                            }
                          ],
                          "KeyInfo": [
                            {
                              "X509Data": [
                                {
                                  "X509Certificate": [
                                    {
                                      "_": process.env.X509Certificate_VALUE
                                    }
                                  ],
                                  "X509SubjectName": [
                                    {
                                      "_": process.env.X509SubjectName_VALUE
                                    }
                                  ],
                                  "X509IssuerSerial": [
                                    {
                                      "X509IssuerName": [
                                        {
                                          "_": process.env.X509IssuerName_VALUE
                                        }
                                      ],
                                      "X509SerialNumber": [
                                        {
                                          "_": process.env.X509SerialNumber_VALUE
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ],
                          "Object": [
                            {
                              "QualifyingProperties": [
                                {
                                  "Target": "signature",
                                  "SignedProperties": [
                                    {
                                      "Id": "id-xades-signed-props",
                                      "SignedSignatureProperties": [
                                        {
                                          "SigningTime": [
                                            {
                                              "_": signingTime
                                            }
                                          ],
                                          "SigningCertificate": [
                                            {
                                              "Cert": [
                                                {
                                                  "CertDigest": [
                                                    {
                                                      "DigestMethod": [
                                                        {
                                                          "_": "",
                                                          "Algorithm": "http://www.w3.org/2001/04/xmlenc#sha256"
                                                        }
                                                      ],
                                                      "DigestValue": [
                                                        {
                                                          "_": certDigest
                                                        }
                                                      ]
                                                    }
                                                  ],
                                                  "IssuerSerial": [
                                                    {
                                                      "X509IssuerName": [
                                                        {
                                                          "_": process.env.X509IssuerName_VALUE
                                                        }
                                                      ],
                                                      "X509SerialNumber": [
                                                        {
                                                          "_": process.env.X509SerialNumber_VALUE
                                                        }
                                                      ]
                                                    }
                                                  ]
                                                }
                                              ]
                                            }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]

  //Use this return value to inject back into your raw JSON Invoice[0] without Signature/UBLExtension earlier
  //Then, encode back to SHA256 and Base64 respectively for object value inside Submission Document payload.
  return ({
    certificateJsonPortion_Signature,
    certificateJsonPortion_UBLExtensions
  })

}

async function testIRBCall(data) {
  try {
    const response = await axios.post(`${process.env.PREPROD_BASE_URL}/connect/token`, httpOptions, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if(response.status == 200) return response.data;
  } catch (err) {
    if (err.response.status == 429) {
      console.log('Current iteration hitting Rate Limit 429 of LHDN Taxpayer Token API, retrying...')
      const rateLimitReset = err.response.headers["x-rate-limit-reset"];

      if (rateLimitReset) {
        const resetTime = new Date(rateLimitReset).getTime();
        const currentTime = Date.now();
        const waitTime = resetTime - currentTime;

        if (waitTime > 0) {
          console.log('=======================================================================================');
          console.log('         (TEST API CALL) LHDN Taxpayer Token API hitting rate limit HTTP 429           ');
          console.log(`              Refetching................. (Waiting time: ${waitTime} ms)               `);
          console.log('=======================================================================================');
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return await getTokenAsTaxPayer();
        }
      }
    } else {
      throw new Error(`Failed to get token: ${err.message}`);
    }
  }
}

async function validateCustomerTin(settings, tin, idType, idValue, token) {
  try {
    if (!['NRIC', 'BRN', 'PASSPORT', 'ARMY'].includes(idType)) {
      throw new Error(`Invalid ID type. Only 'NRIC', 'BRN', 'PASSPORT', 'ARMY' are allowed`);
    }

    if (!settings) {
      settings = await getConfig();
    }

    const baseUrl = settings.environment === 'production' ?
      settings.middlewareUrl : settings.middlewareUrl;

    const response = await axios.get(
      `${baseUrl}/api/v1.0/taxpayer/validate/${tin}?idType=${idType}&idValue=${idValue}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (response.status === 200) {
      return { status: 'success' };
    }
  } catch (err) {
    if (err.response?.status === 429) {
      const rateLimitReset = err.response.headers["x-rate-limit-reset"];
      if (rateLimitReset) {
        const resetTime = new Date(rateLimitReset).getTime();
        const currentTime = Date.now();
        const waitTime = resetTime - currentTime;

        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return await validateCustomerTin(settings, tin, idType, idValue, token);
        }
      }
    }
    throw err;
  }
}

module.exports = {
    submitDocument,
    validateCustomerTin,
    getTokenAsIntermediary,
    cancelValidDocumentBySupplier,
    getDocumentDetails,
    jsonToBase64,
    calculateSHA256,
    getCertificatesHashedParams,
    testIRBCall
};
