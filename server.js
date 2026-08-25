// 1. Environment and Core Dependencies
require('dotenv').config();
const express = require('express');
const https = require('https');
const http = require('http');  // Added for HTTP to HTTPS redirection
const session = require('express-session');
const cors = require('cors');
const swig = require('swig');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');  // Added os module which was missing
const helmet = require('helmet');  // Added for security headers
const PrismaSessionStore = require('./src/lib/prisma-session-store');

// 2. Local Dependencies
const serverConfig = require('./config/server.config');
const authConfig = require('./config/auth.config');
const { auth, error, maintenance, validation } = require('./middleware/index-prisma');
const versionHeader = require('./utils/versionHeader');
const appVersion = require('./config/version');
const { initJsReport } = require('./services/jsreport.service');
const authRoutes = require('./routes/auth-prisma.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const apiRoutes = require('./routes/api/index');
const webRoutes = require('./routes/web/index');
const dashboardAnalyticsRouter = require('./routes/api/dashboard-analytics');
const dashboardStatsRouter = require('./routes/api/dashboard-stats');
const passport = require('./config/passport-prisma.config');

// 3. Initialize Express
const app = express();

// Trust proxy headers from IIS
app.set('trust proxy', 'loopback');

// Version Header middleware
app.use(versionHeader);

// Add Helmet for better security headers (alternative to manual implementation)
app.use(helmet({
  contentSecurityPolicy: false,  // Configure based on your needs
  crossOriginEmbedderPolicy: false  // Modify as needed
}));

// Add HSTS for HTTPS
app.use((req, res, next) => {
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  res.locals.appVersion = appVersion.getSemanticVersion();
  res.locals.appFullVersion = appVersion.getFullVersion();
  next();
});

// Enable CORS with specific options
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Set-Cookie'],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

// Configure Swig
swig.setDefaults({
  cache: process.env.NODE_ENV === 'production' ? 'memory' : false,
  loader: swig.loaders.fs(path.join(__dirname, 'views')),
  locals: {
    basedir: path.join(__dirname, 'views')
  }
});

app.engine('html', swig.renderFile);
app.set('view engine', 'html');
app.set('views', path.join(__dirname, 'views'));

// 4. Core Middleware Setup
app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({limit: '50mb', extended: true}));

// Request timeout middleware
app.use((req, res, next) => {
  req.setTimeout(30000, () => {
    console.error('Request has timed out.');
    res.status(503).send('Service temporarily unavailable. Please try again.');
  });
  next();
});

// Static file serving with correct MIME types
const staticFileMiddleware = (req, res, next) => {
  if (req.path.endsWith('.css')) {
    res.type('text/css');
  } else if (req.path.endsWith('.js')) {
    res.type('application/javascript');
  }
  next();
};

