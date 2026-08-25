const jsreport = require('jsreport-core')();

const initJsReport = async () => {
  try {
    jsreport.use(require('jsreport-jsrender')());
    jsreport.use(require('jsreport-chrome-pdf')({
      launchOptions: {
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ],
        headless: 'new'
      },
      strategy: 'dedicated-process',
      timeout: 60000
    }));

    await jsreport.init();
    console.log('jsreport initialized successfully');
    return jsreport;
  } catch (error) {
    console.error('Error initializing jsreport:', error);
    throw error;
  }
};

module.exports = {
  jsreport,
  initJsReport
}; 