// Cache mechanism to reduce unnecessary fetches
const dataCache = {
    tableData: null,
    lastFetchTime: null,
    cacheExpiry: 2 * 60 * 1000, // 2 minutes in milliseconds

    isCacheValid() {
        return this.tableData &&
               this.lastFetchTime &&
               (Date.now() - this.lastFetchTime < this.cacheExpiry);
    },

    updateCache(data) {
        this.tableData = data;
        this.lastFetchTime = Date.now();
    },

    invalidateCache() {
        this.tableData = null;
        this.lastFetchTime = null;
    }
};

class ValidationError extends Error {
    constructor(message, validationErrors = [], fileName = null) {
        super(message);
        this.name = 'ValidationError';
        this.validationErrors = validationErrors;
        this.fileName = fileName;
    }
}

class DateTimeManager {
    static updateDateTime() {
        const timeElement = document.getElementById('currentTime');
        const dateElement = document.getElementById('currentDate');

        function update() {
            const now = new Date();

            if (timeElement) {
                timeElement.textContent = now.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            }

            if (dateElement) {
                dateElement.textContent = now.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            }
        }

        update();
        setInterval(update, 1000);
    }
}

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
        InvoiceTableManager.instance = this;
        this.table = null;
        this.selectedRows = new Set();

        // Request management properties
        this.requestQueue = [];
        this.isRequestInProgress = false;
        this.requestTimeout = 60000; // 60 seconds timeout
        this.maxRetries = 3;
        this.retryDelay = 2000; // 2 seconds
        this.lastRequestTime = 0;
        this.requestDebounceDelay = 200; // 200ms debounce
        this.isDataSourceSwitching = false; // Flag to track data source switching
        this.listAllRequest = null;
        this._hydrateInFlight = false;
        this._hydrateQueued = false;

        // Reset DataTables request flags to ensure they're in a clean state
        window._dataTablesRequestInProgress = false;
        window._dataTablesRequestStartTime = null;

        // Add a prefilter for all AJAX requests with enhanced error handling
        $.ajaxPrefilter((options, originalOptions, jqXHR) => {
            // Add timeout to all requests
            if (!options.timeout) {
                options.timeout = this.requestTimeout;
            }

            const requestUrl = options.url || '';
            const isListAll = requestUrl.includes('/api/outbound-files/list-all');
            const skipLoading = originalOptions.skipOutboundLoading === true
                || requestUrl.includes('/api/outbound-files/hydrate-list');

            if (isListAll) {
                if (this.listAllRequest && this.listAllRequest.readyState !== 4) {
                    console.log('Aborting previous list-all request to prevent conflicts');
                    this.listAllRequest.abort();
                }
                this.listAllRequest = jqXHR;
            }

            if (!skipLoading && !options.beforeSend) {
                options.beforeSend = () => {
                    this.showLoadingBackdrop();
                };
            }

            let oldComplete = options.complete;
            options.complete = (jqXHRComplete, textStatus) => {
                if (!skipLoading) {
                    this.hideLoadingBackdrop();
                }

                if (this.listAllRequest === jqXHRComplete) {
                    this.listAllRequest = null;
                }

                if (isListAll) {
                    window._dataTablesRequestInProgress = false;
                    window._dataTablesRequestStartTime = null;
                    this.isRequestInProgress = false;
                }

                if (oldComplete) {
                    oldComplete(jqXHRComplete, textStatus);
                }
            };
        });

        this.initializeTable();
        this.initializeCharts();
        this.setupPageUnloadHandler();
    }

    showLoadingBackdrop(message = 'Loading and Preparing Your Excel Files') {
        // Remove any existing backdrop
        $('#loadingBackdrop').remove();

        // Create and append new backdrop with enhanced UI
        const backdrop = `
            <div id="loadingBackdrop" class="excel-loading-backdrop">
                <div class="excel-loading-content">
                    <div class="excel-modal-header">
                        <div class="excel-processing-icon">
                            <div class="excel-document-stack">
                                <div class="excel-document excel-doc1"></div>
                                <div class="excel-document excel-doc2"></div>
                                <div class="excel-document excel-doc3"></div>
                            </div>
                            <div class="excel-processing-circle"></div>
                        </div>
                        <div class="excel-processing-title">
                            <h5>${message}</h5>
                            <p>Processing documents. Please wait... ⏳</p>
                            <p class="excel-loading-time-estimate">Estimated time: 1-2 minutes (large batches)</p>
                            <p class="excel-loading-important">⚠️ Do not close or refresh this page. ⚠️</p>
                        </div>
                    </div>

                    <div class="excel-processing-container">
                        <div class="excel-invoice-animation">
                            <div class="excel-invoice-paper">
                                <div class="excel-invoice-header">
                                    <div class="excel-invoice-line"></div>
                                </div>
                                <div class="excel-invoice-details">
                                    <div class="excel-invoice-details-left">
                                        <div class="excel-invoice-details-line"></div>
                                        <div class="excel-invoice-details-line"></div>
                                    </div>
                                    <div class="excel-invoice-details-right">
                                        <div class="excel-invoice-details-line"></div>
                                        <div class="excel-invoice-details-line"></div>
                                    </div>
                                </div>
                                <div class="excel-invoice-table">
                                    <div class="excel-invoice-table-row">
                                        <div class="excel-invoice-table-cell"></div>
                                        <div class="excel-invoice-table-cell"></div>
                                        <div class="excel-invoice-table-cell"></div>
                                    </div>
                                    <div class="excel-invoice-table-row">
                                        <div class="excel-invoice-table-cell"></div>
                                        <div class="excel-invoice-table-cell"></div>
                                        <div class="excel-invoice-table-cell"></div>
                                    </div>
                                </div>
                                <div class="excel-invoice-stamp"></div>
                            </div>
                        </div>

                        <div class="excel-processing-steps">
                            <div class="excel-step-item excel-active" id="excelLoadingStep1">
                                <i class="bi bi-file-text"></i>
                                <span>Fetching Document Files</span>
                            </div>
                            <div class="excel-step-arrow">→</div>
                            <div class="excel-step-item" id="excelLoadingStep2">
                                <i class="bi bi-check2-circle"></i>
                                <span>Validating & Transforming to LHDN Format</span>
                            </div>
                            <div class="excel-step-arrow">→</div>
                            <div class="excel-step-item" id="excelLoadingStep3">
                                <i class="bi bi-cloud-upload"></i>
                                <span>Processing</span>
                            </div>
                        </div>

                        <div id="excelLoadingStatusMessage" class="excel-processing-status">
                            <div class="excel-status-icon">
                                <i class="bi bi-arrow-repeat excel-spin"></i>
                            </div>
                            <span class="excel-status-text">Initializing document processing...</span>
                        </div>
                    </div>

                    <div class="excel-progress-section">
                        <div class="excel-progress-header">
                            <div class="excel-progress-info">
                                <span class="excel-progress-label">Processing Progress</span>
                                <span class="excel-progress-percentage" id="excelLoadingProgressPercentage">0%</span>
                            </div>
                            <div class="excel-document-count">
                                <i class="bi bi-files"></i>
                                <span id="excelLoadingProcessedCount">0/0</span> documents
                            </div>
                        </div>
                        <div class="excel-progress">
                            <div id="excelLoadingProgressBar"
                                class="excel-progress-bar progress-bar-striped progress-bar-animated"
                                role="progressbar"
                                style="width: 0%"
                                aria-valuenow="0"
                                aria-valuemin="0"
                                aria-valuemax="100">
                            </div>
                        </div>
                    </div>

                    <div class="excel-processing-info">
                        <div id="excelLoadingFact" class="excel-info-box">
                            <div class="excel-info-icon">
                                <i class="bi bi-lightbulb"></i>
                            </div>
                            <div class="excel-info-content">
                                <span class="excel-info-label">Processing Tip</span>
                                <p class="excel-info-message">Automating invoicing can reduce errors by up to 80%.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        $('body').append(backdrop);
        $('#loadingBackdrop').fadeIn(300);

        // Start animation sequence
        this.startLoadingAnimation();
    }

    startLoadingAnimation() {
        // Array of loading messages with progress percentages
        const loadingStates = [
            { message: 'Initializing document processing...', progress: 10 },
            { message: 'Checking file formats...', progress: 20 },
            { message: 'Validating document structure...', progress: 35 },
            { message: 'Processing invoice data...', progress: 45 },
            { message: 'Analyzing document content...', progress: 60 },
            { message: 'Preparing document summary...', progress: 70 },
            { message: 'Formatting data...', progress: 80 },
            { message: 'Verifying tax information...', progress: 85 },
            { message: 'Applying validation rules...', progress: 90 },
            { message: 'Almost done...', progress: 95 }
        ];

        // Array of fun facts
        const funFacts = [
            'Automating invoicing can reduce errors by up to 80%.',
            'E-invoicing can save up to 80% in processing costs.',
            'Digital invoices are processed 5x faster than paper.',
            'E-invoicing reduces carbon footprint by 36%.',
            'Companies save 60-80% switching to e-invoicing.',
            'Digital invoices cut processing time by 50%.',
            'E-invoicing improves cash flow by 25%.',
            'Malaysia aims for 80% e-invoice adoption by 2025.',
            'E-invoicing reduces payment delays by 61%.',
            'Digital transformation saves 150+ hours annually.'
        ];

        let currentStateIndex = 0;
        let factIndex = 0;

        // Update progress bar and message
        const updateLoadingState = () => {
            if (!$('#loadingBackdrop').length) return;

            if (currentStateIndex < loadingStates.length) {
                const currentState = loadingStates[currentStateIndex];

                // Update message
                $('#excelLoadingStatusMessage').html(`
                    <div class="excel-status-icon">
                        <i class="bi bi-arrow-repeat excel-spin"></i>
                    </div>
                    <span class="excel-status-text">${currentState.message}</span>`);

                // Update progress
                $('#excelLoadingProgressBar').css('width', `${currentState.progress}%`);
                $('#excelLoadingProgressBar').attr('aria-valuenow', currentState.progress);
                $('#excelLoadingProgressPercentage').text(`${currentState.progress}%`);

                // Update document count - simulate progress
                const total = 10; // Example total
                const processed = Math.floor(currentState.progress / 100 * total);
                $('#excelLoadingProcessedCount').text(`${processed}/${total}`);

                // Update active step
                $('.excel-step-item').removeClass('excel-active');
                if (currentState.progress < 33) {
                    $('#excelLoadingStep1').addClass('excel-active');
                } else if (currentState.progress < 66) {
                    $('#excelLoadingStep2').addClass('excel-active');
                } else {
                    $('#excelLoadingStep3').addClass('excel-active');
                }

                currentStateIndex++;
            }
        };

        // Update fun facts
        const updateFunFact = () => {
            if (!$('#loadingBackdrop').length) return;

            const fact = funFacts[factIndex % funFacts.length];
            $('#excelLoadingFact').html(`
                <div class="excel-info-icon">
                    <i class="bi bi-lightbulb"></i>
                </div>
                <div class="excel-info-content">
                    <span class="excel-info-label">Processing Tip</span>
                    <p class="excel-info-message">${fact}</p>
                </div>`);

            factIndex++;
        };

        // Start sequences
        let interval = 800;
        const scheduleNextUpdate = () => {
            if (currentStateIndex < loadingStates.length && $('#loadingBackdrop').length) {
                updateLoadingState();
                interval += 200;
                setTimeout(scheduleNextUpdate, interval);
            }
        };

        scheduleNextUpdate();

        // Update fun facts every 5 seconds
        this.factInterval = setInterval(updateFunFact, 5000);
    }

    hideLoadingBackdrop() {
        // Clear any intervals
        if (this.factInterval) {
            clearInterval(this.factInterval);
        }

        // Ensure DataTables request flags are cleared
        window._dataTablesRequestInProgress = false;
        window._dataTablesRequestStartTime = null;
        this.isRequestInProgress = false;

        $('#loadingBackdrop').fadeOut(300, function() {
            $(this).remove();
        });
    }

    rowNeedsHydrate(row) {
        if (!row || row.fromStaging || row.dataSource === 'WP_OUTBOUND_STATUS') {
            return false;
        }
        const supplier = row.supplierInfo?.registrationName || row.supplierName || row.supplier;
        const buyer = row.buyerInfo?.registrationName || row.buyerName || row.receiver;
        const amount = row.totalAmount;
        return !supplier || !buyer || !amount;
    }

    hydrateVisibleRows() {
        if (this._skipHydrateDraw || this.currentDataSource !== 'list-all' || !this.table) {
            return;
        }

        if (this._hydrateInFlight) {
            this._hydrateQueued = true;
            return;
        }

        const visibleRows = this.table.rows({ page: 'current' }).data().toArray();
        const files = visibleRows
            .filter((row) => row && row.fileName && this.rowNeedsHydrate(row))
            .map((row) => ({
                fileName: row.fileName,
                type: row.type || row.source,
                company: row.company,
                date: row.date
            }))
            .filter((file) => file.type && file.company && file.date)
            .slice(0, 25);

        if (files.length === 0) {
            return;
        }

        this._hydrateInFlight = true;
        this._hydrateQueued = false;

        $.ajax({
            url: '/api/outbound-files/hydrate-list',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ files }),
            skipOutboundLoading: true,
            timeout: this.requestTimeout,
            xhrFields: {
                withCredentials: true
            }
        }).done((json) => {
            if (!json || !json.success || !Array.isArray(json.files) || !this.table) {
                return;
            }

            const hydratedByName = new Map(
                json.files.filter((item) => item && item.success && item.fileName).map((item) => [item.fileName, item])
            );

            if (hydratedByName.size === 0) {
                return;
            }

            let didUpdate = false;
            this._skipHydrateDraw = true;
            this.table.rows({ page: 'current' }).every(function () {
                const current = this.data();
                const hydrated = current ? hydratedByName.get(current.fileName) : null;
                if (!hydrated) {
                    return;
                }

                const supplierName = hydrated.supplierInfo?.registrationName || current.supplier;
                const buyerName = hydrated.buyerInfo?.registrationName || current.receiver;
                this.data({
                    ...current,
                    supplierInfo: hydrated.supplierInfo || current.supplierInfo,
                    buyerInfo: hydrated.buyerInfo || current.buyerInfo,
                    supplier: supplierName,
                    receiver: buyerName,
                    supplierName,
                    buyerName,
                    totalAmount: hydrated.totalAmount || current.totalAmount,
                    issueDate: hydrated.issueDate || current.issueDate,
                    issueTime: hydrated.issueTime || current.issueTime,
                    currency: hydrated.currency || current.currency,
                    needsHydrate: false
                });
                didUpdate = true;
            });

            if (didUpdate) {
                this.table.columns.adjust();
                setTimeout(() => this.updateCardTotals(), 0);
            }
        }).fail((xhr, error) => {
            if (error === 'abort') {
                return;
            }
            console.error('Failed to hydrate visible outbound rows:', error);
        }).always(() => {
            this._skipHydrateDraw = false;
            this._hydrateInFlight = false;
            if (this._hydrateQueued) {
                this._hydrateQueued = false;
                this.hydrateVisibleRows();
            }
        });
    }

    // Handle timeout errors with retry logic
    handleTimeoutError() {
        console.log('Request timed out, implementing retry logic');

        Swal.fire({
            title: 'Request Timeout',
            text: 'The request is taking longer than expected. Would you like to retry?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Retry',
            cancelButtonText: 'Cancel',
            customClass: {
                confirmButton: 'btn btn-primary',
                cancelButton: 'btn btn-secondary'
            }
        }).then((result) => {
            if (result.isConfirmed) {
                this.retryDataLoad();
            }
        });
    }

    // Retry data loading with exponential backoff
    async retryDataLoad(retryCount = 0) {
        if (retryCount >= this.maxRetries) {
            console.error('Max retries reached, giving up');
            Swal.fire({
                title: 'Failed to Load Data',
                text: 'Unable to load data after multiple attempts. Please check your connection and try again.',
                icon: 'error',
                confirmButtonText: 'OK',
                customClass: {
                    confirmButton: 'btn btn-primary'
                }
            });
            return;
        }

        try {
            console.log(`Retry attempt ${retryCount + 1}/${this.maxRetries}`);

            // Show loading with retry message
            this.showLoadingBackdrop(`Retrying... (Attempt ${retryCount + 1}/${this.maxRetries})`);

            // Wait before retrying (exponential backoff)
            if (retryCount > 0) {
                const delay = this.retryDelay * Math.pow(2, retryCount - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            }

            // Force refresh the table
            sessionStorage.setItem('forceRefreshOutboundTable', 'true');
            dataCache.invalidateCache();

            if (this.table) {
                this.table.ajax.reload((json) => {
                    if (json && json.success !== false) {
                        console.log('Retry successful');
                        this.hideLoadingBackdrop();
                    } else {
                        throw new Error('Invalid response received');
                    }
                }, false);
            }
        } catch (error) {
            console.error(`Retry attempt ${retryCount + 1} failed:`, error);
            this.hideLoadingBackdrop();

            // Try again with increased retry count
            setTimeout(() => {
                this.retryDataLoad(retryCount + 1);
            }, 1000);
        }
    }

    // Setup page unload handler to cleanup requests
    setupPageUnloadHandler() {
        // Handle page unload to prevent abort errors
        window.addEventListener('beforeunload', () => {
            console.log('Page unloading, cleaning up requests...');

            // Cancel any ongoing requests
            if (this.listAllRequest && this.listAllRequest.readyState !== 4) {
                this.listAllRequest.abort();
            }

            // Clear flags
            this.isRequestInProgress = false;
            window._dataTablesRequestInProgress = false;
            window._dataTablesRequestStartTime = null;

            // Clear any intervals
            if (this.factInterval) {
                clearInterval(this.factInterval);
            }
        });

        // Handle visibility change (tab switching)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('Page hidden, pausing requests...');
                // Don't cancel requests when tab is hidden, just log
            } else {
                console.log('Page visible again');
            }
        });
    }

    initializeTable() {
        try {
            // Destroy existing table if it exists
            if ($.fn.DataTable.isDataTable('#invoiceTable')) {
                $('#invoiceTable').DataTable().destroy();
                $('#invoiceTable').empty();
            }

            const self = this; // Store reference to this
            this.currentDataSource = 'list-all'; // Track current data source
            // Show sync status button when switching to live data
                const syncStatusBtn = document.getElementById('syncStatusBtn');
                if (syncStatusBtn) {
                    syncStatusBtn.style.display = 'none';
                }

            // Initialize DataTable with minimal styling configuration
            this.table = $('#invoiceTable').DataTable({
                columns: [
                    {
                        data: null,
                        orderable: false,
                        searchable: false,
                        render: function (data, type, row) {
                            // Only enable checkbox for Pending status
                            const status = (row.status || 'Pending').toLowerCase();
                            const disabledStatus = ['submitted', 'cancelled', 'rejected', 'invalid'].includes(status);
                            const disabledAttr = disabledStatus ? 'disabled' : '';
                            const title = disabledStatus ? `Cannot select ${status} items` : '';

                            return `<div>
                                <input type="checkbox" class="outbound-checkbox row-checkbox" ${disabledAttr} data-status="${status}" title="${title}">
                            </div>`;
                        }
                    },
                    {
                        data: null,
                        orderable: false,
                        searchable: false,
                        render: function (data, type, row, meta) {
                            // Calculate the correct index based on the current page and page length
                            const pageInfo = meta.settings._iDisplayStart;
                            const index = pageInfo + meta.row + 1;
                            return `<span class="row-index">${index}</span>`;
                        }
                    },
                    {
                        data: 'invoiceNumber',
                        title: 'INV NO. / DOCUMENT',
                        render: (data, type, row) => this.renderInvoiceNumber(data, type, row)
                    },
                    {
                        data: 'company',
                        title: 'COMPANY',
                        render: (data, type, row) => this.renderCompanyInfo(data, type, row)
                    },
                    {
                        data: null,
                        title: 'SUPPLIER',
                        render: (data, type, row) => {
                            // Handle both live data (supplierInfo object) and staging data (supplierName string)
                            if (row.fromStaging || row.dataSource === 'WP_OUTBOUND_STATUS') {
                                // For staging data, use the supplierName directly
                                return this.renderSupplierInfo({ name: row.supplierName || row.supplier });
                            } else {
                                // For live data, use the supplierInfo object
                                return this.renderSupplierInfo(row.supplierInfo);
                            }
                        }
                    },
                    {
                        data: null,
                        title: 'RECEIVER',
                        render: (data, type, row) => {
                            // Handle both live data (buyerInfo object) and staging data (buyerName string)
                            if (row.fromStaging || row.dataSource === 'WP_OUTBOUND_STATUS') {
                                // For staging data, use the buyerName directly
                                return this.renderBuyerInfo({ name: row.buyerName || row.receiver });
                            } else {
                                // For live data, use the buyerInfo object
                                return this.renderBuyerInfo(row.buyerInfo);
                            }
                        }
                    },
                    {
                        data: 'uploadedDate',
                        orderable: true,
                        title: 'FILE UPLOADED',
                        render: (data, type, row) => this.renderUploadedDate(data, type, row)
                    },
                    {
                        data: null,
                        title: 'E-INV. DATE INFO',
                        render: (data, type, row) => this.renderDateInfo(row.issueDate, row.issueTime, row.date_submitted, row.date_cancelled, row)
                    },
                    {
                        data: 'status',
                        title: 'STATUS',
                        render: (data) => this.renderStatus(data)
                    },
                    {
                        data: 'source',
                        title: 'SOURCE',
                        render: (data) => this.renderSource(data)
                    },
                    {
                        data: 'totalAmount',
                        title: 'AMOUNT',
                        render: (data) => this.renderTotalAmount(data)
                    },
                    {
                        data: null,
                        title: 'ACTION',
                        orderable: false,
                        render: (data, type, row) => this.renderActions(row)
                    }
                ],
                scrollX: true,
                scrollCollapse: true,
                autoWidth: false,
                pageLength: 10,
                dom: '<"outbound-controls"<"outbound-length-control"l>><"outbound-table-responsive"t><"outbound-bottom"<"outbound-info"i><"outbound-pagination"p>>',
                initComplete: function() {
                    // Set initial filter to Pending
                    self.table.column(8).search('Pending').draw();
                    $('.quick-filters .btn[data-filter="pending"]').addClass('active');
                },
                language: {
                    search: '',
                    searchPlaceholder: 'Search...',
                    lengthMenu: 'Show _MENU_ entries',
                    info: 'Showing _START_ to _END_ of _TOTAL_ entries',
                    infoEmpty: 'Showing 0 to 0 of 0 entries',
                    infoFiltered: '(filtered from _MAX_ total entries)',
                    paginate: {
                        first: '<i class="bi bi-chevron-double-left"></i>',
                        previous: '<i class="bi bi-chevron-left"></i>',
                        next: '<i class="bi bi-chevron-right"></i>',
                        last: '<i class="bi bi-chevron-double-right"></i>'
                    },
                    emptyTable: this.getEmptyStateHtml(),
                    zeroRecords: `<div class="text-center">
                    <i class="bi bi-exclamation-triangle" style="font-size: 2em; color: var(--bs-warning);"></i>
                    <p>No records found. Please try <a href="#" onclick="window.location.reload();">reloading the page</a> to refresh the data.</p>
                    <p>Try <a href="#" onclick="window.location.reload();">reloading the page</a>. If the issue persists, please contact support.</p>
                </div>`,
                },
                processing: true,
                serverSide: false,
                ajax: {
                    url: '/api/outbound-files/list-all', // Default URL
                    method: 'GET',
                    timeout: self.requestTimeout, // Use instance timeout
                    xhrFields: {
                        withCredentials: true
                    },
                    data: function(d) {
                        // Add cache control parameters
                        d.forceRefresh = sessionStorage.getItem('forceRefreshOutboundTable') === 'true';
                        d.manualRefresh = sessionStorage.getItem('manualRefreshOutboundTable') === 'true';

                        // Add timestamp to prevent caching
                        d._timestamp = new Date().getTime();

                        // Clear the flags after using them
                        if (d.forceRefresh) {
                            sessionStorage.removeItem('forceRefreshOutboundTable');
                            dataCache.invalidateCache();
                        }
                        if (d.manualRefresh) {
                            sessionStorage.removeItem('manualRefreshOutboundTable');
                            dataCache.invalidateCache();
                        }
                        return d;
                    },
                    dataSrc: (json) => {
                        console.log('DataSrc received response:', json);

                        // If we're using the cache, bypass processing
                        if (json.fromCache && json.cachedData) {
                            return json.cachedData;
                        }

                        if (!json.success) {
                            console.error('Error:', json.error);

                            // Check if it's an authentication error
                            if (json.needsLogin || json.redirect) {
                                console.log('Authentication required, redirecting to login');
                                window.location.href = json.redirect || '/auth/login';
                                return [];
                            }


                            return [];
                        }

                        // Handle both response formats: json.files (list-all) and json.data (staging)
                        const filesData = json.files || json.data || [];

                        if (!filesData || filesData.length === 0) {
                            // Check if we're in staging mode
                            const isStagingMode = self.currentDataSource === 'staging';

                            const message = isStagingMode ?
                                'No archive staging data found' :
                                'No EXCEL files found';

                            // Show empty state message in table
                            $('#invoiceTable tbody').html(`
                                <tr>
                                    <td colspan="10" class="text-center p-4">
                                        <div class="empty-state-container">
                                            <div class="empty-state-icon mb-3">
                                                <i class="fas fa-file-excel fa-3x text-muted"></i>
                                            </div>
                                            <h5>${message}</h5>
                                            <p class="text-muted">Try refreshing the page or check your data source settings.</p>
                                        </div>
                                    </td>
                                </tr>
                            `);
                            return [];
                        }

                        // Process the files data - handle both live and staging data
                        const processedData = filesData.map(file => {
                            const supplierName = file.supplierName || file.supplier || file.supplierInfo?.registrationName || null;
                            const buyerName = file.buyerName || file.receiver || file.buyerInfo?.registrationName || null;
                            const isLiveList = self.currentDataSource === 'list-all' && !file.fromStaging;
                            return {
                                ...file,
                                DT_RowId: file.fileName,
                                invoiceNumber: file.invoiceNumber || file.invoice_number || file.fileName.replace(/\.xml$/i, ''),
                                fileName: file.fileName,
                                documentType: file.documentType || file.document_type || 'Invoice',
                                company: file.company,
                                buyerInfo: file.buyerInfo || { registrationName: buyerName },
                                supplierInfo: file.supplierInfo || { registrationName: supplierName },
                                supplierName,
                                buyerName,
                                supplier: file.supplier || supplierName,
                                receiver: file.receiver || buyerName,
                                uploadedDate: file.uploadedDate ? new Date(file.uploadedDate).toISOString() : new Date().toISOString(),
                                issueDate: file.issueDate,
                                issueTime: file.issueTime,
                                date_submitted: file.submissionDate ? new Date(file.submissionDate).toISOString() : file.date_submitted,
                                date_cancelled: file.date_cancelled ? new Date(file.date_cancelled).toISOString() : null,
                                cancelled_by: file.cancelled_by || null,
                                cancel_reason: file.cancel_reason || file.cancellation_reason || null,
                                status: file.status || 'Pending',
                                source: file.source,
                                uuid: file.uuid || file.UUID || null,
                                totalAmount: file.totalAmount || file.amount || null,
                                fromStaging: file.fromStaging || false,
                                dataSource: file.dataSource || null,
                                needsHydrate: isLiveList ? (file.needsHydrate === true || self.rowNeedsHydrate({
                                    supplierInfo: file.supplierInfo || { registrationName: supplierName },
                                    buyerInfo: file.buyerInfo || { registrationName: buyerName },
                                    totalAmount: file.totalAmount || file.amount || null
                                })) : false
                            };
                        });

                        console.log('Current Processed Data: ', processedData);

                        // Update the cache with the processed data
                        dataCache.updateCache(processedData);

                        //console.log("Current Process Data", processedData);

                        // Update card totals after data is loaded
                        setTimeout(() => this.updateCardTotals(), 0);

                        return processedData;
                    },
                    beforeSend: function(jqXHR) {
                        // Implement request debouncing (but skip during data source switching)
                        const currentTime = Date.now();
                        if (!self.isDataSourceSwitching && currentTime - self.lastRequestTime < self.requestDebounceDelay) {
                            console.log('Request debounced - too soon after last request');
                            jqXHR.abort();
                            return false;
                        }
                        self.lastRequestTime = currentTime;

                        // Check if another request is already in progress
                        if (self.isRequestInProgress) {
                            console.log('Request blocked - another request is already in progress');
                            jqXHR.abort();
                            return false;
                        }

                        // Set flags to indicate request is in progress
                        self.isRequestInProgress = true;
                        window._dataTablesRequestInProgress = true;
                        window._dataTablesRequestStartTime = currentTime;

                        // Show loading for initial load, forced refreshes, or manual refreshes
                        if (!dataCache.isCacheValid() ||
                            sessionStorage.getItem('forceRefreshOutboundTable') === 'true' ||
                            sessionStorage.getItem('manualRefreshOutboundTable') === 'true') {
                            self.showLoadingBackdrop('Loading and Preparing Your Excel Files');
                        }

                        return true;
                    },
                    complete: function() {
                        // Clear the DataTables request flag
                        window._dataTablesRequestInProgress = false;
                        window._dataTablesRequestStartTime = null;

                        // Reset data source switching flag
                        self.isDataSourceSwitching = false;

                        // Hide loading backdrop
                        self.hideLoadingBackdrop();
                    },
                    error: function(xhr, error, thrown) {
                        // Clear the DataTables request flag on error
                        window._dataTablesRequestInProgress = false;
                        window._dataTablesRequestStartTime = null;
                        self.isRequestInProgress = false;

                        console.error('DataTables AJAX error:', {
                            error: error,
                            thrown: thrown,
                            status: xhr.status,
                            statusText: xhr.statusText,
                            readyState: xhr.readyState,
                            responseText: xhr.responseText
                        });

                        // Hide loading backdrop
                        self.hideLoadingBackdrop();

                        // Handle specific error types
                        if (error === 'abort') {
                            console.log('Request was aborted - this is usually due to a new request being made', {
                                isDataSourceSwitching: self.isDataSourceSwitching,
                                currentDataSource: self.currentDataSource,
                                readyState: xhr.readyState
                            });

                            // If we're switching data sources, this is expected behavior
                            if (self.isDataSourceSwitching) {
                                console.log('✅ Abort during data source switching - this is expected and handled gracefully');
                                self.isDataSourceSwitching = false; // Reset the flag
                                return;
                            }

                            // Don't show error for other intentional aborts
                            console.log('✅ Intentional abort - no error display needed');
                            return;
                        }

                        // Check for authentication errors
                        if (xhr.status === 401) {
                            console.log('Authentication error, redirecting to login');
                            window.location.href = '/auth/login?expired=true';
                            return;
                        }

                        // Handle timeout errors
                        if (error === 'timeout') {
                            self.handleTimeoutError();
                            return;
                        }

                        // Show appropriate error message
                        let errorMessage = 'Error loading data. Please try refreshing the page.';
                        let errorTitle = 'Error Loading Data';

                        if (xhr.status === 403) {
                            errorMessage = 'Access denied. Please check your permissions.';
                            errorTitle = 'Access Denied';
                        } else if (xhr.status === 500) {
                            errorMessage = 'Server error. Please try again later.';
                            errorTitle = 'Server Error';
                        } else if (xhr.status === 0 && error !== 'abort') {
                            errorMessage = 'Network connection error. Please check your internet connection.';
                            errorTitle = 'Connection Error';
                        }

                        // Show error message in table
                        $('#invoiceTable tbody').html(`
                            <tr>
                                <td colspan="12" class="text-center p-4">
                                    <div class="empty-state-container">
                                        <div class="empty-state-icon mb-3">
                                            <i class="fas fa-exclamation-triangle fa-3x text-danger"></i>
                                        </div>
                                        <h5>${errorTitle}</h5>
                                        <p class="text-muted">${errorMessage}</p>
                                        <div class="mt-3">
                                            <button class="btn btn-primary btn-sm me-2" onclick="window.location.reload()">
                                                <i class="bi bi-arrow-clockwise"></i> Retry
                                            </button>
                                            <button class="btn btn-outline-secondary btn-sm" onclick="InvoiceTableManager.getInstance().retryDataLoad()">
                                                <i class="bi bi-arrow-repeat"></i> Reload Data
                                            </button>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        `);
                    }
                },
                order: [
                    [8, 'desc'], // Status first (Pending at top)
                    [6, 'desc'] // Then by upload date, newest first
                ],
                columnDefs: [
                    {
                        targets: 8, // STATUS column
                        type: 'string'
                    },
                    {
                        targets: 6, // FILE UPLOADED column
                        type: 'date'
                    }
                ],
                drawCallback: function (settings) {
                    // Update row indexes when table is redrawn (sorting, filtering, pagination)
                    $(this).find('tbody tr').each(function (index) {
                        const pageInfo = settings._iDisplayStart;
                        $(this).find('.row-index').text(pageInfo + index + 1);
                    });
                    self.hydrateVisibleRows();
                },
                createdRow: (row, data, dataIndex) => {
                    // Add a class to the row based on status
                    const status = (data.status || 'Pending').toLowerCase();
                    if (['submitted', 'valid', 'cancelled', 'rejected', 'invalid'].includes(status)) {
                        $(row).addClass('non-selectable-row');
                        // Add a tooltip to explain why the row can't be selected
                        $(row).attr('title', `${status.charAt(0).toUpperCase() + status.slice(1)} items cannot be selected for re-submission`);
                    } else {
                        $(row).addClass('selectable-row');
                    }
                },
            });

            this.initializeFeatures();

        } catch (error) {
            console.error('Error initializing DataTable:', error);
            // Show error message in table
            $('#invoiceTable tbody').html(`
                <tr>
                    <td colspan="10" class="text-center p-4">
                        <div class="empty-state-container">
                            <div class="empty-state-icon mb-3">
                                <i class="fas fa-exclamation-triangle fa-3x text-danger"></i>
                            </div>
                            <h5>Error Initializing Table</h5>
                            <p class="text-muted">Please try refreshing the page if this persists.</p>
                            <button class="btn btn-primary btn-sm" onclick="window.location.reload()">Refresh Page</button>
                        </div>
                    </td>
                </tr>
            `);
            // Remove the page reload to prevent refresh
        }
    }



    initializeCharts() {
        // Initialize Document Status Distribution Chart
        const statusCtx = document.getElementById('documentStatusChart');
        if (statusCtx) {
            window.documentStatusChart = new Chart(statusCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Submitted', 'Invalid', 'Pending', 'Cancelled'],
                    datasets: [{
                        data: [0, 0, 0, 0],
                        backgroundColor: [
                            '#198754',  // Submitted - Success Green
                            '#dc3545',  // Invalid - Red
                            '#ff8307',  // Pending - Orange
                            '#ffc107'   // Cancelled - Yellow
                        ],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                padding: 20,
                                font: {
                                    size: 11
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.raw || 0;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                                    return `${label}: ${value} (${percentage}%)`;
                                }
                            }
                        }
                    }
                }
            });
        }

        // Initialize Validation Success Rate Chart
        const processingCtx = document.getElementById('processingTimeChart');
        if (processingCtx) {
            window.processingTimeChart = new Chart(processingCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Submitted', 'Invalid', 'Pending'],
                    datasets: [{
                        data: [0, 0, 0],
                        backgroundColor: [
                            '#198754',  // Submitted - Success Green
                            '#dc3545',  // Invalid - Red
                            '#ff8307',  // Pending - Orange
                        ],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                padding: 20,
                                font: {
                                    size: 11
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.raw || 0;
                                    return `${label}: ${value.toFixed(1)}%`;
                                }
                            }
                        }
                    }
                }
            });
        }
    }

    updateStatisticsCharts(totals) {
        // Update Document Status Distribution Chart
        if (window.documentStatusChart) {
            window.documentStatusChart.data.datasets[0].data = [
                totals.submitted,
                totals.invalid,
                totals.pending,
                totals.cancelled
            ];
            window.documentStatusChart.update();
        }

        // Update Validation Success Rate Chart
        if (window.processingTimeChart && this.table) {
            const total = totals.submitted + totals.invalid + totals.pending;
            const submittedPercentage = total > 0 ? (totals.submitted / total) * 100 : 0;
            const invalidPercentage = total > 0 ? (totals.invalid / total) * 100 : 0;
            const pendingPercentage = total > 0 ? (totals.pending / total) * 100 : 0;

            window.processingTimeChart.data.datasets[0].data = [
                Math.round(submittedPercentage * 10) / 10,
                Math.round(invalidPercentage * 10) / 10,
                Math.round(pendingPercentage * 10) / 10
            ];
            window.processingTimeChart.update();
        }
    }

    // Helper method to show error message
    showErrorMessage(message) {
        Swal.fire({
            title: 'Error Loading Data',
            text: message,
            icon: 'error',
            confirmButtonText: 'Retry',
            showCancelButton: true,
            cancelButtonText: 'Close',
            customClass: {
                confirmButton: 'outbound-action-btn submit',
                cancelButton: 'outbound-action-btn cancel'
            }
        }).then((result) => {
            if (result.isConfirmed) {
                window.location.reload();
            }
        });
    }

    // renderTotalAmount(data) {
    //     if (!data) return '<span class="text-muted">N/A</span>';

    //     return `
    //         <div class="total-amount-wrapper" style="
    //             display: flex;
    //             align-items: center;
    //             justify-content: flex-end;
    //         ">
    //             <span class="total-amount" style="
    //                 font-weight: 500;
    //                 color: #1e40af;
    //                 font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
    //                 background: rgba(30, 64, 175, 0.1);
    //                 padding: 4px 8px;
    //                 border-radius: 4px;
    //                 display: inline-block;
    //                 letter-spacing: 0.5px;
    //                 white-space: nowrap;
    //                 transition: all 0.2s ease;
    //             ">
    //                 ${data}
    //             </span>
    //         </div>
    //     `;
    // }

    
  renderTotalAmount(data, type, row) {
    if (!data) return '<span class="text-muted">—</span>';

    // Debug: Log what data we're receiving from the backend
    // console.log('🔍 renderTotalAmount received data:', data, 'for file:', row.fileName);

    // Simply display the backend data as-is without any processing
    // The backend extractTotalAmount function already provides correctly formatted amounts
    const displayAmount = data;

    // Extract currency code from the formatted amount for color styling only
    let currency = "MYR"; // Default
    if (
      typeof displayAmount === "string" &&
      /^[A-Z]{3}\s/.test(displayAmount)
    ) {
      const parts = displayAmount.split(" ");
      currency = parts[0];
    }

    // Determine color based on currency (visual styling only)
    const currencyColors = {
      MYR: "#1e40af", // Blue for MYR (default)
    };
    const color = currencyColors[currency] || "#1e40af";

    return `
            <div class="total-amount-wrapper" style="
                display: flex;
                align-items: center;
                justify-content: flex-end;
            ">
                <span class="total-amount" style="
                    font-weight: 500;
                    color: ${color};
                    font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace;
                    background: ${color}15;
                    padding: 4px 8px;
                    border-radius: 4px;
                    display: inline-block;
                    letter-spacing: 0.5px;
                    white-space: nowrap;
                    transition: all 0.2s ease;
                " title="Currency: ${currency}">
                    ${displayAmount}
                </span>
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

        const docType = row.documentType || 'Invoice';
        const docTypeIcon = getDocTypeIcon(docType);
        const docTypeColor = getDocTypeColor(docType);

        return `
            <div class="invoice-info-wrapper" style="
                display: flex;
                flex-direction: column;
                gap: 4px;
                text-align: left;
                min-width: 200px;
            ">
                <div class="invoice-number" style="
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-weight: 500;
                    color: #2c3345;
                    width: 100%;
                ">
                    <i class="bi bi-hash text-primary"></i>
                    <span class="invoice-text"
                        title="${data}"
                        style="
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            max-width: calc(100% - 24px);
                        ">${data}</span>
                </div>

                <div class="file-info" style="
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 0.75rem;
                    color: #6c757d;
                    width: 100%;
                ">
                    <i class="bi bi-file-earmark-text-fill" style="
                        color: #198754;
                        font-size: 1rem;
                        flex-shrink: 0;
                    "></i>
                    <span title="${row.fileName}" style="
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    ">${row.fileName}</span>
                </div>

                <div class="document-type" style="
                    width: 100%;
                    margin-top: 2px;
                ">
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
                        white-space: nowrap;
                    ">
                        <i class="bi bi-${docTypeIcon}"></i>
                        ${docType}
                    </span>
                </div>
            </div>`;
    }

    renderCompanyInfo(data) {
        if (!data) return '<span class="text-muted">N/A</span>';
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


    renderSupplierInfo(data) {
        const supplierName = data?.name || data?.registrationName || data?.supplierName || data?.supplier?.name || data?.supplier?.registrationName;
        if (!supplierName) {
            return '<span class="text-muted">—</span>';
        }
        return `
            <div class="cell-group">
                <div class="cell-main ">
                    <i class="bi bi-person-badge me-1"></i>
                    <span title="${supplierName}">${supplierName}</span>
                </div>
                <div class="cell-sub">
                    <i class="bi bi-card-text me-1"></i>
                    <span class="reg-text">Company Name</span>
                </div>
            </div>`;
    }

    renderBuyerInfo(data) {
        const buyerName = data?.name || data?.registrationName || data?.buyerName || data?.buyer?.name || data?.buyer?.registrationName;
        if (!buyerName) {
            return '<span class="text-muted">—</span>';
        }
        return `
            <div class="cell-group">
                <div class="cell-main ">
                    <i class="bi bi-person-badge me-1"></i>
                    <span title="${buyerName}">${buyerName}</span>
                </div>
                <div class="cell-sub">
                    <i class="bi bi-card-text me-1"></i>
                    <span class="reg-text">Company Name</span>
                </div>
            </div>`;
    }

    renderDateInfo(issueDate, issueTime, submittedDate, date_cancelled, row) {
        const submittedFormatted = submittedDate ? this.formatDate(submittedDate) : null;
        const cancelledFormatted = date_cancelled ? this.formatDate(date_cancelled) : null;
        const showTimeRemaining = row.status === 'Submitted' && !cancelledFormatted;
        const timeRemaining = showTimeRemaining ? this.calculateRemainingTime(submittedDate) : null;

        return `
            <div class="date-info" style="width: 140px;">
                ${submittedFormatted ? `
                    <div class="date-row"
                         data-bs-toggle="tooltip"
                         data-bs-placement="top"
                         title="Date and time when document was submitted to LHDN">
                        <i class="bi bi-check-circle me-1 text-success"></i>
                        <span class="date-value">
                            <div>
                                <span class="text-success">Date Submitted:</span> ${submittedFormatted}
                            </div>
                        </span>
                    </div>
                ` : ''}
                ${cancelledFormatted ? `
                    <div class="date-row cancelled-info"
                         data-bs-toggle="tooltip"
                         data-bs-placement="top"
                         title="${row.cancellation_reason ? `Cancel Reason: ${row.cancellation_reason}` : ''}">
                        <i class="bi bi-x-circle me-1 text-warning"></i>
                        <span class="date-value">
                            <div>
                                <span class="text-warning">Date Cancelled:</span> ${cancelledFormatted}
                            </div>
                            <div>
                                <span class="text-secondary">By: </span> ${row.cancelled_by}
                            </div>
                        </span>
                    </div>
                ` : ''}
                ${showTimeRemaining && timeRemaining ? `
                    <div class="time-remaining"
                         data-bs-toggle="tooltip"
                         data-bs-placement="top"
                         title="Time remaining before the 72-hour cancellation window expires">
                        <i class="bi bi-clock${timeRemaining.hours < 24 ? '-fill' : ''} me-1"></i>
                        <span class="time-text">${timeRemaining.hours}h ${timeRemaining.minutes}m left</span>
                    </div>
                ` : row.status !== 'Submitted' || cancelledFormatted ? `
                    <div class="time-not-applicable"
                         data-bs-toggle="tooltip"
                         data-bs-placement="top"
                         title="Cancellation window not applicable for this document status">
                        <i class="bi bi-dash-circle me-1"></i>
                        <span class="text-muted">Not Applicable</span>
                    </div>
                ` : ''}
            </div>`;
    }

    renderUploadedDate(data) {
        const formattedDate = this.formatIssueDate(data);
        if (!data) return '<span class="text-muted fs-6">N/A</span>';
        return `<span class="cell-main w-2 text-left" title="${data}">${formattedDate}</span>`;
    }

    renderTimeRemaining(date, row) {
        if (!date || row.status === 'Cancelled' || row.status === 'Failed' || row.status === 'Rejected' || row.status === 'Invalid') {
            return `<span class="badge-cancellation not-applicable bg-gray-300 text-gray-700">
                <i class="bi bi-dash-circle"></i>
                Not Applicable
            </span>`;
        }

        const timeInfo = this.calculateRemainingTime(date);
        if (!timeInfo) {
            return `<span class="badge-cancellation expired">
                <i class="bi bi-x-circle"></i>
                Expired
            </span>`;
        }

        return `<span class="badge-cancellation ${timeInfo.badgeClass}">
            <i class="bi bi-clock${timeInfo.hours < 24 ? '-fill' : ''} me-1"></i>
            ${timeInfo.hours}h ${timeInfo.minutes}m left
        </span>`;
    }

    renderSource(data) {
        if (!data) return '<span class="text-muted">N/A</span>';
        return `<span class="badge-source ${data.toLowerCase()}">${data}</span>`;
    }

    renderFileName(data) {
        return data ? `
            <div class="outbound-file-name">
                <i class="fas fa-file-xml text-success"></i>
                <span class="outbound-file-name-text" title="${data}">${data}</span>
            </div>` : '<span class="text-muted">N/A</span>';
    }

    renderDocumentType(data) {
        return `<span class="badge-type documentType" data-bs-toggle="tooltip" title="${data}">${data}</span>`;
    }

    renderStatus(data) {
        const status = data || 'Pending';
        const statusClass = status.toLowerCase();
        const icons = {
            pending: 'hourglass-split',
            submitted: 'check-circle-fill',
            cancelled: 'x-circle-fill',
            rejected: 'x-circle-fill',
            processing: 'arrow-repeat',
            failed: 'exclamation-triangle-fill',
            invalid: 'exclamation-triangle-fill',
            valid: 'check-circle-fill'
        };
        const statusColors = {
            pending: '#ff8307',
            submitted: '#198754',
            cancelled: '#ffc107',
            rejected: '#dc3545',
            processing: '#0d6efd',
            failed: '#dc3545',
            invalid: '#dc3545',
            valid: '#198754'
        };
        const icon = icons[statusClass] || 'question-circle';
        const color = statusColors[statusClass];

        // Add spinning animation for processing status
        const spinClass = statusClass === 'processing' ? 'spin' : '';

        // Special handling for valid status
        if (statusClass === 'valid') {
            return `<span class="outbound-status ${statusClass}" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 6px; background: ${color}15; color: ${color}; font-weight: 500; transition: all 0.2s ease;">
                <i class="bi bi-${icon} ${spinClass}" style="font-size: 14px;"></i>Valid</span>`;
        }

        return `<span class="outbound-status ${statusClass}" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 6px; background: ${color}15; color: ${color}; font-weight: 500; transition: all 0.2s ease;">
            <i class="bi bi-${icon} ${spinClass}" style="font-size: 14px;"></i>${status}</span>`;
    }

    renderActions(row) {
        // Check if item is from archived table (staging) - hide submit and delete buttons
        if (row.fromStaging === true || row.dataSource === 'WP_OUTBOUND_STATUS') {
            return `
                <button
                    class="outbound-action-btn"
                    disabled
                    data-bs-toggle="tooltip"
                    data-bs-placement="top"
                    title="This item is from the archived database and cannot be modified">
                    <i class="bi bi-archive"></i>
                    Archived
                </button>`;
        }

        if (!row.status || row.status === 'Pending') {
            return `
                <div class="d-flex gap-2">
                    <button
                        class="outbound-action-btn submit"
                        onclick="submitToLHDN('${row.fileName}', '${row.source}', '${row.company}', '${row.uploadedDate}')"
                        data-id="${row.id}">
                        <i class="bi bi-cloud-upload"></i>
                        Submit
                    </button>
                    <button
                        class="outbound-action-btn cancel"
                        onclick="deleteDocument('${row.fileName}', '${row.source}', '${row.company}', '${row.uploadedDate}')"
                        data-id="${row.id}">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>`;
        }

        // Show cancel button for both Submitted and Valid status within 72 hours
        if (row.status === 'Submitted' || row.status === 'Valid') {
            const timeInfo = this.calculateRemainingTime(row.date_submitted);
            if (timeInfo && !timeInfo.expired) {
                return `
                    <button
                        class="outbound-action-btn cancel"
                        onclick="cancelDocument('${row.uuid}', '${row.fileName}', '${row.date_submitted}')"
                        data-id="${row.id}"
                        data-uuid="${row.uuid}">
                        <i class="bi bi-x-circle"></i>
                        Cancel
                    </button>`;
            }
        }

        if (row.status === 'Invalid') {
            return `
             <button
                class="outbound-action-btn"
                disabled
                data-bs-toggle="tooltip"
                data-bs-placement="top"
                title="${row.status === 'Failed' ? 'Please cancel this transaction and create the same transaction with a new Document No.' : row.status === 'Cancelled' ? 'LHDN Cancellation successfully processed' : 'LHDN Validation is finalized, Kindly check the Inbound Page status for more details'}">
                <i class="bi bi-check-circle"></i>
                ${row.status}
            </button>`;
        }

        return `
            <button
                class="outbound-action-btn"
                disabled
                data-bs-toggle="tooltip"
                data-bs-placement="top"
                title="${row.status === 'Failed' ? 'Please cancel this transaction and create the same transaction with a new Document No.' : row.status === 'Cancelled' ? 'LHDN Cancellation successfully processed' : 'LHDN Validation is finalized, Kindly check the Inbound Page status for more details'}">
                <i class="bi bi-check-circle"></i>
                ${row.status}
            </button>`;
    }

    calculateRemainingTime(submissionDate) {
        if (!submissionDate) return null;
        const submitted = new Date(submissionDate);
        const now = new Date();
        const deadline = new Date(submitted.getTime() + (72 * 60 * 60 * 1000));

        if (now >= deadline) return null;

        const remaining = deadline - now;
        const hours = Math.floor(remaining / (60 * 60 * 1000));
        const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

        let badgeClass = 'success';
        if (hours < 6) badgeClass = 'danger';
        else if (hours < 24) badgeClass = 'warning';

        return { hours, minutes, badgeClass, expired: false };
    }


    applyQuickFilter(filterValue) {
        if (!this.table) return;

        console.log('Applying quick filter:', filterValue);

        // Clear the global search
        const globalSearch = document.getElementById('globalSearch');
        if (globalSearch) globalSearch.value = '';

        // Handle staging filter differently
        if (filterValue === 'staging') {
            this.loadStagingData();
            return;
        }

        // Apply filter based on value - use column index 8 for STATUS column
        if (filterValue === 'all') {
            // Clear all filters to show all records
            this.table.column(8).search('').draw();
        } else {
            // Filter by specific status
            this.table.column(8).search(filterValue, false, false).draw();
        }

        console.log('Filter applied successfully');

        // Update active filter tags if the method exists
        if (typeof this.updateActiveFilterTags === 'function') {
            this.updateActiveFilterTags();
        }
    }


    formatDate(date) {
        if (!date) return '-';
        return new Date(date).toLocaleString('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    }

    formatIssueDate(date) {
        if (!date) return '-';
        return new Date(date).toLocaleString('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric',
        });
    }

    formatIssueTime(time) {
        if (!time) return null;

        try {
            // If time is in ISO format with Z (UTC)
            if (time.includes('Z')) {
                // Convert 24-hour format to 12-hour format
                const [hours, minutes] = time.split(':');
                const hour = parseInt(hours, 10);
                const ampm = hour >= 12 ? 'PM' : 'AM';
                const hour12 = hour % 12 || 12;

                // Format as "HH:MM AM/PM"
                return `${hour12.toString().padStart(2, '0')}:${minutes} ${ampm}`;
            }

            // For other time formats, try to parse and format consistently
            const [hours, minutes] = time.split(':');
            const hour = parseInt(hours, 10);
            const ampm = hour >= 12 ? 'PM' : 'AM';
            const hour12 = hour % 12 || 12;

            return `${hour12.toString().padStart(2, '0')}:${minutes} ${ampm}`;
        } catch (error) {
            console.error('Error formatting time:', error, {
                originalTime: time
            });
            // If parsing fails, return the original time
            return time;
        }
    }

    initializeSelectAll() {
        $(document).on('change', '#selectAll', (e) => {
            const isChecked = $(e.target).prop('checked');
            // Only select checkboxes that are not disabled (Pending status)
            $('.row-checkbox:not([disabled])').prop('checked', isChecked);
            this.updateExportButton();
        });

        $('#invoiceTable').on('change', '.row-checkbox', () => {
            // Count only checkboxes that are not disabled
            const totalCheckboxes = $('.row-checkbox:not([disabled])').length;
            const checkedCheckboxes = $('.row-checkbox:not([disabled]):checked').length;
            $('#selectAll').prop('checked', totalCheckboxes === checkedCheckboxes && totalCheckboxes > 0);
            this.updateExportButton();
        });
    }

    initializeTooltips() {
        const initTooltips = () => {
            // First dispose any existing tooltips
            const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
            tooltipTriggerList.forEach(element => {
                const tooltip = bootstrap.Tooltip.getInstance(element);
                if (tooltip) {
                    tooltip.hide();
                }
            });


            // Initialize new tooltips
            tooltipTriggerList.forEach(tooltipTriggerEl => {
                new bootstrap.Tooltip(tooltipTriggerEl, {
                    trigger: 'hover',
                    container: 'body'
                });
            });

        };

        // Reinitialize tooltips after table draw
        this.table.on('draw', () => {
            setTimeout(initTooltips, 100); // Small delay to ensure DOM is updated
        });
    }


    updateExportButton() {
        // Count checked checkboxes instead of using DataTables selection
        // Only count checkboxes that are not disabled (Pending status)
        const selectedRows = $('.row-checkbox:not([disabled]):checked').length;
        console.log('Selected rows by checkbox:', selectedRows);

        const exportBtn = $('#exportSelected');
        const consolidatedBtn = $('#submitConsolidated');

        exportBtn.prop('disabled', selectedRows === 0);
        consolidatedBtn.prop('disabled', selectedRows === 0);
        exportBtn.find('.selected-count').text(`(${selectedRows})`);
        consolidatedBtn.find('.selected-count-bulk').text(`(${selectedRows})`);
    }

    async exportSelectedRecords() {
        try {
            const selectedRows = [];
            // Only get rows with enabled checkboxes (Pending status)
            $('.row-checkbox:not([disabled]):checked').each((_, checkbox) => {
                const rowData = this.table.row($(checkbox).closest('tr')).data();
                selectedRows.push(rowData);
            });

            if (selectedRows.length === 0) {
                ToastManager.show('Please select at least one pending record to export', 'error');
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
                'File Name': row.fileName,
                Type: row.typeName,
                Company: row.company,
                Supplier: row.supplierName,
                Buyer: row.buyerName,
                'Issue Date': this.formatIssueDate(row.issueDate),
                'Issue Time': this.formatIssueTime(row.issueTime),
                'Submitted Date': row.submittedDate ? new Date(row.submittedDate).toLocaleString() : '',
                Status: row.status,
                'Total Amount': `RM ${parseFloat(row.totalAmount).toFixed(2)}`
            }));

            // Convert to CSV
            const csvContent = this.convertToCSV(exportData);

            // Create and trigger download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `outbound_invoices_${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(link);
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

    // Helper method to convert data to CSV
    convertToCSV(data) {
        if (data.length === 0) return '';

        const headers = Object.keys(data[0]);
        const csvRows = [];

        // Add headers
        csvRows.push(headers.join(','));

        // Add rows
        for (const row of data) {
            const values = headers.map(header => {
                const value = row[header] || '';
                // Escape quotes and wrap in quotes if contains comma or newline
                return `"${String(value).replace(/"/g, '""')}"`;
            });
            csvRows.push(values.join(','));
        }

        return csvRows.join('\n');
    }

    // Switch to staging data source
    async switchToStagingData() {
        try {
            console.log('🔄 Switching to staging data source...');

            // Set the switching flag to handle abort errors gracefully
            this.isDataSourceSwitching = true;

            // Auto-reset the flag after 10 seconds as a safety measure
            setTimeout(() => {
                if (this.isDataSourceSwitching) {
                    console.log('Auto-resetting data source switching flag');
                    this.isDataSourceSwitching = false;
                }
            }, 10000);

            // Cancel any existing request before switching
            if (this.listAllRequest && this.listAllRequest.readyState !== 4) {
                console.log('Cancelling existing list-all request before switching to staging');
                this.listAllRequest.abort();
            }

            this.currentDataSource = 'staging';

            // Show loading state
            this.showLoadingBackdrop('Loading Staging Data from Database (Auto-syncing with Inbound Status)');

            // Clear any existing data first to prevent mixing
            if (this.table) {
                this.table.clear().draw();
            }

            // Fetch staging data directly instead of using DataTable's ajax.load
            const response = await fetch('/api/outbound-files/staging-data', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const json = await response.json();
            console.log('📊 Staging data loaded:', json);
            console.log('📊 Number of records:', json?.files?.length || 0);

            if (!json.success) {
                throw new Error(json.error || 'Failed to load staging data');
            }

            // Process the staging data using the same logic as dataSrc
            const filesData = json.files || [];

            if (!filesData || filesData.length === 0) {
                this.showEmptyState('No archive staging data found');
                this.hideLoadingBackdrop();
                return;
            }

            // Process the files data - handle staging data format
            const processedData = filesData.map(file => ({
                ...file,
                DT_RowId: file.fileName,
                invoiceNumber: file.invoiceNumber || file.invoice_number || file.fileName.replace(/\.xml$/i, ''),
                fileName: file.fileName,
                documentType: file.documentType || file.document_type || 'Invoice',
                company: file.company,
                // Handle staging data supplier/buyer info
                buyerInfo: file.buyerInfo || { registrationName: file.buyerName || file.receiver || 'N/A' },
                supplierInfo: file.supplierInfo || { registrationName: file.supplierName || file.supplier || 'N/A' },
                // Keep original staging field names for the render functions
                supplierName: file.supplierName || file.supplier,
                buyerName: file.buyerName || file.receiver,
                supplier: file.supplier,
                receiver: file.receiver,
                uploadedDate: file.uploadedDate ? new Date(file.uploadedDate).toISOString() : new Date().toISOString(),
                issueDate: file.issueDate,
                issueTime: file.issueTime,
                date_submitted: file.submissionDate ? new Date(file.submissionDate).toISOString() : file.date_submitted,
                date_cancelled: file.date_cancelled ? new Date(file.date_cancelled).toISOString() : null,
                cancelled_by: file.cancelled_by || null,
                cancel_reason: file.cancel_reason || file.cancellation_reason || null,
                status: file.status || 'Pending',
                source: file.source,
                uuid: file.uuid || file.UUID || null,
                totalAmount: file.totalAmount || file.amount || null,
                // Staging metadata
                fromStaging: file.fromStaging || true,
                dataSource: file.dataSource || 'WP_OUTBOUND_STATUS'
            }));

            console.log('📊 Processed staging data:', processedData);

            // Clear the table and add the new data
            this.table.clear();
            this.table.rows.add(processedData);
            this.table.draw();

            // Clear any column filters when switching to staging
            this.table.columns().search('').draw();

            // Show sync status button when switching to staging data
            const syncStatusBtn = document.getElementById('syncStatusBtn');
            if (syncStatusBtn) {
                syncStatusBtn.style.display = 'block';
            }

            this.hideLoadingBackdrop();
            this.updateCardTotals();

        } catch (error) {
            console.error('Error switching to staging data:', error);
            this.hideLoadingBackdrop();
            this.showErrorMessage('Failed to load staging data: ' + error.message);
        }
    }

    // Switch back to list-all data source
    async switchToListAllData(filter = 'pending') {
        try {
            console.log('🔄 Switching to list-all data source...');

            // Set the switching flag to handle abort errors gracefully
            this.isDataSourceSwitching = true;

            // Auto-reset the flag after 10 seconds as a safety measure
            setTimeout(() => {
                if (this.isDataSourceSwitching) {
                    console.log('Auto-resetting data source switching flag');
                    this.isDataSourceSwitching = false;
                }
            }, 10000);

            // Cancel any existing request before switching
            if (this.listAllRequest && this.listAllRequest.readyState !== 4) {
                console.log('Cancelling existing list-all request before switching data source');
                this.listAllRequest.abort();
            }

            this.currentDataSource = 'live';

            // Show loading state
            this.showLoadingBackdrop('Loading Excel Files from Network');

            // Clear any existing data first to prevent mixing
            if (this.table) {
                this.table.clear().draw();
            }

            // Update the table's AJAX URL back to list-all endpoint and reload
            this.table.ajax.url('/api/outbound-files/list-all').load((json) => {
                console.log('📊 Live data loaded:', json);
                console.log('📊 Number of records:', json?.files?.length || 0);

                // Check if we have data
                if (!json || !json.files || json.files.length === 0) {
                    console.log('No live data available');
                    // Show empty state for live data - use jQuery to update the table container
                    $('#invoiceTable tbody').html(`
                        <tr>
                            <td colspan="10" class="text-center p-4">
                                <div class="empty-state-container">
                                    <div class="empty-state-icon mb-3">
                                        <i class="fas fa-file-excel fa-3x text-muted"></i>
                                    </div>
                                    <h5>No Documents Available</h5>
                                    <p class="text-muted">Upload an Excel file to start processing your invoices</p>
                                    <small class="text-muted">Supported formats: .xlsx, .xls</small>
                                </div>
                            </td>
                        </tr>
                    `);
                } else {
                    // Apply the appropriate filter
                    if (filter === 'all') {
                        this.table.column(8).search('').draw();
                    } else {
                        this.table.column(8).search('pending').draw();
                    }
                }


                // Hide sync status button when switching to live data
                const syncStatusBtn = document.getElementById('syncStatusBtn');
                if (syncStatusBtn) {
                    syncStatusBtn.style.display = 'none';
                }
                this.hideLoadingBackdrop();
                this.updateCardTotals();
            }, (xhr, error, thrown) => {
                console.error('❌ Error loading live data:', { xhr, error, thrown });
                this.hideLoadingBackdrop();
                this.showErrorMessage('Failed to load excel files: ' + error);
            });

        } catch (error) {
            console.error('Error switching to list-all data:', error);
            this.hideLoadingBackdrop();
            this.showErrorMessage('Failed to load excel files: ' + error.message);
        }
    }

    // Load staging data from WP_OUTBOUND_STATUS table (legacy method - kept for compatibility)
    async loadStagingData() {

        try {
            // Show loading state
            const loadingHtml = `
                <div class="text-center p-5">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading staging data...</span>
                    </div>
                    <p class="mt-3 text-muted">Loading staging database records...</p>
                </div>
            `;

            // Clear table and show loading
            this.table.clear().draw();
            $('#invoiceTable tbody').html(loadingHtml);

            const response = await fetch('/api/outbound-files/staging-data');
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to load staging data');
            }

            if (data.success && data.files) {
                // Clear loading and populate with staging data
                this.table.clear();
                this.table.rows.add(data.files).draw();

                // Update card totals for staging data
                this.updateCardTotalsForStaging(data.files);

                // Show success message
                ToastManager.show(`Loaded ${data.files.length} staging records`, 'success');
            } else {
                throw new Error('No staging data found');
            }

        } catch (error) {
            console.error('Error loading staging data:', error);
            ToastManager.show(`Failed to load staging data: ${error.message}`, 'error');

            // Show empty state
            this.table.clear().draw();
            $('#invoiceTable tbody').html(`
                <tr>
                    <td colspan="10" class="text-center p-4">
                        <div class="text-muted">
                            <i class="bi bi-database-x fs-1 mb-3 d-block"></i>
                            <h5>No Staging Data Available</h5>
                            <p>Unable to load staging database records.</p>
                        </div>
                    </td>
                </tr>
            `);
        }
    }

    // Update card totals for staging data
    updateCardTotalsForStaging(files) {
        const totals = {
            total: files.length,
            submitted: 0,
            invalid: 0,
            cancelled: 0,
            pending: 0
        };

        files.forEach(file => {
            switch (file.status?.toLowerCase()) {
                case 'submitted':
                case 'completed':
                    totals.submitted++;
                    break;
                case 'invalid':
                    totals.invalid++;
                    break;
                case 'cancelled':
                    totals.cancelled++;
                    break;
                default:
                    totals.pending++;
                    break;
            }
        });

        // Update card values
        this.animateNumber(document.querySelector('.total-invoice-count'), totals.total);
        this.animateNumber(document.querySelector('.total-submitted-count'), totals.submitted);
        this.animateNumber(document.querySelector('.total-invalid-count'), totals.invalid);
        this.animateNumber(document.querySelector('.total-cancelled-count'), totals.cancelled);
        this.animateNumber(document.querySelector('.total-queue-value'), totals.pending);
    }

    // Handle sync status functionality
    async handleSyncStatus() {
        try {
            // Show confirmation dialog
            const result = await Swal.fire({
                title: 'Sync Status Data',
                html: `
                    <div class="text-start">
                        <p>This will synchronize status data from inbound records to outbound records where UUIDs match.</p>
                        <div class="alert alert-info">
                            <i class="bi bi-info-circle me-2"></i>
                            <strong>What this does:</strong>
                            <ul class="mb-0 mt-2">
                                <li>Matches records by UUID</li>
                                <li>Updates status fields in outbound records</li>
                                <li>Syncs Valid, Invalid, Failed, and Cancelled statuses</li>
                                <li>Updates date_sync timestamp</li>
                            </ul>
                        </div>
                    </div>
                `,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: '<i class="bi bi-arrow-repeat"></i> Start Sync',
                cancelButtonText: 'Cancel',
                confirmButtonColor: '#0d6efd',
                customClass: {
                    popup: 'semi-minimal-popup'
                }
            });

            if (!result.isConfirmed) return;

            // Show loading backdrop
            this.showLoadingBackdrop('Synchronizing status data...');

            const response = await fetch('/api/outbound-files/sync-status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();
            this.hideLoadingBackdrop();

            if (data.success) {
                // Show success message with details
                await Swal.fire({
                    title: 'Status Sync Complete!',
                    html: `
                        <div class="text-start">
                            <p class="mb-3">Status synchronization completed successfully:</p>
                            <div class="sync-stats">
                                <div class="stat-item">
                                    <div class="stat-value text-success">${data.syncCount}</div>
                                    <div class="stat-label">Records Synchronized</div>
                                </div>
                                <div class="stat-item">
                                    <div class="stat-value text-primary">${data.totalProcessed}</div>
                                    <div class="stat-label">Total Processed</div>
                                </div>
                                ${data.errorCount > 0 ? `
                                    <div class="stat-item">
                                        <div class="stat-value text-warning">${data.errorCount}</div>
                                        <div class="stat-label">Errors</div>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                        <style>
                            .sync-stats {
                                display: flex;
                                justify-content: space-around;
                                margin: 1rem 0;
                            }
                            .sync-stats .stat-item {
                                text-align: center;
                            }
                            .sync-stats .stat-value {
                                font-size: 2rem;
                                font-weight: bold;
                                color: #495057;
                            }
                            .sync-stats .stat-label {
                                font-size: 0.875rem;
                                color: #6c757d;
                                margin-top: 0.25rem;
                            }
                        </style>
                    `,
                    icon: 'success',
                    confirmButtonText: 'OK',
                    customClass: {
                        confirmButton: 'btn btn-primary'
                    }
                });

                // Refresh the table to show updated data
                this.refresh(true);
            } else {
                // Show error message
                await Swal.fire({
                    title: 'Sync Failed',
                    text: data.message || 'Failed to sync status data',
                    icon: 'error',
                    confirmButtonText: 'OK',
                    customClass: {
                        confirmButton: 'btn btn-primary'
                    }
                });
            }

        } catch (error) {
            console.error('Error syncing status:', error);
            this.hideLoadingBackdrop();

            await Swal.fire({
                title: 'Sync Error',
                text: 'An error occurred while syncing status data. Please try again.',
                icon: 'error',
                confirmButtonText: 'OK',
                customClass: {
                    confirmButton: 'btn btn-primary'
                }
            });
        }
    }

    // Handle cleanup of old files
    async handleCleanupOldFiles() {
        try {
            const result = await Swal.fire({
                title: 'Cleanup Old Files',
                html: `
                    <div class="text-start">
                        <p class="mb-3">This will delete files older than 3 months from:</p>
                        <ul class="list-unstyled">
                            <li><i class="bi bi-folder text-warning me-2"></i>Network file system</li>
                            <li><i class="bi bi-database text-info me-2"></i>WP_OUTBOUND_STATUS table</li>
                        </ul>
                        <div class="alert alert-warning mt-3">
                            <i class="bi bi-exclamation-triangle me-2"></i>
                            <strong>Warning:</strong> This action cannot be undone.
                        </div>
                    </div>
                `,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Yes, cleanup old files',
                cancelButtonText: 'Cancel',
                confirmButtonColor: '#dc3545',
                customClass: {
                    popup: 'semi-minimal-popup'
                }
            });

            if (!result.isConfirmed) return;

            // Show loading
            Swal.fire({
                title: 'Cleaning up old files...',
                text: 'Please wait while we remove old files',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            const response = await fetch('/api/outbound-files/cleanup-old', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Cleanup failed');
            }

            // Show success result
            await Swal.fire({
                title: 'Cleanup Complete',
                html: `
                    <div class="text-start">
                        <p class="mb-3">Successfully cleaned up old files:</p>
                        <ul class="list-unstyled">
                            <li><i class="bi bi-file-earmark-x text-danger me-2"></i>${data.filesDeleted || 0} files deleted</li>
                            <li><i class="bi bi-database-dash text-info me-2"></i>${data.recordsDeleted || 0} database records removed</li>
                        </ul>
                        ${data.errors && data.errors.length > 0 ? `
                            <div class="alert alert-warning mt-3">
                                <strong>Some errors occurred:</strong>
                                <ul class="mb-0 mt-2">
                                    ${data.errors.map(error => `<li>${error}</li>`).join('')}
                                </ul>
                            </div>
                        ` : ''}
                    </div>
                `,
                icon: 'success',
                confirmButtonText: 'OK'
            });

            // Refresh the current view
            this.loadFiles();

        } catch (error) {
            console.error('Cleanup error:', error);
            Swal.fire({
                title: 'Cleanup Failed',
                text: error.message,
                icon: 'error',
                confirmButtonText: 'OK'
            });
        }
    }

    updateCardTotals() {
        const totals = {
            total: 0,
            submitted: 0,
            invalid: 0,
            cancelled: 0,
            pending: 0
        };

        // Calculate totals from table data
        this.table.rows().every((rowIdx) => {
            const data = this.table.row(rowIdx).data();
            totals.total++;

            switch (data.status?.toLowerCase()) {
                case 'submitted':
                    totals.submitted++;
                    break;
                case 'invalid':
                    totals.invalid++;
                    break;
                case 'cancelled':
                    totals.cancelled++;
                    break;
                case 'pending':
                    totals.pending++;
                    break;
                default:
                    totals.pending++;
                    break;
            }
        });

        // Hide all loading spinners and show counts
        document.querySelectorAll('.loading-spinner').forEach(spinner => {
            spinner.style.display = 'none';
        });
        document.querySelectorAll('.count-info h6').forEach(count => {
            count.style.display = 'block';
        });

        // Update card values with animation
        this.animateNumber(document.querySelector('.total-invoice-count'), totals.total);
        this.animateNumber(document.querySelector('.total-submitted-count'), totals.submitted);
        this.animateNumber(document.querySelector('.total-invalid-count'), totals.invalid);
        this.animateNumber(document.querySelector('.total-cancelled-count'), totals.cancelled);
        this.animateNumber(document.querySelector('.total-queue-value'), totals.pending);

        // Calculate percentages for validation rate
        const totalForValidation = totals.submitted + totals.invalid + totals.pending;
        const submittedPercentage = totalForValidation > 0 ? (totals.submitted / totalForValidation * 100) : 0;
        const invalidPercentage = totalForValidation > 0 ? (totals.invalid / totalForValidation * 100) : 0;
        const pendingPercentage = totalForValidation > 0 ? (totals.pending / totalForValidation * 100) : 0;

        // Update validation rate display
        const validationRateElement = document.querySelector('.success-rate');
        if (validationRateElement) {
            validationRateElement.textContent = `${Math.round(submittedPercentage)}%`;
            validationRateElement.setAttribute('data-bs-original-title',
                `<div class='p-2'>
                    <strong>Current Success Rate:</strong> ${Math.round(submittedPercentage)}%<br>
                    <small>Based on ${totals.submitted} successfully submitted documents out of ${totalForValidation} total submissions</small>
                </div>`
            );
        }

        // Update main progress bar
        const mainProgressBar = document.querySelector('.validation-stats .progress-bar');
        if (mainProgressBar) {
            mainProgressBar.style.width = `${submittedPercentage}%`;
            mainProgressBar.setAttribute('aria-valuenow', submittedPercentage);
        }

        // Update breakdown progress bars and percentages
        // Submitted
        const submittedBar = document.querySelector('.breakdown-item:nth-child(1) .progress-bar');
        const submittedPercentText = document.querySelector('.breakdown-item:nth-child(1) .text-success');
        if (submittedBar && submittedPercentText) {
            submittedBar.style.width = `${submittedPercentage}%`;
            submittedBar.setAttribute('aria-valuenow', submittedPercentage);
            submittedPercentText.textContent = `${Math.round(submittedPercentage)}%`;
        }

        // Invalid
        const invalidBar = document.querySelector('.breakdown-item:nth-child(2) .progress-bar');
        const invalidPercentText = document.querySelector('.breakdown-item:nth-child(2) .text-danger');
        if (invalidBar && invalidPercentText) {
            invalidBar.style.width = `${invalidPercentage}%`;
            invalidBar.setAttribute('aria-valuenow', invalidPercentage);
            invalidPercentText.textContent = `${Math.round(invalidPercentage)}%`;
        }

        // Pending
        const pendingBar = document.querySelector('.breakdown-item:nth-child(3) .progress-bar');
        const pendingPercentText = document.querySelector('.breakdown-item:nth-child(3) .text-warning');
        if (pendingBar && pendingPercentText) {
            pendingBar.style.width = `${pendingPercentage}%`;
            pendingBar.setAttribute('aria-valuenow', pendingPercentage);
            pendingPercentText.textContent = `${Math.round(pendingPercentage)}%`;
        }

        // Update tooltips
        const submittedTooltip = document.querySelector('.breakdown-item:nth-child(1) .bi-info-circle-fill');
        if (submittedTooltip) {
            submittedTooltip.setAttribute('data-bs-original-title',
                `<div class='p-2'>
                    <strong>Submitted Documents:</strong><br>
                    • ${totals.submitted} documents submitted successfully<br>
                    • ${Math.round(submittedPercentage)}% of total submissions<br>
                    • Ready for processing
                </div>`
            );
        }

        const invalidTooltip = document.querySelector('.breakdown-item:nth-child(2) .bi-info-circle-fill');
        if (invalidTooltip) {
            invalidTooltip.setAttribute('data-bs-original-title',
                `<div class='p-2'>
                    <strong>Invalid Documents:</strong><br>
                    • ${totals.invalid} documents failed validation<br>
                    • ${Math.round(invalidPercentage)}% of total submissions<br>
                    • Requires correction and resubmission
                </div>`
            );
        }

        const pendingTooltip = document.querySelector('.breakdown-item:nth-child(3) .bi-info-circle-fill');
        if (pendingTooltip) {
            pendingTooltip.setAttribute('data-bs-original-title',
                `<div class='p-2'>
                    <strong>Pending Documents:</strong><br>
                    • ${totals.pending} documents in queue<br>
                    • ${Math.round(pendingPercentage)}% of total submissions<br>
                    • Awaiting validation
                </div>`
            );
        }

        // Update statistics charts
        this.updateStatisticsCharts(totals);
    }

    // Helper method to animate number changes
    animateNumber(element, targetValue) {
        const startValue = parseInt(element.textContent) || 0;
        const duration = 1000; // Animation duration in milliseconds
        const steps = 60; // Number of steps in animation
        const stepValue = (targetValue - startValue) / steps;
        let currentStep = 0;

        const animate = () => {
            currentStep++;
            const currentValue = Math.round(startValue + (stepValue * currentStep));
            element.textContent = currentValue;

            if (currentStep < steps) {
                requestAnimationFrame(animate);
            } else {
                element.textContent = targetValue; // Ensure final value is exact
            }
        };

        requestAnimationFrame(animate);
    }

    // Helper method to update circular progress
    updateProgress(element, percentage) {
        const radius = 40; // Should match your SVG circle radius
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (percentage / 100) * circumference;

        const progressCircle = element.querySelector('.progress-circle');
        if (progressCircle) {
            progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
            progressCircle.style.strokeDashoffset = offset;
        }

        // Update percentage text if it exists
        const percentageText = element.querySelector('.progress-percentage');
        if (percentageText) {
            percentageText.textContent = `${Math.round(percentage)}%`;
        }
    }

    // Helper method to update card colors
    updateCardColors(totals) {
        const cards = {
            'total-invoice': {
                element: '.total-invoice-card',
                value: totals.total,

            },
            'total-submitted': {
                element: '.total-submitted-card',
                value: totals.submitted,

            },
            'total-rejected': {
                element: '.total-rejected-card',
                value: totals.rejected,

            },
            'total-invalid': {
                element: '.total-invalid-card',
                value: totals.invalid,

            },
            'total-cancelled': {
                element: '.total-cancelled-card',
                value: totals.cancelled,

            },
            'total-pending': {
                element: '.total-pending-card',
                value: totals.pending,

            }
        };

        Object.values(cards).forEach(card => {
            const element = document.querySelector(card.element);
            if (element) {
                const intensity = card.value > 0 ? 1 : 0.7;
                element.style.background = `linear-gradient(135deg, ${card.colors[0]} 0%, ${card.colors[1]} 100%)`;
                element.style.opacity = intensity;
            }
        });
    }

    initializeFeatures() {
        console.log('Initializing features');
        this.initializeTableStyles();
        this.initializeTooltips();
        this.initializeSelectAll();
        this.initializeFilters(); // Add filter initialization
        this.initializeTINValidation(); // Add TIN validation initialization
    }

    // Initialize filters and search functionality
    initializeFilters() {
        console.log('Initializing filters and search');

        // Global Search functionality
        const globalSearch = document.getElementById('globalSearch');
        if (globalSearch) {
            globalSearch.addEventListener('input', (e) => {
                if (this.table) {
                    this.table.search(e.target.value).draw();
                }
            });
            console.log('Global search initialized');
        } else {
            console.warn('Global search element not found');
        }

        // Quick Filter buttons
        document.querySelectorAll('.quick-filters .btn[data-filter]').forEach(button => {
            button.addEventListener('click', (e) => {
                // Remove active class from all buttons
                document.querySelectorAll('.quick-filters .btn').forEach(btn => btn.classList.remove('active'));
                // Add active class to clicked button
                e.target.closest('.btn').classList.add('active');

                const filterValue = e.target.closest('.btn').dataset.filter;
                this.applyQuickFilter(filterValue);
            });
        });

        // Hide cleanup button (as requested)
        const cleanupButton = document.getElementById('cleanupOldFiles');
        if (cleanupButton) {
            cleanupButton.style.display = 'none';
            console.log('Cleanup button hidden');
        }

        console.log('Filters initialized');
    }

    // New method to initialize TIN validation
    initializeTINValidation() {
        console.log('Initializing TIN validation functionality');

        // Get form elements
        const validationForm = document.getElementById('tinValidationForm');
        const tinInput = document.getElementById('tinNumber');
        const idTypeInput = document.getElementById('idType');
        const idValueInput = document.getElementById('idValue');
        const validateButton = document.getElementById('validateSingleTin');
        const clearHistoryButton = document.getElementById('clearHistory');
        const historyContainer = document.getElementById('validationHistory');

        // Check if elements exist
        if (!tinInput || !idTypeInput || !idValueInput || !validateButton) {
            console.warn('TIN validation elements not found in the DOM');
            return;
        }

        // Initialize tooltips
        const tooltips = document.querySelectorAll('[data-bs-toggle="tooltip"]');
        tooltips.forEach(tooltip => {
            new bootstrap.Tooltip(tooltip, {
                html: true,
                placement: 'auto'
            });
        });

        // Initialize validation history
        this.initValidationHistory();

        // Add validation form submit handler
        if (validationForm && validateButton) {
            validateButton.addEventListener('click', async (e) => {
                e.preventDefault();

                // Validate form inputs
                if (!this.validateForm(validationForm)) {
                    return;
                }

                // Perform validation
                await this.validateTIN(tinInput, idTypeInput, idValueInput);
            });
        }

        // Event listener for Enter key in the inputs
        [tinInput, idTypeInput, idValueInput].forEach(input => {
            input.addEventListener('keypress', async (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (validationForm && this.validateForm(validationForm)) {
                        await this.validateTIN(tinInput, idTypeInput, idValueInput);
                    }
                }
            });
        });

        // Clear history button
        if (clearHistoryButton) {
            clearHistoryButton.addEventListener('click', () => {
                this.clearValidationHistory();
            });
        }

        // Add ID type guidance
        if (idTypeInput) {
            idTypeInput.addEventListener('change', () => {
                this.showIdTypeGuidance(idTypeInput.value);
            });
        }

        // Initialize modal behavior
        const tinValidationModal = document.getElementById('tinValidationModal');
        if (tinValidationModal) {
            tinValidationModal.addEventListener('hidden.bs.modal', () => {
                // Reset form on modal close
                if (validationForm) {
                    validationForm.reset();
                    validationForm.classList.remove('was-validated');
                }

                // Reset result section
                const resultContent = document.getElementById('validationResultContent');
                const emptyState = document.getElementById('emptyResultState');

                if (resultContent && emptyState) {
                    resultContent.classList.add('d-none');
                    emptyState.classList.remove('d-none');
                }

                // Hide guidance
                const guidanceSection = document.getElementById('idTypeGuidance');
                if (guidanceSection) {
                    guidanceSection.classList.add('d-none');
                }

                // Clear search input
                const searchInput = document.getElementById('historySearchInput');
                if (searchInput) {
                    searchInput.value = '';
                }
            });
        }

        // Add event listeners to validate TIN buttons in table rows
        this.addTableTinValidationListeners();

        // Add handleSyncStatus
        const syncStatusBtn = document.getElementById('syncStatusBtn');
        if (syncStatusBtn) {
            syncStatusBtn.addEventListener('click', () => this.handleSyncStatus());
        }
    }

    // Validate form using Bootstrap's validation
    validateForm(form) {
        form.classList.add('was-validated');
        return form.checkValidity();
    }

    // Show ID type guidance
    showIdTypeGuidance(idType) {
        const guidanceSection = document.getElementById('idTypeGuidance');
        const guidanceContent = document.getElementById('guidanceContent');

        if (!guidanceSection || !guidanceContent) return;

        let content = '';

        switch(idType) {
            case 'NRIC':
                content = `
                    <p class="mb-1 small">Malaysian NRIC format: <strong>YYMMDD-PP-NNNN</strong></p>
                    <ul class="mb-0 small ps-3">
                        <li>12 digits total</li>
                        <li>First 6 digits: birthdate (YYMMDD)</li>
                        <li>Middle 2 digits: place of birth code</li>
                        <li>Last 4 digits: random numbers</li>
                    </ul>
                `;
                break;

            case 'PASSPORT':
                content = `
                    <p class="mb-1 small">Passport format varies by country:</p>
                    <ul class="mb-0 small ps-3">
                        <li>Malaysian passport: 9 characters (1 letter + 8 digits)</li>
                        <li>Include letters and numbers exactly as shown on passport</li>
                        <li>Do not include spaces or special characters</li>
                    </ul>
                `;
                break;

            case 'BRN':
                content = `
                    <p class="mb-1 small">Business Registration Number format:</p>
                    <ul class="mb-0 small ps-3">
                        <li>Usually 12 digits</li>
                        <li>Format: YYYYNNNNNNNNN</li>
                        <li>First 4 digits typically represent registration year</li>
                    </ul>
                `;
                break;

            case 'ARMY':
                content = `
                    <p class="mb-1 small">Army Number format:</p>
                    <ul class="mb-0 small ps-3">
                        <li>Format varies by military branch</li>
                        <li>Enter the full number as shown on military ID</li>
                    </ul>
                `;
                break;

            default:
                content = '';
        }

        if (content) {
            guidanceContent.innerHTML = content;
            guidanceSection.classList.remove('d-none');
        } else {
            guidanceSection.classList.add('d-none');
        }
    }

    // Add TIN validation listeners to table buttons
    addTableTinValidationListeners() {
        // Use event delegation since table rows may be dynamically added
        $(document).on('click', '[data-validate-tin]', async (e) => {
            const button = e.currentTarget;
            const row = button.closest('tr');

            if (row) {
                const tin = row.dataset.tin;
                const idType = row.dataset.idType;
                const idValue = row.dataset.idValue;

                if (tin && idType && idValue) {
                    try {
                        button.disabled = true;
                        button.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Validating';

                        const result = await this.callValidateAPI(tin, idType, idValue);

                        // Show validation result
                        this.showValidationResultModal(result, tin, idType, idValue);

                        // Add to history
                        this.addToValidationHistory(tin, idType, idValue, result.isValid);

                    } catch (error) {
                        this.showErrorMessage(`TIN validation failed: ${error.message}`);
                    } finally {
                        button.disabled = false;
                        button.innerHTML = '<i class="bi bi-shield-check"></i> Validate TIN';
                    }
                } else {
                    this.showErrorMessage('Missing TIN information. Please ensure TIN, ID Type, and ID Value are available.');
                }
            }
        });
    }

    // Validate TIN using the UI form
    async validateTIN(tinInput, idTypeInput, idValueInput) {
        // Get input values
        const tin = tinInput.value.trim();
        const idType = idTypeInput.value;
        const idValue = idValueInput.value.trim();

        // Check for recent validations to prevent spam
        const isDuplicate = this.checkRecentValidation(tin, idType, idValue);
        if (isDuplicate) {
            // Show warning message about duplicate validation
            this.showWarningMessage("This TIN and ID combination was recently validated. Please wait before validating again.");
            return;
        }

        // Show loading state
        const validateButton = document.getElementById('validateSingleTin');
        const originalContent = validateButton.innerHTML;
        validateButton.disabled = true;
        validateButton.innerHTML = '<i class="bi bi-arrow-repeat spin me-1"></i> Validating...';

        try {
            // Add to recent validations with timestamp to track cooldown
            this.addToRecentValidations(tin, idType, idValue);

            // Call API
            const result = await this.callValidateAPI(tin, idType, idValue);

            // Show validation result in the modal
            this.showValidationResultInModal(result, tin, idType, idValue);

            // Add to history
            this.addToValidationHistory(tin, idType, idValue, result.isValid);

            // Clear form on success
            if (result.isValid) {
                // Don't clear the form immediately to allow user to see the result
                // The form will be reset when the modal is closed
            }

        } catch (error) {
            this.showErrorMessage(`TIN validation failed: ${error.message}`);
        } finally {
            // Restore button state
            validateButton.disabled = false;
            validateButton.innerHTML = originalContent;
        }
    }

    // Check if this TIN+ID combination was recently validated (anti-spam)
    checkRecentValidation(tin, idType, idValue) {
        try {
            // Get stored recent validations
            const recentValidations = localStorage.getItem('recent_validations');
            if (!recentValidations) return false;

            const validations = JSON.parse(recentValidations);

            // Create a unique key for this validation
            const validationKey = `${tin}-${idType}-${idValue}`.toLowerCase();

            // Check if this combination was validated recently (within the last 30 seconds)
            const now = Date.now();
            const recentValidation = validations.find(v =>
                v.key === validationKey &&
                (now - v.timestamp) < 30000 // 30 seconds cooldown
            );

            return !!recentValidation;
        } catch (e) {
            console.error('Error checking recent validations:', e);
            return false;
        }
    }

    // Add TIN to recent validations to prevent spam
    addToRecentValidations(tin, idType, idValue) {
        try {
            // Get stored recent validations
            let validations = [];
            const stored = localStorage.getItem('recent_validations');
            if (stored) {
                validations = JSON.parse(stored);
            }

            // Create a unique key for this validation
            const validationKey = `${tin}-${idType}-${idValue}`.toLowerCase();

            // Add this validation
            validations.push({
                key: validationKey,
                timestamp: Date.now()
            });

            // Keep only validations from the last 5 minutes
            const now = Date.now();
            validations = validations.filter(v => (now - v.timestamp) < 300000); // 5 minutes

            // Store updated list
            localStorage.setItem('recent_validations', JSON.stringify(validations));
        } catch (e) {
            console.error('Error updating recent validations:', e);
        }
    }

    // Show warning message
    showWarningMessage(message) {
        Swal.fire({
            icon: 'warning',
            title: 'Validation Limit',
            text: message,
            timer: 3000,
            timerProgressBar: true
        });
    }

    // Show validation result in the modal
    showValidationResultInModal(result, tin, idType, idValue) {
        const resultSection = document.getElementById('validationResultSection');
        const resultContent = document.getElementById('validationResultContent');
        const emptyState = document.getElementById('emptyResultState');

        if (!resultSection || !resultContent || !emptyState) {
            console.error('Validation result elements not found');
            return;
        }

        // Create result content
        let resultHtml = '';

        if (result.isValid) {
            resultHtml = `
                <div class="text-center mb-4">
                    <div class="validation-status-badge">
                        <span class="badge rounded-circle bg-success p-3">
                            <i class="bi bi-check-circle-fill"></i>
                        </span>
                    </div>
                    <h4 class="mt-3 text-success">Valid TIN</h4>
                    <p class="text-success mt-2 small">This TIN is validated and ready to use in your invoices</p>
                </div>

                <div class="card mb-4 border-0 shadow-sm">
                    <div class="card-header d-flex align-items-center">
                        <i class="bi bi-info-circle text-primary me-2"></i>
                        <strong>Validation Details</strong>
                    </div>
                    <ul class="list-group list-group-flush">
                        <li class="list-group-item">
                            <div class="row align-items-center">
                                <div class="col-4 text-muted">TIN:</div>
                                <div class="col-8 fw-medium">${tin}</div>
                            </div>
                        </li>
                        <li class="list-group-item">
                            <div class="row align-items-center">
                                <div class="col-4 text-muted">ID Type:</div>
                                <div class="col-8 fw-medium">${idType}</div>
                            </div>
                        </li>
                        <li class="list-group-item">
                            <div class="row align-items-center">
                                <div class="col-4 text-muted">ID Value:</div>
                                <div class="col-8 fw-medium">${idValue}</div>
                            </div>
                        </li>
                        ${result.timestamp ? `
                        <li class="list-group-item">
                            <div class="row align-items-center">
                                <div class="col-4 text-muted">Validated at:</div>
                                <div class="col-8">${new Date(result.timestamp).toLocaleString()}</div>
                            </div>
                        </li>
                        ` : ''}
                        ${result.cached ? `
                        <li class="list-group-item">
                            <div class="row align-items-center">
                                <div class="col-4 text-muted">Source:</div>
                                <div class="col-8"><span class="badge bg-secondary">Cached result</span></div>
                            </div>
                        </li>
                        ` : ''}
                    </ul>
                </div>

            `;
        } else {
            resultHtml = `
                <div class="text-center mb-4">
                    <div class="validation-status-badge">
                        <span class="badge rounded-circle bg-danger p-3">
                            <i class="bi bi-x-circle-fill"></i>
                        </span>
                    </div>
                    <h4 class="mt-3 text-danger">Invalid TIN</h4>
                    <p class="text-muted">${result.message || 'The TIN and ID combination is invalid.'}</p>
                </div>

                <div class="card mb-4 border-0 shadow-sm">
                    <div class="card-header d-flex align-items-center">
                        <i class="bi bi-info-circle text-primary me-2"></i>
                        <strong>Validation Details</strong>
                    </div>
                    <ul class="list-group list-group-flush">
                        <li class="list-group-item">
                            <div class="row align-items-center">
                                <div class="col-4 text-muted">TIN:</div>
                                <div class="col-8 fw-medium">${tin}</div>
                            </div>
                        </li>
                        <li class="list-group-item">
                            <div class="row align-items-center">
                                <div class="col-4 text-muted">ID Type:</div>
                                <div class="col-8 fw-medium">${idType}</div>
                            </div>
                        </li>
                        <li class="list-group-item">
                            <div class="row align-items-center">
                                <div class="col-4 text-muted">ID Value:</div>
                                <div class="col-8 fw-medium">${idValue}</div>
                            </div>
                        </li>
                    </ul>
                </div>

                <div class="alert alert-danger border-0 shadow-sm mb-0">
                    <div class="d-flex">
                        <div class="flex-shrink-0">
                            <i class="bi bi-exclamation-triangle-fill"></i>
                        </div>
                        <div class="flex-grow-1 ms-2">
                            <p class="mb-0">Please verify that the information is correct and try again.</p>
                            <small>If you continue to receive this error, contact LHDN for assistance.</small>
                        </div>
                    </div>
                </div>
            `;
        }

        // Set content and show result section
        resultContent.innerHTML = resultHtml;

        // Hide empty state, show result content
        emptyState.classList.add('d-none');
        resultContent.classList.remove('d-none');
    }

    // Call the validate API
    async callValidateAPI(tin, idType, idValue) {
        try {
            // Generate request ID for tracking
            const requestId = Math.random().toString(36).substring(2, 15);

            // Get current date in ISO format for X-Date header
            const currentDate = new Date().toISOString();

            // Build standard LHDN headers according to SDK specification
            const headers = {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Request-ID': requestId,
                'X-Date': currentDate,
                'X-Client-ID': 'eInvoice-WebApp',
                'X-User-Agent': navigator.userAgent || '',
                'X-Channel': 'Web'
            };

            // Call the backend API endpoint - Update to the correct route path
            const response = await fetch(`/api/lhdn/taxpayer/validate/${tin}?idType=${idType}&idValue=${idValue}`, {
                method: 'GET',
                headers: headers,
                credentials: 'same-origin' // Include cookies for session authentication
            });

            // Check if response is JSON
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                if (response.status === 401) {
                    return {
                        isValid: false,
                        message: 'Authentication error. Please log in again.'
                    };
                } else {
                    throw new Error('Unexpected server response. Please try again later.');
                }
            }

            const data = await response.json();

            // Handle different response status codes
            if (!response.ok) {
                if (response.status === 404) {
                    return {
                        isValid: false,
                        message: 'Invalid TIN or ID combination'
                    };
                } else if (response.status === 400) {
                    return {
                        isValid: false,
                        message: 'Invalid input parameters'
                    };
                } else if (response.status === 429) {
                    return {
                        isValid: false,
                        message: 'Too many validation requests. Please try again later.'
                    };
                } else {
                    throw new Error(data.message || 'TIN validation failed');
                }
            }

            // Handle successful response
            if (data.success && data.result) {
                return {
                    isValid: data.result.isValid,
                    message: 'TIN validation successful',
                    timestamp: data.result.timestamp,
                    cached: data.cached || false,
                    requestId: requestId
                };
            } else {
                throw new Error('Invalid response format');
            }
        } catch (error) {
            console.error('TIN validation error:', error);
            return {
                isValid: false,
                message: error.message || 'Error validating TIN. Please try again later.'
            };
        }
    }

    // Show validation result in modal
    showValidationResultModal(result, tin, idType, idValue) {
        const modal = document.getElementById('validationResultsModal');
        const modalBody = document.getElementById('validationResults');

        if (!modal || !modalBody) {
            console.error('Validation result modal elements not found');
            return;
        }

        // Create result content
        let resultHtml = '';
        if (result.isValid) {
            resultHtml = `
                <div class="validation-result success">
                    <i class="bi bi-check-circle-fill"></i>
                    <div class="result-details">
                        <h6>Valid TIN</h6>
                        <p>The TIN and ID combination is valid.</p>
                        <div class="d-flex flex-column">
                            <small><strong>TIN:</strong> ${tin}</small>
                            <small><strong>ID Type:</strong> ${idType}</small>
                            <small><strong>ID Value:</strong> ${idValue}</small>
                            ${result.timestamp ? `<small><strong>Validated at:</strong> ${new Date(result.timestamp).toLocaleString()}</small>` : ''}
                            ${result.cached ? '<small><em>(Result from cache)</em></small>' : ''}
                        </div>
                    </div>
                </div>
            `;
        } else {
            resultHtml = `
                <div class="validation-result error">
                    <i class="bi bi-x-circle-fill"></i>
                    <div class="result-details">
                        <h6>Invalid TIN</h6>
                        <p>${result.message || 'The TIN and ID combination is invalid.'}</p>
                        <div class="d-flex flex-column">
                            <small><strong>TIN:</strong> ${tin}</small>
                            <small><strong>ID Type:</strong> ${idType}</small>
                            <small><strong>ID Value:</strong> ${idValue}</small>
                        </div>
                        <div class="error-details mt-2">
                            <p>Please verify that the information is correct and try again.</p>
                        </div>
                    </div>
                </div>
            `;
        }

        // Add summary stats
        resultHtml += `
            <div class="summary-stats mt-3">
                <div class="stat-item ${result.isValid ? 'success' : 'error'}">
                    <i class="bi bi-${result.isValid ? 'check-circle' : 'x-circle'}-fill"></i>
                    <div>
                        <strong>Validation Status</strong>
                        <div>${result.isValid ? 'Valid' : 'Invalid'}</div>
                    </div>
                </div>
            </div>
        `;

        // Set modal content
        modalBody.innerHTML = resultHtml;

        // Show modal
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();
    }

    // Initialize validation history from localStorage
    initValidationHistory() {
        const historyContainer = document.getElementById('validationHistory');
        const searchInput = document.getElementById('historySearchInput');

        if (!historyContainer) return;

        // Initialize session counter for validations
        this.initValidationSessionCounter();

        const history = this.getValidationHistory();
        if (history.length === 0) {
            historyContainer.innerHTML = `
                <div class="text-center text-muted py-2">
                    <i class="bi bi-shield-check mb-1 d-block" style="font-size: 1.2rem;"></i>
                    <small>No validation history yet</small>
                </div>
            `;
            return;
        }

        // Render history items
        this.renderValidationHistory(history);

        // Add search functionality
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const searchTerm = searchInput.value.trim().toLowerCase();
                if (searchTerm === '') {
                    // If search is cleared, show all history
                    this.renderValidationHistory(history);
                } else {
                    // Filter history based on search term
                    const filteredHistory = history.filter(item =>
                        item.tin.toLowerCase().includes(searchTerm) ||
                        item.idValue.toLowerCase().includes(searchTerm) ||
                        item.idType.toLowerCase().includes(searchTerm)
                    );
                    this.renderValidationHistory(filteredHistory, searchTerm);
                }
            });

            // Clear search when modal is hidden
            const modal = document.getElementById('tinValidationModal');
            if (modal) {
                modal.addEventListener('hidden.bs.modal', () => {
                    searchInput.value = '';
                });
            }
        }
    }

    // Render validation history items
    renderValidationHistory(history, searchTerm = '') {
        const historyContainer = document.getElementById('validationHistory');
        if (!historyContainer) return;

        historyContainer.innerHTML = '';

        if (history.length === 0) {
            historyContainer.innerHTML = `
                <div class="text-center text-muted py-2">
                    ${searchTerm ?
                    `<i class="bi bi-search mb-1 d-block" style="font-size: 1.2rem;"></i>
                    <small>No matching results found</small>` :
                    `<i class="bi bi-shield-check mb-1 d-block" style="font-size: 1.2rem;"></i>
                    <small>No validation history yet</small>`}
                </div>
            `;
            return;
        }

        // Show the items (limit to most recent 10)
        history.slice(0, 10).forEach(item => {
            // Check if this item is on cooldown
            const onCooldown = this.isOnCooldown(item.tin, item.idType, item.idValue);

            const historyItem = document.createElement('div');
            historyItem.className = 'history-item' + (onCooldown ? ' on-cooldown' : '');
            historyItem.setAttribute('data-tin', item.tin);
            historyItem.setAttribute('data-id-type', item.idType);
            historyItem.setAttribute('data-id-value', item.idValue);
            historyItem.setAttribute('data-valid', item.isValid);

            // Create a tooltip with time information
            const timestamp = new Date(item.timestamp);
            const timeStr = timestamp.toLocaleTimeString();
            const dateStr = timestamp.toLocaleDateString();

            historyItem.setAttribute('title', `Validated on ${dateStr} at ${timeStr}`);

            historyItem.innerHTML = `
                <div class="tin-info">
                    <div class="tin-number">${item.tin}</div>
                    <div class="tin-details d-flex align-items-center">
                        <span>${item.idType}: ${item.idValue}</span>
                        ${onCooldown ? '<span class="cooldown-badge ms-2" title="Recently validated"><i class="bi bi-clock-history text-warning"></i></span>' : ''}
                    </div>
                </div>
                <div class="validation-status ${item.isValid ? 'valid' : 'invalid'}">
                    ${item.isValid ? 'Valid' : 'Invalid'}
                </div>
            `;

            // Add click functionality to reuse this validation
            if (!onCooldown) {
                historyItem.style.cursor = 'pointer';
                historyItem.addEventListener('click', () => {
                    this.fillValidationForm(item.tin, item.idType, item.idValue);
                });
            }

            historyContainer.appendChild(historyItem);
        });

        // Add CSS for cooldown items if not already added
        if (!document.getElementById('cooldown-styles')) {
            const cooldownStyles = document.createElement('style');
            cooldownStyles.id = 'cooldown-styles';
            cooldownStyles.textContent = `
                .history-item.on-cooldown {
                    opacity: 0.7;
                    cursor: not-allowed !important;
                }
                .cooldown-badge {
                    font-size: 0.7rem;
                }
            `;
            document.head.appendChild(cooldownStyles);
        }
    }

    // Check if a validation is on cooldown
    isOnCooldown(tin, idType, idValue) {
        try {
            const recentValidations = localStorage.getItem('recent_validations');
            if (!recentValidations) return false;

            const validations = JSON.parse(recentValidations);
            const validationKey = `${tin}-${idType}-${idValue}`.toLowerCase();

            const now = Date.now();
            return validations.some(v =>
                v.key === validationKey &&
                (now - v.timestamp) < 30000 // 30 seconds cooldown
            );
        } catch (e) {
            console.error('Error checking cooldown status:', e);
            return false;
        }
    }

    // Fill the validation form with data from history
    fillValidationForm(tin, idType, idValue) {
        const tinInput = document.getElementById('tinNumber');
        const idTypeInput = document.getElementById('idType');
        const idValueInput = document.getElementById('idValue');

        if (tinInput && idTypeInput && idValueInput) {
            tinInput.value = tin;
            idTypeInput.value = idType;
            idValueInput.value = idValue;

            // Show toast notification
            const toastEl = document.getElementById('validationToast');
            if (toastEl) {
                // Set custom message in toast body
                const toastBody = toastEl.querySelector('.toast-body');
                if (toastBody) {
                    toastBody.innerHTML = `
                        <div class="d-flex align-items-center">
                            <div class="me-3">
                                <i class="bi bi-check-circle-fill text-success fs-4"></i>
                            </div>
                            <div>
                                <strong>TIN details copied to form</strong><br>
                                <small class="text-muted">${tin} (${idType}: ${idValue})</small>
                            </div>
                        </div>
                        <div class="mt-2 small">
                            <i class="bi bi-info-circle me-1 text-primary"></i>
                            Click "Validate TIN" to proceed with validation
                        </div>
                    `;
                }

                // Initialize and show the toast
                const toast = new bootstrap.Toast(toastEl, {
                    animation: true,
                    autohide: true,
                    delay: 3000
                });
                toast.show();
            }

            // Focus on the validate button
            const validateButton = document.getElementById('validateSingleTin');
            if (validateButton) {
                validateButton.focus();

                // Scroll to the form
                validateButton.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }

    // Get validation history from localStorage
    getValidationHistory() {
        try {
            const history = localStorage.getItem('tin_validation_history');
            return history ? JSON.parse(history) : [];
        } catch (e) {
            console.error('Error retrieving validation history:', e);
            return [];
        }
    }

    // Add validation result to history
    addToValidationHistory(tin, idType, idValue, isValid) {
        try {
            const history = this.getValidationHistory();

            // Add new entry at the beginning
            history.unshift({
                tin,
                idType,
                idValue,
                isValid,
                timestamp: new Date().toISOString()
            });

            // Keep only the most recent 10 entries
            const trimmedHistory = history.slice(0, 10);

            // Save to localStorage
            localStorage.setItem('tin_validation_history', JSON.stringify(trimmedHistory));

            // Update UI - render the updated history
            this.renderValidationHistory(trimmedHistory);

            // If search input has a value, clear it to show the updated list
            const searchInput = document.getElementById('historySearchInput');
            if (searchInput && searchInput.value) {
                searchInput.value = '';
            }
        } catch (e) {
            console.error('Error saving validation history:', e);
        }
    }

    // Clear validation history
    clearValidationHistory() {
        try {
            // Clear localStorage
            localStorage.removeItem('tin_validation_history');

            // Clear search input if it exists
            const searchInput = document.getElementById('historySearchInput');
            if (searchInput) {
                searchInput.value = '';
            }

            // Show empty state
            const historyContainer = document.getElementById('validationHistory');
            if (historyContainer) {
                historyContainer.innerHTML = `
                    <div class="text-center text-muted py-2">
                        <i class="bi bi-shield-check mb-1 d-block" style="font-size: 1.2rem;"></i>
                        <small>No validation history yet</small>
                    </div>
                `;
            }
        } catch (e) {
            console.error('Error clearing validation history:', e);
        }
    }

    initializeTableStyles() {
        // Apply Bootstrap classes to DataTables elements
        $('.dataTables_filter input').addClass('form-control form-control-sm');
        $('.dataTables_length select').addClass('form-select form-select-sm');
    }

    refresh(forceRefresh = false) {
        console.log('🔄 Refresh called, current data source:', this.currentDataSource);

        if (this.currentDataSource === 'staging') {
            // If we're in staging mode, refresh staging data
            this.switchToStagingData();
        } else {
            // If we're in live mode, refresh live data
            if (forceRefresh) {
                // Force a refresh from the server
                sessionStorage.setItem('forceRefreshOutboundTable', 'true');
                this.table?.ajax.reload(null, false);
            } else if (dataCache.isCacheValid()) {
                // Use cached data if it's valid
                console.log('Using cached data for table refresh');
                if (this.table) {
                    const currentData = this.table.data().toArray();
                    // Only update if there's a difference in the data (like status changes)
                    if (JSON.stringify(currentData) !== JSON.stringify(dataCache.tableData)) {
                        this.table.clear();
                        this.table.rows.add(dataCache.tableData);
                        this.table.draw(false); // false to keep current paging
                    }
                    // Update card totals regardless
                    this.updateCardTotals();
                }
            } else {
                // Refresh live data
                this.table?.ajax.reload(null, false);
            }
        }
    }

    /**
     * Update the table data after submission without making AJAX calls
     * @param {Array} results - Array of submission results from the API
     */
    updateTableAfterSubmission(results) {
        if (!this.table) return;

        // Get current table data
        const currentData = this.table.data().toArray();

        // Create a map of filenames to results for quick lookup
        const resultsMap = new Map();
        results.forEach(result => {
            resultsMap.set(result.fileName, result);
        });

        // Update data in-place
        const updatedData = currentData.map(row => {
            const result = resultsMap.get(row.fileName);
            if (result) {
                return {
                    ...row,
                    status: result.success ? 'Submitted' : row.status,
                    date_submitted: result.success ? new Date().toISOString() : row.date_submitted,
                    uuid: result.uuid || row.uuid
                };
            }
            return row;
        });

        // Update the cache with the new data
        dataCache.updateCache(updatedData);

        // Update table without AJAX
        this.table.clear();
        this.table.rows.add(updatedData);
        this.table.draw(false); // false to keep current paging

        // Update card totals
        this.updateCardTotals();
    }

    cleanup() {
        if (this.table) {
            this.table.destroy();
            this.table = null;
        }
    }

    showProgressModal(title = 'Submitting Document to LHDN', message = 'Please wait while we process your request') {
        return `
            <div class="modern-submission-container">
                <div class="submission-header">
                    <div class="submission-icon">
                        <div class="icon-wrapper">
                            <i class="fas fa-cloud-upload-alt"></i>
                        </div>
                    </div>
                    <div class="submission-title">${title}</div>
                    <div class="submission-subtitle">${message}</div>
                </div>

                <div class="modern-progress-steps">
                    <div class="progress-step completed" data-step="1">
                        <div class="step-indicator">
                            <div class="step-number">
                                <i class="fas fa-check"></i>
                            </div>
                        </div>
                        <div class="step-details">
                            <div class="step-title">Document Validation</div>
                            <div class="step-status">Completed successfully</div>
                        </div>
                        <div class="step-connector"></div>
                    </div>

                    <div class="progress-step processing" data-step="2">
                        <div class="step-indicator">
                            <div class="step-number">
                                <div class="modern-spinner"></div>
                            </div>
                        </div>
                        <div class="step-details">
                            <div class="step-title">LHDN Submission</div>
                            <div class="step-status">Uploading to LHDN...</div>
                        </div>
                        <div class="step-connector"></div>
                    </div>

                    <div class="progress-step pending" data-step="3">
                        <div class="step-indicator">
                            <div class="step-number">3</div>
                        </div>
                        <div class="step-details">
                            <div class="step-title">Processing Response</div>
                            <div class="step-status">Waiting...</div>
                        </div>
                    </div>
                </div>

                <div class="submission-footer">
                    <div class="progress-bar-container">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: 66%"></div>
                        </div>
                        <div class="progress-text">Step 2 of 3</div>
                    </div>
                </div>
            </div>
        `;
    }

    showErrorModal(title = 'XML Validation Failed', errors = []) {
        const errorList = errors.map(error => `
            <div class="error-item">
                <i class="fas fa-exclamation-circle"></i>
                <div class="error-content">${error}</div>
            </div>
        `).join('');

        return `
        <div class="modal-content">
            <div class="modal-header">
                <div class="icon error">
                    <i class="fas fa-exclamation-circle"></i>
                </div>
                <div class="title">${title}</div>
                <div class="subtitle">Please fix the following issues and try again</div>
            </div>
            <div class="modal-body">
                <div class="error-list">
                    ${errorList}
                </div>
                <div class="modal-actions">
                    <button class="btn btn-primary">
                        <i class="fas fa-file-excel"></i>
                        Open Excel File
                </button>
                    <button class="btn btn-light">
                        I Understand
                    </button>
                </div>
            </div>
        </div>
    `;
    }

    showConfirmModal(fileDetails) {
        return `
            <div class="modal-content">
                <div class="modal-header">
                <div class="icon primary">
                    <i class="fas fa-file-check"></i>
                    </div>
                <div class="title">Confirm Submission</div>
                <div class="subtitle">Please review the document details before submitting to LHDN</div>
                </div>
                <div class="modal-body">
                <div class="file-details">
                        <div class="detail-item">
                        <span class="field-label">File Name</span>
                        <span class="field-value">${fileDetails.fileName}</span>
                        </div>
                        <div class="detail-item">
                        <span class="field-label">Source</span>
                        <span class="field-value">${fileDetails.source}</span>
                        </div>
                        <div class="detail-item">
                        <span class="field-label">Company</span>
                        <span class="field-value">${fileDetails.company}</span>
                        </div>
                    <div class="detail-item">
                        <span class="field-label">Upload Date</span>
                        <span class="field-value">${fileDetails.uploadedDate}</span>
                    </div>
                    <div class="detail-item">
                        <span class="field-label">Version</span>
                        <span class="field-value">${fileDetails.version}</span>
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-primary">
                        <i class="fas fa-check"></i>
                        Yes, Submit
                    </button>
                    <button class="btn btn-light">
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    `;
    }

    getEmptyStateHtml(message = 'No EXCEL files found') {
        return `
            <div class="empty-state-container text-center p-4">
                <div class="empty-state-icon mb-3">
                    <i class="fas fa-file-xml fa-3x text-muted"></i>
                </div>
                <p class="empty-state-description text-muted">${message}</p>
            </div>
        `;
    }

    showEmptyState(message = 'No EXCEL files found') {
        // Show empty state message in table
        $('#invoiceTable tbody').html(`
            <tr>
                <td colspan="10" class="text-center p-4">
                    <div class="empty-state-container">
                        <div class="empty-state-icon mb-3">
                            <i class="fas fa-file-excel fa-3x text-muted"></i>
                        </div>
                        <h5>${message}</h5>
                        <p class="text-muted">Try refreshing the page or check your data source settings.</p>
                    </div>
                </td>
            </tr>
        `);
    }

    // Initialize session counter for validation limits
    initValidationSessionCounter() {
        // Get or create the session counter
        let sessionCount = sessionStorage.getItem('validation_session_count');
        if (!sessionCount) {
            sessionCount = 0;
            sessionStorage.setItem('validation_session_count', sessionCount);
        }
    }

}

async function validateExcelFile(fileName, type, company, date) {
    console.log('Starting validation with params:', { fileName, type, company, date });

    if (!fileName || !type || !company || !date) {
        console.error('Missing required parameters:', { fileName, type, company, date });
        throw new ValidationError('Missing required parameters for validation', [], fileName);
    }

    // Format date consistently
    const formattedDate = moment(date).format('YYYY-MM-DD');

    try {
        const encodedFileName = encodeURIComponent(fileName);
        const response = await fetch(`/api/outbound-files/${encodedFileName}/content`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            },
            credentials: 'same-origin', // Include credentials to send cookies with the request
            body: JSON.stringify({
                type,
                company,
                date: formattedDate,
                filePath: `${type}/${company}/${formattedDate}/${fileName}`
            })
        });

        if (!response.ok) {
            if (response.status === 404) {
                throw new ValidationError(`File not found: ${fileName}`, [{
                    code: 'FILE_NOT_FOUND',
                    message: 'The Excel file could not be found in the specified location',
                    target: 'file',
                    propertyPath: null,
                    validatorType: 'System'
                }], fileName);
            }

            const errorText = await response.text();
            let errorDetails;
            try {
                errorDetails = JSON.parse(errorText);
            } catch (e) {
                errorDetails = { error: { message: errorText } };
            }

            throw new ValidationError('Failed to fetch file content', [{
                code: errorDetails.error?.code || 'FILE_READ_ERROR',
                message: errorDetails.error?.message || 'Could not read the Excel file content',
                target: 'file',
                propertyPath: null,
                validatorType: 'System'
            }], fileName);
        }

        const fileData = await response.json();
        console.log('Received file data:', fileData);

        if (!fileData.success || !fileData.content) {
            console.error('Invalid file content received:', fileData);
            throw new ValidationError('Invalid file content', [{
                code: 'INVALID_CONTENT',
                message: fileData.error?.message || 'The file content is not in the expected format',
                target: 'content',
                propertyPath: null,
                validatorType: 'Format'
            }], fileName);
        }

        // Validate data
        const rawData = fileData.content[0]; // Get the first document since backend returns array
        console.log("VALIDATION RAW DATA: ", rawData);
        console.log('Processing Excel file data:', rawData);

        if (!rawData) {
            console.error('No raw data available for validation');
            throw new ValidationError('Invalid data format', [{
                code: 'NO_DATA',
                message: 'No data found in the Excel file',
                target: 'content',
                propertyPath: null,
                validatorType: 'Format'
            }], fileName);
        }

        const validationErrors = [];

        // Header Validation (Mandatory fields)
        if (!rawData.header) {
            validationErrors.push({
                row: 'Header',
                errors: ['Missing header information']
            });
        } else {
            const headerErrors = [];
            const header = rawData.header;
            console.log("HEADER: ", header);

            if (!header.invoiceNo) headerErrors.push('Missing invoice number');
            if (!header.invoiceType) headerErrors.push('Missing invoice type');

            // Validate issue date
            if (!header.issueDate?.[0]?._) {
                headerErrors.push('Missing issue date');
            } else {
                const issueDate = moment(header.issueDate[0]._);
                const today = moment();
                const daysDiff = today.diff(issueDate, 'days');

                if (daysDiff > 7) {
                    headerErrors.push({
                        code: 'CF321',
                        message: 'Issuance date time value of the document is too old that cannot be submitted.',
                        target: 'DatetimeIssued',
                        propertyPath: 'Invoice.IssueDate AND Invoice.IssueTime'
                    });
                }
            }

            if (!header.issueTime?.[0]?._) headerErrors.push('Missing issue time');
            if (!header.currency) headerErrors.push('Missing currency');

            if (headerErrors.length > 0) {
                validationErrors.push({
                    row: 'Header',
                    errors: headerErrors
                });
            }
        }

        // Supplier and Buyer validations remain the same...

        const supplier = rawData.supplier;
        const buyer = rawData.buyer;

        console.log("SUPPLIER: ", supplier);
        console.log("BUYER: ", buyer);

        if (!supplier || !buyer) {
            validationErrors.push({
                row: 'Supplier and Buyer',
                errors: ['Missing supplier or buyer information']
            });
        } else {
            const supplierErrors = [];
            const buyerErrors = [];

            if (!supplier.name) supplierErrors.push('Missing supplier name');
            if (!buyer.name) buyerErrors.push('Missing buyer name');
            const industryName = String(supplier.industryName || '').trim();
            const msicCode = String(supplier.industryClassificationCode || '').trim();
            const isForeignMsic = msicCode === '00000';
            if (!isForeignMsic && (!industryName || ['NA', 'N/A', 'NOT APPLICABLE'].includes(industryName.toUpperCase()))) {
                supplierErrors.push({
                    code: 'CF701',
                    message: 'Business activity description is required',
                    target: 'IndustryClassificationCode',
                    propertyPath: 'Invoice.AccountingSupplierParty.Party.IndustryClassificationCode.name'
                });
            }
            if (rawData.header?.documentReference?.invalidIncoterms) {
                supplierErrors.push({
                    code: 'CF417',
                    message: 'Incoterms must be 1 to 3 letters with no special characters (for example CIF)',
                    target: 'Incoterms',
                    propertyPath: 'Invoice.AdditionalDocumentReference.ID'
                });
            }

            if (supplierErrors.length > 0) {
                validationErrors.push({
                    row: 'Supplier',
                    errors: supplierErrors
                });
            }

            if (buyerErrors.length > 0) {
                validationErrors.push({
                    row: 'Buyer',
                    errors: buyerErrors
                });
            }
        }

        // Items Validation - Updated to match new structure
        console.log("ITEMS: ", rawData.items);
        if (!rawData.items || !Array.isArray(rawData.items)) {
            validationErrors.push({
                row: 'Items',
                errors: ['No items found in document']
            });
        } else {
            const validItems = rawData.items.filter(item =>
                item &&
                item.lineId &&
                item.quantity > 0 &&
                item.unitPrice > 0 &&
                item.item?.classification?.code &&
                item.item?.classification?.type &&
                item.item?.description
            );

            if (validItems.length === 0) {
                validationErrors.push({
                    row: 'Items',
                    errors: ['No valid items found in document']
                });
            } else {
                validItems.forEach((item, index) => {
                    const itemErrors = [];
                    const lineNumber = index + 1;

                    // Validate tax information - Updated to match new structure
                    if (item.taxTotal) {
                        const taxSubtotal = item.taxTotal.taxSubtotal?.[0];
                        if (!taxSubtotal) {
                            itemErrors.push({
                                code: 'CF366',
                                message: 'Missing tax subtotal information',
                                target: 'TaxSubtotal',
                                propertyPath: `Invoice.InvoiceLine[${lineNumber}].TaxTotal.TaxSubtotal`
                            });
                        } else {
                            const taxTypeCode = taxSubtotal.taxCategory?.id;

                            if (!['01', '02', '03', '04', '05', '06', 'E'].includes(taxTypeCode)) {
                                itemErrors.push({
                                    code: 'CF366',
                                    message: 'Invalid tax type code',
                                    target: 'TaxTypeCode',
                                    propertyPath: `Invoice.InvoiceLine[${lineNumber}].TaxTotal.TaxSubtotal[0].TaxCategory.ID`
                                });
                            }

                            if (taxTypeCode === '06') {
                                if (taxSubtotal.taxAmount !== 0 || taxSubtotal.taxCategory?.percent !== 0) {
                                    itemErrors.push({
                                        code: 'CF367',
                                        message: 'For tax type 06 (Not Applicable), all tax amounts and rates must be zero',
                                        target: 'TaxTotal',
                                        propertyPath: `Invoice.InvoiceLine[${lineNumber}].TaxTotal`
                                    });
                                }
                            } else if (taxTypeCode === 'E') {
                                if (!taxSubtotal.taxCategory?.exemptionReason) {
                                    itemErrors.push({
                                        code: 'CF369',
                                        message: 'Tax exemption reason is required for tax type E',
                                        target: 'TaxExemptionReason',
                                        propertyPath: `Invoice.InvoiceLine[${lineNumber}].TaxTotal.TaxSubtotal[0].TaxCategory.ExemptionReason`
                                    });
                                }
                            }
                        }
                    }

                    if (itemErrors.length > 0) {
                        validationErrors.push({
                            row: `Item ${lineNumber}`,
                            errors: itemErrors
                        });
                    }
                });
            }
        }

        // Summary Validation - Updated to match new structure
        if (!rawData.summary) {
            validationErrors.push({
                row: 'Summary',
                errors: ['Missing document summary']
            });
        } else {
            const summaryErrors = [];
            const summary = rawData.summary;

            // Validate amounts
            if (!summary.amounts?.lineExtensionAmount) summaryErrors.push('Missing line extension amount');
            if (!summary.amounts?.taxExclusiveAmount) summaryErrors.push('Missing tax exclusive amount');
            if (!summary.amounts?.taxInclusiveAmount) summaryErrors.push('Missing tax inclusive amount');
            if (!summary.amounts?.payableAmount) summaryErrors.push('Missing payable amount');

            // Validate tax total
            if (!summary.taxTotal) {
                summaryErrors.push({
                    code: 'CF380',
                    message: 'Missing TaxTotal information',
                    target: 'TaxTotal',
                    propertyPath: 'Invoice.TaxTotal'
                });
            } else {
                const taxTotal = summary.taxTotal;

                if (!taxTotal.taxSubtotal || !Array.isArray(taxTotal.taxSubtotal)) {
                    summaryErrors.push({
                        code: 'CF381',
                        message: 'Invalid tax subtotal structure',
                        target: 'TaxSubtotal',
                        propertyPath: 'Invoice.TaxTotal.TaxSubtotal'
                    });
                } else {
                    // Validate each tax subtotal
                    taxTotal.taxSubtotal.forEach((subtotal, index) => {
                        if (!subtotal.taxableAmount && subtotal.taxableAmount !== 0) {
                            summaryErrors.push({
                                code: 'CF382',
                                message: `Missing taxable amount in subtotal ${index + 1}`,
                                target: 'TaxableAmount',
                                propertyPath: `Invoice.TaxTotal.TaxSubtotal[${index}].TaxableAmount`
                            });
                        }

                    });
                }
            }

            if (summaryErrors.length > 0) {
                validationErrors.push({
                    row: 'Summary',
                    errors: summaryErrors
                });
            }
        }

        if (validationErrors.length > 0) {
            throw new ValidationError('Excel file validation failed', validationErrors, fileName);
        }

        return rawData;
    } catch (error) {
        if (error instanceof ValidationError) {
            throw error;
        }
        throw new ValidationError(error.message || 'Validation failed', [{
            code: 'VALIDATION_ERROR',
            message: error.message || 'An unexpected error occurred during validation',
            target: 'system',
            propertyPath: null,
            validatorType: 'System'
        }], fileName);
    }
}

async function showVersionDialog() {
    const content = `
        <div class="modern-modal-content">
            <!-- Header Section with Invoice Branding -->
            <div class="modal-header-section">
                <div class="modal-brand">
                    <div class="brand-icon">
                        <i class="bi bi-file-earmark-code"></i>
                    </div>
                    <div class="brand-info">
                        <h1 class="modal-title">SELECT DOCUMENT VERSION</h1>
                        <p class="modal-subtitle">Choose your preferred format for submission</p>
                    </div>
                </div>
                <div class="modal-meta">
                    <div class="meta-item">
                        <span class="meta-label">Available Formats</span>
                        <span class="meta-value">2</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Recommended</span>
                        <span class="meta-value">v1.0</span>
                    </div>
                </div>
            </div>

            <!-- Version Options -->
            <div class="version-options">
                <div class="version-card selected" data-version="1.0">
                    <div class="version-header">
                        <div class="version-number">1.0</div>
                        <div class="version-status available">Available Now</div>
                    </div>
                    <div class="version-title">Standard Version</div>
                    <div class="version-description">
                        This is the standard e-invoice version designed for submitting invoices to LHDN without the need for a digital signature.
                    </div>
                </div>
                <div class="version-card disabled" data-version="1.1">
                    <div class="version-header">
                        <div class="version-number">1.1</div>
                        <div class="version-status coming-soon">Coming Soon</div>
                    </div>
                    <div class="version-title">Secure Version</div>
                    <div class="version-description">
                        Enhanced encrypted format with digital signature capabilities, tailored for LHDN's advanced security requirements.
                    </div>
                </div>
            </div>
        </div>
    `;

    return Swal.fire({
        html: content,
        showCancelButton: true,
        confirmButtonText: 'Continue',
        cancelButtonText: 'Cancel',
        width: 600,
        padding: '2rem',
        focusConfirm: false,
        customClass: {
            popup: 'semi-minimal-popup'
        },
        didOpen: () => {
            document.querySelectorAll('.version-card:not(.disabled)').forEach(card => {
                card.addEventListener('click', () => {
                    document.querySelector('.version-card.selected')?.classList.remove('selected');
                    card.classList.add('selected');
                });
            });
        }
    }).then((result) => {
        if (result.isConfirmed) {
            return '1.0';
        }
        return null;
    });
}
// Modern Success Modal Template
function createModernSuccessModal(options) {
    const {
        title,
        subtitle,
        content
    } = options;

    return `
        <div class="modern-submission-container">
            <div class="submission-header" style="background: linear-gradient(135deg, #059669 0%, #047857 100%);">
                <div class="submission-icon">
                    <div class="icon-wrapper" style="background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); color: #059669;">
                        <i class="fas fa-check-circle"></i>
                    </div>
                </div>
                <h1 class="submission-title">${title}</h1>
                <p class="submission-subtitle">${subtitle}</p>
                <div class="error-meta" style="display: flex; gap: 1.5rem; justify-content: center;">
                    <div class="meta-item">
                        <span class="meta-label">Process</span>
                        <span class="meta-value">LHDN</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Status</span>
                        <span class="meta-value">Success</span>
                    </div>
                </div>
            </div>
            <div class="error-content" style="background: white; padding: 2rem;">
                ${content}
            </div>
        </div>
    `;
}

// Modern Error Modal Template
function createModernErrorModal(options) {
    const {
        title,
        subtitle,
        content
    } = options;

    return `
        <div class="modern-error-modal">
            <div class="error-header">
                <div class="error-icon">
                    <div class="icon-wrapper">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                </div>
                <h1 class="error-title">${title}</h1>
                <p class="error-subtitle">${subtitle}</p>
                <div class="error-meta">
                    <div class="meta-item">
                        <span class="meta-label">Process</span>
                        <span class="meta-value">LHDN</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Status</span>
                        <span class="meta-value">Failed</span>
                    </div>
                </div>
            </div>
            <div class="error-content">
                ${content}
            </div>
        </div>
    `;
}

// Modern Confirmation Modal Template
function createModernConfirmationModal(options) {
    const {
        title,
        subtitle,
        content
    } = options;

    return `
        <div class="modern-submission-container">
            <div class="submission-header">
                <div class="submission-icon">
                    <div class="icon-wrapper">
                        <i class="fas fa-file-check"></i>
                    </div>
                </div>
                <h1 class="submission-title">${title}</h1>
                <p class="submission-subtitle">${subtitle}</p>
                <div class="error-meta" style="display: flex; gap: 1.5rem; justify-content: center;">
                    <div class="meta-item">
                        <span class="meta-label">Document Type</span>
                        <span class="meta-value">01</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Issue Date</span>
                        <span class="meta-value">${new Date().toLocaleDateString()}</span>
                    </div>
                </div>
            </div>
            <div class="error-content" style="background: white; padding: 2rem;">
                ${content}
            </div>
        </div>
    `;
}

// Legacy function for backward compatibility
function createSemiMinimalDialog(options) {
    // Determine the type based on title or content
    if (options.title && options.title.toLowerCase().includes('success')) {
        return createModernSuccessModal(options);
    } else if (options.title && (options.title.toLowerCase().includes('error') || options.title.toLowerCase().includes('failed'))) {
        return createModernErrorModal(options);
    } else {
        return createModernConfirmationModal(options);
    }
}

// Update showConfirmationDialog to use the new template
async function showConfirmationDialog(fileName, type, company, date, version) {
    const content = `
        <div class="modern-modal-content">
            <!-- Header Section with Invoice Branding -->
            <div class="modal-header-section">
                <div class="modal-brand">
                    <div class="brand-icon">
                        <i class="bi bi-file-check"></i>
                    </div>
                    <div class="brand-info">
                        <h1 class="modal-title">CONFIRM SUBMISSION</h1>
                        <p class="modal-subtitle">Please review the document details before submitting to LHDN</p>
                    </div>
                </div>
                <div class="modal-meta">
                    <div class="meta-item">
                        <span class="meta-label">Document Type</span>
                        <span class="meta-value">01</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Issue Date</span>
                        <span class="meta-value">${new Date().toLocaleDateString()}</span>
                    </div>
                </div>
            </div>

            <!-- Document Details Card -->
            <div class="content-card">
                <div class="content-header">
                    <span class="content-badge">
                        <i class="bi bi-file-earmark-text"></i>
                    </span>
                    <span class="content-title">Document Details</span>
                </div>
                <div class="field-row">
                    <span class="field-label">File Name:</span>
                    <span class="field-value">${fileName}</span>
                </div>
                <div class="field-row">
                    <span class="field-label">Source:</span>
                    <span class="field-value">${type}</span>
                </div>
                <div class="field-row">
                    <span class="field-label">Company:</span>
                    <span class="field-value">${company}</span>
                </div>
                <div class="field-row">
                    <span class="field-label">Upload Date:</span>
                    <span class="field-value">${new Date(date).toLocaleString()}</span>
                </div>
                <div class="field-row">
                    <span class="field-label">Version:</span>
                    <span class="field-value">${version}</span>
                </div>
            </div>
        </div>
    `;

    return Swal.fire({
        html: content,
        showCancelButton: true,
        confirmButtonText: 'Yes, Submit',
        cancelButtonText: 'Cancel',
        width: 600,
        padding: '2rem',
        focusConfirm: false,
        customClass: {
            confirmButton: 'btn-success',
            popup: 'semi-minimal-popup'
        }
    }).then((result) => result.isConfirmed);
}

// Initialize data source toggle functionality
function initializeDataSourceToggle() {
    const liveDataSource = document.getElementById('liveDataSource');
    const archiveDataSource = document.getElementById('archiveDataSource');
    const refreshButton = document.getElementById('refreshDataSource');

    if (!liveDataSource || !archiveDataSource || !refreshButton) {
        console.warn('Data source toggle elements not found');
        return;
    }

    // Debouncing variables
    let lastToggleTime = 0;
    let currentDataSource = 'live'; // Track current state
    const toggleDebounceDelay = 300; // 300ms debounce

    // Handle data source toggle with better event handling
    function handleDataSourceChange(event) {
        // Only process if the radio button is being checked (not unchecked)
        if (!event.target.checked) {
            return;
        }

        const currentTime = Date.now();

        // Debounce rapid successive calls
        if (currentTime - lastToggleTime < toggleDebounceDelay) {
            console.log('Data source toggle debounced - too rapid');
            return;
        }
        lastToggleTime = currentTime;

        const tableManager = InvoiceTableManager.getInstance();
        if (!tableManager) return;

        const isArchiveMode = archiveDataSource.checked;
        const newDataSource = isArchiveMode ? 'staging' : 'live';

        // Prevent duplicate switches to the same data source
        if (newDataSource === currentDataSource) {
            console.log('Already on', newDataSource, 'data source - skipping switch');
            return;
        }

        console.log('🔄 Data source toggle:', isArchiveMode ? 'Archive Staging' : 'Live Excel Files');
        currentDataSource = newDataSource;

        // Set the data source mode
        tableManager.isArchiveMode = isArchiveMode;

        if (isArchiveMode) {
            // Switch to staging data
            tableManager.switchToStagingData();
        } else {
            // Switch to live data
            tableManager.switchToListAllData('pending');
        }
    }

    // Add event listeners - only listen to the checked state
    liveDataSource.addEventListener('change', handleDataSourceChange);
    archiveDataSource.addEventListener('change', handleDataSourceChange);

    // Handle refresh button with debouncing
    let lastRefreshTime = 0;
    const refreshDebounceDelay = 1000; // 1 second debounce for refresh

    refreshButton.addEventListener('click', function() {
        const currentTime = Date.now();

        // Debounce rapid refresh clicks
        if (currentTime - lastRefreshTime < refreshDebounceDelay) {
            console.log('Refresh button debounced - too rapid');
            return;
        }
        lastRefreshTime = currentTime;

        const tableManager = InvoiceTableManager.getInstance();
        if (!tableManager) return;

        console.log('🔄 Refresh button clicked');

        // Check current data source and refresh accordingly
        if (tableManager.currentDataSource === 'staging') {
            console.log('🔄 Refreshing staging data...');
            tableManager.switchToStagingData();
        } else {
            console.log('🔄 Refreshing live data...');
            // Force refresh by setting session storage flags and trigger reload
            sessionStorage.setItem('forceRefreshOutboundTable', 'true');
            dataCache.invalidateCache();
            tableManager.table?.ajax.reload(null, false);
        }
    });
}


// Helper function to format address for display
function formatAddress(address) {
    if (!address) return 'N/A';

    // If address is already a string, return it
    if (typeof address === 'string') {
        // Replace commas with line breaks for better display
        return address.replace(/,\s*/g, '\n');
    }

    // If address is an object with line property
    if (address.line) {
        // Format the address line with line breaks instead of commas
        const formattedLine = address.line.replace(/,\s*/g, '\n');

        // Combine with other address parts
        const parts = [
            formattedLine,
            address.city,
            address.postcode || address.postal,
            address.state,
            address.country
        ].filter(part => part && part !== 'NA' && part !== 'N/A');

        return parts.join('\n');
    }

    return 'N/A';
}

/**
 * Calculate subtotal (before tax) from LHDN JSON data
 */
function calculateSubtotal(lhdnJson) {
    try {
        const invoiceLines = lhdnJson?.Invoice?.[0]?.InvoiceLine || [];
        let subtotal = 0;

        invoiceLines.forEach(line => {
            const lineAmount = parseFloat(line.LineExtensionAmount?.[0]?._ || 0);
            subtotal += lineAmount;
        });

        return subtotal.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch (error) {
        console.error('Error calculating subtotal:', error);
        return '0.00';
    }
}

/**
 * Calculate total tax amount from LHDN JSON data
 */
function calculateTotalTax(lhdnJson) {
    try {
        const invoiceLines = lhdnJson?.Invoice?.[0]?.InvoiceLine || [];
        let totalTax = 0;

        invoiceLines.forEach(line => {
            const taxAmount = parseFloat(line.TaxTotal?.[0]?.TaxAmount?.[0]?._ || 0);
            totalTax += taxAmount;
        });

        return totalTax.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch (error) {
        console.error('Error calculating total tax:', error);
        return '0.00';
    }
}

/**
 * Get Supplier TIN from LHDN JSON data
 */
function getPartyTIN(party) {
    const ids = party?.PartyIdentification || [];
    const tin = ids.find((ident) => ident?.ID?.[0]?.schemeID === 'TIN');
    return tin?.ID?.[0]?._ || 'N/A';
}

/**
 * Get Supplier TIN from LHDN JSON data
 */
function getSupplierTIN(lhdnJson) {
    try {
        return getPartyTIN(lhdnJson?.Invoice?.[0]?.AccountingSupplierParty?.[0]?.Party?.[0]);
    } catch (error) {
        console.error('Error getting supplier TIN:', error);
        return 'N/A';
    }
}

/**
 * Get Buyer TIN from LHDN JSON data
 */
function getBuyerTIN(lhdnJson) {
    try {
        return getPartyTIN(lhdnJson?.Invoice?.[0]?.AccountingCustomerParty?.[0]?.Party?.[0]);
    } catch (error) {
        console.error('Error getting buyer TIN:', error);
        return 'N/A';
    }
}

/**
 * Get Supply Place from LHDN JSON data
 */
function getSupplyPlace(lhdnJson) {
    try {
        const delivery = lhdnJson?.Invoice?.[0]?.Delivery?.[0]?.DeliveryLocation?.[0]?.Address?.[0];
        if (delivery) {
            const city = delivery.CityName?.[0]?._ || '';
            const state = delivery.CountrySubentity?.[0]?._ || '';
            const country = delivery.Country?.[0]?.IdentificationCode?.[0]?._ || '';

            if (city && state) {
                return `${city}, ${state}`;
            } else if (state) {
                return state;
            } else if (country) {
                return country;
            }
        }
        return 'Malaysia';
    } catch (error) {
        console.error('Error getting supply place:', error);
        return 'Malaysia';
    }
}

/**
 * Get Issue Time from LHDN JSON data
 */
function getIssueTime(lhdnJson) {
    try {
        return lhdnJson?.Invoice?.[0]?.IssueTime?.[0]?._ || 'N/A';
    } catch (error) {
        console.error('Error getting issue time:', error);
        return 'N/A';
    }
}

/**
 * Generate line items table rows from LHDN JSON data
 */
function generateLineItemsRows(lhdnJson) {
    try {
        const invoiceLines = lhdnJson?.Invoice?.[0]?.InvoiceLine || [];
        const currency = lhdnJson?.Invoice?.[0]?.DocumentCurrencyCode?.[0]?._ || 'MYR';

        if (!invoiceLines.length) {
            return `<tr><td colspan="9" style="padding: 16px; text-align: center; color: #6b7280;">No line items found</td></tr>`;
        }

        return invoiceLines.map((line, index) => {
            const lineId = line.ID?.[0]?._ || (index + 1);
            const description = line.Item?.[0]?.Description?.[0]?._ || 'N/A';
            const quantity = parseFloat(line.InvoicedQuantity?.[0]?._ || 0);
            const unitCode = line.InvoicedQuantity?.[0]?.unitCode || 'N/A';
            const unitPrice = parseFloat(line.Price?.[0]?.PriceAmount?.[0]?._ || 0);
            const lineAmount = parseFloat(line.LineExtensionAmount?.[0]?._ || 0);
            const taxAmount = parseFloat(line.TaxTotal?.[0]?.TaxAmount?.[0]?._ || 0);
            const taxPercent = parseFloat(line.TaxTotal?.[0]?.TaxSubtotal?.[0]?.TaxCategory?.[0]?.Percent?.[0]?._ || 0);
            const totalAmount = lineAmount + taxAmount;

            return `
                <tr style="border-bottom: 1px solid #fbbf24;">
                    <td style="padding: 8px; text-align: center; background: #fef3c7;">${lineId}</td>
                    <td style="padding: 8px; text-align: left; background: #fef3c7; max-width: 200px; word-wrap: break-word;">${description}</td>
                    <td style="padding: 8px; text-align: center; background: #fef3c7;">${quantity.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style="padding: 8px; text-align: center; background: #fef3c7;">${unitCode}</td>
                    <td style="padding: 8px; text-align: right; background: #fef3c7;">${currency} ${unitPrice.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style="padding: 8px; text-align: right; background: #fef3c7;">${currency} ${lineAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style="padding: 8px; text-align: center; background: #fef3c7;">${taxPercent.toFixed(2)}%</td>
                    <td style="padding: 8px; text-align: right; background: #fef3c7;">${currency} ${taxAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style="padding: 8px; text-align: right; background: #fef3c7; font-weight: 600;">${currency} ${totalAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error generating line items rows:', error);
        return `<tr><td colspan="9" style="padding: 16px; text-align: center; color: #ef4444;">Error loading line items</td></tr>`;
    }
}

// Show JSON preview dialog
async function showJsonPreview(fileName, type, company, date, version) {
    // First, show loading indicator
    const tableManager = InvoiceTableManager.getInstance();
    tableManager.showLoadingBackdrop('Generating JSON Preview...');

    try {
        // Fetch the JSON preview from the API
        const response = await fetch(`/api/outbound-files/${fileName}/generate-preview`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                type,
                company,
                date,
                version
            })
        });

        // Hide loading indicator
        tableManager.hideLoadingBackdrop();

        if (!response.ok) {
            const errorData = await response.json();
            const errorMessage = errorData.error?.message || 'Failed to generate preview';
            const errorCode = errorData.error?.code || 'UNKNOWN_ERROR';

            // Handle different types of errors with more specific messages
            if (errorCode === 'FILE_NOT_FOUND' || errorMessage.includes('File not found')) {
                throw new Error(`${errorMessage}\n\nPlease verify that the file exists in the correct location: ${type}/${company}/${moment(date).format('YYYY-MM-DD')}`);
            } else if (errorCode === 'NETWORK_PATH_ERROR' || errorMessage.includes('Network path is not accessible')) {
                throw new Error(`Network Configuration Error\n\n${errorMessage}\n\nPlease contact your system administrator to verify the network path configuration.`);
            } else if (errorCode === 'DIRECTORY_NOT_FOUND' || errorMessage.includes('directory not found')) {
                throw new Error(`Directory Structure Error\n\n${errorMessage}\n\nThe required folder structure may be missing. Please check the file organization.`);
            } else {
                throw new Error(errorMessage);
            }
        }

        const data = await response.json();

        if (!data.success) {
            const errorMessage = data.error?.message || 'Failed to generate preview';
            const errorCode = data.error?.code || 'UNKNOWN_ERROR';

            // Handle different types of errors with more specific messages
            if (errorCode === 'FILE_NOT_FOUND' || errorMessage.includes('File not found')) {
                throw new Error(`${errorMessage}\n\nPlease verify that the file exists in the correct location: ${type}/${company}/${moment(date).format('YYYY-MM-DD')}`);
            } else if (errorCode === 'NETWORK_PATH_ERROR' || errorMessage.includes('Network path is not accessible')) {
                throw new Error(`Network Configuration Error\n\n${errorMessage}\n\nPlease contact your system administrator to verify the network path configuration.`);
            } else if (errorCode === 'DIRECTORY_NOT_FOUND' || errorMessage.includes('directory not found')) {
                throw new Error(`Directory Structure Error\n\n${errorMessage}\n\nThe required folder structure may be missing. Please check the file organization.`);
            } else {
                throw new Error(errorMessage);
            }
        }

        // Extract summary information
        const summary = data.summary;

        // Create content for the redesigned professional preview using external CSS
        const summaryContent = `
            <div class="modern-modal-content">
                <!-- Header Section with Invoice Branding -->
                <div class="modal-header-section">
                    <div class="modal-brand">
                        <div class="brand-icon">
                            <i class="bi bi-receipt-cutoff"></i>
                        </div>
                        <div class="brand-info">
                            <h1 class="modal-title">INVOICE PREVIEW</h1>
                            <p class="modal-subtitle">Review details before LHDN submission</p>
                        </div>
                    </div>
                    <div class="modal-meta">
                        <div class="meta-item">
                            <span class="meta-label">Document Type</span>
                            <span class="meta-value">${summary.documentType}</span>
                        </div>
                        <div class="meta-item">
                            <span class="meta-label">Issue Date</span>
                            <span class="meta-value">${summary.issueDate}</span>
                        </div>
                    </div>
                </div>

                <!-- Main Invoice Content - Three Column Layout -->
                <div class="modal-content-grid-three">
                    <!-- Left Column: Supplier Information -->
                    <div class="modal-column-left">
                        <div class="modal-card theme-success">
                            <div class="modal-card-header">
                                <div class="modal-card-icon">
                                    <i class="bi bi-building"></i>
                                </div>
                                <div class="modal-card-title">
                                    <h3>SUPPLIER INFORMATION</h3>
                                    <p>Billing entity details</p>
                                </div>
                            </div>
                            <div class="modal-card-content">
                                <div class="detail-row">
                                    <div class="detail-label">
                                        <i class="bi bi-person-badge"></i>
                                        <span>Company Name</span>
                                    </div>
                                    <div class="detail-value">${summary.supplier.name}</div>
                                </div>
                                <div class="detail-row">
                                    <div class="detail-label">
                                        <i class="bi bi-card-text"></i>
                                        <span>Registration ID</span>
                                    </div>
                                    <div class="detail-value">${summary.supplier.id}</div>
                                </div>
                                <div class="detail-row">
                                    <div class="detail-label">
                                        <i class="bi bi-geo-alt"></i>
                                        <span>Address</span>
                                    </div>
                                    <div class="detail-value address-text">${formatAddress(summary.supplier.address) || 'N/A'}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Middle Column: Buyer Information -->
                    <div class="modal-column-middle">
                        <div class="modal-card theme-primary">
                            <div class="modal-card-header">
                                <div class="modal-card-icon">
                                    <i class="bi bi-person-circle"></i>
                                </div>
                                <div class="modal-card-title">
                                    <h3>BUYER INFORMATION</h3>
                                    <p>Customer details</p>
                                </div>
                            </div>
                            <div class="modal-card-content">
                                <div class="detail-row">
                                    <div class="detail-label">
                                        <i class="bi bi-person-badge"></i>
                                        <span>Company Name</span>
                                    </div>
                                    <div class="detail-value">${summary.buyer.name}</div>
                                </div>
                                <div class="detail-row">
                                    <div class="detail-label">
                                        <i class="bi bi-card-text"></i>
                                        <span>Registration ID</span>
                                    </div>
                                    <div class="detail-value">${summary.buyer.id}</div>
                                </div>
                                <div class="detail-row">
                                    <div class="detail-label">
                                        <i class="bi bi-geo-alt"></i>
                                        <span>Address</span>
                                    </div>
                                    <div class="detail-value address-text">${formatAddress(summary.buyer.address) || 'N/A'}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Right Column: Delivery Information -->
                    <div class="modal-column-right">
                        <div class="modal-card theme-info">
                            <div class="modal-card-header">
                                <div class="modal-card-icon">
                                    <i class="bi bi-truck"></i>
                                </div>
                                <div class="modal-card-title">
                                    <h3>DELIVERY INFORMATION</h3>
                                    <p>Shipping details</p>
                                </div>
                            </div>
                            <div class="modal-card-content">
                                <div class="detail-row">
                                    <div class="detail-label">
                                        <i class="bi bi-person-badge"></i>
                                        <span>Recipient</span>
                                    </div>
                                    <div class="detail-value">${summary.delivery ? summary.delivery.name : (summary.buyer.name || 'N/A')}</div>
                                </div>
                                <div class="detail-row">
                                    <div class="detail-label">
                                        <i class="bi bi-geo-alt"></i>
                                        <span>Delivery Address</span>
                                    </div>
                                    <div class="detail-value address-text">${formatAddress(summary.delivery ? summary.delivery.address : summary.buyer.address) || 'N/A'}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Invoice Summary Section - Below the 3 columns -->
                <div class="modal-invoice-summary-section">
                    <div class="modal-card theme-warning">
                        <div class="modal-card-header">
                            <div class="modal-card-icon">
                                <i class="bi bi-receipt"></i>
                            </div>
                            <div class="modal-card-title">
                                <h3>INVOICE SUMMARY</h3>
                                <p>Financial breakdown</p>
                            </div>
                        </div>
                        <div class="modal-card-content">
                            <!-- Enhanced Invoice Summary Grid -->
                            <div class="enhanced-invoice-summary" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
                                <!-- Left Column: Invoice Details -->
                                <div class="invoice-details-section">
                                    <div class="detail-group" style="margin-bottom: 1rem;">
                                        <div class="detail-row" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #fbbf24;">
                                            <span style="font-weight: 600; color: #374151; font-size: 0.875rem;">
                                                <i class="bi bi-receipt" style="margin-right: 8px; color: #f59e0b;"></i>Invoice Number
                                            </span>
                                            <span style="font-weight: 700; color: #1f2937; font-size: 0.875rem;">${summary.invoiceNumber}</span>
                                        </div>
                                        <div class="detail-row" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #fbbf24;">
                                            <span style="font-weight: 600; color: #374151; font-size: 0.875rem;">
                                                <i class="bi bi-calendar3" style="margin-right: 8px; color: #f59e0b;"></i>Issue Date
                                            </span>
                                            <span style="font-weight: 500; color: #1f2937; font-size: 0.875rem;">${summary.issueDate}</span>
                                        </div>
                                        <div class="detail-row" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #fbbf24;">
                                            <span style="font-weight: 600; color: #374151; font-size: 0.875rem;">
                                                <i class="bi bi-file-earmark-text" style="margin-right: 8px; color: #f59e0b;"></i>Document Type
                                            </span>
                                            <span style="font-weight: 500; color: #1f2937; font-size: 0.875rem;">${summary.documentType}</span>
                                        </div>
                                        <div class="detail-row" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #fbbf24;">
                                            <span style="font-weight: 600; color: #374151; font-size: 0.875rem;">
                                                <i class="bi bi-list-ol" style="margin-right: 8px; color: #f59e0b;"></i>Total Items
                                            </span>
                                            <span style="font-weight: 500; color: #1f2937; font-size: 0.875rem;">${summary.itemCount} items</span>
                                        </div>
                                        <div class="detail-row" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #fbbf24;">
                                            <span style="font-weight: 600; color: #374151; font-size: 0.875rem;">
                                                <i class="bi bi-cash-coin" style="margin-right: 8px; color: #f59e0b;"></i>Currency
                                            </span>
                                            <span style="font-weight: 500; color: #1f2937; font-size: 0.875rem;">${summary.currency}</span>
                                        </div>
                                    </div>
                                </div>

                                <!-- Right Column: Status & Date Info -->
                                <div class="status-info-section">
                                    <div class="status-info-header" style="margin-bottom: 1rem;">
                                        <h4 style="margin: 0; font-size: 0.875rem; font-weight: 600; color: #374151; display: flex; align-items: center;">
                                            <i class="bi bi-info-circle" style="margin-right: 8px; color: #f59e0b;"></i>Status Information
                                        </h4>
                                    </div>
                                    <div class="status-details">
                                    <div class="detail-row" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #fbbf24;">
                                            <span style="font-weight: 600; color: #374151; font-size: 0.875rem;">
                                                <i class="bi bi-shield-check" style="margin-right: 8px; color: #f59e0b;"></i>LHDN Status
                                            </span>
                                         <span style="font-weight: 500; color: #10b981; font-size: 0.875rem; background: #d1fae5; padding: 4px 12px; border-radius: 12px;">
                                                <i class="bi bi-check-circle-fill" style="margin-right: 4px;"></i>Ready for Submission
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Line Items Table -->
                            <div class="line-items-section" style="margin-top: 1.5rem;">
                                <div class="line-items-header" style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;">
                                    <i class="bi bi-table" style="color: #f59e0b; font-size: 1.25rem;"></i>
                                    <h4 style="margin: 0; font-size: 0.875rem; font-weight: 600; color: #374151;">Line Items</h4>
                                </div>
                                <div class="line-items-table-container" style="background: #fffbeb; border: 1px solid #fbbf24; border-radius: 8px; overflow: hidden;">
                                    <table class="line-items-table" style="width: 100%; border-collapse: collapse; font-size: 0.75rem;">
                                        <thead style="background: #f59e0b; color: white;">
                                            <tr>
                                                <th style="padding: 8px; text-align: center; font-weight: 600;">No.</th>
                                                <th style="padding: 8px; text-align: left; font-weight: 600;">Description</th>
                                                <th style="padding: 8px; text-align: center; font-weight: 600;">Qty</th>
                                                <th style="padding: 8px; text-align: center; font-weight: 600;">UOM</th>
                                                <th style="padding: 8px; text-align: right; font-weight: 600;">Unit Price</th>
                                                <th style="padding: 8px; text-align: right; font-weight: 600;">Amount</th>
                                                <th style="padding: 8px; text-align: center; font-weight: 600;">Tax %</th>
                                                <th style="padding: 8px; text-align: right; font-weight: 600;">Tax Amount</th>
                                                <th style="padding: 8px; text-align: right; font-weight: 600;">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${generateLineItemsRows(data.lhdnJson)}
                                        </tbody>
                                    </table>
                                </div>

                                <!-- Financial Summary Below Table - Right Aligned -->
                                <div class="table-summary-section" style="display: flex; justify-content: flex-end; margin-top: 1rem;">
                                    <div class="table-financial-summary" style="width: 350px; background: #fffbeb; border: 1px solid #fbbf24; border-radius: 8px; padding: 1rem;">
                                        <div class="summary-header" style="margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 2px solid #f59e0b;">
                                            <h5 style="margin: 0; font-size: 0.875rem; font-weight: 700; color: #374151; display: flex; align-items: center;">
                                                <i class="bi bi-calculator-fill" style="margin-right: 8px; color: #f59e0b;"></i>Invoice Totals
                                            </h5>
                                        </div>
                                        <div class="summary-rows">
                                            <div class="summary-row" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #fbbf24;">
                                                <span style="font-weight: 500; color: #374151; font-size: 0.8rem;">Items Count:</span>
                                                <span style="font-weight: 600; color: #1f2937; font-size: 0.8rem;">${summary.itemCount}</span>
                                            </div>
                                            <div class="summary-row" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #fbbf24;">
                                                <span style="font-weight: 500; color: #374151; font-size: 0.8rem;">Subtotal (Before Tax):</span>
                                                <span style="font-weight: 600; color: #1f2937; font-size: 0.8rem;">${summary.currency} ${calculateSubtotal(data.lhdnJson)}</span>
                                            </div>
                                            <div class="summary-row" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #fbbf24;">
                                                <span style="font-weight: 500; color: #374151; font-size: 0.8rem;">Total Tax:</span>
                                                <span style="font-weight: 600; color: #1f2937; font-size: 0.8rem;">${summary.currency} ${calculateTotalTax(data.lhdnJson)}</span>
                                            </div>
                                            <div class="summary-row total-row" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; margin-top: 8px; background: #f59e0b; border-radius: 6px;">
                                                <span style="font-weight: 700; color: white; font-size: 0.9rem;">
                                                    <i class="bi bi-currency-dollar" style="margin-right: 4px;"></i>Grand Total:
                                                </span>
                                                <span style="font-weight: 700; color: white; font-size: 1rem;">${summary.currency} ${summary.totalAmount}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- JSON Preview Section - Simplified Design -->
                <div class="json-preview-section">
                    <!-- Header with View JSON Button -->
                    <div class="json-section-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <i class="bi bi-code-slash" style="color: #6b7280; font-size: 1.25rem;"></i>
                            <div>
                                <h3 style="margin: 0; font-size: 0.875rem; font-weight: 600; color: #374151;">JSON DATA PREVIEW</h3>
                                <p style="margin: 0; font-size: 0.75rem; color: #6b7280;">LHDN-formatted invoice data</p>
                            </div>
                        </div>
                        <button id="toggleJsonBtn" class="modern-btn modern-btn-primary">
                            <i class="bi bi-eye"></i>
                            <span>View JSON</span>
                        </button>
                    </div>

                    <!-- Initial State Message - Outside the card -->
                    <div id="invoiceJsonInitialMessage" class="json-initial-message">
                        <div class="initial-message-content">
                            <i class="bi bi-eye text-muted"></i>
                            <p class="text-muted mb-0">Click "View JSON" to see the LHDN-formatted invoice data</p>
                        </div>
                    </div>

                    <!-- JSON Content Card - Hidden by default -->
                    <div class="modal-card theme-gray">
                        <div class="modal-card-header">
                            <div class="modal-card-icon">
                                <i class="bi bi-code-slash"></i>
                            </div>
                            <div class="modal-card-title">
                                <h3>JSON DATA PREVIEW</h3>
                                <p>LHDN-formatted invoice data</p>
                            </div>
                        </div>

                        <!-- JSON Content Container - Single Container -->
                        <div class="modal-card-content">
                            <!-- JSON Loading Animation with unique IDs for invoice preview -->
                            <div id="invoiceJsonLoadingAnimation" class="json-loading-animation" style="display: none;">
                                <div class="invoice-json-loading-steps horizontal-steps">
                                    <div class="invoice-json-loading-step active">
                                        <div class="invoice-json-step-icon">
                                            <i class="bi bi-check-circle-fill"></i>
                                        </div>
                                        <div class="invoice-json-step-title">Validating</div>
                                        <div class="invoice-json-step-status">COMPLETE</div>
                                    </div>
                                    <div class="invoice-json-loading-connector active"></div>
                                    <div class="invoice-json-loading-step processing">
                                        <div class="invoice-json-step-icon">
                                            <div class="spinner-border spinner-border-sm" role="status">
                                                <span class="visually-hidden">Loading...</span>
                                            </div>
                                        </div>
                                        <div class="invoice-json-step-title">Processing</div>
                                        <div class="invoice-json-step-status">IN PROGRESS</div>
                                    </div>
                                    <div class="invoice-json-loading-connector"></div>
                                    <div class="invoice-json-loading-step">
                                        <div class="invoice-json-step-icon">
                                            <i class="bi bi-circle"></i>
                                        </div>
                                        <div class="invoice-json-step-title">Ready</div>
                                        <div class="invoice-json-step-status">Waiting</div>
                                    </div>
                                </div>
                            </div>

                            <!-- JSON Content - Initially Hidden -->
                            <div id="invoiceJsonPreviewContent" class="json-content-wrapper" style="display: none;">
                                <div class="json-viewer">
                                    <div class="json-toolbar">
                                        <div class="json-info">
                                            <i class="bi bi-info-circle"></i>
                                            <span>LHDN-formatted invoice data ready for submission</span>
                                        </div>
                                        <div class="json-controls">
                                            <button class="modern-btn modern-btn-success invoice-json-copy-btn" onclick="copyInvoiceJsonToClipboard()">
                                                <i class="bi bi-clipboard"></i>
                                                Copy
                                            </button>
                                            <button class="modern-btn modern-btn-info" onclick="openInvoiceJsonFullscreen()">
                                                <i class="bi bi-arrows-fullscreen"></i>
                                                Fullscreen
                                            </button>
                                        </div>
                                    </div>
                                    <div class="json-code-container">
                                        <pre id="invoiceJsonFormattedContent" class="json-code">${JSON.stringify(data.lhdnJson, null, 2)}</pre>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Show the redesigned preview dialog
        const result = await Swal.fire({
            html: summaryContent,
            showCancelButton: true,
            confirmButtonText: '<i class="bi bi-check-circle"></i> Proceed with Submission',
            cancelButtonText: '<i class="bi bi-x-circle"></i> Cancel',
            width: 1200,
            padding: '2rem',
            focusConfirm: false,
            customClass: {
                confirmButton: 'modern-btn modern-btn-success modern-btn-large',
                cancelButton: 'modern-btn modern-btn-cancel modern-btn-large',
                popup: 'large-modal'
            },
            willOpen: () => {
                // Add CSS to ensure modal content starts at top
                const style = document.createElement('style');
                style.textContent = `
                    .swal2-html-container {
                        overflow-y: auto !important;
                        max-height: 70vh !important;
                        scroll-behavior: smooth !important;
                    }
                    .large-modal .swal2-html-container {
                        padding-top: 0 !important;
                    }
                `;
                document.head.appendChild(style);
            },
            didOpen: () => {
                // Add right-click protection and developer tools prevention
                const addSecurityProtection = () => {
                    // Disable right-click context menu
                    document.addEventListener('contextmenu', function(e) {
                        e.preventDefault();
                        return false;
                    });

                    // Disable F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U, Ctrl+Shift+C
                    document.addEventListener('keydown', function(e) {
                        // F12
                        if (e.keyCode === 123) {
                            e.preventDefault();
                            return false;
                        }
                        // Ctrl+Shift+I (Developer Tools)
                        if (e.ctrlKey && e.shiftKey && e.keyCode === 73) {
                            e.preventDefault();
                            return false;
                        }
                        // Ctrl+Shift+J (Console)
                        if (e.ctrlKey && e.shiftKey && e.keyCode === 74) {
                            e.preventDefault();
                            return false;
                        }
                        // Ctrl+U (View Source)
                        if (e.ctrlKey && e.keyCode === 85) {
                            e.preventDefault();
                            return false;
                        }
                        // Ctrl+Shift+C (Inspect Element)
                        if (e.ctrlKey && e.shiftKey && e.keyCode === 67) {
                            e.preventDefault();
                            return false;
                        }
                        // Ctrl+S (Save Page)
                        if (e.ctrlKey && e.keyCode === 83) {
                            e.preventDefault();
                            return false;
                        }
                    });

                    // Disable text selection
                    document.onselectstart = function() {
                        return false;
                    };
                    document.onmousedown = function() {
                        return false;
                    };

                    // Disable drag and drop
                    document.ondragstart = function() {
                        return false;
                    };

                    // Clear console periodically
                    setInterval(() => {
                        console.clear();
                    }, 1000);

                    // Detect developer tools
                    let devtools = {
                        open: false,
                        orientation: null
                    };

                    const threshold = 160;
                    setInterval(() => {
                        if (window.outerHeight - window.innerHeight > threshold ||
                            window.outerWidth - window.innerWidth > threshold) {
                            if (!devtools.open) {
                                devtools.open = true;
                                // Close the modal if developer tools are detected
                                Swal.close();
                                alert('Developer tools detected. Access denied for security reasons.');
                            }
                        } else {
                            devtools.open = false;
                        }
                    }, 500);
                };

                // Apply security protection
                addSecurityProtection();

                // Enhanced scroll position fix - ensure modal starts at the top
                const modalContainer = document.querySelector('.swal2-container');
                const modalContent = document.querySelector('.swal2-popup');
                const modalHtmlContainer = document.querySelector('.swal2-html-container');

                // Immediate scroll reset
                if (modalContainer) {
                    modalContainer.scrollTop = 0;
                }

                if (modalContent) {
                    modalContent.scrollTop = 0;
                }

                if (modalHtmlContainer) {
                    modalHtmlContainer.scrollTop = 0;
                }

                // Also ensure any scrollable content within the modal starts at top
                const scrollableElements = document.querySelectorAll('.modal-content-grid-three, .modern-modal-content, .modal-card-content, .swal2-html-container');
                scrollableElements.forEach(element => {
                    element.scrollTop = 0;
                });

                // Force scroll to top multiple times with increasing delays to ensure it sticks
                const forceScrollToTop = () => {
                    if (modalContainer) modalContainer.scrollTop = 0;
                    if (modalContent) modalContent.scrollTop = 0;
                    if (modalHtmlContainer) modalHtmlContainer.scrollTop = 0;

                    scrollableElements.forEach(element => {
                        element.scrollTop = 0;
                    });

                    // Scroll the entire page to top as well
                    window.scrollTo(0, 0);
                };

                // Multiple attempts to ensure scroll position
                setTimeout(forceScrollToTop, 50);
                setTimeout(forceScrollToTop, 100);
                setTimeout(forceScrollToTop, 200);
                setTimeout(forceScrollToTop, 500);
                // Initialize JSON toggle functionality

                // Add global function for copying JSON to clipboard with unique names
                window.copyInvoiceJsonToClipboard = function() {
                    const jsonContent = document.getElementById('invoiceJsonFormattedContent');
                    if (jsonContent) {
                        const textContent = jsonContent.textContent;
                        navigator.clipboard.writeText(textContent).then(() => {
                            // Show success feedback
                            const copyBtn = document.querySelector('.invoice-json-copy-btn');
                            if (copyBtn) {
                                const originalText = copyBtn.innerHTML;
                                copyBtn.innerHTML = '<i class="bi bi-check"></i> Copied!';
                                copyBtn.classList.remove('modern-btn-success');
                                copyBtn.classList.add('modern-btn-success-active');

                                setTimeout(() => {
                                    copyBtn.innerHTML = originalText;
                                    copyBtn.classList.remove('modern-btn-success-active');
                                    copyBtn.classList.add('modern-btn-success');
                                }, 2000);
                            }
                        }).catch(err => {
                            console.error('Failed to copy JSON:', err);
                            // Show error feedback
                            const copyBtn = document.querySelector('.invoice-json-copy-btn');
                            if (copyBtn) {
                                const originalText = copyBtn.innerHTML;
                                copyBtn.innerHTML = '<i class="bi bi-x"></i> Failed!';
                                setTimeout(() => {
                                    copyBtn.innerHTML = originalText;
                                }, 2000);
                            }
                        });
                    }
                };

                // Add global function for opening JSON in fullscreen with unique names
                window.openInvoiceJsonFullscreen = function() {
                    const jsonContent = document.getElementById('invoiceJsonFormattedContent');
                    if (jsonContent) {
                        const jsonData = jsonContent.textContent;
                        const newWindow = window.open('', '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes');

                        newWindow.document.write(`
                            <!DOCTYPE html>
                            <html>
                            <head>
                                <title>JSON Preview - Fullscreen</title>
                                <style>
                                    body {
                                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                        margin: 0;
                                        padding: 20px;
                                        background: #f8fafc;
                                    }
                                    .header {
                                        background: white;
                                        padding: 20px;
                                        border-radius: 8px;
                                        margin-bottom: 20px;
                                        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                                        display: flex;
                                        justify-content: space-between;
                                        align-items: center;
                                    }
                                    .title {
                                        font-size: 1.5rem;
                                        font-weight: 600;
                                        color: #1f2937;
                                        margin: 0;
                                    }
                                    .subtitle {
                                        color: #6b7280;
                                        margin: 0;
                                        font-size: 0.875rem;
                                    }
                                    .actions {
                                        display: flex;
                                        gap: 10px;
                                    }
                                    .btn {
                                        padding: 8px 16px;
                                        border: none;
                                        border-radius: 6px;
                                        cursor: pointer;
                                        font-size: 0.875rem;
                                        font-weight: 500;
                                        transition: all 0.2s;
                                    }
                                    .btn-primary {
                                        background: #3b82f6;
                                        color: white;
                                    }
                                    .btn-primary:hover {
                                        background: #2563eb;
                                    }
                                    .btn-secondary {
                                        background: #6b7280;
                                        color: white;
                                    }
                                    .btn-secondary:hover {
                                        background: #4b5563;
                                    }
                                    .json-container {
                                        background: white;
                                        border-radius: 8px;
                                        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                                        overflow: hidden;
                                    }
                                    .json-content {
                                        padding: 20px;
                                        font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
                                        font-size: 0.875rem;
                                        line-height: 1.6;
                                        color: #374151;
                                        white-space: pre-wrap;
                                        word-break: break-word;
                                        text-align: left;
                                        max-height: calc(100vh - 200px);
                                        overflow-y: auto;
                                    }
                                    .json-key { color: #0969da; font-weight: 600; }
                                    .json-string { color: #0a3069; }
                                    .json-number { color: #0550ae; }
                                    .json-boolean { color: #8250df; font-weight: 600; }
                                    .json-null { color: #656d76; font-style: italic; }
                                </style>
                            </head>
                            <body>
                                <div class="header">
                                    <div>
                                        <h1 class="title">JSON Preview</h1>
                                        <p class="subtitle">LHDN-formatted invoice data</p>
                                    </div>
                                    <div class="actions">
                                        <button class="btn btn-secondary" onclick="window.close()">Close</button>
                                    </div>
                                </div>
                                <div class="json-container">
                                    <pre class="json-content" id="jsonContent">${jsonData}</pre>
                                </div>
                                <script>
                                    function copyToClipboard() {
                                        const content = document.getElementById('jsonContent').textContent;
                                        navigator.clipboard.writeText(content).then(() => {
                                            const btn = event.target;
                                            const originalText = btn.textContent;
                                            btn.textContent = 'Copied!';
                                            setTimeout(() => {
                                                btn.textContent = originalText;
                                            }, 2000);
                                        }).catch(err => {
                                            console.error('Failed to copy:', err);
                                            alert('Failed to copy to clipboard');
                                        });
                                    }

                                    // Apply syntax highlighting
                                    function formatJson() {
                                        const element = document.getElementById('jsonContent');
                                        let content = element.textContent;

                                        // Add syntax highlighting
                                        content = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                        content = content.replace(/("(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?)/g, function (match) {
                                            let cls = 'json-number';
                                            if (/^"/.test(match)) {
                                                if (/:$/.test(match)) {
                                                    cls = 'json-key';
                                                } else {
                                                    cls = 'json-string';
                                                }
                                            } else if (/true|false/.test(match)) {
                                                cls = 'json-boolean';
                                            } else if (/null/.test(match)) {
                                                cls = 'json-null';
                                            }
                                            return '<span class="' + cls + '">' + match + '</span>';
                                        });

                                        element.innerHTML = content;
                                    }

                                    // Apply formatting when page loads
                                    window.onload = formatJson;
                                </script>
                            </body>
                            </html>
                        `);

                        newWindow.document.close();
                    }
                };

                // Function to format JSON with syntax highlighting
                const formatJson = (json) => {
                    if (typeof json !== 'string') {
                        json = JSON.stringify(json, null, 2);
                    }

                    // Add syntax highlighting
                    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
                        let cls = 'json-number';
                        if (/^"/.test(match)) {
                            if (/:$/.test(match)) {
                                cls = 'json-key';
                            } else {
                                cls = 'json-string';
                            }
                        } else if (/true|false/.test(match)) {
                            cls = 'json-boolean';
                        } else if (/null/.test(match)) {
                            cls = 'json-null';
                        }
                        return '<span class="' + cls + '">' + match + '</span>';
                    });
                };

                // Show loading animation first with unique IDs
                const invoiceJsonLoadingAnimation = document.getElementById('invoiceJsonLoadingAnimation');
                const invoiceJsonPreviewContent = document.getElementById('invoiceJsonPreviewContent');
                const invoiceJsonInitialMessage = document.getElementById('invoiceJsonInitialMessage');
                const toggleBtn = document.getElementById('toggleJsonBtn');
                const jsonPreviewSection = document.querySelector('.json-preview-section');

                // Simulate the modern loading process with unique selectors for invoice JSON
                const simulateInvoiceJsonLoading = () => {
                    // Hide initial message and show the JSON card with loading animation
                    invoiceJsonInitialMessage.style.display = 'none';
                    jsonPreviewSection.classList.add('json-active');
                    invoiceJsonLoadingAnimation.style.display = 'block';

                    // Get all steps and connectors with unique class names for invoice JSON
                    const steps = invoiceJsonLoadingAnimation.querySelectorAll('.invoice-json-loading-step');
                    const connectors = invoiceJsonLoadingAnimation.querySelectorAll('.invoice-json-loading-connector');

                    // Reset all steps first
                    steps.forEach((step, index) => {
                        if (index === 0) return; // Keep first step active
                        step.classList.remove('active', 'processing');
                        const statusEl = step.querySelector('.invoice-json-step-status');
                        const iconEl = step.querySelector('.invoice-json-step-icon');
                        if (statusEl) statusEl.textContent = 'Waiting';
                        if (iconEl) iconEl.innerHTML = '<i class="bi bi-circle"></i>';
                    });

                    // Reset connectors
                    connectors.forEach(connector => {
                        connector.classList.remove('active');
                    });

                    // Start step 2 as processing
                    if (steps[1]) {
                        steps[1].classList.add('processing');
                        const statusEl = steps[1].querySelector('.invoice-json-step-status');
                        const iconEl = steps[1].querySelector('.invoice-json-step-icon');
                        if (statusEl) statusEl.textContent = 'IN PROGRESS';
                        if (iconEl) iconEl.innerHTML = '<div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div>';
                    }

                    // After 1 second, complete step 2 (Processing)
                    setTimeout(() => {
                        // Complete step 2
                        if (steps[1]) {
                            steps[1].classList.remove('processing');
                            steps[1].classList.add('active');
                            const statusEl = steps[1].querySelector('.invoice-json-step-status');
                            const iconEl = steps[1].querySelector('.invoice-json-step-icon');
                            if (statusEl) statusEl.textContent = 'COMPLETE';
                            if (iconEl) iconEl.innerHTML = '<i class="bi bi-check-circle-fill"></i>';
                        }

                        // Activate first connector
                        if (connectors[0]) {
                            connectors[0].classList.add('active');
                        }

                        // Start step 3 (Ready)
                        if (steps[2]) {
                            steps[2].classList.add('processing');
                            const statusEl = steps[2].querySelector('.invoice-json-step-status');
                            const iconEl = steps[2].querySelector('.invoice-json-step-icon');
                            if (statusEl) statusEl.textContent = 'IN PROGRESS';
                            if (iconEl) iconEl.innerHTML = '<div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div>';
                        }

                        // After another 1.5 seconds, complete step 3
                        setTimeout(() => {
                            // Complete step 3
                            if (steps[2]) {
                                steps[2].classList.remove('processing');
                                steps[2].classList.add('active');
                                const statusEl = steps[2].querySelector('.invoice-json-step-status');
                                const iconEl = steps[2].querySelector('.invoice-json-step-icon');
                                if (statusEl) statusEl.textContent = 'COMPLETE';
                                if (iconEl) iconEl.innerHTML = '<i class="bi bi-check-circle-fill"></i>';
                            }

                            // Activate second connector
                            if (connectors[1]) {
                                connectors[1].classList.add('active');
                            }

                            // Format the JSON content
                            const jsonElement = document.getElementById('invoiceJsonFormattedContent');
                            if (jsonElement) {
                                try {
                                    const jsonObj = JSON.parse(jsonElement.textContent);
                                    jsonElement.innerHTML = formatJson(jsonObj);
                                } catch (e) {
                                    console.error('Error formatting JSON:', e);
                                }
                            }

                            // After a brief delay, hide loading and show content
                            setTimeout(() => {
                                invoiceJsonLoadingAnimation.style.display = 'none';
                                invoiceJsonInitialMessage.style.display = 'none'; // Ensure initial message stays hidden
                                invoiceJsonPreviewContent.style.display = 'block';
                                toggleBtn.innerHTML = '<i class="bi bi-eye-slash"></i><span>Hide JSON</span>';
                            }, 500);
                        }, 1500);
                    }, 1000);
                };

                // Add event listener for the toggle JSON button - Fixed with unique IDs
                toggleBtn.addEventListener('click', function() {
                    const isContentVisible = invoiceJsonPreviewContent.style.display !== 'none';
                    const isLoading = invoiceJsonLoadingAnimation.style.display !== 'none';

                    if (isContentVisible) {
                        // Hide JSON content and show initial message
                        invoiceJsonPreviewContent.style.display = 'none';
                        invoiceJsonLoadingAnimation.style.display = 'none';
                        jsonPreviewSection.classList.remove('json-active');
                        invoiceJsonInitialMessage.style.display = 'flex';
                        this.innerHTML = '<i class="bi bi-eye"></i><span>View JSON</span>';
                    } else if (isLoading) {
                        // If loading is visible, hide it and show initial message
                        invoiceJsonLoadingAnimation.style.display = 'none';
                        invoiceJsonPreviewContent.style.display = 'none';
                        jsonPreviewSection.classList.remove('json-active');
                        invoiceJsonInitialMessage.style.display = 'flex';
                        this.innerHTML = '<i class="bi bi-eye"></i><span>View JSON</span>';
                    } else {
                        // Start the loading animation
                        simulateInvoiceJsonLoading();
                        this.innerHTML = '<i class="bi bi-x-circle"></i><span>Cancel</span>';
                    }
                });


            }
        });

        return result.isConfirmed;

    } catch (error) {
        tableManager.hideLoadingBackdrop();
        console.error('Error generating JSON preview:', error);

        // Show error modal with more detailed information
        const errorMessage = error.message || 'Failed to generate JSON preview';
        const isFileNotFoundError = errorMessage.includes('File not found');

        // Create a more detailed error modal for file not found errors
        if (isFileNotFoundError) {
            await Swal.fire({
                icon: 'error',
                title: 'File Not Found',
                html: `
                    <div class="text-start">
                        <p>${errorMessage.split('\n\n')[0]}</p>
                        <hr>
                        <p class="text-muted small">
                            <i class="fas fa-info-circle me-1"></i>
                            ${errorMessage.split('\n\n')[1] || 'Please check that the file exists in the expected location.'}
                        </p>
                        <div class="alert alert-warning mt-3 small">
                            <i class="fas fa-exclamation-triangle me-1"></i>
                            <strong>Possible solutions:</strong>
                            <ul class="mb-0 mt-1">
                                <li>Verify the file name is correct</li>
                                <li>Check if the file was moved or renamed</li>
                                <li>Ensure the file was uploaded to the correct folder</li>
                            </ul>
                        </div>
                    </div>
                `,
                confirmButtonText: 'OK',
                customClass: {
                    confirmButton: 'outbound-action-btn submit',
                    popup: 'semi-minimal-popup'
                }
            });
        } else {
            const previewHasCf385 = (error.code === 'CF385' || error.errorCode === 'CF385')
                || (typeof errorMessage === 'string' && errorMessage.includes('CF385'))
                || (Array.isArray(error.details) && error.details.some((detail) => {
                    if (typeof detail === 'string') {
                        return detail.includes('CF385');
                    }
                    if (detail && typeof detail === 'object') {
                        return detail.code === 'CF385' || detail.errorCode === 'CF385';
                    }
                    return false;
                }));

            const cf385HowToFixHtml = `
                <div class="error-information text-start mt-3">
                    <h6><i class="fas fa-info-circle"></i> How to Fix</h6>
                    <p>Enter the real product or service name on each line in Excel (column 86). Values like NA are not accepted.</p>
                    <p>LHDN source: Description of Product or Service is mandatory ([1-1]), example “Laptop Peripherals”.</p>
                    <p><a href="https://sdk.myinvois.hasil.gov.my/documents/invoice-v1-0/" target="_blank" rel="noopener noreferrer">Invoice v1.0 – field list</a></p>
                </div>
            `;

            const previewModalOptions = {
                icon: 'error',
                title: 'Preview Generation Failed',
                confirmButtonText: 'OK',
                customClass: {
                    confirmButton: 'outbound-action-btn submit',
                    popup: 'semi-minimal-popup'
                }
            };

            if (previewHasCf385) {
                previewModalOptions.html = `<div class="text-start"><p>${errorMessage}</p>${cf385HowToFixHtml}</div>`;
            } else {
                previewModalOptions.text = errorMessage;
            }

            await Swal.fire(previewModalOptions);
        }

        return false;
    }
}

// Step functions for the submission process
async function performStep1(fileName, type, company, date) {
    console.log('🚀 [Step 1] Starting validation with params:', { fileName, type, company, date });

    try {
        // Start processing
        console.log('🔍 [Step 1] Starting validation');
        await updateStepStatus(1, 'processing', 'Validating document format...');

        // Perform validation
        console.log('🔍 [Step 1] Calling validateExcelFile');
        const validatedData = await validateExcelFile(fileName, type, company, date);

        if (!validatedData) {
            console.error('❌ [Step 1] No data available for validation');
            await updateStepStatus(1, 'error', 'Validation failed');
            throw new ValidationError('No data available for validation', [], fileName);
        }

        // Complete successfully
        console.log('✅ [Step 1] Validation successful');
        await updateStepStatus(1, 'completed', 'Validation completed');

        return validatedData;
    } catch (error) {
        console.error('❌ [Step 1] Validation failed:', error);
        await updateStepStatus(1, 'error', 'Validation failed');
        throw error;
    }
}



// Function to show notification about logging
function showLoggingNotification() {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'logging-notification';
    notification.innerHTML = `
        <div class="logging-notification-icon">
            <i class="fas fa-clipboard-check"></i>
        </div>
        <div class="logging-notification-message">
            <strong>Submission Logged</strong>
            <p>Your submission has been logged for tracking and audit purposes.</p>
        </div>
        <button class="logging-notification-close">
            <i class="fas fa-times"></i>
        </button>
    `;

    // Styles are now in external CSS file
    document.body.appendChild(notification);

    // Add close button functionality
    const closeButton = notification.querySelector('.logging-notification-close');
    closeButton.addEventListener('click', () => {
        notification.style.animation = 'fadeOut 0.3s forwards';
        setTimeout(() => {
            notification.remove();
        }, 300);
    });

    // Auto-remove after 5 seconds
    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.3s forwards';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 5000);
}

async function showSuccessMessage(fileName, version) {
    const content = `
        <div class="error-message" style="background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); border: 2px solid #10b981; color: #065f46;">
            <h6 style="color: #059669; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem;">
                <i class="fas fa-check-circle"></i> Submission Successful
            </h6>
            <p style="color: #047857; margin: 0; line-height: 1.6;">
                Your document has been successfully submitted to LHDN and is now being processed.
            </p>
        </div>

        <div class="error-details" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
            <h6 style="color: #475569; font-weight: 600; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem;">
                <i class="fas fa-file-alt"></i> Submission Details
            </h6>
            <div style="display: grid; gap: 0.5rem;">
                <div style="display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid #e2e8f0;">
                    <span style="font-weight: 600; color: #374151; font-size: 0.8125rem;">File Name:</span>
                    <span style="color: #6b7280; font-size: 0.8125rem;">${fileName}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid #e2e8f0;">
                    <span style="font-weight: 600; color: #374151; font-size: 0.8125rem;">Version:</span>
                    <span style="color: #6b7280; font-size: 0.8125rem;">${version}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid #e2e8f0;">
                    <span style="font-weight: 600; color: #374151; font-size: 0.8125rem;">Submitted At:</span>
                    <span style="color: #6b7280; font-size: 0.8125rem;">${new Date().toLocaleString()}</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 0.4rem 0;">
                    <span style="font-weight: 600; color: #374151; font-size: 0.8125rem;">Status:</span>
                    <span style="color: #059669; font-weight: 600; font-size: 0.8125rem;">Processing</span>
                </div>
            </div>
        </div>
        <div style="text-align: center; margin-top: 1rem; padding: 0.75rem; background: rgba(59, 130, 246, 0.1); border-radius: 8px;">
            <i class="fas fa-clock" style="color: #3b82f6; margin-right: 0.5rem;"></i>
            <span style="color: #1e40af; font-size: 0.8125rem;">Auto-closing in <span id="countdown">3</span> seconds</span>
        </div>
    `;

    const result = Swal.fire({
        html: createModernSuccessModal({
            title: 'Document Submitted Successfully',
            subtitle: 'Your document has been successfully submitted to LHDN',
            content: content
        }),
        showConfirmButton: false,
        showCancelButton: false,
        width: 520, // Reduced from 600 for better proportions
        padding: 0,
        background: 'transparent',
        customClass: {
            popup: 'modern-submission-popup enhanced-success-modal'
        },
        timer: 3000, // Auto close after 3 seconds
        timerProgressBar: true,
        didOpen: () => {
            // Start countdown timer
            let countdown = 3;
            const countdownElement = document.getElementById('countdown');
            const countdownInterval = setInterval(() => {
                countdown--;
                if (countdownElement) {
                    countdownElement.textContent = countdown;
                }
                if (countdown <= 0) {
                    clearInterval(countdownInterval);
                }
            }, 1000);
        }
    });

    return result;
}

// Main submission function
async function submitToLHDN(fileName, type, company, date) {
    console.log('🚀 Starting submission process:', { fileName, type, company, date });

    try {
        // 1. Show version selection dialog
        console.log('📋 Step 1: Showing version selection dialog');
        const version = await showVersionDialog();
        console.log('📋 Version selected:', version);

        if (!version) {
            console.log('❌ Version selection cancelled');
            return;
        }

        // 2. Show confirmation dialog
        console.log('🔍 Step 2: Showing confirmation dialog');
        const confirmed = await showConfirmationDialog(fileName, type, company, date, version);
        console.log('🔍 Confirmation result:', confirmed);

        if (!confirmed) {
            console.log('❌ Submission cancelled by user');
            return;
        }

        // 3. Show JSON mapping preview
        console.log('🔍 Step 3: Showing JSON mapping preview');
        const previewConfirmed = await showJsonPreview(fileName, type, company, date, version);
        console.log('🔍 Preview confirmation result:', previewConfirmed);

        if (!previewConfirmed) {
            console.log('❌ Submission cancelled by user after preview');
            return;
        }

        // 4. Show submission status modal and start process
        console.log('📤 Step 4: Starting submission status process');
        await showSubmissionStatus(fileName, type, company, date, version);

    } catch (error) {
        console.error('❌ Submission error:', error);
        showSystemErrorModal({
            title: 'Submission Error',
            message: error.message || 'An error occurred during submission.',
            code: 'SUBMISSION_ERROR'
        });
    }
}
// Function to get modern step HTML
function getStepHtml(stepNumber, title) {
    console.log(`🔨 [Step ${stepNumber}] Creating modern HTML for step: ${title}`);

    const stepId = `modernStep${stepNumber}`;
    console.log(`🏷️ [Step ${stepNumber}] Modern Step ID created: ${stepId}`);

    return `
        <div class="modern-step" id="${stepId}">
            <div class="modern-step-circle">
                <i class="fas fa-circle"></i>
            </div>
            <div class="modern-step-content">
                <div class="modern-step-title">${title}</div>
                <div class="modern-step-status">WAITING</div>
            </div>
        </div>
    `;
}

// Function to get submission step HTML with unique IDs - Consistent Design
function getSubmissionStepHtml(stepNumber, title) {
    console.log(`🔨 [Submission Step ${stepNumber}] Creating modern HTML for step: ${title}`);

    const stepId = `modernSubmissionStep${stepNumber}`;
    console.log(`🏷️ [Submission Step ${stepNumber}] Modern Step ID created: ${stepId}`);

    return `
        <div class="modern-step" id="${stepId}">
            <div class="modern-step-circle">
                <i class="fas fa-circle"></i>
            </div>
            <div class="modern-step-content">
                <div class="modern-step-title">${title}</div>
                <div class="modern-step-status">WAITING</div>
            </div>
        </div>
    `;
}

// Helper function to update modern step status with animation
async function updateStepStatus(stepNumber, status, message) {
    console.log(`🔄 [Step ${stepNumber}] Updating modern status:`, { status, message });

    // Try both regular step and submission step IDs
    let step = document.getElementById(`modernStep${stepNumber}`);
    if (!step) {
        step = document.getElementById(`modernSubmissionStep${stepNumber}`);
    }

    if (!step) {
        console.error(`❌ [Step ${stepNumber}] Modern step element not found`);
        return;
    }

    // Remove all status classes first
    step.classList.remove('processing', 'completed', 'error');
    console.log(`🎨 [Step ${stepNumber}] Removed old classes`);

    // Add the new status class
    step.classList.add(status);
    console.log(`🎨 [Step ${stepNumber}] Added new class:`, status);

    // Update status message with fade effect
    const statusEl = step.querySelector('.modern-step-status');
    if (statusEl && message) {
        console.log(`✍️ [Step ${stepNumber}] Updating message to:`, message);
        statusEl.style.opacity = '0';
        await new Promise(resolve => setTimeout(resolve, 300));
        statusEl.textContent = message.toUpperCase();
        statusEl.style.opacity = '1';
    }

    // Update circle icon based on status
    const circle = step.querySelector('.modern-step-circle');
    if (circle) {
        switch (status) {
            case 'processing':
                circle.innerHTML = '<div class="modern-spinner"></div>';
                break;
            case 'completed':
                circle.innerHTML = '<i class="fas fa-check"></i>';
                break;
            case 'error':
                circle.innerHTML = '<i class="fas fa-times"></i>';
                break;
            default:
                circle.innerHTML = '<i class="fas fa-circle"></i>';
        }
    }

    // Add delay for visual feedback
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`✅ [Step ${stepNumber}] Modern status update completed`);
}

/**
 * Update a single document's status without refreshing the entire table
 * @param {string} fileName - The file name to update
 */
async function updateSingleDocumentStatus(fileName) {
    try {
        console.log('🔄 Updating status for document:', fileName);
        const tableManager = InvoiceTableManager.getInstance();

        // Fetch the status of this specific document
        const response = await fetch(`/api/outbound-files/status/${fileName}`);
        if (!response.ok) {
            console.error('❌ Error fetching document status');
            return;
        }

        const result = await response.json();
        if (!result.success) {
            console.error('❌ Error in status response:', result.error);
            return;
        }

        if (result.exists) {
            // Update the specific row in the table
            const documentData = result.document;

            // Get current table data
            const currentData = tableManager.table.data().toArray();

            // Find and update the row for this document
            const updatedData = currentData.map(row => {
                if (row.fileName === fileName) {
                    return {
                        ...row,
                        status: documentData.status,
                        uuid: documentData.uuid,
                        submissionUid: documentData.submissionUid,
                        date_submitted: documentData.date_submitted,
                        date_cancelled: documentData.date_cancelled,
                        statusUpdateTime: documentData.statusUpdateTime
                    };
                }
                return row;
            });

            // Update the cache with the new data
            if (window.dataCache && typeof window.dataCache.updateCache === 'function') {
                window.dataCache.updateCache(updatedData);
            }

            // Update table without AJAX
            tableManager.table.clear();
            tableManager.table.rows.add(updatedData);
            tableManager.table.draw(false); // false to keep current paging

            // Update card totals
            tableManager.updateCardTotals();

            console.log('✅ Document status updated successfully');
        } else {
            console.warn('⚠️ Document not found in database, will perform full refresh');
            tableManager.refresh();
        }
    } catch (error) {
        console.error('❌ Error updating document status:', error);
        // Fallback to full refresh if the targeted update fails
        InvoiceTableManager.getInstance().refresh();
    }
}

async function showSubmissionStatus(fileName, type, company, date, version) {
    console.log('🚀 Starting submission status process:', { fileName, type, company, date, version });
    window.currentFileName = fileName;

    let submissionModal = null;
    try {
        // Create enhanced modern steps HTML with useful information
        console.log('📋 Creating enhanced modern submission steps container');
        const modernSubmissionStepsHtml = `
            <div class="modern-modal-content">
                <div class="modal-header-section">
                    <div class="modal-brand">
                        <div class="brand-icon">
                            <i class="fas fa-cloud-upload-alt"></i>
                        </div>
                        <div>
                            <h1 class="modal-title">Submitting to LHDN</h1>
                            <p class="modal-subtitle">Please wait while we process your document</p>
                        </div>
                    </div>
                    <div class="modal-meta">
                        <div class="meta-item">
                            <span class="meta-label">Process</span>
                            <span class="meta-value">LHDN</span>
                        </div>
                        <div class="meta-item">
                            <span class="meta-label">Status</span>
                            <span class="meta-value">Processing</span>
                        </div>
                    </div>
                </div>

                <div class="modal-content-section" style="padding: 0;">
                    <div class="progress-container">
                        <div class="progress-steps">
                            ${getSubmissionStepHtml(1, 'Validating Document')}
                            ${getSubmissionStepHtml(2, 'Submit to LHDN')}
                            ${getSubmissionStepHtml(3, 'Processing')}
                        </div>
                    </div>

                    <!-- Messages below the steps -->
                    <div class="submission-messages">
                        <!-- Estimated Time Display -->
                        <div class="estimated-time">
                            <div class="estimated-time-label">Estimated Time</div>
                            <div class="estimated-time-value">2-3 minutes</div>
                        </div>

                        <!-- Helpful Tips -->
                        <div class="submission-tips">
                            <div class="submission-tips-title">
                                <i class="fas fa-lightbulb"></i>
                                Did you know?
                            </div>
                            <div class="submission-tips-content">
                                LHDN processes e-invoices within 72 hours. You'll receive real-time status updates in your dashboard.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Create and show enhanced modern submission modal
        console.log('📦 Creating enhanced modern submission modal');
        submissionModal = await Swal.fire({
            html: modernSubmissionStepsHtml,
            showConfirmButton: false,
            allowOutsideClick: false,
            allowEscapeKey: false,
            width: 580, // Reduced from 800 for better proportions
            padding: '0',
            background: 'transparent',
            customClass: {
                popup: 'modern-modal modern-submission-container'
            },
            didOpen: async () => {
                try {
                    // Verify modern submission steps were created
                    console.log('🔍 Verifying modern submission step elements:');
                    for (let i = 1; i <= 3; i++) {
                        const step = document.getElementById(`modernSubmissionStep${i}`);
                        if (step) {
                            console.log(`✅ Modern Submission Step ${i} element found`);
                        } else {
                            console.error(`❌ Modern Submission Step ${i} element not found`);
                        }
                    }

                    // Step 1: Internal Validation
                    console.log('🔍 Starting Step 1: Document Validation');
                    await updateStepStatus(1, 'processing', 'Validating document...');
                    const validatedData = await performStep1(fileName, type, company, date);

                    if (!validatedData) {
                        throw new ValidationError('No data available for validation', [], fileName);
                    }
                    await updateStepStatus(1, 'completed', 'Validation completed');

                    // Step 2: Submit to LHDN
                    console.log('📤 Starting Step 2: LHDN Submission');
                    await updateStepStatus(2, 'processing', 'Submitting to LHDN...');

                    // Add the original parameters to the validated data
                    const submissionData = {
                        ...validatedData,
                        fileName,
                        type,
                        company,
                        date,
                        version
                    };

                    const submitted = await performStep2(submissionData, version);

                    if (!submitted) {
                        throw new Error('LHDN submission failed');
                    }
                    await updateStepStatus(2, 'completed', 'Submission completed');

                    // Step 3: Process Response
                    console.log('⚙️ Starting Step 3: Processing');
                    await updateStepStatus(3, 'processing', 'Processing response...');
                    const processed = await performStep3(submitted);

                    if (!processed) {
                        throw new Error('Response processing failed');
                    }
                    await updateStepStatus(3, 'completed', 'Processing completed');

                    console.log('🎉 All steps completed successfully');
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    if (submissionModal) {
                        submissionModal.close();
                    }

                    await showSuccessMessage(fileName, version);
                    // Use the new function to update just this document instead of refreshing the whole table
                    await updateSingleDocumentStatus(fileName);
                } catch (error) {
                    console.error('❌ Step execution failed:', error);

                    // Find the current processing step and update its status to error
                    const currentStep = document.querySelector('.step-card.processing');
                    if (currentStep) {
                        const stepNumber = parseInt(currentStep.id.replace('step', ''));
                        console.log(`⚠️ Updating step ${stepNumber} to error state`);
                        await updateStepStatus(stepNumber, 'error', 'Error occurred');
                    }

                    // Add delay for visual feedback
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    // Close the current modal
                    if (submissionModal) {
                        submissionModal.close();
                    }

                    // Show appropriate error modal based on error type
                    if (error instanceof ValidationError) {
                        console.log('📋 Showing Excel validation error modal');
                        await showExcelValidationError(error);
                    } else {
                        console.log('🔴 Showing LHDN error modal');
                        await showLHDNErrorModal(error);
                    }
                    throw error; // Re-throw to be caught by outer catch
                }
            }
        });

        return true;

    } catch (error) {
        console.error('❌ Submission process failed:', error);

        // Show appropriate error modal based on error type
        if (error instanceof ValidationError) {
            console.log('📋 Showing Excel validation error modal');
            await showExcelValidationError(error);
        } else {
            console.log('🔴 Showing LHDN error modal');
            await showLHDNErrorModal(error);
        }
        return false;
    }
}

async function performStep2(data, version) {
    try {
        console.log('🚀 [Step 2] Starting LHDN submission with data:', data);
        await updateStepStatus(2, 'processing', 'Connecting to LHDN...');
        await updateStepStatus(2, 'processing', 'Preparing Documents...');
        console.log('📤 [Step 2] Initiating submission to LHDN');

        // Extract the required parameters from the data
        const {
            fileName,
            type,
            company,
            date
        } = data;

        // Store submission info in localStorage in case of server disconnection
        const submissionInfo = {
            fileName,
            type,
            company,
            date,
            version,
            timestamp: new Date().toISOString()
        };
        localStorage.setItem('pendingLHDNSubmission', JSON.stringify(submissionInfo));

        // Set a longer timeout for the fetch request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout

        try {
            // Make the API call with all required parameters and timeout
            const response = await fetch(`/api/outbound-files/${fileName}/submit-to-lhdn`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    type,
                    company,
                    date,
                    version
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // Check if response is valid
            if (!response.ok) {
                const result = await response.json();
                console.error('❌ [Step 2] API error response:', result);
                console.error('❌ [Step 2] Full error object:', JSON.stringify(result, null, 2));
                await updateStepStatus(2, 'error', 'Submission failed');
                
                // Pass the full error object, not just result.error
                // The error might be in result.error or result itself
                const errorToShow = result.error || result;
                console.log('📋 [Step 2] Error to show:', errorToShow);
                await showLHDNErrorModal(errorToShow);
                throw new Error('LHDN submission failed');
            }

            const result = await response.json();

            // Clear the pending submission from localStorage
            localStorage.removeItem('pendingLHDNSubmission');

            console.log('✅ [Step 2] Submission successful:', result);
            await updateStepStatus(2, 'completed', 'Submission completed');

            // Show notification about logging
           // showLoggingNotification();

            return result;

        } catch (fetchError) {
            // Handle network errors or timeouts
            if (fetchError.name === 'AbortError') {
                console.warn('⚠️ [Step 2] Request timed out, but submission might still be processing');
                await updateStepStatus(2, 'processing', 'Request timed out, checking status...');

                // Wait a moment and then check if the document was actually submitted
                await new Promise(resolve => setTimeout(resolve, 5000));

                try {
                    // Check document status
                    const statusResponse = await fetch(`/api/outbound-files/status/${fileName}`);
                    const statusResult = await statusResponse.json();

                    if (statusResult.success && statusResult.exists &&
                        ['Submitted', 'Processing'].includes(statusResult.document.status)) {
                        // Document was actually submitted successfully
                        console.log('✅ [Step 2] Document was submitted despite timeout');
                        await updateStepStatus(2, 'completed', 'Submission completed (verified)');

                        // Clear the pending submission
                        localStorage.removeItem('pendingLHDNSubmission');

                        return {
                            success: true,
                            message: 'Document submitted successfully (verified after timeout)',
                            document: statusResult.document
                        };
                    }
                } catch (statusError) {
                    console.error('❌ [Step 2] Error checking document status:', statusError);
                }

                // If we get here, the submission status is unknown
                await updateStepStatus(2, 'error', 'Submission status unknown');
                throw new Error('Submission timed out. Please check the document status in a few minutes.');
            }

            // For other fetch errors
            console.error('❌ [Step 2] Fetch error:', fetchError);
            await updateStepStatus(2, 'error', 'Connection error');
            throw fetchError;
        }

    } catch (error) {
        console.error('❌ [Step 2] LHDN submission failed:', error);
        await updateStepStatus(2, 'error', 'Submission failed');
        throw error;
    }
}

async function performStep3(response) {
    console.log('🚀 [Step 3] Starting response processing');

    try {
        // Start processing
        console.log('📝 [Step 3] Processing LHDN response');
        await updateStepStatus(3, 'processing', 'Processing response...');

        // Process response
        if (!response || !response.success) {
            console.error('❌ [Step 3] Invalid response data');
        }

        console.log('📝 [Step 3] Response data:', response ? 'Data present' : 'No data');
        if (!response) {
            console.error('❌ [Step 3] No response data to process');
            console.log('Updating step status to error...');
            await updateStepStatus(3, 'error', 'Processing failed');
            throw new Error('No response data to process');
        }

        // Simulate processing time (if needed)
        console.log('⏳ [Step 3] Processing response data...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Complete successfully
        console.log('✅ [Step 3] Response processing completed');
        console.log('Updating step status to completed...');
        await updateStepStatus(3, 'completed', 'Processing completed');

        return true;
    } catch (error) {
        console.error('❌ [Step 3] Response processing failed:', error);
        console.error('Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        console.log('Updating step status to error...');
        await updateStepStatus(3, 'error', 'Processing failed');
        throw error;
    }
}

async function cancelDocument(uuid, fileName, submissionDate) {
    console.log('Cancelling document:', { uuid, fileName });
    try {
        const content = `
        <div class="content-card swal2-content">
            <div style="margin-bottom: 15px; text-align: center;">
                <div class="warning-icon" style="color: #f8bb86; font-size: 24px; margin-bottom: 10%; animation: pulseWarning 1.5s infinite;">
                    <i class="fas fa-exclamation-triangle"></i>
                </div>
                <h3 style="color: #595959; font-size: 1.125rem; margin-bottom: 5px;">Document Details</h3>
                <div style="background: #fff3e0; border-left: 4px solid #f8bb86; padding: 8px; margin: 8px 0; border-radius: 4px; text-align: left;">
                    <i class="fas fa-info-circle" style="color: #f8bb86; margin-right: 5px;"></i>
                    This action cannot be undone
                </div>
            </div>

            <div style="text-align: left; margin-bottom: 12px; padding: 8px; border-radius: 8px; background: rgba(248, 187, 134, 0.1);">
                <div style="margin-bottom: 6px; padding: 6px; border-radius: 4px;">
                    <span style="color: #595959; font-weight: 600;">File Name:</span>
                    <span style="color: #595959;">${fileName}</span>
                </div>
                <div style="margin-bottom: 6px; padding: 6px; border-radius: 4px;">
                    <span style="color: #595959; font-weight: 600;">UUID:</span>
                    <span style="color: #595959;">${uuid}</span>
                            </div>
                            <div>
                    <span style="color: #595959; font-weight: 600;">Submission Date:</span>
                    <span style="color: #595959;">${submissionDate}</span>
                            </div>
                        </div>

            <div style="margin-top: 12px;">
                <label style="display: block; color: #595959; font-weight: 600; margin-bottom: 5px;">
                    <i class="fas fa-exclamation-circle" style="color: #f8bb86; margin-right: 5px;"></i>
                    Cancellation Reason <span style="color: #dc3545;">*</span>
                </label>
                <textarea
                    id="cancellationReason"
                    class="swal2-textarea"
                    style="width: 80%; height: 30%; min-height: 70px; resize: none; border: 1px solid #d9d9d9; border-radius: 4px; padding: 8px; margin-top: 5px; transition: all 0.3s ease; font-size: 1rem;"
                    placeholder="Please provide a reason for cancellation"
                    onkeyup="this.style.borderColor = this.value.trim() ? '#28a745' : '#dc3545'"
                ></textarea>
            </div>
        </div>

        <style>
            @keyframes pulseWarning {
                0% { transform: scale(1); }
                50% { transform: scale(1.15); }
                100% { transform: scale(1); }
            }

            .warning-icon {
                animation: pulseWarning 1.5s infinite;
            }
        </style>
    `;

        // Initial confirmation dialog using createSemiMinimalDialog
        const result = await Swal.fire({
            title: 'Cancel Document',
            text: 'Are you sure you want to cancel this document?',
            html: content,
            showCancelButton: true,
            confirmButtonText: 'Yes, cancel it',
            cancelButtonText: 'No, keep it',
            width: 480,
            padding: '1.5rem',
            customClass: {
                confirmButton: 'outbound-action-btn submit',
                cancelButton: 'outbound-action-btn cancel',
                popup: 'semi-minimal-popup'
            },
            preConfirm: () => {
                const reason = document.getElementById('cancellationReason').value;
                if (!reason.trim()) {
                    Swal.showValidationMessage('Please provide a cancellation reason');
                    return false;
                }
                return reason;
            }
        });

        if (!result.isConfirmed) {
            console.log('Cancellation cancelled by user');
            return;
        }

        const cancellationReason = result.value;
        console.log('Cancellation reason:', cancellationReason);

        // Show loading state
        Swal.fire({
            title: 'Cancelling Document...',
            text: 'Please wait while we process your request',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        console.log('Making API request to cancel document...');
        const response = await fetch(`/api/outbound-files/${uuid}/cancel`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reason: cancellationReason })
        });

        console.log('API Response status:', response.status);
        const data = await response.json();
        console.log('API Response data:', data);

        if (!response.ok) {
            throw new Error(data.error?.message || data.message || 'Failed to cancel document');
        }
        await Swal.fire({
            title: 'Cancelled Successfully',
            html: `
                <div class="content-card swal2-content" style="animation: slideIn 0.3s ease-out; max-height: 280px;">
                    <div style="text-align: center; margin-bottom: 18px;">
                        <div class="success-icon" style="color: #28a745; font-size: 28px; animation: pulseSuccess 1.5s infinite;">
                            <i class="fas fa-check-circle"></i>
                        </div>
                        <div style="background: #d4edda; border-left: 4px solid #28a745; padding: 6px; margin: 8px 0; border-radius: 4px; text-align: left;">
                            <i class="fas fa-info-circle" style="color: #28a745; margin-right: 5px;"></i>
                            Invoice cancelled successfully
                        </div>
                    </div>

                    <div style="text-align: left; padding: 8px; border-radius: 8px; background: rgba(40, 167, 69, 0.05);">
                        <div style="color: #595959; font-weight: 500; margin-bottom: 8px;">Document Details:</div>
                        <div style="margin-bottom: 4px;">
                            <span style="color: #595959; font-weight: 500;">File Name:</span>
                            <span style="color: #595959; font-size: 0.9em;">${fileName}</span>
                        </div>
                        <div style="margin-bottom: 4px;">
                            <span style="color: #595959; font-weight: 500;">UUID:</span>
                            <span style="color: #595959; font-size: 0.9em;">${uuid}</span>
                        </div>
                        <div>
                            <span style="color: #595959; font-weight: 500;">Time:</span>
                            <span style="color: #595959; font-size: 0.9em;">${new Date().toLocaleString()}</span>
                        </div>
                    </div>
                </div>

                <style>
                    @keyframes pulseSuccess {
                        0% { transform: scale(1); }
                        50% { transform: scale(1.15); }
                        100% { transform: scale(1); }
                    }

                    @keyframes slideIn {
                        from { transform: translateY(-10px); opacity: 0; }
                        to { transform: translateY(0); opacity: 1; }
                    }

                    .success-icon {
                        animation: pulseSuccess 1.5s infinite;
                    }
                </style>
            `,
            customClass: {
                confirmButton: 'outbound-action-btn submit',
                popup: 'semi-minimal-popup'
            }
        });
        console.log('Document cancelled successfully');

        // Update just this document's status instead of refreshing the entire table
        try {
            console.log('Updating document status in table for:', fileName);
            await updateSingleDocumentStatus(fileName);
        } catch (updateError) {
            console.warn('Error updating single document status, falling back to full refresh:', updateError);
            InvoiceTableManager.getInstance().refresh();
        }

    } catch (error) {
        console.error('Error in cancellation process:', error);

        // Show error message using createSemiMinimalDialog
        await Swal.fire({
            title: 'Error',
            html: `
                <div class="text-left">
                    <p class="text-danger">${error.message}</p>
                    <div class="mt-2 text-gray-600">
                        <strong>Technical Details:</strong><br>
                        File Name: ${fileName}<br>
                        UUID: ${uuid}
                    </div>
                </div>
            `,
            customClass: {
                confirmButton: 'outbound-action-btn submit',
                cancelButton: 'outbound-action-btn cancel',
                popup: 'semi-minimal-popup'
            }
        });
    }
}

async function deleteDocument(fileName, type, company, date) {
    try {
        console.log('Deleting document:', fileName);

        // First, confirm the deletion
        const result = await Swal.fire({
            title: 'Delete Document',
            html: `
                <div class="mb-3">
                    <p>Are you sure you want to delete this document? (${fileName})</p>
                </div>
                <div class="alert alert-info">
                    <i class="fas fa-info-circle"></i> All files with the same name will be deleted.
                </div>
            `,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Yes, delete all files!'
        });

        if (!result.isConfirmed) {
            return;
        }

        // Show loading
        Swal.fire({
            title: 'Deleting...',
            text: 'Please wait while we delete all matching documents.',
            allowOutsideClick: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        // Make the API call to delete the document with deleteAll=true
        //const url = `/api/outbound-files/${fileName}?type=${type}&company=${company}&date=${date}&deleteAll=true`;
        // Add a new function or modify existing to call with deleteByInvoice
        const url = `/api/outbound-files/${fileName}?type=${type}&company=${company}&date=${date}&deleteByInvoice=true`;
        console.log('Delete URL:', url);

        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            },
            credentials: 'same-origin' // Include credentials to send cookies with the request
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Failed to delete document');
        }

        const data = await response.json();

        // Prepare success message based on the response
        let successMessage = `${fileName} has been deleted successfully`;
        let successDetails = 'The file has been permanently deleted from the system.';

        if (data.deletedFiles && data.deletedFiles.length > 0) {
            successMessage = `Deleted ${data.deletedFiles.length} files successfully`;
            successDetails = `All files with the name "${fileName}" have been permanently deleted from the system.`;

            if (data.failedFiles && data.failedFiles.length > 0) {
                successDetails += `<br><br>Note: ${data.failedFiles.length} files could not be deleted.`;
            }
        }

        // Show success message
        await Swal.fire({
            html: createSemiMinimalDialog({
                title: 'Document Deleted',
                subtitle: successMessage,
                content: `
                    <div class="content-card">
                        <div class="content-header">
                            <span class="content-badge success">
                                <i class="fas fa-check-circle"></i>
                            </span>
                            <span class="content-title">Success</span>
                        </div>
                        <div class="content-desc">
                            ${successDetails}
                        </div>
                    </div>
                `
            }),
            customClass: {
                confirmButton: 'outbound-action-btn submit',
                popup: 'semi-minimal-popup'
            }
        });

        // Remove the row from the table directly instead of refreshing the entire table
        const tableManager = InvoiceTableManager.getInstance();
        if (tableManager.table) {
            // Find the row with the matching fileName and remove it
            const row = tableManager.table.row(`[id="${fileName}"]`);
            if (row.length) {
                row.remove().draw(false);
                console.log('Row removed from table:', fileName);

                // Update card totals after removing the row
                tableManager.updateCardTotals();
            } else {
                console.warn('Row not found in table, performing full refresh:', fileName);
                InvoiceTableManager.getInstance().refresh();
            }
        } else {
            console.warn('Table not initialized, performing full refresh');
            InvoiceTableManager.getInstance().refresh();
        }

    } catch (error) {
        console.error('Error deleting document:', error);

        await Swal.fire({
            html: createSemiMinimalDialog({
                title: 'Error',
                subtitle: 'Failed to delete document',
                content: `
                    <div class="content-card">
                        <div class="content-header">
                            <span class="content-badge error">
                                <i class="fas fa-times-circle"></i>
                            </span>
                            <span class="content-title">Error Details</span>
                        </div>
                        <div class="content-desc">
                            ${error.message}
                        </div>
                    </div>
                `
            }),
            customClass: {
                confirmButton: 'outbound-action-btn cancel',
                popup: 'semi-minimal-popup'
            }
        });
    }
}


// Error Modals

function getNextSteps(errorCode) {
    const commonSteps = `
        <li>Review each validation error carefully</li>
        <li>Update the required fields in your document</li>
        <li>Ensure all mandatory information is provided</li>
        <li>Try submitting the document again</li>
    `;

    const specificSteps = {
        'DS302': `
            <li>Check the document status in LHDN portal</li>
            <li>If you need to submit a correction, use the amendment feature</li>
            <li>Contact support if you need assistance with amendments</li>
        `,
        'DUPLICATE_SUBMISSION': `
            <li>Check the document status in the system</li>
            <li>Wait for the current submission to complete</li>
            <li>Contact support if you need to resubmit</li>
        `,
        'CF321': `
            <li>Check the document's issue date</li>
            <li>Documents must be submitted within 7 days of issuance</li>
            <li>Create a new document with current date if needed</li>
        `,
        'CF364': `
            <li>Review the item classification codes</li>
            <li>Ensure all items have valid classification codes</li>
            <li>Update missing or invalid classifications</li>
        `,
        'AUTH_ERROR': `
            <li>Click the "Logout and Refresh Token" button above</li>
            <li>Log back in to refresh your authentication token</li>
            <li>Try submitting the document again</li>
            <li>If the problem persists, contact your system administrator</li>
        `,
        'AUTH001': `
            <li>Try logging out and logging back in</li>
            <li>Check your internet connection</li>
            <li>Contact support if the issue persists</li>
        `
    };

    return specificSteps[errorCode] || commonSteps;
}

// Helper function to group validation errors by type
function groupValidationErrors(errors) {
    const groups = {};
    errors.forEach(error => {
        const type = error.type || 'VALIDATION_ERROR';
        if (!groups[type]) {
            groups[type] = [];
        }
        groups[type].push(error);
    });
    return groups;
}

// Helper function to get icon for error type
function getErrorTypeIcon(type) {
    const icons = {
        'DS302': 'fa-copy',
        'CF321': 'fa-calendar-times',
        'CF364': 'fa-tags',
        'CF401': 'fa-calculator',
        'CF402': 'fa-money-bill',
        'CF403': 'fa-percent',
        'CF404': 'fa-id-card',
        'CF405': 'fa-address-card',
        'AUTH001': 'fa-lock',
        'DUPLICATE_SUBMISSION': 'fa-copy',
        'VALIDATION_ERROR': 'fa-exclamation-circle',
        'DB_ERROR': 'fa-database',
        'SUBMISSION_ERROR': 'fa-exclamation-triangle'
    };
    return icons[type] || 'fa-exclamation-circle';
}

// Helper function to format error type for display
function formatErrorType(type) {
    const typeMap = {
        'DS302': 'Duplicate Document',
        'CF321': 'Date Validation',
        'CF364': 'Classification',
        'CF401': 'Tax Calculation',
        'CF402': 'Currency',
        'CF403': 'Tax Code',
        'CF404': 'Identification',
        'CF405': 'Party Information',
        'AUTH001': 'Authentication',
        'DUPLICATE_SUBMISSION': 'Duplicate Submission',
        'VALIDATION_ERROR': 'Validation Error',
        'DB_ERROR': 'Database Error',
        'SUBMISSION_ERROR': 'Submission Error'
    };
    return typeMap[type] || type.replace(/_/g, ' ');
}

async function showErrorModal(title, message, fileName, uuid) {
    await Swal.fire({
        icon: 'error',
        title: title,
        html: `
            <div class="text-left">
                <p class="text-danger">${message}</p>
                <div class="small text-muted mt-2">
                    <strong>Technical Details:</strong><br>
                    File Name: ${fileName}<br>
                    UUID: ${uuid}
                </div>
            </div>
        `,
        confirmButtonText: 'OK',
        customClass: {
            confirmButton: 'btn btn-primary',
            cancelButton: 'btn btn-secondary',
            popup: 'semi-minimal-popup'
        },
    });
}

async function showExcelValidationError(error) {
    console.log('Showing validation error for file:', error.fileName, 'Error:', error);

    // Add delay before showing the validation error modal
    await new Promise(resolve => setTimeout(resolve, 500));

    // Format validation errors for display with user-friendly messages
    let errorContent = '';
    if (error.validationErrors && error.validationErrors.length > 0) {
        // Process and make validation errors more user-friendly
        const processedErrors = error.validationErrors.map(err => {
            if (typeof err === 'object' && err.errors) {
                const errors = Array.isArray(err.errors) ? err.errors : [err.errors];
                return {
                    row: err.row || 'Unknown Row',
                    errors: errors.map(e => {
                        const errorText = typeof e === 'object' ? e.message : e;
                        // Convert technical error messages to user-friendly ones
                        if (errorText.includes('invoiceCodeNumber')) {
                            return 'Invoice number is missing or invalid. Please ensure each invoice has a unique invoice number.';
                        }
                        if (errorText.includes('Validation Error')) {
                            return errorText.replace('Validation Error', 'Data validation issue');
                        }
                        if (errorText.includes('TIN')) {
                            return 'Tax Identification Number (TIN) is missing or invalid. Please verify the TIN format.';
                        }
                        if (errorText.includes('required')) {
                            return errorText.replace('is required', 'must be provided');
                        }
                        return errorText;
                    })
                };
            }
            return { row: 'General', errors: [err] };
        });

        errorContent = `
            <div class="error-code-badge">
                <i class="fas fa-file-excel"></i>
                EXCEL_VALIDATION_ERROR
            </div>
            <div class="error-message">
                <h6><i class="fas fa-exclamation-triangle"></i> Validation Issues Found</h6>
                <p>Your Excel file contains the following issues that must be resolved before submission:</p>
                <div class="error-list-container">
                    ${processedErrors.map(errorGroup => `
                        <div class="error-group">
                            <div class="error-group-header">
                                <i class="fas fa-table"></i>
                                <span>${errorGroup.row}</span>
                            </div>
                            <ul class="error-list">
                                ${errorGroup.errors.map((err, index) => `
                                    <li class="error-item">
                                        <span class="error-number">${index + 1}</span>
                                        <span class="error-text">${err}</span>
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    } else {
        // Handle generic validation error
        const friendlyMessage = error.message
            ? error.message.replace('Validation Error', 'Data validation issue')
            : 'Your Excel file contains validation errors that prevent submission to LHDN.';

        errorContent = `
            <div class="error-code-badge">
                <i class="fas fa-file-excel"></i>
                EXCEL_VALIDATION_ERROR
            </div>
            <div class="error-message">
                <h6><i class="fas fa-exclamation-triangle"></i> Validation Error</h6>
                <p>${friendlyMessage}</p>
            </div>
        `;
    }

    // Add helpful guidance section
    const guidance = `
        <div class="error-suggestion">
            <h6><i class="fas fa-lightbulb"></i> How to Fix This</h6>
            <p>Please correct the validation errors in your Excel file and try uploading again.</p>
            <div class="suggestion-steps">
                <div class="suggestion-step">
                    <i class="fas fa-check-circle"></i>
                    <span>Ensure all required fields are properly filled</span>
                </div>
                <div class="suggestion-step">
                    <i class="fas fa-check-circle"></i>
                    <span>Verify data formats match LHDN requirements</span>
                </div>
                <div class="suggestion-step">
                    <i class="fas fa-check-circle"></i>
                    <span>Check for duplicate or missing invoice numbers</span>
                </div>
            </div>
        </div>

        <div class="error-information">
            <h6><i class="fas fa-info-circle"></i> Need Help?</h6>
            <p>If you continue to experience validation errors, please refer to the LHDN Excel template guidelines or contact support for assistance.</p>
        </div>
    `;

    // Use the modern error modal template for consistency
    return Swal.fire({
        html: createModernErrorModal({
            title: 'Excel Validation Failed',
            subtitle: 'Please correct the issues below and try again',
            content: errorContent + guidance
        }),
        showConfirmButton: false,
        showCancelButton: false,
        width: 600,
        padding: 0,
        background: 'transparent',
        customClass: {
            popup: 'modern-error-popup'
        }
    }).then((result) => {
        if (result.isConfirmed && error.fileName) {
            //openExcelFile(error.fileName);
        }
    });
}

async function showSystemErrorModal(error) {
    console.log('System Error:', error);

    // Function to get user-friendly error message
    function getErrorMessage(error) {
        const statusMessages = {
            '401': 'Authentication failed. Please try logging in again.',
            '403': 'You do not have permission to perform this action.',
            '404': 'The requested resource was not found.',
            '500': 'An internal server error occurred.',
            'default': 'An unexpected error occurred while processing your request.'
        };

        if (error.message && error.message.includes('status code')) {
            const statusCode = error.message.match(/\d+/)[0];
            return statusMessages[statusCode] || statusMessages.default;
        }

        return error.message || statusMessages.default;
    }
    const content = `
        <div class="content-card">
            <div class="content-header">
                <span class="content-badge error">
                    <i class="fas fa-exclamation-circle"></i>
                </span>
                <span class="content-title">System Error</span>
            </div>
            <div class="content-desc">
                ${getErrorMessage(error)}
                ${error.invoice_number ? `
                    <div style="margin-top: 0.5rem;">
                        <i class="fas fa-file-invoice"></i>
                        Invoice Number: ${error.invoice_number}
                    </div>
                ` : ''}
            </div>
        </div>
    `;

    return Swal.fire({
        html: createSemiMinimalDialog({
            title: error.type || 'System Error',
            subtitle: 'Please review the following issue:',
            content: content
        }),
        confirmButtonText: 'I Understand',
        confirmButtonColor: '#405189',
        width: 480,
        padding: '1.5rem',
        showClass: {
            popup: 'animate__animated animate__fadeIn'
        },
        hideClass: {
            popup: 'animate__animated animate__fadeOut'
        },
        customClass: {
            confirmButton: 'btn btn-primary',
            popup: 'semi-minimal-popup'
        }
    });
}

async function showLHDNErrorModal(error) {
    console.log('LHDN Error (raw):', error);
    console.log('LHDN Error (stringified):', JSON.stringify(error, null, 2));

    // Parse and format the error object to ensure we have proper details
    let formattedError = error;

    // Handle string errors that might be JSON
    if (typeof error === 'string') {
        try {
            formattedError = JSON.parse(error);
        } catch (e) {
            // If not valid JSON, create a basic error object
            formattedError = {
                message: error,
                code: 'SUBMISSION_ERROR'
            };
        }
    }

    // Parse fullResponse if it exists (contains the actual error details from LHDN)
    // According to LHDN standard: https://sdk.myinvois.hasil.gov.my/standard-error-response/
    // Structure: {"error": {"errorCode": "...", "error": "...", "innerError": [...]}}
    if (typeof formattedError === 'object' && formattedError.fullResponse) {
        try {
            const parsedFullResponse = typeof formattedError.fullResponse === 'string' 
                ? JSON.parse(formattedError.fullResponse) 
                : formattedError.fullResponse;
            
            console.log('Parsed fullResponse:', parsedFullResponse);
            
            // Extract error from fullResponse if available (LHDN standard structure)
            if (parsedFullResponse.error) {
                const fullResponseError = parsedFullResponse.error;
                
                // LHDN uses errorCode (not code) and error (not message)
                if (fullResponseError.errorCode) {
                    formattedError.code = fullResponseError.errorCode;
                    formattedError.errorCode = fullResponseError.errorCode;
                }
                
                // LHDN uses "error" field for English message
                if (fullResponseError.error) {
                    formattedError.message = fullResponseError.error;
                    formattedError.error = fullResponseError.error;
                }
                
                // LHDN uses "errorMS" for Malay message (optional)
                if (fullResponseError.errorMS) {
                    formattedError.errorMS = fullResponseError.errorMS;
                }
                
                // LHDN uses innerError array (not details) for nested errors
                if (fullResponseError.innerError && Array.isArray(fullResponseError.innerError) && fullResponseError.innerError.length > 0) {
                    // Convert innerError to details format for consistency
                    formattedError.details = fullResponseError.innerError.map(innerErr => ({
                        code: innerErr.errorCode || fullResponseError.errorCode || formattedError.code,
                        errorCode: innerErr.errorCode || fullResponseError.errorCode,
                        message: innerErr.error || innerErr.errorMS || 'Unknown error',
                        error: innerErr.error,
                        errorMS: innerErr.errorMS,
                        propertyName: innerErr.propertyName,
                        propertyPath: innerErr.propertyPath,
                        target: innerErr.target || innerErr.propertyName
                    }));
                    
                    // Use the first innerError's message if main error message is generic
                    if (!formattedError.message || formattedError.message.includes('status code') || formattedError.message.includes('HTTP')) {
                        const firstInnerError = fullResponseError.innerError[0];
                        if (firstInnerError.error) {
                            formattedError.message = firstInnerError.error;
                        }
                    }
                } else if (fullResponseError.error) {
                    // If no innerError but has error message, use that
                    formattedError.message = fullResponseError.error;
                }
            }
        } catch (parseError) {
            console.error('Error parsing fullResponse:', parseError);
            // Continue with original error if parsing fails
        }
    }

    // Handle direct LHDN standard error structure (when error comes directly from API)
    // According to LHDN standard: https://sdk.myinvois.hasil.gov.my/standard-error-response/
    // Structure: {error: {errorCode: "...", error: "...", innerError: [...]}}
    if (typeof formattedError === 'object' && formattedError.error && typeof formattedError.error === 'object' && !formattedError.fullResponse) {
        const lhdnError = formattedError.error;
        
        // Extract LHDN standard fields
        if (lhdnError.errorCode) {
            formattedError.errorCode = lhdnError.errorCode;
            formattedError.code = lhdnError.errorCode;
        }
        
        if (lhdnError.error) {
            formattedError.error = lhdnError.error;
            formattedError.message = lhdnError.error;
        }
        
        if (lhdnError.errorMS) {
            formattedError.errorMS = lhdnError.errorMS;
        }
        
        // Handle innerError array (LHDN standard)
        if (lhdnError.innerError && Array.isArray(lhdnError.innerError)) {
            formattedError.innerError = lhdnError.innerError;
            formattedError.details = lhdnError.innerError.map(innerErr => ({
                code: innerErr.errorCode || lhdnError.errorCode || formattedError.code,
                errorCode: innerErr.errorCode || lhdnError.errorCode,
                message: innerErr.error || innerErr.errorMS || 'Unknown error',
                error: innerErr.error,
                errorMS: innerErr.errorMS,
                propertyName: innerErr.propertyName,
                propertyPath: innerErr.propertyPath,
                target: innerErr.target || innerErr.propertyName
            }));
        }
        
        // Handle propertyName and propertyPath (LHDN standard)
        if (lhdnError.propertyName) {
            formattedError.propertyName = lhdnError.propertyName;
        }
        if (lhdnError.propertyPath) {
            formattedError.propertyPath = lhdnError.propertyPath;
        }
        if (lhdnError.target) {
            formattedError.target = lhdnError.target;
        }
    }

    // Extract nested error details from details.error.details structure
    // This handles the case where error structure is:
    // { code: 'REJECTION', message: '...', details: { error: { details: [...] } } }
    if (typeof formattedError === 'object' && formattedError.details) {
        // Check if details contains an error object with nested details
        if (formattedError.details.error && formattedError.details.error.details) {
            const nestedErrorDetails = formattedError.details.error.details;
            
            // Extract the nested error details array
            let extractedDetails = [];
            if (Array.isArray(nestedErrorDetails)) {
                extractedDetails = nestedErrorDetails.map(detail => {
                    // Ensure each detail has proper structure
                    if (typeof detail === 'string') {
                        return { message: detail, code: formattedError.details.error.code || formattedError.code };
                    } else if (typeof detail === 'object') {
                        return {
                            code: detail.code || formattedError.details.error.code || formattedError.code,
                            message: detail.message || detail.toString(),
                            target: detail.target || formattedError.details.invoiceCodeNumber || null,
                            propertyPath: detail.propertyPath || null
                        };
                    }
                    return detail;
                });
            } else if (typeof nestedErrorDetails === 'object') {
                extractedDetails = [{
                    code: nestedErrorDetails.code || formattedError.details.error.code || formattedError.code,
                    message: nestedErrorDetails.message || formattedError.details.error.message || 'Validation Error',
                    target: nestedErrorDetails.target || formattedError.details.invoiceCodeNumber || null,
                    propertyPath: nestedErrorDetails.propertyPath || null
                }];
            }

            // Also include the invoiceCodeNumber if available and not already in details
            if (formattedError.details.invoiceCodeNumber) {
                const hasInvoiceCode = extractedDetails.some(d => 
                    d.message && d.message.includes(formattedError.details.invoiceCodeNumber)
                );
                if (!hasInvoiceCode) {
                    extractedDetails.unshift({
                        code: formattedError.details.error.code || formattedError.code || 'REJECTION',
                        message: `invoiceCodeNumber: ${formattedError.details.invoiceCodeNumber}`,
                        target: formattedError.details.invoiceCodeNumber,
                        propertyPath: null
                    });
                }
            }

            // Include the main error message if it's different from the nested error message
            const mainErrorCode = formattedError.details.error.code || formattedError.code || 'REJECTION';
            const mainErrorMessage = formattedError.details.error.message || formattedError.message || 'Document was rejected by LHDN';
            
            // Reconstruct the error with properly extracted details
            formattedError = {
                code: mainErrorCode,
                message: mainErrorMessage,
                details: extractedDetails.length > 0 ? extractedDetails : [{
                    code: mainErrorCode,
                    message: mainErrorMessage,
                    target: formattedError.details.invoiceCodeNumber || formattedError.details.error.target || null,
                    propertyPath: formattedError.details.error.propertyPath || null
                }]
            };
        }
        // Handle case where details.error exists but doesn't have nested details
        else if (formattedError.details.error) {
            // Extract error info from details.error
            const errorInfo = formattedError.details.error;
            let extractedDetails = [];
            
            // Include invoiceCodeNumber if available
            if (formattedError.details.invoiceCodeNumber) {
                extractedDetails.push({
                    code: errorInfo.code || formattedError.code,
                    message: `invoiceCodeNumber: ${formattedError.details.invoiceCodeNumber}`,
                    target: formattedError.details.invoiceCodeNumber,
                    propertyPath: null
                });
            }
            
            // Include the error message
            extractedDetails.push({
                code: errorInfo.code || formattedError.code || 'REJECTION',
                message: errorInfo.message || formattedError.message || 'Validation Error',
                target: errorInfo.target || formattedError.details.invoiceCodeNumber || null,
                propertyPath: errorInfo.propertyPath || null
            });
            
            formattedError = {
                code: errorInfo.code || formattedError.code || 'REJECTION',
                message: errorInfo.message || formattedError.message || 'Document was rejected by LHDN',
                details: extractedDetails
            };
        }
        // Handle case where details is an array directly
        else if (Array.isArray(formattedError.details)) {
            // Details is already an array, ensure each item is properly formatted
            formattedError.details = formattedError.details.map(detail => {
                if (typeof detail === 'string') {
                    return { message: detail, code: formattedError.code || 'VALIDATION_ERROR' };
                }
                return detail;
            });
        }
        // Handle case where details is an object but not nested error structure
        else if (typeof formattedError.details === 'object' && !formattedError.details.error) {
            // Convert single detail object to array
            formattedError.details = [formattedError.details];
        }
    }
    
    // Ensure details is always an array for consistent rendering
    if (formattedError && typeof formattedError === 'object' && !Array.isArray(formattedError.details)) {
        if (!formattedError.details) {
            formattedError.details = [];
        } else if (typeof formattedError.details === 'object' && !Array.isArray(formattedError.details)) {
            formattedError.details = [formattedError.details];
        }
    }

    // Log the formatted error for debugging
    console.log('LHDN Error (formatted):', formattedError);
    console.log('LHDN Error Details:', formattedError.details);
    console.log('LHDN Error Details Count:', formattedError.details ? formattedError.details.length : 0);

    // Handle case where error message contains "No documents were accepted or rejected by LHDN"
    if (typeof formattedError === 'object' &&
        (formattedError.message && formattedError.message.includes('No documents were accepted or rejected by LHDN'))) {

        // Extract error details from the stack if available
        let errorDetails = [];
        if (formattedError.stack && typeof formattedError.stack === 'string') {
            // Try to extract JSON from the stack trace
            const jsonMatch = formattedError.stack.match(/\{.*\}/s);
            if (jsonMatch) {
                try {
                    const parsedDetails = JSON.parse(jsonMatch[0]);
                    if (parsedDetails && Array.isArray(parsedDetails)) {
                        errorDetails = parsedDetails;
                    } else if (parsedDetails) {
                        errorDetails = [parsedDetails];
                    }
                } catch (e) {
                    console.error('Failed to parse error details from stack:', e);
                }
            }
        }

        // If we couldn't extract details from stack, check if there's a details property
        if (errorDetails.length === 0 && formattedError.details) {
            if (Array.isArray(formattedError.details)) {
                errorDetails = formattedError.details;
            } else if (typeof formattedError.details === 'object') {
                errorDetails = [formattedError.details];
            } else if (typeof formattedError.details === 'string') {
                try {
                    const parsedDetails = JSON.parse(formattedError.details);
                    errorDetails = Array.isArray(parsedDetails) ? parsedDetails : [parsedDetails];
                } catch (e) {
                    errorDetails = [{message: formattedError.details}];
                }
            }
        }

        // If we still don't have details, create a generic error
        if (errorDetails.length === 0) {
            errorDetails = [{
                code: "SUBMISSION_ERROR",
                message: "No documents were accepted or rejected by LHDN. The service might be unavailable or experiencing issues.",
                target: "SubmissionProcess",
                propertyPath: null
            }];
        }

        // Update the formatted error with the extracted details
        formattedError = {
            code: "SUBMISSION_ERROR",
            message: "No documents were accepted or rejected by LHDN",
            details: errorDetails
        };
    }

    // Handle HTTP error codes - if we have actual error details from fullResponse, use those instead
    // Only create generic HTTP error if we don't have actual error details
    if (typeof formattedError === 'object' && formattedError.status && formattedError.code && formattedError.code.startsWith('HTTP_ERROR_')) {
        // If we have details from fullResponse, don't use the generic HTTP error message
        if (formattedError.details && formattedError.details.length > 0 && formattedError.details[0].message) {
            // We already extracted the actual error, so keep it
            // Just make sure the code reflects the actual error, not the HTTP status
            if (formattedError.details[0].code && !formattedError.details[0].code.startsWith('HTTP_ERROR_')) {
                formattedError.code = formattedError.details[0].code;
            }
        } else if (formattedError.message && formattedError.message.includes('status code')) {
            // Extract status code from message if available
            const statusMatch = formattedError.message.match(/status code (\d+)/);
            if (statusMatch) {
                const statusCode = statusMatch[1];
                formattedError.code = `HTTP_ERROR_${statusCode}`;
            }
        }
    }

    // Check for validation errors in the CF414 format (phone number validation)
    if (typeof formattedError === 'object' && formattedError.message &&
        formattedError.message.includes('Enter valid phone number')) {

        // Create a properly formatted error object for phone validation
        formattedError = {
            code: "CF414",
            message: "Enter valid phone number and the minimum length is 8 characters - SUPPLIER",
            details: [{
                code: "CF414",
                message: "Enter valid phone number and the minimum length is 8 characters - SUPPLIER",
                target: "ContactNumber",
                propertyPath: "Invoice.AccountingSupplierParty.Party.Contact.Telephone"
            }]
        };
    }

    // Import the LHDN UI Helper
    try {
        // Check if lhdnUIHelper is already loaded
        if (typeof lhdnUIHelper === 'undefined') {
            // Load the helper script dynamically if not already loaded
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = '/assets/utils/lhdnUIHelper.js';
                script.onload = resolve;
                script.onerror = () => {
                    console.error('Failed to load LHDN UI Helper');
                    reject(new Error('Failed to load LHDN UI Helper'));
                };
                document.head.appendChild(script);
            });

            console.log('LHDN UI Helper loaded successfully');
        }

        // Use the helper to show the error modal
        const isDuplicateSubmission = formattedError.code === 'DUPLICATE_SUBMISSION' || formattedError.code === 'DS302';

        // Call the helper function to show the modal
        lhdnUIHelper.showLHDNErrorModal(formattedError, {
            title: 'LHDN Submission Error',
            showDetails: true,
            showSuggestion: true,
            onClose: async () => {
                // Refresh the table if this is a duplicate submission error
                // This ensures the table is updated even when a document is already submitted
                if (isDuplicateSubmission) {
                    console.log('Updating table after duplicate submission error');
                    // Extract the filename from the error if possible
                    let fileName = window.currentFileName;
                    if (formattedError.target && typeof formattedError.target === 'string') {
                        // If target contains the document number, use that to help identify the file
                        fileName = formattedError.target;
                    }

                    // Use the more efficient single document update instead of full refresh
                    if (fileName) {
                        await updateSingleDocumentStatus(fileName);
                    } else {
                        // Fallback to full refresh if filename not available
                        InvoiceTableManager.getInstance().refresh();
                    }
                }
            }
        });
    } catch (helperError) {
        console.error('Error using LHDN UI Helper:', helperError);

        // Fallback to modern error display if helper fails
        const errorCode = formattedError.code || 'VALIDATIONERROR';
        const errorMessage = formattedError.message || 'Invalid document data provided.';
        const fallbackHasCf385 = errorCode === 'CF385'
            || (Array.isArray(formattedError.details) && formattedError.details.some((detail) => {
                if (typeof detail === 'string') {
                    return detail.includes('CF385');
                }
                if (detail && typeof detail === 'object') {
                    return detail.code === 'CF385' || detail.errorCode === 'CF385';
                }
                return false;
            }));
        const cf385HowToFixHtml = fallbackHasCf385 ? `
                    <div class="error-information">
                        <h6><i class="fas fa-info-circle"></i> How to Fix</h6>
                        <p>Enter the real product or service name on each line in Excel (column 86). Values like NA are not accepted.</p>
                        <p>LHDN source: Description of Product or Service is mandatory ([1-1]), example “Laptop Peripherals”.</p>
                        <p><a href="https://sdk.myinvois.hasil.gov.my/documents/invoice-v1-0/" target="_blank" rel="noopener noreferrer">Invoice v1.0 – field list</a></p>
                    </div>
        ` : '';

        // Create error details list
        let errorDetailsHtml = '';
        if (formattedError.details && formattedError.details.length > 0) {
            errorDetailsHtml = `
                <div class="error-list-container">
                    <div class="error-group">
                        <div class="error-group-header">
                            <i class="fas fa-list"></i>
                            <span>Error Details</span>
                        </div>
                        <ul class="error-list">
            `;

            formattedError.details.forEach((detail, index) => {
                let detailMessage = '';
                
                if (typeof detail === 'string') {
                    detailMessage = detail;
                } else if (typeof detail === 'object') {
                    // Handle LHDN standard error structure (errorCode, error, propertyPath)
                    const errorCode = detail.errorCode || detail.code;
                    const errorMessage = detail.error || detail.message || detail.errorMS;
                    
                    // Build a comprehensive error message from the detail object
                    const parts = [];
                    
                    // Add errorCode if available (LHDN standard)
                    if (errorCode) {
                        parts.push(`${errorCode}:`);
                    }
                    
                    // Add error message (primary - LHDN uses "error" field)
                    if (errorMessage) {
                        parts.push(errorMessage);
                    } else if (detail.toString && typeof detail.toString === 'function') {
                        parts.push(detail.toString());
                    }
                    
                    // Add property path if available (LHDN standard)
                    if (detail.propertyPath) {
                        parts.push(`(${detail.propertyPath})`);
                    }
                    
                    // Add property name if available (LHDN standard)
                    if (detail.propertyName && detail.propertyName !== detail.target) {
                        parts.push(`[Property: ${detail.propertyName}]`);
                    }
                    
                    // Add target if available and different from message
                    if (detail.target && !errorMessage?.includes(detail.target)) {
                        parts.push(`[Target: ${detail.target}]`);
                    }
                    
                    detailMessage = parts.length > 0 ? parts.join(' ') : JSON.stringify(detail);
                } else {
                    detailMessage = String(detail);
                }
                
                errorDetailsHtml += `
                    <li class="error-item">
                        <span class="error-number">${index + 1}</span>
                        <span class="error-text">${detailMessage}</span>
                    </li>
                `;
            });

            errorDetailsHtml += `
                        </ul>
                    </div>
                </div>
            `;
        }

        const modernErrorHtml = `
            <div class="modern-modal-content">
                    <div class="modal-brand">
                        <div class="brand-icon" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
                            <i class="fas fa-exclamation-triangle"></i>
                        </div>
                        <div>
                            <h1 class="modal-title">LHDN Submission Error</h1>
                            <p class="modal-subtitle">Please review the details below</p>
                        </div>
                    </div>
                    <div class="modal-meta">
                        <div class="meta-item">
                            <span class="meta-label">Error Code</span>
                            <span class="meta-value">${errorCode}</span>
                        </div>
                        <div class="meta-item">
                            <span class="meta-label">Status</span>
                            <span class="meta-value">Failed</span>
                        </div>
                    </div>

                <div class="modal-content-section" style="padding: 2rem;">
                    <div class="error-code-badge">
                        <i class="fas fa-exclamation-triangle"></i>
                        ${errorCode}
                    </div>

                    <div class="error-message">
                        <h6><i class="fas fa-exclamation-circle"></i> LHDN Submission Error</h6>
                        <p>${errorMessage}</p>
                    </div>

                    ${errorDetailsHtml}

                    <div class="error-suggestion">
                        <h6><i class="fas fa-lightbulb"></i> Suggestion</h6>
                        <p>Please check the document and try again</p>
                    </div>

                    ${cf385HowToFixHtml}
                </div>
            </div>
        `;

        Swal.fire({
            html: modernErrorHtml,
            showConfirmButton: true,
            confirmButtonText: 'I Understand',
            width: 800,
            padding: '0',
            background: 'transparent',
            customClass: {
                popup: 'modern-modal large-modal',
                confirmButton: 'modern-btn modern-btn-primary'
            }
        });

        // Still try to refresh the table if needed
        const isDuplicateSubmission =
            (formattedError.code === 'DUPLICATE_SUBMISSION' || formattedError.code === 'DS302') ||
            (typeof formattedError === 'string' && formattedError.includes('duplicate'));

        if (isDuplicateSubmission) {
            InvoiceTableManager.getInstance().refresh();
        }
    }
}

// Helper function to format validation messages
function formatValidationMessage(message) {
    if (!message) return 'Unknown validation error';

    // Enhance common LHDN error messages with more helpful information
    if (message.includes('authenticated TIN and documents TIN is not matching')) {
        return `The TIN (Tax Identification Number) in your document doesn't match with the authenticated TIN.
                Please ensure the supplier's TIN matches exactly with the one registered with LHDN.`;
    }

    // Format other common error messages
    if (message.includes('duplicate')) {
        return 'This document has already been submitted to LHDN. Please check the document status.';
    }

    if (message.includes('invalid date') || message.includes('date format')) {
        return 'The document contains an invalid date format. Please ensure all dates are in the correct format (YYYY-MM-DD).';
    }

    if (message.includes('tax')) {
        return 'There is an issue with the tax information in your document. Please verify all tax amounts and calculations.';
    }

    if (message.includes('required field') || message.includes('is required')) {
        return 'A required field is missing in your document. Please ensure all mandatory information is provided.';
    }

    if (message.includes('format') || message.includes('invalid')) {
        return 'The document contains data in an invalid format. Please check all fields for correct formatting.';
    }

    return message;
}

// Function to get user-friendly error message from error code
function getUserFriendlyErrorMessage(errorCode, errorMessage) {
    const errorMessages = {
        'ValidationError': 'The document contains invalid or missing information',
        'DS302': 'This document has already been submitted to LHDN',
        'CF321': 'The document date is invalid or outside the allowed range',
        'CF364': 'One or more item classifications are invalid',
        'CF401': 'There is an issue with the tax calculations',
        'CF402': 'The currency information is invalid',
        'CF403': 'The tax code used is invalid',
        'CF404': 'The identification information is invalid',
        'CF405': 'The company or party information is invalid',
        'AUTH001': 'Your authentication has expired or is invalid',
        'DUPLICATE_SUBMISSION': 'This document has already been submitted',
        'NETWORK_ERROR': 'Could not connect to LHDN due to network issues',
        'TIMEOUT': 'The request to LHDN timed out',
        'EMPTY_RESPONSE': 'LHDN service is currently unavailable',
        'SUBMISSION_ERROR': 'There was a problem submitting your document'
    };

    // Return user-friendly message or the original error message
    return errorMessages[errorCode] || errorMessage || 'An unknown error occurred';
}


// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Check if table element exists
    const tableElement = document.getElementById('invoiceTable');
    if (!tableElement) {
        console.error('Table element #invoiceTable not found');
        return;
    }

    // Initialize the table manager and update date/time
    InvoiceTableManager.getInstance();
    DateTimeManager.updateDateTime();

    // Initialize data source toggle functionality
    initializeDataSourceToggle();

    // Check for any pending submissions that might have been interrupted by a server restart
    checkPendingSubmissions();
});

// Function to check for pending submissions that were interrupted
async function checkPendingSubmissions() {
    try {
        const pendingSubmission = localStorage.getItem('pendingLHDNSubmission');
        if (!pendingSubmission) {
            return; // No pending submissions
        }

        const submission = JSON.parse(pendingSubmission);
        const { fileName, timestamp } = submission;

        // Only check submissions that are less than 10 minutes old
        const submissionTime = new Date(timestamp).getTime();
        const currentTime = new Date().getTime();
        const timeDiff = currentTime - submissionTime;

        if (timeDiff > 10 * 60 * 1000) {
            // Submission is too old, remove it
            localStorage.removeItem('pendingLHDNSubmission');
            return;
        }

        console.log('Found pending submission:', submission);

        // Check if the document was actually submitted
        try {
            const statusResponse = await fetch(`/api/outbound-files/status/${fileName}`);
            const statusResult = await statusResponse.json();

            if (statusResult.success && statusResult.exists &&
                ['Submitted', 'Processing'].includes(statusResult.document.status)) {
                // Document was submitted successfully
                console.log('Pending submission was actually successful:', statusResult.document);

                // Show notification to user
                Swal.fire({
                    title: 'Submission Recovered',
                    html: `
                        <div class="text-left">
                            <p>We detected that your previous submission of <strong>${fileName}</strong> was successful,
                            but the confirmation was interrupted.</p>
                            <p>The document has been submitted to LHDN and is now in <strong>${statusResult.document.status}</strong> status.</p>
                        </div>
                    `,
                    icon: 'info',
                    confirmButtonText: 'OK'
                });

                // Update the table to reflect the current status
                await updateSingleDocumentStatus(fileName);
            }
        } catch (error) {
            console.error('Error checking pending submission status:', error);
        }

        // Clear the pending submission regardless of the outcome
        localStorage.removeItem('pendingLHDNSubmission');

    } catch (error) {
        console.error('Error checking pending submissions:', error);
        // Clear potentially corrupted data
        localStorage.removeItem('pendingLHDNSubmission');
    }
}