// Static file routes
app.use('/assets', staticFileMiddleware, express.static(path.join(__dirname, 'public/assets')));
app.use('/temp', express.static(path.join(__dirname, 'public/temp')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use('/reports', express.static(path.join(__dirname, 'src/reports')));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration with secure cookies and Prisma store
app.use(session({
  ...serverConfig.sessionConfig,
  cookie: {
    ...serverConfig.sessionConfig.cookie,
    secure: process.env.SECURE_COOKIE === 'true',
    sameSite: 'lax',
    maxAge: authConfig.session.timeout,
    rolling: true,
    httpOnly: true   // Ensure cookies are HTTP only
  },
  resave: true,
  saveUninitialized: true,
  store: new PrismaSessionStore({
    ttl: authConfig.session.timeout / 1000, // Convert from ms to seconds
    tableName: 'Session'
  })
}));

// Add after session middleware and before routes
app.use(passport.initialize());
app.use(passport.session());

// 5. Application Middleware
app.use(maintenance); // Maintenance mode check
app.use('/auth', authRoutes); // Auth routes (before auth middleware)
app.use('/api/v1/auth', authRoutes);

app.get('/api/version', (req, res) => {
  res.json({
    version: appVersion.getSemanticVersion(),
    fullVersion: appVersion.getFullVersion(),
    timestamp: appVersion.buildDate
  });
});

// Auth middleware for protected routes
app.use((req, res, next) => {
  const publicPaths = [
    '/assets/',
    '/favicon.ico',
    '/public/',
    '/uploads/',
    '/auth/',
    '/vendor/'
  ];

  if (publicPaths.some(path => req.path.startsWith(path))) {
    return next();
  }

  auth.middleware(req, res, next);
});

// Protected routes
app.use('/dashboard', dashboardRoutes);

// API routes - ensure all API routes are registered before the catch-all /api route
// Dashboard analytics and stats routes
app.use('/api/dashboard-analytics', auth.isApiAuthenticated, dashboardAnalyticsRouter);
app.use('/api/dashboard', auth.isApiAuthenticated, dashboardStatsRouter);

// Main API routes - this should be registered last to avoid overriding specific API routes
app.use('/api', auth.isApiAuthenticated, apiRoutes);

// Web routes
app.use('/', webRoutes);

// 6. Error Handling
// 404 handler
app.use((req, res, next) => {
  // Check if headers have already been sent
  if (res.headersSent) {
    console.error('Headers already sent, cannot send 404 response');
    return next();
  }

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    res.status(404).json({ success: false, message: 'Not Found' });
  } else {
    res.status(404).render('error', {
      title: 'Not Found',
      message: 'The page you are looking for does not exist.'
    });
  }
});

// Global error handler
app.use(error);

async function ensureDirectories() {
  const dirs = [
    path.join(__dirname, 'public/temp'),
    path.join(__dirname, 'uploads/company-logos'),
    path.join(process.env.TEMP || os.tmpdir(), 'jsreport'), // Add jsreport temp directory
    path.join(__dirname, 'ssl')  // Ensure SSL directory exists
  ];

  for (const dir of dirs) {
    try {
      await fsPromises.access(dir);
    } catch {
      console.log(`Creating directory: ${dir}`);
      await fsPromises.mkdir(dir, { recursive: true });
    }
  }
}

// 7. Server Startup
const startServer = async () => {
  let jsreportInstance;
  let httpServer;
  let httpsServer;

  try {
    await ensureDirectories();
    jsreportInstance = await initJsReport();

    const httpPort = process.env.HTTP_PORT || 3000;  // Changed from 80 to 3000
    const httpsPort = process.env.HTTPS_PORT || 443; // Changed from 443 to 3001

    // Create HTTP server
    httpServer = http.createServer((req, res) => {
      // Only redirect to HTTPS if not in development and not behind proxy
      if (process.env.NODE_ENV === 'production' && !req.headers['x-forwarded-proto']) {
        const host = req.headers.host.split(':')[0]; // Remove port if present
        const httpsUrl = `https://${host}:${httpsPort}${req.url}`;
        res.writeHead(301, { Location: httpsUrl });
        res.end();
      } else {
        app(req, res);
      }
    });

    // Create HTTPS server if SSL certificates exist
    const sslPath = path.join(__dirname, 'ssl');
    if (fs.existsSync(path.join(sslPath, 'private.key')) && fs.existsSync(path.join(sslPath, 'certificate.crt'))) {
      const httpsOptions = {
        key: fs.readFileSync(path.join(sslPath, 'private.key')),
        cert: fs.readFileSync(path.join(sslPath, 'certificate.crt'))
      };
      httpsServer = https.createServer(httpsOptions, app);
    }

    // Start HTTP server with error handling
    httpServer.listen(httpPort, () => {
      console.log(`HTTP server running on http://localhost:${httpPort}`);
    }).on('error', (err) => {
      if (err.code === 'EACCES') {
        console.error(`Port ${httpPort} requires elevated privileges. Try using a port number above 1024.`);
      } else if (err.code === 'EADDRINUSE') {
        console.error(`Port ${httpPort} is already in use. Try a different port.`);
      } else {
        console.error('HTTP server error:', err);
      }
      process.exit(1);
    });

    // Start HTTPS server if available
    if (httpsServer) {
      httpsServer.listen(httpsPort, () => {
        console.log(`HTTPS server running on https://localhost:${httpsPort}`);
      }).on('error', (err) => {
        if (err.code === 'EACCES') {
          console.error(`Port ${httpsPort} requires elevated privileges. Try using a port number above 1024.`);
        } else if (err.code === 'EADDRINUSE') {
          console.error(`Port ${httpsPort} is already in use. Try a different port.`);
        } else {
          console.error('HTTPS server error:', err);
        }
        // Don't exit process if HTTPS fails, as HTTP might still be working
        console.log('Continuing with HTTP only...');
      });
    }

    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
      console.log(`Received ${signal} signal. Shutting down gracefully...`);

      // Close the HTTP server
      if (httpServer) {
        await new Promise(resolve => httpServer.close(resolve));
        console.log('HTTP server closed.');
      }

      // Close the HTTPS server
      if (httpsServer) {
        await new Promise(resolve => httpsServer.close(resolve));
        console.log('HTTPS server closed.');
      }

      // Close jsreport
      if (jsreportInstance && typeof jsreportInstance.close === 'function') {
        try {
          await jsreportInstance.close();
          console.log('jsreport closed.');
        } catch (closeError) {
          console.error('Error closing jsreport:', closeError);
        }
      }

      process.exit(0);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    process.on('uncaughtException', async (err) => {
      console.error('Uncaught Exception:', err);
      await gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    if (jsreportInstance && typeof jsreportInstance.close === 'function') {
      try {
        await jsreportInstance.close();
      } catch (closeError) {
        console.error('Error closing jsreport:', closeError);
      }
    }
    process.exit(1);
  }
};

startServer();