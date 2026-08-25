// Use global utilities loaded by load-utils.js
// These are already available as window.FetchWrapper and window.AuthStatusUtil

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

        // Add a prefilter for all AJAX requests
        $.ajaxPrefilter((options, originalOptions, jqXHR) => {
            if (!options.beforeSend) {
                options.beforeSend = () => {
                    this.showLoadingBackdrop();
                };
            }
            let oldComplete = options.complete;
            options.complete = (jqXHR, textStatus) => {
                this.hideLoadingBackdrop();
                if (oldComplete) {
                    oldComplete(jqXHR, textStatus);
                }
            };
        });

        this.initializeTable();
        this.initializeCharts();
        this.initializeEventListeners();
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

        $('#loadingBackdrop').fadeOut(300, function() {
            $(this).remove();
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
                                <input type="checkbox" class="outbound-checkbox" ${disabledAttr} data-status="${status}" title="${title}">
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
                        data: 'supplierInfo',
                        title: 'SUPPLIER',
                        render: (data, type, row) => this.renderSupplierInfo(data, type, row)
                    },
                    {
                        data: 'buyerInfo',
                        title: 'RECEIVER',
                        render: (data, type, row) => this.renderBuyerInfo(data, type, row)
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
                    // Add filter button handlers to existing buttons
                    $('.quick-filters .btn[data-filter]').on('click', function() {
                        $('.quick-filters .btn').removeClass('active');
                        $(this).addClass('active');

                        const filter = $(this).data('filter');
                        if (filter === 'all') {
                            self.table.column(8).search('').draw();
                        } else {
                            self.table.column(8).search('Pending').draw();
                        }
                    });

                    // Set initial filter to Pending
                    self.table.column(8).search('Pending').draw();
                    $('.quick-filters .btn[data-filter="pending"]').addClass('active');
                    $('.quick-filters .btn[data-filter="all"]').removeClass('active');
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
                    url: '/api/outbound-files/list-fixed-paths',
                    method: 'GET',
                    data: function(d) {
                        // Add a cache control parameter
                        d.forceRefresh = sessionStorage.getItem('forceRefreshOutboundTable') === 'true';
                        // Clear the flag after using it
                        if (d.forceRefresh) {
                            sessionStorage.removeItem('forceRefreshOutboundTable');
                            dataCache.invalidateCache();
                        }
                        return d;
                    },
                    dataSrc: (json) => {
                        // If we're using the cache, bypass processing
                        if (json.fromCache && json.cachedData) {
                            return json.cachedData;
                        }

                        if (!json.success) {
                            console.error('Error:', json.error);
                            self.showEmptyState(json.error?.message || 'Failed to load data');
                            // Don't refresh the page
                            return [];
                        }

                        if (!json.files || json.files.length === 0) {
                            self.showEmptyState('No EXCEL files found');
                            // Don't refresh the page
                            return [];
                        }

                        // Process the files data
                        const processedData = json.files.map(file => ({
                            ...file,
                            DT_RowId: file.fileName,
                            invoiceNumber: file.invoiceNumber || file.fileName.replace(/\.xml$/i, ''),
                            fileName: file.fileName,
                            documentType: file.documentType || 'Invoice',
                            company: file.company,
                            buyerInfo: file.buyerInfo || { registrationName: 'N/A' },
                            supplierInfo: file.supplierInfo || { registrationName: 'N/A' },
                            uploadedDate: file.uploadedDate ? new Date(file.uploadedDate).toISOString() : new Date().toISOString(),
                            issueDate: file.issueDate,
                            issueTime: file.issueTime,
                            date_submitted: file.submissionDate ? new Date(file.submissionDate).toISOString() : null,
                            date_cancelled: file.date_cancelled ? new Date(file.date_cancelled).toISOString() : null,
                            cancelled_by: file.cancelled_by || null,
                            cancel_reason: file.cancel_reason || null,
                            status: file.status || 'Pending',
                            source: file.source,
                            uuid: file.uuid || null,
                            totalAmount: file.totalAmount || null
                        }));

                        console.log('Current Processed Data: ', processedData);

                        // Update the cache with the processed data
                        dataCache.updateCache(processedData);

                        // Update card totals after data is loaded
                        setTimeout(() => this.updateCardTotals(), 0);

                        return processedData;
                    },
                    beforeSend: function() {
                        // Only show loading for the initial load or forced refreshes
                        if (!dataCache.isCacheValid() || sessionStorage.getItem('forceRefreshOutboundTable') === 'true') {
                            self.showLoadingBackdrop('Loading and Preparing Your Excel Files');
                        }
                    },
                    complete: function() {
                        // Hide loading backdrop
                        self.hideLoadingBackdrop();
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
            this.showEmptyState('Error initializing table. Please try refreshing the page if this persists.');
            // Remove the page reload to prevent refresh
        }
    }

    initializeFilters() {
        // Quick Filters
        document.querySelectorAll('.quick-filters .btn[data-filter]').forEach(button => {
            button.addEventListener('click', (e) => {
                document.querySelectorAll('.quick-filters .btn').forEach(btn =>
                    btn.classList.remove('active'));
                e.target.closest('.btn').classList.add('active');
                this.applyFilters();
            });
        });

        // Global Search
        const globalSearch = document.getElementById('globalSearch');
        if (globalSearch) {
            globalSearch.addEventListener('input', (e) => {
                this.table.search(e.target.value).draw();
            });
        }

        // Advanced Filters
        const advancedFilterInputs = [
            'input[placeholder="mm/dd/yyyy"]',
            '#minAmount',
            '#maxAmount',
            'input[placeholder="Filter by company name"]',
            '#documentTypeFilter'
        ].join(',');

        document.querySelectorAll(advancedFilterInputs).forEach(input => {
            input.addEventListener(input.type === 'select-one' ? 'change' : 'input',
                () => this.applyFilters());
        });

        // Clear Filters
        document.getElementById('clearFilters')?.addEventListener('click',
            () => this.clearAllFilters());
    }

    applyFilters() {
        if (!this.table) return;

        // Store current filter values
        const filters = this.getActiveFilters();

        // Apply filters to DataTable
        this.table.draw();

        // Update filter tags
        this.updateFilterTags(filters);
    }

    getActiveFilters() {
        return {
            quickFilter: document.querySelector('.quick-filters .btn.active')?.dataset.filter,
            dateStart: document.querySelector('input[placeholder="mm/dd/yyyy"]:first-of-type').value,
            dateEnd: document.querySelector('input[placeholder="mm/dd/yyyy"]:last-of-type').value,
            minAmount: document.getElementById('minAmount').value,
            maxAmount: document.getElementById('maxAmount').value,
            company: document.querySelector('input[placeholder="Filter by company name"]').value,
            documentType: document.getElementById('documentTypeFilter').value
        };
    }

    updateFilterTags(filters) {
        const container = document.getElementById('activeFilterTags');
        if (!container) return;

        container.innerHTML = '';

        const createTag = (label, value, type) => {
            if (!value) return;

            const tag = document.createElement('div');
            tag.className = 'filter-tag';
            tag.innerHTML = `
                ${label}: ${value}
                <button class="close-btn" data-filter-type="${type}">×</button>
            `;
            tag.querySelector('.close-btn').addEventListener('click',
                () => this.removeFilter(type));
            container.appendChild(tag);
        };

        // Create tags for active filters
        if (filters.quickFilter && filters.quickFilter !== 'all') {
            createTag('Status', filters.quickFilter, 'quickFilter');
        }
        if (filters.dateStart && filters.dateEnd) {
            createTag('Date', `${filters.dateStart} - ${filters.dateEnd}`, 'date');
        }
        if (filters.minAmount || filters.maxAmount) {
            createTag('Amount', `${filters.minAmount || '0'} - ${filters.maxAmount || '∞'}`, 'amount');
        }
        if (filters.company) {
            createTag('Company', filters.company, 'company');
        }
        if (filters.documentType) {
            createTag('Type', filters.documentType, 'documentType');
        }
    }

    clearAllFilters() {
        // Reset form inputs
        document.querySelectorAll([
            'input[placeholder="mm/dd/yyyy"]',
            '#minAmount',
            '#maxAmount',
            'input[placeholder="Filter by company name"]',
            '#documentTypeFilter',
            '#globalSearch'
        ].join(',')).forEach(input => input.value = '');

        // Reset quick filters
        document.querySelectorAll('.quick-filters .btn').forEach(btn =>
            btn.classList.remove('active'));
        document.querySelector('.quick-filters .btn[data-filter="all"]')
            .classList.add('active');

        // Clear DataTable filters
        this.table.search('').columns().search('').draw();

        // Clear filter tags
        document.getElementById('activeFilterTags').innerHTML = '';
    }

    removeFilter(filterType) {
        switch (filterType) {
            case 'quickFilter':
                document.querySelector('.quick-filters .btn[data-filter="all"]').click();
                break;
            case 'date':
                document.querySelectorAll('input[placeholder="mm/dd/yyyy"]')
                    .forEach(input => input.value = '');
                break;
            case 'amount':
                document.getElementById('minAmount').value = '';
                document.getElementById('maxAmount').value = '';
                break;
            case 'company':
                document.querySelector('input[placeholder="Filter by company name"]').value = '';
                break;
            case 'documentType':
                document.getElementById('documentTypeFilter').value = '';
                break;
        }
        this.applyFilters();
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
        if (!data) {
            return '<span class="text-muted">Company Name</span>';
        }
        const supplierName = data.name || data.registrationName || data.supplierName || data.supplier?.name || data.supplier?.registrationName || 'N/A';
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
        if (!data) {
            return '<span class="text-muted">Company Name</span>';
        }
        const buyerName = data.name || data.registrationName || data.buyerName || data.buyer?.name || data.buyer?.registrationName || 'N/A';
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
                        class="outbound-action-btn cancel delete-btn"
                        onclick="deleteDocument('${row.fileName}', '${row.source}', '${row.company}', '${row.uploadedDate}')"
                        data-id="${row.id}">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>`;
        }

        if (row.status === 'Submitted') {
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

    initializeEventListeners() {
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

        // Global Search
        const globalSearch = document.getElementById('globalSearch');
        if (globalSearch) {
            globalSearch.addEventListener('input', (e) => {
                this.table.search(e.target.value).draw();
            });
        }

        // Advanced Filters
        // Date Range
        const startDate = document.querySelector('input[placeholder="mm/dd/yyyy"]:first-of-type');
        const endDate = document.querySelector('input[placeholder="mm/dd/yyyy"]:last-of-type');
        if (startDate && endDate) {
            [startDate, endDate].forEach(input => {
                input.addEventListener('change', () => this.applyAdvancedFilters());
            });
        }

        // Amount Range
        const minAmount = document.getElementById('minAmount');
        const maxAmount = document.getElementById('maxAmount');
        if (minAmount && maxAmount) {
            [minAmount, maxAmount].forEach(input => {
                input.addEventListener('input', () => this.applyAdvancedFilters());
            });
        }

        // Company Filter
        const companyFilter = document.querySelector('input[placeholder="Filter by company name"]');
        if (companyFilter) {
            companyFilter.addEventListener('input', () => this.applyAdvancedFilters());
        }

        // Document Type Filter
        const documentTypeFilter = document.getElementById('documentTypeFilter');
        if (documentTypeFilter) {
            documentTypeFilter.addEventListener('change', () => this.applyAdvancedFilters());
        }
        // Clear Filters
        const clearFiltersBtn = document.getElementById('clearFilters');
        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', () => this.clearAllFilters());
        }
    }

    applyQuickFilter(filterValue) {
        if (!this.table) return;

        // Clear the global search
        const globalSearch = document.getElementById('globalSearch');
        if (globalSearch) globalSearch.value = '';

        // Apply filter based on value
        this.table.column('status:name').search(
            filterValue === 'all' ? '' : filterValue,
            false,
            false
        ).draw();

        // Update active filter tags
        this.updateActiveFilterTags();
    }

    applyAdvancedFilters() {
        if (!this.table) return;

        // Create a custom filter function
        $.fn.dataTable.ext.search.push((settings, data, dataIndex) => {
            const row = this.table.row(dataIndex).data();
            let passFilter = true;

            // Date Range Filter
            const startDate = document.querySelector('input[placeholder="mm/dd/yyyy"]:first-of-type').value;
            const endDate = document.querySelector('input[placeholder="mm/dd/yyyy"]:last-of-type').value;
            if (startDate && endDate) {
                const rowDate = new Date(data.uploadedDate);
                const filterStart = new Date(startDate);
                const filterEnd = new Date(endDate);

                if (rowDate < filterStart || rowDate > filterEnd) {
                    passFilter = false;
                }
            }

            // Amount Range Filter
            const minAmount = parseFloat(document.getElementById('minAmount').value) || 0;
            const maxAmount = parseFloat(document.getElementById('maxAmount').value) || Infinity;
            const rowAmount = parseFloat(row.total_amount?.replace(/[^0-9.-]+/g, '') || 0);

            if (rowAmount < minAmount || rowAmount > maxAmount) {
                passFilter = false;
            }

            // Company Filter
            const companyFilter = document.querySelector('input[placeholder="Filter by company name"]').value.toLowerCase();
            if (companyFilter && !row.company?.toLowerCase().includes(companyFilter)) {
                passFilter = false;
            }

            // Document Type Filter
            const documentType = document.getElementById('documentTypeFilter').value;
            if (documentType && row.document_type !== documentType) {
                passFilter = false;
            }

            return passFilter;
        });

        // Redraw the table
        this.table.draw();

        // Remove the custom filter
        $.fn.dataTable.ext.search.pop();

        // Update active filter tags
        this.updateActiveFilterTags();
    }

    clearAllFilters() {
        // Reset all form inputs
        document.getElementById('globalSearch').value = '';
        document.querySelector('input[placeholder="mm/dd/yyyy"]:first-of-type').value = '';
        document.querySelector('input[placeholder="mm/dd/yyyy"]:last-of-type').value = '';
        document.getElementById('minAmount').value = '';
        document.getElementById('maxAmount').value = '';
        document.querySelector('input[placeholder="Filter by company name"]').value = '';
        document.getElementById('documentTypeFilter').value = '';

        // Reset quick filter buttons
        document.querySelectorAll('.quick-filters .btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector('.quick-filters .btn[data-filter="all"]').classList.add('active');

        // Clear DataTable filters
        this.table.search('').columns().search('').draw();

        // Clear active filter tags
        this.updateActiveFilterTags();
    }

    updateActiveFilterTags() {
        const activeFiltersContainer = document.getElementById('activeFilterTags');
        if (!activeFiltersContainer) return;

        // Clear existing tags
        activeFiltersContainer.innerHTML = '';

        // Helper function to create a filter tag
        const createFilterTag = (label, value, type) => {
            const tag = document.createElement('div');
            tag.className = 'filter-tag';
            tag.innerHTML = `
                ${label}: ${value}
                <button class="close-btn" data-filter-type="${type}">×</button>
            `;
            tag.querySelector('.close-btn').addEventListener('click',
                () => this.removeFilter(type));
            container.appendChild(tag);
        };

        // Add tags for active filters
        const activeFilters = this.getActiveFilters();
        Object.entries(activeFilters).forEach(([type, value]) => {
            if (value) {
                activeFiltersContainer.appendChild(
                    createFilterTag(type.charAt(0).toUpperCase() + type.slice(1), value, type)
                );
            }
        });
    }

    getActiveFilters() {
        const filters = {};

        // Quick filter
        const activeQuickFilter = document.querySelector('.quick-filters .btn.active');
        if (activeQuickFilter && activeQuickFilter.dataset.filter !== 'all') {
            filters.status = activeQuickFilter.textContent.trim();
        }

        // Date range
        const startDate = document.querySelector('input[placeholder="mm/dd/yyyy"]:first-of-type').value;
        const endDate = document.querySelector('input[placeholder="mm/dd/yyyy"]:last-of-type').value;
        if (startDate && endDate) {
            filters.dateRange = `${startDate} to ${endDate}`;
        }

        // Amount range
        const minAmount = document.getElementById('minAmount').value;
        const maxAmount = document.getElementById('maxAmount').value;
        if (minAmount || maxAmount) {
            filters.amountRange = `${minAmount || '0'} to ${maxAmount || '∞'}`;
        }

        // Company
        const company = document.querySelector('input[placeholder="Filter by company name"]').value;
        if (company) {
            filters.company = company;
        }

        // Document type
        const documentType = document.getElementById('documentTypeFilter').value;
        if (documentType) {
            filters.documentType = documentType;
        }

        return filters;
    }

    removeFilter(filterType) {
        switch (filterType) {
            case 'status':
                document.querySelectorAll('.quick-filters .btn').forEach(btn => btn.classList.remove('active'));
                document.querySelector('.quick-filters .btn[data-filter="all"]').classList.add('active');
                this.applyQuickFilter('all');
                break;
            case 'dateRange':
                document.querySelector('input[placeholder="mm/dd/yyyy"]:first-of-type').value = '';
                document.querySelector('input[placeholder="mm/dd/yyyy"]:last-of-type').value = '';
                this.applyAdvancedFilters();
                break;
            case 'amountRange':
                document.getElementById('minAmount').value = '';
                document.getElementById('maxAmount').value = '';
                this.applyAdvancedFilters();
                break;
            case 'company':
                document.querySelector('input[placeholder="Filter by company name"]').value = '';
                this.applyAdvancedFilters();
                break;
            case 'documentType':
                document.getElementById('documentTypeFilter').value = '';
                this.applyAdvancedFilters();
                break;
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
        this.initializeEventListeners();
        this.initializeSelectAll();
        this.initializeTINValidation(); // Add TIN validation initialization
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

        // // Check session validation limit
        // if (!this.incrementValidationCounter()) {
        //     return; // Session limit reached, warning already shown
        // }

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
            // No valid cache, get from server
            this.table?.ajax.reload(null, false);
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
            <div class="modal-content">
                <div class="modal-header">
                <div class="icon primary">
                    <i class="fas fa-file-earmark-text"></i>
                </div>
                <div class="title">${title}</div>
                <div class="subtitle">${message}</div>
                </div>
                <div class="modal-body">
                <div class="progress-steps">
                    <div class="step">
                        <div class="step-icon">
                            <i class="fas fa-check"></i>
                        </div>
                        <div class="step-content">
                            <div class="step-title">Validating Document</div>
                            <div class="step-status">Validation completed</div>
                        </div>
                            </div>
                    <div class="step processing">
                        <div class="step-icon">
                            <div class="spinner-border spinner-border-sm"></div>
                                            </div>
                        <div class="step-content">
                            <div class="step-title">Uploading to LHDN</div>
                            <div class="step-status">Submitting to LHDN...</div>
                                        </div>
                                </div>
                    <div class="step">
                        <div class="step-icon">
                            <i class="fas fa-clock"></i>
                            </div>
                        <div class="step-content">
                            <div class="step-title">Processing</div>
                            <div class="step-status">Waiting...</div>
                                </div>
                            </div>
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

    showEmptyState(message = 'No EXCEL files found') {
        const emptyState = `
  <div class="empty-state">
  <div class="empty-state-content">
    <div class="icon-wrapper">
      <div class="ring ring-1"></div>
      <div class="ring ring-2"></div>
      <div class="icon bounce">
        <i class="fas fa-file-excel"></i>
      </div>
    </div>

    <div class="text-content">
      <h3 class="title">No Documents Available</h3>
      <p class="description">Upload an Excel file to start processing your invoices</p>
      <p class="sub-description">Supported formats: .xlsx, .xls</p>
    </div>

    <div class="button-group">
      <button class="btn-primary" onclick="window.location.reload()">
        <i class="fas fa-sync-alt"></i>
        Refresh
      </button>
      <button class="btn-secondary" onclick="this.dispatchEvent(new CustomEvent('show-help'))">
        <i class="fas fa-question-circle"></i>
        Help
      </button>
    </div>
  </div>
</div>

<style>
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
}

.empty-state-content {
  text-align: center;
}

.icon-wrapper {
  position: relative;
  width: 80px;
  height: 80px;
  margin: 0 auto 24px;
}

/* Animated rings */
.ring {
  position: absolute;
  border-radius: 50%;
  border: 2px solid #1e40af;
  opacity: 0;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.ring-1 {
  width: 100%;
  height: 100%;
  animation: ripple 2s infinite ease-out;
}

.ring-2 {
  width: 90%;
  height: 90%;
  animation: ripple 2s infinite ease-out 0.5s;
}

/* Icon bounce animation */
.icon {
  position: relative;
  color: #1e40af;
  font-size: 48px;
  animation: bounce 2s infinite;
}

.text-content {
  margin-bottom: 24px;
}

.title {
  color: #1f2937;
  font-size: 18px;
  font-weight: 500;
  margin-bottom: 8px;
}

.description {
  color: #6b7280;
  font-size: 14px;
  margin-bottom: 4px;
}

.sub-description {
  color: #9ca3af;
  font-size: 13px;
}

.button-group {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.btn-primary, .btn-secondary {
  display: inline-flex;
  align-items: center;
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: #1e40af;
  color: white;
  border: none;
}

.btn-primary:hover {
  background: #1e3a8a;
}

.btn-primary:hover i {
  animation: spin 1s linear infinite;
}

.btn-secondary {
  background: white;
  color: #374151;
  border: 1px solid #d1d5db;
}

.btn-secondary:hover {
  background: #f3f4f6;
}

.btn-primary i, .btn-secondary i {
  margin-right: 8px;
}

/* Animations */
@keyframes ripple {
  0% {
    transform: translate(-50%, -50%) scale(0.8);
    opacity: 0.5;
  }
  100% {
    transform: translate(-50%, -50%) scale(1.2);
    opacity: 0;
  }
}

@keyframes bounce {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

@keyframes spin {
  100% {
    transform: rotate(360deg);
  }
}
</style>
        `;

        const tableContainer = document.querySelector('.outbound-table-container');
        if (tableContainer) {
            tableContainer.innerHTML = emptyState;

            const helpButton = tableContainer.querySelector('button[onclick*="show-help"]');
            if (helpButton) {
                helpButton.addEventListener('click', () => {
                    Swal.fire({
                        title: '<div class="text-xl font-semibold mb-2">Excel Files Guide</div>',
                        html: `
                <div class="text-left px-2">
                    <div class="mb-4">
                        <p class="text-gray-600 mb-3">Not seeing your Excel files? Here's a comprehensive checklist to help you:</p>
                    </div>

                    <div class="bg-blue-50 border-l-4 border-blue-500 p-4 mb-4">
                        <h3 class="font-medium text-blue-800 mb-2">File Requirements:</h3>
                        <ul class="list-disc pl-4 text-blue-700">
                            <li>Accepted formats: .xls, .xlsx</li>
                            <li>Maximum file size: 10MB</li>
                            <li>File naming format: {fileName}.xls</li>
                </ul>
                    </div>

                    <div class="space-y-3">
                        <h3 class="font-medium text-gray-700 mb-2">Troubleshooting Steps:</h3>
                        <div class="flex items-start mb-2">
                            <div class="flex-shrink-0 w-5 h-5 text-green-500 mr-2">✓</div>
                            <p>Verify Excel files are in the correct upload directory</p>
                        </div>
                        <div class="flex items-start mb-2">
                            <div class="flex-shrink-0 w-5 h-5 text-green-500 mr-2">✓</div>
                            <p>Check if files follow the required naming convention</p>
                        </div>
                        <div class="flex items-start mb-2">
                            <div class="flex-shrink-0 w-5 h-5 text-green-500 mr-2">✓</div>
                            <p>Confirm you have proper file access permissions</p>
                        </div>
                        <div class="flex items-start">
                            <div class="flex-shrink-0 w-5 h-5 text-green-500 mr-2">✓</div>
                            <p>Ensure files are not corrupted or password-protected</p>
                        </div>
                    </div>

                    <div class="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                        <h3 class="font-medium text-gray-700 mb-2">Still having issues?</h3>
                        <p class="text-gray-600">Contact your system administrator or reach out to support at
                            <a href="mailto:ask@pixelcareconsulting.com" class="text-blue-600 hover:text-blue-800">ask@pixelcareconsulting.com</a>
                        </p>
                    </div>
                </div>
            `,
                        icon: 'info',
                        confirmButtonText: 'Got it',
                        confirmButtonColor: '#1e40af',
                        customClass: {
                            container: 'help-modal-container',
                            popup: 'help-modal-popup',
                            content: 'help-modal-content',
                            confirmButton: 'help-modal-confirm'
                        },
                        showCloseButton: true,
                        width: '600px'
                    });
                });
            }
        }
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

    // Initialize session counter for validation limits
    initValidationSessionCounter() {
        // Get or create the session counter
        let sessionCount = sessionStorage.getItem('validation_session_count');
        if (!sessionCount) {
            sessionCount = 0;
            sessionStorage.setItem('validation_session_count', sessionCount);
        }


    }

    //  to fix source values during data processing
    convertSource(source) {
        return source || 'Incoming';
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
        // First check authentication status
        try {
            const authStatus = await window.AuthStatusUtil.checkLHDNAuthStatus();
            if (!authStatus) {
                console.warn('Authentication check failed before file validation');
                // Show auth error modal
                window.AuthStatusUtil.showAuthErrorModal({
                    code: 'AUTH_ERROR',
                    message: 'Authentication error. Please log in again.',
                    details: 'Your session may have expired or the authentication token is invalid.'
                });
                throw new Error('Authentication error. Please log in again.');
            }
        } catch (authError) {
            console.error('Auth check error:', authError);
            // Continue with the request, the fetch wrapper will handle auth errors if they occur
        }

        const encodedFileName = encodeURIComponent(fileName);

        // Use the fetch wrapper for better error handling
        const fileData = await window.FetchWrapper.post(`/api/outbound-files/${encodedFileName}/content-consolidated`, {
            type,
            company,
            date: formattedDate,
            filePath: `Incoming/${company}/${formattedDate}/${fileName}`
        }, {
            headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });

        // If we get here, the request was successful
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
                        // ... additional tax subtotal validations ...
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
    return Swal.fire({
        title: 'Select Document Version',
        html: `
            <div style="text-align: center; margin-bottom: 1.5rem; color: #6b7280; font-size: 0.875rem;">
                Choose your preferred format for submission
            </div>
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
            </div>`,
        showCancelButton: true,
        confirmButtonText: 'Continue',
        cancelButtonText: 'Cancel',
        width: 500,
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
// Base template for semi-minimal dialog
function createSemiMinimalDialog(options) {
    const {
        title,
        subtitle,
        content,
        showCancelButton = true,
        confirmButtonText = 'Continue',
        cancelButtonText = 'Cancel',
        width = 480,
        padding = '1.5rem',
        customClass = {},
        didOpen = () => { }
    } = options;

    return `
        <div class="semi-minimal-dialog">
            <style>
                .semi-minimal-dialog {
                    --primary: hsl(220 76% 55%);
                    --primary-light: hsl(220 76% 97%);
                    --text-main: hsl(220 39% 11%);
                    --text-muted: hsl(215 16% 47%);
                    --error: hsl(0 84% 60%);
                    --error-light: hsl(0 84% 97%);
                    --success: hsl(142 76% 36%);
                    --success-light: hsl(142 76% 97%);
                    --warning: hsl(37 90% 51%);
                    --warning-light: hsl(37 90% 97%);
                    --info: hsl(200 76% 55%);
                    --info-light: hsl(200 76% 97%);
                    font-family: system-ui, -apple-system, sans-serif;
                }

                .dialog-heading {
                    text-align: center;
                    margin-bottom: 1.5rem;
                }

                .dialog-title {
                    font-size: 1.125rem;
                    font-weight: 600;
                    color: var(--text-main);
                    margin-bottom: 0.25rem;
                }

                .dialog-subtitle {
                    font-size: 0.875rem;
                    color: var(--text-muted);
                    line-height: 1.4;
                }

                .content-card {
                    padding: 1rem;
                    border-radius: 8px;
                    border: 1px solid hsl(214 32% 91%);
                    margin-bottom: 0.75rem;
                    background: white;
                }

                .content-card:hover:not(.disabled) {
                    transform: translateY(-2px);
                    box-shadow: 0 3px 6px rgba(0,0,0,0.05);
                }

                .content-card.selected {
                    border-color: var(--primary);
                    background: var(--primary-light);
                }

                .content-card.disabled {
                    background: hsl(220 33% 98%);
                    cursor: not-allowed;
                }

  .content-header {
    display: flex !important;
    justify-content: center !important;
    align-items: center !important;
    width: 100% !important;
    margin-bottom: 0.5rem !important;
    text-align: center !important;
}

.content-title {
    font-size: 0.9375rem !important;
    font-weight: 500 !important;
    color: var(--text-main) !important;
    text-align: center !important;
    width: 100% !important;
}

                .content-badge {
                    width: 24px;
                    height: 24px;
                    border-radius: 6px;
                    background: var(--primary-light);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--primary);
                    font-size: 0.75rem;
                    font-weight: 600;
                }

                .content-badge.error {
                    background: var(--error-light);
                    color: var(--error);
                }

                .content-badge.success {
                    background: var(--success-light);
                    color: var(--success);
                }

                .content-badge.warning {
                    background: var(--warning-light);
                    color: var(--warning);
                }

                .content-badge.info {
                    background: var(--info-light);
                    color: var(--info);
                }


                .content-desc {
                    font-size: 0.8125rem;
                    color: var(--text-muted);
                    line-height: 1.4;
                    margin-left: 0.5rem;
                }

                .status-indicator {
                    position: absolute;
                    top: 12px;
                    right: 12px;
                    font-size: 0.75rem;
                    padding: 2px 8px;
                    border-radius: 4px;
                }

                .field-row {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    margin-bottom: 0.5rem;
                }

                .field-label {
                    font-size: 0.8125rem;
                    color: var(--text-muted);
                    min-width: 100px;
                }

                .field-value {
                    font-size: 0.875rem;
                    color: var(--text-main);
                    font-weight: 500;
                }

                  .loading-steps {
                    display: flex;
                    flex-direction: column;
                    gap: 0.5rem;
                }

                .loading-step {
                    position: relative;
                    display: flex;
                    align-items: center;
                    gap: 1rem;
                    padding: 1rem;
                    background: white;
                    border-radius: 8px;
                    border: 1px solid #e9ecef;
                    margin-bottom: 0.5rem;
                }

                .step-indicator {
                    width: 20px;
                    height: 20px;
                    position: relative;
                    flex-shrink: 0;
                }

                .step-indicator::before {
                    content: '';
                    position: absolute;
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    background: #e9ecef;
                }

                .step-indicator.processing::before {
                    background: var(--primary);
                }

                .step-indicator.completed::before {
                    background: var(--success);
                }

                .step-indicator.error::before {
                    background: var(--error);
                }

                .step-content {
                    flex: 1;
                    min-width: 0;
                }

                .step-title {
                    font-size: 0.9375rem;
                    font-weight: 500;
                    color: var(--text-main);
                    margin-bottom: 0.25rem;
                }

                .step-message {
                    font-size: 0.8125rem;
                    color: var(--text-muted);
                }

                /* Loading animation */
                .loading-spinner {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 20px;
                    height: 20px;
                    border: 2px solid transparent;
                    border-top-color: var(--primary);
                    border-right-color: var(--primary);
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }

                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }

                /* Status-specific styles */
                .loading-step.processing {
                    border-color: var(--primary);
                    background: var(--primary-light);
                }

                .loading-step.completed {
                    border-color: var(--success);
                    background: var(--success-light);
                }

                .loading-step.error {
                    border-color: var(--error);
                    background: var(--error-light);
                }

                .loading-step.processing .step-message {
                    color: var(--primary);
                }

                .loading-step.completed .step-message {
                    color: var(--success);
                }

                .loading-step.error .step-message {
                    color: var(--error);
                }
            </style>

            <div class="dialog-heading">
                <h3 class="dialog-title">${title}</h3>
                ${subtitle ? `<p class="dialog-subtitle">${subtitle}</p>` : ''}
            </div>

            ${content}
        </div>
    `;
}

// Update showConfirmationDialog to use the new template
async function showConfirmationDialog(fileName, type, company, date, version) {
    const content = `
        <div class="content-card">
            <div class="content-header">
                <span class="content-badge">
                    <i class="fas fa-file-invoice"></i>
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
    `;

    return Swal.fire({
        title: 'Confirm Submission',
        html: `
            <div style="text-align: center; margin-bottom: 1.5rem; color: #6b7280; font-size: 0.875rem;">
                Please review the document details before submitting to LHDN
            </div>
            ${content}`,
        showCancelButton: true,
        confirmButtonText: 'Yes, Submit',
        cancelButtonText: 'Cancel',
        width: 600,
        padding: '2rem',
        focusConfirm: false,
        customClass: {
            confirmButton: 'btn-success',
            popup: 'large-modal'
        }
    }).then((result) => result.isConfirmed);
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



async function showSuccessMessage(fileName, version) {
    const content = `
        <div class="content-card">
            <div class="content-header">
                <span class="content-badge success" style="margin-bottom: 10px;">
                    <i class="fas fa-check-circle"></i>
                </span>
                <span class="content-title">Submission Details</span>
            </div>
            <div class="field-row">
                <span class="field-label">File Name:</span>
                <span class="field-value">${fileName}</span>
            </div>
            <div class="field-row">
                <span class="field-label">Version:</span>
                <span class="field-value">${version}</span>
            </div>
            <div class="field-row">
                <span class="field-label">Submitted At:</span>
                <span class="field-value">${new Date().toLocaleString()}</span>
            </div>
        </div>
        <div class="content-card">
            <div class="content-header">
                <span class="content-badge info">
                    <i class="fas fa-info-circle"></i>
                </span>
                <span class="content-title">Next Steps</span>
            </div>
            <div class="content-desc">
                You can track the status of your submission in the table below. The document will be processed by LHDN within 72 hours.
            </div>
        </div>
    `;

    return Swal.fire({
        html: createSemiMinimalDialog({
            title: 'Document Submitted Successfully',
            subtitle: 'Your document has been successfully submitted to LHDN',
            content: content
        }),
        confirmButtonText: 'Close',
        width: 480,
        padding: '1.5rem',
        customClass: {
            confirmButton: 'semi-minimal-confirm',
            popup: 'semi-minimal-popup'
        }
    });
}

// Main submission function
async function submitToLHDN(fileName, type, company, date) {
    console.log('🚀 Starting submission process:', { fileName, type, company, date });

    try {
        // First check authentication status
        try {
            const authStatus = await window.AuthStatusUtil.checkLHDNAuthStatus();
            if (!authStatus) {
                console.warn('Authentication check failed before submission');
                // Show auth error modal
                window.AuthStatusUtil.showAuthErrorModal({
                    code: 'AUTH_ERROR',
                    message: 'Authentication error. Please log in again.',
                    details: 'Your session may have expired or the authentication token is invalid.'
                });
                return;
            }
        } catch (authError) {
            console.error('Auth check error:', authError);
            // Continue with the request, the fetch wrapper will handle auth errors if they occur
        }

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

        // 3. Show submission status modal and start process
        console.log('📤 Step 3: Starting submission status process');
        await showSubmissionStatus(fileName, type, company, date, version);

    } catch (error) {
        console.error('❌ Submission error:', error);

        // Check if it's an authentication error
        if (error.code === 'AUTH_ERROR' || error.message?.includes('authentication')) {
            window.AuthStatusUtil.showAuthErrorModal(window.AuthStatusUtil.handleAuthError(error));
            return;
        }

        showSystemErrorModal({
            title: 'Submission Error',
            message: error.message || 'An error occurred during submission.',
            code: 'SUBMISSION_ERROR'
        });
    }
}
// Function to get step HTML
function getStepHtml(stepNumber, title) {
    console.log(`🔨 [Step ${stepNumber}] Creating HTML for step: ${title}`);

    const stepId = `step${stepNumber}`;
    console.log(`🏷️ [Step ${stepNumber}] Step ID created: ${stepId}`);

    return `
        <style>
            .step-badge.spinning::after {
                content: '';
                width: 12px;
                height: 12px;
                border: 2px solid var(--primary);
                border-right-color: transparent;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
                display: block;
            }

            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        </style>
        <div class="content-card step-card" id="${stepId}">
            <div class="content-header">
                <span class="content-badge step-badge">
                    <i class="fas fa-circle"></i>
                </span>
                <span class="">${title}</span>
            </div>
            <div class="content-desc step-status">Waiting...</div>
        </div>
    `;
}

// Helper function to update step status with animation
async function updateStepStatus(stepNumber, status, message) {
    console.log(`🔄 [Step ${stepNumber}] Updating status:`, { status, message });

    const step = document.getElementById(`step${stepNumber}`);
    if (!step) {
        console.error(`❌ [Step ${stepNumber}] Step element not found`);
        return;
    }

    // Remove all status classes first
    step.classList.remove('processing', 'completed', 'error');
    console.log(`🎨 [Step ${stepNumber}] Removed old classes`);

    // Add the new status class
    step.classList.add(status);
    console.log(`🎨 [Step ${stepNumber}] Added new class:`, status);

    // Update status message with fade effect
    const statusEl = step.querySelector('.step-status');
    if (statusEl && message) {
        console.log(`✍️ [Step ${stepNumber}] Updating message to:`, message);
        statusEl.style.opacity = '0';
        await new Promise(resolve => setTimeout(resolve, 300));
        statusEl.textContent = message;
        statusEl.style.opacity = '1';
    }

    // Update spinner visibility and icon
    const badge = step.querySelector('.step-badge');
    if (badge) {
        const icon = badge.querySelector('.fas');
        if (icon) {
            switch (status) {
                case 'processing':
                    icon.style.display = 'none';
                    badge.classList.add('spinning');
                    break;
                case 'completed':
                    icon.style.display = 'block';
                    badge.classList.remove('spinning');
                    icon.className = 'fas fa-check';
                    break;
                case 'error':
                    icon.style.display = 'block';
                    badge.classList.remove('spinning');
                    icon.className = 'fas fa-times';
                    break;
                default:
                    icon.style.display = 'block';
                    badge.classList.remove('spinning');
                    icon.className = 'fas fa-circle';
            }
        }
    }

    // Add delay for visual feedback
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`✅ [Step ${stepNumber}] Status update completed`);
}

/**
 * Update a single document's status without refreshing the entire table
 * @param {string} fileName - The file name to update
 */
async function updateSingleDocumentStatus(fileName) {
    try {
        console.log('🔄 Updating status for document:', fileName);
        const tableManager = InvoiceTableManager.getInstance();

        // Use the fetch wrapper for better error handling
        const result = await window.FetchWrapper.get(`/api/outbound-files/status/${fileName}`, {
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
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

    let modal = null;
    try {
        // Create steps HTML
        console.log('📋 Creating steps container');
        const stepsHtml = `
           <style>
                .step-card {
                    transform: translateY(10px);
                    opacity: 0.6;
                    transition: all 0.3s ease;
                    margin-bottom: 1rem;
                    padding: 1rem;
                    border-radius: 8px;
                    border: 1px solid #e9ecef;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    text-align: center;
                    flex-direction: column;
                }

                .step-card.processing {
                    transform: translateY(0);
                    opacity: 1;
                    border-color: var(--primary);
                    background: var(--primary-light);
                }

                .step-card.completed {
                    opacity: 1;
                    border-color: var(--success);
                    background: var(--success-light);
                }

                .step-card.error {
                    opacity: 1;
                    border-color: var(--error);
                    background: var(--error-light);
                }

                .step-badge {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 0.5rem;
                }

                .step-card.processing .step-badge {
                    background: var(--primary-light);
                    color: var(--primary);
                }

                .step-card.completed .step-badge {
                    background: var(--success-light);
                    color: var(--success);
                }

                .step-card.error .step-badge {
                    background: var(--error-light);
                    color: var(--error);
                }

                .step-badge.spinning::after {
                    content: '';
                    width: 20px;
                    height: 20px;
                    border: 2px solid var(--primary);
                    border-right-color: transparent;
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                    display: block;
                }

                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }

                .step-content {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 0.25rem;
                }

                .step-title {
                    font-weight: 500;
                    font-size: 1rem;
                    color: var(--text-main);
                }

                .step-status {
                    font-size: 0.875rem;
                    color: var(--text-muted);
                }
            </style>
            <div class="steps-container">
                ${getStepHtml(1, 'Validating Document')}
                ${getStepHtml(2, 'Submit to LHDN')}
                ${getStepHtml(3, 'Processing')}
            </div>
        `;

        // Create and show modal
        console.log('📦 Creating submission modal');
        modal = await Swal.fire({
            html: createSemiMinimalDialog({
                title: 'Submitting Document to LHDN',
                subtitle: 'Please wait while we process your request',
                content: stepsHtml
            }),
            showConfirmButton: false,
            allowOutsideClick: false,
            allowEscapeKey: false,
            width: 480,
            padding: '1.5rem',
            customClass: {
                popup: 'semi-minimal-popup'
            },
            didOpen: async () => {
                try {
                    // Verify steps were created
                    console.log('🔍 Verifying step elements:');
                    for (let i = 1; i <= 3; i++) {
                        const step = document.getElementById(`step${i}`);
                        if (step) {
                            console.log(`✅ Step ${i} element found`);
                        } else {
                            console.error(`❌ Step ${i} element not found`);
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

                    if (modal) {
                        modal.close();
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
                    if (modal) {
                        modal.close();
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
        await updateStepStatus(2, 'processing', 'Connecting to to LHDN...');
        await updateStepStatus(2, 'processing', 'Initializing Preparing Documents...');
        console.log('📤 [Step 2] Initiating submission to LHDN');

        // Extract the required parameters from the data
        const {
            fileName,
            type,
            company,  // Make sure we extract company
            date
        } = data;

        // Make the API call with all required parameters
        const response = await fetch(`/api/outbound-files/${fileName}/submit-to-lhdn-consolidated`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            },
            credentials: 'same-origin', // Include credentials to send cookies with the request
            body: JSON.stringify({
                type,
                company,  // Include company in the request body
                date,
                version
            })
        });

        const result = await response.json();

        if (!response.ok) {
            console.error('❌ [Step 2] API error response:', result);
            await updateStepStatus(2, 'error', 'Submission failed');

            // Display more specific error information if available
            if (result.error) {
                // Check for TIN mismatch error specifically
                if (result.error.code === 'TIN_MISMATCH') {
                    console.log('TIN mismatch error detected:', result.error);
                    showTINMismatchError(result);
                }
                // Check if there are validation errors in rejectedDocuments
                else if (result.rejectedDocuments && result.rejectedDocuments.length > 0) {
                    // Display the validation error details
                    const rejectedDoc = result.rejectedDocuments[0];
                    showLHDNErrorModal({
                        code: 'VALIDATION_ERROR',
                        message: `LHDN validation failed: ${rejectedDoc.error?.message || 'Document validation failed'}`,
                        details: rejectedDoc.error?.details || rejectedDoc
                    });
                }
                // Check if it's a LHDN validation error
                else if (result.error.code === 'VALIDATION_ERROR' || result.error.code === 'LHDN_VALIDATION_ERROR') {
                    showLHDNErrorModal({
                        code: result.error.code,
                        message: result.error.message || 'LHDN validation failed',
                        details: result.error.details || 'Document failed validation at LHDN'
                    });
                }
                // Regular error display
                else {
                    showLHDNErrorModal(result.error);
                }
            } else {
                showLHDNErrorModal({
                    code: 'SUBMISSION_ERROR',
                    message: 'LHDN submission failed',
                    details: 'An unknown error occurred during submission'
                });
            }

            throw new Error('LHDN submission failed');
        }

        console.log('✅ [Step 2] Submission successful:', result);
        await updateStepStatus(2, 'completed', 'Submission completed');
        return result;

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
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            },
            credentials: 'same-origin', // Include credentials to send cookies with the request
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
        console.log('Deleting document:', fileName, 'Type:', type, 'Company:', company, 'Date:', date);

        // First, confirm the deletion
        const result = await Swal.fire({
            title: 'Delete Document',
            text: `Are you sure you want to delete this document? (${fileName})`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Yes, delete it!'
        });

        if (!result.isConfirmed) {
            return;
        }

        // Show loading
        Swal.fire({
            title: 'Deleting...',
            text: 'Please wait while we delete this document.',
            allowOutsideClick: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        let url;

        // Determine if we are in the consolidated view
        const isConsolidatedView = window.location.href.includes('consolidated');

        // Check if this is a consolidated document
        if (isConsolidatedView || type === 'Incoming') {
            // For consolidated files, use a special path pattern
            url = `/api/outbound-files/${encodeURIComponent(fileName)}?type=consolidated&company=PXC%20Branch`;
            console.log('Using consolidated deletion URL:', url);
        } else {
            // Standard deletion for regular outbound files
            // Format the date for the URL
            const formattedDate = moment(date).format('YYYY-MM-DD');
            url = `/api/outbound-files/${encodeURIComponent(fileName)}?type=${encodeURIComponent(type)}&company=${encodeURIComponent(company)}&date=${encodeURIComponent(formattedDate)}`;
            console.log('Using standard deletion URL:', url);
        }

        // Make the API call to delete the document
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

        let data;
        try {
            data = await response.json();
            console.log('Delete response:', data);
        } catch (parseError) {
            console.error('Failed to parse response:', parseError);
            data = { success: false, error: { message: 'Invalid server response' } };
        }

        if (!response.ok) {
            throw new Error(data.error?.message || 'Failed to delete document');
        }

        // Show success message
        await Swal.fire({
            icon: 'success',
            title: 'Document Deleted',
            text: 'The file has been successfully deleted.',
            confirmButtonColor: '#1e88e5'
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
                tableManager.refresh(true);
            }
        } else {
            console.warn('Table not initialized, performing full refresh');
            window.location.reload();
        }

    } catch (error) {
        console.error('Error deleting document:', error);

        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to delete document: ' + error.message,
            confirmButtonColor: '#d33'
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
            confirmButton: 'outbound-action-btn submit',
            cancelButton: 'outbound-action-btn cancel',
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
            confirmButton: 'semi-minimal-confirm',
            popup: 'semi-minimal-popup'
        }
    });
}

async function showLHDNErrorModal(error) {
    console.log('LHDN Error:', error);

    // Parse error message if it's a string
    let errorDetails = error;
    try {
        if (typeof error === 'string') {
            errorDetails = JSON.parse(error);
        }
    } catch (e) {
        console.warn('Error parsing error message:', e);
    }

    // Extract error details from the new error format
    const errorData = Array.isArray(errorDetails) ? errorDetails[0] : errorDetails;
    const mainError = {
        code: errorData.code || 'VALIDATION_ERROR',
        message: errorData.message || 'An unknown error occurred',
        target: errorData.target || '',
        details: errorData.details || {}
    };

    // Format the validation error details
    const validationDetails = mainError.details?.error?.details || [];

    // Check if this is a TIN matching error and provide specific guidance
    const isTINMatchingError = mainError.message.includes("authenticated TIN and documents TIN is not matching");

    // Check if this is a duplicate submission error
    const isDuplicateSubmission = mainError.code === 'DUPLICATE_SUBMISSION' || mainError.code === 'DS302';

    // Create tooltip help content for TIN matching errors
    const tinErrorGuidance = `
        <div class="tin-matching-guidance" style="margin-top: 15px; padding: 12px; border-radius: 8px; background: #f8f9fa; border-left: 4px solid #17a2b8;">
            <div style="display: flex; align-items: center; margin-bottom: 10px;">
                <i class="fas fa-info-circle" style="color: #17a2b8; margin-right: 8px;"></i>
                <span style="color: #17a2b8; font-size: 14px; font-weight: 600;">How to resolve TIN matching errors:</span>
            </div>
            <div style="padding-left: 6px; margin-bottom: 0; text-align: left; color: #495057; font-size: 13px;">
                <div style="margin-bottom: 6px; display: flex; align-items: flex-start;">
                    <i class="fas fa-check-circle" style="color: #17a2b8; margin-right: 8px; font-size: 12px; margin-top: 2px;"></i>
                    <span>Verify that the supplier's TIN in your document matches exactly with the one registered with LHDN</span>
                </div>
                <div style="margin-bottom: 6px; display: flex; align-items: flex-start;">
                    <i class="fas fa-check-circle" style="color: #17a2b8; margin-right: 8px; font-size: 12px; margin-top: 2px;"></i>
                    <span>When using Login as Taxpayer API: The issuer TIN in the document must match with the TIN associated with your Client ID and Client Secret</span>
                </div>
                <div style="margin-bottom: 6px; display: flex; align-items: flex-start;">
                    <i class="fas fa-check-circle" style="color: #17a2b8; margin-right: 8px; font-size: 12px; margin-top: 2px;"></i>
                    <span>When using Login as Intermediary System API: The issuer TIN must match with the TIN of the taxpayer you're representing</span>
                </div>
                <div style="display: flex; align-items: flex-start;">
                    <i class="fas fa-check-circle" style="color: #17a2b8; margin-right: 8px; font-size: 12px; margin-top: 2px;"></i>
                    <span>For sole proprietors: You can validate TINs starting with "IG" along with your BRN if you have the "Business Owner" role in MyTax</span>
                </div>
            </div>
            <div style="margin-top: 10px; font-size: 12px; color: #6c757d; text-align: right;">
                <a href="https://sdk.myinvois.hasil.gov.my/faq/" target="_blank" style="color: #17a2b8; text-decoration: none; display: inline-flex; align-items: center;">
                    <span>View LHDN FAQ for more details</span>
                    <i class="fas fa-external-link-alt" style="margin-left: 4px; font-size: 10px;"></i>
                </a>
            </div>
        </div>
    `;

    Swal.fire({
        title: 'LHDN Submission Error',
        html: `
            <div class="content-card swal2-content">
                <div style="margin-bottom: 15px; text-align: center;">
                    <div class="error-icon" style="color: #dc3545; font-size: 36px; margin-bottom: 15px;">
                        <i class="fas fa-exclamation-circle" style="animation: pulseError 1.5s infinite;"></i>
                    </div>
                    <div style="background: #fff5f5; border-left: 4px solid #dc3545; padding: 10px; margin: 8px 0; border-radius: 4px; text-align: left; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <div style="display: flex; align-items: flex-start;">
                            <i class="fas fa-exclamation-triangle" style="color: #dc3545; margin-right: 8px; margin-top: 2px; font-size: 13px;"></i>
                            <span style="font-weight: 500; font-size: 13px;">${mainError.message}</span>
                        </div>
                    </div>
                </div>

                <div style="text-align: left; padding: 12px; border-radius: 8px; background: rgba(220, 53, 69, 0.05); box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                    <div style="margin-bottom: 8px; display: flex; align-items: center;">
                        <span style="color: #495057; font-weight: 600; min-width: 85px; font-size: 12px;">Error Code:</span>
                        <span style="color: #dc3545; font-family: monospace; background: rgba(220, 53, 69, 0.1); padding: 2px 6px; border-radius: 4px; font-size: 12px;">${mainError.code}</span>
                    </div>

                    ${mainError.target ? `
                    <div style="margin-bottom: 8px; display: flex; align-items: center;">
                        <span style="color: #495057; font-weight: 600; min-width: 85px; font-size: 12px;">Error Target:</span>
                        <span style="color: #495057; background: rgba(0,0,0,0.03); padding: 2px 6px; border-radius: 4px; font-size: 12px;">${mainError.target}</span>
                    </div>
                    ` : ''}

                    ${validationDetails.length > 0 ? `
                        <div>
                            <div style="color: #495057; font-weight: 600; margin-bottom: 8px; display: flex; align-items: center;">
                                <span style="font-size: 12px;">Validation Errors:</span>
                                <span class="tooltip-container" style="margin-left: 6px; cursor: help; position: relative;">
                                    <i class="fas fa-question-circle" style="color: #6c757d; font-size: 11px;"></i>
                                    <div class="tooltip-content" style="position: absolute; width: 220px; background: #fff; border-radius: 4px; padding: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 1000; display: none; top: -5px; left: 20px; font-weight: normal; font-size: 11px; color: #495057; text-align: left;">
                                        These validation errors indicate specific issues with your submission data. Each error includes the path to the problematic field and details about what needs to be fixed.
                                    </div>
                                </span>
                            </div>
                            <div style="margin-top: 6px; max-height: 150px; overflow-y: auto; border-radius: 4px; border: 1px solid rgba(0,0,0,0.1);">
                                ${validationDetails.map(detail => `
                                    <div style="background: #fff; padding: 8px; border-radius: 0; margin-bottom: 1px; border-bottom: 1px solid rgba(0,0,0,0.05); font-size: 12px;">
                                        <div style="margin-bottom: 4px; display: flex;">
                                            <strong style="min-width: 60px; color: #495057; font-size: 11px;">Path:</strong>
                                            <span style="color: #0d6efd; font-family: monospace; background: rgba(13, 110, 253, 0.05); padding: 0 3px; border-radius: 2px; font-size: 11px;">
                                                ${detail.propertyPath || detail.target || 'Unknown'}
                                            </span>
                                        </div>
                                        <div style="display: flex;">
                                            <strong style="min-width: 60px; color: #495057; font-size: 11px;">Error:</strong>
                                            <span style="font-size: 11px;">${formatValidationMessage(detail.message)}</span>
                                        </div>
                                        ${detail.code ? `
                                            <div style="margin-top: 4px; color: #6c757d; display: flex;">
                                                <strong style="min-width: 60px; color: #6c757d; font-size: 11px;">Code:</strong>
                                                <span style="font-size: 11px;">${detail.code}</span>
                                            </div>
                                        ` : ''}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>

                ${isTINMatchingError ? tinErrorGuidance : ''}
            </div>

            <div class="next-steps-card" style="margin-top: 25px; padding: 15px; border-radius: 8px; background: rgba(255, 193, 7, 0.1); box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="display: flex; align-items: center; margin-bottom: 12px;">
                    <i class="fas fa-lightbulb" style="color: #ffc107; margin-right: 8px; font-size: 16px;"></i>
                    <span style="font-weight: 600; color: #495057; font-size: 13px;">Next Steps</span>
                </div>
                <ul style="margin: 0; padding-left: 25px; font-size: 12px; color: #495057;">
                    ${getNextSteps(mainError.code)}
                </ul>
            </div>

            <style>
                @keyframes pulseError {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                    100% { transform: scale(1); }
                }
                .tooltip-container:hover .tooltip-content {
                    display: block;
                }
            </style>
        `,
        confirmButtonText: 'I Understand',
        confirmButtonColor: '#3085d6',
        width: 600,
        customClass: {
            confirmButton: 'btn btn-primary'
        }
    });

    // Refresh the table if this is a duplicate submission error
    // This ensures the table is updated even when a document is already submitted
    if (isDuplicateSubmission) {
        console.log('Updating table after duplicate submission error');
        // Extract the filename from the error if possible
        let fileName = window.currentFileName;
        if (mainError.target && typeof mainError.target === 'string') {
            // If target contains the document number, use that to help identify the file
            fileName = mainError.target;
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

// Helper function to format validation messages
function formatValidationMessage(message) {
    if (!message) return 'Unknown validation error';

    // Enhance common LHDN error messages with more helpful information
    if (message.includes('authenticated TIN and documents TIN is not matching')) {
        return `The TIN (Tax Identification Number) in your document doesn't match with the authenticated TIN.
                Please ensure the supplier's TIN matches exactly with the one registered with LHDN.`;
    }

    return message;
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

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Check if table element exists
    const tableElement = document.getElementById('invoiceTable');
    if (!tableElement) {
        console.error('Table element #invoiceTable not found');
        return;
    }

    const manager = InvoiceTableManager.getInstance();
    DateTimeManager.updateDateTime();
});

