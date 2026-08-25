/**
 * Consolidation Module - Handles flat file uploads and processing for e-Invoice Consolidation
 */
let consolidationManager;

class ConsolidationManager {
    constructor() {
        console.log('Initializing ConsolidationManager');
        this.initEventListeners();
        this.currentCompanySettings = null;
        this.fetchCompanySettings();
        
        // Make this instance globally available
        window.consolidationManager = this;
        consolidationManager = this;
    }

    /**
     * Initialize event listeners for consolidation functionality
     */
    initEventListeners() {
        // Handle template download
        document.addEventListener('DOMContentLoaded', () => {
            const openFlatFileModalBtn = document.getElementById('openFlatFileModalBtn');
            const browseFilesLink = document.getElementById('browseFilesLink');
            const flatFileUpload = document.getElementById('flatFileUpload');
            const uploadArea = document.getElementById('uploadArea');
            const fileDetails = document.getElementById('fileDetails');
            const removeFileBtn = document.getElementById('removeFile');
            const flatFileUploadModal = document.getElementById('flatFileUploadModal');
            const createManualConsolidationBtn = document.getElementById('createManualConsolidationBtn');
            const emptyStateUploadBtn = document.getElementById('emptyStateUploadBtn');
            const emptyStateCreateBtn = document.getElementById('emptyStateCreateBtn');
            
            if (openFlatFileModalBtn) {
                openFlatFileModalBtn.addEventListener('click', () => {
                    // Add download template button to the modal when it's shown
                    if (!document.getElementById('downloadTemplateBtn')) {
                        const modalFooter = document.querySelector('#flatFileUploadModal .modal-footer');
                        if (modalFooter) {
                            const downloadBtn = document.createElement('button');
                            downloadBtn.id = 'downloadTemplateBtn';
                            downloadBtn.className = 'btn btn-outline-primary me-auto';
                            downloadBtn.innerHTML = '<i class="bi bi-download me-1"></i>Download Template';
                            downloadBtn.addEventListener('click', this.downloadTemplate.bind(this));
                            modalFooter.prepend(downloadBtn);
                        }
                    }
                    
                    // Open the modal
                    const modal = new bootstrap.Modal(flatFileUploadModal);
                    modal.show();
                });
            }
            
            // Initialize file upload functionality
            if (browseFilesLink && flatFileUpload) {
                browseFilesLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    flatFileUpload.click();
                });
            }
            
            // Handle file drag and drop
            if (uploadArea) {
                uploadArea.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    uploadArea.classList.add('bg-light');
                });
                
                uploadArea.addEventListener('dragleave', () => {
                    uploadArea.classList.remove('bg-light');
                });
                
