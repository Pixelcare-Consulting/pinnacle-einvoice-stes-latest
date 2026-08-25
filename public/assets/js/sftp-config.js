document.addEventListener('DOMContentLoaded', function() {
    console.log('SFTP Manager initializing...');

    // Initialize elements
    const fileList = document.getElementById('fileList');
    const upButton = document.getElementById('upButton');
    const refreshButton = document.getElementById('refreshButton');
    const currentPath = document.getElementById('currentPath');
    const sftpConfigForm = document.getElementById('sftpConfigForm');
    const testConnectionBtn = document.getElementById('testConnection');
    const saveBtn = document.querySelector('button[form="sftpConfigForm"]');

    // Add a variable to track connection status
    let isConnectionTested = false;

    // Initialize event listeners only if elements exist
    if (sftpConfigForm && saveBtn) {
        sftpConfigForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            if (!isConnectionTested) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Test Required',
                    text: 'Please test the connection before saving the configuration.',
                    confirmButtonText: 'Okay'
                });
                return;
            }

            const originalText = saveBtn.innerHTML;
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="bi bi-arrow-repeat spin me-2"></i>Saving...';
            
            try {
                // Show saving progress
                Swal.fire({
                    title: 'Saving Configuration',
                    html: `
                        <div class="save-progress">
                            <div class="step mb-3">
                                <i class="bi bi-arrow-repeat spin me-2"></i>
                                <span>Initializing save process...</span>
                            </div>
                        </div>
                    `,
                    showConfirmButton: false,
                    allowOutsideClick: false,
                    didOpen: () => {
                        const content = Swal.getHtmlContainer();
                        const progressDiv = content.querySelector('.save-progress');
                        
                        setTimeout(() => {
                            progressDiv.innerHTML += `
                                <div class="step mb-3 fade-in">
                                    <i class="bi bi-database-add text-primary me-2"></i>
                                    <span>Saving SFTP configuration...</span>
                                </div>
                            `;
                        }, 1000);

                        setTimeout(() => {
                            progressDiv.innerHTML += `
                                <div class="step mb-3 fade-in">
                                    <i class="bi bi-folder-plus text-primary me-2"></i>
                                    <span>Creating directory structure...</span>
                                </div>
                            `;
                        }, 2000);
                    }
                });

                const formData = {
                    host: document.getElementById('sftpHost').value,
                    port: document.getElementById('sftpPort').value,
                    username: document.getElementById('sftpUsername').value,
                    password: document.getElementById('sftpPassword').value,
                    root_path: '/',
                    templates: {
                        incoming_manual: '/Incoming/Manual/{company}/{date}/[Inbound|Outbound]',
                        incoming_schedule: '/Incoming/Schedule/{company}/{date}/[Inbound|Outbound]',
                        outgoing_manual: '/Outgoing/Manual/{company}/{date}/[Inbound|Outbound]',
                        outgoing_schedule: '/Outgoing/Schedule/{company}/{date}/[Inbound|Outbound]'
                    }
                };

                await new Promise(resolve => setTimeout(resolve, 2500));

                const response = await fetch('/api/sftp/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });

                const data = await response.json();

                if (response.ok) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Success',
                        text: 'SFTP Configuration saved successfully!'
                    });

                    // Close modal and refresh
                    const modal = bootstrap.Modal.getInstance(document.getElementById('sftpConfigModal'));
                    if (modal) {
                        modal.hide();
                    }
                    
                    // Refresh the file list
                    loadDirectory('/');
                    
                    // Reset connection test status
                    isConnectionTested = false;
                } else {
                    throw new Error(data.error || 'Failed to save configuration');
                }
            } catch (error) {
                console.error('Failed to save SFTP config:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: error.message || 'Failed to save configuration'
                });
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalText;
            }
        });
    }

    // Add this after the form submit handler but before the other event listeners
    if (testConnectionBtn) {
        testConnectionBtn.addEventListener('click', async function() {
            const btn = this;
            const originalText = btn.innerHTML;
            btn.disabled = true;
            const saveBtn = document.querySelector('button[form="sftpConfigForm"]');
            saveBtn.disabled = true;  // Initially disable save button

            try {
                const credentials = {
                    host: document.getElementById('sftpHost').value,
                    port: document.getElementById('sftpPort').value,
                    username: document.getElementById('sftpUsername').value,
                    password: document.getElementById('sftpPassword').value
                };

                // Show detailed loading states
                Swal.fire({
                    title: 'Testing Connection',
                    html: `
                        <div class="connection-test-status">
                            <div class="step mb-3">
                                <i class="bi bi-arrow-repeat spin me-2"></i>
                                <span>Initializing connection...</span>
                            </div>
                        </div>
                    `,
                    showConfirmButton: false,
                    allowOutsideClick: false,
                    didOpen: () => {
                        const content = Swal.getHtmlContainer();
                        const statusDiv = content.querySelector('.connection-test-status');
                        
                        // Step 1: Verifying credentials (after 1.5s)
                        setTimeout(() => {
                            const step1 = document.createElement('div');
                            step1.className = 'step mb-3 fade-in';
                            step1.innerHTML = `
                                <i class="bi bi-shield-check text-primary me-2"></i>
                                <span>Verifying credentials...</span>
                            `;
                            statusDiv.appendChild(step1);
                        }, 1500);

                        // Step 2: Checking directory access (after 3s)
                        setTimeout(() => {
                            const step2 = document.createElement('div');
                            step2.className = 'step mb-3 fade-in';
                            step2.innerHTML = `
                                <i class="bi bi-folder-check text-primary me-2"></i>
                                <span>Checking directory access...</span>
                            `;
                            statusDiv.appendChild(step2);
                        }, 3000);

                        // Step 3: Validating permissions (after 4.5s)
                        setTimeout(() => {
                            const step3 = document.createElement('div');
                            step3.className = 'step mb-3 fade-in';
                            step3.innerHTML = `
                                <i class="bi bi-key text-primary me-2"></i>
                                <span>Validating permissions...</span>
                            `;
                            statusDiv.appendChild(step3);
                        }, 4500);
                    }
                });

                const response = await fetch('/api/sftp/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(credentials)
                });

                await new Promise(resolve => setTimeout(resolve, 5000));
                const data = await response.json();

                if (response.ok) {
                    isConnectionTested = true;
                    saveBtn.disabled = false;  // Enable save button on success
                    
                    Swal.fire({
                        icon: 'success',
                        title: 'Connection Successful',
                        html: `
                            <div class="text-success mb-3">
                                <i class="bi bi-check-circle-fill me-2"></i>
                                All checks passed successfully!
                            </div>
                            <div class="connection-details text-start small">
                                <div class="mb-2">
                                    <i class="bi bi-check2 text-success me-2"></i>
                                    Connection established
                                </div>
                                <div class="mb-2">
                                    <i class="bi bi-check2 text-success me-2"></i>
                                    Credentials verified
                                </div>
                                <div class="mb-2">
                                    <i class="bi bi-check2 text-success me-2"></i>
                                    Directory access confirmed
                                </div>
                                <div>
                                    <i class="bi bi-check2 text-success me-2"></i>
                                    Permissions validated
                                </div>
                            </div>
                            <div class="mt-3 text-muted">
                                <small>You can now save the configuration.</small>
                            </div>
                        `,
                        confirmButtonText: 'Continue'
                    });
                } else {
                    throw new Error(data.error || 'Connection test failed');
                }
            } catch (error) {
                console.error('Connection test failed:', error);
                isConnectionTested = false;
                saveBtn.disabled = true;  // Keep save button disabled on error
                
                Swal.fire({
                    icon: 'error',
                    title: 'Connection Failed',
                    html: `
                        <div class="text-danger mb-3">
                            <i class="bi bi-x-circle-fill me-2"></i>
                            ${error.message || 'SFTP Connection test failed'}
                        </div>
                        <div class="connection-error text-start small">
                            <div class="mb-2">
                                <i class="bi bi-x text-danger me-2"></i>
                                Unable to establish connection
                            </div>
                            <div>
                                <i class="bi bi-info-circle text-warning me-2"></i>
                                Please check your credentials and try again
                            </div>
                        </div>
                    `
                });
            } finally {
                btn.disabled = false;  // Re-enable test button
                btn.innerHTML = originalText;
            }
        });
    }

    // Initialize other event listeners
    if (upButton) {
        upButton.addEventListener('click', () => {
            const path = currentPath.textContent;
            if (path === '/') return;
            const parentPath = getParentPath(path);
            loadDirectory(parentPath);
        });
    }

    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            const path = currentPath.textContent;
            loadDirectory(path);
        });
    }

    // Load initial directory
    if (fileList && currentPath) {
        loadDirectory('/');
    }

    // Add this after your DOMContentLoaded event
    async function loadSavedConfigurations() {
        try {
            const response = await fetch('/api/sftp/configs');
            if (!response.ok) throw new Error('Failed to fetch configurations');
            
            const data = await response.json();
            const configsList = document.getElementById('sftpConfigsList');
            
            if (!configsList) {
                console.error('Config list element not found');
                return;
            }

            configsList.innerHTML = '';

            if (data.success && data.configs?.length > 0) {
                data.configs.forEach(config => {
                    const configItem = document.createElement('div');
                    configItem.className = 'list-group-item list-group-item-action';
                    configItem.style.backgroundColor = '#f0f7ff'; // Light blue background
                    configItem.style.border = '1px solid #e3f2fd';
                    configItem.style.marginBottom = '8px';
                    configItem.style.borderRadius = '8px';
                    
                    configItem.innerHTML = `
                        <div class="d-flex w-100 justify-content-between align-items-center">
                            <div>
                                <h6 class="mb-1 text-primary">${config.host}</h6>
                                <small class="text-muted">Username: ${config.username}</small>
                            </div>
                            <div class="btn-group">
                                ${config.is_active ? 
                                    '<span class="badge bg-success">Active</span>' :
                                    '<button class="btn btn-sm btn-outline-primary activate-btn">Activate</button>'
                                }
                                <button class="btn btn-sm btn-outline-danger delete-btn ms-2">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </div>
                        </div>
                    `;

                    // Add event listeners
                    if (!config.is_active) {
                        const activateBtn = configItem.querySelector('.activate-btn');
                        activateBtn?.addEventListener('click', () => activateConfiguration(config.id));
                    }

                    const deleteBtn = configItem.querySelector('.delete-btn');
                    deleteBtn?.addEventListener('click', () => deleteConfiguration(config.id));

                    configsList.appendChild(configItem);
                });
            } else {
                configsList.innerHTML = `
                    <div class="alert alert-info" style="background-color: #f0f7ff; border-color: #e3f2fd;">
                        <i class="bi bi-info-circle me-2"></i>
                        No saved configurations
                    </div>
                `;
            }
        } catch (error) {
            console.error('Error loading configurations:', error);
            configsList.innerHTML = `
                <div class="alert alert-danger">
                    <i class="bi bi-exclamation-circle me-2"></i>
                    Failed to load configurations
                </div>
            `;
        }
    }

    async function activateConfiguration(configId) {
        try {
            const response = await fetch(`/api/sftp/config/${configId}/activate`, {
                method: 'POST'
            });
            const data = await response.json();

            if (response.ok) {
                await loadSavedConfigurations();
                Swal.fire({
                    icon: 'success',
                    title: 'Success',
                    text: 'Configuration activated successfully'
                });
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            console.error('Error activating configuration:', error);
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to activate configuration'
            });
        }
    }

    async function deleteConfiguration(configId) {
        try {
            const result = await Swal.fire({
                icon: 'warning',
                title: 'Delete Configuration?',
                text: 'This action cannot be undone',
                showCancelButton: true,
                confirmButtonText: 'Delete',
                cancelButtonText: 'Cancel',
                confirmButtonColor: '#dc3545'
            });

            if (result.isConfirmed) {
                const response = await fetch(`/api/sftp/config/${configId}`, {
                    method: 'DELETE'
                });
                const data = await response.json();

                if (response.ok) {
                    await loadSavedConfigurations();
                    Swal.fire({
                        icon: 'success',
                        title: 'Success',
                        text: 'Configuration deleted successfully'
                    });
                } else {
                    throw new Error(data.error);
                }
            }
        } catch (error) {
            console.error('Error deleting configuration:', error);
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to delete configuration'
            });
        }
    }

    function populateConfigForm(config) {
        document.getElementById('sftpHost').value = config.host;
        document.getElementById('sftpPort').value = config.port;
        document.getElementById('sftpUsername').value = config.username;
        document.getElementById('rootPath').value = config.root_path;
        
        // Show active badge
        const activeConfigBadge = document.getElementById('activeConfigBadge');
        if (activeConfigBadge) {
            activeConfigBadge.style.display = 'inline-block';
        }
    }

    // Call this when the modal is shown
    document.getElementById('sftpConfigModal').addEventListener('show.bs.modal', function () {
        loadSavedConfigurations();
    });
});

