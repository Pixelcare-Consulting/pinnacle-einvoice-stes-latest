const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { auth } = require('../../middleware');
const prisma = require('../../src/lib/prisma');
const bcrypt = require('bcryptjs');

// Configure multer for image upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Use absolute path with process.cwd() to ensure correct directory resolution
    const uploadDir = path.join(process.cwd(), 'public/uploads/company-profiles');

    // Create directory if it doesn't exist
    try {
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log(`Created upload directory: ${uploadDir}`);
      }
      cb(null, uploadDir);
    } catch (error) {
      console.error(`Error creating upload directory ${uploadDir}:`, error);
      cb(error);
    }
  },
  filename: function (req, file, cb) {
    try {
      // Generate a unique filename with timestamp and random number
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const safeFilename = 'company-' + uniqueSuffix + path.extname(file.originalname);
      cb(null, safeFilename);
    } catch (error) {
      console.error('Error generating filename:', error);
      cb(error);
    }
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    try {
      // Check file type
      const allowedTypes = /jpeg|jpg|png/;
      const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
      const mimetype = allowedTypes.test(file.mimetype);

      if (extname && mimetype) {
        return cb(null, true);
      } else {
        return cb(new Error('Only .png, .jpg and .jpeg format allowed!'));
      }
    } catch (error) {
      console.error('Error in file filter:', error);
      return cb(error);
    }
  }
});

