const { execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const prisma = require('../src/lib/prisma');

// Initialize SERVER_CONFIG with default values
const SERVER_CONFIG = {
  networkPath: '',
  credentials: {
    domain: '',
    username: '',
    password: ''
  }
};

// Function to get active SAP configuration from database
async function getActiveSAPConfig() {
  try {
    const config = await prisma.wP_CONFIGURATION.findFirst({
      where: {
        Type: 'SAP',
        IsActive: true
      },
      orderBy: {
        CreateTS: 'desc'
      }
    });

    if (!config) {
      return {
        success: false,
        error: 'No active SAP configuration found'
      };
    }

    // Parse Settings if it's a string
    let settings = config.Settings;
    if (typeof settings === 'string') {
      try {
        settings = JSON.parse(settings);
      } catch (parseError) {
        console.error('Error parsing SAP settings:', parseError);
        return {
          success: false,
          error: 'Invalid SAP configuration format'
        };
      }
    }

    // Validate required settings
    if (!settings || !settings.networkPath) {
      return {
        success: false,
        error: 'Network path not configured'
      };
    }

    // Format the network path
    let formattedPath = settings.networkPath;

    // If it's a drive letter path, ensure proper format
    if (/^[a-zA-Z]:/.test(formattedPath)) {
      formattedPath = formattedPath.replace(/\//g, '\\');
      // Remove any trailing backslashes
      formattedPath = formattedPath.replace(/\\+$/, '');
    }
    // If it's a UNC path, ensure proper format
    else if (formattedPath.startsWith('\\\\')) {
      formattedPath = formattedPath.replace(/\//g, '\\');
      formattedPath = formattedPath.replace(/\\+$/, '');
    }
    // If it's a relative path, convert to absolute
    else {
      formattedPath = path.resolve(formattedPath);
    }

    // Update SERVER_CONFIG
    SERVER_CONFIG.networkPath = formattedPath;
    SERVER_CONFIG.credentials = {
      domain: settings.domain || '',
      username: settings.username,
      password: settings.password
    };

    return {
      success: true,
      networkPath: formattedPath,
      ...settings
    };
  } catch (error) {
    console.error('Error getting SAP config:', error);
    return {
      success: false,
      error: error.message || 'Failed to retrieve SAP configuration'
    };
  }
}

/**
 * Executes a command and returns the result with detailed error information
 * @param {string} command - Command to execute
 * @param {Object} options - Command options
 * @returns {Object} Result object with success status and output/error details
 */
async function executeCommand(command, options = {}) {
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      windowsHide: true,
      ...options
    });
    return { success: true, output };
  } catch (error) {
    return {
      success: false,
      error: {
        message: error.message,
        stdout: error.stdout,
        stderr: error.stderr
      }
    };
  }
}

/**
 * Lists current network connections
 * @returns {Object} Result of net use command
 */
async function listConnections() {
  console.log('Checking current network connections...');
  const result = await executeCommand('net use');

  if (result.success) {
    console.log('Current connections:', result.output);
  } else {
    console.log('Failed to list connections:', result.error.message);
  }

  return result;
}

/**
 * Cleans up network connections
 * @returns {Promise<boolean>} Success status
 */
async function cleanupConnections() {
  console.log('Cleaning up network connections...');

  // Just delete all connections
  const deleteAll = await executeCommand('net use * /delete /y');
  if (!deleteAll.success) {
    console.log('General cleanup warning:', deleteAll.error.message);
  }

  return true; // Continue even if cleanup has warnings
}

/**
 * Tests directory access
 * @param {string} path - Path to test
 * @returns {Promise<Object>} Test results
 */
