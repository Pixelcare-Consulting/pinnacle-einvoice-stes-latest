// @ts-nocheck
// Toast Manager Class

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing managers...');
    try {
        // Initialize invoice table using singleton
        const invoiceManager = InvoiceTableManager.getInstance();

        // Initialize date/time display
        DateTimeManager.updateDateTime();

        console.log('Managers initialized successfully');
    } catch (error) {
        console.error('Error initializing managers:', error);
        Swal.fire({
            icon: 'error',
            title: 'Initialization Error',
            text: 'Failed to initialize the application. Please refresh the page.',
            confirmButtonText: 'Refresh',
            showCancelButton: true,
        }).then((result) => {
            if (result.isConfirmed) {
                window.location.reload();
            }
        });
    }
});


class ToastManager {
    static container = null;

    static init() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'toast-container position-fixed top-0 end-0 p-3';
            this.container.style.zIndex = '1070';
            document.body.appendChild(this.container);
        }
    }

    static show(message, type = 'success') {
        this.init();

        const toastElement = document.createElement('div');
        toastElement.className = `toast align-items-center border-0 ${type === 'success' ? 'bg-success' : 'bg-danger'} text-white`;
        toastElement.setAttribute('role', 'alert');
        toastElement.setAttribute('aria-live', 'assertive');
        toastElement.setAttribute('aria-atomic', 'true');
        toastElement.style.minWidth = '280px';

        const toastContent = `
            <div class="d-flex">
                <div class="toast-body">
                    <i class="bi ${type === 'success' ? 'bi-check-circle' : 'bi-x-circle'} me-2"></i>
                    ${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        `;
        toastElement.innerHTML = toastContent;

        this.container.appendChild(toastElement);

        const toast = new bootstrap.Toast(toastElement, {
            animation: true,
            autohide: true,
            delay: 3000
        });

        toast.show();

        // Remove the element after it's hidden
        toastElement.addEventListener('hidden.bs.toast', () => {
            toastElement.remove();
        });
    }
}

// DateTime Manager Class
class DateTimeManager {
    static updateDateTime() {
        const timeElement = document.getElementById('currentTime');
        const dateElement = document.getElementById('currentDate');

        function update() {
            const now = new Date();

            // Update time
            if (timeElement) {
                timeElement.textContent = now.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            }

            // Update date
            if (dateElement) {
                dateElement.textContent = now.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            }
        }

        // Update immediately and then every second
        update();
        setInterval(update, 1000);
    }
}

// Create a class for managing inbound invoices
class InvoiceTableManager {
    static instance = null;

    static getInstance() {
        if (!InvoiceTableManager.instance) {
            InvoiceTableManager.instance = new InvoiceTableManager();
        }
        return InvoiceTableManager.instance;
    }

    constructor() {
        if (InvoiceTableManager.instance) {
            return InvoiceTableManager.instance;
        }
        this.currentDataSource = 'archive'; // Start with archive data to avoid rate limiting
        this.table = null;
        this.initializeTable();
        this.initializeDataSourceToggle();
        InvoiceTableManager.instance = this;
    }

    initializeTable() {
        if ($.fn.DataTable.isDataTable('#invoiceTable')) {
            this.table.destroy();
        }
        const self = this;

        // Show loading indicator with more detailed message
        $('#invoiceTable').closest('.card').addClass('loading');
        $('#invoiceTable').closest('.card').append('<div class="loading-overlay"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div><div class="mt-2" id="loadingMessage">Initializing and checking authentication...</div><div class="small text-muted mt-1" id="loadingDetail"></div></div>');

        // Update loading message
        const updateLoadingMessage = (message, detail = '') => {
            $('#loadingMessage').text(message);
            if (detail) {
                $('#loadingDetail').text(detail);
            }
        };

        // Check authentication status first with timeout
        const checkAuth = async () => {
            try {
                updateLoadingMessage('Checking authentication status...');

                // Set a timeout for auth check to prevent hanging
                const authCheckPromise = window.waitForAuth ? window.waitForAuth() : Promise.resolve();
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Authentication check timed out')), 10000)
                );

                try {
                    await Promise.race([authCheckPromise, timeoutPromise]);
                    updateLoadingMessage('Authentication verified, loading data...', 'Connecting to server');
                } catch (authError) {
                    console.warn('Auth check issue, proceeding anyway:', authError);
                    updateLoadingMessage('Proceeding with data load...', 'Authentication status uncertain');
                }

                // Initialize the table with retry logic
                this.initializeTableWithRetry();
            } catch (error) {
                console.error('Error in authentication check:', error);
                updateLoadingMessage('Authentication check failed, attempting to load data anyway...');
                this.initializeTableWithRetry();
            }
        };

