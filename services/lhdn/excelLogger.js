const fs = require('fs');
const path = require('path');

const writeJsonLog = (data, type, filename) => {
  try {
    const logsDir = path.join(process.cwd(), 'logs', 'json');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Check if file already exists with similar name pattern
    const files = fs.readdirSync(logsDir);
    const existingFiles = files.filter(f => f.startsWith(filename));
    
    // If files exist, remove them before creating new one
    existingFiles.forEach(file => {
      fs.unlinkSync(path.join(logsDir, file));
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(logsDir, `${filename}_${timestamp}.json`);

    fs.writeFileSync(logPath, JSON.stringify(data, null, 2));
    console.log(`[INFO] ${type} log written to: ${logPath}`);
  } catch (err) {
    console.error(`[ERROR] Error writing ${type} log:`, err);
  }
};

const logRawToJson = (rawData, filename) => {
  if (!rawData || !rawData.header || !rawData.header.invoiceNo) {
    console.error('[ERROR] Invalid document data for logging');
    return null;
  }

  const jsonData = {
    header: rawData.header || {},
    supplier: rawData.supplier || {},
    buyer: rawData.buyer || {},
    delivery: rawData.delivery || {},
    items: rawData.items || [],
    summary: rawData.summary || {},
    payment: rawData.payment || {},
    allowanceCharge: rawData.allowanceCharge || {}
  };

  writeJsonLog(jsonData, 'Raw to JSON', filename);
  return jsonData;
};

const logLhdnMapping = (mappedData, filename) => {
  writeJsonLog(mappedData, 'LHDN Mapping', `${filename}_lhdn`);
  return mappedData;
};

module.exports = {
  logRawToJson,
  logLhdnMapping
};