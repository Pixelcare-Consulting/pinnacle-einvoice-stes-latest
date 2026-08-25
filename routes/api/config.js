const express = require('express');
const router = express.Router();
const { validateAndFormatNetworkPath, SERVER_CONFIG, testNetworkPathAccessibility } = require('../../config/paths');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const prisma = require('../../src/lib/prisma');
const tokenService = require('../../services/token-prisma.service');
const multer = require('multer');
const crypto = require('crypto');
const forge = require('node-forge');

// Note: Authentication is handled by auth.isApiAuthenticated middleware in server.js

// Get SAP configuration
router.get('/sap/get-config', async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.user || !req.user.id) {
            console.log('User not authenticated:', req.user);
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }

        // Get configuration from database
        console.log('Fetching config for user:', req.user.id);
        const config = await prisma.wP_CONFIGURATION.findFirst({
            where: {
                Type: 'SAP',
                IsActive: true
            },
            orderBy: {
                CreateTS: 'desc'
            }
        });

        console.log('Found config:', config);

        // Parse settings if it's a string
        let settings = config?.Settings;
        if (typeof settings === 'string') {
            try {
                settings = JSON.parse(settings);
            } catch (error) {
                console.error('Error parsing settings:', error);
                settings = {};
            }
        }

        // Set proper content type and return response
        res.setHeader('Content-Type', 'application/json');
        return res.json({
            success: true,
            networkPath: settings?.networkPath || '',
            settings: settings || {
                networkPath: '',
                domain: '',
                username: ''
            }
        });
    } catch (error) {
        console.error('Error getting SAP config:', error);
        res.setHeader('Content-Type', 'application/json');
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to load SAP configuration'
        });
    }
});