        // Call the authentication check
        checkAuth();
    }

    // Initialize data source toggle functionality
    initializeDataSourceToggle() {
        const self = this;

        // Handle data source toggle
        $('input[name="dataSource"]').on('change', function() {
            const selectedSource = $(this).attr('id');
            if (selectedSource === 'liveDataSource') {
                self.switchToLiveData();
            } else if (selectedSource === 'archiveDataSource') {
                self.switchToArchiveData();
            }
        });

        // Handle refresh button
        $('#refreshDataSource').on('click', function() {
            self.refreshCurrentDataSource();
        });
    }

    // Switch to live LHDN data
    async switchToLiveData() {
        try {
            this.currentDataSource = 'live';

            // Show loading state
            this.showLoadingBackdrop('Loading Live LHDN Data');

            // Update the table's AJAX URL to live endpoint
            if (this.table) {
                this.table.ajax.url('/api/lhdn/documents/recent').load(() => {
                    this.hideLoadingBackdrop();
                    this.updateCardTotals();
                });
            } else {
                // If table doesn't exist, initialize it
                await this.initializeTableWithData();
                this.hideLoadingBackdrop();
            }

        } catch (error) {
            console.error('Error switching to live data:', error);
            this.hideLoadingBackdrop();
            this.showErrorMessage('Failed to load live data: ' + error.message);
        }
    }

    // Switch to archive staging data
    async switchToArchiveData() {
        try {
            this.currentDataSource = 'archive';

            // Show loading state
            this.showLoadingBackdrop('Loading Archive Staging Data');

            // Fetch archive data from WP_INBOUND_STATUS table
            const response = await fetch('/api/lhdn/documents/archive-staging');
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to load archive staging data');
            }

            // Update table with archive data
            if (this.table) {
                this.table.clear().rows.add(data.result || []).draw();
            } else {
                // Initialize table with archive data
                this.initializeTableWithLocalData(data.result || []);
            }

            this.hideLoadingBackdrop();
            this.updateCardTotals();

        } catch (error) {
            console.error('Error switching to archive data:', error);
            this.hideLoadingBackdrop();
            this.showErrorMessage('Failed to load archive staging data: ' + error.message);
        }
    }

    // Refresh current data source
    async refreshCurrentDataSource() {
        if (this.currentDataSource === 'live') {
            // Force refresh live data
            window.forceRefreshLHDN = true;
            await this.switchToLiveData();
        } else {
            // Refresh archive data
            await this.switchToArchiveData();
        }
    }

    // New method with retry logic
    async initializeTableWithRetry(retryCount = 0) {
        const maxRetries = 3;
        const retryDelay = 3000; // 3 seconds

        try {
            // Update loading message
            $('#loadingMessage').text(`Loading invoice data... (Attempt ${retryCount + 1}/${maxRetries + 1})`);

            // Initialize the table
            await this.initializeTableWithData();
        } catch (error) {
            console.error(`Error initializing table (attempt ${retryCount + 1}):`, error);

            if (retryCount < maxRetries) {
                // Show retry message
                $('#loadingMessage').text(`Connection issue, retrying in ${retryDelay/1000} seconds...`);
                $('#loadingDetail').text(`Attempt ${retryCount + 1} of ${maxRetries + 1}`);

                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, retryDelay));

                // Retry with incremented count
                return this.initializeTableWithRetry(retryCount + 1);
            } else {
                // All retries failed, show neutral message and try to load from database only
                console.error('All retries failed, attempting database-only fallback');
                $('#loadingMessage').text('Loading invoice data from system...');

                try {
                    await this.loadFromDatabaseOnly();
                } catch (fallbackError) {
                    console.error('Database fallback also failed:', fallbackError);
                    // Show a more neutral message
                    Swal.fire({
                        icon: 'info',
                        title: 'Loading Invoice Data',
                        text: 'We\'re having trouble loading your invoice data. Would you like to try again?',
                        confirmButtonText: 'Retry',
                        showCancelButton: true,
                    }).then((result) => {
                        if (result.isConfirmed) {
                            // Remove loading overlay first
                            $('#invoiceTable').closest('.card').removeClass('loading');
                            $('#invoiceTable').closest('.card').find('.loading-overlay').remove();
                            // Retry from the beginning
                            this.initializeTable();
                        }
                    });
                }
            }
        }
    }

    // New method to load from database only as last resort
    async loadFromDatabaseOnly() {
        try {
            // Remove existing loading indicator
            $('#invoiceTable').closest('.card').removeClass('loading');
            $('#invoiceTable').closest('.card').find('.loading-overlay').remove();

            // Show loading indicator with neutral message
            $('#invoiceTable').closest('.card').addClass('loading');
            $('#invoiceTable').closest('.card').append('<div class="loading-overlay"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div><div class="mt-2">Loading invoice data...</div></div>');

            // Fetch data from database endpoint
            const response = await fetch('/api/lhdn/documents/recent?useDatabase=true&fallbackOnly=true');

            if (!response.ok) {
                throw new Error(`Database fetch failed with status: ${response.status}`);
            }

            const data = await response.json();

            if (!data || !data.result || data.result.length === 0) {
                throw new Error('No data available in database');
            }

            // Remove loading indicator
            $('#invoiceTable').closest('.card').removeClass('loading');
            $('#invoiceTable').closest('.card').find('.loading-overlay').remove();

            // Initialize table with the database data
            this.initializeTableWithLocalData(data.result);

            // Don't show any warning toast to users
            // Just log to console for debugging purposes
            console.log('Using data from local database. LHDN API connection may be unavailable.');

            return true;
        } catch (error) {
            console.error('Database-only load failed:', error);
            throw error;
        }
    }

    // Initialize table with local data
    initializeTableWithLocalData(localData) {
        // Similar to initializeTableWithData but uses provided data instead of AJAX
        const self = this;

        // Remove loading indicator
        $('#invoiceTable').closest('.card').removeClass('loading');
        $('#invoiceTable').closest('.card').find('.loading-overlay').remove();

        this.table = $('#invoiceTable').DataTable({
            // Same configuration as in initializeTableWithData but without AJAX
            processing: false,
            serverSide: false,
            data: localData, // Use local data instead of AJAX
            columns: [
                // Same columns configuration as in initializeTableWithData
                {
                    data: null,
                    orderable: false,
                    defaultContent: `
                        <div class="outbound-checkbox-header">
                            <input type="checkbox" class="outbound-checkbox row-checkbox">
                        </div>`
                },
                {
                    data: null,
                    orderable: false,
                    searchable: false,
                    className: 'text-center',
                    render: function (data, type, row, meta) {
                        // Calculate the correct index based on the current page and page length
                        const pageInfo = meta.settings._iDisplayStart;
                        const index = pageInfo + meta.row + 1;
                        return `<span class="row-index">${index}</span>`;
                    }
                },
                {
                    data: 'uuid',
                    render: function (data) {
                        return `
                            <div class="flex flex-col">
                                <div class="overflow-hidden text-ellipsis  flex items-center gap-2">
                                    <a href="#" class="inbound-badge-status copy-uuid"
                                       data-bs-toggle="tooltip"
                                       data-bs-placement="top"
                                       title="${data}"
                                       data-uuid="${data}"
                                         style="
                                            max-width: 100px;
                                            line-height: 1.2;
                                            display: inline-flex;
                                            align-items: center;
                                            gap: 6px;
                                            padding: 6px 10px;
                                            border-radius: 6px;
                                            font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                                            font-size: 0.813rem;
                                            background: rgba(13, 110, 253, 0.08);
                                            color: #0d6efd;
                                            border: 1px solid rgba(13, 110, 253, 0.1);
                                            transition: all 0.2s ease;
                                            cursor: pointer;
                                            white-space: nowrap;
                                            text-decoration: none;
                                            ">
                                        <i class="bi bi-fingerprint" style="font-size: 0.875rem;"></i>
                                        <span style="
                                            max-width: 80px;
                                            overflow: hidden;
                                            text-overflow: ellipsis;
                                            display: inline-block;
                                        ">${data}</span>
                                        <i class="bi bi-clipboard" style="
                                            font-size: 0.875rem;
                                            opacity: 0.6;
                                            margin-left: auto;
                                            transition: opacity 0.2s ease;
                                        "></i>
                                    </a>
                                </div>
                            </div>`;
                    }
                },
                {
                    data: 'longId',
                    render: function (data) {
                        return `
                            <div class="flex flex-col">
                                <div class="overflow-hidden text-ellipsis flex gap-2">
                                    <a href="#"
                                       class="inbound-badge-status copy-longId"
                                       data-bs-toggle="tooltip"
                                       data-bs-placement="top"
                                       title="${data || 'N/A'}"
                                       data-longId="${data || ''}"
                                       style="
                                            max-width: 100px;
                                            line-height: 1.2;
                                            display: inline-flex;
                                            align-items: center;
                                            gap: 6px;
                                            padding: 6px 10px;
                                            border-radius: 6px;
                                            font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                                            font-size: 0.813rem;
                                            background: rgba(25, 135, 84, 0.08);
                                            color: #198754;
                                            border: 1px solid rgba(25, 135, 84, 0.1);
                                            transition: all 0.2s ease;
                                            cursor: pointer;
                                            white-space: nowrap;
                                            text-decoration: none;
                                            ">
                                        <i class="bi bi-hash" style="font-size: 0.875rem;"></i>
                                        <span style="
                                            max-width: 160px;
                                            overflow: hidden;
                                            text-overflow: ellipsis;
                                            display: inline-block;
                                        ">${data || 'N/A'}</span>
                                        <i class="bi bi-clipboard" style="
                                            font-size: 0.875rem;
                                            opacity: 0.6;
                                            margin-left: auto;
                                            transition: opacity 0.2s ease;
                                        "></i>
                                    </a>
                                </div>
                            </div>`;
                    }
                },
                {
                    data: 'internalId',
                    title: 'INTERNAL ID',
                    className: 'text-nowrap',
                    render: (data, type, row) => this.renderInvoiceNumber(data, type, row)
                },
                {
                    data: null,
                    title: 'SUPPLIER',
                    render: (data, type, row) => {
                        // Use issuerName or supplierName for supplier info
                        const supplierName = row.issuerName || row.supplierName || 'Unknown';
                        return this.renderCompanyInfo(supplierName, type, row);
                    }
                },
                {
                    data: 'receiverName',
                    title: 'RECEIVER',
                    render: (data, type, row) => this.renderCompanyInfo(data, type, row)
                },
                {
                    data: null,
                    className: 'text-nowrap',
                    title: 'DATE INFO',
                    render: (data, type, row) => this.renderDateInfo(row.dateTimeValidated, row)
                },
                {
                    data: 'status',
                    title: 'STATUS',
                    render: function (data) {

                        const statusClass = data.toLowerCase();

                        const icons = {
                            valid: 'check-circle-fill',
                            invalid: 'x-circle-fill',
                            pending: 'hourglass-split',
                            submitted: 'hourglass-split',
                            queued: 'hourglass-split',
                            rejected: 'x-circle-fill',
                            cancelled: 'x-circle-fill'
                        };
                        const statusColors = {
                            valid: '#198754',
                            invalid: '#dc3545',
                            pending: '#ff8307',
                            submitted: 'gray',
                            queued: '#0d6efd',
                            rejected: '#dc3545',
                            cancelled: '#ffc107'
                        };
                        const icon = icons[statusClass] || 'question-circle';
                        const color = statusColors[statusClass];

                        if (statusClass === 'submitted' || statusClass === 'pending') {
                            return `<span class="inbound-status ${statusClass}"
                                  style="display: inline-flex; align-items: center; gap: 6px;
                                         padding: 6px 12px; border-radius: 6px;
                                         background: ${color}15; color: ${color};
                                         font-weight: 500; transition: all 0.2s ease;">
                                <i class="bi bi-${icon}"></i>Queued
                            </span>`;
                        }
                        return `
                            <span class="inbound-status ${statusClass}"
                                  style="display: inline-flex; align-items: center; gap: 6px;
                                         padding: 6px 12px; border-radius: 6px;
                                         background: ${color}15; color: ${color};
                                         font-weight: 500; transition: all 0.2s ease;">
                                <i class="bi bi-${icon}"></i>${data}
                            </span>`;
                    }
                },
                {
                    data: 'source',
                    title: 'SOURCE',
                    render: function (data) {
                        return this.renderSource(data);
                    }.bind(this)
                },
                {
                    data: 'totalSales',
                    title: 'TOTAL SALES',
                    render: data => {
                        if (!data) return '<span class="text-muted">N/A</span>';

                        return `
                            <div class="total-amount-wrapper" style="
                                display: flex;
                                align-items: center;
                                justify-content: flex-end;
                            ">
                                <span class="total-amount" style="
                                    font-weight: 500;
                                    color: #1e40af;
                                    font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                                    background: rgba(30, 64, 175, 0.1);
                                    padding: 4px 8px;
                                    border-radius: 4px;
                                    display: inline-block;
                                    letter-spacing: 0.5px;
                                    white-space: nowrap;
                                    transition: all 0.2s ease;
                                ">
                                    MYR ${parseFloat(data || 0).toLocaleString('en-MY', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2
                                    })}
                                </span>
                            </div>
                        `;
                    }
                },
                {
                    data: null,
                    orderable: false,
                    render: function (row) {
                        return `
                            <button class="outbound-action-btn submit"
                                    onclick="viewInvoiceDetails('${row.uuid}')"
                                    data-uuid="${row.uuid}">
                                <i class="bi bi-eye me-1"></i>View
                            </button>`;
                    }
                }
            ],
            scrollX: true,
            scrollCollapse: true,
            autoWidth: false,
            pageLength: 10,
            "order": [[ 6, 'desc' ]], // The 6 should be the index of your date column
            "columnDefs": [
                {
                    "targets": 6, // The DATE INFO column index
                    "type": "date"
                },
            ],
            dom: '<"outbound-controls"<"outbound-length-control"l>>rt<"outbound-bottom"<"outbound-info"i><"outbound-pagination"p>>',
            language: {
                //search: '',
                //searchPlaceholder: 'Search in records...',
                lengthMenu: '<i class="bi bi-list"></i> _MENU_',
                info: 'Showing _START_ to _END_ of _TOTAL_ entries',
                infoEmpty: 'No records available',
                infoFiltered: '(filtered from _MAX_ total records)',
                paginate: {
                    first: '<i class="bi bi-chevron-double-left"></i>',
                    previous: '<i class="bi bi-chevron-left"></i>',
                    next: '<i class="bi bi-chevron-right"></i>',
                    last: '<i class="bi bi-chevron-double-right"></i>'
                },
                select: {
                    rows: {
                        _: 'Selected %d rows',
                        0: 'Click a row to select it',
                        1: 'Selected 1 row'
                    }
                }
            },
            drawCallback: function(settings) {
                if (settings._iDisplayLength !== undefined) {
                    self.updateCardTotals();
                    updateCharts(); // Update charts when table is redrawn
                }

                // Update row indexes
                const table = $(this).DataTable();
                $(table.table().node()).find('tbody tr').each(function(index) {
                    const pageInfo = settings._iDisplayStart;
                    $(this).find('.row-index').text(pageInfo + index + 1);
                });
            },
            initComplete: function() {
                self.updateCardTotals();
                self.initializeFilters();
                updateCharts(); // Update charts when table is first initialized
            }
        });

        window.inboundDataTable = this.table;

        this.initializeTableStyles();
        this.initializeEventListeners();
        this.initializeSelectAll();
        this.addExportButton();
        this.initializeTooltipsAndCopy();

        // Add refresh button
        const refreshButton = $(`
            <button id="refreshLHDNData" class="outbound-action-btn submit btn-sm ms-2">
                <i class="bi bi-arrow-clockwise me-1"></i>Refresh LHDN Data
                <small class="text-muted ms-1 refresh-timer" style="display: none;"></small>
            </button>
        `);

        $('.dataTables_length').append(refreshButton);

        // Handle refresh button click
        $('#refreshLHDNData').on('click', async () => {
            try {
                const button = $('#refreshLHDNData');

                // For local data tables (archive), just refresh the current data source
                if (this.currentDataSource === 'archive') {
                    button.prop('disabled', true);
                    button.html('<i class="bi bi-arrow-clockwise me-1 spin"></i>Refreshing...');

                    await this.refreshCurrentDataSource();

                    button.prop('disabled', false);
                    button.html('<i class="bi bi-arrow-clockwise me-1"></i>Refresh LHDN Data');
                    ToastManager.show('Archive data refreshed successfully', 'success');
                    return;
                }

                // For live data, use the full refresh process
                const loadingModal = document.getElementById('loadingModal');
                const progressBar = document.querySelector('#loadingModal .progress-bar');
                const statusText = document.getElementById('loadingStatus');
                const detailsText = document.getElementById('loadingDetails');

                if (this.checkDataFreshness() && !window.forceRefreshLHDN) {
                    const result = await Swal.fire({
                        title: 'Data is up to date',
                        text: 'The data was updated less than 15 minutes ago. Do you still want to refresh?',
                        icon: 'info',
                        showCancelButton: true,
                        confirmButtonText: 'Yes, refresh anyway',
                        cancelButtonText: 'No, keep current data',
                        confirmButtonColor: '#1e40af',
                        cancelButtonColor: '#dc3545'
                    });

                    if (!result.isConfirmed) {
                        return;
                    }
                }

                button.prop('disabled', true);
                loadingModal.classList.add('show');
                loadingModal.style.display = 'block';
                document.body.classList.add('modal-open');

                const backdrop = document.createElement('div');
                backdrop.className = 'modal-backdrop fade show';
                document.body.appendChild(backdrop);

                progressBar.style.width = '10%';
                statusText.textContent = 'Connecting to LHDN server...';

                // Call the new refresh endpoint
                const response = await fetch('/api/lhdn/documents/refresh', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error?.message || 'Failed to refresh data');
                }

                progressBar.style.width = '50%';
                statusText.textContent = 'Refreshing data...';

                // Force a fresh fetch from the API
                window.forceRefreshLHDN = true;

                // Clear the cache timestamp to force a fresh fetch
                localStorage.removeItem('lastDataUpdate');

                // Reload the table data - this won't work for local data tables
                // So we need to refresh the current data source instead
                await this.refreshCurrentDataSource();

                progressBar.style.width = '100%';
                statusText.textContent = 'Success! Your data is now up to date.';

                setTimeout(() => {
                    loadingModal.classList.remove('show');
                    loadingModal.style.display = 'none';
                    document.body.classList.remove('modal-open');
                    backdrop.remove();
                    progressBar.style.width = '0%';
                    detailsText.textContent = '';
                    ToastManager.show('Successfully fetched fresh data from LHDN', 'success');
                    this.startRefreshTimer();
                }, 1000);

            } catch (error) {
                console.error('Error refreshing LHDN data:', error);
                ToastManager.show(error.message || 'Unable to fetch fresh data from LHDN. Please try again.', 'error');
            } finally {
                $('#refreshLHDNData').prop('disabled', false);
            }
        });

        this.startRefreshTimer();
    }

    initializeTableWithData() {
        const self = this;

        // Remove loading indicator
        $('#invoiceTable').closest('.card').removeClass('loading');
        $('#invoiceTable').closest('.card').find('.loading-overlay').remove();

        this.table = $('#invoiceTable').DataTable({
            processing: false,
            serverSide: false,
            ajax: {
                url: '/api/lhdn/documents/archive-staging', // Use staging data by default to avoid rate limiting
                method: 'GET',
                data: function (d) {
                    // Check if we should use cached data on page load
                    const lastUpdate = localStorage.getItem('lastDataUpdate');
                    const cachedData = localStorage.getItem('inboundTableData');
                    const cacheValidTime = 15 * 60 * 1000; // 15 minutes

                    if (lastUpdate && cachedData && !window.forceRefreshLHDN) {
                        const now = new Date().getTime();
                        const lastUpdateTime = parseInt(lastUpdate);

                        // If cache is still valid and this is not a forced refresh
                        if ((now - lastUpdateTime) < cacheValidTime) {
                            d.useCache = true;
                            console.log('Using cached data for table load');
                        }
                    }

                    // Always include forceRefresh parameter
                    d.forceRefresh = window.forceRefreshLHDN || false;
                    // Add useDatabase parameter to ensure we get data even if API fails
                    d.useDatabase = true;
                    return d;
                },
                dataSrc: function(json) {
                    let result = [];

                    // Check if we should use cached data
                    if (json && json.useCache) {
                        const cachedData = localStorage.getItem('inboundTableData');
                        if (cachedData) {
                            try {
                                result = JSON.parse(cachedData);
                                console.log("Using cached inbound data:", result.length, "records");
                            } catch (e) {
                                console.warn("Failed to parse cached data, fetching fresh data");
                                result = json && json.result ? json.result : [];
                            }
                        } else {
                            result = json && json.result ? json.result : [];
                        }
                    } else {
                        result = json && json.result ? json.result : [];

                        // Save fresh data to cache
                        if (result && result.length > 0) {
                            try {
                                localStorage.setItem('inboundTableData', JSON.stringify(result));
                                localStorage.setItem('lastDataUpdate', new Date().getTime());
                                console.log("Cached fresh inbound data:", result.length, "records");
                            } catch (e) {
                                console.warn("Failed to cache data:", e);
                            }
                        }
                    }

                    console.log("Current Inbound Results: ", result);
                    // Reset the force refresh flag
                    window.forceRefreshLHDN = false;

                    // Update totals and charts after data load
                    setTimeout(() => {
                        self.updateCardTotals();
                        updateCharts();
                    }, 100);

                    return result;
                },
                error: function(xhr, error, thrown) {
                    console.error('Ajax error:', error, thrown);

                    // Check for specific error types
                    let errorMessage = 'Error fetching data from server.';
                    let errorType = 'error';
                    let errorDuration = 5000;

                    // Handle different error types
                    if (xhr.status === 401 || xhr.status === 403) {
                        errorMessage = 'Authentication error. Please refresh the page to log in again.';
                        // Show a more detailed error modal for auth issues
                        Swal.fire({
                            icon: 'warning',
                            title: 'Session Expired',
                            text: 'Your session has expired or you are not authenticated. Please refresh the page to log in again.',
                            confirmButtonText: 'Refresh Page',
                            showCancelButton: true,
                        }).then((result) => {
                            if (result.isConfirmed) {
                                window.location.reload();
                            }
                        });
                    } else if (xhr.status === 404) {
                        errorMessage = 'Data endpoint not found. Please contact support.';
                    } else if (xhr.status === 429) {
                        errorMessage = 'Too many requests. Please wait a moment and try again.';
                    } else if (xhr.status === 0) {
                        errorMessage = 'Network connection issue. Please check your internet connection.';
                    } else if (xhr.status >= 500) {
                        errorMessage = 'Server error. The system is currently unavailable.';
                    }

                    // Don't show error toast to users, just log to console
                    console.log(errorMessage + ' Attempting to load from local database...');

                    // Update loading message with neutral text
                    $('#loadingMessage').text('Loading invoice data...');
                    $('#loadingDetail').text('Please wait while we retrieve your data');

                    // Try to load data from database as fallback with improved error handling
                    fetch('/api/lhdn/documents/recent?useDatabase=true&fallbackOnly=true')
                        .then(response => {
                            if (!response.ok) {
                                throw new Error(`Database fetch failed with status: ${response.status}`);
                            }
                            return response.json();
                        })
                        .then(data => {
                            if (data && data.result && data.result.length > 0) {
                                // Manually update the table with database data
                                self.table.clear().rows.add(data.result).draw();
                                // Don't show warning toast to users
                                console.log('Using data from local database. LHDN API connection may be unavailable.');

                                // Update card totals and charts with the new data
                                setTimeout(() => {
                                    self.updateCardTotals();
                                    updateCharts();
                                }, 100);
                            } else {
                                throw new Error('No data available in database');
                            }
                        })
                        .catch(fallbackError => {
                            console.error('Error fetching fallback data:', fallbackError);

                            // Try to use cached data as last resort
                            const cachedData = localStorage.getItem('inboundTableData');
                            if (cachedData) {
                                try {
                                    const parsedData = JSON.parse(cachedData);
                                    if (parsedData && parsedData.length > 0) {
                                        self.table.clear().rows.add(parsedData).draw();
                                        console.log('Using cached data as fallback:', parsedData.length, 'records');

                                        // Update card totals and charts
                                        setTimeout(() => {
                                            self.updateCardTotals();
                                            updateCharts();
                                        }, 100);

                                        // Show info message about using cached data
                                        ToastManager.show('Using cached data. Some information may not be up to date.', 'info');
                                        return;
                                    }
                                } catch (e) {
                                    console.warn('Failed to parse cached data:', e);
                                }
                            }

                            // Don't show error toast to users
                            console.error('Could not load any data. Please try again later or refresh the page.');

                            // Show a more user-friendly error message
                            $('#invoiceTable').closest('.card').find('.dataTables_empty').html(`
                                <div class="alert alert-info">
                                    <i class="bi bi-info-circle-fill me-2"></i>
                                    <strong>No invoice data available.</strong>
                                    <p class="mb-0 mt-2">We couldn't retrieve your invoice data at this time.</p>
                                    <button class="btn btn-sm btn-outline-primary mt-2" onclick="window.location.reload()">
                                        <i class="bi bi-arrow-clockwise me-1"></i>Refresh Page
                                    </button>
                                </div>
                            `);
                        });
                }
            },
            columns: [
                {
                    data: null,
                    orderable: false,
                    defaultContent: `
                        <div class="outbound-checkbox-header">
                            <input type="checkbox" class="outbound-checkbox row-checkbox">
                        </div>`
                },
                {
                    data: null,
                    orderable: false,
                    searchable: false,
                    className: 'text-center',
                    render: function (data, type, row, meta) {
                        // Calculate the correct index based on the current page and page length
                        const pageInfo = meta.settings._iDisplayStart;
                        const index = pageInfo + meta.row + 1;
                        return `<span class="row-index">${index}</span>`;
                    }
                },
                {
                    data: 'uuid',
                    render: function (data) {
                        return `
                            <div class="flex flex-col">
                                <div class="overflow-hidden text-ellipsis  flex items-center gap-2">
                                    <a href="#" class="inbound-badge-status copy-uuid"
                                       data-bs-toggle="tooltip"
                                       data-bs-placement="top"
                                       title="${data}"
                                       data-uuid="${data}"
                                         style="
                                            max-width: 100px;
                                            line-height: 1.2;
                                            display: inline-flex;
                                            align-items: center;
                                            gap: 6px;
                                            padding: 6px 10px;
                                            border-radius: 6px;
                                            font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                                            font-size: 0.813rem;
                                            background: rgba(13, 110, 253, 0.08);
                                            color: #0d6efd;
                                            border: 1px solid rgba(13, 110, 253, 0.1);
                                            transition: all 0.2s ease;
                                            cursor: pointer;
                                            white-space: nowrap;
                                            text-decoration: none;
                                            ">
                                        <i class="bi bi-fingerprint" style="font-size: 0.875rem;"></i>
                                        <span style="
                                            max-width: 80px;
                                            overflow: hidden;
                                            text-overflow: ellipsis;
                                            display: inline-block;
                                        ">${data}</span>
                                        <i class="bi bi-clipboard" style="
                                            font-size: 0.875rem;
                                            opacity: 0.6;
                                            margin-left: auto;
                                            transition: opacity 0.2s ease;
                                        "></i>
                                    </a>
                                </div>
                            </div>`;
                    }
                },
                {
                    data: 'longId',
                    render: function (data) {
                        return `
                            <div class="flex flex-col">
                                <div class="overflow-hidden text-ellipsis flex gap-2">
                                    <a href="#"
                                       class="inbound-badge-status copy-longId"
                                       data-bs-toggle="tooltip"
                                       data-bs-placement="top"
                                       title="${data || 'N/A'}"
                                       data-longId="${data || ''}"
                                       style="
                                            max-width: 100px;
                                            line-height: 1.2;
                                            display: inline-flex;
                                            align-items: center;
                                            gap: 6px;
                                            padding: 6px 10px;
                                            border-radius: 6px;
                                            font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                                            font-size: 0.813rem;
                                            background: rgba(25, 135, 84, 0.08);
                                            color: #198754;
                                            border: 1px solid rgba(25, 135, 84, 0.1);
                                            transition: all 0.2s ease;
                                            cursor: pointer;
                                            white-space: nowrap;
                                            text-decoration: none;
                                            ">
                                        <i class="bi bi-hash" style="font-size: 0.875rem;"></i>
                                        <span style="
                                            max-width: 160px;
                                            overflow: hidden;
                                            text-overflow: ellipsis;
                                            display: inline-block;
                                        ">${data || 'N/A'}</span>
                                        <i class="bi bi-clipboard" style="
                                            font-size: 0.875rem;
                                            opacity: 0.6;
                                            margin-left: auto;
                                            transition: opacity 0.2s ease;
                                        "></i>
                                    </a>
                                </div>
                            </div>`;
                    }
                },
                {
                    data: 'internalId',
                    title: 'INTERNAL ID',
                    className: 'text-nowrap',
                    render: (data, type, row) => this.renderInvoiceNumber(data, type, row)
                },
                {
                    data: null,
                    title: 'SUPPLIER',
                    render: (data, type, row) => {
                        // Use issuerName or supplierName for supplier info
                        const supplierName = row.issuerName || row.supplierName || 'Unknown';
                        return this.renderCompanyInfo(supplierName, type, row);
                    }
                },
                {
                    data: 'receiverName',
                    title: 'RECEIVER',
                    render: (data, type, row) => this.renderCompanyInfo(data, type, row)
                },
                {
                    data: null,
                    className: 'text-nowrap',
                    title: 'DATE INFO',
                    render: (data, type, row) => this.renderDateInfo(row.dateTimeValidated, row)
                },
                {
                    data: 'status',
                    title: 'STATUS',
                    render: function (data) {

                        const statusClass = data.toLowerCase();

                        const icons = {
                            valid: 'check-circle-fill',
                            invalid: 'x-circle-fill',
                            pending: 'hourglass-split',
                            submitted: 'hourglass-split',
                            queued: 'hourglass-split',
                            rejected: 'x-circle-fill',
                            cancelled: 'x-circle-fill'
                        };
                        const statusColors = {
                            valid: '#198754',
                            invalid: '#dc3545',
                            pending: '#ff8307',
                            submitted: 'gray',
                            queued: '#0d6efd',
                            rejected: '#dc3545',
                            cancelled: '#ffc107'
                        };
                        const icon = icons[statusClass] || 'question-circle';
                        const color = statusColors[statusClass];

                        if (statusClass === 'submitted' || statusClass === 'pending') {
                            return `<span class="inbound-status ${statusClass}"
                                  style="display: inline-flex; align-items: center; gap: 6px;
                                         padding: 6px 12px; border-radius: 6px;
                                         background: ${color}15; color: ${color};
                                         font-weight: 500; transition: all 0.2s ease;">
                                <i class="bi bi-${icon}"></i>Queued
                            </span>`;
                        }
                        return `
                            <span class="inbound-status ${statusClass}"
                                  style="display: inline-flex; align-items: center; gap: 6px;
                                         padding: 6px 12px; border-radius: 6px;
                                         background: ${color}15; color: ${color};
                                         font-weight: 500; transition: all 0.2s ease;">
                                <i class="bi bi-${icon}"></i>${data}
                            </span>`;
                    }
                },
                {
                    data: 'source',
                    title: 'SOURCE',
                    render: function (data) {
                        return this.renderSource(data);
                    }.bind(this)
                },
                {
                    data: 'totalSales',
                    title: 'TOTAL SALES',
                    render: data => {
                        if (!data) return '<span class="text-muted">N/A</span>';

                        return `
                            <div class="total-amount-wrapper" style="
                                display: flex;
                                align-items: center;
                                justify-content: flex-end;
                            ">
                                <span class="total-amount" style="
                                    font-weight: 500;
                                    color: #1e40af;
                                    font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                                    background: rgba(30, 64, 175, 0.1);
                                    padding: 4px 8px;
                                    border-radius: 4px;
                                    display: inline-block;
                                    letter-spacing: 0.5px;
                                    white-space: nowrap;
                                    transition: all 0.2s ease;
                                ">
                                    MYR ${parseFloat(data || 0).toLocaleString('en-MY', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2
                                    })}
                                </span>
                            </div>
                        `;
                    }
                },
                {
                    data: null,
                    orderable: false,
                    render: function (row) {
                        return `
                            <button class="outbound-action-btn submit"
                                    onclick="viewInvoiceDetails('${row.uuid}')"
                                    data-uuid="${row.uuid}">
                                <i class="bi bi-eye me-1"></i>View
                            </button>`;
                    }
                }
            ],
            scrollX: true,
            scrollCollapse: true,
            autoWidth: false,
            pageLength: 10,
            "order": [[ 6, 'desc' ]], // The 6 should be the index of your date column
            "columnDefs": [
                {
                    "targets": 6, // The DATE INFO column index
                    "type": "date"
                },
            ],
            dom: '<"outbound-controls"<"outbound-length-control"l>>rt<"outbound-bottom"<"outbound-info"i><"outbound-pagination"p>>',
            language: {
                //search: '',
                //searchPlaceholder: 'Search in records...',
                lengthMenu: '<i class="bi bi-list"></i> _MENU_',
                info: 'Showing _START_ to _END_ of _TOTAL_ entries',
                infoEmpty: 'No records available',
                infoFiltered: '(filtered from _MAX_ total records)',
                paginate: {
                    first: '<i class="bi bi-chevron-double-left"></i>',
                    previous: '<i class="bi bi-chevron-left"></i>',
                    next: '<i class="bi bi-chevron-right"></i>',
                    last: '<i class="bi bi-chevron-double-right"></i>'
                },
                select: {
                    rows: {
                        _: 'Selected %d rows',
                        0: 'Click a row to select it',
                        1: 'Selected 1 row'
                    }
                }
            },
            drawCallback: function(settings) {
                if (settings._iDisplayLength !== undefined) {
                    self.updateCardTotals();
                    updateCharts(); // Update charts when table is redrawn
                }

                // Update row indexes
                const table = $(this).DataTable();
                $(table.table().node()).find('tbody tr').each(function(index) {
                    const pageInfo = settings._iDisplayStart;
                    $(this).find('.row-index').text(pageInfo + index + 1);
                });
            },
            initComplete: function() {
                self.updateCardTotals();
                self.initializeFilters();
                updateCharts(); // Update charts when table is first initialized
            }
        });

        window.inboundDataTable = this.table;

        this.initializeTableStyles();
        this.initializeEventListeners();
        this.initializeSelectAll();
        this.addExportButton();
        this.initializeTooltipsAndCopy();

        // Add refresh button
        const refreshButton = $(`
            <button id="refreshLHDNData" class="outbound-action-btn submit btn-sm ms-2">
                <i class="bi bi-arrow-clockwise me-1"></i>Refresh LHDN Data
                <small class="text-muted ms-1 refresh-timer" style="display: none;"></small>
            </button>
        `);

        $('.dataTables_length').append(refreshButton);

        // Handle refresh button click
        $('#refreshLHDNData').on('click', async () => {
            try {
                const button = $('#refreshLHDNData');
                const loadingModal = document.getElementById('loadingModal');
                const progressBar = document.querySelector('#loadingModal .progress-bar');
                const statusText = document.getElementById('loadingStatus');
                const detailsText = document.getElementById('loadingDetails');

                if (this.checkDataFreshness() && !window.forceRefreshLHDN) {
                    const result = await Swal.fire({
                        title: 'Data is up to date',
                        text: 'The data was updated less than 15 minutes ago. Do you still want to refresh?',
                        icon: 'info',
                        showCancelButton: true,
                        confirmButtonText: 'Yes, refresh anyway',
                        cancelButtonText: 'No, keep current data',
                        confirmButtonColor: '#1e40af',
                        cancelButtonColor: '#dc3545'
                    });

                    if (!result.isConfirmed) {
                        return;
                    }
                }

                button.prop('disabled', true);
                loadingModal.classList.add('show');
                loadingModal.style.display = 'block';
                document.body.classList.add('modal-open');

                const backdrop = document.createElement('div');
                backdrop.className = 'modal-backdrop fade show';
                document.body.appendChild(backdrop);

                progressBar.style.width = '10%';
                statusText.textContent = 'Connecting to LHDN server...';

                // Call the new refresh endpoint
                const response = await fetch('/api/lhdn/documents/refresh', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error?.message || 'Failed to refresh data');
                }

                progressBar.style.width = '50%';
                statusText.textContent = 'Refreshing data...';

                // Force a fresh fetch from the API
                window.forceRefreshLHDN = true;

                // Clear the cache timestamp to force a fresh fetch
                localStorage.removeItem('lastDataUpdate');

                // Reload the table data - check if table has AJAX capability
                if (this.table.ajax && this.table.ajax.reload) {
                    await this.table.ajax.reload(null, false);
                } else {
                    // For local data tables, refresh the current data source
                    await this.refreshCurrentDataSource();
                }

                progressBar.style.width = '100%';
                statusText.textContent = 'Success! Your data is now up to date.';

                setTimeout(() => {
                    loadingModal.classList.remove('show');
                    loadingModal.style.display = 'none';
                    document.body.classList.remove('modal-open');
                    backdrop.remove();
                    progressBar.style.width = '0%';
                    detailsText.textContent = '';
                    ToastManager.show('Successfully fetched fresh data from LHDN', 'success');
                    this.startRefreshTimer();
                }, 1000);

            } catch (error) {
                console.error('Error refreshing LHDN data:', error);
                ToastManager.show(error.message || 'Unable to fetch fresh data from LHDN. Please try again.', 'error');
            } finally {
                $('#refreshLHDNData').prop('disabled', false);
            }
        });

        this.startRefreshTimer();
    }

    initializeFilters() {
        const self = this;

        // Global search
        $('#globalSearch').on('input', function() {
            self.table.search(this.value).draw();
        });

        // Status filter buttons
        $('.quick-filters .btn[data-filter]').on('click', function() {
            $('.quick-filters .btn').removeClass('active');
            $(this).addClass('active');

            const filter = $(this).data('filter');
            const statusColumn = self.table.column(8); // Status column

            if (filter === 'all') {
                statusColumn.search('').draw();
            } else {
                // Convert filter value to match the actual status text
                let searchValue = filter.charAt(0).toUpperCase() + filter.slice(1).toLowerCase();

                // Special handling for 'queue' status
                if (filter === 'queue') {
                    searchValue = 'Queued|Submitted|Pending';
                }

                statusColumn.search(searchValue, true, false, true).draw();
            }
        });

        // Date range filter
        $('#tableStartDate, #tableEndDate').on('change', function() {
            const startDate = $('#tableStartDate').val();
            const endDate = $('#tableEndDate').val();

            // Validate date range
            if (startDate && endDate) {
                const start = new Date(startDate);
                const end = new Date(endDate);
                if (start > end) {
                    ToastManager.show('Start date cannot be later than end date', 'error');
                    return;
                }
            }

            self.applyFilters();
        });

        // Amount range filter
        $('#minAmount, #maxAmount').on('input', debounce(function() {
            self.applyFilters();
        }, 300));

        // Company filter
        $('#companyFilter').on('input', debounce(function() {
            self.applyFilters();
        }, 300));

        // Document type filter
        $('#documentTypeFilter').on('change', function() {
            self.applyFilters();
        });

        // Source filter
        $('#sourceFilter').on('change', function() {
            self.applyFilters();
        });

        // Clear all filters
        $(document).on('click', '#clearFilters, #clearAllFilters', function() {
            // Reset all inputs
            $('#tableStartDate, #tableEndDate, #minAmount, #maxAmount, #companyFilter').val('');
            $('#documentTypeFilter, #sourceFilter').val('');

            // Reset quick filters
            $('.quick-filters .btn[data-filter="all"]').addClass('active').siblings().removeClass('active');

            // Clear DataTable filters
            self.table.search('').columns().search('');

            // Clear global search
            $('#globalSearch').val('');

            // Reset and redraw table
            self.applyFilters();

            // Show success message
            ToastManager.show('All filters have been cleared', 'success');
        });

        // Remove individual filter
        $(document).on('click', '.filter-tag .btn-close', function() {
            const filterText = $(this).siblings('.filter-text').text();
            const filterType = filterText.split(':')[0].trim().toLowerCase();

            // Clear the corresponding filter input
            switch(filterType) {
                case 'date':
                    $('#tableStartDate, #tableEndDate').val('');
                    break;
                case 'amount':
                    $('#minAmount, #maxAmount').val('');
                    break;
                case 'company':
                    $('#companyFilter').val('');
                    break;
                case 'type':
                    $('#documentTypeFilter').val('');
                    break;
                case 'source':
                    $('#sourceFilter').val('');
                    break;
            }

            // Reapply filters
            self.applyFilters();

            // Show success message
            ToastManager.show('Filter removed', 'success');
        });

        // Helper function for debouncing
        function debounce(func, wait) {
            let timeout;
            return function(...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), wait);
            };
        }
    }

    initializeTableStyles() {
        $('.dataTables_filter input').addClass('form-control form-control-sm');
        $('.dataTables_length select').addClass('form-select form-select-sm');
    }

    initializeEventListeners() {
        $('#invoiceTable').on('click', '.view-details', async (e) => {
            const uuid = $(e.currentTarget).data('uuid');
            await viewInvoiceDetails(uuid);
        });
    }


    renderSource(data) {
        if (!data) return this.createSourceBadge('LHDN');
        return this.createSourceBadge(data);
    }


    renderDateInfo(validatedDate, row) {
        console.log(validatedDate);
        const validatedFormatted = validatedDate ? this.formatDate(validatedDate) : null;

        return `
            <div class="date-info" style="position: relative;">
                ${validatedFormatted ? `
                    <div class="date-row validated"
                         data-bs-toggle="tooltip"
                         data-bs-placement="top"
                         title="LHDN validation completed on ${validatedFormatted}"
                         style="position: relative; padding-left: 28px;">
                        <i class="bi bi-shield-check text-success"
                           style="position: absolute; left: 0; top: 3px; font-size: 1.1rem;"></i>
                        <div class="date-content">
                            <div class="d-flex align-items-center gap-2">
                                <span class="date-value text-dark fw-medium">
                                    ${validatedFormatted}
                                </span>
                                <span class="badge bg-success bg-opacity-10 text-success py-1 px-2"
                                      style="font-size: 0.55rem; border: 1px solid rgba(25, 135, 84, 0.15);">
                                    Validated
                                </span>
                            </div>
                            <div class="date-label text-muted" style="font-size: 0.65rem;">
                                LHDN Validation Date
                            </div>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderInvoiceNumber(data, type, row) {
        if (!data) return '<span class="text-muted">N/A</span>';

        // Get document type icon based on type
        const getDocTypeIcon = (docType) => {
            const icons = {
                'Invoice': 'receipt',
                'Credit Note': 'arrow-return-left',
                'Debit Note': 'arrow-return-right',
                'Refund Note': 'cash-stack',
                'Self-billed Invoice': 'receipt',
                'Self-billed Credit Note': 'arrow-return-left',
                'Self-billed Debit Note': 'arrow-return-right',
                'Self-billed Refund Note': 'cash-stack'
            };
            return icons[docType] || 'file-text';
        };

        // Get document type color based on type
        const getDocTypeColor = (docType) => {
            const colors = {
                'Invoice': '#0d6efd',
                'Credit Note': '#198754',
                'Debit Note': '#dc3545',
                'Refund Note': '#6f42c1',
                'Self-billed Invoice': '#0d6efd',
                'Self-billed Credit Note': '#198754',
                'Self-billed Debit Note': '#dc3545',
                'Self-billed Refund Note': '#6f42c1'
            };
            return colors[docType] || '#6c757d';
        };
        const docType = row.typeName;
        // + ' ' + row.typeVersionName || 'NA'
        const docTypeIcon = getDocTypeIcon(docType);
        const docTypeColor = getDocTypeColor(docType);

        return `
            <div class="invoice-info-wrapper" style="display: flex; flex-direction: column; gap: 8px; text-align: left;">
                <div class="invoice-main" style="display: flex; align-items: center; gap: 12px;">

                </div>
                <div class="invoice-number" style="
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-weight: 500;
                    color: #2c3345;
                    padding-left: 0;
                ">
                    <i class="bi bi-hash text-primary"></i>
                    <span class="invoice-text" title="${data}" style="
                        max-width: 180px;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    ">${data}</span>
                </div>
              <div class="document-type" style="padding-left: 0;">
                        <span class="badge-document-type" style="
                            display: inline-flex;
                            align-items: center;
                            gap: 4px;
                            padding: 4px 8px;
                            border-radius: 4px;
                            font-size: 0.75rem;
                            font-weight: 500;
                            background-color: ${docTypeColor}15;
                            color: ${docTypeColor};
                        ">
                            <i class="bi bi-${docTypeIcon}"></i>
                            ${docType  + ' ' + row.typeVersionName}
                        </span>
                    </div>
            </div>`;
    }


    renderTotalAmount(data) {
        if (!data) return '<span class="text-muted">N/A</span>';

        return `
            <div class="total-amount-wrapper" style="
                display: flex;
                align-items: center;
                justify-content: flex-end;
            ">
                <span class="total-amount" style="
                    font-weight: 500;
                    color: #1e40af;
                    font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                    background: rgba(30, 64, 175, 0.1);
                    padding: 4px 8px;
                    border-radius: 4px;
                    display: inline-block;
                    letter-spacing: 0.5px;
                    white-space: nowrap;
                    transition: all 0.2s ease;
                ">
                    ${data}
                </span>
            </div>
        `;
    }
    renderCompanyInfo(data) {
        if (!data) return `
        <div class="cell-group">
            <div class="cell-main">
                <i class="bi bi-building me-1"></i>
                <span class="supplier-text">N/A</span>
            </div>
            <div class="cell-sub">
                <i class="bi bi-card-text me-1"></i>
                <span class="reg-text">Company Name</span>
            </div>
        </div>`;
        return `
            <div class="cell-group">
                <div class="cell-main">
                    <i class="bi bi-building me-1"></i>
                    <span class="supplier-text">${data}</span>
                </div>
                <div class="cell-sub">
                    <i class="bi bi-card-text me-1"></i>
                    <span class="reg-text">Company Name</span>
                </div>
            </div>`;
    }

    // Helper methods
    formatDate(date) {
        if (!date) return 'N/A';
        const d = new Date(date);
        return d.toLocaleString('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    }

    formatCurrency(amount) {
        return new Intl.NumberFormat('en-MY', {
            style: 'currency',
            currency: 'MYR'
        }).format(amount || 0);
    }


    createStatusBadge(status, reason) {
        const statusClasses = {
            'Valid': 'bg-success',
            'Invalid': 'bg-danger',
            'Pending': 'bg-warning',
            'Rejected': 'bg-danger',
            'Cancelled': 'bg-secondary',
            'Queued': 'bg-info'
        };
        const className = statusClasses[status] || 'bg-secondary';
        const reasonHtml = reason ? `<br><small class="text-muted">${reason}</small>` : '';
        return `<span class="badge ${className}">${status || 'Unknown'}</span>${reasonHtml}`;
    }

    createSourceBadge(source) {
        let badgeClass = 'bg-info';
        let iconClass = 'bi-building';
        let tooltipText = 'Document from external system';
        let customStyle = '';

        switch(source) {
            case 'PixelCare':
                badgeClass = 'bg-primary';
                iconClass = 'bi-pc-display';
                tooltipText = 'Document managed through PixelCare system';
                break;
            case 'Pixel Pinnacle':
                badgeClass = 'bg-success';
                iconClass = 'bi-file-earmark-spreadsheet';
                tooltipText = 'Document created through Pixel Pinnacle portal';
                break;
            case 'LHDN':
                badgeClass = ''; // Remove the default bg class
                iconClass = 'bi-cloud-download';
                tooltipText = 'Document imported/submitted directly from LHDN ';
                customStyle = 'background-color: #1e40af; color: #ffffff;';
                break;
            default:
                badgeClass = 'bg-info';
                iconClass = 'bi-building';
        }

        return `<span class="badge ${badgeClass}"
            data-bs-toggle="tooltip"
            data-bs-placement="top"
            title="${tooltipText}"
            style="
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 0.85rem;
                font-weight: 500;
                white-space: nowrap;
                cursor: help;
                ${customStyle}
            ">
            <i class="bi ${iconClass}"></i>
            ${source || 'Unknown'}
        </span>`;
    }

    initializeSelectAll() {
        // Handle "Select All" checkbox
        $('#selectAll').on('change', (e) => {
            const isChecked = $(e.target).prop('checked');
            $('.row-checkbox').prop('checked', isChecked);
            this.updateExportButton();
        });

        // Handle individual checkbox changes
        $('#invoiceTable').on('change', '.row-checkbox', () => {
            const totalCheckboxes = $('.row-checkbox').length;
            const checkedCheckboxes = $('.row-checkbox:checked').length;
            $('#selectAll').prop('checked', totalCheckboxes === checkedCheckboxes);
            this.updateExportButton();
        });
    }

    addExportButton() {
        // Add export button after the table length control
        const exportBtn = $(`
            <button id="exportSelected" class="outbound-action-btn submit btn-sm ms-2" disabled>
                <i class="bi bi-download me-1"></i>Export Selected
                <span class="selected-count ms-1">(0)</span>
            </button>
        `);

        $('.dataTables_length').append(exportBtn);

        // Handle export button click
        $('#exportSelected').on('click', () => this.exportSelectedRecords());
    }

    updateExportButton() {
        const selectedCount = $('.row-checkbox:checked').length;
        const exportBtn = $('#exportSelected');

        if (selectedCount > 0) {
            exportBtn.prop('disabled', false);
            exportBtn.find('.selected-count').text(`(${selectedCount})`);
        } else {
            exportBtn.prop('disabled', true);
            exportBtn.find('.selected-count').text('(0)');
        }
    }

    async exportSelectedRecords() {
        try {
            const selectedRows = [];
            $('.row-checkbox:checked').each((_, checkbox) => {
                const rowData = this.table.row($(checkbox).closest('tr')).data();
                selectedRows.push(rowData);
            });

            if (selectedRows.length === 0) {
                ToastManager.show('Please select at least one record to export', 'error');
                return;
            }

            // Show loading state
            const exportBtn = $('#exportSelected');
            const originalHtml = exportBtn.html();
            exportBtn.prop('disabled', true);
            exportBtn.html('<i class="bi bi-arrow-repeat spin me-1"></i>Exporting...');

            // Prepare export data
            const exportData = selectedRows.map(row => ({
                UUID: row.uuid,
                LONGID: row.longId,
                'Internal ID': row.internalId,
                Type: row.typeName,
                Supplier: row.supplierName,
                Receiver: row.receiverName,
                'Issue Date': new Date(row.dateTimeIssued).toLocaleString(),
                'Received Date': new Date(row.dateTimeReceived).toLocaleString(),
                'Validated Date': new Date(row.dateTimeValidated).toLocaleString(),
                Status: row.status,
                'Total Sales': `RM ${parseFloat(row.totalSales).toFixed(2)}`
            }));

            // Convert to CSV
            const csvContent = this.convertToCSV(exportData);

            // Create and trigger download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `inbound_invoices_${new Date().toISOString().split('T')[0]}.csv`;
            link.click();
            document.body.removeChild(link);

            // Reset button state
            exportBtn.prop('disabled', false);
            exportBtn.html(originalHtml);

            // Show success message
            ToastManager.show(`Successfully exported ${selectedRows.length} records`, 'success');

        } catch (error) {
            console.error('Export error:', error);
            ToastManager.show('Failed to export selected records', 'error');
        }
    }

    convertToCSV(data) {
        if (data.length === 0) return '';

        const headers = Object.keys(data[0]);
        const rows = [
            headers.join(','), // Header row
            ...data.map(row =>
                headers.map(header =>
                    JSON.stringify(row[header] || '')
                ).join(',')
            )
        ];

        return rows.join('\n');
    }

    updateCardTotals() {
        // Check if table is initialized
        if (!this.table || !$.fn.DataTable.isDataTable('#invoiceTable')) {
            return;
        }

        try {
            const data = this.table.rows().data();
            const totals = {
                invoices: 0,
                valid: 0,
                invalid: 0,
                rejected: 0,
                cancelled: 0,
                submitted: 0
            };

            // Count totals
            if (data && data.length) {
                data.each(row => {
                    totals.invoices++;
                    switch (row.status) {
                        case 'Valid':
                            totals.valid++;
                            break;
                        case 'Invalid':
                            totals.invalid++;
                            break;
                        case 'Rejected':
                            totals.rejected++;
                            break;
                        case 'Cancelled':
                            totals.cancelled++;
                            break;
                        case 'Submitted':
                            totals.submitted++;
                            break;
                    }
                });
            }

            // Update card values and hide spinners
            $('.total-invoice-value')
                .text(totals.invoices)
                .show()
                .closest('.info-card')
                .find('.card-icon')
                .append(`<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-primary">${totals.invoices}</span>`);

            $('.total-valid-value')
                .text(totals.valid)
                .show()
                .closest('.info-card')
                .find('.card-icon')
                .append(`<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-success">${totals.valid}</span>`);

            $('.total-invalid-value')
                .text(totals.invalid)
                .show()
                .closest('.info-card')
                .find('.card-icon')
                .append(`<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">${totals.invalid}</span>`);

            $('.total-rejected-value')
                .text(totals.rejected)
                .show()
                .closest('.info-card')
                .find('.card-icon')
                .append(`<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">${totals.rejected}</span>`);

            $('.total-cancel-value')
                .text(totals.cancelled)
                .show()
                .closest('.info-card')
                .find('.card-icon')
                .append(`<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-warning">${totals.cancelled}</span>`);

            $('.total-queue-value')
                .text(totals.submitted)
                .show()
                .closest('.info-card')
                .find('.card-icon')
                .append(`<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-info">${totals.submitted}</span>`);

            // Hide all spinners
            $('.loading-spinner').hide();

            // Remove any existing badges before adding new ones
            $('.card-icon .badge').remove();

        } catch (error) {
            console.error('Error updating card totals:', error);
            // Don't hide spinners if there was an error
        }
    }

    initializeTooltipsAndCopy() {
        const copyToClipboard = async (text, element) => {
            try {
                if (!text || text === 'N/A') {
                    throw new Error('No valid text to copy');
                }

                // Create temporary textarea
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();

                // Try to copy using document.execCommand first (more compatible)
                let success = false;
                try {
                    success = document.execCommand('copy');
                } catch (err) {
                    success = false;
                }

                // If execCommand fails, try clipboard API
                if (!success && navigator.clipboard) {
                    await navigator.clipboard.writeText(text);
                    success = true;
                }

                // Clean up textarea
                document.body.removeChild(textarea);

                if (!success) {
                    throw new Error('Copy operation failed');
                }

                // Visual feedback
                const clipboardIcon = element.querySelector('.bi-clipboard');
                if (clipboardIcon) {
                    clipboardIcon.classList.remove('bi-clipboard');
                    clipboardIcon.classList.add('bi-check2');
                    clipboardIcon.style.color = '#198754';
                    clipboardIcon.style.opacity = '1';
                }

                // Update tooltip
                const tooltip = bootstrap.Tooltip.getInstance(element);
                if (tooltip) {
                    tooltip.dispose();
                }
                element.setAttribute('data-bs-original-title', 'Copied!');
                new bootstrap.Tooltip(element, { trigger: 'manual' }).show();

                // Reset after 1.5 seconds
                setTimeout(() => {
                    if (clipboardIcon) {
                        clipboardIcon.classList.remove('bi-check2');
                        clipboardIcon.classList.add('bi-clipboard');
                        clipboardIcon.style.color = '';
                        clipboardIcon.style.opacity = '0.6';
                    }

                    const currentTooltip = bootstrap.Tooltip.getInstance(element);
                    if (currentTooltip) {
                        currentTooltip.dispose();
                    }
                    element.setAttribute('data-bs-original-title', 'Click to copy');
                    new bootstrap.Tooltip(element);
                }, 1500);

                // Show success toast with specific message based on what was copied
                const itemType = element.classList.contains('copy-uuid') ? 'UUID' : 'Long ID';
                ToastManager.show(`${itemType} copied to clipboard!`, 'success');
            } catch (err) {
                console.error('Failed to copy:', err);
                const itemType = element.classList.contains('copy-uuid') ? 'UUID' : 'Long ID';
                ToastManager.show(`Failed to copy ${itemType}`, 'error');
            }
        };

        // Initialize tooltips
        const initTooltips = () => {
            $('[data-bs-toggle="tooltip"]').tooltip('dispose').tooltip();
        };

        // Initialize tooltips on load
        initTooltips();

        // Reinitialize tooltips after table draw
        this.table.on('draw', initTooltips);

        // Handle UUID copy
        $(document).on('click', '.copy-uuid', function(e) {
            e.preventDefault();
            const uuid = $(this).data('uuid');
            copyToClipboard(uuid, this);
        });

        // Handle longId copy
        $(document).on('click', '.copy-longId', function(e) {
            e.preventDefault();
            const longId = $(this).data('longid');
            copyToClipboard(longId, this);
        });
    }

    // Add new function to check data freshness
    checkDataFreshness() {
        const lastUpdate = localStorage.getItem('lastDataUpdate');
        if (!lastUpdate) return false;

        const currentTime = new Date().getTime();
        const lastUpdateTime = parseInt(lastUpdate);
        const fifteenMinutes = 15 * 60 * 1000;

        return (currentTime - lastUpdateTime) < fifteenMinutes;
    }

    // Add refresh timer functionality
    startRefreshTimer() {
        const timerElement = $('.refresh-timer');
        const updateTimer = () => {
            const lastUpdate = localStorage.getItem('lastDataUpdate');
            if (!lastUpdate) {
                timerElement.hide();
                return;
            }

            const now = new Date().getTime();
            const timeSinceUpdate = now - parseInt(lastUpdate);
            const minutesAgo = Math.floor(timeSinceUpdate / 60000);

            if (minutesAgo < 15) {
                timerElement.show().text(`(${15 - minutesAgo}m until next refresh)`);
            } else {
                timerElement.hide();
            }
        };

        // Update timer immediately and every minute
        updateTimer();
        this.refreshTimerInterval = setInterval(updateTimer, 60000);
    }



    getUniqueColumnValues(columnName, columnIndex, dataType = 'text') {
        const table = this.table;

        // For HTML columns, we need to get both the rendered data and the raw data
        let processedData = [];

        // Use DataTables API to get column data
        if (dataType === 'html') {
            // Get the rendered data (HTML) from the column
            const columnData = table.column(columnIndex).nodes().to$();

            // Extract text content from HTML
            columnData.each(function() {
                let text = '';

                // For source column
                if (columnName === 'source') {
                    // Extract the source name from the badge
                    const sourceBadge = $(this).find('.source-badge');
                    if (sourceBadge.length) {
                        text = sourceBadge.text().trim();
                    } else {
                        // Fallback to any text in the cell
                        text = $(this).text().trim();
                    }
                }
                // For status column
                else if (columnName === 'status') {
                    const statusBadge = $(this).find('.inbound-status');
                    if (statusBadge.length) {
                        // Extract only the status text, not the icon
                        const iconElement = statusBadge.find('i');
                        if (iconElement.length) {
                            iconElement.remove(); // Temporarily remove icon to get clean text
                            text = statusBadge.text().trim();
                            statusBadge.prepend(iconElement); // Restore icon
                        } else {
                            text = statusBadge.text().trim();
                        }
                    } else {
                        // Fallback to any text in the cell
                        text = $(this).text().trim();
                    }
                }
                // For other HTML columns
                else {
                    text = $(this).text().trim();
                }

                if (text) {
                    processedData.push(text);
                }
            });
        } else {
            // For text columns, use the standard DataTables API
            processedData = table.column(columnIndex).data()
                .toArray()
                .map(item => {
                    if (typeof item === 'string') {
                        return item.trim();
                    } else if (item && typeof item === 'object' && item[columnName] !== undefined) {
                        return item[columnName].toString().trim();
                    }
                    return (item || '').toString().trim();
                })
                .filter(Boolean); // Remove empty values
        }

        // Get unique values
        const uniqueValues = [...new Set(processedData)];
        return uniqueValues.sort();
    }

    applyFilters() {
        const self = this;
        const table = this.table;

        // Remove any existing custom filter
        $.fn.dataTable.ext.search = $.fn.dataTable.ext.search.filter(fn => fn.name !== 'customInboundFilter');

        // Track active filters
        const activeFilters = [];

        // Date Range Filter
        const startDate = $('#tableStartDate').val();
        const endDate = $('#tableEndDate').val();

        if (startDate || endDate) {
            if (startDate && endDate) {
                activeFilters.push(`Date: ${startDate} to ${endDate}`);
            } else if (startDate) {
                activeFilters.push(`Date: From ${startDate}`);
            } else if (endDate) {
                activeFilters.push(`Date: Until ${endDate}`);
            }
        }

        // Amount Range Filter
        const minAmount = parseFloat($('#minAmount').val()) || 0;
        const maxAmount = parseFloat($('#maxAmount').val()) || Infinity;
        if (minAmount > 0 || maxAmount < Infinity) {
            if (minAmount > 0 && maxAmount < Infinity) {
                activeFilters.push(`Amount: MYR ${minAmount.toFixed(2)} - MYR ${maxAmount.toFixed(2)}`);
            } else if (minAmount > 0) {
                activeFilters.push(`Amount: Min MYR ${minAmount.toFixed(2)}`);
            } else if (maxAmount < Infinity) {
                activeFilters.push(`Amount: Max MYR ${maxAmount.toFixed(2)}`);
            }
        }

        // Company Filter
        const companyFilter = $('#companyFilter').val();
        if (companyFilter) {
            activeFilters.push(`Company: ${companyFilter}`);
        }

        // Document Type Filter
        const typeFilter = $('#documentTypeFilter').val();
        if (typeFilter) {
            activeFilters.push(`Type: ${typeFilter}`);
        }

        // Source Filter
        const sourceFilter = $('#sourceFilter').val();
        if (sourceFilter) {
            activeFilters.push(`Source: ${sourceFilter}`);
        }

        // Update active filters display
        this.updateActiveFilterTags(activeFilters);

        // Add custom filtering function
        $.fn.dataTable.ext.search.push(
            function customInboundFilter(settings, searchData, index, rowData) {
                let showRow = true;

                // Date Range Filter
                if (startDate || endDate) {
                    const dateCell = searchData[7]; // DATE INFO column
                    const dateMatch = dateCell.match(/Date Received:\s*([^,\n]+)/);
                    if (dateMatch) {
                        const dateStr = dateMatch[1].trim();
                        const [datePart, timePart] = dateStr.split(',').map(s => s.trim());
                        const [month, day, year] = datePart.split(' ');
                        const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(month);

                        if (monthIndex !== -1) {
                            const rowDate = new Date(year, monthIndex, parseInt(day));
                            rowDate.setHours(0, 0, 0, 0); // Set to start of day for comparison

                            if (startDate) {
                                const startDateTime = new Date(startDate);
                                startDateTime.setHours(0, 0, 0, 0);
                                if (rowDate < startDateTime) showRow = false;
                            }

                            if (endDate) {
                                const endDateTime = new Date(endDate);
                                endDateTime.setHours(23, 59, 59, 999);
                                if (rowDate > endDateTime) showRow = false;
                            }
                        }
                    }
                }

                // Amount Range Filter
                const amountStr = searchData[10].replace(/[^\d.-]/g, ''); // TOTAL AMOUNT column
                const amount = parseFloat(amountStr) || 0;
                if (amount < minAmount || amount > maxAmount) showRow = false;

                // Company Filter
                if (companyFilter) {
                    const supplierName = searchData[5].toLowerCase(); // SUPPLIER column
                    const receiverName = searchData[6].toLowerCase(); // RECEIVER column
                    if (!supplierName.includes(companyFilter.toLowerCase()) &&
                        !receiverName.includes(companyFilter.toLowerCase())) {
                        showRow = false;
                    }
                }

                // Document Type Filter
                if (typeFilter) {
                    const docTypeCell = $(table.cell(index, 4).node()).find('.badge-document-type').text().trim();
                    if (!docTypeCell.includes(typeFilter)) showRow = false;
                }

                // Source Filter
                if (sourceFilter) {
                    const source = searchData[8].trim(); // SOURCE column
                    if (!source.includes(sourceFilter)) showRow = false;
                }

                return showRow;
            }
        );

        // Apply filters
        table.draw();
    }

    updateActiveFilterTags(activeFilters) {
        const container = $('#activeFilterTags');
        container.empty();

        if (activeFilters.length === 0) {
            container.html('<span class="text-muted">No active filters</span>');
            return;
        }

        activeFilters.forEach(filter => {
            const tag = $(`
                <div class="filter-tag">
                    <span class="filter-text">${filter}</span>
                    <button type="button" class="btn-close btn-close-white btn-sm" aria-label="Remove filter"></button>
                </div>
            `);
            container.append(tag);
        });

        // Add clear all button if there are filters
        if (activeFilters.length > 0) {
            const clearAllBtn = $(`
                <button type="button" class="btn btn-link btn-sm text-danger" id="clearAllFilters">
                    <i class="bi bi-x-circle me-1"></i>Clear all filters
                </button>
            `);
            container.append(clearAllBtn);
        }
    }

    resetFilters() {
        // Reset all dropdown filters
        $('.filter-select').val('');

        // Reset date filters
        $('#start-date-filter').val('');
        $('#end-date-filter').val('');

        // Redraw the table with no filters
        this.table.draw();
    }


    refresh() {
        if (this.table) {
            // Check if table has AJAX configuration (live data) or uses local data (archive)
            if (this.table.ajax && this.table.ajax.reload) {
                // AJAX-based table (live data)
                this.table.ajax.reload(() => {
                    this.updateCardTotals();
                    updateCharts(); // Update charts after refresh
                }, false);
            } else {
                // Local data table (archive data) - refresh by calling the appropriate method
                this.refreshCurrentDataSource();
            }
        }
    }

    cleanup() {
        if (this.table) {
            this.table.destroy();
            this.table = null;
        }
    }

    // Check if data is fresh (within 15 minutes)
    checkDataFreshness() {
        const lastUpdate = localStorage.getItem('lastDataUpdate');
        if (!lastUpdate) return false;

        const now = new Date().getTime();
        const lastUpdateTime = parseInt(lastUpdate);
        const fifteenMinutes = 15 * 60 * 1000; // 15 minutes in milliseconds

        return (now - lastUpdateTime) < fifteenMinutes;
    }

    // Start refresh timer display
    startRefreshTimer() {
        const timerElement = $('.refresh-timer');
        if (!timerElement.length) return;

        const updateTimer = () => {
            const lastUpdate = localStorage.getItem('lastDataUpdate');
            if (!lastUpdate) {
                timerElement.hide();
                return;
            }

            const now = new Date().getTime();
            const lastUpdateTime = parseInt(lastUpdate);
            const minutesAgo = Math.floor((now - lastUpdateTime) / (1000 * 60));

            if (minutesAgo < 60) {
                timerElement.text(`(${minutesAgo}m ago)`).show();
            } else {
                const hoursAgo = Math.floor(minutesAgo / 60);
                timerElement.text(`(${hoursAgo}h ago)`).show();
            }
        };

        // Update immediately and then every minute
        updateTimer();
        setInterval(updateTimer, 60000);
    }

}


async function viewInvoiceDetails(uuid) {
    try {
        // Get the table row data first
        const table = $('#invoiceTable').DataTable();
        const rowData = table.rows().data().toArray().find(row => row.uuid === uuid);

        console.log('Table Row Data:', rowData);

        // Show loading state
        $('#modalLoadingOverlay').removeClass('d-none');

        // Fetch document details
        const response = await fetch(`/api/lhdn/documents/${uuid}/display-details`);
        const result = await response.json();

        console.log('API Response:', result);

        if (!response.ok) {
            throw new Error(result.message || `Failed to fetch document details (Status: ${response.status})`);
        }

        if (!result.success) {
            throw new Error(result.message || 'Failed to fetch invoice details');
        }

        // Parse document data if it exists
        if (result.documentInfo?.document) {
            try {
                const documentData = JSON.parse(result.documentInfo.document);
                console.log('Parsed Document Data:', documentData);
                result.documentInfo.parsedDocument = documentData;
            } catch (parseError) {
                console.warn('Failed to parse document data:', parseError);
            }
        }

        const documentInfo = result.documentInfo;
        console.log('Document Info:', documentInfo);

        // Check document status first
        if (documentInfo.status === 'Invalid') {
            // Close any existing modals
            const existingModal = bootstrap.Modal.getInstance(document.getElementById('documentDetailsModal'));
            if (existingModal) {
                existingModal.hide();
            }

            // Show validation results modal
            await openValidationResultsModal(uuid);
            return;
        }

        if (documentInfo.status === 'Submitted') {
            Swal.fire({
                icon: 'warning',
                title: 'Document Pending',
                text: 'This document is still being processed. Please wait for validation to complete.',
                confirmButtonColor: '#ffc107'
            });
            return;
        }

        // Get the document details modal element
        const modalElement = document.getElementById('documentDetailsModal');
        if (!modalElement) {
            throw new Error('Document details modal element not found');
        }

        // Create and show document details modal
        const modal = new bootstrap.Modal(modalElement);

        // Only proceed to show modal if document is Valid or Cancelled
        if (['Valid', 'Cancelled'].includes(documentInfo.status)) {
            await populateViewDetailsModal(modalElement, rowData, result);

            // Show modal
            modal.show();

            // Only load PDF for valid documents
            await loadPDF(uuid, result);
        } else {
            // For any other status
            Swal.fire({
                icon: 'info',
                title: 'Document Unavailable',
                text: `Document cannot be viewed when status is ${documentInfo.status}.`,
                confirmButtonColor: '#0dcaf0'
            });
        }

    } catch (error) {
        console.error('Error showing document details:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to show document details'
        });
    } finally {
        // Hide loading state
        $('#modalLoadingOverlay').addClass('d-none');
    }
}

// Function to populate the view details modal
async function populateViewDetailsModal(modalElement, rowData, result) {
    const documentInfo = result.documentInfo;
    // Update modal header content
    const modalTitle = modalElement.querySelector('.modal-title');
    const modalInvoiceNumber = modalElement.querySelector('#modal-invoice-number');
    const statusBadge = modalElement.querySelector('.badge-status');

    modalTitle.innerHTML = '<i class="bi bi-file-text me-2"></i>Document Details';
    modalInvoiceNumber.textContent = `#${documentInfo.internalId}`;
    statusBadge.className = `badge-status ${documentInfo.status} me-3`;
    statusBadge.textContent = documentInfo.status;

    // Prepare supplier info using rowData and supplierInfo
    const supplierInfo = {
        company: rowData.issuerName || rowData.supplierName || documentInfo.supplierName,
        tin: documentInfo.supplierTIN || rowData.issuerTIN || rowData.supplierTIN || documentInfo.supplierTin,
        registrationNo: rowData.issuerID || documentInfo.supplierRegistrationNo || 'N/A',
        taxRegNo: documentInfo.supplierSstNo || rowData.issuerTaxRegNo || 'N/A',
        msicCode: documentInfo.supplierMsicCode || rowData.issuerMsicCode || 'N/A',
        address: documentInfo.supplierAddress || rowData.issuerAddress || 'N/A'
    };

    // Prepare buyer info using rowData and documentInfo
    const customerInfo = {
        company: rowData.receiverName || rowData.buyerName || rowData.customerName,
        tin: documentInfo.receiverTIN || rowData.receiverTIN || rowData.buyerTIN || rowData.receivedTin,
        registrationNo: documentInfo.receiverRegistrationNo || rowData.receiverId || documentInfo.receiverRegistrationNo || 'N/A',
        taxRegNo: documentInfo.receiverSstNo || rowData.receiverTaxRegNo || rowData.receiverId || 'N/A',
        address: documentInfo.receiverAddress || rowData.receiverAddress || 'N/A'
    };


    // Prepare payment info using rowData and result
    const paymentInfo = {
        totalIncludingTax: result.paymentInfo?.totalIncludingTax || 0,
        totalExcludingTax: result.paymentInfo?.totalExcludingTax || 0,
        taxAmount: result.paymentInfo?.taxAmount || 0,
        irbmUniqueNo: documentInfo.uuid,
        irbmlongId: documentInfo.longId || documentInfo.irbmlongId,
        irbmURL: 'https://myinvois.hasil.gov.my/'+documentInfo.uuid+'/share/'+documentInfo.longId,
        uuid: documentInfo.uuid,
        longId: documentInfo.longId
    };

    // Update info sections content
    const supplierContentDiv = modalElement.querySelector('#supplier-info-content');
    const buyerContentDiv = modalElement.querySelector('#buyer-info-content');
    const paymentContentDiv = modalElement.querySelector('#payment-info-content');

    supplierContentDiv.innerHTML = createSupplierContent(supplierInfo);
    buyerContentDiv.innerHTML = createBuyerContent(customerInfo);
    paymentContentDiv.innerHTML = createPaymentContent(paymentInfo);
}


// Helper functions to create content sections
function createSupplierContent(supplierInfo) {
    return `
        <div class="info-content">
            <div class="info-row">
                <div class="label">COMPANY NAME</div>
                <div class="value">${supplierInfo?.company || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">TAX ID</div>
                <div class="value">${supplierInfo?.tin || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">REGISTRATION NO.</div>
                <div class="value">${supplierInfo?.registrationNo || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">SST REGISTRATION</div>
                <div class="value">${supplierInfo?.taxRegNo || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">MSIC CODE</div>
                <div class="value">${supplierInfo?.msicCode || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">ADDRESS</div>
                <div class="value text-wrap">${supplierInfo?.address || 'N/A'}</div>
            </div>
        </div>
    `;
}

function createBuyerContent(customerInfo) {
    return `
        <div class="info-content">
            <div class="info-row">
                <div class="label">COMPANY NAME</div>
                <div class="value">${customerInfo?.company || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">TAX ID</div>
                <div class="value">${customerInfo?.tin || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">REGISTRATION NO.</div>
                <div class="value">${customerInfo?.registrationNo || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">SST REGISTRATION</div>
                <div class="value">${customerInfo?.taxRegNo || 'N/A'}</div>
            </div>
            <div class="info-row">
                <div class="label">ADDRESS</div>
                <div class="value text-wrap small">${customerInfo?.address || 'N/A'}</div>
            </div>
        </div>
    `;
}

function createPaymentContent(paymentInfo) {
    const totalAmount = parseFloat(paymentInfo?.totalIncludingTax || 0);
    const subtotal = parseFloat(paymentInfo?.totalExcludingTax || 0);
    const taxAmount = parseFloat(paymentInfo?.taxAmount || 0);
    const uuid = paymentInfo?.uuid || 'N/A';

    return `
        <style>


            .info-row {
                display: block; /* Maintain stacked layout */
                margin-bottom: 1rem;
                align-items: flex-start;
            }
            .info-row.highlight-row {
                background-color: #f1f5f9;
                padding: 0.8rem;
                border-radius: 4px;
                border-left: 4px solid #007bff;
            }
            .label {
                font-weight: 300;
                color: #6c757d;
                text-align: left;
                margin-bottom: 0.5rem;
            }
            .copy-icon {
                opacity: 0.6;
                transition: opacity 0.2s ease;
                margin-top: 2px;
            }
            .badge:hover .copy-icon {
                opacity: 1;
            }
            .value {
                font-size: 1rem;
                font-weight: 300;
                color: #212529;
                text-align: left; /* Changed to left-align for stacked layout */
                word-break: break-word;
            }
            .value span {
                font-size: 0.9rem;
                font-weight: 400;
            }

            .card {
                border: none;
                border-radius: 8px;
            }
            .supplier-card, .buyer-card {
                background-color: #ffffff;
            }
            .payment-card {
                background-color: #f8f9fa;
            }
            .copy-animation {
                animation: copyPulse 0.3s ease-in-out;
            }
            @keyframes copyPulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.05); }
                100% { transform: scale(1); }
            }
            .badge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 8px 12px;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s ease;
                background-color: #f8f9fa;
                border: 1px solid #dee2e6;
                color: #212529;
                line-height: 1.2;
                max-width: 100%;
                overflow-wrap: break-word;
                white-space: normal;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
                user-select: none;
            }
            .badge:hover {
                background-color: #e9ecef;
            }
            .badge:active {
                transform: scale(0.98);
            }
            .copy-icon {
                opacity: 0.6;
                transition: all 0.2s ease;
                display: inline-flex;
                align-items: center;
            }
            .badge:hover .copy-icon {
                opacity: 1;
            }
        </style>
        <div class="info-content">
            <div class="info-row highlight-row">
                <div class="label">TOTAL AMOUNT</div>
                <div class="value">${formatCurrency(totalAmount)}</div>
            </div>
            <div class="info-row">
                <div class="label">SUBTOTAL</div>
                <div class="value">${formatCurrency(subtotal)}</div>
            </div>
            <div class="info-row">
                <div class="label">TAX AMOUNT</div>
                <div class="value">${formatCurrency(taxAmount)}</div>
            </div>
            <div class="info-row highlight-row">
                <div class="label">IRBM UNIQUE IDENTIFIER NO</div>
                <div class="value text-align-left">
                    <span
                        id="${uuid}"
                        class="badge bg-light text-dark border"
                        data-bs-toggle="tooltip"
                        data-bs-placement="top"
                        title="Click to copy"
                        onclick="copyToClipboard('${uuid}', '${uuid}') disabled"
                        style="cursor: pointer;"
                    >
                        ${uuid}
                        <span class="copy-icon">
                            <i class="bi bi-clipboard"></i>
                        </span>
                    </span>
                </div>
            </div>



        </div>
    `;
}
function showCustomAlert(url) {
    if (url === 'N/A') {
        return; // Don't show anything if the URL is 'N/A'
    }

    // Show the custom confirmation popup
    const popup = document.getElementById('confirmationPopup');
    const confirmButton = document.getElementById('confirmButton');

    popup.style.display = 'flex';  // Show the popup

    // When the "Yes" button is clicked, open the link in a new tab
    confirmButton.onclick = function () {
        window.open(url, '_blank');  // Open in a new tab
        closePopup();  // Close the popup
    };
}


function copyToClipboard(text, elementId) {
    // Don't copy if text is N/A
    if (!text || text === 'N/A') {
        ToastManager.show('No valid text to copy', 'error');
        return;
    }

    try {
        // Create temporary textarea
        const textarea = document.createElement('textarea');
        textarea.value = text;

        // Make it readonly to avoid focus and virtual keyboard on mobile
        textarea.setAttribute('readonly', '');

        // Hide the textarea
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';

        // Append to body
        document.body.appendChild(textarea);

        // Check if the device is iOS
        const isIOS = navigator.userAgent.match(/ipad|iphone/i);

        if (isIOS) {
            // Save current scroll position
            const scrollY = window.scrollY;

            // Create selection range
            const range = document.createRange();
            range.selectNodeContents(textarea);

            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);

            // Special handling for iOS
            textarea.setSelectionRange(0, textarea.value.length);

            // Restore scroll position
            window.scrollTo(0, scrollY);
        } else {
            // Select the text
            textarea.select();
        }

        // Copy the text
        const successful = document.execCommand('copy');

        // Remove the temporary textarea
        document.body.removeChild(textarea);

        if (successful) {
            // Show success message
            const customMessage = text.length > 20 ?
                `Copied ${text.substring(0, 20)}... to clipboard!` :
                `Copied ${text} to clipboard!`;
            ToastManager.show(customMessage, 'success');

            // Update visual feedback if elementId is provided
            if (elementId) {
                const element = document.getElementById(elementId);
                if (element) {
                    // Update icon
                    const icon = element.querySelector('.copy-icon');
                    if (icon) {
                        const originalHTML = icon.innerHTML;
                        icon.innerHTML = '<i class="bi bi-check-lg"></i>';

                        // Add animation class
                        element.classList.add('copy-animation');

                        // Reset after animation
                        setTimeout(() => {
                            element.classList.remove('copy-animation');
                            icon.innerHTML = originalHTML;
                        }, 2000);
                    }

                    // Update tooltip
                    const tooltip = bootstrap.Tooltip.getInstance(element);
                    if (tooltip) {
                        tooltip.dispose();
                        element.setAttribute('data-bs-original-title', 'Copied!');
                        const newTooltip = new bootstrap.Tooltip(element);
                        newTooltip.show();

                        // Reset tooltip after delay
                        setTimeout(() => {
                            newTooltip.dispose();
                            element.setAttribute('data-bs-original-title', 'Click to copy');
                            new bootstrap.Tooltip(element);
                        }, 2000);
                    }
                }
            }
        } else {
            throw new Error('Copy command failed');
        }
    } catch (err) {
        console.error('Copy failed:', err);
        ToastManager.show('Failed to copy text. Please try again.', 'error');
    }
};
// Close the popup when "Cancel" or the "×" button is clicked
function closePopup() {
    const popup = document.getElementById('confirmationPopup');
    popup.style.display = 'none';  // Hide the popup
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-MY', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function formatAddressFromParts(address) {
    if (!address) return 'N/A';

    const parts = [
        ...address.lines,
        address.city,
        address.postal,
        address.state,
        address.country
    ].filter(part => part && part !== 'N/A');

    return parts.length > 0 ? parts.join(', ') : 'N/A';
}

