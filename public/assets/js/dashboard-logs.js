/**
 * Dashboard Activity Logs
 * This module handles fetching and displaying activity logs on the dashboard
 * using the WP_LOGS model.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize logs section
  initActivityLogs();
  
  // Set up filter dropdown functionality
  setupLogFilters();
});

/**
 * Initialize the activity logs section
 */
async function initActivityLogs() {
  const logsContainer = document.getElementById('activity-logs-list');
  const loadingElement = document.getElementById('logs-loading');
  const noDataElement = document.getElementById('logs-no-data');
  
  if (!logsContainer) return;
  
  try {
    // Show loading state
    loadingElement.classList.remove('d-none');
    noDataElement.classList.add('d-none');
    logsContainer.innerHTML = '';
    
    // Fetch logs from API
    const response = await fetch('/api/logs/recent', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Error fetching logs: ${response.statusText}`);
    }
    
    const logs = await response.json();
    
    // Hide loading state
    loadingElement.classList.add('d-none');
    
    // Check if we have logs to display
    if (!logs || logs.length === 0) {
      noDataElement.classList.remove('d-none');
      return;
    }
    
    // Render logs
    renderActivityLogs(logs, logsContainer);
    
  } catch (error) {
    console.error('Error loading activity logs:', error);
    loadingElement.classList.add('d-none');
    noDataElement.classList.remove('d-none');
  }
}

/**
 * Render activity logs in the container
 * @param {Array} logs - Array of log objects from WP_LOGS model
 * @param {HTMLElement} container - Container element to render logs in
 */
function renderActivityLogs(logs, container) {
  // Clear container
  container.innerHTML = '';
  
  // Process and render each log
  logs.forEach(log => {
    // Determine log type and styling
    const logStyle = getLogStyle(log);
    
    // Parse and format timestamp
    let timeString = 'N/A';
    try {
      const timestamp = parseSqlDateTime(log.CreateTS);
      if (timestamp && !isNaN(timestamp.getTime())) {
        timeString = formatTimestamp(timestamp);
      }
    } catch (error) {
      console.error('Error handling timestamp:', error, log.CreateTS);
    }
    
    // Create log item element
    const logItem = document.createElement('div');
    logItem.className = `activity-item d-flex align-items-start ${logStyle.logClass}`;
    logItem.setAttribute('data-log-type', logStyle.type);
    
    // Set inner HTML with log details
    logItem.innerHTML = `
      <div class="activity-icon ${logStyle.iconClass} me-3">
        <i class="${logStyle.icon}"></i>
      </div>
      <div class="flex-grow-1">
        <div class="activity-time">${timeString}</div>
        <div class="activity-message">${log.Description || 'No description available'}</div>
        <div class="activity-user">
          <span>${log.LoggedUser || 'System'}</span> · ${log.Module || 'General'} · ${log.Action || 'Action'}
        </div>
      </div>
    `;
    
    // Add to container
    container.appendChild(logItem);
  });
}

/**
 * Determine log styling based on log properties
 * @param {Object} log - Log object from WP_LOGS model
 * @returns {Object} Styling information for the log
 */
function getLogStyle(log) {
  const logType = log.LogType ? log.LogType.toLowerCase() : '';
  const status = log.Status ? log.Status.toLowerCase() : '';
  const description = log.Description ? log.Description.toLowerCase() : '';
  
  // Default to info
  let type = 'info';
  let icon = 'fas fa-info-circle';
  let iconClass = 'info-icon';
  let logClass = 'info-log';
  
  // Check log type first
  if (logType.includes('error') || status.includes('error') || status.includes('failed') || 
      description.includes('error') || description.includes('failed') || description.includes('invalid')) {
    type = 'error';
    icon = 'fas fa-exclamation-circle';
    iconClass = 'error-icon';
    logClass = 'error-log';
  } else if (logType.includes('warning') || status.includes('warning') || 
             description.includes('warning') || description.includes('attention')) {
    type = 'warning';
    icon = 'fas fa-exclamation-triangle';
    iconClass = 'warning-icon';
    logClass = 'warning-log';
  } else if (logType.includes('success') || status.includes('success') || status.includes('completed') || 
             description.includes('success') || description.includes('completed') || description.includes('valid')) {
    type = 'success';
    icon = 'fas fa-check-circle';
    iconClass = 'success-icon';
    logClass = 'success-log';
  }
  
  return { type, icon, iconClass, logClass };
}

/**
 * Format timestamp for display
 * @param {Date} timestamp - Date object to format
 * @returns {string} Formatted timestamp string
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return 'N/A';
  
  // SQL Server date format: Apr 7 2025 4:45PM
  const options = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  };
  
  try {
    return timestamp.toLocaleString('en-US', options);
  } catch (error) {
    console.error('Error formatting timestamp:', error);
    return 'N/A';
  }
}

/**
 * Parse SQL Server datetime string
 * @param {string} sqlDateTime - SQL Server datetime string (e.g., "Apr 7 2025 4:45PM")
 * @returns {Date} JavaScript Date object
 */
function parseSqlDateTime(sqlDateTime) {
  if (!sqlDateTime) return null;
  
  try {
    // Handle SQL Server datetime format
    if (typeof sqlDateTime === 'string') {
      // Try direct parsing first
      let date = new Date(sqlDateTime);
      
      // If invalid, try manual parsing
      if (isNaN(date.getTime())) {
        // Extract components from SQL Server format
        const match = sqlDateTime.match(/(\w+)\s+(\d+)\s+(\d{4})\s+(\d+):(\d+)([AP]M)/);
        if (match) {
          const [_, month, day, year, hours, minutes, ampm] = match;
          const monthIndex = new Date(`${month} 1, 2000`).getMonth();
          let hour = parseInt(hours);
          
          // Convert to 24-hour format
          if (ampm === 'PM' && hour < 12) hour += 12;
          if (ampm === 'AM' && hour === 12) hour = 0;
          
          date = new Date(year, monthIndex, day, hour, parseInt(minutes));
        }
      }
      
      return date;
    }
    return new Date(sqlDateTime);
  } catch (error) {
    console.error('Error parsing SQL datetime:', error, sqlDateTime);
    return null;
  }
}

/**
 * Set up log filter dropdown functionality
 */
function setupLogFilters() {
  const filterLinks = document.querySelectorAll('.dropdown-menu a[data-filter]');
  const filterButton = document.getElementById('logFilterDropdown');
  
  if (!filterLinks.length || !filterButton) return;
  
  filterLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Update active class
      filterLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      
      // Update dropdown button text
      const filterType = link.getAttribute('data-filter');
      const filterText = link.textContent;
      filterButton.innerHTML = `<i class="fas fa-filter me-1"></i>${filterText}`;
      
      // Filter logs
      filterLogs(filterType);
    });
  });
}

/**
 * Filter logs based on type
 * @param {string} filterType - Type of logs to show ('all', 'info', 'success', 'warning', 'error')
 */
function filterLogs(filterType) {
  const logItems = document.querySelectorAll('.activity-item');
  
  logItems.forEach(item => {
    if (filterType === 'all') {
      item.style.display = 'flex';
    } else {
      const itemType = item.getAttribute('data-log-type');
      item.style.display = itemType === filterType ? 'flex' : 'none';
    }
  });
  
  // Check if we need to show no data message
  const visibleItems = document.querySelectorAll('.activity-item[style="display: flex;"]');
  const noDataElement = document.getElementById('logs-no-data');
  
  if (visibleItems.length === 0 && noDataElement) {
    noDataElement.classList.remove('d-none');
  } else if (noDataElement) {
    noDataElement.classList.add('d-none');
  }
}

// Refresh logs every 5 minutes
setInterval(initActivityLogs, 300000); 