class ConsolidatedSubmissionManager {
    constructor() {
        this.selectedDocs = new Set();
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Handle consolidated submit button click
        document.getElementById('submitConsolidatedBtn').addEventListener('click', () => {
            this.handleConsolidatedSubmit();
        });

        // Update selected docs list when checkboxes change
        // Only listen to enabled checkboxes (Pending status)
        document.addEventListener('change', (e) => {
            if (e.target.matches('.row-checkbox:not([disabled])') || e.target.id === 'selectAll') {
                this.updateSelectedDocs();
            }
        });
    }

    updateSelectedDocs() {
        // Only get rows with enabled checkboxes (Pending status)
        const checkboxes = document.querySelectorAll('.row-checkbox:not([disabled]):checked:not(#selectAll)');
        this.selectedDocs.clear();

        checkboxes.forEach(checkbox => {
            const row = checkbox.closest('tr');
            const rowData = InvoiceTableManager.getInstance().table.row(row).data();
            if (rowData) {
                // Double-check that the status is Pending
                if (rowData.status && rowData.status.toLowerCase() === 'pending') {
                    this.selectedDocs.add({
                        fileName: rowData.fileName,
                        type: rowData.type,
                        company: rowData.company,
                        date: rowData.date
                    });
                }
            }
        });

        this.updateSelectedDocsList();
        this.updateSubmitButton();
    }

