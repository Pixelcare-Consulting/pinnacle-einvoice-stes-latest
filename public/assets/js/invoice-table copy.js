class InvoiceTableManager {
    constructor() {
        this.authManager = new BQEAuthManager(); // Use BQEAuthManager instead of AuthManager
        this.loadingOverlay = document.getElementById('tableLoadingOverlay');
        this.tooltips = new Set(); // Track active tooltips
        
        // Bind methods to preserve 'this' context
        this.calculateCancellationTime = this.calculateCancellationTime.bind(this);
        this.initializeTable = this.initializeTable.bind(this);
        this.initializeEventListeners = this.initializeEventListeners.bind(this);
        this.refreshInvoiceTable = this.refreshInvoiceTable.bind(this);
        this.submitToLHDN = this.submitToLHDN.bind(this);
        this.updateTotalInvoicesFetched = this.updateTotalInvoicesFetched.bind(this);
        this.updateCardCounts = this.updateCardCounts.bind(this);
        this.isTableInitialized = this.isTableInitialized.bind(this);
        this.saveInvoicesInBatches = this.saveInvoicesInBatches.bind(this);
        this.formatRelativeTime = this.formatRelativeTime.bind(this);
        
        // Initialize immediately instead of using requestAnimationFrame
        this.initializeTable();
        this.initializeEventListeners();

        this.cardCounts = {
            total: 0,
            submitted: 0,
            pending: 0,
            cancelled: 0
        };

        this.loadingDotsInterval = null;
        this.currentDots = '';
    }

    // Add this method if it doesn't exist
    calculateCancellationTime(submissionDate, status) {
        // Add status parameter and check it first
        if (status?.toLowerCase() === 'cancelled') {
            return {
                expired: false,
                isNA: true,
                message: 'Not Applicable',
                urgency: 'not-applicable',
                hours: '-',
                minutes: '-'
            };
        }

        if (!submissionDate) {
            return {
                expired: false,
                isNA: true,
                message: 'Not Available for Cancellation',
                urgency: 'not-applicable',
                hours: '-',
                minutes: '-'
            };
        }

        try {
            const now = moment();
            // Ensure proper date format
            const submissionMoment = moment(submissionDate);
            
            // Check if submission date is valid
            if (!submissionMoment.isValid()) {
                console.warn('Invalid submission date:', submissionDate);
                return {
                    expired: false,
                    isNA: true,
                    message: 'Not Available for Cancellation',
                    urgency: 'not-applicable',
                    hours: '-',
                    minutes: '-'
                };
            }

            // Calculate deadline (72 hours from submission)
            const deadlineDate = submissionMoment.clone().add(72, 'hours');

            // If past deadline
            if (now.isAfter(deadlineDate)) {
                return {
                    expired: true,
                    isNA: false,
                    message: 'Cancellation Period Expired',
                    urgency: 'expired',
                    hours: '0',
                    minutes: '0'
                };
            }

            // Calculate remaining time
            const duration = moment.duration(deadlineDate.diff(now));
            const totalHours = Math.floor(duration.asHours());
            const remainingMinutes = Math.floor((duration.asMinutes() % 60));

            // Determine urgency level
            let urgency = 'normal';
            if (totalHours <= 6) {
                urgency = 'urgent';
            } else if (totalHours <= 24) {
                urgency = 'warning';
            }

            // Format the message
            const message = `${totalHours}h ${remainingMinutes}m remaining`;

            return {
                expired: false,
                isNA: false,
                hours: totalHours,
                minutes: remainingMinutes,
                message: message,
                urgency: urgency,
                deadline: deadlineDate.format('YYYY-MM-DD HH:mm:ss'),
                submissionDate: submissionMoment.format('YYYY-MM-DD HH:mm:ss')
            };

        } catch (error) {
            console.error('Error calculating cancellation time:', error);
            return {
                expired: false,
                isNA: true,
                message: 'Error calculating time',
                urgency: 'not-applicable',
                hours: '-',
                minutes: '-'
            };
        }
    }

    initializeTable() {
        try {
            console.log('Initializing table...');
            const table = $('#reportsTable');
            
            if (!table.length) {
                throw new Error('Table element not found');
            }

            console.log('Creating new DataTable instance...');
            this.dataTable = table.DataTable({
                responsive: false,
                scrollX: false,
                processing: true,
                deferRender: true,
                pageLength: 10,
                columns: [
                    { 
                        data: 'checkbox',
                        orderable: false,
                        render: function() {
                            return '<div class="form-check"><input type="checkbox" class="form-check-input row-checkbox"></div>';
                        }
                    },
                    { 
                        data: 'invoice_number',
                        width: '160px',
                        render: function(data) {
                            return `<span class="badge-invoice" data-bs-toggle="tooltip" title="Invoice Number: ${data}">${data}</span>`;
                        }
                    },
                    { 
                        data: 'type',
                        render: function(data, type, row) {
                            // Add null check and default value
                            const typeValue = data || 'Invoice';
                            const typeClass = typeValue.toLowerCase().replace(/\s+/g, '-');
                            return `<span class="badge-type ${typeClass}" data-bs-toggle="tooltip" title="Document Type: ${typeValue}">${typeValue}</span>`;
                        }
                    },
                    { 
                        data: 'customer_name',
                        render: function(data, type, row) {
                            const details = row._clientDetails || {};
                            
                            // Get values from custom fields if available
                            const customFieldsMap = {};
                            if (details.customFields?.length) {
                                details.customFields.forEach(field => {
                                    customFieldsMap[field.label] = field.value;
                                });
                            }

                            const tooltipContent = `
                                <div class="client-tooltip">
                                    <div><strong>Client:</strong> ${details.name || 'NA'}</div>
                                    <div><strong>Company:</strong> ${details.company || 'NA'}</div>
                                    <div><strong>Tax ID:</strong> ${customFieldsMap["BUYER'S TAX ID"] || details.taxId || 'NA'}</div>
                                    <div><strong>Reg No:</strong> ${customFieldsMap["Buyer's Registration No"] || details.registrationNo || 'NA'}</div>
                                    <div><strong>Address:</strong> ${details.address?.formattedAddress || 'NA'}</div>
                                </div>
                            `;
                            return `<span class="customer-name" data-bs-toggle="tooltip" data-bs-html="true" title="${tooltipContent.replace(/"/g, '&quot;')}">${data}</span>`;
                        }
                    },
                    { 
                        data: 'bqe_date',
                        render: function(data) {
                            // Format BQE date with tooltip showing full date/time
                            if (!data) return '-';
                            const formattedDate = moment(data).format('MM-DD-YYYY');
                            const fullDateTime = moment(data).format('YYYY-MM-DD HH:mm:ss');
                            const textFormat = moment(data).format('dddd, MMMM D, YYYY');
                            return `
                                <div>
                                    <span data-bs-toggle="tooltip" title="Full Date: ${fullDateTime}">${formattedDate}</span>
                                    <div class="text-muted small">${textFormat}</div>
                                </div>
                            `;
                        }
                    },
                    { 
                        data: 'date_sync',
                        title: 'Sync Time',
                        render: (data, type, row) => {
                            if (type === 'display') {
                                return this.formatRelativeTime(data);
                            }
                            return data;
                        }
                    },
                    { 
                        data: 'date_submitted',
                        render: function(data, type, row) {
                            if (type === 'display') {
                                if (row.status === 'Submitted' && data) {
                                    const submissionDate = moment(data);
                                    return `
                                        <div>
                                            <span>${submissionDate.format('MM-DD-YYYY')}</span>
                                            <div class="text-muted small">${submissionDate.format('dddd, MMMM D, YYYY')}</div>
                                            <div class="text-muted small">${submissionDate.format('h:mm A')}</div>
                                        </div>
                                    `;
                                }
                                return '-';
                            }
                            return data;
                        }
                    },
                    { 
                        data: 'cancellation_period',
                        render: (data, type, row) => {
                            if (row.status === 'Cancelled' || row.status === 'Pending') {
                                return `<span class="badge-cancellation not-applicable">
                                    <i class="bi bi-dash-circle"></i>
                                    Not Applicable
                                </span>`;
                            }

                            if (row.status === 'Submitted' && row.date_submitted) {
                                const timeInfo = this.calculateCancellationTime(row.date_submitted, row.status);
                                
                                if (timeInfo.expired) {
                                    return `<span class="badge-cancellation expired">
                                        <i class="bi bi-x-circle text-white"></i>
                                        <span class="text-white">Expired</span>
                                    </span>`;
                                }

                                // Determine badge class based on remaining time
                                let badgeClass = 'success'; // Default green
                                let iconClass = 'bi-clock';
                                
                                if (timeInfo.hours <= 6) { // Less than 6 hours - Red
                                    badgeClass = 'danger';
                                    iconClass = 'bi-clock-fill';
                                } else if (timeInfo.hours <= 24) { // Less than 24 hours - Yellow
                                    badgeClass = 'warning';
                                    iconClass = 'bi-clock-fill';
                                }

                                return `<span class="badge-cancellation ${badgeClass}">
                                    <i class="bi ${iconClass} me-1"></i>
                                    ${timeInfo.message}
                                </span>`;
                            }

                            return `<span class="badge-cancellation not-applicable">
                                <i class="bi bi-dash-circle"></i>
                                Not Applicable
                            </span>`;
                        }
                    },
                    { 
                        data: 'status',
                        render: function(data, type, row) {
                            if (type === 'display') {
                                const status = data || 'Pending';
                                const statusClass = status.toLowerCase();
                                const customClass = status.toLowerCase() === 'cancelled' ? 'cancelled' : statusClass;
                                
                                // Add icon based on status
                                let icon = '';
                                switch(status.toLowerCase()) {
                                    case 'pending':
                                        icon = '<i class="bi bi-hourglass-split me-1"></i>';
                                        break;
                                    case 'submitted':
                                        icon = '<i class="bi bi-check-circle me-1"></i>';
                                        break;
                                    case 'cancelled':
                                        icon = '<i class="bi bi-x-circle me-1"></i>';
                                        break;
                                }
                                
                                return `<span class="status-badge ${customClass}">${icon}${status}</span>`;
                            }
                            return data;
                        }
                    },
                    { 
                        data: null,
                        orderable: false,
                        render: (data, type, row) => {
                            // Make sure we have a valid invoice ID
                            const invoiceId = row.id;
                            if (!invoiceId) {
                                console.warn('No invoice ID found for row:', row);
                                return '<button class="btn btn-view" disabled><i class="bi bi-eye"></i><span>View</span></button>';
                            }
                            return `<button class="btn btn-view view-details-btn" data-invoice-id="${invoiceId}">
                                <i class="bi bi-eye"></i>
                                <span>View</span>
                            </button>`;
                        }
                    }
                ],
                order: [[1, 'desc']],
                drawCallback: () => {
                    try {
                        // Safely dispose tooltips
                        this.tooltips.forEach(tooltip => {
                            try {
                                if (tooltip && typeof tooltip.dispose === 'function') {
                                    // Check if tooltip element still exists
                                    const element = tooltip._element;
                                    if (element && document.body.contains(element)) {
                                        tooltip.dispose();
                                    }
                                }
                            } catch (tooltipError) {
                                console.warn('Error disposing tooltip:', tooltipError);
                            }
                        });
                        this.tooltips.clear();

                        // Initialize new tooltips
                        requestAnimationFrame(() => {
                            try {
                                document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
                                    if (el) {
                                        const tooltip = new bootstrap.Tooltip(el, {
                                            placement: 'top',
                                            trigger: 'hover',
                                            container: 'body',
                                            html: true,
                                            template: `
                                                <div class="tooltip" role="tooltip">
                                                    <div class="tooltip-arrow"></div>
                                                    <div class="tooltip-inner"></div>
                                                </div>
                                            `
                                        });
                                        this.tooltips.add(tooltip);
                                    }
                                });
                            } catch (initError) {
                                console.warn('Error initializing tooltips:', initError);
                            }
                        });

                        // Update card counts and total count after each draw
                        requestAnimationFrame(() => {
                            this.updateCardCounts();
                            // Get count directly from DataTable
                            const count = this.dataTable?.rows().count() || 0;
                            this.updateTotalInvoicesFetched(count);
                        });
                    } catch (error) {
                        console.warn('Error in drawCallback:', error);
                    }
                },
                // Add language options for better info display
                language: {
                    info: "Showing _START_ to _END_ of _TOTAL_ entries",
                    infoEmpty: "Showing 0 entries",
                    infoFiltered: "(filtered from _MAX_ total entries)",
                    emptyTable: "No data available in table"
                },
                // Add initialization complete callback
                initComplete: (settings, json) => {
                    console.log('Table initialization complete');
                    // Show filters section once table is ready
                    document.querySelector('.filters-section')?.classList.remove('d-none');
                }
            });

            // Add event listener for view buttons with error handling
            table.on('click', '.view-details-btn', async (e) => {
                const invoiceId = e.currentTarget.getAttribute('data-invoice-id');
                if (!invoiceId) {
                    console.error('No invoice ID found');
                    return;
                }
                await this.viewInvoiceDetails(invoiceId);
            });

            console.log('Table initialization successful');
            return true;

        } catch (error) {
            console.error('Error initializing DataTable:', error);
            Swal.fire({
                icon: 'error',
                title: 'Initialization Error',
                text: 'Failed to initialize the table. Please refresh the page.',
                confirmButtonText: 'Refresh',
                showCancelButton: true,
            }).then((result) => {
                if (result.isConfirmed) {
                    window.location.reload();
                }
            });
            return false;
        }
    }

    // Add this helper method for rendering cancellation period
    renderCancellationPeriod(row) {
        // For cancelled or pending status, show Not Applicable
        if (row.status === 'Cancelled' || row.status === 'Pending') {
            return `<span class="badge-cancellation not-applicable">
                <i class="bi bi-dash-circle"></i>
                Not Applicable
            </span>`;
        }

        // For submitted status, show cancellation countdown
        if (row.status === 'Submitted' && row.date_submitted) {
            const cancellationTime = this.calculateCancellationTime(row.date_submitted);

            if (cancellationTime.expired) {
                return `<span class="badge-cancellation expired">
                    <i class="bi bi-x-circle"></i>
                    Expired
                </span>`;
            }

            // Handle urgent status
            if (typeof cancellationTime === 'object' && cancellationTime.isUrgent) {
                return `<span class="badge-cancellation urgent">
                    <i class="bi bi-clock-fill"></i>
                    ${cancellationTime.text}
                </span>`;
            }

            // Normal countdown
            return `<span class="badge-cancellation active">
                <i class="bi bi-clock"></i>
                ${typeof cancellationTime === 'object' ? cancellationTime.text : cancellationTime}
            </span>`;
        }

        // For any other status, show Not Applicable
        return `<span class="badge-cancellation not-applicable">
            <i class="bi bi-dash-circle"></i>
            Not Applicable
        </span>`;
    }

    initializeEventListeners() {
        const searchButton = document.getElementById('searchBqeBtn');
        const periodSelect = document.querySelector('.filters-section .form-select');
        const fromDateInput = document.getElementById('fromDate');
        const toDateInput = document.getElementById('toDate');

        // Initialize search button handler
        if (searchButton) {
            searchButton.addEventListener('click', async () => {
                try {
                    // Validate date range
                    const fromDate = fromDateInput?.value;
                    const toDate = toDateInput?.value;
                    
                    if (!fromDate || !toDate) {
                        await Swal.fire({
                            icon: 'warning',
                            title: 'Invalid Date Range',
                            text: 'Please select both From and To dates',
                            confirmButtonText: 'OK'
                        });
                        return;
                    }

                    // Check if date range is valid
                    if (moment(fromDate).isAfter(moment(toDate))) {
                        await Swal.fire({
                            icon: 'warning',
                            title: 'Invalid Date Range',
                            text: 'From date cannot be after To date',
                            confirmButtonText: 'OK'
                        });
                        return;
                    }

                    // Show loading state on button
                    const originalContent = searchButton.innerHTML;
                    searchButton.disabled = true;
                    searchButton.innerHTML = `
                        <span class="spinner-border spinner-border-sm me-2"></span>
                        Searching...
                    `;

                    // Refresh the table with current filters
                    await this.refreshInvoiceTable();

                } catch (error) {
                    console.error('Error during search:', error);
                    await Swal.fire({
                        icon: 'error',
                        title: 'Search Failed',
                        text: 'Failed to fetch invoices. Please try again.',
                        confirmButtonText: 'OK'
                    });
                } finally {
                    // Reset button state
                    if (searchButton) {
                        searchButton.disabled = false;
                        searchButton.innerHTML = `
                            <i class="bi bi-search me-1"></i>
                            Search BQE Invoice
                        `;
                    }
                }
            });
        }

        // Initialize period handler
        if (periodSelect) {
            console.log('Period select found:', periodSelect);
            periodSelect.addEventListener('change', async (e) => {
                console.log('Period changed to:', e.target.value);
                const period = e.target.value.toLowerCase();
                const dates = this.getDateRangeForPeriod(period);
                console.log('Calculated dates:', dates);
                
                // Show/hide search button based on period
                if (searchButton) {
                    searchButton.style.display = period === 'custom' ? 'block' : 'none';
                }
                
                if (fromDateInput && toDateInput) {
                    fromDateInput.value = dates.fromDate;
                    toDateInput.value = dates.toDate;
                    fromDateInput.disabled = period !== 'custom';
                    toDateInput.disabled = period !== 'custom';
                    
                    // Automatically trigger search for non-custom periods
                    if (period !== 'custom') {
                        await this.refreshInvoiceTable();
                    }
                }
            });

            // Set initial state
            const initialPeriod = periodSelect.value.toLowerCase();
            if (searchButton) {
                searchButton.style.display = initialPeriod === 'custom' ? 'block' : 'none';
            }
            if (fromDateInput && toDateInput) {
                fromDateInput.disabled = initialPeriod !== 'custom';
                toDateInput.disabled = initialPeriod !== 'custom';
            }
        } else {
            console.warn('Period select element not found');
        }

        if (searchButton) {
            searchButton.addEventListener('click', async () => {
                searchButton.disabled = true;
                const originalText = searchButton.innerHTML;
                searchButton.innerHTML = '<i class="bi bi-hourglass-split me-2"></i>Fetching...';
                
                try {
                    await this.refreshInvoiceTable();
                } catch (error) {
                    console.error('Error during refresh:', error);
                } finally {
                    searchButton.disabled = false;
                    searchButton.innerHTML = originalText;
                }
            });
        }

        // Add view details event listener
        $('#reportsTable').on('click', '.view-details-btn', async (e) => {
            e.preventDefault();
            const invoiceId = e.currentTarget.dataset.invoiceId;
            await this.viewInvoiceDetails(invoiceId);
        });

        // Add BQE Auth button initialization
        const bqeAuthBtn = document.getElementById('bqeAuthBtn');
        if (bqeAuthBtn) {
            bqeAuthBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    const button = e.currentTarget;
                    const originalContent = button.innerHTML;
                    const bqeAuthBtnText = document.getElementById('bqeAuthBtnText');

                    if (bqeAuthBtnText.textContent === 'Disconnect BQE') {
                        // Show confirmation dialog
                        const result = await Swal.fire({
                            icon: 'warning',
                            title: 'Disconnect BQE?',
                            text: 'Are you sure you want to disconnect from BQE?',
                            showCancelButton: true,
                            confirmButtonText: 'Yes, disconnect',
                            cancelButtonText: 'No, keep connected',
                            confirmButtonColor: '#dc3545',
                            cancelButtonColor: '#6c757d'
                        });

                        if (result.isConfirmed) {
                            button.disabled = true;
                            button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Disconnecting...';

                            const response = await fetch('/bqe/disconnect', {
                                method: 'POST'
                            });
                            const data = await response.json();

                            if (data.success) {
                                // Update button state
                                button.classList.add('auth-btn');
                                button.classList.remove('btn-danger');
                                bqeAuthBtnText.textContent = 'Authorize BQE';
                                
                                const icon = button.querySelector('i');
                                if (icon) {
                                    icon.classList.remove('bi-shield-x');
                                    icon.classList.add('bi-shield-lock');
                                }

                                // Hide filters section
                                const filtersSection = document.querySelector('.filters-section');
                                if (filtersSection) {
                                    filtersSection.classList.add('d-none');
                                }

                                // Show success message
                                await Swal.fire({
                                    icon: 'success',
                                    title: 'Disconnected',
                                    text: 'Successfully disconnected from BQE'
                                });
                            } else {
                                throw new Error(data.error || 'Failed to disconnect');
                            }
                        }
                    } else {
                        // Show loading state
                        button.disabled = true;
                        button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Connecting...';

                        // Get authorization URL
                        const response = await fetch('/bqe/auth');
                        const data = await response.json();

                        if (data.success && data.redirectUrl) {
                            // Show connecting dialog
                            await Swal.fire({
                                title: 'Connecting to BQE',
                                html: `
                                    <div class="text-start">
                                        <div class="alert alert-info mb-3">
                                            <div class="d-flex align-items-center">
                                                <i class="bi bi-info-circle-fill me-2"></i>
                                                <div>
                                                    <h6 class="mb-1">Authorization Process</h6>
                                                    <small>Please wait while we establish a secure connection...</small>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="d-flex align-items-center text-info">
                                            <i class="bi bi-shield-check me-2"></i>
                                            <small class="status-message">Preparing authentication request...</small>
                                        </div>
                                        <div class="mt-2">
                                            <p class="small text-muted mb-1">
                                                <i class="bi bi-clock-history me-1"></i>
                                                Redirecting in <b class="timer">3</b> seconds
                                            </p>
                                        </div>
                                    </div>
                                `,
                                timer: 3000,
                                timerProgressBar: true,
                                showConfirmButton: false,
                                allowOutsideClick: false,
                                didOpen: () => {
                                    Swal.showLoading();
                                    const timer = Swal.getPopup().querySelector('b.timer');
                                    const statusMsg = Swal.getPopup().querySelector('.status-message');
                                    
                                    const timerInterval = setInterval(() => {
                                        const timeLeft = Math.ceil(Swal.getTimerLeft() / 1000);
                                        if (timer) timer.textContent = timeLeft;
                                        
                                        // Update status message
                                        if (timeLeft <= 1) {
                                            statusMsg.textContent = 'Ready to connect...';
                                        } else if (timeLeft <= 2) {
                                            statusMsg.textContent = 'Validating security tokens...';
                                        }
                                    }, 100);

                                    Swal.getPopup().addEventListener('close', () => {
                                        clearInterval(timerInterval);
                                    });
                                }
                            });

                            // Redirect to BQE auth page
                            window.location.href = data.redirectUrl;
                        } else {
                            throw new Error(data.error || 'Failed to get authorization URL');
                        }
                    }
                } catch (error) {
                    console.error('BQE Auth Error:', error);
                    button.disabled = false;
                    button.innerHTML = originalContent;
                    
                    await Swal.fire({
                        icon: 'error',
                        title: 'Authorization Failed',
                        text: error.message || 'Failed to process BQE authorization',
                        confirmButtonText: 'OK'
                    });
                }
            });
        }

        // Add event listener for Submit to LHDN button
        document.addEventListener('click', async (e) => {
            if (e.target.matches('.btn-lhdn') || e.target.closest('.btn-lhdn')) {
                e.preventDefault();
                const button = e.target.matches('.btn-lhdn') ? e.target : e.target.closest('.btn-lhdn');
                const invoiceId = button.dataset.invoiceId || 
                                 button.closest('#viewDetailsModal')?.dataset.invoiceId;

                if (!invoiceId) {
                    console.error('No invoice ID found');
                    return;
                }

                // Store the original button content before modifying
                const originalButtonContent = button.innerHTML;
                
                try {
                    button.disabled = true;
                    button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Processing...';

                    await this.submitToLHDN(invoiceId);

                } catch (error) {
                    console.error('Error submitting to LHDN:', error);
                } finally {
                    // Restore button state using the stored content
                    button.disabled = false;
                    button.innerHTML = originalButtonContent;
                }
            }
        });
    }

    getDateRangeForPeriod(period) {
        const now = moment();
        let fromDate, toDate;

        switch (period.toLowerCase()) {
            case 'today':
                fromDate = now.clone().startOf('day');
                toDate = now.clone().endOf('day');
                break;
            case 'yesterday':
                fromDate = now.clone().subtract(1, 'days').startOf('day');
                toDate = now.clone().subtract(1, 'days').endOf('day');
                break;
            case 'this week':
                fromDate = now.clone().startOf('week');
                toDate = now.clone().endOf('week');
                break;
            case 'last week':
                fromDate = now.clone().subtract(1, 'week').startOf('week');
                toDate = now.clone().subtract(1, 'week').endOf('week');
                break;
            case 'this month':
                fromDate = now.clone().startOf('month');
                toDate = now.clone().endOf('month');
                // Add warning for potential API limit
                this.checkDateRangeSize(fromDate, toDate);
                break;
            case 'last month':
                fromDate = now.clone().subtract(1, 'month').startOf('month');
                toDate = now.clone().subtract(1, 'month').endOf('month');
                // Add warning for potential API limit
                this.checkDateRangeSize(fromDate, toDate);
                break;
            case 'this year':
                fromDate = now.clone().startOf('year');
                toDate = now.clone().endOf('year');
                // Add warning for potential API limit
                this.checkDateRangeSize(fromDate, toDate);
                break;
            case 'last year':
                fromDate = now.clone().subtract(1, 'year').startOf('year');
                toDate = now.clone().subtract(1, 'year').endOf('year');
                // Add warning for potential API limit
                this.checkDateRangeSize(fromDate, toDate);
                break;
            case 'custom':
                // Return empty dates for custom
                return {
                    fromDate: '',
                    toDate: ''
                };
            default:
                fromDate = null;
                toDate = null;
        }

        return {
            fromDate: fromDate ? fromDate.format('YYYY-MM-DD') : '',
            toDate: toDate ? toDate.format('YYYY-MM-DD') : ''
        };
    }

    // Add this new method to check date range size and show warning if needed
    checkDateRangeSize(fromDate, toDate) {
        const daysDifference = toDate.diff(fromDate, 'days');
        const estimatedRecords = daysDifference * 10; // Rough estimate of records per day

        if (estimatedRecords > 2500) {
            Swal.fire({
                icon: 'warning',
                title: 'Large Date Range Selected',
                html: `
                    <div class="alert alert-warning">
                        <i class="bi bi-exclamation-triangle me-2"></i>
                        The selected date range is quite large and might exceed BQE API limits.
                        <hr>
                        <small>
                            • BQE API can only return up to 2,500 records (25 pages × 100 records)<br>
                            • Consider using a smaller date range for more accurate results<br>
                            • Selected range: ${daysDifference} days
                        </small>
                    </div>
                `,
                confirmButtonText: 'I Understand'
            });
        }
    }

    
    async fetchInvoicesFromBQE() {
        try {
            console.log('Starting fetchInvoicesFromBQE...');
            
            const authResponse = await fetch('/bqe/check-auth');
            const authData = await authResponse.json();
            
            if (!authData.isAuthorized || !authData.authResponse) {
                throw new Error('No valid auth response available. Please authorize BQE first.');
            }

            const accessToken = authData.authResponse.access_token;
            const baseUrl = authData.authResponse.endpoint;

            const fromDateInput = document.getElementById('fromDate');
            const toDateInput = document.getElementById('toDate');
            
            const fromDate = fromDateInput?.value || moment().startOf('year').format('YYYY-MM-DD');
            const toDate = toDateInput?.value || moment().endOf('year').format('YYYY-MM-DD');

            console.log('Fetching with date range:', { fromDate, toDate });

            let allInvoices = [];
            let currentPage = 0;
            const pageSize = 100;
            const maxPages = 25;

            try {
                while (currentPage < maxPages) {
                    // Format dates according to BQE API format
                    const formattedFromDate = moment(fromDate).format('YYYY-MM-DD');
                    const formattedToDate = moment(toDate).format('YYYY-MM-DD');
                    
                    const url = new URL(`${baseUrl}/invoice`);
                    const params = new URLSearchParams({
                        'where': `date >= '${formattedFromDate}' AND date <= '${formattedToDate}'`,
                        '$orderby': 'date desc',
                        '$top': pageSize.toString(),
                        '$skip': (currentPage * pageSize).toString(),
                        '$count': 'true',
                        'expand': 'customFields,workflow,lineItems,accountSplits,extendedAccountSplit,invoiceDetails'
                    });
                    
                    url.search = params.toString();
                    console.log('Request URL:', url.toString());

                    const response = await fetch(url, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        }
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        console.error('API Error:', errorText);
                        throw new Error(`Failed to fetch invoices: ${response.status}`);
                    }

                    const data = await response.json();
                    console.log('Page response:', data);

                    // Check if data.value exists and is an array
                    const invoices = Array.isArray(data.value) ? data.value : 
                                   Array.isArray(data) ? data : [];
                    
                    if (!invoices.length) {
                        break;
                    }

                    allInvoices = allInvoices.concat(invoices);
                    this.updateTotalInvoicesFetched(allInvoices.length);

                    // Check if we have more records
                    const totalCount = data['@odata.count'] || data.count || 0;
                    if (!totalCount || allInvoices.length >= totalCount) {
                        break;
                    }

                    currentPage++;
                }

                console.log('Total invoices fetched:', allInvoices.length);

                // Map the invoices before returning
                if (allInvoices.length > 0) {
                    const mappedInvoices = await this.mapBQEInvoices(allInvoices);
                    console.log('Mapped invoices:', mappedInvoices);
                    return mappedInvoices;
                }

                return [];

            } catch (error) {
                console.error('Error fetching invoices:', error);
                this.hideLoading();
                throw error;
            } finally {
                this.hideLoading();
            }

        } catch (error) {
            console.error('Error in fetchInvoicesFromBQE:', error);
            this.hideLoading();
            await Swal.fire({
                icon: 'error',
                title: 'Error Fetching Invoices',
                text: error.message || 'Failed to fetch invoices. Please try again.'
            });
            return [];
        }
    }

    async fetchClientDetails(clientId) {
        if (!clientId) {
            console.log('No client ID provided for fetchClientDetails');
            return null;
        }
        
        try {
            const authToken = await this.authManager.getAccessToken();
            if (!authToken) {
                throw new Error('No valid BQE authentication found');
            }

            const response = await fetch(`/bqe/client/${clientId}`, {
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch client details');
            }
            
            const clientData = await response.json();
            console.log('Raw client data:', clientData);

            // Format address properly
            const formattedAddress = clientData.address ? {
                street1: clientData.address.street1 || '',
                street2: clientData.address.street2 || '',
                city: clientData.address.city?.trim() || '',
                state: clientData.address.state?.trim() || '',
                zip: clientData.address.zip?.trim() || '',
                country: clientData.address.country || 'MYS',
                // Create a clean formatted address string
                formattedAddress: [
                    clientData.address.street1,
                    clientData.address.street2,
                    clientData.address.city?.trim(),
                    clientData.address.state?.trim(),
                    clientData.address.zip?.trim(),
                    clientData.address.country || 'MYS'
                ].filter(part => part && part.trim() !== '').join(', ')
            } : {
                street1: 'NA',
                street2: '',
                city: 'NA',
                state: 'NA',
                zip: 'NA',
                country: 'MYS',
                formattedAddress: 'NA'
            };

            // Get communications
            const communications = [
                ...(clientData.communications || []),
                ...(clientData.address?.communications || [])
            ].filter(comm => comm.value && comm.typeName);

            // Map client data
            const mappedClient = {
                ...clientData,
                company: clientData.company || clientData.formattedName || clientData.name,
                taxId: clientData.taxId || clientData.customFields?.find(f => 
                    f.label === "Buyer's Tax ID" || 
                    f.label === "Tax ID"
                )?.value,
                registrationNumber: clientData.customFields?.find(f => 
                    f.label === "Buyer's Registration No" || 
                    f.label === "Registration Number"
                )?.value,
                address: formattedAddress,
                communications: communications,
                // Add additional fields that might be needed
                msicCode: clientData.customFields?.find(f => f.label === "Buyer's MSIC Code")?.value,
                businessActivity: clientData.customFields?.find(f => f.label === "Buyer's Business Activity")?.value,
                countryCode: clientData.customFields?.find(f => f.label === "BUYER'S COUNTRY CODE")?.value,
                stateCode: clientData.customFields?.find(f => f.label === "BUYER'S ADDRESS STATE CODE")?.value
            };

            console.log('Mapped client data:', mappedClient);
            return mappedClient;

        } catch (error) {
            console.error('Error fetching client details:', error);
            return null;
        }
    }

    // Update the second mapBQEInvoices method with improved error handling and logging
    async mapBQEInvoices(invoices) {
        console.log('Processing invoices:', invoices);
        
        if (!invoices || !Array.isArray(invoices)) {
            console.warn('Invalid invoices format:', invoices);
            return [];
        }

        // Get auth data first for client detail fetching
        const authResponse = await fetch('/bqe/check-auth');
        const authData = await authResponse.json();
        
        if (!authData.isAuthorized || !authData.authResponse) {
            throw new Error('No valid auth response available');
        }

        return await Promise.all(invoices.map(async (invoice, index) => {
            try {
                console.log(`Processing invoice ${index + 1}/${invoices.length}:`, invoice.invoiceNumber);
                
                if (!invoice) {
                    console.warn('Received null or undefined invoice');
                    return null;
                }

                // Map type from number to string
                let type = 'Invoice';
                if (invoice.type === 14) {
                    type = 'Credit Note';
                }

                // Get client details with proper fallback chain
                let clientInfo = '';
                let clientDetails = null;

                // First try invoice details
                if (invoice.invoiceDetails?.length > 0) {
                    console.log('Found invoice details:', invoice.invoiceDetails);
                    const clientId = invoice.invoiceDetails[0].clientId;
                    console.log('Found clientId from invoice details:', clientId);

                    if (clientId) {
                        clientDetails = await this.fetchClientDetails(clientId);
                        if (clientDetails) {
                            clientInfo = clientDetails.company || clientDetails.formattedName;
                            console.log('Found client details:', clientDetails);
                        }
                    }
                }
                // Fallback to invoice level clientId
                else if (invoice.clientId) {
                    console.log('Using invoice level clientId:', invoice.clientId);
                    clientDetails = await this.fetchClientDetails(invoice.clientId);
                    if (clientDetails) {
                        clientInfo = clientDetails.company || clientDetails.formattedName;
                    }
                }

                // Format amount with validation
                const amount = parseFloat(invoice.invoiceAmount || 0);
                const formattedAmount = `MYR ${(amount || 0).toFixed(2)}`;

                // Create the processed invoice object
                const processedInvoice = {
                    checkbox: '',
                    id: invoice.id || '',
                    invoice_number: invoice.invoiceNumber || '',
                    type: type,
                    customer_name: clientInfo || 'Unknown Client',
                    bqe_date: moment(invoice.date).format('YYYY-MM-DD'),
                    date_sync: new Date().toISOString(),
                    status: invoice.status === 1 ? 'Submitted' : 'Pending',
                    amount: formattedAmount,
                    date_submitted: null,
                    submission_timestamp: null,
                    _rawInvoice: invoice,
                    _clientDetails: clientDetails,
                    _invoiceDetails: invoice.invoiceDetails || [],
                    version: invoice.version || '1.0',
                    currency: invoice.currency || 'MYR',
                    due_date: invoice.dueDate ? moment(invoice.dueDate).format('YYYY-MM-DD') : null
                };

                console.log(`Successfully mapped invoice ${invoice.invoiceNumber}:`, {
                    id: processedInvoice.id,
                    number: processedInvoice.invoice_number,
                    client: processedInvoice.customer_name,
                    amount: processedInvoice.amount,
                    type: processedInvoice.type
                });

                return processedInvoice;

            } catch (error) {
                console.error(`Error mapping invoice ${invoice?.invoiceNumber || 'Unknown'}:`, error);
                console.debug('Problematic invoice data:', JSON.stringify(invoice, null, 2));
                return null;
            }
        })).then(results => {
            const validResults = results.filter(Boolean);
            console.log(`Successfully mapped ${validResults.length} out of ${invoices.length} invoices`);
            return validResults;
        });
    }

    
    isTableInitialized() {
        return this.dataTable && $.fn.DataTable.isDataTable('#reportsTable');
    }

    // Update the refreshInvoiceTable method
    async refreshInvoiceTable() {
        let mappedInvoices = [];
        try {
            // Show loading modal first
            this.showLoading();
            await this.delay(300); // Small delay for animation

            // Start with checking staging
            this.updateLoadingState('checking_staging');
            const { stagingData, stagingMap } = await this.checkStagingDatabase();
            await this.delay(500);

            // Move to retrieving
            this.updateLoadingState('retrieving');
            mappedInvoices = await this.fetchInvoicesFromBQE();
            if (!mappedInvoices?.length) {
                throw new Error('No invoices found for the selected date range');
            }
            await this.delay(500);

            // Move to processing
            this.updateLoadingState('processing');
            mappedInvoices = this.mapInvoicesWithStagingData(mappedInvoices, { stagingMap });
            await this.delay(500);

            // Move to saving
            this.updateLoadingState('saving');
            await this.saveAndUpdateUI(mappedInvoices);
            await this.delay(500);

            // Show completion
            this.updateLoadingState('completed');
            await this.delay(1000);

        } catch (error) {
            console.error('Error refreshing table:', error);
            this.updateLoadingState('error');
            await this.delay(1000);
            
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: error.message || 'Failed to refresh invoice data. Please try again.'
            });
        } finally {
            // Hide loading modal with delay
            setTimeout(() => {
                this.hideLoading();
            }, 1000);
        }
    }


    // Update the updateLoadingState method
    updateLoadingState(state) {
        const modal = document.getElementById('loadingModal');
        if (!modal) return;

        const steps = modal.querySelectorAll('.step');
        const loadingMessage = modal.querySelector('.loading-message');
        const progressBar = modal.querySelector('.progress-bar');

        // Update all steps
        steps.forEach(step => {
            const stepName = step.getAttribute('data-step');
            const statusSpan = step.querySelector('.step-status');
            if (!statusSpan) return;

            if (stepName === state) {
                // Current step
                statusSpan.textContent = 'In Progress...';
                statusSpan.className = 'step-status active';
                step.setAttribute('data-status', 'active');
            } else if (this.isStepComplete(stepName, state)) {
                // Completed step
                statusSpan.textContent = 'Done';
                statusSpan.className = 'step-status success';
                step.setAttribute('data-status', 'done');
            } else {
                // Waiting step
                statusSpan.textContent = 'Waiting...';
                statusSpan.className = 'step-status waiting';
                step.setAttribute('data-status', 'waiting');
            }
        });

        // Update progress bar
        const progress = this.calculateProgress(state);
        progressBar.style.width = `${progress}%`;

        // Update message
        const messages = {
            'checking_staging': 'Checking HSS eInvoice database...',
            'retrieving': 'Retrieving invoice data...',
            'processing': 'Processing information...',
            'saving': 'Saving data...',
            'completed': 'Completed!',
            'error': 'An error occurred'
        };
        loadingMessage.textContent = messages[state] || 'Processing...';
    }

    getStepIndex(state) {
        const states = ['authenticating', 'retrieving', 'fetching', 'processing', 'completed'];
        return states.indexOf(state);
    }

    updateStepStatus(stepName, status) {
        const modal = document.getElementById('loadingModal');
        if (!modal) return;

        const steps = modal.querySelectorAll('.step');
        const currentStep = modal.querySelector(`[data-step="${stepName}"]`);
        
        if (!currentStep) return;

        // Update all steps based on the current active step
        let foundActive = false;
        steps.forEach(step => {
            const statusSpan = step.querySelector('.step-status');
            if (!statusSpan) return;

            if (step === currentStep) {
                foundActive = true;
                if (status === 'done') {
                    statusSpan.textContent = 'Done';
                    statusSpan.className = 'step-status success';
                    step.setAttribute('data-status', 'done');
                } else {
                    statusSpan.textContent = 'In Progress...';
                    statusSpan.className = 'step-status active';
                    step.setAttribute('data-status', 'active');
                }
            } else if (!foundActive) {
                // Steps before current are done
                statusSpan.textContent = 'Done';
                statusSpan.className = 'step-status success';
                step.setAttribute('data-status', 'done');
            } else {
                // Steps after current are waiting
                statusSpan.textContent = 'Waiting...';
                statusSpan.className = 'step-status waiting';
                step.setAttribute('data-status', 'waiting');
            }
        });
    }

    // Add cleanup method
    cleanup() {
        try {
            // Safely dispose tooltips
            this.tooltips.forEach(tooltip => {
                try {
                    if (tooltip && typeof tooltip.dispose === 'function') {
                        tooltip.dispose();
                    }
                } catch (error) {
                    console.warn('Error disposing tooltip during cleanup:', error);
                }
            });
            this.tooltips.clear();

            // Destroy DataTable
            if (this.dataTable) {
                try {
                    this.dataTable.destroy();
                } catch (error) {
                    console.warn('Error destroying DataTable:', error);
                }
            }

            // Clean up BQE auth manager
            if (this.authManager) {
                try {
                    this.authManager.cleanup();
                } catch (error) {
                    console.warn('Error cleaning up BQE auth manager:', error);
                }
            }

            this.stopLoadingAnimation();

            // Remove event listeners
            try {
                $('#reportsTable').off('click', '.view-details-btn');
            } catch (error) {
                console.warn('Error removing event listeners:', error);
            }
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }

    // Add new method to update card counts
    updateCardCounts() {
        if (!this.dataTable) return;

        // Reset counts
        this.cardCounts = {
            total: 0,
            submitted: 0,
            pending: 0,
            cancelled: 0
        };

        // Get all data from table
        const data = this.dataTable.rows().data();
        
        // Count totals
        data.each(row => {
            // Increment total count
            this.cardCounts.total++;
            
            // Check status and increment appropriate counter
            const status = (row.status || '').toLowerCase();
            switch(status) {
                case 'submitted':
                    this.cardCounts.submitted++;
                    break;
                case 'pending':
                    this.cardCounts.pending++;
                    break;
                case 'cancelled':
                    this.cardCounts.cancelled++;
                    break;
            }
        });

        // Update UI immediately after counting
        this.updateCardUI();
    }

    // Add method to update card UI
    updateCardUI() {
        // Update total invoices card
        const totalCard = document.querySelector('.invoices-card .count-info h6');
        if (totalCard) {
            totalCard.textContent = this.cardCounts.total;
        }

        // Update submitted card
        const submittedCard = document.querySelector('.submitted-card .count-info h6');
        if (submittedCard) {
            submittedCard.textContent = this.cardCounts.submitted;
        }

        // Update pending card
        const pendingCard = document.querySelector('.pending-card .count-info h6');
        if (pendingCard) {
            pendingCard.textContent = this.cardCounts.pending;
        }

        // Update cancelled card
        const cancelledCard = document.querySelector('.cancelled-card .count-info h6');
        if (cancelledCard) {
            cancelledCard.textContent = this.cardCounts.cancelled;
        }
    }

    // Add method to get current counts
    getCardCounts() {
        return { ...this.cardCounts };
    }

    async viewInvoiceDetails(invoiceId) {
        try {
            console.log('=== VIEW DETAILS START ===');
            console.log('Invoice ID:', invoiceId);

            if (!invoiceId) {
                throw new Error('Invalid invoice ID');
            }

            // Show modal first
            const modalElement = document.getElementById('viewDetailsModal');
            if (!modalElement) {
                throw new Error('Modal element not found');
            }

            // Initialize and show modal
            const modal = new bootstrap.Modal(modalElement, {
                keyboard: true,
                focus: true,
                backdrop: 'static'
            });
            modal.show();

            // Show loading overlay
            const loadingOverlay = document.getElementById('modalLoadingOverlay');
            if (loadingOverlay) {
                loadingOverlay.classList.remove('d-none');
            }

            // Get the invoice data from the DataTable
            const invoice = this.dataTable.rows()
                .data()
                .filter(row => row.id === invoiceId)[0];

            console.log('Invoice Data:', invoice);

            if (!invoice) {
                throw new Error('Invoice not found in table data');
            }

            // Fetch detailed invoice data
            const invoiceResponse = await fetch(`/bqe/invoice/${invoiceId}`);
            if (!invoiceResponse.ok) {
                throw new Error('Failed to fetch invoice details');
            }
            const invoiceDetails = await invoiceResponse.json();
           

            // Add line items to invoice object
            invoice._rawInvoice = invoiceDetails;

            // Fetch company (supplier) details
            try {
                const companyResponse = await fetch('/bqe/company', {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                if (!companyResponse.ok) {
                    throw new Error('Failed to fetch company details');
                }

                const companyData = await companyResponse.json();
                console.log('Company Data:', companyData);
                
                // Add company data to invoice
                invoice.company = companyData;
                
                // Process company custom fields for supplier information
                const supplierFields = {
                    tin: this.getCustomFieldValue(companyData.customFields, "Supplier's TIN"),
                    registrationNumber: this.getCustomFieldValue(companyData.customFields, "Supplier's Registration No"),
                    sstId: this.getCustomFieldValue(companyData.customFields, "Supplier's SST No"),
                    msicCode: this.getCustomFieldValue(companyData.customFields, "Supplier's MSIC Code"),
                    businessActivity: this.getCustomFieldValue(companyData.customFields, "Supplier's Business Activity")
                };
                invoice.supplier = supplierFields;

            } catch (error) {
                console.error('Error fetching company details:', error);
                console.warn('Continuing without company data');
            }

            // Update modal content (which now includes line items)
            await this.updateModalContent(invoice);

            // Hide loading overlay
            if (loadingOverlay) {
                loadingOverlay.classList.add('d-none');
            }

            console.log('=== VIEW DETAILS END ===');

            // Add this after updating modal content
            const submitButton = modalElement.querySelector('.btn-lhdn');
            if (submitButton) {
                submitButton.dataset.invoiceId = invoiceId;
            }

        } catch (error) {
            console.error('Error viewing invoice details:', error);
           
        }
    }

    // Add this method to show loading state
    showLoadingIndicator() {
        const modalBody = document.querySelector('.modal-body');
        if (modalBody) {
            modalBody.innerHTML = `
                <div class="text-center p-4">
                    <div class="spinner-border text-primary mb-3" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <p class="mb-0 text-muted">Loading invoice details...</p>
                </div>
            `;
        }
    }

    // Add this method to fetch invoice details
    async fetchInvoiceDetails(invoiceId) {
        try {
            const response = await fetch(`/bqe/invoice/${invoiceId}`);
            if (!response.ok) {
                throw new Error('Failed to fetch invoice details');
            }
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Error fetching invoice details:', error);
            throw error;
        }
    }

    async updateModalContent(invoice) {
        const modalElement = document.getElementById('viewDetailsModal');
        if (modalElement) {
            modalElement.dataset.invoiceId = invoice.id;
            modalElement.dataset.invoiceNumber = invoice.invoice_number;
            
            // Show/hide cancel button based on status
            const cancelButton = modalElement.querySelector('.btn-cancel-invoice');
            if (cancelButton) {
                if (invoice.status === 'Submitted') {
                    cancelButton.classList.remove('d-none');
                    // Remove the event listener code - we'll use onclick in HTML
                } else {
                    cancelButton.classList.add('d-none');
                }
            }

            console.log('Setting modal dataset:', {
                id: invoice.id,
                invoice_number: invoice.invoice_number,
                fullInvoice: invoice
            });
        }

        // Update invoice number and status in header
        document.querySelector('#invoice-number').textContent = `#${invoice.invoice_number}`;
        const statusBadge = document.querySelector('#invoice-status');
        if (statusBadge) {
            // Match the status badge style with the table
            const statusClass = invoice.status?.toLowerCase() || 'pending';
            statusBadge.className = `status-badge ${statusClass}`;
            statusBadge.textContent = invoice.status || 'Pending';
        }

        // Left sidebar content with tooltips
        const leftSidebarContent = `
            <div class="info-group">
                <div class="info-label">
                    INVOICE NUMBER
                    <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Invoice number"></i>
                </div>
                <div class="info-value">${invoice.invoice_number || 'NA'}</div>
            </div>
            <div class="info-group">
                <div class="info-label">
                    INVOICE STATUS
                    <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Current status of the invoice"></i>
                </div>
                <div class="info-value">
                    <span class="status-badge ${invoice.status?.toLowerCase() || 'pending'}">
                        ${invoice.status || 'Pending'}
                    </span>
                </div>
            </div>
            <div class="info-group">
                <div class="info-label">
                    INVOICE DATE
                    <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Date when the invoice was created"></i>
                </div>
                <div class="info-value">${invoice.bqe_date ? moment(invoice.bqe_date).format('MM-DD-YYYY') : '-'}</div>
            </div>
            <div class="info-group">
                <div class="info-label">
                    INVOICE VERSION
                    <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Version number of the invoice"></i>
                </div>
                <div class="info-value">${invoice.customFields?.find(f => f.label === 'Invoice Version')?.value || '1.0'}</div>
            </div>
            <div class="info-group">
                <div class="info-label">
                    INVOICE TYPE
                    <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Type of invoice document"></i>
                </div>
                <div class="info-value">${invoice.type || 'Invoice'}</div>
            </div>
            <div class="info-group">
                <div class="info-label">
                    UNIQUE IDENTIFIER
                    <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Unique identification number for this invoice"></i>
                </div>
                <div class="info-value">${invoice.unique_identifier || 'NA'}</div>
            </div>
            <div class="info-group">
                <div class="info-label">
                    ORIGINAL INVOICE REF. NO.
                    <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Reference number of the original invoice if this is a revision"></i>
                </div>
                <div class="info-value">${invoice.original_invoice_ref || 'Not Applicable'}</div>
            </div>
        `;

        // Supplier information with tooltips
        const supplierContent = `
            <div class="section-subtitle">Details of the supplier issuing the invoice</div>
            <div class="info-grid">
                <div class="info-row">
                    <div class="info-label">
                        NAME
                        <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Legal name of the supplier company"></i>
                    </div>
                    <div class="info-value">${invoice.company?.name || 'NA'}</div>
                </div>
                <div class="info-row">
                    <div class="info-label">
                        TIN
                        <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Tax Identification Number of the supplier"></i>
                    </div>
                    <div class="info-value">${invoice.supplier?.tin || 'NA'}</div>
                </div>
                <div class="info-row">
                    <div class="info-label">
                        REGISTRATION NUMBER
                        <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Company registration number of the supplier"></i>
                    </div>
                    <div class="info-value">${invoice.supplier?.registrationNumber || 'NA'}</div>
                </div>
                <div class="info-row">
                    <div class="info-label">
                        SST ID
                        <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Sales and Service Tax ID of the supplier"></i>
                    </div>
                    <div class="info-value">${invoice.supplier?.sstId || 'NA'}</div>
                </div>
                <div class="info-row">
                    <div class="info-label">
                        MSIC CODE
                        <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Malaysia Standard Industrial Classification code"></i>
                    </div>
                    <div class="info-value">${invoice.supplier?.msicCode || 'NA'}</div>
                </div>
                <div class="info-row">
                    <div class="info-label">
                        BUSINESS ACTIVITY
                        <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Primary business activity of the supplier"></i>
                    </div>
                    <div class="info-value">${invoice.supplier?.businessActivity || 'NA'}</div>
                </div>
            </div>
        `;

        // Buyer information with tooltips
        const buyerContent = `
            <div class="section-subtitle">Details of the invoice recipient</div>
            <div class="info-grid">
                <div class="info-row">
                    <div class="info-label">
                        NAME
                        <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Legal name of the buyer company"></i>
                    </div>
                    <div class="info-value">${invoice._clientDetails?.company || invoice._clientDetails?.formattedName || 'NA'}</div>
                </div>
                <div class="info-row">
                    <div class="info-label">
                        TIN
                        <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Tax Identification Number of the buyer"></i>
                    </div>
                    <div class="info-value">${invoice._clientDetails?.taxId || 'NA'}</div>
                </div>
                <div class="info-row">
                    <div class="info-label">
                        REGISTRATION NUMBER
                        <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Company registration number of the buyer"></i>
                    </div>
                    <div class="info-value">${invoice._clientDetails?.customFields?.find(f => f.label === "Buyer's Registration No")?.value || 'NA'}</div>
                </div>
                <div class="info-row">
                    <div class="info-label">
                        SST ID
                        <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Sales and Service Tax ID of the buyer"></i>
                    </div>
                    <div class="info-value">${invoice._clientDetails?.sstId || 'NA'}</div>
                </div>
                <div class="info-row">
                    <div class="info-label">
                        MSIC CODE
                        <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Malaysia Standard Industrial Classification code of the buyer"></i>
                    </div>
                    <div class="info-value">${invoice._clientDetails?.msicCode || 'NA'}</div>
                </div>
                <div class="info-row">
                    <div class="info-label">
                        BUSINESS ACTIVITY
                        <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Primary business activity of the buyer"></i>
                    </div>
                    <div class="info-value">${invoice._clientDetails?.businessActivity || 'NA'}</div>
                </div>
                <div class="info-row">
                    <div class="info-label">
                        ADDRESS
                        <i class="bi bi-info-circle info-tooltip" data-bs-toggle="tooltip" title="Complete business address of the buyer"></i>
                    </div>
                    <div class="info-value address-container">
                        <div class="address-content">
                            ${formatAddress(invoice._clientDetails?.address) || 'NA'}
                        </div>
                        ${formatAddress(invoice._clientDetails?.address) ? 
                            '<button class="view-more" onclick="toggleAddress(this)">View more</button>' : 
                            ''}
                    </div>
                </div>
            </div>
        `;

        // Update the content sections
        document.querySelector('.invoice-info').innerHTML = leftSidebarContent;
        document.querySelector('.supplier-info .detail-content').innerHTML = supplierContent;
        document.querySelector('.buyer-info .detail-content').innerHTML = buyerContent;

        // Find the Invoice Items section and update it
        const invoiceItemsSection = document.querySelector('[data-section="invoice-items"]') || 
                                   document.querySelector('.invoice-items');
        
        if (invoiceItemsSection) {
            // Get invoice details and calculate amounts
            const invoiceDetails = invoice._rawInvoice?.invoiceDetails?.[0];
            const amount = parseFloat(invoiceDetails?.amount) || 0;
            const taxRate = parseFloat(invoice._rawInvoice?.customFields?.find(f => f.label === 'Tax Rate')?.value) || 0;
            const taxAmount = (amount * taxRate) / 100;
            const total = amount + taxAmount;
            
            // Create line items with validated amounts
            const lineItems = [{
                description: invoiceDetails?.memo1 || invoiceDetails?.memo2 || 'NA',
                amount: amount,
                project: invoice._rawInvoice?.project,
                taxRate: taxRate
            }];
            
            const lineItemsContent = `
                <div class="section-title">
                    <i class="bi bi-receipt"></i>
                    Invoice Items
                </div>
                <div class="detail-content">
                    <div class="table-responsive">
                        <table class="table line-items-table">
                            <thead>
                                <tr>
                                    <th>Classification</th>
                                    <th>Description</th>
                                    <th>Quantity</th>
                                    <th>Unit Price (MYR)</th>
                                    <th>Amount (MYR)</th>
                                    <th>Disc..</th>
                                    <th>Tax Rate</th>
                                    <th>Tax Amount (MYR)</th>
                                    <th>Total (MYR)</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${this.renderLineItems(lineItems)}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td colspan="4" class="text-end"><strong>Subtotal:</strong></td>
                                    <td class="text-end amount-column">${this.formatCurrency(amount)}</td>
                                    <td></td>
                                    <td></td>
                                    <td class="text-end amount-column">${this.formatCurrency(taxAmount)}</td>
                                    <td class="text-end amount-column">${this.formatCurrency(total)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    <div class="summary-section">
                        <table class="table summary-table">
                            <tbody>
                                <tr>
                                    <td>Subtotal:</td>
                                    <td class="text-end">${this.formatCurrency(amount)}</td>
                                </tr>
                                <tr>
                                    <td>Total excluding tax:</td>
                                    <td class="text-end">${this.formatCurrency(amount)}</td>
                                </tr>
                                <tr>
                                    <td>Tax amount:</td>
                                    <td class="text-end">${this.formatCurrency(taxAmount)}</td>
                                </tr>
                                <tr>
                                    <td>Total including tax:</td>
                                    <td class="text-end">${this.formatCurrency(total)}</td>
                                </tr>
                                <tr class="total-row">
                                    <td>Total payable amount:</td>
                                    <td class="text-end">${this.formatCurrency(total)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            invoiceItemsSection.innerHTML = lineItemsContent;
        }

        // Initialize tooltips
        setTimeout(() => {
            const tooltips = document.querySelectorAll('[data-bs-toggle="tooltip"]');
            tooltips.forEach(tooltip => {
                new bootstrap.Tooltip(tooltip, {
                    placement: 'top',
                    trigger: 'hover',
                    container: 'body',
                    html: true,
                    template: `
                        <div class="tooltip" role="tooltip">
                            <div class="tooltip-arrow"></div>
                            <div class="tooltip-inner"></div>
                        </div>
                    `
                });
            });
        }, 100);

        // Update buttons visibility based on status
        const submitButton = document.querySelector('.btn-lhdn:not(.btn-cancel)');
        const cancelButton = document.querySelector('.btn-cancel-invoice');

        if (submitButton && cancelButton) {
            if (invoice.status === 'Cancelled') {
                // Hide both buttons if status is cancelled
                submitButton.classList.add('d-none');
                cancelButton.classList.add('d-none');
            } else if (invoice.status === 'Submitted') {
                // Hide submit button, show cancel button if within cancellation period
                submitButton.classList.add('d-none');
                
                // Pass status to calculateCancellationTime
                const timeInfo = this.calculateCancellationTime(invoice.date_submitted, invoice.status);
                if (!timeInfo?.expired && invoice.status !== 'Cancelled') {
                    cancelButton.classList.remove('d-none');
                    cancelButton.setAttribute('data-bs-toggle', 'tooltip');
                    cancelButton.setAttribute('data-bs-html', 'true');
                    
                    // Create styled tooltip content with time remaining
                    const tooltipContent = `
                        <div class='tooltip-content'>
                            <div class='tooltip-row'>
                                ${timeInfo.isNA ? `
                                    <i class='bi bi-dash-circle text-muted'></i>
                                    Not Available for Cancellation
                                ` : `
                                    <i class='bi bi-clock${timeInfo.urgency === 'urgent' ? '-fill text-warning' : ''}'></i>
                                    ${timeInfo.hours}h ${timeInfo.minutes}m remaining
                                `}
                            </div>
                        </div>
                    `;
                    
                    cancelButton.setAttribute('data-bs-title', tooltipContent);
                } else {
                    cancelButton.classList.add('d-none');
                }
            } else {
                // For Pending status: show submit button, hide cancel button
                submitButton.classList.remove('d-none');
                cancelButton.classList.add('d-none');
            }
        }
    }

    renderLineItems(items) {
        if (!items?.length) {
            return `<tr><td colspan="9" class="text-center">No items found</td></tr>`;
        }

        return items.map(detail => {
            // Parse numbers with validation
            const lineItemAmount = parseFloat(detail.amount) || 0;
            const lineItemTaxRate = parseFloat(detail.taxRate) || 0;
            const lineItemTaxAmount = (lineItemAmount * lineItemTaxRate) / 100;
            const totalWithTax = lineItemAmount + lineItemTaxAmount;
            
            const classification = detail.project?.customFields?.find(f => 
                f.label === 'Invoice Classification'
            )?.description || 'NA';
            
            return `
                <tr>
                    <td>${classification}</td>
                    <td class="description-cell">${detail.description || 'NA'}</td>
                    <td>${1}</td>
                    <td class="amount-column">${this.formatCurrency(lineItemAmount)}</td>
                    <td class="amount-column">${this.formatCurrency(lineItemAmount)}</td>
                    <td>-</td>
                    <td class="amount-column">${lineItemTaxRate.toFixed(2)}%</td>
                    <td class="amount-column">${this.formatCurrency(lineItemTaxAmount)}</td>
                    <td class="amount-column">${this.formatCurrency(totalWithTax)}</td>
                </tr>
            `;
        }).join('');
    }

    // Add helper method for status badge class
    getStatusBadgeClass(status) {
        const statusMap = {
            'Submitted': 'bg-success',
            'Pending': 'bg-warning',
            'Cancelled': 'bg-danger'
        };
        return statusMap[status] || 'bg-secondary';
    }

    // Add helper method to initialize tooltips
    initializeTooltips() {
        document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(element => {
            new bootstrap.Tooltip(element);
        });
    }

    // Update the submitToLHDN method
    async submitToLHDN(invoiceId) {
        try {
            // First validate the invoice data
            const invoice = this.dataTable.rows()
                .data()
                .filter(row => row.id === invoiceId)[0];

            if (!invoice) {
                throw new Error('Invoice not found');
            }

            // Validate mandatory fields
            const validation = this.validateMandatoryFields(invoice);
            if (!validation.isValid) {
                await Swal.fire({
                    icon: 'warning',
                    title: 'Missing Required Fields',
                    html: `
                        <div class="alert alert-warning">
                            <i class="bi bi-exclamation-triangle me-2"></i>
                            The following fields are required:
                            <ul class="mt-2 mb-0">
                                ${validation.missingFields.map(field => `<li>${field}</li>`).join('')}
                            </ul>
                        </div>
                    `,
                    confirmButtonText: 'OK'
                });
                return;
            }

            // Show version selection dialog first
            const versionResult = await this.showVersionSelectionDialog();
            if (!versionResult.isConfirmed) {
                return;
            }

            const version = versionResult.value || '1.0';

            // Show loading state
            Swal.fire({
                title: 'Submitting Invoice',
                html: 'Please wait while we process your submission...',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            // Prepare invoice data
            const invoiceData = this.prepareInvoiceData(invoiceId);

            // Make the submission request
            const response = await fetch('/bqe/submit-to-lhdn', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    invoiceId,
                    invoiceData,
                    version
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw {
                    message: result.message || 'Submission failed',
                    details: result.details || []
                };
            }

            // Close the modal first
            const modal = bootstrap.Modal.getInstance(document.getElementById('viewDetailsModal'));
            if (modal) {
                modal.hide();
            }

            // Then show success message
            await Swal.fire({
                icon: 'success',
                title: 'Success!',
                html: `
                    <div class="alert alert-success mb-3">
                        <i class="bi bi-check-circle-fill me-2"></i>
                        Invoice successfully submitted to LHDN
                    </div>
                    <div class="text-start">
                        <strong>Details:</strong>
                        <ul class="list-unstyled mt-2 mb-0">
                            <li><i class="bi bi-receipt me-2"></i>Invoice: ${invoiceData._rawInvoice.invoiceNumber}</li>
                            <li><i class="bi bi-calendar me-2"></i>Date: ${moment().format('DD MMM YYYY, HH:mm:ss')}</li>
                            <li><i class="bi bi-info-circle me-2"></i>Status: Submitted</li>
                        </ul>
                    </div>
                `,
                confirmButtonText: 'OK'
            });

            // Update the table data without refreshing
            const table = this.dataTable;
            if (table) {
                const rowData = table.rows().data().toArray();
                const updatedData = rowData.map(row => {
                    if (row.id === invoiceId) {
                        return {
                            ...row,
                            status: 'Submitted',
                            date_submitted: moment().format('YYYY-MM-DD HH:mm:ss'),
                            date_sync: moment().format('YYYY-MM-DD HH:mm:ss'),
                            submission_timestamp: moment().format('YYYY-MM-DD HH:mm:ss'),
                            cancellation_period: this.calculateCancellationTime(moment().format('YYYY-MM-DD HH:mm:ss'), 'Submitted')
                        };
                    }
                    return row;
                });

                // Update table without full refresh
                table.clear();
                table.rows.add(updatedData);
                table.draw();

                // Update card counts
                this.updateCardCounts();
            }

        } catch (error) {
            console.error('Error in submitToLHDN:', error);
            
            await Swal.fire({
                icon: 'error',
                title: 'Submission Failed',
                html: `
                    <div class="text-start">
                        <p class="mb-2">${error.message}</p>
                        ${error.details ? `
                            <div class="mt-3 p-2 bg-light rounded">
                                <small class="text-muted">
                                    ${error.details.map(d => `
                                        <div class="mb-1">
                                            <strong>${d.code}:</strong> ${d.message}
                                        </div>
                                    `).join('')}
                                </small>
                            </div>
                        ` : ''}
                    </div>
                `
            });
        }
    }

    // Add these helper methods
    async fetchCompanyDetails() {
        const response = await fetch('/bqe/company');
            if (!response.ok) {
            throw new Error('Failed to fetch company details');
        }
        return await response.json();
    }

    async fetchSupplierDetails() {
        const companyData = await this.fetchCompanyDetails();
            return {
            tin: companyData.customFields?.find(f => f.label === "Supplier's TIN")?.value,
            registrationNumber: companyData.customFields?.find(f => f.label === "Supplier's Registration No")?.value,
            sstId: companyData.customFields?.find(f => f.label === "Supplier's SST No")?.value,
            msicCode: companyData.customFields?.find(f => f.label === "Supplier's MSIC Code")?.value,
            businessActivity: companyData.customFields?.find(f => f.label === "Supplier's Business Activity")?.value
        };
    }

    // Add this method to InvoiceTableManager class
    async showVersionSelectionDialog() {
        return Swal.fire({
            title: 'Select Document Version',
            html: `
                <div class="notice-container mb-4 text-center" style="background-color: #f0f9ff; border-radius: 8px; padding: 16px 20px;">
                    <div class="d-flex align-items-center justify-content-center mb-1">
                        <i class="bi bi-info-circle" style="color: #3b82f6; font-size: 0.9rem;"></i>
                        <div style="color: #64748b; font-weight: 500; font-size: 0.9rem; margin-left: 6px;">Important Notice</div>
                </div>
                    <p class="mb-0" style="color: #475569; line-height: 1.5; font-size: 0.85rem;">
                        Please select the appropriate document version based on your signing requirements. Your 
                        selection will determine the final document format and processing workflow.
                    </p>
            </div>
                
                <div class="version-options">
                    <div class="version-option mb-3">
                        <label class="w-100 p-0 rounded cursor-pointer position-relative" style="border: 1px solid #e2e8f0;">
                            <div class="d-flex align-items-start p-3">
                                <input type="radio" name="version" value="1.0" checked
                                       class="form-check-input mt-1" style="width: 16px; height: 16px;">
                                <div class="ms-3 text-center w-100">
                                    <div class="mb-1 d-flex align-items-center justify-content-center">
                                        <i class="bi bi-file-text me-2" style="color: #3b82f6;"></i>
                                        <span style="color: #334155; font-weight: 500;">Version 1.0 (Standard Format)</span>
            </div>
                                    <div style="color: #64748b; font-size: 0.85rem;">
                                        Basic document format without digital signature capabilities
                                    </div>
                                </div>
                            </div>
                        </label>
                    </div>

                    <div class="version-option mb-3">
                        <label class="w-100 p-0 rounded cursor-pointer position-relative" style="border: 1px solid #e2e8f0; background-color: #f8fafc;">
                            <div class="d-flex align-items-start p-3">
                                <input type="radio" name="version" value="1.1" disabled
                                       class="form-check-input mt-1" style="width: 16px; height: 16px;">
                                <div class="ms-3 text-center w-100">
                                    <div class="mb-1 d-flex align-items-center justify-content-center">
                                        <i class="bi bi-file-earmark-lock me-2" style="color: #94a3b8;"></i>
                                        <span style="color: #94a3b8; font-weight: 500;">Version 1.1 (Enhanced Security)</span>
            </div>
                                    <div style="color: #94a3b8; font-size: 0.85rem;">
                                        Advanced format with digital signature support
                                    </div>
                                </div>
                                <div class="tooltip-wrapper" style="margin-left: 8px;">
                                    <i class="bi bi-info-circle" 
                                       style="cursor: help; font-size: 1rem; color: #3b82f6;"
                                       data-bs-toggle="tooltip" 
                                       data-bs-html="true"
                                       data-bs-placement="right"
                                       title="<div style='min-width: 240px; text-align: left;'>
                                         <div style='margin-bottom: 8px; color: #000;'>
                                           Digital Certificate Required <span style='color: #dc2626;'>*</span>
                                         </div>
                                         <div style='color: #64748b; margin-bottom: 12px;'>
                                           To enable this version, please complete:
                                         </div>
                                         <div style='margin-left: 0;'>
                                           <div style='margin-bottom: 8px;'>
                                             <i class='bi bi-shield' style='color: #64748b; margin-right: 8px;'></i>
                                             <span style='color: #000;'>Must have digital certificate</span>
                                             <span style='color: #dc2626;'>*</span>
                                           </div>
                                           <div style='margin-bottom: 8px;'>
                                             <i class='bi bi-person-badge' style='color: #64748b; margin-right: 8px;'></i>
                                             <span style='color: #000;'>Set up signing credentials</span>
                                             <span style='color: #dc2626;'>*</span>
                                           </div>
                                           <div style='margin-bottom: 12px;'>
                                             <i class='bi bi-gear' style='color: #64748b; margin-right: 8px;'></i>
                                             <span style='color: #000;'>Configure signature parameters</span>
                                             <span style='color: #dc2626;'>*</span>
                                           </div>
                                         </div>
                                         <div style='color: #64748b; padding-top: 12px; border-top: 1px solid #e2e8f0;'>
                                           <i class='bi bi-headset'></i>
                                           <span style='margin-left: 8px;'>Contact administrator for assistance</span>
                                         </div>
                                       </div>"></i>
                                </div>
                            </div>
                        </label>
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '<i class="bi bi-arrow-right-circle me-2"></i>Continue',
            cancelButtonText: '<i class="bi bi-x me-2"></i>Cancel',
            customClass: {
                container: 'version-selection-dialog',
                popup: 'shadow-sm rounded-3',
                confirmButton: 'btn btn-primary px-4',
                cancelButton: 'btn btn-secondary px-4',
                actions: 'gap-2'
            },
            buttonsStyling: false,
            preConfirm: () => {
                return document.querySelector('input[name="version"]:checked')?.value;
            }
        });
    }

    // Add these helper methods to your InvoiceTableManager class

    getCustomFieldValue(fields, label) {
        if (!fields || !Array.isArray(fields)) {
            return 'NA';
        }
        
        const field = fields.find(f => f.label === label);
        
        if (!field) {
            return 'NA';
        }

        if (field.value !== undefined && field.value !== null) {
            return field.value;
        }
        
        if (field.description !== undefined && field.description !== null) {
            if (label.includes('MSIC') || label.includes('TAX TYPE')) {
                return field.description.split('|')[0]?.trim() || field.description;
            }
            return field.description;
        }

        return 'NA';
    }

    formatCurrency(amount) {
        // Return dash if amount is null, undefined, or NaN
        if (amount == null || isNaN(amount)) {
            return '-';
        }
        
        try {
            // Convert to number and format
            const numAmount = Number(amount);
            // Format with space after MYR
            return `MYR ${numAmount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
        } catch (error) {
            console.warn('Error formatting currency:', error);
            return '-';
        }
    }

    renderLineItems(items) {
        if (!items?.length) {
            return `<tr><td colspan="9" class="text-center">No items found</td></tr>`;
        }

        return items.map(detail => {
            // Parse numbers with validation
            const lineItemAmount = parseFloat(detail.amount) || 0;
            const lineItemTaxRate = parseFloat(detail.taxRate) || 0;
            const lineItemTaxAmount = (lineItemAmount * lineItemTaxRate) / 100;
            const totalWithTax = lineItemAmount + lineItemTaxAmount;
            
            const classification = detail.project?.customFields?.find(f => 
                f.label === 'Invoice Classification'
            )?.description || '022';
            
            return `
                <tr>
                    <td>${classification}</td>
                    <td class="description-cell">${detail.description || 'NA'}</td>
                    <td>${1}</td>
                    <td class="amount-column">${this.formatCurrency(lineItemAmount)}</td>
                    <td class="amount-column">${this.formatCurrency(lineItemAmount)}</td>
                    <td>-</td>
                    <td class="amount-column">${lineItemTaxRate.toFixed(2)}%</td>
                    <td class="amount-column">${this.formatCurrency(lineItemTaxAmount)}</td>
                    <td class="amount-column">${this.formatCurrency(totalWithTax)}</td>
                </tr>
            `;
        }).join('');
    }

    formatAddress(address) {
        if (!address) return null;
        
        const parts = [
            address.street1,
            address.street2,
            address.city,
            address.state,
            address.zip,
            address.country
        ].filter(part => part && part.trim());
        
        return parts.length > 0 ? parts.join(', ') : null;
    }

    // Add this method to InvoiceTableManager class
    validateMandatoryFields(invoice) {
        const requiredFields = {
            'Invoice Number': invoice._rawInvoice?.invoiceNumber,
            'Invoice Date': invoice._rawInvoice?.date,
            'Invoice Amount': invoice._rawInvoice?.invoiceAmount,
            'Supplier Name': invoice.company?.name,
            'Supplier TIN': invoice.supplier?.tin,
            'Supplier Registration': invoice.supplier?.registrationNumber,
            'Customer Name': invoice._clientDetails?.company,
            'Customer TIN': invoice._clientDetails?.taxId,
            'Customer Registration': invoice._clientDetails?.registrationNumber
        };

        const missingFields = [];
        for (const [field, value] of Object.entries(requiredFields)) {
            if (!value || value === 'NA') {
                missingFields.push(field);
            }
        }

        return {
            isValid: missingFields.length === 0,
            missingFields
        };
    }

    // Add this method to the InvoiceTableManager class
    updateTotalInvoicesFetched(count = 0) {
        try {
            // Update the records count display
            const recordsCount = document.querySelector('.records-count');
            if (recordsCount) {
                recordsCount.innerHTML = `
                    <div class="d-flex align-items-center">
                        <span>Total Invoices Fetched: ${count}</span>
                        <i class="bi bi-question-circle ms-2" 
                           data-bs-toggle="tooltip" 
                           title="Total number of invoices found for selected date range"></i>
                    </div>`;
                
                // Initialize tooltip on the newly added icon
                const tooltipIcon = recordsCount.querySelector('[data-bs-toggle="tooltip"]');
                if (tooltipIcon) {
                    new bootstrap.Tooltip(tooltipIcon, {
                        placement: 'top',
                        trigger: 'hover'
                    });
                }
            }

            // Update table info if available
            const tableInfo = document.querySelector('.dataTables_info');
            if (tableInfo && this.dataTable) {
                const pageInfo = this.dataTable.page.info();
                if (pageInfo) {
                    const currentPage = pageInfo.page + 1;
                    const totalPages = pageInfo.pages;
                    tableInfo.textContent = `Showing ${count} entries (Page ${currentPage} of ${totalPages})`;
                }
            }

            // Update card counts
            this.updateCardCounts();

        } catch (error) {
            console.error('Error updating total invoices count:', error);
        }
    }

    // Add this method to handle saving invoices in batches
    async saveInvoicesInBatches(invoices, batchSize = 5) {
        try {
            const batches = [];
            for (let i = 0; i < invoices.length; i += batchSize) {
                batches.push(invoices.slice(i, i + batchSize));
            }

            console.log(`Saving ${invoices.length} invoices in ${batches.length} batches`);
            
            let savedCount = 0;
            const results = [];

            for (let i = 0; i < batches.length; i++) {
                try {
                    const batch = batches[i];
                    const saveResponse = await fetch('/bqe/save-invoices', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ invoices: batch })
                    });

                    if (!saveResponse.ok) {
                        throw new Error(`Failed to save batch ${i + 1}`);
                    }

                    const saveResult = await saveResponse.json();
                    results.push(saveResult);
                    savedCount += batch.length;

                    // Update loading message
                    this.updateLoadingState('saving', `Saving invoices (${savedCount}/${invoices.length})`);

                } catch (error) {
                    console.error(`Error saving batch ${i + 1}:`, error);
                    // Continue with next batch even if one fails
                }
            }

            return {
                success: true,
                totalSaved: savedCount,
                results: results
            };

        } catch (error) {
            console.error('Error in saveInvoicesInBatches:', error);
            throw new Error(`Failed to save invoices: ${error.message}`);
        }
    }

    // Add this method to format relative time
    formatRelativeTime(date) {
        if (!date) return '-';
        
        try {
            const now = moment();
            const syncDate = moment(date);
            const diffMinutes = now.diff(syncDate, 'minutes');
            
            if (diffMinutes < 1) return 'just now';
            if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
            
            const diffHours = now.diff(syncDate, 'hours');
            if (diffHours < 24) return `${diffHours} hours ago`;
            
            const diffDays = now.diff(syncDate, 'days');
            if (diffDays < 30) return `${diffDays} days ago`;
            
            return syncDate.format('YYYY-MM-DD');
        } catch (error) {
            console.error('Error formatting relative time:', error);
            return '-';
        }
    }

    prepareInvoiceData(invoiceId) {
        try {
            // Get the invoice data from the DataTable
            const invoice = this.dataTable.rows().data().toArray()
                .find(row => row.id === invoiceId);

            if (!invoice) {
                throw new Error('Invoice not found');
            }

            // Ensure _rawInvoice has the correct structure
            const rawInvoice = {
                invoiceNumber: invoice._rawInvoice.invoiceNumber || invoice.invoice_number,
                date: invoice._rawInvoice.date,
                invoiceAmount: invoice._rawInvoice.invoiceAmount || parseFloat(invoice.amount.replace('MYR ', '')),
                serviceTaxAmount: invoice._rawInvoice.serviceTaxAmount || 0,
                currency: invoice._rawInvoice.currency || 'MYR',
                type: invoice._rawInvoice.type || 13,
                invoiceFrom: invoice._rawInvoice.invoiceFrom,
                invoiceTo: invoice._rawInvoice.invoiceTo,
                rfNumber: invoice._rawInvoice.rfNumber || `RF${invoice.invoice_number}`,
                referenceNumber: invoice._rawInvoice.referenceNumber,
                referenceType: invoice._rawInvoice.referenceType,
                referenceDescription: invoice._rawInvoice.referenceDescription
            };

            // Return the prepared data structure
            return {
                _rawInvoice: rawInvoice,
                _clientDetails: invoice._clientDetails,
                company: invoice.company,
                supplier: {
                    tin: invoice.supplier?.tin || invoice.company?.customFields?.find(f => f.label === "Supplier's TIN")?.value,
                    registrationNumber: invoice.supplier?.registrationNumber || invoice.company?.customFields?.find(f => f.label === "Supplier's Registration No")?.value,
                    sstId: invoice.supplier?.sstId || invoice.company?.customFields?.find(f => f.label === "Supplier's SST No")?.value,
                    msicCode: invoice.supplier?.msicCode || invoice.company?.customFields?.find(f => f.label === "Supplier's MSIC Code")?.value,
                    businessActivity: invoice.supplier?.businessActivity || "Engineering Services"
                },
                invoiceDetails: invoice._invoiceDetails || [],
                lineItems: invoice._rawInvoice.lineItems || [{
                    description: invoice._invoiceDetails?.[0]?.memo1 || 'Service Fee',
                    amount: invoice._rawInvoice.serviceAmount || parseFloat(invoice.amount.replace('MYR ', '')),
                    taxRate: parseFloat(invoice._rawInvoice.customFields?.find(f => f.label === 'Tax Rate')?.value) || 0,
                    project: invoice._invoiceDetails?.[0]?.project
                }]
            };
        } catch (error) {
            console.error('Error preparing invoice data:', error);
            throw new Error(`Failed to prepare invoice data: ${error.message}`);
        }
    }

    // Add this back near the top of the class with other helper methods
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Add these methods to the class

    // Show loading overlay with initial state
    showLoading(initialState = 'authenticating') {
        const modal = document.getElementById('loadingModal');
        if (!modal) return;

        // Reset all steps to waiting state
        const steps = modal.querySelectorAll('.step');
        steps.forEach(step => {
            const statusSpan = step.querySelector('.step-status');
            if (statusSpan) {
                statusSpan.textContent = 'Waiting...';
                statusSpan.className = 'step-status waiting';
            }
            step.setAttribute('data-status', 'waiting');
        });

        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            modal.classList.add('show');
            this.updateLoadingState(initialState);
        });
    }

    // Hide loading overlay
    hideLoading() {
        const modal = document.getElementById('loadingModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => {
                modal.style.display = 'none';
            }, 300);
        }
    }
    
    async checkStagingDatabase() {
        const fromDate = document.getElementById('fromDate')?.value;
        const toDate = document.getElementById('toDate')?.value;

        const stagingResponse = await fetch('/bqe/check-staging', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fromDate, toDate })
        });

        const stagingData = await stagingResponse.json();

        // Create staging map
        const stagingMap = {};
        if (stagingData.hasData) {
            stagingData.invoices.forEach(inv => {
                if (inv.invoice_number) {
                    stagingMap[inv.invoice_number] = {
                        status: inv.status || 'Pending',
                        date_submitted: inv.date_submitted,
                        date_sync: inv.date_sync,
                        submission_timestamp: inv.date_submitted ? 
                            moment(inv.date_submitted).format('YYYY-MM-DD HH:mm:ss') : null
                    };
                }
            });
        }

        return { stagingData, stagingMap };
    }

    mapInvoicesWithStagingData(invoices, { stagingMap }) {
        return invoices.map(invoice => {
            const stagingInfo = stagingMap[invoice.invoice_number];
            if (stagingInfo) {
                return {
                    ...invoice,
                    status: stagingInfo.status,
                    date_submitted: stagingInfo.date_submitted,
                    date_sync: stagingInfo.date_sync,
                    submission_timestamp: stagingInfo.submission_timestamp,
                    cancellation_period: stagingInfo.status === 'Submitted' ? 
                        this.calculateCancellationTime(stagingInfo.date_submitted, stagingInfo.status) : 
                        'Not Applicable'
                };
            }
            return {
                ...invoice,
                status: 'Pending',
                date_submitted: null,
                date_sync: moment().format('YYYY-MM-DD HH:mm:ss'),
                submission_timestamp: null,
                cancellation_period: 'Not Applicable'
            };
        });
    }

    async saveAndUpdateUI(mappedInvoices) {
        const saveResults = await this.saveInvoicesInBatches(mappedInvoices);
        console.log('Save results:', saveResults);

        this.dataTable.clear();
        this.dataTable.rows.add(mappedInvoices);
        this.dataTable.draw();

        requestAnimationFrame(() => {
            this.updateCardCounts();
            this.updateTotalInvoicesFetched(mappedInvoices.length);
        });
    }

    // Add helper method to check step completion
    isStepComplete(stepName, currentState) {
        const stepOrder = ['checking_staging', 'retrieving', 'processing', 'saving', 'completed'];
        const stepIndex = stepOrder.indexOf(stepName);
        const currentIndex = stepOrder.indexOf(currentState);
        return stepIndex < currentIndex;
    }

    // Add helper method to calculate progress
    calculateProgress(state) {
        const stepOrder = ['checking_staging', 'retrieving', 'processing', 'saving', 'completed'];
        const index = stepOrder.indexOf(state);
        return ((index + 1) / stepOrder.length) * 100;
    }
} 

// Add this function to handle address toggle
function toggleAddress(btn) {
    const container = btn.previousElementSibling;
    container.classList.toggle('expanded');
    btn.textContent = container.classList.contains('expanded') ? 'View less' : 'View more';
} 

// Add this helper function to format address
function formatAddress(address) {
    if (!address) return null;
    
    const parts = [
        address.street1,
        address.street2,
        address.city,
        address.state,
        address.zip,
        address.country
    ].filter(part => part && part.trim());
    
    return parts.length > 0 ? parts.join(', ') : null;
} 


// Add this to properly handle modal closing
document.addEventListener('DOMContentLoaded', function() {
    const viewDetailsModal = document.getElementById('viewDetailsModal');
    if (viewDetailsModal) {
        viewDetailsModal.addEventListener('hidden.bs.modal', function () {
            // Clean up any tooltips when modal is closed
            const tooltips = viewDetailsModal.querySelectorAll('[data-bs-toggle="tooltip"]');
            tooltips.forEach(element => {
                const tooltip = bootstrap.Tooltip.getInstance(element);
                if (tooltip) {
                    tooltip.dispose();
                }
            });
            
            // Clear modal content
            const modalBody = viewDetailsModal.querySelector('.modal-body');
            if (modalBody) {
                modalBody.innerHTML = '';
            }

            // Remove modal backdrop if it exists
            const backdrop = document.querySelector('.modal-backdrop');
            if (backdrop) {
                backdrop.remove();
            }

            // Remove modal-open class from body
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        });
    }
});

// Make sure to export the class
window.InvoiceTableManager = InvoiceTableManager;