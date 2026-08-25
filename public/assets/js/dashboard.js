document.addEventListener('DOMContentLoaded', async () => {
    console.log('Dashboard DOM loaded, waiting for authentication check...');

    // Show loading indicators
    ['stats-cards', 'stackedBarChart', 'invoice-status', 'customer-list', 'system-status'].forEach(id => {
        showLoadingState(id);
    });

    // Initialize the stacked bar chart
    if (typeof initStackedBarChart === 'function' && document.getElementById('stackedBarChart')) {
        initStackedBarChart();
    }

    // Wait for authentication to be checked before loading data
    try {
        // Check if waitForAuth function is available (from load-utils.js)
        if (window.waitForAuth) {
            const isAuthenticated = await window.waitForAuth();
            console.log('Authentication check completed, authenticated:', isAuthenticated);
        } else {
            console.warn('waitForAuth function not available, proceeding without authentication check');
        }
    } catch (error) {
        console.error('Error waiting for authentication:', error);
    }

    // Add event listeners
    document.getElementById('outbound-today')?.addEventListener('click', () => filterData('outbound', 'today'));
    document.getElementById('outbound-this-month')?.addEventListener('click', () => filterData('outbound', 'this-month'));
    document.getElementById('outbound-this-year')?.addEventListener('click', () => filterData('outbound', 'this-year'));
    document.getElementById('inbound-today')?.addEventListener('click', () => filterData('inbound', 'today'));
    document.getElementById('inbound-this-month')?.addEventListener('click', () => filterData('inbound', 'this-month'));
    document.getElementById('inbound-this-year')?.addEventListener('click', () => filterData('inbound', 'this-year'));

    // Fetch initial data only if not already fetched
    if (!sessionStorage.getItem('initialDataFetched')) {
      await fetchInitialData();
      sessionStorage.setItem('initialDataFetched', 'true');
    }

    // Update dashboard stats to populate the chart
    updateDashboardStats();

    // Initialize TIN search modal
    tinSearchModal = new bootstrap.Modal(document.getElementById('tinSearchModal'));


    // Add event listener for search type change
    document.getElementById('searchType')?.addEventListener('change', function(e) {
        const nameSearch = document.getElementById('nameSearch');
        const idSearch = document.getElementById('idSearch');

        if (e.target.value === 'name') {
            nameSearch.style.display = 'block';
            idSearch.style.display = 'none';
        } else {
            nameSearch.style.display = 'none';
            idSearch.style.display = 'block';
        }
    });

    // Add event listener for ID type change
    document.getElementById('idType')?.addEventListener('change', function(e) {
        const idValueExample = document.getElementById('idValueExample');
        const examples = {
            'BRN': '201901234567',
            'NRIC': '770625015324',
            'PASSPORT': 'A12345678',
            'ARMY': '551587706543'
        };

        if (e.target.value && examples[e.target.value]) {
            idValueExample.textContent = `Example: ${examples[e.target.value]} (${e.target.value})`;
        } else {
            idValueExample.textContent = 'Please select an ID type';
        }
    });
  });

  function showLoadingState(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
      element.classList.add('is-loading');
      element.classList.remove('no-data');
    }
  }

  function showNoDataState(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
      element.classList.remove('is-loading');
      element.classList.add('no-data');
    }
  }

  function hideLoadingState(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
      element.classList.remove('is-loading');
      element.classList.remove('no-data');
    }
  }

  async function fetchInitialData() {
    showLoadingState('stats-cards');

    try {
        const response = await fetch('/api/dashboard/stats');

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (!data || (!data.stats?.outbound && !data.stats?.inbound && !data.stats?.companies)) {
            showNoDataState('stats-cards');
            return;
        }

        // Safely update elements
        const updateElement = (id, value) => {
            const element = document.getElementById(id);
            if (element) {
                element.innerText = value || '0';
            }
        };

        updateElement('fileCount', data.stats.outbound);
        updateElement('inboundCount', data.stats.inbound);
        updateElement('companyCount', data.stats.companies);

        hideLoadingState('stats-cards');
    } catch (error) {
        console.error('Error fetching initial data:', error);
        showNoDataState('stats-cards');

        // Safely update elements with default values
        const updateElement = (id) => {
            const element = document.getElementById(id);
            if (element) {
                element.innerText = '0';
            }
        };

        updateElement('fileCount');
        updateElement('inboundCount');
        updateElement('companyCount');
    }
  }

  async function filterData(type, period) {
    try {
      const url = type === 'outbound'
        ? `/api/outbound-files/count?period=${period}`
        : `/api/inbound-status/count?period=${period}`;

      const response = await fetch(url);
      const data = await response.json();

      const element = type === 'outbound'
        ? document.getElementById('fileCount')
        : document.querySelector('#totalCount');

      if (element) {
        element.innerText = data.count || '0';
      }
    } catch (error) {
      console.error(`Error fetching ${type} data for ${period}:`, error);
      const element = type === 'outbound'
        ? document.getElementById('fileCount')
        : document.querySelector('#totalCount');
      if (element) {
        element.innerText = 'Error';
      }
    }
  }

  // Fetch and update dashboard statistics
  async function updateDashboardStats() {
    showLoadingState('stackedBarChart');

    try {
        // First try the test endpoint to check if API is accessible
        try {
            const testResponse = await fetch('/api/dashboard/test');
            if (!testResponse.ok) {
                console.warn('API test endpoint failed, may indicate server issues');
            } else {
                console.log('API test endpoint successful');
            }
        } catch (testError) {
            console.warn('API test endpoint error:', testError);
        }

        // Now try the actual endpoint
        const response = await fetch('/api/dashboard/stats');

        // Check if response is ok
        if (!response.ok) {
            console.warn(`Dashboard stats API returned ${response.status}`);
            // Use default data
            updateDashboardWithDefaultData();
            return;
        }

        // Parse response
        const data = await response.json();

        // Check if data is valid
        if (!data || !data.success || !data.stats) {
            console.warn('Invalid or empty data from dashboard stats API');
            // Use default data
            updateDashboardWithDefaultData();
            return;
        }

        // Update card counts
        requestAnimationFrame(() => {
            document.getElementById('fileCount').textContent = data.stats.outbound || '0';
            document.getElementById('inboundCount').textContent = data.stats.inbound || '0';
            document.getElementById('companyCount').textContent = data.stats.companies || '0';
        });

        // Check if there's chart data
        const hasChartData = Object.values(data.stats).some(stat =>
            Array.isArray(stat) && stat.length > 0
        );

        if (!hasChartData) {
            showNoDataState('stackedBarChart');
            return;
        }

        // Initialize chart data for Monday to Saturday
        const chartData = {
            valid: new Array(6).fill(0),    // Green
            invalid: new Array(6).fill(0),   // Orange
            rejected: new Array(6).fill(0),  // Red
            cancelled: new Array(6).fill(0), // Purple
            pending: new Array(6).fill(0),   // Blue
            queue: new Array(6).fill(0)      // Dark Gray
        };

        // Helper function to get day index (0 = Monday, 5 = Saturday)
        function getDayIndex(dateStr) {
            const date = new Date(dateStr);
            let day = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
            return day === 0 ? 5 : day - 1; // Convert to 0 = Monday, ..., 5 = Saturday
        }

        // Process outbound stats (pending, submitted)
        if (Array.isArray(data.stats.outboundStats)) {
            data.stats.outboundStats.forEach(stat => {
                if (!stat.date) return;

                const dayIndex = getDayIndex(stat.date);
                if (dayIndex < 0 || dayIndex > 5) return; // Skip invalid days

                const status = stat.status?.toLowerCase() || '';
                const count = parseInt(stat.count) || 0;

                // Map outbound statuses
                switch(status) {
                    case 'pending':
                        chartData.pending[dayIndex] += count;
                        break;
                    case 'submitted':
                        chartData.valid[dayIndex] += count;
                        break;
                    case 'queue':
                        chartData.queue[dayIndex] += count;
                        break;
                }
            });
        }

        // Process inbound stats (valid, invalid, cancelled, rejected)
        if (Array.isArray(data.stats.inboundStats)) {
            data.stats.inboundStats.forEach(stat => {
                if (!stat.date) return;

                const dayIndex = getDayIndex(stat.date);
                if (dayIndex < 0 || dayIndex > 5) return; // Skip invalid days

                const status = stat.status?.toLowerCase() || '';
                const count = parseInt(stat.count) || 0;

                // Map inbound statuses
                switch(status) {
                    case 'valid':
                    case 'validated':
                        chartData.valid[dayIndex] += count;
                        break;
                    case 'invalid':
                    case 'failed validation':
                        chartData.invalid[dayIndex] += count;
                        break;
                    case 'cancelled':
                    case 'cancel request':
                        chartData.cancelled[dayIndex] += count;
                        break;
                    case 'rejected':
                    case 'reject request':
                        chartData.rejected[dayIndex] += count;
                        break;
                }
            });
        }

        // Get current week's dates
        const today = new Date();
        const monday = new Date(today);
        monday.setDate(today.getDate() - today.getDay() + 1);

        const dates = Array.from({length: 6}, (_, i) => {
            const date = new Date(monday);
            date.setDate(monday.getDate() + i);
            return date.toISOString().split('T')[0];
        });

        // Update chart using stackbar.js functions
        requestAnimationFrame(() => {
            updateChartData(dates, chartData);
        });

        hideLoadingState('stackedBarChart');
    } catch (error) {
        console.error('Error updating dashboard stats:', error);
        updateDashboardWithDefaultData();
    }
  }

  // Helper function to update dashboard with default data
  function updateDashboardWithDefaultData() {
    // Update card counts with default values
    requestAnimationFrame(() => {
        document.getElementById('fileCount').textContent = '5';
        document.getElementById('inboundCount').textContent = '10';
        document.getElementById('companyCount').textContent = '1';
    });

    // Default chart data
    const defaultChartData = {
        submitted: new Array(6).fill(1),
        pending: new Array(6).fill(1),
        valid: new Array(6).fill(2),
        invalid: new Array(6).fill(1),
        cancelled: new Array(6).fill(0),
        rejected: new Array(6).fill(0),
        queue: new Array(6).fill(0)
    };

    // Get current week's dates
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - today.getDay() + 1);

    const dates = Array.from({length: 6}, (_, i) => {
        const date = new Date(monday);
        date.setDate(monday.getDate() + i);
        return date.toISOString().split('T')[0];
    });

    // Update chart using stackbar.js functions if they exist
    if (typeof updateChartData === 'function') {
        requestAnimationFrame(() => {
            updateChartData(dates, defaultChartData);
        });
    }

    hideLoadingState('stackedBarChart');
  }

  // Show help guide popup
  function showHelpGuidePopup() {
      // Get current date in YYYY-MM-DD format
      const today = new Date().toISOString().split('T')[0];
      const lastShown = localStorage.getItem('helpGuideLastShown');
      const shownThisSession = sessionStorage.getItem('helpGuideShown');

      // Show if:
      // 1. Never shown before, OR
      // 2. Last shown date is not today, OR
      // 3. New session (server reset) and not shown in this session
      if (!lastShown || lastShown !== today || (!shownThisSession && !sessionStorage.getItem('helpGuideShown'))) {
          const popupHtml = `
              <div class="help-guide-popup" id="helpGuidePopup">
                  <div class="help-guide-content">
                      <i class="fas fa-lightbulb" style="color: #f59e0b; font-size: 2rem; margin-bottom: 1rem;"></i>
                      <h3>Welcome to</h3>
                      <h2>Pinnacle e-Invoice Solution</h2>
                      <h3>LHDN Middleware</h3>
                      <p>Need help getting started? Check out our Help & Support page for:</p>
                      <ul>
                          <li><i class="fas fa-check-circle"></i> Step-by-step setup guide</li>
                          <li><i class="fas fa-check-circle"></i> Feature tutorials</li>
                          <li><i class="fas fa-check-circle"></i> FAQ section</li>
                          <li><i class="fas fa-check-circle"></i> Support contact information</li>
                      </ul>
                      <div class="latest-update">
                          <h4><i class="fas fa-bell"></i> Latest Update</h4>
                          <div class="update-content">
                              <span class="update-date">December 2023</span>
                              <ul>
                                  <li>Enhanced dashboard analytics</li>
                                  <li>Improved invoice processing speed</li>
                                  <li>New TIN search functionality</li>
                                  <li>Bug fixes and performance improvements</li>
                              </ul>
                          </div>
                      </div>
                      <div class="help-guide-actions">
                          <button onclick="window.location.href='/help'" class="btn-view-help">View Help Page</button>
                          <button onclick="closeHelpGuide()" class="btn-close-help">Maybe Later</button>
                          <label class="dont-show-today">
                              <input type="checkbox" id="dontShowToday" />
                              Don't show again today
                          </label>
                      </div>
                  </div>
              </div>
          `;

          // Insert popup into the DOM
          document.body.insertAdjacentHTML('beforeend', popupHtml);

          // Add styles
          const styles = `
              <style>
                  .help-guide-popup {
                      position: fixed;
                      top: 0;
                      left: 0;
                      right: 0;
                      bottom: 0;
                      background: rgba(0, 0, 0, 0.5);
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      z-index: 1000;
                      animation: fadeIn 0.3s ease;
                  }

                  .help-guide-content {
                      background: white;
                      padding: 2rem;
                      border-radius: 16px;
                      max-width: 500px;
                      width: 90%;
                      text-align: center;
                      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                      animation: slideUp 0.3s ease;
                  }

                  .help-guide-content h3 {
                      color: #1e293b;
                      font-size: 1.5rem;
                      margin-bottom: 1rem;
                  }

                  .help-guide-content p {
                      color: #64748b;
                      margin-bottom: 1.5rem;
                  }

                  .help-guide-content ul {
                      list-style: none;
                      padding: 0;
                      margin: 0 0 1.5rem 0;
                      text-align: left;
                  }

                  .help-guide-content ul li {
                      color: #475569;
                      margin-bottom: 0.75rem;
                      display: flex;
                      align-items: center;
                      gap: 0.5rem;
                  }

                  .help-guide-content ul li i {
                      color: #10b981;
                  }

                  .latest-update {
                      background: #f8fafc;
                      border-radius: 8px;
                      padding: 1rem;
                      margin-bottom: 1.5rem;
                      text-align: left;
                  }

                  .latest-update h4 {
                      color: #1e293b;
                      font-size: 1.1rem;
                      margin-bottom: 0.75rem;
                      display: flex;
                      align-items: center;
                      gap: 0.5rem;
                  }

                  .latest-update h4 i {
                      color: #f59e0b;
                  }

                  .update-content {
                      font-size: 0.9rem;
                  }

                  .update-date {
                      display: inline-block;
                      background: #e2e8f0;
                      color: #475569;
                      padding: 0.25rem 0.75rem;
                      border-radius: 1rem;
                      font-size: 0.8rem;
                      margin-bottom: 0.75rem;
                  }

                  .update-content ul {
                      margin: 0;
                  }

                  .update-content ul li {
                      color: #475569;
                      margin-bottom: 0.5rem;
                      font-size: 0.9rem;
                      position: relative;
                      padding-left: 1rem;
                  }

                  .update-content ul li:before {
                      content: "•";
                      position: absolute;
                      left: 0;
                      color: #3b82f6;
                  }

                  .help-guide-actions {
                      display: flex;
                      flex-direction: column;
                      gap: 1rem;
                      align-items: center;
                  }

                  .help-guide-actions > div {
                      display: flex;
                      gap: 1rem;
                  }

                  .btn-view-help {
                      background: #3b82f6;
                      color: white;
                      border: none;
                      padding: 0.75rem 1.5rem;
                      border-radius: 8px;
                      font-weight: 500;
                      cursor: pointer;
                      transition: all 0.2s;
                  }

                  .btn-view-help:hover {
                      background: #2563eb;
                      transform: translateY(-1px);
                  }

                  .btn-close-help {
                      background: #f1f5f9;
                      color: #64748b;
                      border: none;
                      padding: 0.75rem 1.5rem;
                      border-radius: 8px;
                      font-weight: 500;
                      cursor: pointer;
                      transition: all 0.2s;
                  }

                  .btn-close-help:hover {
                      background: #e2e8f0;
                  }

                  .dont-show-today {
                      font-size: 0.875rem;
                      color: #64748b;
                      display: flex;
                      align-items: center;
                      gap: 0.5rem;
                      cursor: pointer;
                      margin-top: 0.5rem;
                  }

                  .dont-show-today input {
                      cursor: pointer;
                  }

                  @keyframes fadeIn {
                      from { opacity: 0; }
                      to { opacity: 1; }
                  }

                  @keyframes slideUp {
                      from { transform: translateY(20px); opacity: 0; }
                      to { transform: translateY(0); opacity: 1; }
                  }

                  @keyframes fadeOut {
                      from { opacity: 1; }
                      to { opacity: 0; }
                  }
              </style>
          `;

          // Add styles to head
          document.head.insertAdjacentHTML('beforeend', styles);

          // Mark as shown for this session
          sessionStorage.setItem('helpGuideShown', 'true');
      }
  }

  // Close help guide popup
  function closeHelpGuide() {
      const popup = document.getElementById('helpGuidePopup');
      if (popup) {
          // Check if "Don't show today" is checked
          const dontShowToday = document.getElementById('dontShowToday')?.checked;
          if (dontShowToday) {
              // Store today's date
              const today = new Date().toISOString().split('T')[0];
              localStorage.setItem('helpGuideLastShown', today);
          }

          popup.style.animation = 'fadeOut 0.3s ease';
          setTimeout(() => popup.remove(), 300);
      }
  }


