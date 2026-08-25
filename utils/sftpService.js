const Client = require('ssh2-sftp-client');
const prisma = require('../src/lib/prisma');
const moment = require('moment');

class SFTPService {
  constructor() {
    this.sftp = null;
  }

  async testConnection(config) {
    console.log('Testing SFTP connection with config:', {
      host: config.host,
      port: config.port,
      username: config.username,
      hasPassword: !!config.password
    });

    // Create a new SFTP client for each connection
    const sftp = new Client();

    try {
      const connectionConfig = {
        host: config.host,
        port: parseInt(config.port) || 22,
        username: config.username,
        password: config.password,
        readyTimeout: 10000,
        retries: 3,
        debug: process.env.NODE_ENV === 'development' ? console.log : undefined
      };

      console.log('Attempting SFTP connection...');

      await sftp.connect(connectionConfig);
      console.log('SFTP connection established successfully');

      // Test if we can list the root directory
      try {
        await sftp.list('/');
        console.log('Directory listing successful');
      } catch (listError) {
        console.warn('Warning: Could not list directory:', listError.message);
        // Don't throw here - some servers might restrict listing
      }

      // Properly close the connection
      try {
        await sftp.end();
        console.log('SFTP connection closed successfully');
      } catch (closeError) {
        console.warn('Warning: Error during connection cleanup:', closeError.message);
      }

      return true;
    } catch (error) {
      console.error('SFTP Connection test failed with error:', {
        message: error.message,
        code: error.code,
        level: error.level
      });

      // Make sure to clean up even on error
      try {
        await sftp.end();
      } catch (closeError) {
        // Ignore close errors during cleanup
      }

      throw new Error(`SFTP Connection failed: ${error.message}`);
    }
  }

  async createDirectory(path) {
    if (!this.sftp) {
      this.sftp = new Client();
    }

    try {
      await this.sftp.mkdir(path, true);
      console.log(`Created directory: ${path}`);
    } catch (error) {
      if (error.code !== 'ERR_ENTRY_EXISTS') {
        console.error(`Error creating directory ${path}:`, error);
        throw error;
      }
    }
  }

  async saveConfig(config) {
    try {
      console.log('Saving SFTP config to database...');

      // First, deactivate ALL existing configs
      await WP_SFTP_CONFIG.update(
        { is_active: false },
        { where: {} } // This updates ALL records
      );

      // Then delete the existing config for this host/username if it exists
      await WP_SFTP_CONFIG.destroy({
        where: {
          host: config.host,
          username: config.username
        }
      });

      // Create new config
      console.log('Creating new SFTP config...');
      const sftpConfig = await WP_SFTP_CONFIG.create({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        root_path: '/SFTP_DATA', // Fixed root path
        incoming_manual_template: '/Incoming/Manual/{company}/{date}/[Inbound|Outbound]',
        incoming_schedule_template: '/Incoming/Schedule/{company}/{date}/[Inbound|Outbound]',
        outgoing_manual_template: '/Outgoing/Manual/{company}/{date}/[Inbound|Outbound]',
        outgoing_schedule_template: '/Outgoing/Schedule/{company}/{date}/[Inbound|Outbound]',
        is_active: true
      });

      // After saving, try to create the directory structure
      try {
        await this.createDirectoryStructure();
      } catch (dirError) {
        console.warn('Warning: Could not create directory structure:', dirError.message);
      }

      console.log('SFTP config saved successfully with ID:', sftpConfig.id);
      return sftpConfig;
    } catch (error) {
      console.error('Error saving SFTP config:', {
        message: error.message,
        stack: error.stack,
        original: error.original?.message,
        sql: error.sql
      });
      throw new Error(`Failed to save SFTP configuration: ${error.message}`);
    }
  }