async function loadPDF(uuid, documentData) {
    // Only proceed if document is Valid or Cancelled
    if (!['Valid', 'Cancelled'].includes(documentData.documentInfo.status)) {
        console.log('PDF generation skipped - document status:', documentData.documentInfo.status);
        return;
    }

    try {
        // Initial loading state with progress container
        $('.pdf-viewer-container').html(`
            <div class="d-flex flex-column align-items-center justify-content-center h-100">
                <div class="spinner-border text-primary mb-3" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <div id="pdf-progress" class="text-center">
                    <p class="text-muted mb-2" id="pdf-main-status">Initializing PDF generation...</p>
                    <small class="text-muted d-block" id="pdf-status-message"></small>
                </div>
            </div>
        `);

        // Function to update both main status and detail message
        const updateStatus = (mainStatus, detailMessage = '') => {
            $('#pdf-main-status').text(mainStatus);
            $('#pdf-status-message').text(detailMessage);
        };

        updateStatus('Checking PDF status...', 'Looking for existing PDF file');

        // Try to get PDF
        const response = await fetch(`/api/lhdn/documents/${uuid}/pdf`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(documentData)
        });

        const data = await response.json();
        console.log('PDF response:', data);

        if (!data.success) {
            throw new Error(data.message || 'Failed to load PDF');
        }

        if (data.cached) {
            updateStatus('Loading cached PDF...', 'Using existing PDF from cache');
        } else {
            updateStatus('Generating new PDF...', 'This might take a few moments');
        }

        // Load the PDF
        const timestamp = new Date().getTime();
        const pdfUrl = `${data.url}?t=${timestamp}`;

        // Show final status before loading PDF viewer
        updateStatus(data.message || 'Loading PDF viewer...', 'Almost done');

        // Short delay to show the final status message
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Create iframe for PDF
        $('.pdf-viewer-container').html(`
            <iframe id="pdfViewer" class="w-100 h-100" style="border: none;" src="${pdfUrl}"></iframe>
        `);

    } catch (error) {
        console.error('Error loading PDF:', error);
        $('.pdf-viewer-container').html(`
            <div class="alert alert-danger m-3">
                <i class="bi bi-exclamation-triangle me-2"></i>
                Failed to load PDF: ${error.message}
                <button class="btn btn-outline-danger btn-sm ms-3" onclick="loadPDF('${uuid}', ${JSON.stringify(documentData)})">
                    <i class="bi bi-arrow-clockwise me-1"></i>Retry
                </button>
            </div>
        `);
    }
}