    updateSelectedDocsList() {
        const listContainer = $('#selectedDocsList');
        listContainer.empty();

        if (this.selectedDocs.size === 0) {
            return; // Empty state is handled by CSS
        }

        this.selectedDocs.forEach(doc => {
            const docItem = $(`
                <div class="doc-item">
                    <i class="bi bi-file-earmark-text text-primary"></i>
                    <span class="flex-grow-1">${doc.fileName}</span>
                    <span class="company-badge">${doc.company || 'PXC'}</span>
            </div>
        `);
            listContainer.append(docItem);
        });
    }

    updateSubmitButton() {
        const submitBtn = document.getElementById('submitConsolidatedBtn');
        submitBtn.disabled = this.selectedDocs.size === 0;
    }

    async handleConsolidatedSubmit() {
        const version = document.getElementById('lhdnVersion').value;
        const progressModal = new bootstrap.Modal(document.getElementById('submissionProgressModal'));
        const submissionProgress = document.getElementById('submissionProgress');

        try {
            progressModal.show();
            submissionProgress.innerHTML = '<div class="alert alert-info">Starting consolidated submission...</div>';

            let successCount = 0;
            let failureCount = 0;
            const results = [];

            for (const doc of this.selectedDocs) {
                try {
                    submissionProgress.innerHTML += `
                        <div class="alert alert-info">
                            Processing ${doc.fileName}...
                        </div>
                    `;

                    // First validate the document
                    const validationResult = await validateExcelFile(doc.fileName, doc.type, doc.company, doc.date);

                    if (validationResult.success) {
                        // If validation successful, submit to LHDN
                        const submitResult = await submitToLHDN(doc.fileName, doc.type, doc.company, doc.date, version);

                        if (submitResult.success) {
                            successCount++;
                            results.push({
                                fileName: doc.fileName,
                                status: 'success',
                                message: 'Successfully submitted'
                            });
                        } else {
                            failureCount++;
                            results.push({
                                fileName: doc.fileName,
                                status: 'error',
                                message: submitResult.error || 'Submission failed'
                            });
                        }
                    } else {
                        failureCount++;
                        results.push({
                            fileName: doc.fileName,
                            status: 'error',
                            message: 'Validation failed'
                        });
                    }
                } catch (error) {
                    failureCount++;
                    results.push({
                        fileName: doc.fileName,
                        status: 'error',
                        message: error.message
                    });
                }
            }

            // Show final results
            submissionProgress.innerHTML = `
                <div class="alert ${successCount === this.selectedDocs.size ? 'alert-success' : 'alert-warning'}">
                    <h6>Submission Complete</h6>
                    <p>Successfully submitted: ${successCount}</p>
                    <p>Failed: ${failureCount}</p>
                </div>
                <div class="results-list">
                    ${results.map(result => `
                        <div class="alert alert-${result.status === 'success' ? 'success' : 'danger'}">
                            <strong>${result.fileName}</strong>: ${result.message}
                        </div>
                    `).join('')}
                </div>
            `;

            // Refresh the table after submission
            InvoiceTableManager.getInstance().refresh();

        } catch (error) {
            submissionProgress.innerHTML = `
                <div class="alert alert-danger">
                    <h6>Submission Failed</h6>
                    <p>${error.message}</p>
                </div>
            `;
        }
    }
}