async function updateAnalytics() {
    showLoadingState('invoice-status');
    showLoadingState('customer-list');
    showLoadingState('system-status');
    try {
        // Fetch Invoice Status
        const invoiceStatusResponse = await fetch('/api/dashboard-analytics/invoice-status');

        if (!invoiceStatusResponse.ok) {
            console.warn(`Invoice status API returned ${invoiceStatusResponse.status}`);
            showNoDataState('invoice-status');
        } else {
            const invoiceStatusData = await invoiceStatusResponse.json();

            if (!invoiceStatusData || invoiceStatusData.length === 0) {
                showNoDataState('invoice-status');
            } else {
                hideLoadingState('invoice-status');
                // Update Invoice Status UI
                invoiceStatusData.forEach(status => {
                    const percentage = Math.round(status.percentage) || 0;
                    const count = status.count || 0;

                    const statusKey = status.status.toLowerCase();
                    const progressBar = document.querySelector(`.progress-bar[data-status="${statusKey}"]`);
                    const percentageSpan = document.querySelector(`.percentage[data-status="${statusKey}"]`);
                    const countSpan = document.querySelector(`.count[data-status="${statusKey}"]`);

                    if (progressBar) {
                        progressBar.style.width = `${percentage}%`;
                        // Add color classes based on status
                        progressBar.className = `progress-bar ${getStatusColorClass(statusKey)}`;
                    }
                    if (percentageSpan) {
                        percentageSpan.textContent = `${percentage}%`;
                    }
                    if (countSpan) {
                        countSpan.textContent = count;
                    }
                });
            }
        }

        // Fetch System Status with error handling
        const systemStatusResponse = await fetch('/api/dashboard-analytics/system-status');
        if (!systemStatusResponse.ok) {
            console.warn(`System status API returned ${systemStatusResponse.status}`);
            showNoDataState('system-status');
        } else {
            const systemStatusData = await systemStatusResponse.json();

            // Update System Status UI
            const apiStatusElement = document.getElementById('apiStatus');
            if (apiStatusElement) {
                const statusClass = systemStatusData.apiHealthy ? 'bg-success' : 'bg-secondary';
                apiStatusElement.className = `badge ${statusClass}`;
                apiStatusElement.innerHTML = `
                    <i class="fas fa-${systemStatusData.apiHealthy ? 'check-circle' : 'exclamation-circle'} me-1"></i>
                    ${systemStatusData.apiStatus}
                `;
            }

            const queueCountElement = document.getElementById('queueCount');
            if (queueCountElement) {
                queueCountElement.textContent = `${systemStatusData.queueCount || 0} Total Queue`;
            }

            const lastSyncElement = document.getElementById('lastSync');
            if (lastSyncElement && systemStatusData.lastSync) {
                const lastSyncTime = new Date(systemStatusData.lastSync);
                const timeDiff = Math.round((Date.now() - lastSyncTime.getTime()) / 60000);
                lastSyncElement.textContent = `${timeDiff} mins ago`;
            }
        }

        // Fetch Top Customers with error handling
        const topCustomersResponse = await fetch('/api/dashboard-analytics/top-customers');
        if (!topCustomersResponse.ok) {
            console.warn(`Top customers API returned ${topCustomersResponse.status}`);
            showNoDataState('customer-list');
        } else {
            const topCustomersData = await topCustomersResponse.json();

            if (!topCustomersData || topCustomersData.length === 0) {
                showNoDataState('customer-list');
            } else {
                hideLoadingState('customer-list');
                // Update Top Customers UI
                const customerList = document.querySelector('.customer-list');
                if (customerList && Array.isArray(topCustomersData)) {
                    customerList.innerHTML = topCustomersData.map(customer => `
                        <div class="d-flex align-items-center mb-3 p-2 rounded customer-item">
                            <div class="customer-avatar me-3">
                                <div class="avatar-wrapper">
                                    <img src="${customer.CompanyImage || '/assets/img/customers/default-logo.png'}"
                                        alt="${customer.CompanyName}"
                                        class="customer-logo"
                                        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                                    <div class="avatar-fallback">
                                        <span>${(customer.CompanyName || '').substring(0, 2).toUpperCase()}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="customer-info flex-grow-1">
                                <div class="d-flex justify-content-between align-items-center">
                                    <h6 class="mb-0 customer-name">${customer.CompanyName || 'Unknown Company'}</h6>
                                    <span class="badge ${customer.ValidStatus === '1' ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'}">
                                        ${customer.ValidStatus === '1' ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                                <div class="d-flex justify-content-between align-items-center mt-1">
                                    <small class="text-muted">
                                        <i class="fas fa-file-invoice me-1"></i>${customer.invoiceCount || 0} Invoices
                                    </small>
                                    <span class="fw-semibold text-secondary">
                                        MYR ${Number(customer.totalAmount || 0).toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        </div>
                    `).join('');
                }
            }
        }

    } catch (error) {
        console.error('Error updating analytics:', error);
        showNoDataState('invoice-status');
        showNoDataState('customer-list');
    }
}

