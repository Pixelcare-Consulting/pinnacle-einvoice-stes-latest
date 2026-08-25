module.exports = {
  apps: [
    {
      name: 'eInvoice',
      script: './server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      ignore_watch: ["node_modules", "public", "logs", "*.log", "temp", "*.xlsx", "config", "AuthorizeToken.ini"],
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        SECURE_COOKIE: 'false',
        TRUST_PROXY: 'true',
      },
      env_production: {
        NODE_ENV: 'production',
        SECURE_COOKIE: 'false',
        TRUST_PROXY: 'true',
      },
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_size: '100M',
      rotate_interval: '1d',
      retain_history: 30,
      merge_logs: true,
      time: true
    }
  ]
};
