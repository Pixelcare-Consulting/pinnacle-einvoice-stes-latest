const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const getPdfHash = async (documentData) => {
  const dataToHash = JSON.stringify({
    internalId: documentData.internalId,
    dateTimeValidated: documentData.dateTimeValidated,
    totalPayableAmount: documentData.totalPayableAmount
  });
  return crypto.createHash('md5').update(dataToHash).digest('hex');
};

const cleanupOldFiles = () => {
  const pdfDir = path.join(__dirname, '../pdf');
  if (!fs.existsSync(pdfDir)) return;

  fs.readdir(pdfDir, (err, files) => {
    if (err) {
      console.error('Error reading pdf directory:', err);
      return;
    }

    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    files.forEach(file => {
      const filePath = path.join(pdfDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error(`Error getting stats for file ${file}:`, err);
          return;
        }

        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlink(filePath, err => {
            if (err) {
              console.error(`Error deleting file ${file}:`, err);
            } else {
              console.log(`Deleted old file: ${file}`);
            }
          });
        }
      });
    });
  });
};

module.exports = {
  getPdfHash,
  cleanupOldFiles
}; 