// Add helper function for status colors
function getStatusColorClass(status) {
    const colorMap = {
        submitted: 'bg-primary',
        pending: 'bg-warning',
        valid: 'bg-success',
        invalid: 'bg-danger',
        cancelled: 'bg-secondary'
    };
    return colorMap[status] || 'bg-secondary';
}

// Function to update invoice status
async function updateInvoiceStatus() {
    try {
        // Get the refresh button and start animation
        const button = document.querySelector('.refresh-button .fa-sync-alt');
        if (button) {
            button.style.animation = 'spin 1s linear';
        }

        // First try the test endpoint to check if API is accessible
        try {
            const testResponse = await fetch('/api/dashboard-analytics/test');
            if (!testResponse.ok) {
                console.warn('API test endpoint failed, may indicate server issues');
            } else {
                console.log('API test endpoint successful');
            }
        } catch (testError) {
            console.warn('API test endpoint error:', testError);
        }

        // Now try the actual endpoint
        const response = await fetch('/api/dashboard-analytics/invoice-status');

        // Check if response is ok
        if (!response.ok) {
            console.warn(`Invoice status API returned ${response.status}`);
            // Use default data
            updateInvoiceStatusUI([
                { status: 'Submitted', count: 9, percentage: 25 },
                { status: 'Pending', count: 5, percentage: 15 },
                { status: 'Valid', count: 6, percentage: 20 },
                { status: 'Invalid', count: 20, percentage: 30 },
                { status: 'Cancelled', count: 1, percentage: 10 }
            ]);
            return;
        }

        // Parse response
        const data = await response.json();

        // Check if data is valid
        if (!data || !Array.isArray(data) || data.length === 0) {
            console.warn('Invalid or empty data from invoice status API');
            // Use default data
            updateInvoiceStatusUI([
                { status: 'Submitted', count: 9, percentage: 25 },
                { status: 'Pending', count: 5, percentage: 15 },
                { status: 'Valid', count: 6, percentage: 20 },
                { status: 'Invalid', count: 20, percentage: 30 },
                { status: 'Cancelled', count: 1, percentage: 10 }
            ]);
            return;
        }

        // Update UI with data
        updateInvoiceStatusUI(data);

        // Add subtle animation to the card
        const card = document.getElementById('invoice-status-card');
        if (card) {
            card.classList.add('card-updated');
            setTimeout(() => {
                card.classList.remove('card-updated');
                if (button) button.style.animation = '';
            }, 1000);
        }
    } catch (error) {
        console.error('Error updating invoice status:', error);
        // Stop button animation
        const button = document.querySelector('.refresh-button .fa-sync-alt');
        if (button) button.style.animation = '';

        // Use default data
        updateInvoiceStatusUI([
            { status: 'Submitted', count: 9, percentage: 25 },
            { status: 'Pending', count: 5, percentage: 15 },
            { status: 'Valid', count: 6, percentage: 20 },
            { status: 'Invalid', count: 20, percentage: 30 },
            { status: 'Cancelled', count: 1, percentage: 10 }
        ]);
    }
}