// Validate SAP network path
router.post('/sap/validate-path', async (req, res) => {
    try {
        const { networkPath, domain, username, password } = req.body;

        // Input validation
        if (!networkPath || !username || !password) {
            throw new Error('Network path, username and password are required');
        }

        // Format and validate the network path
        const formattedPath = await validateAndFormatNetworkPath(networkPath);

        // Test network path accessibility
        const accessResult = await testNetworkPathAccessibility(formattedPath, {
            serverName: domain || '',
            serverUsername: username,
            serverPassword: password
        });

        if (!accessResult.success) {
            throw new Error(accessResult.error || 'Network path validation failed');
        }

        res.json({
            success: true,
            message: 'Network path validation successful',
            formattedPath: accessResult.formattedPath
        });

    } catch (error) {
        console.error('Error validating SAP path:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Save SAP configuration
router.post('/sap/save-config', async (req, res) => {
    try {
        const { networkPath, domain, username, password } = req.body;

        // Input validation
        if (!networkPath || !username || !password) {
            throw new Error('Network path, username and password are required');
        }

        // Format the network path
        const formattedPath = await validateAndFormatNetworkPath(networkPath);

        // Save to database
        const settings = {
            networkPath: formattedPath,
            domain: domain || '',
            username,
            password
        };

        // Find current active configuration
        const currentConfig = await prisma.wP_CONFIGURATION.findFirst({
            where: {
                Type: 'SAP',
                IsActive: true
            },
            orderBy: {
                CreateTS: 'desc'
            }
        });

        if (currentConfig) {
            // Update existing configuration
            await prisma.wP_CONFIGURATION.update({
                where: {
                    ID: currentConfig.ID
                },
                data: {
                    Settings: JSON.stringify(settings),
                    UpdateTS: new Date()
                }
            });
        } else {
            // Create new configuration
            await prisma.wP_CONFIGURATION.create({
                data: {
                    Type: 'SAP',
                    Settings: JSON.stringify(settings),
                    IsActive: true,
                    UserID: String(req.user.id),
                    CreateTS: new Date(),
                    UpdateTS: new Date()
                }
            });
        }

        // Update SERVER_CONFIG for current session
        SERVER_CONFIG.networkPath = formattedPath;
        SERVER_CONFIG.credentials = {
            domain: domain || '',
            username,
            password
        };

        res.json({
            success: true,
            message: 'SAP configuration saved successfully',
            config: {
                networkPath: formattedPath,
                domain: domain || '',
                username
                // Don't send password back
            }
        });
    } catch (error) {
        console.error('Error saving SAP config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get LHDN configuration
router.get('/lhdn/get-config', async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.user || !req.user.id) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }

        // First try to get global configuration
        const config = await prisma.wP_CONFIGURATION.findFirst({
            where: {
                Type: 'LHDN',
                IsActive: true
            },
            orderBy: {
                CreateTS: 'desc'
            }
        });

        // Parse settings if it's a string
        let settings = config?.Settings;
        if (typeof settings === 'string') {
            try {
                settings = JSON.parse(settings);
            } catch (error) {
                console.error('Error parsing settings:', error);
                settings = {};
            }
        }

        // Add last modified info if available
        if (config && config.UserID) {
            const lastModifiedUser = await prisma.wP_USER_REGISTRATION.findFirst({
                where: { ID: parseInt(config.UserID) },
                select: {
                    FullName: true,
                    Username: true
                }
            });
            if (lastModifiedUser) {
                settings.lastModifiedBy = {
                    name: lastModifiedUser.FullName,
                    username: lastModifiedUser.Username,
                    timestamp: config.UpdateTS
                };
            }
        }

        res.json({
            success: true,
            config: settings || {}
        });
    } catch (error) {
        console.error('Error loading LHDN config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Save LHDN configuration
router.post('/lhdn/save-config', async (req, res) => {
    try {
        const { environment, middlewareUrl, clientId, clientSecret, timeout, retryEnabled } = req.body;

        // Input validation
        if (!clientId || !clientSecret) {
            throw new Error('Client ID and Client Secret are required');
        }

        if (!['sandbox', 'production'].includes(environment)) {
            throw new Error('Invalid environment specified');
        }

        if (timeout && (isNaN(timeout) || timeout < 0)) {
            throw new Error('Timeout must be a positive number');
        }

        // Find current active configuration
        const currentConfig = await prisma.wP_CONFIGURATION.findFirst({
            where: {
                Type: 'LHDN',
                IsActive: true
            },
            orderBy: {
                CreateTS: 'desc'
            }
        });

        // Save configuration
        const settings = {
            environment,
            middlewareUrl,
            clientId,
            clientSecret,
            timeout: timeout || 30,
            retryEnabled: !!retryEnabled
        };

        // Use Prisma transaction
        const result = await prisma.$transaction(async (prismaClient) => {
            if (currentConfig) {
                // Update existing configuration
                await prismaClient.wP_CONFIGURATION.update({
                    where: {
                        ID: currentConfig.ID
                    },
                    data: {
                        Settings: JSON.stringify(settings),
                        UpdateTS: new Date()
                    }
                });
            } else {
                // Create new configuration if none exists
                await prismaClient.wP_CONFIGURATION.create({
                    data: {
                        Type: 'LHDN',
                        Settings: JSON.stringify(settings),
                        IsActive: true,
                        UserID: String(req.user.id),
                        CreateTS: new Date(),
                        UpdateTS: new Date()
                    }
                });
            }

            // Log the configuration change
            await prismaClient.wP_LOGS.create({
                data: {
                    Description: `LHDN configuration ${currentConfig ? 'updated' : 'created'} by ${req.user.username} (${environment}, ${middlewareUrl})`,
                    CreateTS: new Date().toISOString(), // Convert to ISO string format
                    LoggedUser: req.user.username,
                    LogType: 'CONFIG',
                    Module: 'LHDN',
                    Action: 'UPDATE',
                    Status: 'SUCCESS',
                    UserID: req.user.id,
                    IPAddress: req.ip || null
                }
            });

            return {
                success: true,
                message: `LHDN configuration ${currentConfig ? 'updated' : 'created'} successfully`
            };
        });

        res.json({
            ...result,
            config: {
                environment,
                middlewareUrl,
                clientId,
                timeout,
                retryEnabled
                // Don't send clientSecret back
            }
        });
    } catch (error) {
        console.error('Error saving LHDN config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test LHDN connection
router.post('/lhdn/test-connection', async (req, res) => {
    try {
        const { environment, middlewareUrl, clientId, clientSecret } = req.body;

        // Input validation
        if (!middlewareUrl || !clientId || !clientSecret) {
            return res.status(400).json({
                success: false,
                error: 'Middleware URL, Client ID, and Client Secret are required'
            });
        }

        // Validate the credentials
        const validationResult = await tokenService.validateCredentials({
            baseUrl: middlewareUrl,
            clientId,
            clientSecret,
            environment
        });

        if (!validationResult.success) {
            return res.status(400).json({
                success: false,
                error: validationResult.error || 'Failed to validate credentials'
            });
        }

        res.json({
            success: true,
            message: 'Connection test successful',
            expiresIn: validationResult.expiresIn
        });
    } catch (error) {
        console.error('Error testing LHDN connection:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// Add this new route for getting access token
router.get('/lhdn/access-token', async (req, res) => {
    try {
        // Read token directly from AuthorizeToken.ini file
        const accessToken = tokenService.readTokenFromFile();

        if (!accessToken) {
            return res.status(404).json({
                success: false,
                error: 'No access token found in AuthorizeToken.ini file'
            });
        }

        res.json({
            success: true,
            accessToken,
            expiryTime: null // We don't track expiry time from file in this simple approach
        });
    } catch (error) {
        console.error('Error getting access token:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Digital Certificate Routes
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, path.join(__dirname, '../../certificates')); // Store in certificates directory
    },
    filename: function(req, file, cb) {
        // Generate unique filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'cert-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function(req, file, cb) {
        // Accept only .p12 and .pfx files
        if (file.originalname.match(/\.(p12|pfx)$/)) {
            cb(null, true);
        } else {
            cb(new Error('Only .p12 or .pfx certificate files are allowed'));
        }
    }
});

// Get certificate configuration
router.get('/certificate/get-config', async (req, res) => {
    try {
        const config = await prisma.wP_CONFIGURATION.findFirst({
            where: {
                Type: 'CERTIFICATE',
                IsActive: true
            },
            orderBy: {
                CreateTS: 'desc'
            }
        });

        if (!config) {
            return res.json({
                success: true,
                config: null
            });
        }

        // Parse settings
        let settings = typeof config.Settings === 'string' ? JSON.parse(config.Settings) : config.Settings;

        // Add last modified info
        if (config.UserID) {
            const lastModifiedUser = await prisma.wP_USER_REGISTRATION.findFirst({
                where: { ID: parseInt(config.UserID) },
                select: {
                    FullName: true,
                    Username: true
                }
            });

            if (lastModifiedUser) {
                settings.lastModifiedBy = {
                    name: lastModifiedUser.FullName,
                    username: lastModifiedUser.Username,
                    timestamp: config.UpdateTS
                };
            }
        }

        res.json({
            success: true,
            config: settings
        });

    } catch (error) {
        console.error('Error getting certificate config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update certificate validation endpoint
router.post('/certificate/validate', upload.single('certificate'), async (req, res) => {
    try {
        if (!req.file) {
            throw new Error('No certificate file uploaded');
        }

        const password = req.body.password;
        if (!password) {
            throw new Error('Certificate password is required');
        }

        try {
            const certBuffer = fs.readFileSync(req.file.path);
            const p12Der = forge.util.createBuffer(certBuffer.toString('binary'));
            const p12Asn1 = forge.asn1.fromDer(p12Der);
            const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

            const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
            if (!certBags || certBags.length === 0) {
                throw new Error('No certificate found in file');
            }

            const cert = certBags[0].cert;

            console.log('Certificate subject attributes:', JSON.stringify(cert.subject.attributes, null, 2));

            // Map LHDN required fields to certificate subject attributes
            const subjectMap = {
                CN: null,  // Common Name
                C: null,   // Country
                O: null,   // Organization
                OID: null, // Organization Identifier (Business Registration)
                SERIALNUMBER: null // Serial Number
            };

            // Parse subject attributes and handle special cases
            let subjectString = '';
            cert.subject.attributes.forEach(attr => {
                console.log('Processing attribute:', JSON.stringify(attr));

                // Build subject string for debugging and additional parsing
                if (attr.shortName) {
                    subjectString += `${attr.shortName}=${attr.value},`;
                } else if (attr.name) {
                    subjectString += `${attr.name}=${attr.value},`;
                } else {
                    // Handle attributes without shortName or name
                    subjectString += `undefined=${attr.value},`;
                    console.log('Found attribute without shortName or name:', attr.value);

                    // Check if this undefined attribute contains the OID
                    if (attr.value && (attr.value.match(/^C[0-9]+O$/) || attr.value.match(/^C[0-9]+0$/))) {
                        console.log('Found OID in undefined attribute:', attr.value);
                        subjectMap.OID = attr.value;
                    }
                }

                // Standard attribute mapping
                if (attr.shortName === 'organizationIdentifier' || attr.shortName === 'OID' || attr.shortName === 'ORG_ID') {
                    console.log('Found standard OID attribute:', attr.shortName, attr.value);
                    subjectMap.OID = attr.value;
                } else if (attr.shortName in subjectMap) {
                    subjectMap[attr.shortName] = attr.value;
                }
            });

            console.log('Subject string after parsing:', subjectString);
            console.log('Initial subject map:', subjectMap);

            // Additional parsing for OID and SERIALNUMBER from subject string if not found directly
            if (!subjectMap.OID || !subjectMap.SERIALNUMBER) {
                // Try to extract from subject string
                const subjectParts = subjectString.split(',');

                for (const part of subjectParts) {
                    if (part.includes('ORG_ID=') && !subjectMap.OID) {
                        subjectMap.OID = part.split('=')[1];
                        console.log('Found OID in ORG_ID part:', subjectMap.OID);
                    } else if (part.includes('SERIALNUMBER=') && !subjectMap.SERIALNUMBER) {
                        subjectMap.SERIALNUMBER = part.split('=')[1];
                        console.log('Found SERIALNUMBER in part:', subjectMap.SERIALNUMBER);
                    } else if (part.includes('undefined=C') && part.includes('O') && !subjectMap.OID) {
                        // Extract OID from undefined=C5847470505O format
                        const match = part.match(/undefined=(C[0-9]+O)/);
                        if (match && match[1]) {
                            console.log('Found OID in undefined=C format:', match[1]);
                            subjectMap.OID = match[1];
                        }
                    }
                }

                // Check if serial number is in the beginning of the subject
                const serialMatch = subjectString.match(/^(\d+)\s+O=/);
                if (serialMatch && !subjectMap.SERIALNUMBER) {
                    console.log('Found SERIALNUMBER at beginning of subject:', serialMatch[1]);
                    subjectMap.SERIALNUMBER = serialMatch[1];
                }
            }

            // Extract from certificate extensions if available
            if (cert.extensions) {
                console.log('Checking certificate extensions');
                cert.extensions.forEach(ext => {
                    if (ext.name === 'subjectAltName') {
                        console.log('Found subjectAltName extension:', ext);
                        // Check for OID or SERIALNUMBER in subject alt name
                        if (ext.altNames) {
                            ext.altNames.forEach(name => {
                                if (name.value && name.value.includes('ORG_ID=')) {
                                    subjectMap.OID = name.value.split('ORG_ID=')[1].split(',')[0];
                                    console.log('Found OID in subjectAltName:', subjectMap.OID);
                                }
                                if (name.value && name.value.includes('SERIALNUMBER=')) {
                                    subjectMap.SERIALNUMBER = name.value.split('SERIALNUMBER=')[1].split(',')[0];
                                    console.log('Found SERIALNUMBER in subjectAltName:', subjectMap.SERIALNUMBER);
                                }
                            });
                        }
                    }
                });
            }

            // Last resort: try to extract from the full subject string
            if (!subjectMap.OID) {
                console.log('Trying last resort OID extraction');
                // Try to find OID in C58474705050 format (with zero) or C5847470505O format (with letter O)
                const allValues = cert.subject.attributes.map(attr => attr.value).join(' ');
                console.log('All subject values joined:', allValues);

                // Match both patterns
                const oidMatch = allValues.match(/(C[0-9]+O)/) || allValues.match(/(C[0-9]+0)/);
                if (oidMatch && oidMatch[1]) {
                    console.log('Found OID in C format in joined values:', oidMatch[1]);
                    subjectMap.OID = oidMatch[1];
                }
            }

            if (!subjectMap.SERIALNUMBER) {
                // Try to use the certificate serial number as a fallback
                subjectMap.SERIALNUMBER = cert.serialNumber;
                console.log('Using certificate serial number as fallback:', subjectMap.SERIALNUMBER);

                // Or try to extract from the subject string
                const allValues = cert.subject.attributes.map(attr => attr.value).join(' ');
                const serialMatch = allValues.match(/(\d{12})/);
                if (serialMatch) {
                    console.log('Found SERIALNUMBER in subject values:', serialMatch[1]);
                    subjectMap.SERIALNUMBER = serialMatch[1];
                }
            }

            console.log('Final subject map after all extraction attempts:', subjectMap);

            // Extract key usage and extended key usage
            const keyUsage = cert.extensions.find(ext => ext.name === 'keyUsage')?.value || '';
            const extKeyUsage = cert.extensions.find(ext => ext.name === 'extKeyUsage')?.value || '';

            console.log('Raw Key Usage:', keyUsage);
            console.log('Raw Extended Key Usage:', extKeyUsage);

            // Parse Key Usage DER value
            function parseKeyUsageDER(derValue) {
                try {
                    // Check if it's a DER encoded value
                    if (derValue.startsWith('\x03')) {
                        // Extract the actual bits
                        const bits = derValue.charCodeAt(3);
                        // Check if Non-Repudiation (bit 1) is set
                        return (bits & 0x40) === 0x40;  // 0x40 is bit mask for Non-Repudiation
                    }
                    return false;
                } catch (error) {
                    console.error('Error parsing Key Usage DER:', error);
                    return false;
                }
            }

            // Parse Extended Key Usage DER value
            function parseExtKeyUsageDER(derValue) {
                try {
                    // The Document Signing OID in DER format
                    const documentSigningPattern = /\x06\n\+\x06\x01\x04\x01\x827\n\x03\f/;
                    return documentSigningPattern.test(derValue);
                } catch (error) {
                    console.error('Error parsing Extended Key Usage DER:', error);
                    return false;
                }
            }

            // Validate LHDN requirements
            const requirements = {
                subject: Object.entries(subjectMap).map(([key, value]) => ({
                    field: key,
                    present: !!value,
                    value: value
                })),
                keyUsage: {
                    nonRepudiation: parseKeyUsageDER(keyUsage),
                    required: 'Non-Repudiation (40)'
                },
                extKeyUsage: {
                    documentSigning: parseExtKeyUsageDER(extKeyUsage),
                    required: 'Document Signing (1.3.6.1.4.1.311.10.3.12)'
                }
            };

            // Build certificate info
            const certInfo = {
                subject: cert.subject.attributes.map(attr => {
                    if (attr.shortName) {
                        return `${attr.shortName}=${attr.value}`;
                    } else if (attr.name) {
                        return `${attr.name}=${attr.value}`;
                    } else {
                        return `undefined=${attr.value}`;
                    }
                }).join(', '),
                issuer: cert.issuer.attributes.map(attr => {
                    if (attr.shortName) {
                        return `${attr.shortName}=${attr.value}`;
                    } else if (attr.name) {
                        return `${attr.name}=${attr.value}`;
                    } else {
                        return `undefined=${attr.value}`;
                    }
                }).join(', '),
                serialNumber: cert.serialNumber,
                validFrom: cert.validity.notBefore,
                validTo: cert.validity.notAfter,
                status: 'VALID',
                keyUsage,
                extKeyUsage,
                requirements,
                // Add extracted values for debugging
                extractedOID: subjectMap.OID,
                extractedSERIALNUMBER: subjectMap.SERIALNUMBER,
                subjectString: subjectString,
                // Add raw subject attributes for debugging
                rawSubjectAttributes: JSON.stringify(cert.subject.attributes)
            };

            // Check validity period
            const now = new Date();
            if (now < certInfo.validFrom) {
                certInfo.status = 'FUTURE';
            } else if (now > certInfo.validTo) {
                certInfo.status = 'EXPIRED';
            }

            // Clean up temp file
            fs.unlinkSync(req.file.path);

            // Check if all requirements are met
            const missingRequirements = [];

            // Check subject fields
            const missingFields = requirements.subject
                .filter(field => !field.present)
                .map(field => field.field);

            if (missingFields.length > 0) {
                missingRequirements.push(`Missing required fields: ${missingFields.join(', ')}`);
            }

            // Check key usage
            if (!requirements.keyUsage.nonRepudiation) {
                missingRequirements.push(`Missing required key usage: ${requirements.keyUsage.required}`);
            }

            // Check extended key usage
            if (!requirements.extKeyUsage.documentSigning) {
                missingRequirements.push(`Missing required extended key usage: ${requirements.extKeyUsage.required}`);
            }

            res.json({
                success: true,
                certInfo,
                lhdnCompliant: missingRequirements.length === 0,
                missingRequirements
            });

        } catch (error) {
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            throw new Error(`Invalid certificate or wrong password: ${error.message}`);
        }

    } catch (error) {
        console.error('Certificate validation error:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Update certificate save endpoint
router.post('/certificate/save', upload.single('certificate'), async (req, res) => {
    try {
        if (!req.file) {
            throw new Error('No certificate file uploaded');
        }

        const password = req.body.password;
        if (!password) {
            throw new Error('Certificate password is required');
        }

        try {
            // Read and parse certificate
            const certBuffer = fs.readFileSync(req.file.path);
            const p12Der = forge.util.createBuffer(certBuffer.toString('binary'));
            const p12Asn1 = forge.asn1.fromDer(p12Der);
            const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

            const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
            if (!certBags || certBags.length === 0) {
                throw new Error('No certificate found in file');
            }

            const cert = certBags[0].cert;

            // Extract certificate information using the same logic as validation
            const subjectMap = {
                CN: null,  // Common Name
                C: null,   // Country
                O: null,   // Organization
                OID: null, // Organization Identifier (Business Registration)
                SERIALNUMBER: null // Serial Number
            };

            // Parse subject attributes and handle special cases
            let subjectString = '';
            cert.subject.attributes.forEach(attr => {
                // Build subject string for debugging and additional parsing
                if (attr.shortName) {
                    subjectString += `${attr.shortName}=${attr.value},`;
                } else if (attr.name) {
                    subjectString += `${attr.name}=${attr.value},`;
                } else {
                    // Handle attributes without shortName or name
                    subjectString += `undefined=${attr.value},`;

                    // Check if this undefined attribute contains the OID
                    if (attr.value && (attr.value.match(/^C[0-9]+O$/) || attr.value.match(/^C[0-9]+0$/))) {
                        subjectMap.OID = attr.value;
                    }
                }

                // Standard attribute mapping
                if (attr.shortName === 'organizationIdentifier' || attr.shortName === 'OID' || attr.shortName === 'ORG_ID') {
                    subjectMap.OID = attr.value;
                } else if (attr.shortName in subjectMap) {
                    subjectMap[attr.shortName] = attr.value;
                }
            });

            // Additional parsing for OID and SERIALNUMBER from subject string if not found directly
            if (!subjectMap.OID || !subjectMap.SERIALNUMBER) {
                // Try to extract from subject string
                const subjectParts = subjectString.split(',');

                for (const part of subjectParts) {
                    if (part.includes('ORG_ID=') && !subjectMap.OID) {
                        subjectMap.OID = part.split('=')[1];
                    } else if (part.includes('SERIALNUMBER=') && !subjectMap.SERIALNUMBER) {
                        subjectMap.SERIALNUMBER = part.split('=')[1];
                    } else if (part.includes('undefined=C') && part.includes('O') && !subjectMap.OID) {
                        // Extract OID from undefined=C5847470505O format
                        const match = part.match(/undefined=(C[0-9]+O)/);
                        if (match && match[1]) {
                            subjectMap.OID = match[1];
                        }
                    }
                }

                // Check if serial number is in the beginning of the subject
                const serialMatch = subjectString.match(/^(\d+)\s+O=/);
                if (serialMatch && !subjectMap.SERIALNUMBER) {
                    subjectMap.SERIALNUMBER = serialMatch[1];
                }
            }

            // Extract from certificate extensions if available
            if (cert.extensions) {
                cert.extensions.forEach(ext => {
                    if (ext.name === 'subjectAltName') {
                        // Check for OID or SERIALNUMBER in subject alt name
                        if (ext.altNames) {
                            ext.altNames.forEach(name => {
                                if (name.value && name.value.includes('ORG_ID=')) {
                                    subjectMap.OID = name.value.split('ORG_ID=')[1].split(',')[0];
                                }
                                if (name.value && name.value.includes('SERIALNUMBER=')) {
                                    subjectMap.SERIALNUMBER = name.value.split('SERIALNUMBER=')[1].split(',')[0];
                                }
                            });
                        }
                    }
                });
            }

            // Last resort: try to extract from the full subject string
            if (!subjectMap.OID) {
                // Try to find OID in C58474705050 format (with zero) or C5847470505O format (with letter O)
                const allValues = cert.subject.attributes.map(attr => attr.value).join(' ');
                console.log('All subject values joined:', allValues);

                // Match both patterns
                const oidMatch = allValues.match(/(C[0-9]+O)/) || allValues.match(/(C[0-9]+0)/);
                if (oidMatch && oidMatch[1]) {
                    console.log('Found OID in C format in joined values:', oidMatch[1]);
                    subjectMap.OID = oidMatch[1];
                }
            }

            if (!subjectMap.SERIALNUMBER) {
                // Try to use the certificate serial number as a fallback
                subjectMap.SERIALNUMBER = cert.serialNumber;

                // Or try to extract from the subject string
                const serialMatch = cert.subject.attributes.map(attr => attr.value).join(' ').match(/(\d{12})/);
                if (serialMatch) {
                    subjectMap.SERIALNUMBER = serialMatch[1];
                }
            }

            // Extract key usage and extended key usage
            const keyUsage = cert.extensions.find(ext => ext.name === 'keyUsage')?.value || '';
            const extKeyUsage = cert.extensions.find(ext => ext.name === 'extKeyUsage')?.value || '';

            // Save to database
            const certInfo = {
                subject: cert.subject.attributes.map(attr => {
                    if (attr.shortName) {
                        return `${attr.shortName}=${attr.value}`;
                    } else if (attr.name) {
                        return `${attr.name}=${attr.value}`;
                    } else {
                        return `undefined=${attr.value}`;
                    }
                }).join(', '),
                issuer: cert.issuer.attributes.map(attr => {
                    if (attr.shortName) {
                        return `${attr.shortName}=${attr.value}`;
                    } else if (attr.name) {
                        return `${attr.name}=${attr.value}`;
                    } else {
                        return `undefined=${attr.value}`;
                    }
                }).join(', '),
                serialNumber: cert.serialNumber,
                validFrom: cert.validity.notBefore,
                validTo: cert.validity.notAfter,
                keyUsage,
                extKeyUsage,
                extractedOID: subjectMap.OID,
                extractedSERIALNUMBER: subjectMap.SERIALNUMBER,
                subjectString
            };

            // Use Prisma transaction
            const result = await prisma.$transaction(async (prismaClient) => {
                // Deactivate any existing certificates
                await prismaClient.wP_CONFIGURATION.updateMany({
                    where: {
                        Type: 'CERTIFICATE'
                    },
                    data: {
                        IsActive: false
                    }
                });

                // Create new certificate configuration
                const newConfig = await prismaClient.wP_CONFIGURATION.create({
                    data: {
                        Type: 'CERTIFICATE',
                        Settings: JSON.stringify({
                            certificatePath: req.file.filename,
                            password: password, // Consider encrypting this in a production environment
                            certInfo
                        }),
                        IsActive: true,
                        UserID: req.user.id ? String(req.user.id) : null,
                        CreateTS: new Date(),
                        UpdateTS: new Date()
                    }
                });

                // Log the configuration change
                await prismaClient.wP_LOGS.create({
                    data: {
                        Description: `Certificate saved by ${req.user.username} (${req.file.filename})`,
                        CreateTS: new Date().toISOString(), // Convert to ISO string format
                        LoggedUser: req.user.username,
                        LogType: 'CONFIG',
                        Module: 'CERTIFICATE',
                        Action: 'CREATE',
                        Status: 'SUCCESS',
                        UserID: req.user.id,
                        IPAddress: req.ip || null
                    }
                });

                return newConfig;
            });

            // Get user info for last modified by
            const user = await prisma.wP_USER_REGISTRATION.findFirst({
                where: { ID: req.user.id },
                select: {
                    FullName: true,
                    Username: true
                }
            });

            res.json({
                success: true,
                message: 'Certificate saved successfully',
                certInfo,
                lastModifiedBy: user ? {
                    name: user.FullName,
                    username: user.Username,
                    timestamp: new Date()
                } : null
            });

        } catch (error) {
            // Clean up uploaded file on error
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            throw error;
        }

    } catch (error) {
        console.error('Error saving certificate:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Add certificate disable endpoint
router.post('/certificate/disable', async (req, res) => {
    try {
        // Use Prisma transaction
        await prisma.$transaction(async (prismaClient) => {
            // Deactivate any existing certificates
            await prismaClient.wP_CONFIGURATION.updateMany({
                where: {
                    Type: 'CERTIFICATE'
                },
                data: {
                    IsActive: false
                }
            });

            // Log the configuration change
            await prismaClient.wP_LOGS.create({
                data: {
                    Description: `Certificate disabled by ${req.user.username}`,
                    CreateTS: new Date().toISOString(), // Convert to ISO string format
                    LoggedUser: req.user.username,
                    LogType: 'CONFIG',
                    Module: 'CERTIFICATE',
                    Action: 'DISABLE',
                    Status: 'SUCCESS',
                    UserID: req.user.id,
                    IPAddress: req.ip || null
                }
            });
        });

        res.json({
            success: true,
            message: 'Certificate disabled successfully'
        });

    } catch (error) {
        console.error('Error disabling certificate:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Add this new route to handle outgoing path configuration
router.post('/outgoing/save-config', async (req, res) => {
    try {
        const { networkPath, domain, username, password } = req.body;

        // Input validation
        if (!networkPath || !username || !password) {
            throw new Error('Network path, username and password are required');
        }

        // Format and validate the network path
        const formattedPath = await validateAndFormatNetworkPath(networkPath);

        // Test network path accessibility
        const accessResult = await testNetworkPathAccessibility(formattedPath, {
            serverName: domain || '',
            serverUsername: username,
            serverPassword: password
        });

        if (!accessResult.success) {
            throw new Error(accessResult.error || 'Network path validation failed');
        }

        // Find current active configuration
        const currentConfig = await prisma.wP_CONFIGURATION.findFirst({
            where: {
                Type: 'OUTGOING',
                IsActive: true
            },
            orderBy: {
                CreateTS: 'desc'
            }
        });

        // Save configuration
        const settings = {
            networkPath: formattedPath,
            domain: domain || '',
            username,
            password
        };

        // Use Prisma transaction
        await prisma.$transaction(async (prismaClient) => {
            if (currentConfig) {
                await prismaClient.wP_CONFIGURATION.update({
                    where: {
                        ID: currentConfig.ID
                    },
                    data: {
                        Settings: JSON.stringify(settings),
                        UpdateTS: new Date()
                    }
                });
            } else {
                await prismaClient.wP_CONFIGURATION.create({
                    data: {
                        Type: 'OUTGOING',
                        Settings: JSON.stringify(settings),
                        IsActive: true,
                        UserID: String(req.user.id),
                        CreateTS: new Date(),
                        UpdateTS: new Date()
                    }
                });
            }

            // Log the configuration change
            await prismaClient.wP_LOGS.create({
                data: {
                    Description: `Outgoing path configuration ${currentConfig ? 'updated' : 'created'} by ${req.user.username} (${formattedPath})`,
                    CreateTS: new Date().toISOString(), // Convert to ISO string format
                    LoggedUser: req.user.username,
                    LogType: 'CONFIG',
                    Module: 'OUTGOING',
                    Action: currentConfig ? 'UPDATE' : 'CREATE',
                    Status: 'SUCCESS',
                    UserID: req.user.id,
                    IPAddress: req.ip || null
                }
            });
        });

        res.json({
            success: true,
            message: 'Outgoing path configuration saved successfully',
            config: {
                networkPath: formattedPath,
                domain: domain || '',
                username
                // Don't send password back
            }
        });
    } catch (error) {
        console.error('Error saving outgoing path config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Add this route to get outgoing path configuration
router.get('/outgoing/get-config', async (req, res) => {
    try {
        const config = await prisma.wP_CONFIGURATION.findFirst({
            where: {
                Type: 'OUTGOING',
                IsActive: true
            },
            orderBy: {
                CreateTS: 'desc'
            }
        });

        let settings = config?.Settings;
        if (typeof settings === 'string') {
            settings = JSON.parse(settings);
        }

        res.json({
            success: true,
            networkPath: settings?.networkPath || '',
            settings: settings || {
                networkPath: '',
                domain: '',
                username: ''
            }
        });
    } catch (error) {
        console.error('Error getting outgoing path config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;