// Get company profile
router.get('/profile', auth.isAdmin, async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Get user details first
    const user = await prisma.wP_USER_REGISTRATION.findFirst({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find company using user's TIN
    const company = await prisma.wP_COMPANY_SETTINGS.findFirst({
      where: { TIN: user.TIN }
    });

    // Get LHDN configuration
    const lhdnConfig = await prisma.wP_CONFIGURATION.findFirst({
      where: {
        Type: 'LHDN',
        UserID: String(user.ID),
        IsActive: true
      },
      orderBy: {
        CreateTS: 'desc'
      }
    });

    // Parse LHDN settings
    let lhdnSettings = {};
    if (lhdnConfig?.Settings) {
      try {
        lhdnSettings = typeof lhdnConfig.Settings === 'string' ?
          JSON.parse(lhdnConfig.Settings) : lhdnConfig.Settings;
      } catch (error) {
        console.error('Error parsing LHDN settings:', error);
      }
    }

    // Prepare response data with default values
    const companyData = {
      companyName: company?.CompanyName || '',
      industry: company?.Industry || '',
      country: company?.Country || '',
      email: company?.Email || user.Email || '', // Fallback to user email
      phone: company?.Phone || user.Phone || '',
      address: company?.Address || '',
      tin: user.TIN || '', // Use TIN from user record
      brn: company?.BRN || user.IDValue || '', // Fallback to user's IDValue
      about: company?.About || '',
      profileImage: company?.CompanyImage || '/assets/img/noimage.png',
      validStatus: company?.ValidStatus || 1,
      clientId: lhdnSettings.clientId || '',
      clientSecret: lhdnSettings.clientSecret ? '****************' : ''

    };

    res.json({
      success: true,
      message: company ? 'Company profile found' : 'No company profile found. Please create one.',
      company: companyData,
      isNewCompany: !company,
      canEditTinBrn: user.Admin === 1 // Only admin can edit TIN/BRN
    });
  } catch (error) {
    console.error('Error fetching company profile:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update company profile (excluding TIN/BRN)
router.put('/profile', auth.isAdmin, async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const user = await prisma.wP_USER_REGISTRATION.findFirst({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const {
      companyName,
      industry,
      country,
      email,
      phone,
      address,
      about
    } = req.body;

    // Validate required fields
    if (!companyName || !email) {
      return res.status(400).json({
        success: false,
        message: 'Company name and email are required'
      });
    }

    // Use Prisma transaction
    const result = await prisma.$transaction(async (prismaClient) => {
      // Find existing company settings
      const existingCompany = await prismaClient.wP_COMPANY_SETTINGS.findFirst({
        where: { TIN: user.TIN }
      });

      let company;
      let created = false;

      if (!existingCompany) {
        // Create new company settings
        company = await prismaClient.wP_COMPANY_SETTINGS.create({
          data: {
            CompanyName: companyName,
            Industry: industry,
            Country: country,
            Email: email,
            Phone: phone,
            Address: address,
            About: about,
            TIN: user.TIN,
            BRN: user.IDValue,
            UserID: String(user.ID),
            ValidStatus: '1'
          }
        });
        created = true;
      } else {
        // Update existing company (excluding TIN/BRN)
        company = await prismaClient.wP_COMPANY_SETTINGS.update({
          where: { ID: existingCompany.ID },
          data: {
            CompanyName: companyName,
            Industry: industry,
            Country: country,
            Email: email,
            Phone: phone,
            Address: address,
            About: about
          }
        });
      }

      // Log the action
      await prismaClient.wP_LOGS.create({
        data: {
          Description: created ? 'Company profile created' : 'Company profile updated',
          CreateTS: new Date().toISOString(),
          LoggedUser: user.Username,
          LogType: 'INFO',
          Module: 'Company Management',
          Action: created ? 'CREATE' : 'UPDATE',
          Status: 'SUCCESS',
          UserID: user.ID
        }
      });

      // Get LHDN configuration
      const lhdnConfig = await prismaClient.wP_CONFIGURATION.findFirst({
        where: {
          Type: 'LHDN',
          UserID: String(user.ID),
          IsActive: true
        },
        orderBy: {
          CreateTS: 'desc'
        }
      });

      // Parse LHDN settings
      let lhdnSettings = {};
      if (lhdnConfig?.Settings) {
        try {
          lhdnSettings = typeof lhdnConfig.Settings === 'string' ?
            JSON.parse(lhdnConfig.Settings) : lhdnConfig.Settings;
        } catch (error) {
          console.error('Error parsing LHDN settings:', error);
        }
      }

      return {
        company,
        created,
        lhdnSettings
      };
    });

    res.json({
      success: true,
      message: result.created ? 'Company profile created successfully' : 'Company profile updated successfully',
      company: {
        companyName: result.company.CompanyName,
        industry: result.company.Industry,
        country: result.company.Country,
        email: result.company.Email,
        phone: result.company.Phone,
        address: result.company.Address,
        tin: result.company.TIN,
        brn: result.company.BRN,
        about: result.company.About,
        profileImage: result.company.CompanyImage,
        validStatus: result.company.ValidStatus,
        clientId: result.lhdnSettings.clientId || '',
        clientSecret: result.lhdnSettings.clientSecret ? '****************' : ''
      }
    });
  } catch (error) {
    console.error('Error updating company profile:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update TIN
router.put('/registration-details/tin', auth.isAdmin, async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const { tin, password } = req.body;

    // Validate required fields
    if (!tin || !password) {
      return res.status(400).json({
        success: false,
        message: 'TIN and password are required'
      });
    }

    const user = await prisma.wP_USER_REGISTRATION.findFirst({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user is admin
    if (user.Admin !== 1) {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can update registration details'
      });
    }

    // Validate password
    const isValidPassword = await bcrypt.compare(password, user.Password);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Use Prisma transaction
    await prisma.$transaction(async (prismaClient) => {
      // Update user's TIN
      await prismaClient.wP_USER_REGISTRATION.update({
        where: { ID: user.ID },
        data: { TIN: tin }
      });

      // Find existing company settings
      const existingCompany = await prismaClient.wP_COMPANY_SETTINGS.findFirst({
        where: { UserID: String(user.ID) }
      });

      if (existingCompany) {
        // Update existing company
        await prismaClient.wP_COMPANY_SETTINGS.update({
          where: { ID: existingCompany.ID },
          data: { TIN: tin }
        });
      } else {
        // Create new company settings
        await prismaClient.wP_COMPANY_SETTINGS.create({
          data: {
            TIN: tin,
            BRN: user.IDValue,
            UserID: String(user.ID),
            ValidStatus: '1'
          }
        });
      }

      // Log the action
      await prismaClient.wP_LOGS.create({
        data: {
          Description: 'Tax Identification Number (TIN) updated',
          CreateTS: new Date().toISOString(),
          LoggedUser: user.Username,
          LogType: 'INFO',
          Module: 'Company Management',
          Action: 'UPDATE',
          Status: 'SUCCESS',
          UserID: user.ID
        }
      });
    });

    res.json({
      success: true,
      message: 'Tax Identification Number updated successfully',
      data: {
        tin,
        username: user.Username
      }
    });
  } catch (error) {
    console.error('Error updating TIN:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update Tax Identification Number'
    });
  }
});

// Update BRN
router.put('/registration-details/brn', auth.isAdmin, async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const { IDType = 'BRN', IDValue, password } = req.body;
    const brn = IDValue; // For clarity

    // Validate required fields
    if (!IDType || !IDValue || !password) {
      return res.status(400).json({
        success: false,
        message: 'ID Type, ID Value and password are required'
      });
    }

    const user = await prisma.wP_USER_REGISTRATION.findFirst({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user is admin
    if (user.Admin !== 1) {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can update registration details'
      });
    }

    // Validate password
    const isValidPassword = await bcrypt.compare(password, user.Password);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Use Prisma transaction
    await prisma.$transaction(async (prismaClient) => {
      // Update user's BRN (IDValue)
      await prismaClient.wP_USER_REGISTRATION.update({
        where: { ID: user.ID },
        data: { IDValue: brn }
      });

      // Find existing company settings
      const existingCompany = await prismaClient.wP_COMPANY_SETTINGS.findFirst({
        where: { UserID: String(user.ID) }
      });

      if (existingCompany) {
        // Update existing company
        await prismaClient.wP_COMPANY_SETTINGS.update({
          where: { ID: existingCompany.ID },
          data: { BRN: brn }
        });
      } else {
        // Create new company settings
        await prismaClient.wP_COMPANY_SETTINGS.create({
          data: {
            TIN: user.TIN,
            BRN: brn,
            UserID: String(user.ID),
            ValidStatus: '0'
          }
        });
      }

      // Log the action
      await prismaClient.wP_LOGS.create({
        data: {
          Description: 'Business Registration Number (BRN) updated',
          CreateTS: new Date().toISOString(),
          LoggedUser: user.Username,
          LogType: 'INFO',
          Module: 'Company Management',
          Action: 'UPDATE',
          Status: 'SUCCESS',
          UserID: user.ID
        }
      });
    });

    res.json({
      success: true,
      message: 'Business Registration Number updated successfully',
      data: {
        brn,
        username: user.Username
      }
    });
  } catch (error) {
    console.error('Error updating BRN:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update Business Registration Number'
    });
  }
});

// Update LHDN credentials
router.put('/lhdn-credentials', auth.isAdmin, async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const { clientId, clientSecret, password } = req.body;

    // Validate required fields
    if (!clientId || !clientSecret || !password) {
      return res.status(400).json({
        success: false,
        message: 'Client ID, Client Secret and password are required'
      });
    }

    // Get user details
    const user = await prisma.wP_USER_REGISTRATION.findFirst({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Validate password
    const isValidPassword = await bcrypt.compare(password, user.Password);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Use Prisma transaction
    await prisma.$transaction(async (prismaClient) => {
      // Save to WP_CONFIGURATION
      const settings = {
        clientId,
        clientSecret,
        lastModifiedBy: {
          userId: user.ID,
          username: user.Username,
          timestamp: new Date().toISOString()
        }
      };

      // Find existing configuration
      const existingConfig = await prismaClient.wP_CONFIGURATION.findFirst({
        where: {
          Type: 'LHDN',
          UserID: String(user.ID),
          IsActive: true
        }
      });

      if (existingConfig) {
        // Update existing configuration
        await prismaClient.wP_CONFIGURATION.update({
          where: { ID: existingConfig.ID },
          data: {
            Settings: JSON.stringify(settings),
            UpdateTS: new Date()
          }
        });
      } else {
        // Create new configuration
        await prismaClient.wP_CONFIGURATION.create({
          data: {
            Type: 'LHDN',
            UserID: String(user.ID),
            Settings: JSON.stringify(settings),
            IsActive: true,
            CreateTS: new Date(),
            UpdateTS: new Date()
          }
        });
      }

      // Log the action
      await prismaClient.wP_LOGS.create({
        data: {
          Description: 'LHDN credentials updated by ' + user.Username,
          CreateTS: new Date().toISOString(),
          LoggedUser: user.Username,
          LogType: 'INFO',
          Module: 'Company Management',
          Action: 'UPDATE',
          Status: 'SUCCESS',
          UserID: user.ID
        }
      });

      // Get company to update status
      const company = await prismaClient.wP_COMPANY_SETTINGS.findFirst({
        where: { TIN: user.TIN }
      });

      if (company) {
        await prismaClient.wP_COMPANY_SETTINGS.update({
          where: { ID: company.ID },
          data: {
            ValidStatus: '1'
          }
        });
      }
    });

    res.json({
      success: true,
      message: 'LHDN credentials updated successfully',
      data: {
        clientId,
        clientSecret: '****************'
      }
    });
  } catch (error) {
    console.error('Error updating LHDN credentials:', error);

    // Log the error
    if (req.session?.user) {
      await prisma.wP_LOGS.create({
        data: {
          Description: 'Failed to update LHDN credentials',
          CreateTS: new Date().toISOString(),
          LoggedUser: req.session.user.username,
          LogType: 'ERROR',
          Module: 'Company Management',
          Action: 'UPDATE',
          Status: 'ERROR',
          UserID: req.session.user.id
        }
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update LHDN credentials'
    });
  }
});

// Upload company profile image
router.post('/profile-image', upload.single('profileImage'), async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file uploaded'
      });
    }

    const user = await prisma.wP_USER_REGISTRATION.findFirst({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Define imageUrl here to ensure it's in scope for the entire function
    const imageUrl = '/uploads/company-profiles/' + req.file.filename;

    // Use Prisma transaction
    await prisma.$transaction(async (prismaClient) => {
      // Find existing company settings
      const existingCompany = await prismaClient.wP_COMPANY_SETTINGS.findFirst({
        where: { TIN: user.TIN }
      });

      let company;
      if (!existingCompany) {
        // Create new company settings
        company = await prismaClient.wP_COMPANY_SETTINGS.create({
          data: {
            TIN: user.TIN,
            IDType: user.IDType,
            IDValue: user.IDValue,
            UserID: String(user.ID),
            CompanyName: user.FullName || 'My Company', // Add default company name
            Email: user.Email || '', // Add user email
            ValidStatus: '1',
            CompanyImage: imageUrl // Set image URL during creation
          }
        });
      } else {
        company = existingCompany;

        // Remove old profile image if it exists
        if (company.CompanyImage) {
          try {
            // Fix path resolution - use correct relative path
            const oldImagePath = path.join(process.cwd(), 'public', company.CompanyImage);
            if (fs.existsSync(oldImagePath)) {
              fs.unlinkSync(oldImagePath);
            }
          } catch (deleteError) {
            console.warn('Failed to delete old image:', deleteError);
            // Continue even if old image deletion fails
          }
        }

        // Update company profile with new image URL
        await prismaClient.wP_COMPANY_SETTINGS.update({
          where: { ID: company.ID },
          data: {
            CompanyImage: imageUrl
          }
        });
      }

      // Log the action
      await prismaClient.wP_LOGS.create({
        data: {
          Description: 'Company profile image updated',
          CreateTS: new Date().toISOString(),
          LoggedUser: user.Username,
          LogType: 'INFO',
          Module: 'Company Management',
          Action: 'UPDATE',
          Status: 'SUCCESS',
          UserID: user.ID
        }
      });
    });

    res.json({
      success: true,
      message: 'Profile image uploaded successfully',
      imageUrl
    });
  } catch (error) {
    // Remove uploaded file if any error occurs
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (deleteError) {
        console.warn('Failed to delete uploaded file after error:', deleteError);
      }
    }

    console.error('Error uploading profile image:', error);

    // Provide more detailed error message
    res.status(500).json({
      success: false,
      message: 'Error uploading profile image: ' + (error.message || 'Internal server error'),
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Delete company profile image
router.delete('/profile-image', async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const user = await prisma.wP_USER_REGISTRATION.findFirst({
      where: { Username: req.session.user.username }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const company = await prisma.wP_COMPANY_SETTINGS.findFirst({
      where: { TIN: user.TIN }
    });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Use Prisma transaction
    await prisma.$transaction(async (prismaClient) => {
      // Remove profile image if it exists
      if (company.CompanyImage) {
        try {
          // Fix path resolution - use correct relative path
          const imagePath = path.join(process.cwd(), 'public', company.CompanyImage);
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
          }
        } catch (deleteError) {
          console.warn('Failed to delete image file:', deleteError);
          // Continue even if file deletion fails
        }
      }

      // Update company profile to remove image reference
      await prismaClient.wP_COMPANY_SETTINGS.update({
        where: { ID: company.ID },
        data: {
          CompanyImage: null
        }
      });

      // Log the action
      await prismaClient.wP_LOGS.create({
        data: {
          Description: 'Company profile image removed',
          CreateTS: new Date().toISOString(),
          LoggedUser: user.Username,
          LogType: 'INFO',
          Module: 'Company Management',
          Action: 'DELETE',
          Status: 'SUCCESS',
          UserID: user.ID
        }
      });
    });

    res.json({
      success: true,
      message: 'Profile image removed successfully'
    });
  } catch (error) {
    console.error('Error removing profile image:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing profile image: ' + (error.message || 'Internal server error'),
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get company settings for consolidation
router.get('/settings', auth.middleware, async (req, res) => {
  try {
    // Use req.user instead of req.session.user for API authentication
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Get user details first
    const user = await prisma.wP_USER_REGISTRATION.findUnique({
      where: { ID: req.user.id }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find company using user's TIN
    const company = await prisma.wP_COMPANY_SETTINGS.findFirst({
      where: { TIN: user.TIN }
    });

    if (!company) {
      // Return default data instead of error for better user experience
      return res.json({
        company_name: 'General Public',
        tin_number: user.TIN || 'T00000000',
        business_registration_number: user.IDValue || 'BRN00000',
        sst_number: '',
        msic_code: '',
        address: 'Company Address',
        address_line1: '',
        address_line2: '',
        city: '',
        state: '',
        postal_code: '',
        country: 'MYS',
        contact_number: user.Phone || '',
        email: user.Email || ''
      });
    }

    // Format for consolidation module
    const companyData = {
      company_name: company.CompanyName,
      tin_number: company.TIN,
      business_registration_number: company.BRN,
      sst_number: company.SSTRegistrationNumber || '',
      msic_code: company.MSICCode || '',
      address: company.Address,
      address_line1: company.AddressLine1 || '',
      address_line2: company.AddressLine2 || '',
      city: company.City || '',
      state: company.State || '',
      postal_code: company.PostalCode || '',
      country: company.Country || 'MYS',
      contact_number: company.Phone,
      email: company.Email
    };

    res.json(companyData);
  } catch (error) {
    console.error('Error fetching company settings for consolidation:', error);
    // Return default data on error
    res.json({
      company_name: 'Your Company Name',
      tin_number: 'T00000000',
      business_registration_number: 'BRN00000',
      sst_number: '',
      msic_code: '',
      address: 'Company Address',
      address_line1: '',
      address_line2: '',
      city: '',
      state: '',
      postal_code: '',
      country: 'MYS',
      contact_number: '',
      email: ''
    });
  }
});

module.exports = router;