// Helper function to update invoice status UI
function updateInvoiceStatusUI(data) {
    // Calculate total for percentage calculation
    const total = data.reduce((sum, status) => sum + (status.count || 0), 0);

    data.forEach(status => {
        const statusKey = status.status.toLowerCase();
        const count = status.count || 0;
        const percentage = status.percentage || (total > 0 ? Math.round((count / total) * 100) : 0);

        // Update progress bar
        const progressBar = document.querySelector(`.progress-bar[data-status="${statusKey}"]`);
        if (progressBar) {
            progressBar.style.width = `${percentage}%`;

            // Add animation class if percentage is significant
            if (percentage > 10) {
                progressBar.classList.add('progress-bar-animated');
            } else {
                progressBar.classList.remove('progress-bar-animated');
            }
        }

        // Update percentage/count text
        const percentageElement = document.querySelector(`.percentage[data-status="${statusKey}"]`);
        if (percentageElement) {
            percentageElement.textContent = `${count} document${count !== 1 ? 's' : ''}`;
        }
    });
}

// Function to update system status
async function updateSystemStatus() {
    showLoadingState('system-status');

    try {
        const response = await fetch('/api/dashboard-analytics/system-status');

        if (!response.ok) {
            console.warn(`System status API returned ${response.status}`);
            showNoDataState('system-status');
            return;
        }

        const data = await response.json();

        if (!data) {
            showNoDataState('system-status');
            return;
        }

        hideLoadingState('system-status');
        // Update API Status with more details
        const apiStatus = document.getElementById('apiStatus');
        const apiLastCheck = document.getElementById('apiLastCheck');
        const apiEndpointUrl = document.getElementById('apiEndpointUrl');

        if (data.apiHealthy) {
            apiStatus.className = 'badge bg-success';
            apiStatus.innerHTML = '<i class="fas fa-check-circle me-1"></i>Connected';
        } else {
            apiStatus.className = 'badge bg-danger';
            apiStatus.innerHTML = '<i class="fas fa-exclamation-circle me-1"></i>Connection Issues';
        }

        // Show environment info
        apiEndpointUrl.textContent = `Environment: ${data.environment || 'Production'}`;
        apiLastCheck.textContent = `Last checked: ${new Date().toLocaleTimeString()}`;

        // Update Queue Status with details
        const queueCount = document.getElementById('queueCount');
        const queueDetails = document.getElementById('queueDetails');
        const queueProgressBar = document.getElementById('queueProgressBar');
        const queueStatusIndicator = document.getElementById('queueStatusIndicator');
        const queueLastUpdate = document.getElementById('queueLastUpdate');

        queueCount.textContent = `${data.queueCount} Queue`;
        queueLastUpdate.textContent = 'Just now';

        if (data.queueCount > 0) {
            // Calculate progress (this is just an example - adjust based on your actual data)
            const maxQueueSize = 20; // Example max queue size
            const progress = Math.min(100, Math.round((data.queueCount / maxQueueSize) * 100));

            // Update progress bar
            queueProgressBar.style.width = `${progress}%`;
            queueProgressBar.setAttribute('aria-valuenow', progress);

            // Update status based on queue size
            if (data.queueCount > 10) {
                queueCount.className = 'badge bg-danger text-white';
                queueStatusIndicator.className = 'ms-2 badge bg-danger-subtle text-danger';
                queueStatusIndicator.textContent = 'High Load';
            } else {
                queueCount.className = 'badge bg-info text-white';
                queueStatusIndicator.className = 'ms-2 badge bg-info-subtle text-info';
                queueStatusIndicator.textContent = 'Processing';
            }

            queueDetails.innerHTML = `<span class="text-info">Processing ${data.queueCount} document${data.queueCount !== 1 ? 's' : ''}</span>`;
        } else {
            // Empty queue
            queueCount.className = 'badge bg-success text-white';
            queueProgressBar.style.width = '0%';
            queueProgressBar.setAttribute('aria-valuenow', 0);
            queueStatusIndicator.className = 'ms-2 badge bg-success-subtle text-success';
            queueStatusIndicator.textContent = 'Ready';
            queueDetails.textContent = 'Queue is empty';
        }

        // Update Last Sync with enhanced status
        const lastSync = document.getElementById('lastSync');
        const syncStatus = document.getElementById('syncStatus');
        const syncDetails = document.getElementById('syncDetails');

        if (data.lastSync) {
            const timeDiff = Math.round((Date.now() - new Date(data.lastSync).getTime()) / 60000);
            lastSync.textContent = `${timeDiff} mins ago`;

            if (timeDiff < 60) {
                syncStatus.className = 'fas fa-circle ms-2 recent';
                syncDetails.innerHTML = '<span class="text-success">Sync is up to date</span>';
            } else if (timeDiff < 240) {
                syncStatus.className = 'fas fa-circle ms-2 warning';
                syncDetails.innerHTML = '<span class="text-warning">Sync is slightly delayed</span>';
            } else {
                syncStatus.className = 'fas fa-circle ms-2 danger';
                syncDetails.innerHTML = '<span class="text-danger">Sync needs attention</span>';
            }
        } else {
            lastSync.textContent = 'No sync data';
            syncStatus.className = 'fas fa-circle ms-2 danger';
            syncDetails.innerHTML = '<span class="text-danger">No synchronization data available</span>';
        }

        // Update Online Users
        const onlineUsers = document.getElementById('onlineUsers');
        const onlineUsersStatus = document.getElementById('onlineUsersStatus');
        const onlineUsersDetails = document.getElementById('onlineUsersDetails');

        if (data.onlineUsers !== undefined) {
            onlineUsers.textContent = data.onlineUsers;

            if (data.onlineUsers > 0) {
                onlineUsersStatus.className = 'fas fa-circle ms-2 text-success';
                onlineUsersDetails.textContent = `${data.onlineUsers} user${data.onlineUsers !== 1 ? 's' : ''} currently registered`;
            } else {
                onlineUsersStatus.className = 'fas fa-circle ms-2 text-warning';
                onlineUsersDetails.textContent = 'No users currently registered';
            }
        }

        // Add subtle animation to the card
        const card = document.getElementById('system-status-card');
        card.classList.add('card-updated');
        setTimeout(() => {
            card.classList.remove('card-updated');
        }, 1000);
    } catch (error) {
        console.error('Error updating system status:', error);
        hideLoadingState('system-status');
    }
}


