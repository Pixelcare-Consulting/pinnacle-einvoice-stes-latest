const loggingConfig = {
    // Database query logging
    sequelize: {
        logging: false  // Disable SQL query logging
    },

    // Application logging levels
    app: {
        errors: true,      // Always log errors
        warnings: false,    // Log warnings
        info: false,        // Enable general info logging
        debug: false,      // Don't log debug info
        queries: false     // Don't log database queries
    },

    // Authentication logging
    auth: {
        loginAttempts: false,      // Log all login attempts
        successfulLogins: false,    // Log successful logins
        failedLogins: false,       // Log failed logins
        logouts: false,            // Log logouts
        sessionActivity: false,     // Log session activities
        ipTracking: false,         // Track IP addresses
        userAgentTracking: false   // Track user agents
    }
};

module.exports = loggingConfig; 