// Helper Functions
async function loadSftpConfig() {
    try {
        const response = await fetch('/api/sftp/config');
        if (response.ok) {
            const config = await response.json();
            if (config && Object.keys(config).length > 0) {
                document.getElementById('sftpHost').value = config.host || '';
                document.getElementById('sftpPort').value = config.port || '22';
                document.getElementById('sftpUsername').value = config.username || '';
                document.getElementById('rootPath').value = config.root_path || '/SFTP_DATA';
            }
        }
    } catch (error) {
        console.error('Failed to load SFTP configuration:', error);
    }
}

async function loadDirectory(path) {
    // Show loading state
    const fileList = document.getElementById('fileList');
    if (!fileList) {
        console.error('fileList element not found');
        return;
    }

    fileList.innerHTML = `
        <tr>
            <td colspan="4" class="text-center py-5">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <div class="mt-2 text-muted">Loading directory contents...</div>
            </td>
        </tr>
    `;

    try {
        console.log('Loading directory:', path);
        const response = await fetch(`/api/sftp/list?path=${encodeURIComponent(path)}`);
        const data = await response.json();
        console.log('Directory data:', data);

        fileList.innerHTML = '';

        // Add parent directory if not in root
        if (path !== '/') {
            const parentRow = document.createElement('tr');
            parentRow.className = 'file-row';
            parentRow.innerHTML = `
                <td><i class="bi bi-arrow-up"></i></td>
                <td colspan="3">..</td>
            `;
            parentRow.addEventListener('click', () => {
                const parentPath = getParentPath(path);
                console.log('Going to parent:', parentPath);
                loadDirectory(parentPath);
            });
            fileList.appendChild(parentRow);
        }

        if (!data.structure || data.structure.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = `
                <td colspan="4" class="text-center text-muted py-4">
                    <i class="bi bi-folder-x fs-2 d-block mb-2"></i>
                    <div>This folder is empty</div>
                </td>
            `;
            fileList.appendChild(emptyRow);
            return;
        }

        // Sort: directories first, then files
        const items = data.structure.sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === 'directory' ? -1 : 1;
        });

        items.forEach(item => {
            const row = document.createElement('tr');
            row.className = 'file-row';
            
            const isDirectory = item.type === 'directory';
            row.innerHTML = `
                <td width="40">
                    <i class="bi ${isDirectory ? 'bi-folder-fill text-warning' : 'bi-file-text text-secondary'}"></i>
                </td>
                <td>${item.name}</td>
                <td class="text-end" width="120">${isDirectory ? '' : formatFileSize(item.size)}</td>
                <td width="180">${formatDate(item.modifyTime)}</td>
            `;

            if (isDirectory) {
                row.style.cursor = 'pointer';
                row.addEventListener('click', () => {
                    const newPath = `${path}/${item.name}`.replace(/\/+/g, '/');
                    console.log('Navigating to:', newPath);
                    loadDirectory(newPath);
                });
            }

            fileList.appendChild(row);
        });

        // Update current path display
        const currentPathElement = document.getElementById('currentPath');
        if (currentPathElement) {
            currentPathElement.textContent = path;
        }

    } catch (error) {
        console.error('Error loading directory:', error);
        fileList.innerHTML = `
            <tr>
                <td colspan="4" class="text-center text-danger py-4">
                    <i class="bi bi-exclamation-circle fs-2 d-block mb-2"></i>
                    <div>Failed to load directory contents</div>
                    <small class="text-muted">${error.message}</small>
                </td>
            </tr>
        `;
    }
}