async function refreshQueue() {
    try {
        const button = document.querySelector('.status-item button .fa-sync-alt');
        button.style.animation = 'spin 1s linear';

        const response = await fetch('/api/dashboard-analytics/refresh-queue');
        const data = await response.json();

        // Update Queue Status with details
        const queueCount = document.getElementById('queueCount');
        const queueDetails = document.getElementById('queueDetails');
        const queueProgressBar = document.getElementById('queueProgressBar');
        const queueStatusIndicator = document.getElementById('queueStatusIndicator');
        const queueLastUpdate = document.getElementById('queueLastUpdate');

        // Update last updated time
        queueLastUpdate.textContent = 'Just now';

        if (data && data.queueCount !== undefined) {
            queueCount.textContent = `${data.queueCount} Queue`;

            if (data.queueCount > 0) {
                // Calculate progress (this is just an example - adjust based on your actual data)
                const maxQueueSize = 20; // Example max queue size
                const progress = Math.min(100, Math.round((data.queueCount / maxQueueSize) * 100));

                // Update progress bar
                queueProgressBar.style.width = `${progress}%`;
                queueProgressBar.setAttribute('aria-valuenow', progress);

                // Update status based on queue size
                if (data.queueCount > 10) {
                    queueCount.className = 'badge bg-danger text-white';
                    queueStatusIndicator.className = 'ms-2 badge bg-danger-subtle text-danger';
                    queueStatusIndicator.textContent = 'High Load';
                } else {
                    queueCount.className = 'badge bg-info text-white';
                    queueStatusIndicator.className = 'ms-2 badge bg-info-subtle text-info';
                    queueStatusIndicator.textContent = 'Processing';
                }

                queueDetails.innerHTML = `<span class="text-info">Processing ${data.queueCount} document${data.queueCount !== 1 ? 's' : ''}</span>`;
            } else {
                // Empty queue
                queueCount.className = 'badge bg-success text-white';
                queueProgressBar.style.width = '0%';
                queueProgressBar.setAttribute('aria-valuenow', 0);
                queueStatusIndicator.className = 'ms-2 badge bg-success-subtle text-success';
                queueStatusIndicator.textContent = 'Ready';
                queueDetails.textContent = 'Queue is empty';
            }

            // Add subtle animation to the queue item
            const queueItem = button.closest('.status-item');
            queueItem.classList.add('card-updated');
            setTimeout(() => {
                queueItem.classList.remove('card-updated');
                button.style.animation = '';
            }, 1000);
        }
    } catch (error) {
        console.error('Error refreshing queue:', error);
        const button = document.querySelector('.status-item button .fa-sync-alt');
        if (button) button.style.animation = '';
    }
}



