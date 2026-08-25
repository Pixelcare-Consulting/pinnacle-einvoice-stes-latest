const handleShutdown = async (jsreportInstance) => {
  console.log('Shutdown signal received, cleaning up...');
  if (jsreportInstance) {
    await jsreportInstance.close();
    console.log('jsreport closed');
  }
  process.exit(0);
};

module.exports = {
  handleShutdown
}; 