// Utility functions for formatting and data handling
const Utils = {
    formatCurrency: (amount, currency = 'MYR') => {
        return new Intl.NumberFormat('en-MY', {
            style: 'currency',
            currency: currency
        }).format(amount);
    },

    formatDate: (date) => {
        return moment(date).format('DD-MM-YYYY');
    },

    formatDateTime: (date) => {
        return moment(date).format('DD-MM-YYYY HH:mm:ss');
    },

    formatRelativeTime: (date) => {
        return moment(date).fromNow();
    }
};

// Export the utils
window.Utils = Utils;