// Initialize the consolidated submission manager when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    new ConsolidatedSubmissionManager();
});

// Handle bulk document submission
async function handleBulkSubmission(selectedDocs) {
    const progressModal = new bootstrap.Modal(document.getElementById('submissionProgressModal'));
    const progressDiv = document.getElementById('submissionProgress');
    const tableManager = InvoiceTableManager.getInstance();

    try {
        // Show loading backdrop with specific message
        tableManager.showLoadingBackdrop('Submitting Documents to LHDN');

        // Initialize progress UI
        if (!progressDiv) {
            throw new Error('Progress container not found');
        }

        progressDiv.innerHTML = `
            <div class="progress mb-3">
                <div class="progress-bar progress-bar-striped progress-bar-animated"
                     role="progressbar"
                     style="width: 0%"
                     aria-valuenow="0"
                     aria-valuemin="0"
                     aria-valuemax="100">
                </div>
            </div>
            <div class="submission-status mb-3">Preparing documents for submission...</div>
            <div class="documents-status"></div>
        `;

        progressModal.show();

        const version = document.getElementById('lhdnVersion')?.value || '1.0';
        const progressBar = progressDiv.querySelector('.progress-bar');
        const statusText = progressDiv.querySelector('.submission-status');
        const documentsStatus = progressDiv.querySelector('.documents-status');

        if (!progressBar || !statusText || !documentsStatus) {
            throw new Error('Required progress elements not found');
        }

        // Submit documents
        const response = await fetch('/api/outbound-files/bulk-submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest' // Add AJAX header to prevent full page reload
            },
            body: JSON.stringify({ documents: selectedDocs, version })
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error?.message || 'Failed to submit documents');
        }

        // Update progress for each document
        result.results.forEach((docResult, index) => {
            const progress = ((index + 1) / result.results.length) * 100;
            progressBar.style.width = `${progress}%`;
            progressBar.setAttribute('aria-valuenow', progress);

            const statusClass = docResult.success ? 'text-success' : 'text-danger';
            const statusIcon = docResult.success ? 'check-circle-fill' : 'x-circle-fill';
            documentsStatus.insertAdjacentHTML('beforeend', `
                <div class="doc-status mb-2 ${statusClass}">
                    <i class="bi bi-${statusIcon}"></i>
                    ${docResult.fileName}: ${docResult.success ? 'Submitted successfully' : docResult.error.message}
                </div>
            `);
        });

        statusText.textContent = 'Submission complete';
        progressBar.style.width = '100%';
        progressBar.setAttribute('aria-valuenow', 100);
        progressBar.classList.remove('progress-bar-animated');

        // Hide loading backdrop before updating the table
        tableManager.hideLoadingBackdrop();

        // Update table data in-place without AJAX refresh
        tableManager.updateTableAfterSubmission(result.results);

        const successCount = result.results.filter(r => r.success).length;
        const failureCount = result.results.filter(r => !r.success).length;

        // Close consolidated modal if open
        const consolidatedModal = bootstrap.Modal.getInstance(document.getElementById('consolidatedSubmitModal'));
        if (consolidatedModal) {
            consolidatedModal.hide();
        }

        await Swal.fire({
            icon: successCount > 0 ? 'success' : 'warning',
            title: 'Submission Complete',
            html: `
                <div class="submission-summary">
                    <p>Successfully submitted: ${successCount} document(s)</p>
                    <p>Failed submissions: ${failureCount} document(s)</p>
                    ${failureCount > 0 ? '<p>Check the progress modal for details on failed submissions.</p>' : ''}
                </div>
            `,
            confirmButtonText: 'OK',
            customClass: { confirmButton: 'outbound-action-btn submit' }
        });

    } catch (error) {
        console.error('Bulk submission error:', error);

        // Hide loading backdrop
        tableManager.hideLoadingBackdrop();

        if (progressDiv) {
            progressDiv.innerHTML = `
                <div class="alert alert-danger">
                    <h6>Submission Failed</h6>
                    <p>${error.message}</p>
                </div>
            `;
        }

        await Swal.fire({
            icon: 'error',
            title: 'Submission Failed',
            text: error.message || 'An error occurred during bulk submission',
            confirmButtonText: 'OK',
            customClass: { confirmButton: 'outbound-action-btn submit' }
        });
    }
}