function initializeTooltips() {
    // Use the centralized tooltip initialization from SettingsUtil
    SettingsUtil.initializeTooltips({
        // Add any dashboard-specific options here if needed
        template: '<div class="tooltip guide-tooltip" role="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner"></div></div>'
    });
}

async function updateOnlineUsers() {
    const onlineUsersElement = document.getElementById('onlineUsers');
    const onlineUsersStatus = document.getElementById('onlineUsersStatus');
    const onlineUsersDetails = document.getElementById('onlineUsersDetails');

    // Check if elements exist
    if (!onlineUsersElement || !onlineUsersStatus || !onlineUsersDetails) {
        console.warn('Online users elements not found in the DOM');
        return;
    }

    try {
        // First try the test endpoint to check if API is accessible
        try {
            const testResponse = await fetch('/api/dashboard-analytics/test');
            if (!testResponse.ok) {
                console.warn('API test endpoint failed, may indicate server issues');
            } else {
                console.log('API test endpoint successful');
            }
        } catch (testError) {
            console.warn('API test endpoint error:', testError);
        }

        // Now try the actual endpoint
        const response = await fetch('/api/dashboard-analytics/online-users');

        // Handle non-200 responses
        if (!response.ok) {
            console.warn(`Online users API returned ${response.status}`);
            onlineUsersElement.textContent = '1';  // Default to 1 for better UX
            onlineUsersStatus.className = 'fas fa-circle ms-2 text-warning';
            onlineUsersStatus.title = 'Using default data';
            onlineUsersDetails.textContent = 'Number of users currently registered';
            return;
        }

        // Parse response
        const data = await response.json();

        // Update UI with data
        if (data) {
            // Use total if available, otherwise fallback to count or default to 1
            onlineUsersElement.textContent = data.total || data.count || 1;

            // Update status indicator based on active users
            const activeUsers = data.active || (data.users ? data.users.length : 0);

            if (activeUsers > 0) {
                onlineUsersStatus.className = 'fas fa-circle ms-2 text-success';
                onlineUsersStatus.title = 'Users are currently registered';
            } else {
                onlineUsersStatus.className = 'fas fa-circle ms-2 text-secondary';
                onlineUsersStatus.title = 'No users currently registered';
            }

            // Update details text
            onlineUsersDetails.textContent = 'Number of users currently registered';
        } else {
            // Fallback for empty response
            onlineUsersElement.textContent = '1';
            onlineUsersStatus.className = 'fas fa-circle ms-2 text-warning';
            onlineUsersDetails.textContent = 'Number of users currently registered';
        }
    } catch (error) {
        // Handle any errors gracefully
        console.error('Error updating online users:', error);
        onlineUsersElement.textContent = '1';  // Default to 1 for better UX
        onlineUsersStatus.className = 'fas fa-circle ms-2 text-warning';
        onlineUsersStatus.title = 'Using default data';
        onlineUsersDetails.textContent = 'Number of users currently registered';
    }
}