async function openValidationResultsModal(uuid) {
    try {
        // Show loading state
        Swal.fire({
            title: 'Loading...',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const response = await fetch(`/api/lhdn/documents/${uuid}/display-details`);
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || 'Failed to fetch validation results');
        }

        Swal.close();

        // Get the validation results container
        const validationResultsDiv = document.getElementById("validationResults");
        if (!validationResultsDiv) {
            throw new Error('Validation results container not found');
        }
        validationResultsDiv.innerHTML = "";

        // Extract validation results from the response
        const data = result.data || result;
        const validationResults = data.documentInfo?.validationResults || data.validationResults || data.detailsData.validationResults;

        console.log('Validation Results:', validationResults);

        if (!validationResults || !validationResults.validationSteps) {
            validationResultsDiv.innerHTML = `
                <div class="lhdn-validation-message error">
                    <i class="bi bi-exclamation-circle-fill"></i>
                    <span>No validation results available</span>
                </div>`;
            return;
        }

        validationResults.validationSteps.forEach((step, index) => {
            const stepDiv = document.createElement("div");
            stepDiv.classList.add("lhdn-validation-step");
            const isValid = step.status === "Valid";
            const statusClass = isValid ? "lhdn-step-valid" : "lhdn-step-invalid";
            const statusIcon = isValid ? "check-circle-fill" : "x-circle-fill";
            const cleanedName = step.name
                .replace(/Step[- ]?\d+/, "")
                .trim()
                .replace(/^[\.\-\s]+|[\.\-\s]+$/g, "");

            // Get all errors from the step
            const errors = step.error?.errors || [];
            const allInnerErrors = errors.length > 0 ?
                errors.reduce((acc, err) => {
                    if (err.innerError && Array.isArray(err.innerError)) {
                        acc.push(...err.innerError);
                    }
                    return acc;
                }, []) :
                (step.error?.innerError || []);

            const contentId = `collapse${index}`;
            stepDiv.innerHTML = `
                <div class="lhdn-step-header ${statusClass}" data-bs-toggle="collapse" data-bs-target="#${contentId}" aria-expanded="${!isValid}" aria-controls="${contentId}">
                    <div class="lhdn-step-title">
                        <i class="bi bi-${statusIcon}"></i>
                        <span>${cleanedName}</span>
                        ${!isValid ? `<span class="error-count">(${allInnerErrors.length} ${allInnerErrors.length === 1 ? 'error' : 'errors'})</span>` : ''}
                    </div>
                    <div class="lhdn-step-status">
                        ${isValid ? 'Valid' : 'Invalid'}
                        <i class="bi bi-chevron-down ms-2"></i>
                    </div>
                </div>
                <div id="${contentId}" class="lhdn-step-content collapse ${!isValid ? 'show' : ''}" aria-labelledby="heading${index}">
                    ${!isValid && allInnerErrors.length > 0
                    ? `
                                <div class="lhdn-validation-message">
                                    ${allInnerErrors.map((err, i) => `
                                        ${i > 0 ? '<div class="lhdn-inner-error mt-3">' : ''}
                                     <div class="lhdn-error-location">
                                        <strong class="lhdn-step-error">Field:</strong>
                                        <span class="lhdn-step-error">${ValidationTranslations.getFieldName(err.propertyPath)}</span>
                                    </div>
                                    <div class="lhdn-error-message">
                                        <strong class="lhdn-step-error">Issue:</strong>
                                        <span class="lhdn-step-error">${ValidationTranslations.getErrorMessage(err.error)}</span>
                                    </div>
                                    <div class="lhdn-error-code">
                                        <strong class="lhdn-step-error">Error Type:</strong>
                                        <span class="lhdn-step-error">${ValidationTranslations.getErrorType(err.errorCode)}</span>
                                    </div>
                                        ${i > 0 ? '</div>' : ''}

                                    `).join('')}
                                    ${allInnerErrors.length > 1 ? `
                                        <div class="error-summary mt-4">
                                            <div class="alert alert-danger">
                                                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                                                <strong>Found ${allInnerErrors.length} validation issues in this step.</strong> Please fix all issues to proceed.
                                            </div>
                                        </div>
                                    ` : ''}
                                </div>
                            `
                    : (!isValid ? `
                                <div class="lhdn-validation-message">
                                    <div class="alert alert-danger mb-3">
                                        <i class="bi bi-exclamation-triangle-fill me-2"></i>
                                        <strong>Validation Error:</strong> Please fix the following issue to proceed.
                                    </div>
                                    <div class="lhdn-error-message">
                                        <strong>Issue:</strong>
                                        <span class="text-break lhdn-step-error">${ValidationTranslations.getErrorMessage(step.error?.error)}</span>
                                    </div>
                                    <div class="lhdn-error-code">
                                        <strong>Error Type:</strong>
                                        <span class="lhdn-step-error">${ValidationTranslations.getErrorType(step.error?.errorCode)}</span>
                                    </div>
                                </div>
                            ` : '<div class="lhdn-validation-success"><i class="bi bi-check-circle-fill"></i>No errors found</div>')
                }
                </div>
            `;
            validationResultsDiv.appendChild(stepDiv);

            // Initialize collapse functionality
            const collapseElement = document.getElementById(contentId);
            if (collapseElement) {
                new bootstrap.Collapse(collapseElement, {
                    toggle: !isValid
                });
            }
        });

        // Show the modal
        const modal = new bootstrap.Modal(document.getElementById('validationResultsModal'));

        // Add event listener for modal show
        const modalElement = document.getElementById('validationResultsModal');
        modalElement.addEventListener('shown.bs.modal', function () {
            // Reinitialize all collapses after modal is shown
            validationResultsDiv.querySelectorAll('.collapse').forEach(collapse => {
                bootstrap.Collapse.getInstance(collapse)?.dispose();
                new bootstrap.Collapse(collapse, {
                    toggle: collapse.classList.contains('show')
                });
            });
        });

        // Add event listener for modal close
        modalElement.addEventListener('hidden.bs.modal', function (e) {
            // Remove modal-specific classes and backdrop
            document.body.classList.remove('modal-open');
            const backdrop = document.querySelector('.modal-backdrop');
            if (backdrop) {
                backdrop.remove();
            }

            // Prevent event from bubbling up
            e.stopPropagation();

            // Adjust columns without redrawing the table
            if (inboundDataTable) {
                inboundDataTable.columns.adjust().draw(false);
            }
        }, { once: true });

        modal.show();

    } catch (error) {
        console.error('Error opening validation results:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: `Failed to load validation results: ${error.message}`
        });
    }
}