async function testDirectoryAccess(path) {
  console.log('Testing directory access:', path);
  try {
    await fs.access(path);

    // If access successful, try to list directory
    const dirResult = await executeCommand(`dir "${path}"`);
    if (dirResult.success) {
      console.log('Directory listing successful');
      return { success: true, listing: dirResult.output };
    } else {
      throw new Error(`Directory listing failed: ${dirResult.error.message}`);
    }
  } catch (error) {
    console.error('Directory access failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Establishes network connection
 * @returns {Promise<Object>} Connection result
 */
async function establishConnection() {
  const connectCommand = `net use "${SERVER_CONFIG.networkPath}" /USER:${SERVER_CONFIG.credentials.domain}\\${SERVER_CONFIG.credentials.username} "${SERVER_CONFIG.credentials.password}" /PERSISTENT:NO`;

  console.log('Attempting to establish connection...');
  const result = await executeCommand(connectCommand);

  if (result.success) {
    console.log('Connection established successfully');
    return { success: true };
  } else {
    console.error('Connection failed:', result.error);
    return {
      success: false,
      error: result.error
    };
  }
}

/**
 * Main function to validate network path access
 * @returns {Promise<Object>} Validation results
 */
async function validateNetworkPath() {
  console.log('\n=== Starting Network Path Validation ===\n');

  try {
    // Get active configuration from database
    const config = await getActiveSAPConfig();

    if (!config.success) {
      throw new Error(`Failed to get SAP configuration: ${config.error}`);
    }

    // Update SERVER_CONFIG with the retrieved configuration
    SERVER_CONFIG.networkPath = config.networkPath;
    SERVER_CONFIG.credentials = {
      domain: config.domain || '',
      username: config.username,
      password: config.password
    };

    // Step 1: List current connections
    await listConnections();

    // Step 2: Clean up existing connections
    await cleanupConnections();

    // Step 3: Wait briefly for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 4: Establish new connection using database config
    const connectCommand = `net use "${SERVER_CONFIG.networkPath}" /USER:${SERVER_CONFIG.credentials.domain}\\${SERVER_CONFIG.credentials.username} "${SERVER_CONFIG.credentials.password}" /PERSISTENT:NO`;
    const connectionResult = await executeCommand(connectCommand);

    if (!connectionResult.success) {
      throw new Error(`Connection failed: ${connectionResult.error.message}`);
    }

    // Step 5: Test directory access
    const accessResult = await testDirectoryAccess(SERVER_CONFIG.networkPath);
    if (!accessResult.success) {
      throw new Error(`Access test failed: ${accessResult.error}`);
    }

    return {
      success: true,
      message: 'Network path validation completed successfully'
    };

  } catch (error) {
    console.error('Validation failed:', error.message);
    return {
      success: false,
      error: error.message
    };
  } finally {
    // Always try to cleanup at the end
    try {
      await cleanupConnections();
      console.log('\nFinal connection cleanup completed');
    } catch (e) {
      console.log('\nFinal cleanup warning:', e.message);
    }
  }
}

async function validateAndFormatNetworkPath(path) {
  // Replace forward slashes with backslashes
  path = path.replace(/\//g, '\\');

  // Remove any trailing slashes
  path = path.replace(/\\+$/, '');

  // Only format as UNC path if it's a network path
  if (path.startsWith('\\\\')) {
    // Ensure no double backslashes in the middle of the path
    path = path.replace(/\\{2,}/g, '\\\\');
  } else {
    // For local paths, ensure proper format
    path = path.replace(/\\{2,}/g, '\\');
  }

  return path;
}

async function testNetworkPathAccessibility(path, credentials) {
  try {
      // Check if this is a local path or network path
      const isNetworkPath = path.startsWith('\\\\');

      if (isNetworkPath) {
          // Handle network path with credentials
          const connectCommand = `net use "${path}" /USER:${credentials.serverName}\\${credentials.serverUsername} "${credentials.serverPassword}" /PERSISTENT:NO`;
          const connectResult = await executeCommand(connectCommand);

          if (!connectResult.success) {
              const errorMsg = connectResult.error.stderr || connectResult.error.message;
              if (errorMsg.includes('System error 53')) {
                  throw new Error(`Network path "${path}" not found. Please verify the path exists.`);
              } else if (errorMsg.includes('System error 1326')) {
                  throw new Error('Login credentials are incorrect. Please verify username and password.');
              } else if (errorMsg.includes('System error 86')) {
                  throw new Error('Network path already connected. Trying to reconnect...');
              } else {
                  throw new Error(`Connection failed: ${errorMsg}`);
              }
          }
      }

      // Test directory access (works for both local and network paths)
      try {
          await fs.access(path);
          const dirTest = await executeCommand(`dir "${path}"`);
          if (!dirTest.success) {
              throw new Error('Cannot list directory contents. Check permissions.');
          }
      } catch (error) {
          throw new Error(`Cannot access directory: ${error.message}`);
      }

      return {
          success: true,
          formattedPath: path
      };

  } catch (error) {
      return {
          success: false,
          error: error.message,
          formattedPath: path
      };
  } finally {
      // Cleanup network connection if it was established
      if (path.startsWith('\\\\')) {
          try {
              await executeCommand(`net use "${path}" /delete /y`);
          } catch (e) {
              console.warn('Cleanup warning:', e);
          }
      }
  }
}

module.exports = {
  validateNetworkPath,
  cleanupConnections,
  getActiveSAPConfig,
  SERVER_CONFIG,
  // Export additional functions for testing and flexibility
  listConnections,
  testDirectoryAccess,
  establishConnection,
  testNetworkPathAccessibility,
  validateAndFormatNetworkPath
};