// Initialize and set up auto-refresh
document.addEventListener('DOMContentLoaded', async function() {
    console.log('Dashboard initialization started');

    // Initialize loading states
    ['stats-cards', 'stackedBarChart', 'invoice-status', 'customer-list', 'system-status'].forEach(id => {
        showLoadingState(id);
    });

    // Initialize the chart
    initStackedBarChart();

    // Wait for authentication to be checked before loading data
    try {
        // Check if waitForAuth function is available (from load-utils.js)
        if (window.waitForAuth) {
            console.log('Waiting for authentication check to complete before loading dashboard data...');
            const isAuthenticated = await window.waitForAuth();
            console.log('Authentication check completed, authenticated:', isAuthenticated);
        } else {
            console.warn('waitForAuth function not available, proceeding without authentication check');
        }
    } catch (error) {
        console.error('Error waiting for authentication:', error);
    }

    // Fetch initial data
    console.log('Loading dashboard data...');
    Promise.all([
        updateDashboardStats(),
        updateAnalytics(),
        updateSystemStatus(),
        updateOnlineUsers()
    ]).then(() => {
        console.log('Dashboard data loaded successfully');
    }).catch(error => {
        console.error('Error initializing dashboard:', error);
    });

    // Set up refresh intervals
    setInterval(updateSystemStatus, 30000);
    setInterval(updateInvoiceStatus, 120000);
    setInterval(updateDashboardStats, 5 * 60 * 1000);
    setInterval(updateOnlineUsers, 30000);

    // Listen for authentication status changes
    window.addEventListener('lhdn-auth-status-changed', function(event) {
        console.log('Authentication status changed:', event.detail);
        if (event.detail.authenticated) {
            // Refresh data when authentication is successful
            Promise.all([
                updateDashboardStats(),
                updateAnalytics(),
                updateSystemStatus(),
                updateOnlineUsers()
            ]).catch(error => {
                console.error('Error refreshing dashboard after authentication:', error);
            });
        }
    });

    // Show help guide popup
    setTimeout(showHelpGuidePopup, 1000);
});