function getParentPath(path) {
    const parts = path.replace(/^\/SFTP_DATA/, '').split('/').filter(Boolean);
    return parts.length > 0 ? '/' + parts.slice(0, -1).join('/') : '/';
}

function formatFileSize(bytes) {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Add some CSS for better styling
const style = document.createElement('style');
style.textContent = `
.directory-templates .alert-info {
        background-color: #f0f7ff !important;
        border-color: #e3f2fd !important;
        color: #333 !important;
    }

    .list-group-item:hover {
        background-color: #e3f2fd !important;
        transition: background-color 0.2s;
    }

    .badge.bg-success {
        font-size: 0.8em;
        padding: 0.4em 0.8em;
    }

    .btn-group .btn {
        padding: 0.25rem 0.5rem;
        font-size: 0.875rem;
    }
    .file-row {
        user-select: none;
    }
    .file-row:hover {
        background-color: #f8f9fa;
    }
    .file-row td {
        padding: 8px;
        vertical-align: middle;
    }
    .file-row i {
        font-size: 1.1em;
    }
    .text-warning {
        color: #ffc107 !important;
    }
    .text-secondary {
        color: #6c757d !important;
    }
    .spin {
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        100% { transform: rotate(360deg); }
    }
    .connection-test-status div,
    .save-progress div {
        opacity: 0;
        animation: fadeIn 0.5s forwards;
    }
    @keyframes fadeIn {
        to { opacity: 1; }
    }
`;
document.head.appendChild(style);

// Add these styles
const additionalStyles = `
    .connection-test-status .step {
        opacity: 0;
        transform: translateY(10px);
        animation: slideIn 0.5s ease forwards;
    }

    .connection-details, .connection-error {
        background: #f8f9fa;
        padding: 1rem;
        border-radius: 6px;
        margin: 1rem 0;
    }

    @keyframes slideIn {
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .fade-in {
        opacity: 0;
        animation: fadeIn 0.5s ease forwards;
    }

    @keyframes fadeIn {
        to { opacity: 1; }
    }

    .spin {
        display: inline-block;
        animation: spin 1.5s linear infinite;
    }

    @keyframes spin {
        100% { transform: rotate(360deg); }
    }
`;

// Append the new styles
const styleElement = document.createElement('style');
styleElement.textContent = additionalStyles;
document.head.appendChild(styleElement);