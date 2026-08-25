/**
 * LHDN UI Helper
 * Provides consistent UI error handling for LHDN errors
 */

// Common LHDN error codes and their user-friendly messages
const ERROR_CODES = {
  // Document validation errors
  'DS302': 'This document has already been submitted to LHDN.',
  'CF321': 'Document issue date is invalid. Documents must be submitted within 7 days of issuance.',
  'CF364': 'Invalid item classification code. Please check all item classification codes.',
  'CF401': 'Tax calculation error. Please verify all tax amounts and calculations.',
  'CF402': 'Currency error. Please check that all monetary values use the correct currency code.',
  'CF403': 'Invalid tax code. Please verify the tax codes used in your document.',
  'CF404': 'Missing required field. Please ensure all required fields are completed.',
  'CF405': 'Invalid format. Please check the format of all fields in your document.',
  'CF406': 'Invalid value. One or more fields contain invalid values.',
  'CF407': 'Document number already exists. Please use a unique document number.',
  
  // Authentication errors
  'AUTH001': 'Authentication failed. Please check your credentials.',
  'AUTH002': 'Session expired. Please log in again.',
  'AUTH003': 'Unauthorized access. You do not have permission to perform this action.',
  
  // System errors
  'SYS001': 'LHDN system error. Please try again later.',
  'SYS002': 'Connection timeout. Please check your internet connection and try again.',
  'SYS003': 'Service unavailable. LHDN services are currently down or under maintenance.',
  
  // Rate limiting
  'RATE_LIMIT': 'Rate limit exceeded. Please try again later.',
  
  // Default errors
  'VALIDATION_ERROR': 'Document validation failed. Please check the details and try again.',
  'SUBMISSION_ERROR': 'Document submission failed. Please try again later.',
  'EMPTY_RESPONSE': 'No response received from LHDN. The service might be unavailable.',
  'UNKNOWN_ERROR': 'An unknown error occurred. Please try again or contact support.'
};

/**
 * Format LHDN error for display
 * @param {Object|String|Array} error - The error object, string, or array
 * @returns {Object} Formatted error object with code, message, details, and suggestion
 */
function formatLHDNError(error) {
  // Initialize default error object
  let formattedError = {
    code: 'UNKNOWN_ERROR',
    message: 'An unknown error occurred',
    details: [],
    suggestion: 'Please try again or contact support'
  };
  
  try {
    // Handle string errors (try to parse as JSON)
    if (typeof error === 'string') {
      try {
        error = JSON.parse(error);
      } catch (e) {
        // If not valid JSON, use as message
        formattedError.message = error;
        return formattedError;
      }
    }
    
    // Handle array errors (take first item)
    if (Array.isArray(error)) {
      error = error[0] || error;
    }
    
    // Extract error details
    const code = error.code || error.errorCode || 'UNKNOWN_ERROR';
    const message = error.message || error.errorMessage || 'An unknown error occurred';
    const details = error.details || error.errorDetails || [];
    const target = error.target || '';
    
    // Use predefined message if available, otherwise use provided message
    const userFriendlyMessage = ERROR_CODES[code] || message;
    
    // Format details for display
    let formattedDetails = [];
    if (Array.isArray(details)) {
      formattedDetails = details;
    } else if (typeof details === 'string') {
      formattedDetails = [details];
    } else if (typeof details === 'object') {
      formattedDetails = Object.entries(details).map(([key, value]) => `${key}: ${value}`);
    }
    
    // Generate suggestion based on error code
    let suggestion = 'Please check the document and try again';
    if (code.startsWith('CF4')) {
      suggestion = 'Please verify all tax information and calculations';
    } else if (code.startsWith('AUTH')) {
      suggestion = 'Please log in again or contact your administrator';
    } else if (code.startsWith('SYS')) {
      suggestion = 'Please try again later or contact support';
    } else if (code === 'RATE_LIMIT') {
      suggestion = 'Please wait a few minutes before trying again';
    }
    
    // Return formatted error
    formattedError = {
      code,
      message: userFriendlyMessage,
      details: formattedDetails,
      target,
      suggestion
    };
  } catch (e) {
    console.error('Error formatting LHDN error:', e);
    // Keep default error object
  }
  
  return formattedError;
}

/**
 * Show LHDN error modal
 * @param {Object|String|Array} error - The error object, string, or array
 * @param {Object} options - Display options
 * @param {String} options.title - Modal title (default: 'LHDN Error')
 * @param {Boolean} options.showDetails - Whether to show error details (default: true)
 * @param {Boolean} options.showSuggestion - Whether to show suggestion (default: true)
 * @param {Function} options.onClose - Callback when modal is closed
 */
