require('dotenv').config();

// For debugging purposes
console.log('Database config loaded with:');
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_NAME:', process.env.DB_NAME);

const config = {
  HOST: process.env.DB_HOST,
  USER: process.env.DB_USER,
  PASSWORD: process.env.DB_PASSWORD,
  DB: process.env.DB_NAME,
  dialect: "mssql",
  dialectOptions: {
    options: {
      useUTC: false,
      dateFirst: 1,
      enableArithAbort: false,
      trustServerCertificate: true
    },
    useUTC: false,
    authentication: {
      type: 'default',
      options: {
        userName: process.env.DB_USER,
        password: process.env.DB_PASSWORD
      }
    },
    server: process.env.DB_HOST
  },
  define: {
    timestamps: false
  }
};

module.exports = config;