const formatNumber = (value) => {
  if (!value || isNaN(value)) return '0.00';
  const num = parseFloat(value);
  return num.toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const formatCurrency = (value) => {
  if (!value || isNaN(value)) return 'MYR 0.00';
  return `MYR ${parseFloat(value).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
};

module.exports = {
  formatNumber,
  formatCurrency
}; 