// Add event listener for bulk submit button
document.addEventListener('DOMContentLoaded', function() {
    const submitConsolidatedBtn = document.getElementById('submitConsolidatedBtn');
    if (submitConsolidatedBtn) {
        submitConsolidatedBtn.addEventListener('click', async function() {
            const tableManager = InvoiceTableManager.getInstance();

            // Show loading backdrop during validation
            tableManager.showLoadingBackdrop();

            const selectedRows = Array.from(document.querySelectorAll('input.outbound-checkbox:checked'))
                .map(checkbox => {
                    const row = checkbox.closest('tr');
                    return {
                        fileName: row.getAttribute('data-file-name'),
                        type: row.getAttribute('data-type'),
                        company: row.getAttribute('data-company'),
                        date: row.getAttribute('data-date')
                    };
                });

            if (selectedRows.length === 0) {
                tableManager.hideLoadingBackdrop();
                Swal.fire({
                    icon: 'warning',
                    title: 'No Documents Selected',
                    text: 'Please select at least one document to submit.'
                });
                return;
            }

            const confirmResult = await Swal.fire({
                icon: 'question',
                title: 'Confirm Bulk Submission',
                html: `Are you sure you want to submit ${selectedRows.length} document(s)?`,
                showCancelButton: true,
                confirmButtonText: 'Yes, Submit',
                cancelButtonText: 'Cancel',
                customClass: {
                    confirmButton: 'outbound-action-btn submit',
                    cancelButton: 'outbound-action-btn cancel'
                }
            });

            if (confirmResult.isConfirmed) {
                const consolidatedModal = bootstrap.Modal.getInstance(document.getElementById('consolidatedSubmitModal'));
                consolidatedModal.hide();
                await handleBulkSubmission(selectedRows);
            } else {
                // Hide loading backdrop if cancelled
                tableManager.hideLoadingBackdrop();
            }
        });
    }
});