                uploadArea.addEventListener('drop', (e) => {
                    e.preventDefault();
                    uploadArea.classList.remove('bg-light');
                    
                    if (e.dataTransfer.files.length) {
                        flatFileUpload.files = e.dataTransfer.files;
                        this.handleFileSelection(flatFileUpload.files[0]);
                    }
                });
            }
            
            // Handle file selection via file input
            if (flatFileUpload) {
                flatFileUpload.addEventListener('change', () => {
                    if (flatFileUpload.files.length) {
                        this.handleFileSelection(flatFileUpload.files[0]);
                    }
                });
            }
            
            // Remove selected file
            if (removeFileBtn && fileDetails) {
                removeFileBtn.addEventListener('click', () => {
                    if (flatFileUpload) flatFileUpload.value = '';
                    fileDetails.classList.add('d-none');
                    if (uploadArea) uploadArea.classList.remove('d-none');
                    
                    // Remove upload button if it exists
                    const uploadBtn = document.getElementById('uploadFileBtn');
                    if (uploadBtn) uploadBtn.remove();
                });
            }
            
            // Manual Consolidation Modal
            if (createManualConsolidationBtn) {
                createManualConsolidationBtn.addEventListener('click', () => {
                    this.openManualConsolidationModal();
                });
            }
            
            if (emptyStateCreateBtn) {
                emptyStateCreateBtn.addEventListener('click', () => {
                    this.openManualConsolidationModal();
                });
            }
            
            if (emptyStateUploadBtn) {
                emptyStateUploadBtn.addEventListener('click', () => {
                    const modal = new bootstrap.Modal(flatFileUploadModal);
                    modal.show();
                });
            }
            
            // Initialize mapping modal events
            this.initMappingModalEvents();
            
            // Initialize manual consolidation modal events
            this.initManualConsolidationEvents();
            
            // Initialize search and filter events
            this.initSearchFilterEvents();
        });
    }
    
    /**
     * Fetch company settings for use in consolidation
     */
    async fetchCompanySettings() {
        try {
            // Update the endpoint URL to match the registered route
            const response = await fetch('/api/company/settings');
            if (!response.ok) {
                console.error(`Failed to fetch company settings: ${response.status} ${response.statusText}`);
                throw new Error('Failed to fetch company settings');
            }
            
            const data = await response.json();
            console.log('Company settings fetched successfully:', data);
            this.currentCompanySettings = data;
            
            // Pre-fill supplier information in the manual consolidation form if it exists
            this.fillSupplierInformation();
        } catch (error) {
            console.error('Error fetching company settings:', error);
        }
    }
    
    /**
     * Fill supplier information in the manual consolidation form
     */
    fillSupplierInformation() {
        if (!this.currentCompanySettings) return;
        
        const supplierInfoElement = document.getElementById('supplierInfoSummary');
        if (supplierInfoElement) {
            const settings = this.currentCompanySettings;
            supplierInfoElement.innerHTML = `
                <strong>Supplier:</strong> ${settings.company_name}<br>
                <strong>TIN:</strong> ${settings.tin_number}<br>
                <strong>Registration:</strong> ${settings.business_registration_number}<br>
                <strong>SST:</strong> ${settings.sst_number || 'NA'}
            `;
        }
    }
    
    /**
     * Initialize search and filter events
     */
    initSearchFilterEvents() {
        const quickSearch = document.getElementById('quickSearch');
        const quickSearchBtn = document.getElementById('quickSearchBtn');
        const statusFilter = document.getElementById('statusFilter');
        const startDateFilter = document.getElementById('startDateFilter');
        const endDateFilter = document.getElementById('endDateFilter');
        const applyFiltersBtn = document.getElementById('applyFiltersBtn');
        const clearFiltersBtn = document.getElementById('clearFiltersBtn');
        
        if (quickSearch && quickSearchBtn) {
            quickSearchBtn.addEventListener('click', () => {
                this.applyQuickSearch(quickSearch.value);
            });
            
            quickSearch.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.applyQuickSearch(quickSearch.value);
                }
            });
        }
        
        if (applyFiltersBtn) {
            applyFiltersBtn.addEventListener('click', () => {
                this.applyAdvancedFilters();
            });
        }
        
        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', () => {
                if (quickSearch) quickSearch.value = '';
                if (statusFilter) statusFilter.value = '';
                if (startDateFilter) startDateFilter.value = '';
                if (endDateFilter) endDateFilter.value = '';
                
                this.clearAllFilters();
            });
        }
    }
    
    /**
     * Apply quick search filter
     * @param {string} query - Search query
     */
    applyQuickSearch(query) {
        if (typeof InvoiceTableManager !== 'undefined' && InvoiceTableManager.getInstance) {
            InvoiceTableManager.getInstance().applyQuickFilter(query);
        }
    }
    
    /**
     * Apply advanced filters
     */
    applyAdvancedFilters() {
        const statusFilter = document.getElementById('statusFilter');
        const startDateFilter = document.getElementById('startDateFilter');
        const endDateFilter = document.getElementById('endDateFilter');
        
        const filters = {
            status: statusFilter ? statusFilter.value : '',
            startDate: startDateFilter ? startDateFilter.value : '',
            endDate: endDateFilter ? endDateFilter.value : ''
        };
        
        if (typeof InvoiceTableManager !== 'undefined' && InvoiceTableManager.getInstance) {
            InvoiceTableManager.getInstance().applyAdvancedFilters(filters);
        }
    }
    
    /**
     * Clear all filters
     */
    clearAllFilters() {
        if (typeof InvoiceTableManager !== 'undefined' && InvoiceTableManager.getInstance) {
            InvoiceTableManager.getInstance().clearAllFilters();
        }
    }
    
    /**
     * Initialize mapping modal events
     */
    initMappingModalEvents() {
        // Listen for mapping buttons in the table
        document.addEventListener('click', (e) => {
            const mapButton = e.target.closest('.outbound-action-btn.map');
            const submitMappedButton = e.target.closest('.outbound-action-btn.submit[data-id]');
            
            if (mapButton) {
                const flatFileId = mapButton.dataset.id;
                const uuid = mapButton.dataset.uuid;
                this.openMappingModal(flatFileId, uuid);
                e.preventDefault();
            }
            
            if (submitMappedButton) {
                const flatFileId = submitMappedButton.dataset.id;
                const uuid = submitMappedButton.dataset.uuid;
                this.submitMappedFile(flatFileId, uuid);
                e.preventDefault();
            }
        });
        
        // Handle consolidation type change
        document.addEventListener('change', (e) => {
            if (e.target.id === 'consolidationType') {
                const customFields = document.getElementById('customConsolidationFields');
                
                if (customFields) {
                    if (e.target.value === 'custom') {
                        customFields.style.display = 'block';
                    } else {
                        customFields.style.display = 'none';
                    }
                }
            }
        });
        
        // Handle save mapping button
        document.addEventListener('click', (e) => {
            if (e.target.id === 'saveMapping') {
                const form = document.getElementById('mappingForm');
                
                if (form) {
                    // Perform form validation
                    if (!form.checkValidity()) {
                        form.reportValidity();
                        return;
                    }
                    
                    const fileId = document.getElementById('mappingFileId').value;
                    const mappingDetails = {
                        consolidationType: document.getElementById('consolidationType').value,
                        classificationCode: document.getElementById('classificationCode')?.value || '004',
                        startDate: document.getElementById('consolidationStartDate').value,
                        endDate: document.getElementById('consolidationEndDate').value,
                        notes: document.getElementById('consolidationNotes').value
                    };
                    
                    this.saveMapping(fileId, mappingDetails);
                }
            }
        });
    }
    
    /**
     * Initialize manual consolidation modal events
     */
    initManualConsolidationEvents() {
        const openModalBtn = document.getElementById('createManualConsolidationBtn');
        const closeBtn = document.getElementById('closeManualConsolidationBtn');
        const saveBtn = document.getElementById('saveManualConsolidation');
        const exportBtn = document.getElementById('exportToExcelBtn');
        const modal = document.getElementById('manualConsolidationModal');
        
        if (openModalBtn) {
            openModalBtn.addEventListener('click', () => this.openManualConsolidationModal());
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                const bsModal = bootstrap.Modal.getInstance(modal);
                if (bsModal) bsModal.hide();
            });
        }
        
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveManualConsolidation());
        }

        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportToExcel());
            console.log("Export button clicked");
        }
        
        // Initialize foreign currency toggle
        const foreignCurrencyToggle = document.getElementById('foreignCurrencyToggle');
        if (foreignCurrencyToggle) {
            foreignCurrencyToggle.addEventListener('change', () => this.handleForeignCurrencyToggle());
            
            // Set initial state
            this.handleForeignCurrencyToggle();
        }
        
        // Initialize line items when modal is shown
        if (modal) {
            modal.addEventListener('shown.bs.modal', () => {
                // Initialize line items
                this.initLineItems();
                
                // Initialize tax settings synchronization
                this.initTaxSettingsSynchronization();
                
                // Initialize tax configuration UI
                this.initTaxConfigurationUI();
                
                // Initialize foreign currency toggle
                const foreignCurrencyToggle = document.getElementById('foreignCurrencyToggle');
                if (foreignCurrencyToggle) {
                    this.handleForeignCurrencyToggle();
                }
                
                // Apply global tax settings to any existing line items
                setTimeout(() => {
                    this.applyTaxSettingsToLineItems();
                }, 300);
            });
        }
    }
    
    /**
     * Initialize line item mode toggle
     */
    initLineItemModeToggle() {
        const toggle = document.getElementById('lineItemModeToggle');
        const singleForm = document.getElementById('singleLineItemForm');
        const multipleSection = document.getElementById('multipleLineItemsSection');
        const addLineItemBtn = document.getElementById('addLineItemBtn');
        
        // Fields to toggle visibility based on mode
        const manualTransactionsField = document.getElementById('manualTransactions')?.closest('.mb-3');
        const manualReceiptRangeField = document.getElementById('manualReceiptRange')?.closest('.mb-3');
        const manualDescriptionField = document.getElementById('manualDescription')?.closest('.mb-3');
        
        if (!toggle || !singleForm || !multipleSection) return;
        
        // Set initial state
        this.isMultipleLineItemMode = toggle.checked;
        singleForm.style.display = this.isMultipleLineItemMode ? 'none' : 'block';
        multipleSection.style.display = this.isMultipleLineItemMode ? 'block' : 'none';
        
        // Set initial state of fields
        if (manualTransactionsField) manualTransactionsField.style.display = this.isMultipleLineItemMode ? 'none' : 'block';
        if (manualReceiptRangeField) manualReceiptRangeField.style.display = this.isMultipleLineItemMode ? 'none' : 'block';
        if (manualDescriptionField) manualDescriptionField.style.display = this.isMultipleLineItemMode ? 'none' : 'block';
        
        // Set initial state of Add Line Item button
        if (addLineItemBtn) {
            addLineItemBtn.disabled = !this.isMultipleLineItemMode;
            addLineItemBtn.classList.toggle('disabled', !this.isMultipleLineItemMode);
        }
        
        toggle.addEventListener('change', () => {
            this.isMultipleLineItemMode = toggle.checked;
            singleForm.style.display = this.isMultipleLineItemMode ? 'none' : 'block';
            multipleSection.style.display = this.isMultipleLineItemMode ? 'block' : 'none';
            
            // Update fields visibility
            if (manualTransactionsField) manualTransactionsField.style.display = this.isMultipleLineItemMode ? 'none' : 'block';
            if (manualReceiptRangeField) manualReceiptRangeField.style.display = this.isMultipleLineItemMode ? 'none' : 'block';
            if (manualDescriptionField) manualDescriptionField.style.display = this.isMultipleLineItemMode ? 'none' : 'block';
            
            // In single mode, limit to one line item
            if (!this.isMultipleLineItemMode) {
                const lineItems = document.querySelectorAll('#lineItemsBody tr');
                // Keep only the first row in single mode, remove others
                if (lineItems.length > 1) {
                    for (let i = 1; i < lineItems.length; i++) {
                        lineItems[i].remove();
                    }
                }
                
                // Calculate the remaining item
                if (lineItems.length > 0) {
                    this.calculateLineItemTotals(lineItems[0]);
                }
            }
            
            // Disable/enable Add Line Item button
            if (addLineItemBtn) {
                addLineItemBtn.disabled = !this.isMultipleLineItemMode;
                addLineItemBtn.classList.toggle('disabled', !this.isMultipleLineItemMode);
            }
            
            // Update grand totals
            this.updateGrandTotals();
            
            if (this.isMultipleLineItemMode) {
                // Switch to multiple items mode
                console.log('Switched to multiple line items mode');
            } else {
                // Switch to single item mode
                console.log('Switched to single line item mode');
                this.syncLineItemsToSingleForm();
            }
        });

        // Simpler input handling for amount fields
        document.addEventListener('input', (e) => {
            if (e.target.classList.contains('item-amount')) {
                // Allow typing numbers freely
                const row = e.target.closest('tr');
                if (row) {
                    this.calculateLineItemTotals(row);
                }
            }
        });

        // Format on blur
        document.addEventListener('blur', (e) => {
            if (e.target.classList.contains('item-amount')) {
                const value = e.target.value.replace(/[^\d.]/g, '');
                const num = parseFloat(value);
                if (!isNaN(num)) {
                    e.target.value = num.toFixed(2);
                    const row = e.target.closest('tr');
                    if (row) {
                        this.calculateLineItemTotals(row);
                    }
                }
            }
        }, true);
    }
    
    /**
     * Initialize calculations for the single line item mode
     */
    initSingleLineItemCalculations() {
        const singleAmount = document.getElementById('singleAmount');
        const singleTaxRate = document.getElementById('singleTaxRate');
        const singleTaxType = document.getElementById('singleTaxType');
        
        if (singleAmount && singleTaxRate && singleTaxType) {
            // Add event listeners for input changes
            singleAmount.addEventListener('input', () => this.calculateSingleLineItemTotals());
            singleTaxRate.addEventListener('input', () => this.calculateSingleLineItemTotals());
            
            // Add event listener for tax type changes
            singleTaxType.addEventListener('change', () => {
                if (singleTaxType.value === '06' || singleTaxType.value === 'E') {
                    singleTaxRate.value = 0;
                    singleTaxRate.disabled = true;
                } else {
                    // Get the global tax rate if available
                    const globalTaxRate = document.getElementById('manualTaxRate');
                    singleTaxRate.value = globalTaxRate ? globalTaxRate.value : 8;
                    this.calculateSingleLineItemTotals();
                    singleTaxRate.disabled = false;
                }
            });
        }
    }
    
    /**
     * Calculate totals for the single line item mode
     */
    calculateSingleLineItemTotals() {
        const singleAmount = document.getElementById('singleAmount');
        const singleTaxRate = document.getElementById('singleTaxRate');
        const singleTotal = document.getElementById('singleTotal');
        
        if (singleAmount && singleTaxRate && singleTotal) {
            const amount = parseFloat(singleAmount.value) || 0;
            const rate = parseFloat(singleTaxRate.value) || 0;
            
            const taxAmount = parseFloat((amount * (rate / 100)).toFixed(2));
            const totalAmount = parseFloat((amount + taxAmount).toFixed(2));
            
            console.log(`Single line item calculation: Amount=${amount}, Tax Rate=${rate}%, Tax=${taxAmount}, Total=${totalAmount}`);
            
            singleTotal.value = totalAmount.toFixed(2);
            
            // Also update hidden fields for form submission
            this.syncSingleLineItemToHiddenFields();
        }
    }
    
    /**
     * Sync single line item values to hidden fields for form submission
     */
    syncSingleLineItemToHiddenFields() {
        const singleAmount = document.getElementById('singleAmount');
        const singleTaxRate = document.getElementById('singleTaxRate');
        const singleTotal = document.getElementById('singleTotal');
        const singleTaxType = document.getElementById('singleTaxType');
        const singleClassification = document.getElementById('singleClassification');
        const singleDescription = document.getElementById('singleDescription');
        
        // Hidden fields
        const totalExclTax = document.getElementById('manualTotalExclTax');
        const taxAmount = document.getElementById('manualTaxAmount');
        const totalInclTax = document.getElementById('manualTotalInclTax');
        const taxRate = document.getElementById('manualTaxRate');
        const taxType = document.getElementById('manualTaxType');
        const classification = document.getElementById('manualClassification');
        const description = document.getElementById('manualDescription');
        
        if (singleAmount && singleTaxRate && singleTotal && totalExclTax && taxAmount && totalInclTax && taxRate) {
            const amount = parseFloat(singleAmount.value) || 0;
            const rate = parseFloat(singleTaxRate.value) || 0;
            const total = parseFloat(singleTotal.value) || 0;
            const tax = total - amount;
            
            // Update hidden fields
            totalExclTax.value = amount.toFixed(2);
            taxAmount.value = tax.toFixed(2);
            totalInclTax.value = total.toFixed(2);
            taxRate.value = rate;
            
            // Update display elements
            const displayTotalExclTax = document.getElementById('displayTotalExclTax');
            const displayTaxAmount = document.getElementById('displayTaxAmount');
            const displayTotalInclTax = document.getElementById('displayTotalInclTax');
            
            if (displayTotalExclTax) displayTotalExclTax.textContent = `MYR ${amount.toFixed(2)}`;
            if (displayTaxAmount) displayTaxAmount.textContent = `MYR ${tax.toFixed(2)}`;
            if (displayTotalInclTax) displayTotalInclTax.textContent = `MYR ${total.toFixed(2)}`;
        }
        
        // Update other hidden fields
        if (singleTaxType && taxType) taxType.value = singleTaxType.value;
        if (singleClassification && classification) classification.value = singleClassification.value;
        
        // Update description if not empty
        if (singleDescription && description && singleDescription.value) {
            description.value = singleDescription.value;
        }
    }
    
    /**
     * Set default dates for consolidation forms
     */
    setDefaultConsolidationDates() {
        // Get first and last day of current month
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        
        // Format as YYYY-MM-DD
        const formatDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };
        
        // Set values for consolidation start/end dates
        const consolidationStartDate = document.getElementById('consolidationStartDate');
        const consolidationEndDate = document.getElementById('consolidationEndDate');
        const manualStartDate = document.getElementById('manualStartDate');
        const manualEndDate = document.getElementById('manualEndDate');
        
        if (consolidationStartDate) consolidationStartDate.value = formatDate(firstDay);
        if (consolidationEndDate) consolidationEndDate.value = formatDate(lastDay);
        if (manualStartDate) manualStartDate.value = formatDate(firstDay);
        if (manualEndDate) manualEndDate.value = formatDate(lastDay);
        
        // Set default invoice number
        const manualInvoiceNo = document.getElementById('manualInvoiceNo');
        if (manualInvoiceNo) {
            const month = String(today.getMonth() + 1).padStart(2, '0');
            manualInvoiceNo.value = `CONS-${today.getFullYear()}-${month}-001`;
        }
    }
    
    /**
     * Update tax calculations for manual consolidation
     */
    updateTaxCalculations() {
        const totalExclTax = document.getElementById('manualTotalExclTax');
        const taxAmount = document.getElementById('manualTaxAmount');
        const totalInclTax = document.getElementById('manualTotalInclTax');
        const taxRate = document.getElementById('manualTaxRate');
        
        if (totalExclTax && taxAmount && totalInclTax && taxRate) {
            const amount = parseFloat(totalExclTax.value) || 0;
            const rate = parseFloat(taxRate.value) || 0;
            
            const tax = amount * (rate / 100);
            const total = amount + tax;
            
            taxAmount.value = tax.toFixed(2);
            totalInclTax.value = total.toFixed(2);
        }
    }
    
    /**
     * Open the manual consolidation modal
     */
    openManualConsolidationModal() {
        const modal = document.getElementById('manualConsolidationModal');
        if (!modal) return;
        
        // Reset form
        const form = document.getElementById('manualConsolidationForm');
        if (form) form.reset();
        
        // Set default dates
        this.setDefaultConsolidationDates();
        
        // Initialize the tax configuration UI
        this.initTaxConfigurationUI();
        
        // Initialize line items
        this.initLineItems();
        
        // Force classification to 004 and disable selection
        const globalClassification = document.getElementById('globalClassification');
        if (globalClassification) {
            globalClassification.value = '004';
            globalClassification.setAttribute('disabled', 'disabled');
            
            // Add an info message to explain why it's disabled
            const infoText = document.createElement('div');
            infoText.className = 'text-info small mt-1';
            infoText.innerHTML = '<i class="bi bi-info-circle"></i> Classification is fixed to "004 - Consolidated e-Invoice" as mandated by IRBM for consolidated invoices.';
            
            // Only add the message if it doesn't already exist
            if (!globalClassification.parentElement.querySelector('.text-info.small')) {
                globalClassification.parentElement.appendChild(infoText);
            }
        }
        
        // Also make sure any single line item form elements are set properly
        const singleClassification = document.getElementById('singleClassification');
        if (singleClassification) {
            singleClassification.value = '004';
            singleClassification.setAttribute('disabled', 'disabled');
        }
        
        // Show the modal
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();
    }
    
    /**
     * Save manual consolidation
     */
    async saveManualConsolidation() {
        try {
            const form = document.getElementById('manualConsolidationForm');
            
            if (!form || !form.checkValidity()) {
                form.reportValidity();
                return;
            }
            
            // Prepare data based on mode
            let lineItems = [];
            let isValid = true;
            
            if (this.isMultipleLineItemMode) {
                // Validate multiple line items
                lineItems = this.getLineItems();
                if (lineItems.length === 0) {
                    this.showToast('At least one line item with description and amount is required', 'error');
                    // Focus on the first line item description field
                    const firstDescField = document.querySelector('#lineItemsBody tr:first-child .item-description');
                    if (firstDescField) firstDescField.focus();
                    isValid = false;
                }
            } else {
                // Validate single line item
                const singleDescription = document.getElementById('singleDescription');
                const singleAmount = document.getElementById('singleAmount');
                
                if (!singleDescription.value) {
                    this.showToast('Invoice description is required for single line item mode', 'error');
                    singleDescription.focus();
                    isValid = false;
                } else if (parseFloat(singleAmount.value) <= 0) {
                    this.showToast('Amount must be greater than zero', 'error');
                    singleAmount.focus();
                    isValid = false;
                } else {
                    // Create a single line item
                    const singleClassification = document.getElementById('singleClassification');
                    const singleTaxType = document.getElementById('singleTaxType');
                    const singleTaxRate = document.getElementById('singleTaxRate');
                    const singleTotal = document.getElementById('singleTotal');
                    
                    const amount = parseFloat(singleAmount.value) || 0;
                    const taxRate = parseFloat(singleTaxRate.value) || 0;
                    const total = parseFloat(singleTotal.value) || 0;
                    const tax = total - amount;
                    
                    lineItems = [{
                        line_number: 1,
                        description: singleDescription.value,
                        classification: singleClassification.value,
                        tax_type: singleTaxType.value,
                        tax_rate: taxRate,
                        amount: amount,
                        tax: tax,
                        total: total
                    }];
                    
                    // Ensure hidden fields are synced
                    this.syncSingleLineItemToHiddenFields();
                }
            }
            
            if (!isValid) return;
            
            // Confirm submission
            const confirmSubmit = confirm('Are you sure you want to create and submit this consolidated invoice?');
            if (!confirmSubmit) return;
            
            // Show loading state
            this.showLoadingState('Creating consolidated invoice...');
            
            // Get form data
            const data = {
                invoice_no: document.getElementById('manualInvoiceNo').value,
                start_date: document.getElementById('manualStartDate').value,
                end_date: document.getElementById('manualEndDate').value,
                description: this.isMultipleLineItemMode 
                    ? document.getElementById('singleDescription').value 
                    : document.getElementById('manualDescription').value,
                classification: document.getElementById('manualClassification').value,
                tax_type: document.getElementById('manualTaxType').value,
                tax_rate: document.getElementById('manualTaxRate').value,
                total_excl_tax: document.getElementById('manualTotalExclTax').value,
                tax_amount: document.getElementById('manualTaxAmount').value,
                total_incl_tax: document.getElementById('manualTotalInclTax').value,
                transactions: this.isMultipleLineItemMode 
                    ? '1' 
                    : document.getElementById('manualTransactions').value,
                receipt_range: this.isMultipleLineItemMode 
                    ? 'N/A' 
                    : document.getElementById('manualReceiptRange').value,
                notes: document.getElementById('manualNotes').value,
                // Add the supplier information from company settings
                supplier_info: this.currentCompanySettings || {},
                // Add line items
                line_items: lineItems,
                // Add mode flag
                is_multiple_line_items: this.isMultipleLineItemMode
            };
            
            console.log('Submitting consolidated invoice with line items:', lineItems);
            
            // Send request to API
            const response = await fetch('/api/consolidation/create-manual', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to create consolidated invoice');
            }
            
            const result = await response.json();
            console.log('Consolidated invoice created successfully:', result);
            
            // Hide loading state
            this.hideLoadingState();
            
            // Close the modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('manualConsolidationModal'));
            if (modal) modal.hide();
            
            // Show success message
            const mode = this.isMultipleLineItemMode ? `with ${lineItems.length} line items` : 'with single entry';
            this.showToast(`Consolidated invoice created successfully ${mode}.`);
            
            // Refresh the table
            if (typeof InvoiceTableManager !== 'undefined' && InvoiceTableManager.getInstance) {
                InvoiceTableManager.getInstance().refresh(true);
            }
        } catch (error) {
            console.error('Error creating consolidated invoice:', error);
            this.hideLoadingState();
            this.showToast('Error creating consolidated invoice: ' + error.message, 'error');
        }
    }
    
    /**
     * Download the template file
     */
    downloadTemplate() {
        const templateUrl = '/assets/templates/consolidation_template.csv';
        
        // Create a temporary link element
        const downloadLink = document.createElement('a');
        downloadLink.href = templateUrl;
        downloadLink.download = 'consolidation_template.csv';
        
        // Append to the document, click it, and remove it
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        
        // Show success message
        this.showToast('Template downloaded successfully. Please fill it with your data and upload it back.');
    }
    
    /**
     * Handle file selection
     * @param {File} file - The selected file
     */
    handleFileSelection(file) {
        // Validate file type (CSV or TXT)
        const validTypes = ['.csv', '.txt'];
        const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        
        if (!validTypes.includes(fileExt)) {
            this.showToast('Invalid file type. Please upload a CSV or TXT file.', 'error');
            return;
        }
        
        // Validate file size (max 5MB)
        const maxSize = 5 * 1024 * 1024; // 5MB in bytes
        if (file.size > maxSize) {
            this.showToast('File is too large. Maximum allowed size is 5MB.', 'error');
            return;
        }
        
        // Update UI to show file details
        const uploadArea = document.getElementById('uploadArea');
        const fileDetails = document.getElementById('fileDetails');
        const fileName = document.querySelector('.file-name');
        const fileInfo = document.querySelector('.file-info');
        
        if (fileName && fileInfo) {
            fileName.textContent = file.name;
            fileInfo.textContent = `Size: ${this.formatFileSize(file.size)}`;
            
            if (uploadArea) uploadArea.classList.add('d-none');
            if (fileDetails) fileDetails.classList.remove('d-none');
            
            // Add upload button to modal footer if it doesn't exist
            const modalFooter = document.querySelector('#flatFileUploadModal .modal-footer');
            if (modalFooter && !document.getElementById('uploadFileBtn')) {
                const uploadBtn = document.createElement('button');
                uploadBtn.id = 'uploadFileBtn';
                uploadBtn.className = 'btn btn-primary';
                uploadBtn.innerHTML = '<i class="bi bi-cloud-upload me-1"></i>Upload & Process';
                uploadBtn.addEventListener('click', () => this.uploadFile(file));
                modalFooter.appendChild(uploadBtn);
            }
        }
    }
    
    /**
     * Format file size for display
     * @param {number} bytes - File size in bytes
     * @returns {string} - Formatted file size
     */
    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' bytes';
        else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        else return (bytes / 1048576).toFixed(1) + ' MB';
    }
    
    /**
     * Upload the selected file
     * @param {File} file - The file to upload
     */
    async uploadFile(file) {
        try {
            // Show loading state
            this.showLoadingState('Processing your file...');
            
            // Create FormData and append file
            const formData = new FormData();
            formData.append('file', file);
            
            // If we have company settings, add them
            if (this.currentCompanySettings) {
                formData.append('supplier_info', JSON.stringify(this.currentCompanySettings));
            }
            
            // Send file to server
            const response = await fetch('/api/consolidation/upload-flat-file', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to upload file');
            }
            
            const data = await response.json();
            
            // Hide loading state
            this.hideLoadingState();
            
            // Close the modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('flatFileUploadModal'));
            if (modal) modal.hide();
            
            // Show success message and refresh the table
            this.showToast(`File uploaded successfully. ${data.recordsProcessed || 0} records processed.`);
            
            // Refresh the table - call the refresh method if it exists
            if (typeof InvoiceTableManager !== 'undefined' && InvoiceTableManager.getInstance) {
                InvoiceTableManager.getInstance().refresh(true);
            }
        } catch (error) {
            this.hideLoadingState();
            this.showToast('Error uploading file: ' + error.message, 'error');
        }
    }
    
    /**
     * Open the mapping modal
     * @param {string} id - Flat file ID
     * @param {string} uuid - Flat file UUID
     */
    openMappingModal(id, uuid) {
        const mappingModal = document.getElementById('flatFileMappingModal');
        
        if (!mappingModal) {
            console.error('Mapping modal not found');
            return;
        }
        
        // Set the file ID and UUID in the form
        document.getElementById('mappingFileId').value = id;
        document.getElementById('mappingFileUuid').value = uuid;
        
        // Set default dates (first and last day of current month)
        this.setDefaultConsolidationDates();
        
        // Force classification to 004 for consolidated flat files
        const classificationCodeSelect = document.getElementById('classificationCode');
        if (classificationCodeSelect) {
            classificationCodeSelect.value = '004';
            classificationCodeSelect.setAttribute('disabled', 'disabled');
            
            // Add info note about the restriction if it doesn't exist
            if (!classificationCodeSelect.parentElement.querySelector('.classification-note')) {
                const noteDiv = document.createElement('div');
                noteDiv.className = 'classification-note text-info small mt-1';
                noteDiv.innerHTML = '<i class="bi bi-info-circle"></i> Classification code is fixed to "004 - Consolidated e-Invoice" as mandated by IRBM.';
                classificationCodeSelect.parentElement.appendChild(noteDiv);
            }
        }
        
        // Show the modal
        const modal = new bootstrap.Modal(mappingModal);
        modal.show();
    }
    
    /**
     * Save mapping for a flat file
     * @param {string} fileId - Flat file ID
     * @param {Object} mappingDetails - Mapping details
     */
    async saveMapping(fileId, mappingDetails) {
        try {
            this.showLoadingState('Saving mapping...');
            
            const response = await fetch(`/api/consolidation/map-flat-file/${fileId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(mappingDetails)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to save mapping');
            }
            
            this.hideLoadingState();
            
            // Close the modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('flatFileMappingModal'));
            if (modal) modal.hide();
            
            // Show success message and refresh the table
            this.showToast('Mapping saved successfully.');
            
            // Refresh the table - call the refresh method if it exists
            if (typeof InvoiceTableManager !== 'undefined' && InvoiceTableManager.getInstance) {
                InvoiceTableManager.getInstance().refresh(true);
            }
        } catch (error) {
            this.hideLoadingState();
            this.showToast('Error saving mapping: ' + error.message, 'error');
        }
    }
    
    /**
     * Submit a mapped flat file
     * @param {string} fileId - Flat file ID
     * @param {string} uuid - Flat file UUID
     */
    async submitMappedFile(fileId, uuid) {
        try {
            // Show confirmation dialog using SweetAlert if available
            let confirmed = false;
            
            if (typeof Swal !== 'undefined') {
                const result = await Swal.fire({
                    title: 'Submit to LHDN?',
                    text: 'Are you sure you want to submit this consolidated file to LHDN?',
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Yes, submit it',
                    cancelButtonText: 'Cancel',
                    confirmButtonColor: '#0a3d8a',
                    cancelButtonColor: '#6c757d'
                });
                
                confirmed = result.isConfirmed;
            } else {
                // Fallback to standard confirm
                confirmed = confirm('Are you sure you want to submit this consolidated file to LHDN?');
            }
            
            if (!confirmed) return;
            
            // Show loading state
            this.showLoadingState('Submitting to LHDN...');
            
            const response = await fetch(`/api/consolidation/submit-mapped-file/${fileId}`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to submit file');
            }
            
            this.hideLoadingState();
            
            // Show success message and refresh the table
            this.showToast('File submitted to LHDN successfully.');
            
            // Refresh the table - call the refresh method if it exists
            if (typeof InvoiceTableManager !== 'undefined' && InvoiceTableManager.getInstance) {
                InvoiceTableManager.getInstance().refresh(true);
            }
        } catch (error) {
            this.hideLoadingState();
            this.showToast('Error submitting file: ' + error.message, 'error');
        }
    }
    
    /**
     * Show a loading state
     * @param {string} message - Loading message
     */
    showLoadingState(message = 'Loading...') {
        // Try to use the InvoiceTableManager's loading backdrop if available
        if (typeof InvoiceTableManager !== 'undefined' && InvoiceTableManager.getInstance) {
            InvoiceTableManager.getInstance().showLoadingBackdrop(message);
        } else {
            // Create a simple loading overlay if needed
            let loadingOverlay = document.getElementById('consolidationLoadingOverlay');
            
            if (!loadingOverlay) {
                loadingOverlay = document.createElement('div');
                loadingOverlay.id = 'consolidationLoadingOverlay';
                loadingOverlay.className = 'consolidation-loading-overlay';
                loadingOverlay.innerHTML = `
                    <div class="spinner-border text-primary loading-spinner" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <div class="loading-message" id="loadingMessage">${message}</div>
                `;
                
                document.body.appendChild(loadingOverlay);
            } else {
                document.getElementById('loadingMessage').textContent = message;
                loadingOverlay.classList.remove('d-none');
            }
        }
    }
    
    /**
     * Hide the loading state
     */
    hideLoadingState() {
        // Try to use the InvoiceTableManager's method if available
        if (typeof InvoiceTableManager !== 'undefined' && InvoiceTableManager.getInstance) {
            InvoiceTableManager.getInstance().hideLoadingBackdrop();
        } else {
            // Hide the simple loading overlay
            const loadingOverlay = document.getElementById('consolidationLoadingOverlay');
            if (loadingOverlay) {
                loadingOverlay.classList.add('d-none');
            }
        }
    }
    
    /**
     * Show a toast message
     * @param {string} message - Message to display
     * @param {string} type - Toast type (success, error, warning)
     */
    showToast(message, type = 'success') {
        // Create toast container if it doesn't exist
        let toastContainer = document.querySelector('.toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
            document.body.appendChild(toastContainer);
        }
        
        // Define icon based on type
        let icon = 'bi-check-circle-fill text-success';
        let title = 'Success';
        
        if (type === 'error') {
            icon = 'bi-exclamation-circle-fill text-danger';
            title = 'Error';
        } else if (type === 'warning') {
            icon = 'bi-exclamation-triangle-fill text-warning';
            title = 'Warning';
        }
        
        // Create toast
        const toastId = 'toast-' + Date.now();
        const toastHtml = `
            <div id="${toastId}" class="toast" role="alert" aria-live="assertive" aria-atomic="true">
                <div class="toast-header">
                    <i class="bi ${icon} me-2"></i>
                    <strong class="me-auto">${title}</strong>
                    <small>Just now</small>
                    <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
                <div class="toast-body">
                    ${message}
                </div>
            </div>
        `;
        
        toastContainer.insertAdjacentHTML('beforeend', toastHtml);
        
        // Initialize and show the toast
        const toastEl = document.getElementById(toastId);
        const toast = new bootstrap.Toast(toastEl, { autohide: true, delay: 5000 });
        toast.show();
        
        // Remove toast after it's hidden
        toastEl.addEventListener('hidden.bs.toast', () => {
            toastEl.remove();
        });
    }
    
    /**
     * Initialize line items
     */
    initLineItems() {
        console.log("Initializing line items...");
        
        // Initialize the existing items
        const tbody = document.getElementById('lineItemsBody');
        
        if (!tbody) {
            console.error('Line items table body not found');
            return;
        }
        
        const rows = tbody.querySelectorAll('tr');
        
        if (rows.length === 0) {
            // Add a first line item if none exists
            console.log("No line items found, adding first one");
            const newRow = this.addLineItem();
            
            // We don't need to populate classification dropdown since we restrict it to 004
        } else {
            // Add event listeners and initialize calculations for existing rows
            console.log(`Found ${rows.length} existing line items, initializing`);
            rows.forEach(row => {
                const amountInput = row.querySelector('.item-amount');
                const taxTypeSelect = row.querySelector('.item-tax-type');
                const classificationSelect = row.querySelector('.item-classification');
                
                // Force and lock classification to 004
                if (classificationSelect) {
                    classificationSelect.value = '004';
                    classificationSelect.disabled = true;
                }
                
                if (amountInput) {
                    amountInput.addEventListener('input', () => this.calculateLineItemTotals(row));
                }
                
                if (taxTypeSelect) {
                    taxTypeSelect.addEventListener('change', () => this.calculateLineItemTotals(row));
                }
                
                // Calculate totals for this row
                this.calculateLineItemTotals(row);
            });
        }
        
        // Initialize empty state
        this.updateEmptyState();
        
        // Initialize Tax Configuration UI and add direct event handlers
        this.initDirectTaxHandlers();
        
        // Apply tax settings to the line items
        // Using setTimeout to ensure all UI elements are fully loaded
        setTimeout(() => {
            console.log("Applying initial tax settings to all line items");
            this.forceSyncAllLineItems();
            
            // Check if foreign currency is enabled and set up a test case
            const foreignCurrencyToggle = document.getElementById('foreignCurrencyToggle');
            if (foreignCurrencyToggle && foreignCurrencyToggle.checked) {
                this.setupTestCase();
            }
        }, 300);
    }
    
    /**
     * Set up a test case with USD 500 that converts to MYR using the exchange rate
     */
    setupTestCase() {
        console.log('Setting up test case with USD 500');
        
        // Check if foreign currency mode is enabled
        const foreignCurrencyToggle = document.getElementById('foreignCurrencyToggle');
        if (!foreignCurrencyToggle || !foreignCurrencyToggle.checked) {
            console.log('Foreign currency mode is not enabled, skipping test case');
            return;
        }
        
        // Get currency selectors
        const globalCurrency = document.getElementById('globalCurrency');
        const globalTaxCurrency = document.getElementById('globalTaxCurrency');
        const globalExchangeRate = document.getElementById('globalExchangeRate');
        
        if (!globalCurrency || !globalTaxCurrency || !globalExchangeRate) {
            console.error('Currency elements not found');
            return;
        }
        
        // Set currencies to USD and MYR
        globalCurrency.value = 'USD';
        globalTaxCurrency.value = 'MYR';
        
        // Set exchange rate to current market rate (from XE.com as of April 14, 2025)
        // Using current market rate instead of hardcoded value for accuracy
        const currentExchangeRate = 4.41422;
        globalExchangeRate.value = currentExchangeRate.toString();
        
        // Set tax rate to 8% as in the sample
        const globalTaxRate = document.getElementById('globalTaxRate');
        if (globalTaxRate) {
            globalTaxRate.value = '8';
        }
        
        // Get the first line item or create one if none exists
        let firstRow = document.querySelector('#lineItemsBody tr:first-child');
        if (!firstRow) {
            firstRow = this.addLineItem();
        }
        
        // Set the amount to 500 USD
        const amountInput = firstRow.querySelector('.item-amount');
        const descInput = firstRow.querySelector('.item-description');
        if (amountInput) {
            amountInput.value = '500';
            
            // Set a descriptive text
            if (descInput) {
                descInput.value = 'Sample USD transaction - converts to MYR at current rate';
            }
            
            // Calculate totals to apply the exchange rate
            this.calculateLineItemTotals(firstRow);
            
            // Force update all totals
            this.updateGrandTotals();
            
            // Show a toast notification
            this.showToast(`Test case set up: USD 500 with current exchange rate ${currentExchangeRate} to MYR`, 'info');
            
            // Log the expected values
            const exchangeRate = parseFloat(globalExchangeRate.value);
            const taxRate = parseFloat(globalTaxRate ? globalTaxRate.value : 8);
            
            const amountMYR = 500 * exchangeRate;
            const taxMYR = amountMYR * (taxRate / 100);
            const totalMYR = amountMYR + taxMYR;
            
            console.log(`Expected values:
                USD Amount: 500.00
                Exchange Rate: ${exchangeRate}
                MYR Amount: ${amountMYR.toFixed(2)}
                Tax Rate: ${taxRate}%
                MYR Tax: ${taxMYR.toFixed(2)}
                MYR Total: ${totalMYR.toFixed(2)}`);
        }
    }
    
    /**
     * Initialize direct tax handlers to ensure immediate updates
     */
    initDirectTaxHandlers() {
        console.log("Setting up direct tax handlers");
        
        // Get global tax controls
        const globalTaxType = document.getElementById('globalTaxType');
        const globalTaxRate = document.getElementById('globalTaxRate');
        const globalClassification = document.getElementById('globalClassification');
        const globalExchangeRate = document.getElementById('globalExchangeRate');
        const globalCurrency = document.getElementById('globalCurrency');
        
        if (!globalTaxType || !globalTaxRate || !globalClassification) {
            console.error('Global tax configuration UI elements not found');
            return;
        }
        
        // Add direct event listeners
        globalTaxType.addEventListener('change', (e) => {
            console.log(`Direct handler: Global Tax type changed to: ${e.target.value}`);
            this.forceSyncAllLineItems();
        });
        
        globalTaxRate.addEventListener('input', (e) => {
            console.log(`Direct handler: Global Tax rate changed to: ${e.target.value}%`);
            this.forceSyncAllLineItems();
        });
        
        globalClassification.addEventListener('change', (e) => {
            console.log(`Direct handler: Global Classification changed to: ${e.target.value}`);
            this.forceSyncAllLineItems();
        });
        
        if (globalExchangeRate) {
            globalExchangeRate.addEventListener('input', (e) => {
                console.log(`Direct handler: Global Exchange rate changed to: ${e.target.value}`);
                this.forceSyncAllLineItems();
            });
        }
    }
    
    /**
     * Force synchronize all line items with global tax settings
     */
    forceSyncAllLineItems() {
        console.log('Force syncing all line items with global tax settings');
        
        const globalTaxType = document.getElementById('globalTaxType');
        const globalTaxRate = document.getElementById('globalTaxRate');
        const globalClassification = document.getElementById('globalClassification');
        const globalExchangeRate = document.getElementById('globalExchangeRate');
        const globalCurrency = document.getElementById('globalCurrency');
        const globalTaxCurrency = document.getElementById('globalTaxCurrency');
        
        if (!globalTaxType || !globalTaxRate || !globalClassification) {
            console.error('Global tax configuration elements not found');
            return;
        }
        
        // Log currency and exchange rate information
        if (globalCurrency && globalExchangeRate && globalTaxCurrency) {
            console.log(`Document Currency: ${globalCurrency.value}, Tax Currency: ${globalTaxCurrency.value}, Exchange Rate: ${globalExchangeRate.value}`);
        }
        
        // Force classification to 004 for consolidated invoices
        if (globalClassification.value !== '004') {
            console.log('Forcing classification to 004 for consolidated invoice');
            globalClassification.value = '004';
            
            // Show message to user
            this.showToast('Classification has been set to "004 - Consolidated e-Invoice" as required by IRBM', 'info');
        }
        
        const tbody = document.getElementById('lineItemsBody');
        if (!tbody) {
            console.error('Line items table body not found');
            return;
        }
        
        const rows = tbody.querySelectorAll('tr:not(#emptyLineItems)');
        console.log(`Force updating ${rows.length} line items with tax settings`);
        
        rows.forEach((row, index) => {
            // Update tax type
            const taxTypeSelect = row.querySelector('.item-tax-type');
            if (taxTypeSelect) {
                taxTypeSelect.value = globalTaxType.value;
                console.log(`Row ${index+1}: Tax type set to ${globalTaxType.value}`);
            }
            
            // Update classification - always force to 004
            const classSelect = row.querySelector('.item-classification');
            if (classSelect) {
                classSelect.value = '004';
                console.log(`Row ${index+1}: Classification set to 004`);
            }
            
            // Recalculate with new tax settings
            this.calculateLineItemTotals(row);
        });
        
        // Update grand totals
        this.updateGrandTotals();
    }
    
    /**
     * Initialize tax settings synchronization
     */
    initTaxSettingsSynchronization() {
        console.log('Initializing tax settings synchronization');
        
        // Ensure we apply global tax settings to any newly added line item
        document.addEventListener('lineItemAdded', (e) => {
            console.log('Line item added event received, applying tax settings');
            
            const row = e.detail.row;
            if (!row) return;
            
            // Get global tax settings
            const globalTaxType = document.getElementById('globalTaxType');
            const globalClassification = document.getElementById('globalClassification');
            const globalCurrency = document.getElementById('globalCurrency');
            const globalExchangeRate = document.getElementById('globalExchangeRate');
            
            // Log currency and exchange rate for the new line item
            if (globalCurrency && globalExchangeRate) {
                console.log(`Applying currency ${globalCurrency.value} with exchange rate ${globalExchangeRate.value} to new line item`);
            }
            
            // Apply tax type
            if (globalTaxType) {
                const taxTypeSelect = row.querySelector('.item-tax-type');
                if (taxTypeSelect) {
                    taxTypeSelect.value = globalTaxType.value;
                }
            }
            
            // Apply classification
            if (globalClassification) {
                const classSelect = row.querySelector('.item-classification');
                if (classSelect) {
                    classSelect.value = globalClassification.value;
                }
            }
            
            // Calculate line item totals
            this.calculateLineItemTotals(row);
        });
    }
    
    /**
     * Add a new line item row to the table
     */
    addLineItem() {
        const tbody = document.getElementById('lineItemsBody');
        const rows = tbody.querySelectorAll('tr');
        const index = rows.length + 1;
        
        console.log(`Adding new line item #${index}`);
        
        // Get global tax settings
        const globalTaxType = document.getElementById('globalTaxType');
        const globalTaxRate = document.getElementById('globalTaxRate');
        const globalClassification = document.getElementById('globalClassification');
        
        if (!globalTaxType || !globalTaxRate || !globalClassification) {
            console.error('Global tax settings not found, using defaults');
        } else {
            console.log(`Using global settings: Tax Type=${globalTaxType.value}, Tax Rate=${globalTaxRate.value}%, Classification=${globalClassification.value}`);
        }
        
        const newRow = document.createElement('tr');
        newRow.innerHTML = `
            <td>${index}</td>
            <td>
                <input type="text" class="form-control line-item-input item-description" placeholder="Enter description" required>
            </td>
            <td>
                <select class="form-select line-item-select item-classification">
                    <option value="004">004 - Consolidated e-Invoice</option>
                </select>
            </td>
            <td>
                <select class="form-select line-item-select item-tax-type">
                    <option value="01">01 - Sales Tax</option>
                    <option value="02">02 - Service Tax</option>
                    <option value="03">03 - Tourism Tax</option>
                    <option value="04">04 - High-Value Goods Tax</option>
                    <option value="05">05 - Sales Tax on Low Value Goods</option>
                    <option value="06">06 - Not Applicable</option>
                    <option value="E">E - Tax exemption</option>
                </select>
            </td>
            <td>
                <input type="number" class="form-control line-item-input item-amount" value="0.00" step="0.01" min="0">
            </td>
            <td>
                <input type="number" class="form-control line-item-input item-tax" value="0.00" step="0.01" min="0" readonly>
            </td>
            <td>
                <input type="number" class="form-control line-item-input item-total" value="0.00" step="0.01" min="0" readonly>
            </td>
            <td>
                <button type="button" class="line-item-action remove-line-item" title="Remove item">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        `;
        
        tbody.appendChild(newRow);
        
        // Set tax type and classification from global settings
        if (globalTaxType) {
            const taxTypeSelect = newRow.querySelector('.item-tax-type');
            if (taxTypeSelect) {
                taxTypeSelect.value = globalTaxType.value;
                console.log(`Set new line item tax type to ${globalTaxType.value}`);
            }
        }
        
        // Always set classification to 004 for consolidated invoices
        const classificationSelect = newRow.querySelector('.item-classification');
        if (classificationSelect) {
            classificationSelect.value = '004';
            classificationSelect.disabled = true; // Disable to prevent changes
            console.log(`Set new line item classification to 004 and disabled selection`);
        }
        
        // Add event listeners for calculation
        const amountInput = newRow.querySelector('.item-amount');
        const taxTypeSelect = newRow.querySelector('.item-tax-type');
        
        if (amountInput) {
            amountInput.addEventListener('input', () => this.calculateLineItemTotals(newRow));
        }
        
        if (taxTypeSelect) {
            taxTypeSelect.addEventListener('change', () => this.calculateLineItemTotals(newRow));
        }
        
        // Set focus on the description field
        const descInput = newRow.querySelector('.item-description');
        if (descInput) {
            descInput.focus();
        }
        
        // Add empty state handling
        this.updateEmptyState();
        
        // Update row numbers
        this.updateRowNumbers();
        
        // Dispatch a custom event to signal that a new line item has been added
        document.dispatchEvent(new CustomEvent('lineItemAdded', {
            detail: { row: newRow }
        }));
        
        // Calculate this line item's totals with the current tax settings
        this.calculateLineItemTotals(newRow);
        
        // Don't use window.populateLineItemDropdowns for classification field
        // as we restrict it to 004 only
        
        return newRow;
    }
    
    /**
     * Remove a line item row
     * @param {HTMLElement} row - The row to remove
     */
    removeLineItem(row) {
        if (!row) return;
        
        // Get the tbody
        const tbody = document.getElementById('lineItemsBody');
        
        // Check if this is the last row and we're in single line item mode
        const rows = tbody.querySelectorAll('tr');
        if (rows.length === 1 && !this.isMultipleLineItemMode) {
            // Don't remove the last row in single mode, just clear its values
            const descInput = row.querySelector('.item-description');
            const amountInput = row.querySelector('.item-amount');
            
            if (descInput) descInput.value = '';
            if (amountInput) {
                amountInput.value = '0.00';
                this.calculateLineItemTotals(row);
            }
            
            return;
        }
        
        // Remove the row
        row.remove();
        
        // Update row numbers
        this.updateRowNumbers();
        
        // Update grand totals
        this.updateGrandTotals();
        
        // Add empty state handling
        this.updateEmptyState();
    }
    
    /**
     * Update row numbers after adding/removing rows
     */
    updateRowNumbers() {
        const tbody = document.getElementById('lineItemsBody');
        const rows = tbody.querySelectorAll('tr');
        
        rows.forEach((row, index) => {
            const indexCell = row.querySelector('td:first-child');
            if (indexCell) {
                indexCell.textContent = index + 1;
            }
        });
    }
    
    /**
     * Handle empty state for the line items table
     */
    updateEmptyState() {
        const tbody = document.getElementById('lineItemsBody');
        const rows = tbody.querySelectorAll('tr');
        const table = document.getElementById('lineItemsTable');
        
        if (rows.length === 0) {
            // Create empty state if no rows exist
            if (!document.getElementById('emptyLineItems')) {
                const emptyRow = document.createElement('tr');
                emptyRow.id = 'emptyLineItems';
                emptyRow.innerHTML = `
                    <td colspan="8" class="text-center py-4">
                        <div class="line-items-empty">
                            <i class="bi bi-receipt"></i>
                            <p>No line items added yet. Click "Add Line Item" to begin.</p>
                        </div>
                    </td>
                `;
                tbody.appendChild(emptyRow);
            }
        } else {
            // Remove empty state if rows exist
            const emptyRow = document.getElementById('emptyLineItems');
            if (emptyRow) {
                emptyRow.remove();
            }
        }
    }
    
    /**
     * Calculate line item totals and update the display in both document and tax currencies
     */
    calculateLineItemTotals(row) {
        if (!row) {
            console.error('Cannot calculate totals: No row provided');
            return;
        }

        // Get input elements
        const amountInput = row.querySelector('.item-amount');
        const taxInput = row.querySelector('.item-tax');
        const totalInput = row.querySelector('.item-total');
        const taxTypeSelect = row.querySelector('.item-tax-type');

        if (!amountInput || !taxInput || !totalInput || !taxTypeSelect) {
            console.error('Cannot calculate totals: Missing required inputs');
            return;
        }

        // Parse amount, removing any commas
        const amount = parseFloat(amountInput.value.replace(/,/g, '')) || 0;
        const taxType = taxTypeSelect.value;

        // Get tax rate from global settings
        const globalTaxRate = document.getElementById('globalTaxRate');
        const taxRate = parseFloat(globalTaxRate?.value) || 8;

        // Calculate tax amount (if not exempt)
        let taxAmount = 0;
        if (taxType !== '06' && taxType !== 'E') {
            taxAmount = amount * (taxRate / 100);
        }

        // Calculate total
        const total = amount + taxAmount;

        // Update the display values
        taxInput.value = taxAmount.toFixed(2);
        totalInput.value = total.toFixed(2);

        // Store the raw values for calculations
        amountInput.dataset.rawValue = amount;
        taxInput.dataset.rawValue = taxAmount;
        totalInput.dataset.rawValue = total;

        // Update the grand totals
        this.updateGrandTotals();
    }

    /**
     * Update the blue footer boxes showing the totals at the bottom of the form
     */
    updateBottomSummaryBoxes() {
        // Directly target the blue boxes seen in the screenshot
        this.updateBlueFooterBoxes();
    }
    
    /**
     * Update the blue footer boxes in the UI
     * This specifically targets the blue boxes shown in the screenshot at the bottom of the form
     */
    updateBlueFooterBoxes() {
        // Get all line items to calculate totals
        const rows = document.querySelectorAll('#lineItemsBody tr:not(#emptyLineItems)');
        
        // Get currency information
        const currencyElements = {
            globalCurrency: document.getElementById('globalCurrency'),
            globalTaxCurrency: document.getElementById('globalTaxCurrency'),
            globalExchangeRate: document.getElementById('globalExchangeRate'),
            globalTaxRate: document.getElementById('globalTaxRate')
        };
        
        // Initialize currency settings
        const settings = {
            docCurrency: currencyElements.globalCurrency?.value || 'MYR',
            taxCurrency: currencyElements.globalTaxCurrency?.value || 'MYR',
            exchangeRate: parseFloat(currencyElements.globalExchangeRate?.value) || 1,
            taxRate: parseFloat(currencyElements.globalTaxRate?.value) || 8
        };
        
        const isForeignCurrency = settings.docCurrency !== settings.taxCurrency;
        
        // Calculate totals
        let totalExclTaxOriginal = 0;
        let totalTaxAmountOriginal = 0;
        let totalInclTaxOriginal = 0;
        let totalExclTaxConverted = 0;
        let totalTaxAmountConverted = 0;
        let totalInclTaxConverted = 0;
        
        rows.forEach(row => {
            const amountInput = row.querySelector('.item-amount');
            const taxInput = row.querySelector('.item-tax');
            const totalInput = row.querySelector('.item-total');
            
            if (amountInput && taxInput && totalInput) {
                // Get original amounts from data attributes
                const amount = parseFloat(amountInput.dataset.originalAmount || amountInput.value) || 0;
                const tax = parseFloat(taxInput.dataset.originalTax || taxInput.value) || 0;
                const total = parseFloat(totalInput.dataset.originalTotal || totalInput.value) || 0;
                
                // Get converted amounts
                const amountConverted = parseFloat(amountInput.dataset.convertedAmount || (amount * settings.exchangeRate)) || 0;
                const taxConverted = parseFloat(taxInput.dataset.convertedTax || tax) || 0;
                const totalConverted = parseFloat(totalInput.dataset.convertedTotal || (total * settings.exchangeRate)) || 0;
                
                // Accumulate totals
                totalExclTaxOriginal += amount;
                totalTaxAmountOriginal += tax;
                totalInclTaxOriginal += total;
                
                totalExclTaxConverted += amountConverted;
                totalTaxAmountConverted += taxConverted;
                totalInclTaxConverted += totalConverted;
            }
        });
        
        // Format the display values
        const formatAmount = (amount) => amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        
        // Update the display elements
        const displayElements = {
            totalExclTax: document.getElementById('displayTotalExclTax'),
            taxAmount: document.getElementById('displayTaxAmount'),
            totalInclTax: document.getElementById('displayTotalInclTax')
        };
        
            if (displayElements.totalExclTax) {
            displayElements.totalExclTax.innerHTML = isForeignCurrency ? 
                `<span class="currency-code">${settings.docCurrency}</span>
                    <span class="amount">${formatAmount(totalExclTaxOriginal)}</span>
                 <span class="converted">(${settings.taxCurrency} ${formatAmount(totalExclTaxConverted)})</span>` :
                `<span class="currency-code">${settings.docCurrency}</span>
                 <span class="amount">${formatAmount(totalExclTaxOriginal)}</span>`;
            }
            
            if (displayElements.taxAmount) {
            // Always show tax amount in tax currency (MYR)
            displayElements.taxAmount.innerHTML = 
                `<span class="currency-code">${settings.taxCurrency}</span>
                 <span class="amount">${formatAmount(totalTaxAmountConverted)}</span>`;
        }
        
            if (displayElements.totalInclTax) {
            displayElements.totalInclTax.innerHTML = isForeignCurrency ?
                `<span class="currency-code">${settings.docCurrency}</span>
                    <span class="amount">${formatAmount(totalInclTaxOriginal)}</span>
                 <span class="converted">(${settings.taxCurrency} ${formatAmount(totalInclTaxConverted)})</span>` :
                `<span class="currency-code">${settings.docCurrency}</span>
                 <span class="amount">${formatAmount(totalInclTaxOriginal)}</span>`;
        }
        
        // Update hidden fields for form submission
        const hiddenFields = {
            totalExclTax: document.getElementById('manualTotalExclTax'),
            taxAmount: document.getElementById('manualTaxAmount'),
            totalInclTax: document.getElementById('manualTotalInclTax')
        };
        
        if (hiddenFields.totalExclTax) hiddenFields.totalExclTax.value = totalExclTaxConverted.toFixed(2);
        if (hiddenFields.taxAmount) hiddenFields.taxAmount.value = totalTaxAmountConverted.toFixed(2);
        if (hiddenFields.totalInclTax) hiddenFields.totalInclTax.value = totalInclTaxConverted.toFixed(2);
    }
    
    /**
     * Update tax elements with blue background to show only MYR currency
     */
    updateBlueBackgroundTaxElements(taxAmount, taxCurrency) {
        // Target the specific element shown in the screenshot with blue background
        const elements = document.querySelectorAll('.bg-blue, .blue-box, .tax-box');
        elements.forEach(element => {
            if (element && element.textContent && element.textContent.includes('Tax')) {
                // Find any child element that might contain the tax value
                const valueElement = element.querySelector('span, div, strong');
                if (valueElement) {
                    valueElement.textContent = `${taxCurrency} ${taxAmount.toFixed(2)}`;
                } else {
                    // If no child element, update the text directly
                    element.textContent = element.textContent.replace(/USD\s+[\d.]+ \(MYR\s+[\d.]+\)/, `${taxCurrency} ${taxAmount.toFixed(2)}`);
                }
            }
        });
        
        // Direct targeting of the blue box seen in the screenshot
        const taxAmountBox = document.querySelector('span.total-value:nth-of-type(2)') || 
                            document.querySelector('.tax-amount') || 
                            document.querySelector('[data-tax="true"]');
                            
        if (taxAmountBox) {
            taxAmountBox.textContent = `${taxCurrency} ${taxAmount.toFixed(2)}`;
            console.log('Updated tax amount box with blue background');
        }
    }
    
    /**
     * Update the summary display at the bottom of the form
     */
    updateSummaryDisplay(
        totalExclTaxOriginal, 
        totalExclTaxConverted, 
        totalTaxAmountOriginal, 
        totalTaxAmountConverted, 
        totalInclTaxOriginal, 
        totalInclTaxConverted,
        docCurrency,
        taxCurrency,
        isForeignCurrency
    ) {
        console.log('Updating summary display in blue boxes at bottom of form');
        
        // Directly target the summary total boxes in the blue area at the bottom
        const totalExcludingTaxBox = document.querySelector('[data-id="total-excluding-tax"]');
        const totalTaxBox = document.querySelector('[data-id="total-tax-amount"]');
        const totalIncludingTaxBox = document.querySelector('[data-id="total-including-tax"]');
        
        // Also try to find the elements by their displayed text content
        const allElements = document.querySelectorAll('.invoice-totals .total-item span.total-value');
        
        // If the specific selectors didn't work, loop through all potential elements
        if (!totalExcludingTaxBox && allElements.length > 0) {
            console.log('Using text content matching to find summary boxes');
            allElements.forEach(el => {
                const text = el.textContent.toLowerCase();
                if (text.includes('excluding tax')) {
                    totalExcludingTaxBox = el;
                } else if (text.includes('tax amount')) {
                    totalTaxBox = el;
                } else if (text.includes('including tax')) {
                    totalIncludingTaxBox = el;
                }
            });
        }
        
        // Direct targeting of the elements by ID as seen in the UI
        const displayTotalExclTax = document.getElementById('displayTotalExclTax');
        const displayTaxAmount = document.getElementById('displayTaxAmount');
        const displayTotalInclTax = document.getElementById('displayTotalInclTax');
        
        // Format the values based on currency
        if (isForeignCurrency) {
            // For foreign currency, display both the original and converted values
            const totalExclTaxFormatted = `${docCurrency} ${totalExclTaxOriginal.toFixed(2)} (${taxCurrency} ${totalExclTaxConverted.toFixed(2)})`;
            const totalTaxAmountFormatted = `${docCurrency} ${totalTaxAmountOriginal.toFixed(2)} (${taxCurrency} ${totalTaxAmountConverted.toFixed(2)})`;
            const totalInclTaxFormatted = `${docCurrency} ${totalInclTaxOriginal.toFixed(2)} (${taxCurrency} ${totalInclTaxConverted.toFixed(2)})`;
            
            // Update the display elements if they exist
            if (displayTotalExclTax) displayTotalExclTax.textContent = totalExclTaxFormatted;
            if (displayTaxAmount) displayTaxAmount.textContent = totalTaxAmountFormatted;
            if (displayTotalInclTax) displayTotalInclTax.textContent = totalInclTaxFormatted;
        } else {
            // For same currency, just show one amount
            const totalExclTaxFormatted = `${docCurrency} ${totalExclTaxOriginal.toFixed(2)}`;
            const totalTaxAmountFormatted = `${docCurrency} ${totalTaxAmountOriginal.toFixed(2)}`;
            const totalInclTaxFormatted = `${docCurrency} ${totalInclTaxOriginal.toFixed(2)}`;
            
            // Update the display elements if they exist
            if (displayTotalExclTax) displayTotalExclTax.textContent = totalExclTaxFormatted;
            if (displayTaxAmount) displayTaxAmount.textContent = totalTaxAmountFormatted;
            if (displayTotalInclTax) displayTotalInclTax.textContent = totalInclTaxFormatted;
        }
        
        // Also update the summary display at the bottom of the page (blue footer boxes)
        this.updateSummaryFooterBoxes(
            totalExclTaxOriginal,
            totalExclTaxConverted,
            totalTaxAmountOriginal,
            totalTaxAmountConverted,
            totalInclTaxOriginal,
            totalInclTaxConverted,
            docCurrency,
            taxCurrency,
            isForeignCurrency
        );
    }
    
    /**
     * Update the blue summary boxes at the bottom of the page
     */
    updateSummaryFooterBoxes(
        totalExclTaxOriginal,
        totalExclTaxConverted,
        totalTaxAmountOriginal,
        totalTaxAmountConverted,
        totalInclTaxOriginal,
        totalInclTaxConverted,
        docCurrency,
        taxCurrency,
        isForeignCurrency
    ) {
        console.log('Updating blue summary boxes at the bottom of the page');
        
        // DIRECT UPDATE: These are the exact elements shown in the screenshot
        const directSelectors = {
            // These are the blue box elements
            excludingTax: '.total-excluding-tax',
            taxAmount: '.total-tax-amount',
            includingTax: '.total-including-tax'
        };
        
        // Try each direct selector first - these match the screenshot
        const directTaxExclBox = document.querySelector(directSelectors.excludingTax);
        const directTaxBox = document.querySelector(directSelectors.taxAmount);
        const directTaxInclBox = document.querySelector(directSelectors.includingTax);
        
        // Update the blue summary boxes if found
        if (directTaxExclBox) {
            if (isForeignCurrency) {
                directTaxExclBox.textContent = `${docCurrency} ${totalExclTaxOriginal.toFixed(2)} (${taxCurrency} ${totalExclTaxConverted.toFixed(2)})`;
                console.log('Updated excluding tax box with correct values');
            } else {
                directTaxExclBox.textContent = `${docCurrency} ${totalExclTaxOriginal.toFixed(2)}`;
            }
        } else {
            console.log('Could not find excluding tax box');
        }
        
        if (directTaxBox) {
            if (isForeignCurrency) {
                directTaxBox.textContent = `${docCurrency} ${totalTaxAmountOriginal.toFixed(2)} (${taxCurrency} ${totalTaxAmountConverted.toFixed(2)})`;
                console.log('Updated tax amount box with correct values');
            } else {
                directTaxBox.textContent = `${docCurrency} ${totalTaxAmountOriginal.toFixed(2)}`;
            }
        } else {
            console.log('Could not find tax amount box');
        }
        
        if (directTaxInclBox) {
            if (isForeignCurrency) {
                directTaxInclBox.textContent = `${docCurrency} ${totalInclTaxOriginal.toFixed(2)} (${taxCurrency} ${totalInclTaxConverted.toFixed(2)})`;
                console.log('Updated including tax box with correct values');
            } else {
                directTaxInclBox.textContent = `${docCurrency} ${totalInclTaxOriginal.toFixed(2)}`;
            }
        } else {
            console.log('Could not find including tax box');
        }
        
        // Also try by ID - these are shown in the screenshot
        const displayTotalExclTax = document.getElementById('displayTotalExclTax');
        const displayTaxAmount = document.getElementById('displayTaxAmount');
        const displayTotalInclTax = document.getElementById('displayTotalInclTax');
        
        if (displayTotalExclTax) {
            if (isForeignCurrency) {
                displayTotalExclTax.textContent = `${docCurrency} ${totalExclTaxOriginal.toFixed(2)} (${taxCurrency} ${totalExclTaxConverted.toFixed(2)})`;
                console.log('Updated displayTotalExclTax element with ID');
            } else {
                displayTotalExclTax.textContent = `${docCurrency} ${totalExclTaxOriginal.toFixed(2)}`;
            }
        }
        
        if (displayTaxAmount) {
            if (isForeignCurrency) {
                displayTaxAmount.textContent = `${docCurrency} ${totalTaxAmountOriginal.toFixed(2)} (${taxCurrency} ${totalTaxAmountConverted.toFixed(2)})`;
                console.log('Updated displayTaxAmount element with ID');
            } else {
                displayTaxAmount.textContent = `${docCurrency} ${totalTaxAmountOriginal.toFixed(2)}`;
            }
        }
        
        if (displayTotalInclTax) {
            if (isForeignCurrency) {
                displayTotalInclTax.textContent = `${docCurrency} ${totalInclTaxOriginal.toFixed(2)} (${taxCurrency} ${totalInclTaxConverted.toFixed(2)})`;
                console.log('Updated displayTotalInclTax element with ID');
            } else {
                displayTotalInclTax.textContent = `${docCurrency} ${totalInclTaxOriginal.toFixed(2)}`;
            }
        }
        
        // Try one more approach - find elements in the invoice-totals section
        const invoiceTotalsSection = document.querySelector('.invoice-totals');
        if (invoiceTotalsSection) {
            const totalItems = invoiceTotalsSection.querySelectorAll('.total-item .total-value');
            
            totalItems.forEach((item, index) => {
                // Based on the order in the screenshot, update each value
                if (index === 0) { // First is total excluding tax
                    if (isForeignCurrency) {
                        item.textContent = `${docCurrency} ${totalExclTaxOriginal.toFixed(2)} (${taxCurrency} ${totalExclTaxConverted.toFixed(2)})`;
                    } else {
                        item.textContent = `${docCurrency} ${totalExclTaxOriginal.toFixed(2)}`;
                    }
                } else if (index === 1) { // Second is tax amount
                    if (isForeignCurrency) {
                        item.textContent = `${docCurrency} ${totalTaxAmountOriginal.toFixed(2)} (${taxCurrency} ${totalTaxAmountConverted.toFixed(2)})`;
                    } else {
                        item.textContent = `${docCurrency} ${totalTaxAmountOriginal.toFixed(2)}`;
                    }
                } else if (index === 2) { // Third is total including tax
                    if (isForeignCurrency) {
                        item.textContent = `${docCurrency} ${totalInclTaxOriginal.toFixed(2)} (${taxCurrency} ${totalInclTaxConverted.toFixed(2)})`;
                    } else {
                        item.textContent = `${docCurrency} ${totalInclTaxOriginal.toFixed(2)}`;
                    }
                }
            });
            
            console.log('Updated total items within invoice-totals section');
        }
        
        // Finally - directly update the bottom summary display cells
        // This targets the exact blue boxes seen in the screenshot
        const blueBoxes = document.querySelectorAll('.card .card-body td[class*="total"]');
        if (blueBoxes.length > 0) {
            console.log(`Found ${blueBoxes.length} blue boxes to update`);
            blueBoxes.forEach(box => {
                const boxClass = box.className.toLowerCase();
                
                if (boxClass.includes('excluding')) {
                    if (isForeignCurrency) {
                        box.textContent = `${docCurrency} ${totalExclTaxOriginal.toFixed(2)} (${taxCurrency} ${totalExclTaxConverted.toFixed(2)})`;
                    } else {
                        box.textContent = `${docCurrency} ${totalExclTaxOriginal.toFixed(2)}`;
                    }
                } else if (boxClass.includes('tax-amount') || boxClass.includes('tax:')) {
                    if (isForeignCurrency) {
                        box.textContent = `${docCurrency} ${totalTaxAmountOriginal.toFixed(2)} (${taxCurrency} ${totalTaxAmountConverted.toFixed(2)})`;
                    } else {
                        box.textContent = `${docCurrency} ${totalTaxAmountOriginal.toFixed(2)}`;
                    }
                } else if (boxClass.includes('including')) {
                    if (isForeignCurrency) {
                        box.textContent = `${docCurrency} ${totalInclTaxOriginal.toFixed(2)} (${taxCurrency} ${totalInclTaxConverted.toFixed(2)})`;
                    } else {
                        box.textContent = `${docCurrency} ${totalInclTaxOriginal.toFixed(2)}`;
                    }
                }
            });
        }
    }
    
    /**
     * Get all line items from the form
     * @returns {Array} Array of line item objects
     */
    getLineItems() {
        const lineItemsBody = document.getElementById('lineItemsBody');
        const lineItems = [];
        
        if (!lineItemsBody) {
            console.error("Line items body not found");
            return lineItems;
        }
        
        const rows = lineItemsBody.children;
        console.log(`Getting ${rows.length} line items from form`);
        
        for (let i = 0; i < rows.length; i++) {
            const description = rows[i].querySelector('.item-description').value;
            const classification = rows[i].querySelector('.item-classification').value;
            const taxType = rows[i].querySelector('.item-tax-type').value;
            const amount = parseFloat(rows[i].querySelector('.item-amount').value) || 0;
            const tax = parseFloat(rows[i].querySelector('.item-tax').value) || 0;
            const total = parseFloat(rows[i].querySelector('.item-total').value) || 0;
            
            if (description && amount > 0) {
                lineItems.push({
                    line_number: i + 1,
                    description,
                    classification,
                    tax_type: taxType,
                    amount,
                    tax,
                    total
                });
                console.log(`Added line item #${i+1}: ${description}, ${classification}, ${amount}`);
            } else {
                console.warn(`Skipping invalid line item #${i+1}: description=${description}, amount=${amount}`);
            }
        }
        
        return lineItems;
    }

    /**
     * Generate a unique invoice number based on the current date
     * @returns {string} Format: CONS-YYYY-MM-XXX
     */
    generateInvoiceNumber() {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const random = Math.floor(Math.random() * 900) + 100; // Random 3-digit number
        return `CONS-${year}-${month}-${random}`;
    }

    /**
     * Synchronize data from line items to single form fields
     * Used when switching from multiple to single line item mode
     */
    syncLineItemsToSingleForm() {
        // Get the first line item
        const firstRow = document.querySelector('#lineItemsBody tr:first-child');
        if (!firstRow) return;
        
        // Get values from the first line item
        const descInput = firstRow.querySelector('.item-description');
        const classSelect = firstRow.querySelector('.item-classification');
        const taxTypeSelect = firstRow.querySelector('.item-tax-type');
        const amountInput = firstRow.querySelector('.item-amount');
        const taxInput = firstRow.querySelector('.item-tax');
        const totalInput = firstRow.querySelector('.item-total');
        
        // Get the single form fields
        const singleDescription = document.getElementById('singleDescription');
        const singleClassification = document.getElementById('singleClassification');
        const singleTaxType = document.getElementById('singleTaxType');
        const singleAmount = document.getElementById('singleAmount');
        const singleTotal = document.getElementById('singleTotal');
        
        // Transfer values
        if (descInput && singleDescription) singleDescription.value = descInput.value || '';
        if (classSelect && singleClassification) singleClassification.value = classSelect.value || 'G4';
        if (taxTypeSelect && singleTaxType) singleTaxType.value = taxTypeSelect.value || 'SST';
        if (amountInput && singleAmount) singleAmount.value = amountInput.value || '0.00';
        if (totalInput && singleTotal) singleTotal.value = totalInput.value || '0.00';
        
        // Calculate tax rate based on amount and total
        const amount = parseFloat(amountInput?.value || 0);
        const total = parseFloat(totalInput?.value || 0);
        let taxRate = 0;
        
        if (amount > 0 && total > amount) {
            taxRate = ((total - amount) / amount) * 100;
        }
        
        const singleTaxRate = document.getElementById('singleTaxRate');
        if (singleTaxRate) singleTaxRate.value = taxRate.toFixed(2);
        
        // Sync to hidden fields as well
        this.syncSingleLineItemToHiddenFields();
    }

    /**
     * Initialize tax configuration UI elements
     */
    initTaxConfigurationUI() {
        // Get global tax controls 
        const globalTaxType = document.getElementById('globalTaxType');
        const globalTaxRate = document.getElementById('globalTaxRate');
        const globalClassification = document.getElementById('globalClassification');
        
        if (!globalTaxType || !globalTaxRate || !globalClassification) {
            console.error('Global tax configuration UI elements not found');
            return;
        }
        
        console.log('Initializing global tax configuration UI elements');
        
        // Set default values if needed
        if (!globalTaxType.value) globalTaxType.value = '01';
        if (!globalTaxRate.value) globalTaxRate.value = '8';
        if (!globalClassification.value) globalClassification.value = '004';
        
        // Add validation message container right after globalClassification
        if (globalClassification.parentElement && !document.getElementById('classificationValidationMessage')) {
            const validationDiv = document.createElement('div');
            validationDiv.id = 'classificationValidationMessage';
            validationDiv.className = 'text-danger small mt-1';
            validationDiv.innerHTML = '<i class="bi bi-info-circle"></i> Only 004 - Consolidated e-Invoice is allowed for consolidated invoices per IRBM requirements.';
            validationDiv.style.display = 'none'; // Initially hidden
            globalClassification.parentElement.appendChild(validationDiv);
        }
        
        // Add event listeners with clear console logs for global controls
        globalTaxType.addEventListener('change', (e) => {
            console.log(`Global Tax type changed to: ${e.target.value}`);
            
            // Disable tax rate input if tax type is 06 (Not Applicable) or E (Tax exemption)
            if (e.target.value === '06' || e.target.value === 'E') {
                globalTaxRate.value = '0';
                globalTaxRate.disabled = true;
                this.showToast('Tax rate set to 0% for exempt tax type', 'info');
            } else {
                globalTaxRate.disabled = false;
            }
            
            // Apply to all line items
            this.applyTaxSettingsToLineItems();
            
            // Show confirmation toast
            const taxTypeText = globalTaxType.options[globalTaxType.selectedIndex].text;
            this.showToast(`Tax type updated to "${taxTypeText}" for all line items`, 'info');
        });
        
        globalTaxRate.addEventListener('input', (e) => {
            console.log(`Global Tax rate changed to: ${e.target.value}%`);
            this.applyTaxSettingsToLineItems();
            
            // Show confirmation toast after a small delay to avoid too many toasts
            clearTimeout(this._taxRateUpdateTimer);
            this._taxRateUpdateTimer = setTimeout(() => {
                this.showToast(`Tax rate updated to ${e.target.value}% for all line items`, 'info');
            }, 800);
        });
        
        globalClassification.addEventListener('change', (e) => {
            console.log(`Global Classification changed to: ${e.target.value}`);
            
            // Validate classification code - only 004 is allowed
            if (e.target.value !== '004') {
                // Show alert
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        title: 'Classification Restricted',
                        text: 'Only "004 - Consolidated e-Invoice" classification is allowed for consolidated invoices, as mandated by IRBM.',
                        icon: 'warning',
                        confirmButtonText: 'Understand',
                        confirmButtonColor: '#0a3d8a'
                    }).then(() => {
                        // Reset to 004
                        e.target.value = '004';
                        this.applyTaxSettingsToLineItems();
                    });
                } else {
                    // Fallback to regular alert
                    alert('Only "004 - Consolidated e-Invoice" classification is allowed for consolidated invoices, as mandated by IRBM.');
                    e.target.value = '004';
                    this.applyTaxSettingsToLineItems();
                }
                
                // Show validation message
                const validationMsg = document.getElementById('classificationValidationMessage');
                if (validationMsg) {
                    validationMsg.style.display = 'block';
                    
                    // Hide after 5 seconds
                    setTimeout(() => {
                        validationMsg.style.display = 'none';
                    }, 5000);
                }
            } else {
                // Hide validation message if present and selection is valid
                const validationMsg = document.getElementById('classificationValidationMessage');
                if (validationMsg) {
                    validationMsg.style.display = 'none';
                }
                
                // Apply to all line items
                this.applyTaxSettingsToLineItems();
                
                // Show confirmation toast
                const classText = globalClassification.options[globalClassification.selectedIndex].text;
                this.showToast(`Classification set to "${classText}" for all line items`, 'info');
            }
        });
    }
    
    /**
     * Apply tax settings to all line items
     */
    applyTaxSettingsToLineItems() {
        console.log('Applying tax settings to all line items');
        
        const globalTaxType = document.getElementById('globalTaxType');
        const globalTaxRate = document.getElementById('globalTaxRate');
        const globalClassification = document.getElementById('globalClassification');
        
        if (!globalTaxType || !globalTaxRate || !globalClassification) {
            console.error('Global tax configuration elements not found');
            return;
        }
        
        const tbody = document.getElementById('lineItemsBody');
        if (!tbody) {
            console.error('Line items table body not found');
            return;
        }
        
        const rows = tbody.querySelectorAll('tr:not(#emptyLineItems)');
        console.log(`Updating ${rows.length} line items with tax settings`);
        
        rows.forEach((row, index) => {
            // Update tax type
            const taxTypeSelect = row.querySelector('.item-tax-type');
            if (taxTypeSelect) {
                taxTypeSelect.value = globalTaxType.value;
                console.log(`Row ${index+1}: Tax type set to ${globalTaxType.value}`);
            }
            
            // Update classification - always force to 004
            const classSelect = row.querySelector('.item-classification');
            if (classSelect) {
                classSelect.value = '004';
                console.log(`Row ${index+1}: Classification set to 004`);
            }
            
            // Recalculate with new tax settings
            this.calculateLineItemTotals(row);
        });
        
        // Update grand totals
        this.updateGrandTotals();
    }

    /**
     * Handle currency changes and update the exchange rate visibility
     */
    handleCurrencyChange() {
        console.log('Currency changed, updating exchange rate');
        const globalCurrency = document.getElementById('globalCurrency');
        const globalExchangeRate = document.getElementById('globalExchangeRate');
        const foreignCurrencyToggle = document.getElementById('foreignCurrencyToggle');

        if (!globalCurrency || !globalExchangeRate) return;

        const selectedCurrency = globalCurrency.value;
        const baseCurrency = 'MYR';

        // Only fetch exchange rate if foreign currency mode is enabled and selected currency is not MYR
        if (foreignCurrencyToggle?.checked && selectedCurrency !== 'MYR') {
            this.showLoadingState('Fetching latest exchange rate...');

            // Fetch exchange rate from ExchangeRate-API
            fetch(`https://api.exchangerate-api.com/v4/latest/${selectedCurrency}`)
                .then(response => response.json())
                .then(data => {
                    if (data && data.rates && data.rates[baseCurrency]) {
                        const rate = data.rates[baseCurrency];
                        globalExchangeRate.value = rate.toFixed(4);
                        console.log(`Exchange rate fetched: 1 ${selectedCurrency} = ${rate.toFixed(4)} ${baseCurrency}`);
                        
                        // Show success message
                        this.showToast(`Exchange rate updated: 1 ${selectedCurrency} = ${rate.toFixed(4)} ${baseCurrency}`, 'success');
                        
                        // Recalculate all line items with new rate
                        this.forceSyncAllLineItems();
        } else {
                        console.error('Invalid exchange rate data received');
                        this.showToast('Could not fetch exchange rate. Using default rate.', 'error');
                    }
                })
                .catch(error => {
                    console.error('Error fetching exchange rate:', error);
                    this.showToast('Failed to fetch exchange rate. Using default rate.', 'error');
                })
                .finally(() => {
                    this.hideLoadingState();
                });
        } else {
            // Reset to 1:1 for MYR or when foreign currency is disabled
            globalExchangeRate.value = '1.0000';
        this.forceSyncAllLineItems();
        }
    }

    /**
     * Handle foreign currency toggle changes
     */
    handleForeignCurrencyToggle() {
        const foreignCurrencyToggle = document.getElementById('foreignCurrencyToggle');
        const currencySettings = document.getElementById('currencySettings');
        const documentCurrencySelect = document.getElementById('globalCurrency');
        const exchangeRateInput = document.getElementById('globalExchangeRate');
        const taxCurrencySelect = document.getElementById('globalTaxCurrency');

        if (!foreignCurrencyToggle) return;

        // Initial state setup
        const updateCurrencyUI = (isForeignEnabled) => {
            // Show/hide currency settings card
            if (currencySettings) {
                if (isForeignEnabled) {
                    currencySettings.classList.remove('d-none');
                    currencySettings.style.opacity = '1';
                } else {
                    currencySettings.classList.add('d-none');
                }
            }

            // Update document currency dropdown
            if (documentCurrencySelect) {
                if (isForeignEnabled) {
                    documentCurrencySelect.disabled = false;
                    // Reset to first non-MYR currency if currently MYR
                    if (documentCurrencySelect.value === 'MYR') {
                        const firstNonMYR = Array.from(documentCurrencySelect.options)
                            .find(option => option.value !== 'MYR');
                        if (firstNonMYR) {
                            documentCurrencySelect.value = firstNonMYR.value;
                        }
                    }
                } else {
                    documentCurrencySelect.value = 'MYR';
                    documentCurrencySelect.disabled = true;
                }
            }

            // Update exchange rate input
            if (exchangeRateInput) {
                exchangeRateInput.disabled = !isForeignEnabled;
                exchangeRateInput.value = isForeignEnabled ? '1.0000' : '1.0000';
            }

            // Update tax currency (always MYR, but show/hide based on mode)
            if (taxCurrencySelect) {
                taxCurrencySelect.value = 'MYR';
                taxCurrencySelect.disabled = true;
            }

            // Update all line items currency dropdowns
            this.updateLineItemsCurrency(isForeignEnabled);
        };

        // Handle toggle change
        foreignCurrencyToggle.addEventListener('change', (e) => {
            const isForeignEnabled = e.target.checked;
            updateCurrencyUI(isForeignEnabled);
            
            // Force sync all line items to update calculations
            this.forceSyncAllLineItems();
            
            // Show toast message
            this.showToast(
                isForeignEnabled ? 
                'Foreign currency mode enabled. You can now enter amounts in other currencies.' : 
                'Foreign currency mode disabled. All amounts will be in MYR.',
                isForeignEnabled ? 'info' : 'warning'
            );
        });

        // Initial state
        updateCurrencyUI(foreignCurrencyToggle.checked);
    }

    updateLineItemsCurrency(isForeignEnabled) {
        const lineItems = document.querySelectorAll('#lineItemsBody tr');
        lineItems.forEach(row => {
            const currencyCell = row.querySelector('.item-currency');
            if (currencyCell) {
                if (isForeignEnabled) {
                    currencyCell.disabled = false;
                    currencyCell.value = document.getElementById('globalCurrency')?.value || 'MYR';
                } else {
                    currencyCell.value = 'MYR';
                    currencyCell.disabled = true;
                }
            }
        });
    }

    handleCurrencyChange() {
        const documentCurrencySelect = document.getElementById('globalCurrency');
        const exchangeRateInput = document.getElementById('globalExchangeRate');
        
        if (!documentCurrencySelect) return;

        // Update all line items with the new currency
        const lineItems = document.querySelectorAll('#lineItemsBody tr');
        lineItems.forEach(row => {
            const currencyCell = row.querySelector('.item-currency');
            if (currencyCell) {
                currencyCell.value = documentCurrencySelect.value;
            }
        });

        // Fetch and update exchange rate if needed
        if (exchangeRateInput && documentCurrencySelect.value !== 'MYR') {
            this.fetchExchangeRate(documentCurrencySelect.value)
                .then(rate => {
                    exchangeRateInput.value = rate.toFixed(4);
                    this.forceSyncAllLineItems();
                })
                .catch(() => {
                    this.showToast('Failed to fetch exchange rate. Using default rate of 1.0000', 'warning');
                    exchangeRateInput.value = '1.0000';
                    this.forceSyncAllLineItems();
                });
        }
    }

    async fetchExchangeRate(currency) {
        try {
            // Using free exchangerate-api.com API
            const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${currency}`);
            if (!response.ok) throw new Error('Failed to fetch exchange rate');
            const data = await response.json();
            
            // Get the MYR rate
            const rate = data.rates['MYR'];
            if (!rate) throw new Error('MYR rate not found');
            
            console.log(`Exchange rate fetched: 1 ${currency} = ${rate} MYR`);
            return rate;
        } catch (error) {
            console.error('Error fetching exchange rate:', error);
            return 1.0000;
        }
    }

    updateGrandTotals() {
        // Get all line items
        const rows = document.querySelectorAll('#lineItemsBody tr:not(#emptyLineItems)');
        
        // Get currency information
        const globalCurrency = document.getElementById('globalCurrency');
        const globalExchangeRate = document.getElementById('globalExchangeRate');
        const foreignCurrencyToggle = document.getElementById('foreignCurrencyToggle');
        const globalTaxType = document.getElementById('globalTaxType');
        
        const docCurrency = globalCurrency?.value || 'MYR';
        const exchangeRate = parseFloat(globalExchangeRate?.value || '1');
        const isForeignEnabled = foreignCurrencyToggle?.checked && docCurrency !== 'MYR';
        const isExemptTax = globalTaxType?.value === '06' || globalTaxType?.value === 'E';
        
        // Initialize totals
        let totalExclTax = 0;
        let totalTaxAmount = 0;
        let totalInclTax = 0;
        let totalExclTaxMYR = 0;
        let totalTaxAmountMYR = 0;
        let totalInclTaxMYR = 0;
        
        // Calculate totals from all rows
        rows.forEach(row => {
            const amountInput = row.querySelector('.item-amount');
            const taxTypeSelect = row.querySelector('.item-tax-type');
            
            if (amountInput && taxTypeSelect) {
                const amount = parseFloat(amountInput.value.replace(/,/g, '')) || 0;
                const isRowExempt = taxTypeSelect.value === '06' || taxTypeSelect.value === 'E';
                
                totalExclTax += amount;
                
                if (isForeignEnabled) {
                    const amountInMYR = amount * exchangeRate;
                    totalExclTaxMYR += amountInMYR;
                    
                    if (!isRowExempt && !isExemptTax) {
                        // Calculate tax in MYR (8% of MYR amount)
                        const taxInMYR = amountInMYR * 0.08;
                        totalTaxAmountMYR += taxInMYR;
                        
                        // Convert tax back to document currency
                        const taxInDocCurrency = taxInMYR / exchangeRate;
                        totalTaxAmount += taxInDocCurrency;
                    }
                } else {
                    totalExclTaxMYR = totalExclTax;
                    if (!isRowExempt && !isExemptTax) {
                        const tax = amount * 0.08;
                        totalTaxAmount += tax;
                        totalTaxAmountMYR += tax;
                    }
                }
            }
        });
        
        // For exempt tax types, total including tax should equal total excluding tax
        if (isExemptTax) {
            totalInclTax = totalExclTax;
            totalInclTaxMYR = totalExclTaxMYR;
            totalTaxAmount = 0;
            totalTaxAmountMYR = 0;
        } else {
            totalInclTax = totalExclTax + totalTaxAmount;
            totalInclTaxMYR = totalExclTaxMYR + totalTaxAmountMYR;
        }

        // Format numbers for display
        const formatAmount = (num) => {
            return parseFloat(num).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        };

        // Update displays
        const updateDisplay = (element, docAmount, myrAmount, isTaxAmount = false) => {
            if (!element) return;
            
            if (isForeignEnabled) {
                if (isTaxAmount) {
                    if (isExemptTax) {
                        element.innerHTML = `
                            <div>Tax Exempt</div>
                            <small class="text-muted">(No tax applicable)</small>
                        `;
                    } else {
                        element.innerHTML = `
                            <div>MYR ${formatAmount(myrAmount)}</div>
                            <small class="text-muted">(Tax is always calculated in MYR)</small>
                        `;
                    }
                } else {
                    element.innerHTML = `
                        <div>${docCurrency} ${formatAmount(docAmount)}</div>
                        <div class="text-muted small">MYR ${formatAmount(myrAmount)}</div>
                    `;
                }
            } else {
                if (isTaxAmount && isExemptTax) {
                    element.innerHTML = `Tax Exempt`;
                } else {
                    element.innerHTML = `MYR ${formatAmount(docAmount)}`;
                }
            }
        };

        // Update all display elements
        const displayElements = {
            totalExclTax: document.getElementById('displayTotalExclTax'),
            taxAmount: document.getElementById('displayTaxAmount'),
            totalInclTax: document.getElementById('displayTotalInclTax')
        };

        updateDisplay(displayElements.totalExclTax, totalExclTax, totalExclTaxMYR);
        updateDisplay(displayElements.taxAmount, totalTaxAmount, totalTaxAmountMYR, true);
        updateDisplay(displayElements.totalInclTax, totalInclTax, totalInclTaxMYR);

        // Update summary boxes
        const summaryBoxes = {
            totalExclTax: document.querySelector('.total-excluding-tax'),
            taxAmount: document.querySelector('.total-tax-amount'),
            totalInclTax: document.querySelector('.total-including-tax')
        };

        if (summaryBoxes.totalExclTax) {
            summaryBoxes.totalExclTax.innerHTML = isForeignEnabled ?
                `${docCurrency} ${formatAmount(totalExclTax)}<br><small class="text-muted">MYR ${formatAmount(totalExclTaxMYR)}</small>` :
                `MYR ${formatAmount(totalExclTax)}`;
        }

        if (summaryBoxes.taxAmount) {
            if (isExemptTax) {
                summaryBoxes.taxAmount.innerHTML = `Tax Exempt<br><small class="text-muted">(No tax applicable)</small>`;
            } else {
                summaryBoxes.taxAmount.innerHTML = isForeignEnabled ?
                    `MYR ${formatAmount(totalTaxAmountMYR)}<br><small class="text-muted">(Tax in local currency)</small>` :
                    `MYR ${formatAmount(totalTaxAmount)}`;
            }
        }

        if (summaryBoxes.totalInclTax) {
            summaryBoxes.totalInclTax.innerHTML = isForeignEnabled ?
                `${docCurrency} ${formatAmount(totalInclTax)}<br><small class="text-muted">MYR ${formatAmount(totalInclTaxMYR)}</small>` :
                `MYR ${formatAmount(totalInclTax)}`;
        }
    }

    /**
     * Export the current consolidation data to Excel template
     */
    async exportToExcel() {
        try {
            // Show loading state
            this.showLoadingState('Generating Excel template...');

            // Get all line items
            const lineItems = [];
            const rows = document.querySelectorAll('#lineItemsBody tr:not(#emptyLineItems)');
            
            rows.forEach(row => {
                const description = row.querySelector('.item-description')?.value || '';
                const classification = row.querySelector('.item-classification')?.value || '';
                const taxType = row.querySelector('.item-tax-type')?.value || '';
                const amount = row.querySelector('.item-amount')?.value || '0';
                const taxAmount = row.querySelector('.item-tax-amount')?.value || '0';
                const totalAmount = row.querySelector('.item-total-amount')?.value || '0';

                lineItems.push({
                    description,
                    classification,
                    taxType,
                    amount: amount.replace(/,/g, ''),
                    taxAmount: taxAmount.replace(/,/g, ''),
                    totalAmount: totalAmount.replace(/,/g, '')
                });
            });

            // Get form data
            const formData = {
                invoice_details: {
                    invoice_no: document.getElementById('manualInvoiceNo').value,
                    start_date: document.getElementById('manualStartDate').value,
                    end_date: document.getElementById('manualEndDate').value,
                    description: document.querySelector('.item-description')?.value || ''
                },
                tax_info: {
                    tax_type: document.getElementById('globalTaxType').value,
                    tax_rate: document.getElementById('globalTaxRate').value,
                    classification: '004 - Consolidated e-Invoice'
                },
                currency_info: {
                    is_foreign_enabled: document.getElementById('foreignCurrencyToggle').checked,
                    currency: document.getElementById('globalCurrency')?.value || 'MYR',
                    exchange_rate: document.getElementById('globalExchangeRate')?.value || '1.0000'
                },
                totals: {
                    total_excl_tax: document.querySelector('#displayTotalExclTax').textContent.replace(/[^0-9.]/g, ''),
                    tax_amount: document.querySelector('#displayTaxAmount').textContent.replace(/[^0-9.]/g, ''),
                    total_incl_tax: document.querySelector('#displayTotalInclTax').textContent.replace(/[^0-9.]/g, '')
                },
                line_items: lineItems,
                supplier_info: this.currentCompanySettings || {}
            };

            console.log('Sending export request with data:', formData);

            // Send request to generate Excel
            const response = await fetch('/api/consolidation/export-template', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                },
                body: JSON.stringify(formData)
            });

            if (!response.ok) {
                throw new Error('Failed to generate Excel template');
            }

            // Get the blob from response
            const blob = await response.blob();
            
            // Create a download link
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `consolidated_invoice_${formData.invoice_details.invoice_no}.xlsx`;
            document.body.appendChild(a);
            a.click();
            
            // Cleanup
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            // Hide loading state and show success message
            this.hideLoadingState();
            this.showToast('Excel template generated successfully!', 'success');

        } catch (error) {
            console.error('Error generating Excel template:', error);
            this.hideLoadingState();
            this.showToast('Error generating Excel template: ' + error.message, 'error');
        }
    }
}

// Initialize the consolidation manager on page load
document.addEventListener('DOMContentLoaded', () => {
    window.consolidationManager = new ConsolidationManager();
}); 