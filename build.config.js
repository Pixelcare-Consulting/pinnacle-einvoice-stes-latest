/**
 * Secure Build Configuration for eInvoice Project
 * This configuration defines the build process for creating secure production builds
 */

const path = require('path');
const fs = require('fs');

const buildConfig = {
  // Source and build directories
  sourceDir: process.cwd(),
  buildDir: path.join(process.cwd(), 'dist'),
  
  // Environment configurations
  environments: {
    development: {
      minify: false,
      obfuscate: false,
      sourceMaps: true,
      debugMode: true
    },
    staging: {
      minify: true,
      obfuscate: false,
      sourceMaps: true,
      debugMode: false
    },
    production: {
      minify: true,
      obfuscate: true,
      sourceMaps: false,
      debugMode: false
    }
  },

  // Files and directories to include in production build
  includePatterns: [
    // Core application files
    'server.js',
    'package.json',
    
    // Application directories
    'routes/**/*.js',
    'middleware/**/*.js',
    'services/**/*.js',
    'utils/**/*.js',
    'views/**/*.html',
    'src/**/*.js',
    
    // Public assets (will be processed separately)
    'public/assets/**/*',
    '!public/assets/js/config/**/*',
    '!public/assets/**/*.bak',
    'public/css/**/*',
    'public/images/**/*',
    'public/templates/**/*',
    
    // Prisma (schema only - migrations handled separately)
    'prisma/schema.prisma',
    
    // Essential config files (will be processed)
    'ecosystem.config.production.js',
    'web.config.production',

    // Environment template (not actual env files)
    '.env.template'
  ],

  // Files and directories to exclude from production build
  excludePatterns: [
    // Development files
    'node_modules/',
    'node_modules/**/*',
    '.git/',
    '.vscode/',
    '.idea/',
    
    // Documentation and development files
    'docs/',
    'README.md',
    'IMPLEMENTATION_SUMMARY.md',
    'NOTIFICATIONS_SYSTEM_README.md',
    'coding-convention.md',
    '*.md',
    
    // Test and development scripts
    'test-*.html',
    'check-config.js',
    '*.bak',
    
    // Sensitive configuration files
    '.env',
    '.env.*',
    '!.env.template',
    'config/',
    'ssl/',
    'certificates/',
    
    // Database and migration files
    'database/',
    'migrations/',
    'prisma/migrations/',
    
    // Logs and temporary files
    'logs/',
    'sessions/',
    'uploads/',
    'temp/',
    'generated/',
    'output/',
    'excel/',
    'rules/',
    
    // Development dependencies and configs
    'nodemon.json*',
    '.nodemonignore',
    'jest.config.js',
    'tailwind.config.js',
    'postcss.config.js',
    
    // Archive and backup files
    '*.rar',
    '*.zip',
    '*.tar.gz',
    '**/*.bak',
    '**/*.backup',
    '**/*.old',

    // Configuration and sensitive files
    '**/config/**/*',
    '!config/version.js',

    // IDE and OS files
    '.DS_Store',
    'Thumbs.db',
    '*.swp',
    '*.swo'
  ],

  // Security configurations
  security: {
    // Files that need special security handling
    sensitiveFiles: [
      'config/auth.config.js',
      'config/database.config.js',
      'config/server.config.js'
    ],
    
    // Environment variables that should be externalized
    externalizeEnvVars: [
      'DATABASE_URL',
      'SESSION_SECRET',
      'API_KEY',
      'CERT_PASSWORD',
      'PRIVATE_KEY_FILE_PATH',
      'PRIVATE_CERT_FILE_PATH'
    ]
  },

  // Minification and obfuscation settings
  optimization: {
    javascript: {
      minify: true,
      obfuscate: true,
      removeComments: true,
      removeConsoleLog: true
    },
    css: {
      minify: true,
      removeComments: true,
      optimizeImages: true
    },
    html: {
      minify: true,
      removeComments: true,
      collapseWhitespace: true
    }
  },

  // Server configuration for production
  server: {
    // Files to deny direct access
    denyAccess: [
      '*.env*',
      '*.config.js',
      '*.json',
      'logs/*',
      'sessions/*',
      'uploads/*',
      'temp/*',
      'ssl/*',
      'certificates/*',
      'database/*',
      'migrations/*',
      'node_modules/*',
      '.git/*',
      '*.bak',
      '*.log'
    ],
    
    // Security headers
    securityHeaders: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';"
    }
  }
};

module.exports = buildConfig;