// Function to handle file upload - Modified to only show file details, not upload the file immediately
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Check if file is Excel
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
        Swal.fire({
            icon: 'error',
            title: 'Invalid File Type',
            text: 'Please upload only Excel files (.xlsx or .xls)',
            confirmButtonColor: '#1e88e5'
        });
        return;
    }

    // Display file details instead of uploading directly
    const fileDetails = document.getElementById('fileDetails');
    const fileName = fileDetails?.querySelector('.file-name');
    const fileInfo = fileDetails?.querySelector('.file-info');
    const uploadArea = document.getElementById('uploadArea');
    const processFileBtn = document.getElementById('processFileBtn');

    if (fileName && fileInfo) {
        // Update file details
        fileName.textContent = file.name;
        fileInfo.textContent = `Size: ${(file.size / 1024).toFixed(2)} KB`;

        // Show file details
        fileDetails.classList.remove('d-none');

        // Hide upload area
        if (uploadArea) {
            uploadArea.style.display = 'none';
        }

        // Enable process button
        if (processFileBtn) {
            processFileBtn.disabled = false;
        }

        console.log('File details displayed, waiting for Process File button click');
    } else {
        console.error('Could not find file details elements');
    }
}

// Function to validate file name format
function isValidFileFormat(fileName) {
    try {
        // Remove file extension
        const baseName = fileName.replace(/\.[^/.]+$/, "");

        // Define the regex pattern
        const pattern = /^(0[1-4]|1[1-4])_([A-Z0-9][A-Z0-9-]*[A-Z0-9])_eInvoice_(\d{14})$/;
        const match = baseName.match(pattern);

        if (!match) {
            return {
                isValid: false,
                error: 'Invalid file name format. Expected: XX_InvoiceNumber_eInvoice_YYYYMMDDHHMMSS'
            };
        }

        const [, docType, invoiceNumber, timestamp] = match;

        // Validate document type
        const docTypes = {
            '01': 'Invoice',
            '02': 'Credit Note',
            '03': 'Debit Note',
            '04': 'Refund Note',
            '11': 'Self-billed Invoice',
            '12': 'Self-billed Credit Note',
            '13': 'Self-billed Debit Note',
            '14': 'Self-billed Refund Note'
        };

        if (!docTypes[docType]) {
            return {
                isValid: false,
                error: `Invalid document type: ${docType}. Valid types: ${Object.keys(docTypes).join(', ')}`
            };
        }

        // Validate invoice number format
        if (!/^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/.test(invoiceNumber)) {
            return {
                isValid: false,
                error: 'Invalid invoice number format'
            };
        }

        // Validate timestamp
        const year = parseInt(timestamp.substring(0, 4));
        const month = parseInt(timestamp.substring(4, 6));
        const day = parseInt(timestamp.substring(6, 8));
        const hour = parseInt(timestamp.substring(8, 10));
        const minute = parseInt(timestamp.substring(10, 12));
        const second = parseInt(timestamp.substring(12, 14));

        const date = new Date(year, month - 1, day, hour, minute, second);

        if (
            date.getFullYear() !== year ||
            date.getMonth() + 1 !== month ||
            date.getDate() !== day ||
            date.getHours() !== hour ||
            date.getMinutes() !== minute ||
            date.getSeconds() !== second ||
            year < 2000 || year > 2100
        ) {
            return {
                isValid: false,
                error: 'Invalid timestamp in file name'
            };
        }

        return {
            isValid: true,
            docType: docTypes[docType],
            docTypeCode: docType,
            invoiceNumber,
            timestamp: date
        };
    } catch (error) {
        console.error('Error validating file name:', error);
        return {
            isValid: false,
            error: 'Error validating file name'
        };
    }
}


const fileUploadElement = document.getElementById('fileUpload');
if (fileUploadElement) {
    fileUploadElement.addEventListener('change', handleFileUpload);
} else {
    // Try the alternative ID that seems to be used in the application
    const flatFileUploadElement = document.getElementById('flatFileUpload');
    if (flatFileUploadElement) {
        flatFileUploadElement.addEventListener('change', handleFileUpload);
        console.log('Event listener added to flatFileUpload instead of fileUpload');
    } else {
        console.warn('Neither fileUpload nor flatFileUpload elements found in the DOM');
    }
}

// Function to refresh file list after upload
async function refreshFileList() {
    try {
        // Get the DataTable instance - use invoiceTable which is the ID in consolidated.html
        const table = $('#invoiceTable').DataTable();

        if (!table || !table.ajax) {
            console.error("DataTable instance not found or initialized correctly");
            throw new Error("Table not initialized properly");
        }

        // Show loading indicator if available
        $('#tableLoadingOverlay').removeClass('d-none');

        // Reload the table data
        await table.ajax.reload(null, false);

        // Update card totals if the function exists
        if (typeof InvoiceTableManager.getInstance().updateCardTotals === 'function') {
            InvoiceTableManager.getInstance().updateCardTotals();
        }

        console.log('File list refreshed successfully');
    } catch (error) {
        console.error('Error refreshing file list:', error);
        Swal.fire({
            icon: 'error',
            title: 'Refresh Failed',
            text: 'Failed to refresh the file list: ' + error.message,
            confirmButtonColor: '#1e88e5'
        });
    } finally {
        // Hide loading indicator if available
        $('#tableLoadingOverlay').addClass('d-none');
    }
}