// Initialize Charts
function initializeCharts() {
    // Document Status Distribution Chart
    const statusCtx = document.getElementById('documentStatusChart').getContext('2d');
    const statusChart = new Chart(statusCtx, {
        type: 'doughnut',
        data: {
            labels: ['Valid', 'Invalid', 'Cancelled', 'Queue'],
            datasets: [{
                data: [15, 4, 8, 0], // Initial data, will be updated
                backgroundColor: [
                    'rgba(25, 135, 84, 0.8)',
                    'rgba(220, 53, 69, 0.8)',
                    'rgba(255, 193, 7, 0.8)',
                    'rgba(13, 110, 253, 0.8)'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });

    // Daily Submissions Chart
    const submissionsCtx = document.getElementById('dailySubmissionsChart').getContext('2d');
    const submissionsChart = new Chart(submissionsCtx, {
        type: 'line',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Submissions',
                data: [12, 19, 3, 5, 2, 3, 7],
                borderColor: 'rgba(13, 110, 253, 0.8)',
                tension: 0.4,
                fill: true,
                backgroundColor: 'rgba(13, 110, 253, 0.1)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });

    // Processing Time Chart
    const timeCtx = document.getElementById('processingTimeChart').getContext('2d');
    const timeChart = new Chart(timeCtx, {
        type: 'bar',
        data: {
            labels: ['< 1min', '1-5min', '5-15min', '15-30min', '> 30min'],
            datasets: [{
                label: 'Documents',
                data: [4, 8, 15, 3, 1],
                backgroundColor: 'rgba(13, 110, 253, 0.8)',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });

    return { statusChart, submissionsChart, timeChart };
}

// Quick Actions Event Handlers
function initializeQuickActions() {
    try {
        // Export All Documents
        const exportAllBtn = document.getElementById('exportAllBtn');
        if (exportAllBtn) {
            exportAllBtn.addEventListener('click', () => {
                const table = $('#invoiceTable').DataTable();
                const data = table.data().toArray();
                if (data.length === 0) {
                    ToastManager.show('No documents available to export', 'error');
                    return;
                }
                // Trigger export for all documents
                exportToExcel(data, 'all_documents');
            });
        }

        // Download Valid Documents
        const downloadValidBtn = document.getElementById('downloadValidBtn');
        if (downloadValidBtn) {
            downloadValidBtn.addEventListener('click', () => {
                const table = $('#invoiceTable').DataTable();
                const validDocs = table.data().toArray().filter(doc => doc.status === 'Valid');
                if (validDocs.length === 0) {
                    ToastManager.show('No valid documents available', 'error');
                    return;
                }
                exportToExcel(validDocs, 'valid_documents');
            });
        }

        // Export Invalid List
        const exportInvalidBtn = document.getElementById('exportInvalidBtn');
        if (exportInvalidBtn) {
            exportInvalidBtn.addEventListener('click', () => {
                const table = $('#invoiceTable').DataTable();
                const invalidDocs = table.data().toArray().filter(doc => doc.status === 'Invalid');
                if (invalidDocs.length === 0) {
                    ToastManager.show('No invalid documents to export', 'error');
                    return;
                }
                exportToExcel(invalidDocs, 'invalid_documents');
            });
        }

        // Refresh All Data
        const refreshDataBtn = document.getElementById('refreshDataBtn');
        if (refreshDataBtn) {
            refreshDataBtn.addEventListener('click', async () => {
                try {
                    refreshDataBtn.disabled = true;
                    refreshDataBtn.innerHTML = '<i class="bi bi-arrow-clockwise me-2 spin"></i>Refreshing...';

                    const table = $('#invoiceTable').DataTable();
                    const invoiceManager = InvoiceTableManager.getInstance();

                    // Check if table has AJAX capability or use refresh method
                    if (table.ajax && table.ajax.reload) {
                        await table.ajax.reload();
                    } else if (invoiceManager && invoiceManager.refresh) {
                        await invoiceManager.refresh();
                    } else {
                        // Fallback to refreshing current data source
                        if (invoiceManager && invoiceManager.refreshCurrentDataSource) {
                            await invoiceManager.refreshCurrentDataSource();
                        }
                    }

                    updateCharts(); // Update charts with new data
                    ToastManager.show('Data refreshed successfully', 'success');
                } catch (error) {
                    console.error('Error refreshing data:', error);
                    ToastManager.show('Failed to refresh data', 'error');
                } finally {
                    refreshDataBtn.disabled = false;
                    refreshDataBtn.innerHTML = '<i class="bi bi-arrow-clockwise me-2"></i>Refresh All Data';
                }
            });
        }

        // Settings Dropdown Actions
        const settingsDropdown = document.getElementById('settingsDropdown');
        if (settingsDropdown) {
            // Initialize Bootstrap dropdown
            new bootstrap.Dropdown(settingsDropdown);

            // Add event listeners for dropdown items
            document.querySelectorAll('.dropdown-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    const action = e.target.textContent.trim();
                    handleSettingsAction(action);
                });
            });
        }

    } catch (error) {
        console.error('Error initializing quick actions:', error);
        ToastManager.show('Failed to initialize quick actions', 'error');
    }
}

// Helper function to handle settings actions
function handleSettingsAction(action) {
    const table = $('#invoiceTable').DataTable();

    switch(action) {
        case 'Column Visibility':
            // Implement column visibility toggle
            ToastManager.show('Column visibility settings coming soon', 'info');
            break;
        case 'Default Sorting':
            // Implement sorting preferences
            ToastManager.show('Sorting preferences coming soon', 'info');
            break;
        case 'Filter Preferences':
            // Implement filter preferences
            ToastManager.show('Filter preferences coming soon', 'info');
            break;
        case 'Reset All Settings':
            // Reset all table settings
            try {
                table.state.clear();
                table.draw();
                ToastManager.show('All settings have been reset', 'success');
            } catch (error) {
                console.error('Error resetting settings:', error);
                ToastManager.show('Failed to reset settings', 'error');
            }
            break;
        default:
            console.warn('Unknown settings action:', action);
    }
}

// Helper function to export data to Excel
function exportToExcel(data, filename) {
    try {
        // Convert data to CSV format
        const headers = ['UUID', 'Long ID', 'Internal ID', 'Supplier', 'Receiver', 'Date Issued', 'Status', 'Total Amount'];
        const csvContent = [
            headers.join(','),
            ...data.map(row => [
                row.uuid,
                row.longId,
                row.internalId,
                row.supplierName,
                row.receiverName,
                formatDate(row.dateTimeIssued),
                row.status,
                formatCurrency(row.totalSales)
            ].join(','))
        ].join('\n');

        // Create and trigger download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        ToastManager.show('Export completed successfully', 'success');
    } catch (error) {
        console.error('Error exporting to Excel:', error);
        ToastManager.show('Failed to export data', 'error');
    }
}

// Enhanced Filter Functionality
function initializeEnhancedFilters() {
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    const statusSelect = document.getElementById('documentStatus');
    const sourceSelect = document.getElementById('documentSource');

    // Apply filters when any filter changes
    [startDate, endDate, statusSelect, sourceSelect].forEach(element => {
        element.addEventListener('change', () => {
            const table = $('#invoiceTable').DataTable();
            table.draw(); // This will trigger the custom filtering function
        });
    });

    // Reset filters
    document.querySelector('.enhanced-filter-section .btn-link').addEventListener('click', () => {
        startDate.value = '';
        endDate.value = '';
        statusSelect.value = '';
        sourceSelect.value = '';
        $('#invoiceTable').DataTable().draw();
        ToastManager.show('Filters have been reset', 'success');
    });
}

// Document Preview Functionality
function initializeDocumentPreview() {
    const previewSection = document.querySelector('.document-preview-section');

    // Show preview when clicking on a table row
    $('#invoiceTable tbody').on('click', 'tr', function() {
        const table = $('#invoiceTable').DataTable();
        const data = table.row(this).data();
        if (!data) return;

        // Update preview data
        document.getElementById('previewDocId').textContent = data.internalId || '-';
        document.getElementById('previewStatus').textContent = data.status;
        document.getElementById('previewStatus').className = `badge bg-${getStatusColor(data.status)}`;
        document.getElementById('previewDate').textContent = formatDate(data.dateTimeIssued) || '-';
        document.getElementById('previewAmount').textContent = formatCurrency(data.totalSales) || '-';

        // Show preview section
        previewSection.classList.remove('d-none');
    });

    // Close preview
    document.querySelector('.document-preview-section .btn-close').addEventListener('click', () => {
        previewSection.classList.add('d-none');
    });
}

// Helper function to get status color
function getStatusColor(status) {
    const colors = {
        'Valid': 'success',
        'Invalid': 'danger',
        'Cancelled': 'warning',
        'Queue': 'info'
    };
    return colors[status] || 'secondary';
}

// Initialize everything when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing enhanced features...');
    try {
        const charts = initializeCharts();

        // Initialize invoice table using singleton
        const invoiceManager = InvoiceTableManager.getInstance();

        // Initialize date/time display
        DateTimeManager.updateDateTime();

        console.log('Enhanced features initialized successfully');
    } catch (error) {
        console.error('Error initializing enhanced features:', error);
        Swal.fire({
            icon: 'error',
            title: 'Initialization Error',
            text: 'Failed to initialize some features. Please refresh the page.',
            confirmButtonText: 'Refresh',
            showCancelButton: true,
        }).then((result) => {
            if (result.isConfirmed) {
                window.location.reload();
            }
        });
    }
});

// Add helper methods to InvoiceTableManager class
InvoiceTableManager.prototype.showLoadingBackdrop = function(message = 'Loading...') {
    // Remove any existing backdrop
    $('#loadingBackdrop').remove();

    const backdrop = $(`
        <div id="loadingBackdrop" class="loading-backdrop">
            <div class="loading-content">
                <div class="spinner-border text-primary mb-3" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <div class="loading-message">${message}</div>
            </div>
        </div>
    `);

    $('body').append(backdrop);
    backdrop.fadeIn(200);
};

InvoiceTableManager.prototype.hideLoadingBackdrop = function() {
    $('#loadingBackdrop').fadeOut(200, function() {
        $(this).remove();
    });
};

InvoiceTableManager.prototype.showErrorMessage = function(message) {
    Swal.fire({
        icon: 'error',
        title: 'Error',
        text: message,
        confirmButtonText: 'OK'
    });
};

function updateCharts() {
    try {
        const table = $('#invoiceTable').DataTable();
        if (!table) {
            console.warn('Table not initialized yet');
            return;
        }

        // Get all data from the table
        const allData = table.rows().data().toArray();

        // Status Distribution Chart Update
        const statusCounts = {
            Valid: 0,
            Invalid: 0,
            Cancelled: 0,
            Queue: 0
        };

        // Process status counts
        allData.forEach(row => {
            if (row.status === 'Valid') statusCounts.Valid++;
            else if (row.status === 'Invalid') statusCounts.Invalid++;
            else if (row.status === 'Cancelled') statusCounts.Cancelled++;
            else if (['Submitted', 'Pending', 'Queued'].includes(row.status)) statusCounts.Queue++;
        });

        // Update Status Chart
        const statusChart = Chart.getChart('documentStatusChart');
        if (statusChart) {
            statusChart.data.datasets[0].data = [
                statusCounts.Valid,
                statusCounts.Invalid,
                statusCounts.Cancelled,
                statusCounts.Queue
            ];
            statusChart.update();
        }

        // Daily Submissions Chart Update
        const dailySubmissions = new Map();
        const last7Days = [];

        // Generate last 7 days dates
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            last7Days.push(dateStr);
            dailySubmissions.set(dateStr, 0);
        }

        // Count submissions per day
        allData.forEach(row => {
            if (row.dateTimeReceived) {
                const submissionDate = new Date(row.dateTimeReceived).toISOString().split('T')[0];
                if (dailySubmissions.has(submissionDate)) {
                    dailySubmissions.set(submissionDate, dailySubmissions.get(submissionDate) + 1);
                }
            }
        });

        // Update Daily Submissions Chart
        const submissionsChart = Chart.getChart('dailySubmissionsChart');
        if (submissionsChart) {
            submissionsChart.data.labels = last7Days.map(date => {
                const d = new Date(date);
                return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            });
            submissionsChart.data.datasets[0].data = last7Days.map(date => dailySubmissions.get(date));
            submissionsChart.update();
        }

        // Processing Time Chart Update
        const processingTimes = [0, 0, 0, 0, 0]; // [<1min, 1-5min, 5-15min, 15-30min, >30min]

        allData.forEach(row => {
            // Use processingTimeMinutes from backend if available
            const processingTime = typeof row.processingTimeMinutes === 'number' ? row.processingTimeMinutes : null;
            if (processingTime !== null && !isNaN(processingTime)) {
                if (processingTime < 1) processingTimes[0]++;
                else if (processingTime < 5) processingTimes[1]++;
                else if (processingTime < 15) processingTimes[2]++;
                else if (processingTime < 30) processingTimes[3]++;
                else processingTimes[4]++;
            }
        });

        // Update Processing Time Chart
        const timeChart = Chart.getChart('processingTimeChart');
        if (timeChart) {
            timeChart.data.datasets[0].data = processingTimes;
            timeChart.update();
        }

        console.log('Charts updated with table data:', {
            statusCounts,
            dailySubmissions: Object.fromEntries(dailySubmissions),
            processingTimes
        });

    } catch (error) {
        console.error('Error updating charts:', error);
    }
}