  async getConfig() {
    try {
      console.log('Reading SFTP config from database...');
      const config = await WP_SFTP_CONFIG.findOne({
        where: { is_active: true },
        attributes: [
          'id', 'host', 'port', 'username', 'password',
          'root_path', 'incoming_manual_template',
          'incoming_schedule_template', 'outgoing_manual_template',
          'outgoing_schedule_template', 'is_active'
        ]
      });

      if (!config) {
        console.log('No existing SFTP config found');
        return {};
      }

      console.log('SFTP config loaded successfully');
      return config.get({ plain: true });
    } catch (error) {
      console.error('Error reading SFTP config:', error);
      return {};
    }
  }

  async createDirectoryStructure() {
    try {
      const config = await this.getConfig();
      if (!config.host || !config.password) {
        throw new Error('No valid SFTP configuration found');
      }

      // Get current date in YYYYMMDD format
      const today = moment().format('YYYYMMDD');
      const companyName = 'LHDN';

      // Define directories without /SFTP_DATA prefix
      const directories = [
        '/',
        `/${companyName}`,
        `/${companyName}/${today}`,
        `/${companyName}/${today}/Incoming`,
        `/${companyName}/${today}/Incoming/Manual`,
        `/${companyName}/${today}/Incoming/Schedule`,
        `/${companyName}/${today}/Outgoing`,
        `/${companyName}/${today}/Outgoing/Manual`,
        `/${companyName}/${today}/Outgoing/Schedule`
      ];

      // Create new connection
      this.sftp = new Client();
      await this.sftp.connect({
        host: config.host,
        port: parseInt(config.port) || 22,
        username: config.username,
        password: config.password,
        readyTimeout: 10000,
        retries: 3
      });

      // Create directories
      for (const dir of directories) {
        try {
          await this.sftp.mkdir(dir, true);
          console.log(`Created directory: ${dir}`);
        } catch (error) {
          if (error.code !== 'ERR_ENTRY_EXISTS') {
            console.error(`Error creating directory ${dir}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Error creating directory structure:', error);
      throw error;
    } finally {
      if (this.sftp) {
        try {
          await this.sftp.end();
        } catch (closeError) {
          console.warn('Warning: Error closing connection:', closeError.message);
        }
        this.sftp = null;
      }
    }
  }

  async listDirectoryStructure(path = '/') {
    try {
        const config = await this.getConfig();
        if (!config.host || !config.password) {
            throw new Error('No valid SFTP configuration found');
        }

        // Create new connection
        this.sftp = new Client();
        await this.sftp.connect({
            host: config.host,
            port: parseInt(config.port) || 22,
            username: config.username,
            password: config.password,
            readyTimeout: 10000,
            retries: 3,
            debug: process.env.NODE_ENV === 'development' ? console.log : undefined
        });

        console.log(`Listing directory: ${path}`);

        try {
            // Normalize path and remove SFTP_DATA prefix if present
            path = path.replace(/^\/SFTP_DATA/, '');
            path = path.replace(/\/+/g, '/');
            if (path === '') path = '/';

            // List directory contents
            const list = await this.sftp.list(path);
            console.log(`Found ${list.length} items in directory`);

            // Map SFTP items to our structure
            const structure = list.map(item => ({
                name: item.name,
                type: item.type === 'd' ? 'directory' : 'file',
                size: item.size || 0,
                modifyTime: new Date(item.modifyTime).toISOString(),
                permissions: item.rights,
                isDirectory: item.type === 'd'
            }));

            return {
                success: true,
                path: path,
                structure: structure
            };

        } catch (error) {
            if (error.code === 'ERR_GENERIC_CLIENT' && error.message.includes('No such file')) {
                // Directory doesn't exist, create the structure
                await this.createDirectoryStructure();
                return {
                    success: true,
                    path: path,
                    structure: []
                };
            }
            throw error;
        }
    } catch (error) {
        console.error(`Error listing directory ${path}:`, error);
        throw new Error(`Failed to list directory: ${error.message}`);
    } finally {
        if (this.sftp) {
            try {
                await this.sftp.end();
            } catch (closeError) {
                console.warn('Warning: Error closing connection:', closeError.message);
            }
            this.sftp = null;
        }
    }
}
}

module.exports = new SFTPService();