// Class to handle file upload functionality
class FileUploadManager {
    constructor() {
        console.log('FileUploadManager initialized');
        this.uploadArea = document.getElementById('uploadArea');
        this.fileInput = document.getElementById('flatFileUpload');
        this.processFileBtn = document.getElementById('processFileBtn');
        this.browseFilesLink = document.getElementById('browseFilesLink');
        this.maxFileSize = 5 * 1024 * 1024; // 5MB
        this.allowedTypes = ['.xlsx', '.xls'];
        this.selectedFile = null;

        console.log('DOM Elements found:',
            'uploadArea:', !!this.uploadArea,
            'fileInput:', !!this.fileInput,
            'processFileBtn:', !!this.processFileBtn,
            'browseFilesLink:', !!this.browseFilesLink
        );

        // Check if our inline script has already set up event handlers
        this.inlineScriptActive = window.fileUploadHandlersInitialized === true;
        console.log('Inline script active:', this.inlineScriptActive);

        if (!this.inlineScriptActive) {
            console.log('Initializing all event listeners');
            this.initializeEventListeners();
        } else {
            // Only initialize the process button handler if inline script is active
            console.log('Only initializing process button handler');
            this.initializeProcessButtonHandler();
            console.log('Using inline script handlers for file upload, only initializing process button');
        }
    }

    initializeProcessButtonHandler() {
        console.log('Initializing process button handler');
        // Process file button - always handle this from the JS
        if (this.processFileBtn) {
            console.log('Process button found, adding click handler');
            this.processFileBtn.addEventListener('click', this.handleProcessFile.bind(this));
            console.log('Process button handler initialized');
        } else {
            console.error('Process button not found in the DOM. Looking for element with ID "processFileBtn"');
            // Try to find it again just to be sure
            const processBtn = document.getElementById('processFileBtn');
            console.log('Direct query for processFileBtn returned:', processBtn);
        }

        // Set up a mutation observer to watch for new file selections
        const fileDetails = document.getElementById('fileDetails');
        if (fileDetails) {
            console.log('File details element found, setting up mutation observer');
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        // Check if file details is now visible
                        if (!fileDetails.classList.contains('d-none')) {
                            const fileName = fileDetails.querySelector('.file-name')?.textContent;
                            if (fileName) {
                                console.log('File selected from inline script:', fileName);
                                // Find the file object from the file input
                                const files = this.fileInput?.files;
                                if (files && files.length > 0) {
                                    this.selectedFile = files[0];
                                    console.log('File selected in mutation observer:', this.selectedFile);

                                    // Enable the process button if it exists
                                    if (this.processFileBtn) {
                                        this.processFileBtn.disabled = false;
                                        console.log('Process button enabled');
                                    }
                                }
                            }
                        }
                    }
                });
            });

            observer.observe(fileDetails, { attributes: true });
            console.log('Mutation observer set up for file details element');
        } else {
            console.error('File details element not found in the DOM. Looking for element with ID "fileDetails"');
        }
    }

    initializeEventListeners() {
        console.log('Initializing full file upload event listeners');

        // Drag and drop events
        if (this.uploadArea) {
            this.uploadArea.addEventListener('dragover', this.handleDragOver.bind(this));
            this.uploadArea.addEventListener('dragleave', this.handleDragLeave.bind(this));
            this.uploadArea.addEventListener('drop', this.handleDrop.bind(this));
        }

        // File input change event
        if (this.fileInput) {
            this.fileInput.addEventListener('change', this.handleFileSelection.bind(this));
        }

        // Process file button
        if (this.processFileBtn) {
            this.processFileBtn.addEventListener('click', this.handleProcessFile.bind(this));
        }

        // Cancel upload button
        const cancelUploadBtn = document.getElementById('cancelUploadBtn');
        if (cancelUploadBtn) {
            cancelUploadBtn.addEventListener('click', () => {
                this.resetUI();
            });
        }

        // Remove any file button in the file details container
        const removeFileBtn = document.getElementById('removeFile');
        if (removeFileBtn) {
            removeFileBtn.addEventListener('click', () => {
                this.resetUI();
            });
        }
    }

    async handleProcessFile() {
        console.log('Processing file...', this);

        // Get the file from file input if not already selected
        if (!this.selectedFile && this.fileInput && this.fileInput.files.length > 0) {
            this.selectedFile = this.fileInput.files[0];
            console.log('File selected from input:', this.selectedFile);
        }

        if (!this.selectedFile) {
            console.warn('No file selected for processing');
            this.showError('Please select a file to upload');
            return;
        }

        try {
            // Disable the process button to prevent double submission
            if (this.processFileBtn) {
                this.processFileBtn.disabled = true;
                this.processFileBtn.innerHTML = '<i class="spinner-border spinner-border-sm me-2"></i>Uploading...';
            }

            // Validate filename format before uploading
            const filename = this.selectedFile.name;
            if (!this.validateFilenameFormat(filename)) {
                this.showFilenameFormatError();
                return;
            }

            // Show loading state with progress
            this.showLoadingState('Uploading and processing your file...');

            // Validate file type only (without strict filename validation)
            const fileExt = '.' + this.selectedFile.name.split('.').pop().toLowerCase();
            console.log('File extension:', fileExt, 'Allowed types:', this.allowedTypes);
            if (!this.allowedTypes.includes(fileExt)) {
                throw new Error('Invalid file type. Please upload only Excel files (.xlsx or .xls)');
            }

            // Create FormData
            const formData = new FormData();
            formData.append('file', this.selectedFile);
            formData.append('manual', 'true'); // Flag to indicate manual upload

            // API endpoint for consolidated upload
            const endpoint = '/api/outbound-files/upload-consolidated';

            console.log('Uploading file to:', endpoint);
            const response = await fetch(endpoint, {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();
            console.log('Upload response:', result);

            if (!response.ok) {
                console.error('Upload response error:', result);
                const errorMessage = result.message || result.error?.message || 'Upload failed: Server error';

                // Check if this is a filename format error
                if (errorMessage.includes('Filename does not follow the required format')) {
                    // Show specialized format error
                    this.showFilenameFormatError();
                    return;
                }

                // Hide loading state before showing error
                this.hideLoadingState();

                // Show error modal - will return after user interacts with it
                this.showError(errorMessage);

                // Close the modal after error is shown and user acknowledges it
                this.closeUploadModal();

                // Reset UI state
                this.resetUI();

                return; // Exit early
            }

            // Show success message
            this.showSuccess('File uploaded successfully');

            // Refresh the file list with force refresh
            try {
                // Force refresh to bypass cache
                sessionStorage.setItem('forceRefreshOutboundTable', 'true');
                dataCache.invalidateCache();
                await refreshFileList();
            } catch (refreshError) {
                console.warn('Failed to refresh file list:', refreshError);
                // Continue execution even if refresh fails
            }

            // Close the modal and ensure backdrop is also removed
            this.closeUploadModal();

            // Reset UI at the end
            this.resetUI();

        } catch (error) {
            console.error('Upload error:', error);

            // Hide loading state before showing error
            this.hideLoadingState();

            // Show error with proper message
            this.showError(error.message || 'Failed to upload file. Please try again later.');

            // Close the modal after error is shown
            this.closeUploadModal();

            // Reset UI state
            this.resetUI();
        } finally {
            // Re-enable the process button
            if (this.processFileBtn) {
                this.processFileBtn.disabled = false;
                this.processFileBtn.innerHTML = '<i class="bi bi-arrow-right-circle me-2"></i>Process File';
            }
        }
    }

    // Add helper method to close the upload modal
    closeUploadModal() {
        try {
            const modalEl = document.getElementById('flatFileUploadModal');
            if (modalEl) {
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) {
                    modal.hide();
                }
                // Remove any lingering backdrops
                document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
                    backdrop.remove();
                });
                // Reset body classes
                document.body.classList.remove('modal-open');
                document.body.style.overflow = '';
                document.body.style.paddingRight = '';
            }
        } catch (modalError) {
            console.warn('Error closing modal:', modalError);
            // Force cleanup of modal artifacts
            document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
                backdrop.remove();
            });
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        }
    }

    resetUI() {
        console.log('Resetting UI');
        // Clear file input
        if (this.fileInput) {
            this.fileInput.value = '';
        }

        // Hide the file details container
        const fileDetails = document.getElementById('fileDetails');
        if (fileDetails) {
            fileDetails.classList.add('d-none');
        }

        // Show the upload area
        if (this.uploadArea) {
            this.uploadArea.style.display = 'block';
            this.uploadArea.classList.remove('border-primary');
        }

        // Disable process button
        if (this.processFileBtn) {
            this.processFileBtn.disabled = true;
        }

        // Clear selected file
        this.selectedFile = null;
    }

    showLoadingState() {
        Swal.fire({
            title: 'Uploading...',
            html: `
                <div class="text-center">
                    <div class="mb-3">Please wait while we process your file</div>
                    <div class="progress mb-3" style="height: 10px;">
                        <div class="progress-bar progress-bar-striped progress-bar-animated"
                             role="progressbar" style="width: 100%"></div>
                    </div>
                    <div class="small text-muted">This may take a moment</div>
                </div>
            `,
            allowOutsideClick: false,
            allowEscapeKey: false,
            showConfirmButton: false,
            willOpen: () => {
                Swal.showLoading();
            }
        });
    }

    hideLoadingState() {
        // Close any open SweetAlert dialogs
        try {
            if (typeof Swal !== 'undefined') {
                Swal.close();
            }

            // Also remove any manually added loading overlays if they exist
            const loadingOverlays = document.querySelectorAll('.swal2-container, .loading-overlay');
            if (loadingOverlays.length > 0) {
                loadingOverlays.forEach(overlay => {
                    overlay.remove();
                });
            }
        } catch (error) {
            console.warn('Error hiding loading state:', error);
        }
    }

    showSuccess(message) {
        Swal.fire({
            icon: 'success',
            title: 'Success',
            text: message,
            confirmButtonColor: '#1e88e5',
            didClose: () => {
                // Refresh the file list once more when the success dialog is closed
                try {
                    // Force refresh to ensure latest data
                    sessionStorage.setItem('forceRefreshOutboundTable', 'true');
                    dataCache.invalidateCache();
                    refreshFileList();
                } catch (e) {
                    console.warn('Error refreshing file list on dialog close:', e);
                }
            }
        });
    }

    showError(message) {
        // Make sure any loading state is hidden first
        this.hideLoadingState();

        // Use SweetAlert2 for showing error
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: message,
            confirmButtonColor: '#1e88e5',
            allowOutsideClick: false,
            allowEscapeKey: false
        });
    }

    // Add missing handleDragOver, handleDragLeave, and handleDrop methods
    handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        if (this.uploadArea) {
            this.uploadArea.classList.add('border-primary');
        }
    }

    handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        if (this.uploadArea) {
            this.uploadArea.classList.remove('border-primary');
        }
    }

    handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        if (this.uploadArea) {
            this.uploadArea.classList.remove('border-primary');
        }

        const dt = e.dataTransfer;
        if (dt.files && dt.files.length) {
            this.handleFileSelection(dt.files[0]);
        }
    }

    // Add handleFileSelection method if it doesn't exist
    handleFileSelection(file) {
        console.log('File selected:', file);

        // Check if this is an event or a file
        let selectedFile = file;
        if (file instanceof Event) {
            const target = file.target;
            if (target && target.files && target.files.length > 0) {
                selectedFile = target.files[0];
            }
        }

        if (!selectedFile) {
            console.warn('No file provided to handleFileSelection');
            return;
        }

        // Validate file extension
        const fileExt = '.' + selectedFile.name.split('.').pop().toLowerCase();
        if (!this.allowedTypes.includes(fileExt)) {
            this.showError(`Invalid file type. Please upload only ${this.allowedTypes.join(' or ')} files.`);
            return;
        }

        // Validate file size
        if (selectedFile.size > this.maxFileSize) {
            this.showError(`File is too large. Maximum allowed size is ${this.maxFileSize / (1024 * 1024)}MB.`);
            return;
        }

        // Store the selected file
        this.selectedFile = selectedFile;

        // Update UI
        const fileDetails = document.getElementById('fileDetails');
        const fileName = fileDetails?.querySelector('.file-name');
        const fileInfo = fileDetails?.querySelector('.file-info');

        if (fileDetails && fileName && fileInfo) {
            // Update file details
            fileName.textContent = selectedFile.name;
            fileInfo.textContent = `Size: ${(selectedFile.size / 1024).toFixed(2)} KB`;

            // Show file details
            fileDetails.classList.remove('d-none');

            // Hide upload area
            if (this.uploadArea) {
                this.uploadArea.style.display = 'none';
            }

            // Enable process button
            if (this.processFileBtn) {
                this.processFileBtn.disabled = false;
            }

            console.log('File details displayed, process button enabled');
        } else {
            console.error('Could not find file details elements:',
                'fileDetails:', !!fileDetails,
                'fileName:', !!fileName,
                'fileInfo:', !!fileInfo
            );
        }
    }

    // Add this new method to FileUploadManager
    showFilenameFormatError() {
        const self = this;
        Swal.fire({
            icon: 'error',
            title: 'Filename Format Error',
            html: `
                <div class="text-start">
                    <p>Your filename does not follow the required format:</p>
                    <div class="alert alert-info small">
                        <strong>Required Format:</strong>
                        <code>XX_InvoiceNumber_eInvoice_YYYYMMDDHHMMSS</code>
                    </div>

                    <p><strong>Where:</strong></p>
                    <ul class="text-start small">
                        <li><strong>XX</strong>: Document type code (01, 02, 03, etc.)</li>
                        <li><strong>InvoiceNumber</strong>: Your invoice reference number</li>
                        <li><strong>eInvoice</strong>: Must be exact text "eInvoice"</li>
                        <li><strong>YYYYMMDDHHMMSS</strong>: Date/time in format (Year, Month, Day, Hour, Minute, Second)</li>
                    </ul>

                    <p><strong>Example:</strong></p>
                    <div class="bg-light p-2 rounded">
                        <code>01_INV2024001_eInvoice_20240426152233</code>
                    </div>

                    <div class="alert alert-warning mt-3 small">
                        <i class="bi bi-lightbulb me-2"></i>
                        <strong>Tip:</strong> You can rename your file manually or use our "Fix Format" option which will automatically rename your file for you.
                    </div>
                </div>
            `,
            confirmButtonColor: '#1e88e5',
            confirmButtonText: 'I Understand',
            showCancelButton: true,
            cancelButtonText: 'Fix Format',
            cancelButtonColor: '#28a745',
            width: '42em'
        }).then((result) => {
            if (result.dismiss === Swal.DismissReason.cancel) {
                // User wants to fix the format
                self.showFileRenameDialog();
            }
        });
    }

    // Add back the validator function
    validateFilenameFormat(filename) {
        // Remove file extension
        const filenameWithoutExt = filename.split('.')[0];

        // Regex pattern for XX_InvoiceNumber_eInvoice_YYYYMMDDHHMMSS
        // Where XX is document type (01, 02, etc.)
        // InvoiceNumber can be any alphanumeric string
        // eInvoice is fixed text
        // YYYYMMDDHHMMSS is date/time format
        const pattern = /^\d{2}_[a-zA-Z0-9_-]+_eInvoice_\d{14}$/;

        return pattern.test(filenameWithoutExt);
    }

    // Add this method to help users rename their file
    showFileRenameDialog() {
        const self = this;
        if (!this.selectedFile) {
            this.showError('No file selected');
            return;
        }

        // Get current filename without extension
        const originalFilename = this.selectedFile.name;
        const extension = originalFilename.split('.').pop().toLowerCase();

        // Generate timestamp for the new filename
        const now = new Date();
        const timestamp = now.getFullYear() +
            String(now.getMonth() + 1).padStart(2, '0') +
            String(now.getDate()).padStart(2, '0') +
            String(now.getHours()).padStart(2, '0') +
            String(now.getMinutes()).padStart(2, '0') +
            String(now.getSeconds()).padStart(2, '0');

        Swal.fire({
            title: 'Fix Filename Format',
            html: `
                <div class="text-start">
                    <p>Please provide the following information to rename your file:</p>

                    <div class="form-group mb-3">
                        <label for="docType" class="form-label">Document Type:</label>
                        <select id="docType" class="form-select">
                            <option value="01">01 - Invoice</option>
                            <option value="02">02 - Credit Note</option>
                            <option value="03">03 - Debit Note</option>
                            <option value="04">04 - Refund Note</option>
                            <option value="11">11 - Self-billed Invoice</option>
                            <option value="12">12 - Self-billed Credit Note</option>
                            <option value="13">13 - Self-billed Debit Note</option>
                            <option value="14">14 - Self-billed Refund Note</option>
                        </select>
                    </div>

                    <div class="form-group mb-3">
                        <label for="invoiceNumber" class="form-label">Invoice Number:</label>
                        <input type="text" id="invoiceNumber" class="form-control" placeholder="Enter invoice number" value="INV${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}">
                    </div>

                    <div class="alert alert-info small">
                        <i class="bi bi-info-circle me-2"></i>
                        New filename will be: <span id="newFilenamePreview" class="fw-bold"></span>.${extension}
                    </div>
                </div>
            `,
            confirmButtonText: 'Rename & Continue',
            confirmButtonColor: '#28a745',
            showCancelButton: true,
            cancelButtonText: 'Cancel',
            width: '42em',
            didOpen: () => {
                // Update the filename preview when inputs change
                const updatePreview = () => {
                    const docType = document.getElementById('docType').value;
                    const invoiceNumber = document.getElementById('invoiceNumber').value;
                    const newFilename = `${docType}_${invoiceNumber}_eInvoice_${timestamp}`;
                    document.getElementById('newFilenamePreview').textContent = newFilename;
                };

                // Initial preview
                updatePreview();

                // Add event listeners
                document.getElementById('docType').addEventListener('change', updatePreview);
                document.getElementById('invoiceNumber').addEventListener('input', updatePreview);
            }
        }).then((result) => {
            if (result.isConfirmed) {
                const docType = document.getElementById('docType').value;
                const invoiceNumber = document.getElementById('invoiceNumber').value;

                // Create the new filename
                const newFilename = `${docType}_${invoiceNumber}_eInvoice_${timestamp}.${extension}`;

                // Create a new file with the correct name
                self.renameAndUploadFile(newFilename);
            }
        });
    }

    // Add method to rename and upload the file
    renameAndUploadFile(newFilename) {
        const self = this;

        if (!this.selectedFile) {
            this.showError('No file selected');
            return;
        }

        // Show loading state
        this.showLoadingState('Preparing your file...');

        // Create a new file object with the new name
        const newFile = new File([this.selectedFile], newFilename, {
            type: this.selectedFile.type,
            lastModified: this.selectedFile.lastModified
        });

        // Update the selected file
        this.selectedFile = newFile;

        // Update file details display
        const fileDetails = document.getElementById('fileDetails');
        const fileName = fileDetails?.querySelector('.file-name');
        const fileInfo = fileDetails?.querySelector('.file-info');

        if (fileDetails && fileName && fileInfo) {
            // Update file details
            fileName.textContent = newFilename;
            fileInfo.textContent = `Size: ${(this.selectedFile.size / 1024).toFixed(2)} KB`;

            // Make sure file details are visible
            fileDetails.classList.remove('d-none');

            // Hide upload area if needed
            if (this.uploadArea) {
                this.uploadArea.style.display = 'none';
            }

            // Enable process button
            if (this.processFileBtn) {
                this.processFileBtn.disabled = false;
            }
        }

        // Close loading state
        this.hideLoadingState();

        // Show success message with preview of the renamed file
        Swal.fire({
            icon: 'success',
            title: 'File Renamed',
            html: `
                <p>Your file has been renamed to the correct format:</p>
                <div class="alert alert-success">
                    <i class="bi bi-check-circle me-2"></i>
                    <strong>${newFilename}</strong>
                </div>
                <p class="small text-muted mt-3">Click "Continue Upload" to proceed with the renamed file.</p>
            `,
            confirmButtonColor: '#28a745',
            confirmButtonText: 'Continue Upload',
            showCancelButton: true,
            cancelButtonText: 'Cancel Upload',
            cancelButtonColor: '#6c757d'
        }).then((result) => {
            if (result.isConfirmed) {
                // Proceed with upload
                self.handleProcessFile();
            } else {
                // User canceled, reset the UI
                self.resetUI();
            }
        });
    }

}