function showLHDNErrorModal(error, options = {}) {
  // Format error
  const formattedError = formatLHDNError(error);
  
  // Default options
  const defaultOptions = {
    title: 'LHDN Error',
    showDetails: true,
    showSuggestion: true,
    onClose: null
  };
  
  // Merge options
  const mergedOptions = { ...defaultOptions, ...options };
  
  // Create modal HTML
  const modalId = 'lhdnErrorModal';
  let modalHTML = `
    <div class="modal fade" id="${modalId}" tabindex="-1" aria-labelledby="${modalId}Label" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header bg-danger text-white">
            <h5 class="modal-title" id="${modalId}Label">
              <i class="fas fa-exclamation-triangle me-2"></i>${mergedOptions.title}
            </h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="error-code mb-2">
              <span class="badge bg-danger">${formattedError.code}</span>
            </div>
            <div class="error-message mb-3">
              <p class="mb-0">${formattedError.message}</p>
            </div>
  `;
  
  // Add details if available and showDetails is true
  if (mergedOptions.showDetails && formattedError.details && formattedError.details.length > 0) {
    modalHTML += `
      <div class="error-details mb-3">
        <h6 class="fw-bold">Details:</h6>
        <ul class="mb-0">
    `;
    
    // Add each detail as a list item
    formattedError.details.forEach(detail => {
      if (typeof detail === 'string') {
        modalHTML += `<li>${detail}</li>`;
      } else if (typeof detail === 'object') {
        const detailText = detail.message || detail.code || JSON.stringify(detail);
        modalHTML += `<li>${detailText}</li>`;
      }
    });
    
    modalHTML += `
        </ul>
      </div>
    `;
  }
  
  // Add suggestion if showSuggestion is true
  if (mergedOptions.showSuggestion && formattedError.suggestion) {
    modalHTML += `
      <div class="error-suggestion">
        <h6 class="fw-bold">Suggestion:</h6>
        <p class="mb-0">${formattedError.suggestion}</p>
      </div>
    `;
  }
  
  // Close modal HTML
  modalHTML += `
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Remove existing modal if it exists
  const existingModal = document.getElementById(modalId);
  if (existingModal) {
    existingModal.remove();
  }
  
  // Add modal to body
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  
  // Get modal element
  const modalElement = document.getElementById(modalId);
  
  // Initialize Bootstrap modal
  const modal = new bootstrap.Modal(modalElement);
  
  // Add event listener for modal close
  if (mergedOptions.onClose) {
    modalElement.addEventListener('hidden.bs.modal', mergedOptions.onClose);
  }
  
  // Show modal
  modal.show();
  
  // Return modal instance
  return modal;
}

/**
 * Show LHDN error toast
 * @param {Object|String|Array} error - The error object, string, or array
 * @param {Object} options - Display options
 * @param {String} options.position - Toast position (default: 'top-center')
 * @param {Number} options.autoHide - Auto-hide duration in ms, 0 to disable (default: 5000)
 * @param {Boolean} options.showDetails - Whether to show error details (default: false)
 */
function showLHDNErrorToast(error, options = {}) {
  // Format error
  const formattedError = formatLHDNError(error);
  
  // Default options
  const defaultOptions = {
    position: 'top-center',
    autoHide: 5000,
    showDetails: false
  };
  
  // Merge options
  const mergedOptions = { ...defaultOptions, ...options };
  
  // Create toast HTML
  const toastId = `lhdnErrorToast-${Date.now()}`;
  let toastHTML = `
    <div id="${toastId}" class="toast align-items-center text-white bg-danger border-0" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body">
          <div class="d-flex align-items-center mb-1">
            <i class="fas fa-exclamation-triangle me-2"></i>
            <strong>${formattedError.code}</strong>
          </div>
          <div>${formattedError.message}</div>
  `;
  
  // Add details if available and showDetails is true
  if (mergedOptions.showDetails && formattedError.details && formattedError.details.length > 0) {
    toastHTML += `<div class="mt-1 small">`;
    
    // Add first detail only (to keep toast compact)
    const detail = formattedError.details[0];
    if (typeof detail === 'string') {
      toastHTML += detail;
    } else if (typeof detail === 'object') {
      toastHTML += detail.message || detail.code || JSON.stringify(detail);
    }
    
    // Indicate if there are more details
    if (formattedError.details.length > 1) {
      toastHTML += ` <span class="text-white-50">(+${formattedError.details.length - 1} more)</span>`;
    }
    
    toastHTML += `</div>`;
  }
  
  // Close toast HTML
  toastHTML += `
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    </div>
  `;
  
  // Create toast container if it doesn't exist
  let toastContainer = document.querySelector(`.toast-container.${mergedOptions.position}`);
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = `toast-container position-fixed ${mergedOptions.position}`;
    
    // Set position styles
    if (mergedOptions.position.includes('top')) {
      toastContainer.style.top = '1rem';
    }
    if (mergedOptions.position.includes('bottom')) {
      toastContainer.style.bottom = '1rem';
    }
    if (mergedOptions.position.includes('start')) {
      toastContainer.style.left = '1rem';
    }
    if (mergedOptions.position.includes('end')) {
      toastContainer.style.right = '1rem';
    }
    if (mergedOptions.position.includes('center')) {
      toastContainer.style.left = '50%';
      toastContainer.style.transform = 'translateX(-50%)';
    }
    
    document.body.appendChild(toastContainer);
  }
  
  // Add toast to container
  toastContainer.insertAdjacentHTML('beforeend', toastHTML);
  
  // Get toast element
  const toastElement = document.getElementById(toastId);
  
  // Initialize Bootstrap toast
  const toast = new bootstrap.Toast(toastElement, {
    autohide: mergedOptions.autoHide > 0,
    delay: mergedOptions.autoHide
  });
  
  // Show toast
  toast.show();
  
  // Return toast instance
  return toast;
}

// Export functions
module.exports = {
  formatLHDNError,
  showLHDNErrorModal,
  showLHDNErrorToast,
  ERROR_CODES
};