window.closeHelpGuide = closeHelpGuide;

// TIN Search Modal Functions
let tinSearchModal;

function showTinSearchModal() {
    // Reset form and results
    document.getElementById('tinSearchForm').reset();
    document.getElementById('searchResult').style.display = 'none';
    document.getElementById('searchError').style.display = 'none';
    document.getElementById('idValueExample').textContent = 'Example: 201901234567 (BRN)';

    // Show modal
    tinSearchModal.show();
}

async function searchTIN() {
    const searchResult = document.getElementById('searchResult');
    const searchError = document.getElementById('searchError');
    const errorMessage = document.getElementById('errorMessage');
    const tinResult = document.getElementById('tinResult');

    // Hide previous results
    searchResult.style.display = 'none';
    searchError.style.display = 'none';

    try {
        const taxpayerName = document.getElementById('taxpayerName').value.trim();
        const idType = document.getElementById('idType').value;
        const idValue = document.getElementById('idValue').value.trim();

        // Validate inputs according to LHDN rules
        if (!taxpayerName && (!idType || !idValue)) {
            throw new Error('Please provide either Company Name or both ID Type and ID Value');
        }

        if (idType && !idValue) {
            throw new Error('Please enter an ID value');
        }

        if (idValue && !idType) {
            throw new Error('Please select an ID type');
        }

        // Prepare query parameters
        const params = new URLSearchParams();
        if (taxpayerName) params.append('taxpayerName', taxpayerName);
        if (idType) params.append('idType', idType);
        if (idValue) params.append('idValue', idValue);

        // Show loading state
        const searchButton = document.querySelector('#tinSearchModal .btn-primary');
        const originalText = searchButton.innerHTML;
        searchButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Searching...';
        searchButton.disabled = true;

        // Make API call
        const response = await fetch(`/api/dashboard-analytics/search-tin?${params}`);
        const data = await response.json();

        // Reset button state
        searchButton.innerHTML = originalText;
        searchButton.disabled = false;

        if (data.success && data.tin) {
            tinResult.textContent = data.tin;
            searchResult.style.display = 'block';
        } else {
            throw new Error(data.message || 'No TIN found for the given criteria');
        }

    } catch (error) {
        console.error('TIN search error:', error);
        errorMessage.textContent = error.message || 'Failed to search TIN';
        searchError.style.display = 'block';

        // Reset button state if error occurs during API call
        const searchButton = document.querySelector('#tinSearchModal .btn-primary');
        if (searchButton.disabled) {
            searchButton.innerHTML = '<i class="fas fa-search me-2"></i>Search';
            searchButton.disabled = false;
        }
    }
}