// Consolidated initialization
document.addEventListener('DOMContentLoaded', (event) => {
    console.log('DOMContentLoaded event fired', event);
    console.log('Initializing FileUploadManager');
    // Set a flag to indicate the inline script is active
    window.fileUploadHandlersInitialized = true;
    console.log('fileUploadHandlersInitialized set to true');

    // Initialize the FileUploadManager
    try {
        console.log('Creating new FileUploadManager instance');
        const fileUploadManager = new FileUploadManager();
        console.log('FileUploadManager instance created successfully:', fileUploadManager);

        // Store it globally for debugging
        window.fileUploadManager = fileUploadManager;
        console.log('FileUploadManager instance stored in window.fileUploadManager for debugging');
    } catch (error) {
        console.error('Error initializing FileUploadManager:', error);
    }

    // Initialize template download if needed
    if (typeof initializeTemplateDownload === 'function') {
        console.log('initializing template download');
        initializeTemplateDownload();
    } else {
        console.log('initializeTemplateDownload function not found');
    }
});

// Function to initialize template download
function initializeTemplateDownload() {
    console.log('Initializing template download');

    // Set up download template button handler if it exists
    const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');
    if (downloadTemplateBtn) {
        downloadTemplateBtn.addEventListener('click', function(e) {
            e.preventDefault();

            // Show download options popup
            const downloadPopup = document.getElementById('downloadPopup');
            if (downloadPopup) {
                downloadPopup.style.display = 'block';
            } else {
                console.warn('Download popup element not found');
            }
        });

        console.log('Download template button handler initialized');
    } else {
        console.warn('Download template button not found in the DOM');
    }
}

// Initialize all components when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM fully loaded, initializing components');

    // Initialize date/time display
    DateTimeManager.updateDateTime();

    // Initialize the table manager
    const tableManager = InvoiceTableManager.getInstance();

    // Initialize template download functionality
    if (typeof initializeTemplateDownload === 'function') {
        initializeTemplateDownload();
    } else {
        console.log('initializeTemplateDownload function not found');
    }
});

// Add this function to show a specialized TIN mismatch error message
function showTINMismatchError(error) {
    const title = 'Tax Identification Number (TIN) Mismatch';
    const mainError = error.error || {};

    const modalHtml = `
        <div class="modal-content">
            <div class="modal-header bg-warning">
                <h5 class="modal-title text-white">
                    <i class="fas fa-exclamation-triangle mr-2"></i> ${title}
                </h5>
                <button type="button" class="close text-white" data-dismiss="modal" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
            <div class="modal-body">
                <div class="alert alert-warning">
                    <strong>Authentication Error:</strong> ${mainError.message || 'The TIN in the document does not match the TIN of the authenticated user'}
                </div>

                <div class="card mb-3">
                    <div class="card-header bg-light">
                        <h6 class="mb-0"><i class="fas fa-info-circle mr-2"></i>Why this happened</h6>
                    </div>
                    <div class="card-body">
                        <p>When submitting a document to LHDN, the Tax Identification Number (TIN) in the document must match the TIN of the authenticated user account.</p>
                        <p>This is a security measure to ensure that documents are only submitted by authorized users.</p>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header bg-light">
                        <h6 class="mb-0"><i class="fas fa-tasks mr-2"></i>How to fix this</h6>
                    </div>
                    <div class="card-body">
                        <ol class="mb-0">
                            <li>Check that the TIN in the document is correct</li>
                            <li>Verify that you are logged in with the correct user account that matches the TIN in the document</li>
                            <li>If necessary, update the document with the correct TIN</li>
                            <li>Try submitting the document again</li>
                        </ol>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
            </div>
        </div>
    `;

    $('#errorModal').html(modalHtml);
    $('#errorModal').modal('show');
}

// Then find the function that handles errors and add the TIN_MISMATCH case
