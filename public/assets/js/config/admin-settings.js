let originalFormData = null;
let hasUnsavedChanges = false;
let savedLHDNConfig = null;

// Add validation state tracking
let isValidated = false;

// Add token refresh state tracking
let tokenRefreshInterval = null;

async function loadSAPConfig() {
    try {
        console.log('Fetching SAP config...');
        const response = await fetch('/api/config/sap/get-config');
        console.log('Response status:', response.status);
        
        if (response.status === 401) {
            console.log('User not authenticated, redirecting to login');
            window.location.href = '/login';
            return;
        }
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // Log response headers
        console.log('Response headers:', Object.fromEntries([...response.headers]));
        const contentType = response.headers.get("content-type");
        console.log('Content-Type:', contentType);
        
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error("Response was not JSON");
        }
        
        // Get response text first for debugging
        const text = await response.text();
        console.log('Response text:', text);
        
        // Try to parse JSON
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error('JSON parse error:', e);
            throw new Error('Invalid JSON response from server');
        }
        
        console.log('Parsed data:', data);
        
        if (data.success && data.settings) {
            // Parse the settings string into an object
            let settings;
            try {
                settings = typeof data.settings === 'string' ? JSON.parse(data.settings) : data.settings;
                console.log('Parsed settings:', settings);
            } catch (e) {
                console.error('Settings parse error:', e);
                throw new Error('Invalid settings format');
            }
            
            // Populate form fields
            document.getElementById('networkPath').value = settings.networkPath || '';
            document.getElementById('serverName').value = settings.domain || '';
            document.getElementById('serverUsername').value = settings.username || '';
            // Don't populate password for security reasons
            
           
        } else if (!data.success) {
            throw new Error(data.error || 'Failed to load configuration');
        }
    } catch (error) {
        console.error('Error loading SAP config:', error);
        
        // Don't show error toast if redirecting to login
        if (error.message !== 'User not authenticated') {
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: error.message || 'Failed to load SAP configuration',
                timer: 3000,
                timerProgressBar: true,
                showConfirmButton: false,
                position: 'top-end',
                toast: true
            });
        }
    }
}

async function saveSAPConfig() {
    try {
        // Show loading state
        Swal.fire({
            title: 'Saving Configuration',
            text: 'Please wait while we save your configuration...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            allowEnterKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        // Get form values for both SAP and outgoing paths
        const sapConfig = {
            networkPath: document.getElementById('networkPath').value,
            domain: document.getElementById('serverName').value,
            username: document.getElementById('serverUsername').value,
            password: document.getElementById('serverPassword').value
        };

        const outgoingConfig = {
            networkPath: document.getElementById('outgoingPath').value,
            domain: document.getElementById('serverName').value, // Use same server credentials
            username: document.getElementById('serverUsername').value,
            password: document.getElementById('serverPassword').value
        };

        // Validate required fields
        if (!sapConfig.networkPath || !outgoingConfig.networkPath) {
            throw new Error('Both network paths are required');
        }

        if (!sapConfig.username || !sapConfig.password) {
            throw new Error('Username and password are required');
        }

        // Save both configurations
        const [sapResponse, outgoingResponse] = await Promise.all([
            fetch('/api/config/sap/save-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(sapConfig)
            }),
            fetch('/api/config/outgoing/save-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(outgoingConfig)
            })
        ]);

        if (!sapResponse.ok || !outgoingResponse.ok) {
            throw new Error('Failed to save one or more configurations');
        }

        const [sapResult, outgoingResult] = await Promise.all([
            sapResponse.json(),
            outgoingResponse.json()
        ]);

        if (!sapResult.success || !outgoingResult.success) {
            throw new Error(sapResult.error || outgoingResult.error || 'Failed to save configuration');
        }

        // Show success message
        await Swal.fire({
            icon: 'success',
            title: 'Configuration Saved',
            text: 'SAP and outgoing path configurations have been saved successfully',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });

    } catch (error) {
        console.error('Error saving configuration:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to save configuration',
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

async function validatePaths() {
    try {
        // Show loading state
        Swal.fire({
            title: 'Validating Paths',
            text: 'Please wait while we validate the network paths...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            allowEnterKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const credentials = {
            domain: document.getElementById('serverName').value,
            username: document.getElementById('serverUsername').value,
            password: document.getElementById('serverPassword').value
        };

        // Get paths and format them
        let sapPath = document.getElementById('networkPath').value;
        let outgoingPath = document.getElementById('outgoingPath').value;
        
        // Basic validation
        if (!sapPath || !outgoingPath) {
            throw new Error('Both network paths are required');
        }
        
        // Format paths to ensure proper structure
        sapPath = sapPath.replace(/\//g, '\\');
        outgoingPath = outgoingPath.replace(/\//g, '\\');
        
        // Ensure paths start with double backslash if they're network paths
        if (!sapPath.startsWith('C:') && !sapPath.startsWith('\\\\')) {
            sapPath = '\\\\' + sapPath;
        }
        if (!outgoingPath.startsWith('C:') && !outgoingPath.startsWith('\\\\')) {
            outgoingPath = '\\\\' + outgoingPath;
        }

        // Validate both paths
        const [sapValidation, outgoingValidation] = await Promise.all([
            validateAndFormatNetworkPath(sapPath),
            validateAndFormatNetworkPath(outgoingPath)
        ]);

        // Test accessibility for both paths
        const [sapAccess, outgoingAccess] = await Promise.all([
            testNetworkPathAccessibility(sapValidation, credentials),
            testNetworkPathAccessibility(outgoingValidation, credentials)
        ]);

        // Handle validation results separately for better error messages
        if (!sapAccess.success) {
            throw new Error(`SAP path validation failed: ${sapAccess.error}`);
        }
        if (!outgoingAccess.success) {
            throw new Error(`Outgoing path validation failed: ${outgoingAccess.error}`);
        }

        await Swal.fire({
            icon: 'success',
            title: 'Validation Successful',
            text: 'All network paths are valid and accessible',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });

    } catch (error) {
        console.error('Error validating paths:', error);
        // Show a more detailed error message with suggestions
        await Swal.fire({
            icon: 'error',
            title: 'Validation Failed',
            html: `
                <p>${error.message}</p>
                <div class="mt-3">
                    <small class="text-muted">
                        <strong>Tips:</strong><br>
                        - Ensure the server name is correct<br>
                        - Check if the network path exists<br>
                        - Verify your credentials<br>
                        - Make sure you have proper network access
                    </small>
                </div>
            `,
            timer: 8000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

// Consolidate all DOM ready event listeners into a single function
document.addEventListener('DOMContentLoaded', async function initializeAdminSettings() {
    try {
        // Get all nav items
        const navItems = document.querySelectorAll('.settings-nav-item');
        
        // Add click handler to each nav item
        navItems.forEach(item => {
            item.addEventListener('click', async function(e) {
                e.preventDefault();
                
                // Remove active class from all nav items
                navItems.forEach(nav => nav.classList.remove('active'));
                
                // Add active class to clicked item
                this.classList.add('active');
                
                // Get the section to show from data-section attribute
                const sectionId = this.getAttribute('data-section');
                
                // Hide all forms
                document.querySelectorAll('.settings-form').forEach(form => {
                    form.classList.remove('active');
                    form.style.display = 'none';
                });
                
                // Show the selected form
                const selectedForm = document.getElementById(sectionId);
                if (selectedForm) {
                    selectedForm.style.display = 'block';
                    // Use setTimeout to ensure display:block is applied before adding active class
                    setTimeout(() => {
                        selectedForm.classList.add('active');
                    }, 10);

                    // If switching to digital certificate section, reload the certificate config
                    if (sectionId === 'digital-cert-settings') {
                        await loadCertificateConfig();
                    }
                }
            });
        });

        // Show initial section (if none is active, show first one)
        const activeNav = document.querySelector('.settings-nav-item.active');
        if (activeNav) {
            activeNav.click();
        } else {
            const firstNav = document.querySelector('.settings-nav-item');
            if (firstNav) firstNav.click();
        }

        // Initialize configurations
        await Promise.all([
            loadLHDNConfig().catch(err => console.error('Error loading LHDN config:', err)),
            loadSAPConfig().catch(err => console.error('Error loading SAP config:', err)),
            loadOutgoingConfig().catch(err => console.error('Error loading outgoing config:', err)),
           // loadCertificateConfig().catch(err => console.error('Error loading certificate config:', err))
        ]);
        
        // Initial token fetch
        await updateAccessToken(true);
        
        // Start auto-refresh of access token (every 5 minutes)
        if (tokenRefreshInterval) {
            clearInterval(tokenRefreshInterval);
        }
        tokenRefreshInterval = setInterval(() => updateAccessToken(), 5 * 60 * 1000);

        // Clean up on page unload
        window.addEventListener('unload', () => {
            if (tokenRefreshInterval) {
                clearInterval(tokenRefreshInterval);
            }
        });

        // Load user data
        await loadUserData();

        // Add change detection to critical fields for LHDN config
        const criticalFields = ['clientId', 'clientSecret', 'middlewareUrl'];
        criticalFields.forEach(fieldId => {
            const element = document.getElementById(fieldId);
            if (element) {
                element.addEventListener('input', updateTestConnectionButtonState);
            }
        });
        
        const environmentSelect = document.getElementById('environment');
        if (environmentSelect) {
            environmentSelect.addEventListener('change', () => {
                updateLHDNUrl();
                updateTestConnectionButtonState();
            });
        }

        // Initialize outgoing path configuration
        await loadOutgoingConfig().catch(err => console.error('Error loading outgoing config:', err));

    } catch (error) {
        console.error('Error initializing admin settings:', error);
        // Show error toast but don't prevent the page from loading
        await Swal.fire({
            icon: 'error',
            title: 'Initialization Warning',
            text: 'Some features may not be available: ' + error.message,
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    }
});


// Handle profile picture upload
document.addEventListener('DOMContentLoaded', () => {
    const avatarContainer = document.getElementById('avatarContainer');
    const avatarUpload = document.getElementById('avatarUpload');
    
    avatarContainer.addEventListener('click', () => {
        avatarUpload.click();
    });
    
    avatarUpload.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            
            // Validate file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
                await Swal.fire({
                    icon: 'error',
                    title: 'File Too Large',
                    text: 'Please select an image under 5MB',
                    timer: 3000,
                    timerProgressBar: true,
                    showConfirmButton: false,
                    position: 'top-end',
                    toast: true
                });
                return;
            }
            
            // Validate file type
            if (!file.type.startsWith('image/')) {
                await Swal.fire({
                    icon: 'error',
                    title: 'Invalid File Type',
                    text: 'Please select an image file',
                    timer: 3000,
                    timerProgressBar: true,
                    showConfirmButton: false,
                    position: 'top-end',
                    toast: true
                });
                return;
            }
            
            try {
                const formData = new FormData();
                formData.append('avatar', file);
                
                const response = await fetch('/api/user/update-avatar', {
                    method: 'POST',
                    body: formData
                });
                
                const result = await response.json();
                
                if (result.success) {
                    document.getElementById('profileAvatar').src = result.avatarUrl;
                    await Swal.fire({
                        icon: 'success',
                        title: 'Profile Picture Updated',
                        text: 'Your profile picture has been updated successfully',
                        timer: 2000,
                        timerProgressBar: true,
                        showConfirmButton: false,
                        position: 'top-end',
                        toast: true
                    });
                } else {
                    throw new Error(result.message);
                }
            } catch (error) {
                console.error('Error uploading avatar:', error);
                await Swal.fire({
                    icon: 'error',
                    title: 'Upload Failed',
                    text: error.message || 'Failed to upload profile picture',
                    timer: 3000,
                    timerProgressBar: true,
                    showConfirmButton: false,
                    position: 'top-end',
                    toast: true
                });
            }
        }
    });
});


function setupNavigation() {
    const navItems = document.querySelectorAll('.settings-nav-item');
    const sections = document.querySelectorAll('.settings-form');

    // Initially hide all sections except the first one
    sections.forEach((section, index) => {
        section.style.display = index === 0 ? 'block' : 'none';
    });

    // Set first nav item as active
    if (navItems[0]) {
        navItems[0].classList.add('active');
    }

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Remove active class from all items
            navItems.forEach(navItem => {
                navItem.classList.remove('active');
            });
            
            // Add active class to clicked item
            item.classList.add('active');
            
            // Hide all sections
            sections.forEach(section => {
                section.style.display = 'none';
            });
            
            // Show the selected section
            const targetId = item.getAttribute('href').substring(1);
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.style.display = 'block';
            }
        });
    });
}

async function loadUserData() {
    try {
        const response = await fetch('/api/user/profile');
        const data = await response.json();
        console.log(data);
        
        if (data.success && data.user) {
            // Store original data for reset functionality
            originalFormData = { ...data.user };
            
            // Get all form elements first
            const fullNameInput = document.getElementById('fullName');
            const emailInput = document.getElementById('email');
            const phoneInput = document.getElementById('phone');
            const usernameInput = document.getElementById('username');
            const userRoleInput = document.getElementById('userRole');
            const accountCreatedInput = document.getElementById('accountCreated');
            const profileAvatar = document.getElementById('profileAvatar');
            const lastLoginTime = document.getElementById('lastLoginTime');
            const accountStatus = document.getElementById('accountStatus');
            const lastUpdatedTime = document.getElementById('lastUpdatedTime');

            // Only set values if elements exist
            if (fullNameInput) fullNameInput.value = data.user.FullName || '';
            if (emailInput) emailInput.value = data.user.Email || '';
            if (phoneInput) phoneInput.value = data.user.Phone || '';
            if (usernameInput) usernameInput.value = data.user.Username || '';
            if (userRoleInput) userRoleInput.value = data.user.Admin ? 'Administrator' : 'User';
            if (accountCreatedInput) accountCreatedInput.value = formatDate(data.user.CreateTS);
            
            // Update profile picture if exists
            if (profileAvatar && data.user.ProfilePicture) {
                profileAvatar.src = data.user.ProfilePicture;
            }

            // Update status badge
            if (accountStatus) {
                updateStatusBadge(data.user.ValidStatus === '1');
            }

            // Update last login time
            if (lastLoginTime && data.user.LastLoginTime) {
                lastLoginTime.textContent = formatDate(data.user.LastLoginTime);
            }

            // Update last updated time - Check for both UpdateTS and UpdateTime fields
            if (lastUpdatedTime) {
                const updateTimestamp = data.user.UpdateTS || data.user.UpdateTime;
                if (updateTimestamp && updateTimestamp !== '0000-00-00 00:00:00') {
                    lastUpdatedTime.textContent = formatDate(updateTimestamp);
                } else {
                    lastUpdatedTime.textContent = formatDate(data.user.CreateTS) || 'Never';
                }
            }

            addChangeDetection();
 
        } else {
            throw new Error(data.message || 'Failed to load user data');
        }
    } catch (error) {
        console.error('Error loading user data:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to load user profile: ' + error.message,
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });

        // Set default values for critical UI elements
        const defaultElements = {
            fullName: '',
            email: '',
            phone: '',
            username: '',
            userRole: '',
            accountCreated: '',
            lastUpdatedTime: formatDate(new Date()) // Set to current time if error
        };

        Object.entries(defaultElements).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.value = value;
        });
    }
}

function addChangeDetection() {
    const editableFields = ['fullName', 'email', 'phone', 'twoFactorAuth', 'loginNotifications'];
    editableFields.forEach(fieldId => {
        const element = document.getElementById(fieldId);
        if (element) {
            element.addEventListener('change', () => {
                hasUnsavedChanges = true;
                updateSaveButtonState();
            });
            if (element.type === 'text' || element.type === 'email' || element.type === 'tel') {
                element.addEventListener('input', () => {
                    hasUnsavedChanges = true;
                    updateSaveButtonState();
                });
            }
        }
    });
}

function updateSaveButtonState() {
    const saveButton = document.querySelector('button[onclick*="savePersonalInfo"]');
    const resetButton = document.querySelector('button[onclick*="resetForm"]');
    
    if (!saveButton || !resetButton) {
        console.debug('Save or reset button not found in the DOM');
        return;
    }
    
    saveButton.disabled = !hasUnsavedChanges;
    resetButton.disabled = !hasUnsavedChanges;
    
    if (hasUnsavedChanges) {
        saveButton.classList.add('btn-primary');
        saveButton.classList.remove('btn-secondary');
    } else {
        saveButton.classList.remove('btn-primary');
        saveButton.classList.add('btn-secondary');
    }
}

function updateStatusBadge(isActive) {
    const statusBadge = document.getElementById('accountStatus');
    if (isActive) {
        statusBadge.innerHTML = '<i class="fas fa-check-circle"></i><span>Active</span>';
        statusBadge.style.background = '#ecfdf5';
        statusBadge.style.color = '#059669';
    } else {
        statusBadge.innerHTML = '<i class="fas fa-times-circle"></i><span>Inactive</span>';
        statusBadge.style.background = '#fef2f2';
        statusBadge.style.color = '#dc2626';
    }
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function resetForm() {
    if (!originalFormData) return;
    
    // Reset form fields to original values
    document.getElementById('fullName').value = originalFormData.FullName || '';
    document.getElementById('email').value = originalFormData.Email || '';
    document.getElementById('phone').value = originalFormData.Phone || '';
    
    // Reset security settings
    document.getElementById('twoFactorAuth').checked = originalFormData.TwoFactorEnabled || false;
    document.getElementById('loginNotifications').checked = originalFormData.NotificationsEnabled || false;
    
    hasUnsavedChanges = false;
    updateSaveButtonState();
    
    Swal.fire({
        icon: 'info',
        title: 'Form Reset',
        text: 'All changes have been reset',
        timer: 2000,
        timerProgressBar: true,
        showConfirmButton: false,
        position: 'top-end',
        toast: true
    });
}

async function savePersonalInfo() {
    try {
        if (!hasUnsavedChanges) return;
        console.log("SAVE PROFILE IN SETTINGS CLICK!!");
        // Show loading state
      

        const data = {
            fullName: document.getElementById('fullName').value,
            email: document.getElementById('email').value,
            phone: document.getElementById('phone').value,
        };

        // Validate required fields
        if (!data.fullName || !data.email) {
            throw new Error('Full Name and Email are required');
        }

        const response = await fetch('/api/user/update-profile', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        
        if (result.success) {
            // Update original form data
            originalFormData = { ...originalFormData, ...data };
            hasUnsavedChanges = false;
            updateSaveButtonState();

            // Update last updated time
            const lastUpdatedTime = document.getElementById('lastUpdatedTime');
            if (lastUpdatedTime) {
                lastUpdatedTime.textContent = formatDate(new Date());
            }

            await Swal.fire({
                icon: 'success',
                title: 'Profile Updated',
                text: 'Your profile has been updated successfully',
                timer: 3000,
                timerProgressBar: true,
                showConfirmButton: false,
                position: 'top-end',
                toast: true
            });
        } else {
            throw new Error(result.message || 'Failed to update profile');
        }
    } catch (error) {
        console.error('Error saving profile:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to update profile',
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

async function changePassword() {
    try {
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        // Validate inputs
        if (!currentPassword || !newPassword || !confirmPassword) {
            throw new Error('Please fill in all password fields');
        }

        if (newPassword !== confirmPassword) {
            throw new Error('New passwords do not match');
        }

        // Password strength validation
        if (newPassword.length < 8) {
            throw new Error('Password must be at least 8 characters long');
        }

        if (!/[A-Z]/.test(newPassword)) {
            throw new Error('Password must contain at least one uppercase letter');
        }

        if (!/[a-z]/.test(newPassword)) {
            throw new Error('Password must contain at least one lowercase letter');
        }

        if (!/[0-9]/.test(newPassword)) {
            throw new Error('Password must contain at least one number');
        }

        if (!/[!@#$%^&*]/.test(newPassword)) {
            throw new Error('Password must contain at least one special character (!@#$%^&*)');
        }

        // Show loading state
        Swal.fire({
            title: 'Updating Password',
            text: 'Please wait while we update your password...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            allowEnterKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const response = await fetch('/api/user/change-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                currentPassword,
                newPassword,
                confirmPassword
            })
        });

        const result = await response.json();
        
        if (result.success) {
            // Clear password fields
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';

            await Swal.fire({
                icon: 'success',
                title: 'Password Updated',
                text: 'Your password has been changed successfully',
                timer: 3000,
                timerProgressBar: true,
                showConfirmButton: false,
                position: 'top-end',
                toast: true
            });
        } else {
            throw new Error(result.message || 'Failed to change password');
        }
    } catch (error) {
        console.error('Error changing password:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to change password',
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

async function saveNotificationPreferences() {
    try {
        const data = {
            emailNotifications: document.getElementById('emailNotifications').checked,
            smsNotifications: document.getElementById('smsNotifications').checked
        };

        const response = await fetch('/api/saveNotificationPreferences', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        
        if (result.success) {
            showSuccess('Notification preferences saved successfully');
        } else {
            throw new Error(result.message || 'Failed to save notification preferences');
        }
    } catch (error) {
        console.error('Error saving notification preferences:', error);
        showError(error.message || 'Failed to save notification preferences');
    }
}

// Helper functions for showing success/error messages
function showSuccess(message) {
    // Create alert element
    const alert = document.createElement('div');
    alert.className = 'alert alert-success';
    alert.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
    
    // Add to page
    showAlert(alert);
}

function showError(message) {
    // Create alert element
    const alert = document.createElement('div');
    alert.className = 'alert alert-danger';
    alert.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
    
    // Add to page
    showAlert(alert);
}

function showAlert(alertElement) {
    // Find the settings-form-content of the active section
    const activeSection = document.querySelector('.settings-form[style*="block"]') || document.querySelector('.settings-form');
    const content = activeSection.querySelector('.settings-form-content');
    
    // Insert alert at the top of the content
    content.insertBefore(alertElement, content.firstChild);
    
    // Remove after 3 seconds
    setTimeout(() => {
        alertElement.remove();
    }, 3000);
}

function togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    const button = input.nextElementSibling;
    const icon = button.querySelector('i');
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

// Update the loadLHDNConfig function to store the saved configuration
async function loadLHDNConfig() {
    try {
        const response = await fetch('/api/config/lhdn/get-config');
        const data = await response.json();
        
        if (data.success && data.config) {
            // Parse the settings if it's a string
            let settings;
            try {
                // Handle both string and object formats
                if (typeof data.config.Settings === 'string') {
                    settings = JSON.parse(data.config.Settings);
                } else if (data.config.settings) {
                    settings = data.config.settings;
                } else {
                    settings = data.config;
                }

                console.log('Parsed settings:', settings); // Debug log
                
                // // Store the saved configuration
                // savedLHDNConfig = {
                //     clientId: settings.clientId || '',
                //     clientSecret: settings.clientSecret || '',
                //     middlewareUrl: settings.middlewareUrl || (settings.environment === 'production' ? 'https://api.myinvois.hasil.gov.my' : 'https://preprod-api.myinvois.hasil.gov.my')
                // };

                // Update last modified info if available
                const lastModifiedInfo = document.getElementById('lastModifiedInfo');
                const lastModifiedBy = document.getElementById('lastModifiedBy');
                const lastModifiedTime = document.getElementById('lastModifiedTime');

                if (settings.lastModifiedBy) {
                    lastModifiedBy.textContent = settings.lastModifiedBy.name || settings.lastModifiedBy.username;
                    lastModifiedTime.textContent = new Date(settings.lastModifiedBy.timestamp).toLocaleString();
                    lastModifiedInfo.style.display = 'block';
                } else {
                    lastModifiedInfo.style.display = 'none';
                }
                
            } catch (e) {
                console.error('Error parsing settings:', e);
                settings = {};
            }
            
            // Fill in the form fields
            document.getElementById('environment').value = settings.environment || 'default';
            
            // Set the middleware URL based on environment
            const middlewareUrl = document.getElementById('middlewareUrl');
            if (settings.environment === 'production') {
                middlewareUrl.value = 'https://api.myinvois.hasil.gov.my';
            } else {
                middlewareUrl.value = 'https://preprod-api.myinvois.hasil.gov.my';
            }
            
            // Set client credentials
            if (settings.clientId) document.getElementById('clientId').value = settings.clientId;
            if (settings.clientSecret) document.getElementById('clientSecret').value = settings.clientSecret;
            
            // Set connection settings
            document.getElementById('timeout').value = settings.timeout || 30;
            document.getElementById('retryEnabled').checked = settings.retryEnabled || false;

            // Update test connection button state
            updateTestConnectionButtonState();
            // After loading config, update the access token
            //await updateAccessToken();
        }
    } catch (error) {
        console.error('Error loading LHDN config:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to load LHDN configuration',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    }
}

// Add function to check if critical fields have changed
function hasConfigurationChanged() {
    if (!savedLHDNConfig) return true; // If no saved config, allow testing
    
    const currentConfig = {
        clientId: document.getElementById('clientId').value,
        clientSecret: document.getElementById('clientSecret').value,
        middlewareUrl: document.getElementById('middlewareUrl').value
    };
    
    return currentConfig.clientId !== savedLHDNConfig.clientId ||
           currentConfig.clientSecret !== savedLHDNConfig.clientSecret ||
           currentConfig.middlewareUrl !== savedLHDNConfig.middlewareUrl;
}

// Add function to update test connection button state
function updateTestConnectionButtonState() {
    const testButton = document.querySelector('button[onclick="testConnection()"]');
    if (!testButton) return;

    const clientId = document.getElementById('clientId')?.value;
    const clientSecret = document.getElementById('clientSecret')?.value;
    const middlewareUrl = document.getElementById('middlewareUrl')?.value;

    const hasRequiredFields = clientId && clientSecret && middlewareUrl;
    const hasChanges = hasConfigurationChanged();

    testButton.disabled = !hasRequiredFields || !hasChanges;
    
    // Update button appearance
    if (hasRequiredFields && hasChanges) {
        testButton.classList.remove('btn-secondary');
        testButton.classList.add('btn-outline-secondary');
        testButton.title = 'Test connection with current configuration';
    } else {
        testButton.classList.remove('btn-outline-secondary');
        testButton.classList.add('btn-secondary');
        testButton.title = hasRequiredFields ? 
            'No changes detected in configuration' : 
            'Please fill in all required fields';
    }
}

// Add event listeners to critical fields
document.addEventListener('DOMContentLoaded', () => {
    const criticalFields = ['clientId', 'clientSecret', 'middlewareUrl'];
    criticalFields.forEach(fieldId => {
        document.getElementById(fieldId)?.addEventListener('input', updateTestConnectionButtonState);
    });
    
    // Also update when environment changes as it affects middlewareUrl
    document.getElementById('environment')?.addEventListener('change', () => {
        updateLHDNUrl();
        updateTestConnectionButtonState();
    });
    
    loadLHDNConfig();
});

async function testConnection() {
    try {
        const button = document.querySelector('button[onclick="testConnection()"]');
        if (!button) {
            throw new Error('Test connection button not found');
        }

        // Get current values
        const environment = document.getElementById('environment').value;
        const middlewareUrl = document.getElementById('middlewareUrl').value;
        const clientId = document.getElementById('clientId').value;
        const clientSecret = document.getElementById('clientSecret').value;

        // Validate required fields
        if (!clientId || !clientSecret) {
            throw new Error('Client ID and Client Secret are required');
        }

        if (!middlewareUrl) {
            throw new Error('Middleware URL is required');
        }

        // Update button state
        const originalButtonHtml = button.innerHTML;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
        button.disabled = true;

        try {
            // Show loading state
            Swal.fire({
                title: 'Testing Connection',
                text: 'Please wait while we verify your credentials...',
                allowOutsideClick: false,
                allowEscapeKey: false,
                allowEnterKey: false,
                showConfirmButton: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            // Try to validate the credentials
            const response = await fetch('/api/config/lhdn/test-connection', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    clientId,
                    clientSecret,
                    environment,
                    middlewareUrl
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Connection test failed');
            }

            // Close loading dialog
            Swal.close();

            // Show success message with expiry details
            await Swal.fire({
                icon: 'success',
                title: 'Connection Test Successful',
                html: `
                    <div style="text-align: left;">
                        <p><i class="fas fa-check-circle text-success"></i> Credentials validation successful</p>
                        <p><i class="fas fa-clock text-info"></i> Token validity: ${result.expiresIn || 'N/A'} minutes</p>
                        <p class="text-muted small">Note: Token will be automatically refreshed when needed</p>
                    </div>
                `,
                showConfirmButton: true,
                confirmButtonText: 'Save Configuration',
                showCancelButton: true,
                cancelButtonText: 'Close'
            }).then((result) => {
                if (result.isConfirmed) {
                    saveLHDNConfig();
                }
            });

            // Update access token display if available
            if (result.accessToken) {
                const tokenInput = document.getElementById('accessToken');
                if (tokenInput) {
                    tokenInput.value = result.accessToken;
                }
            }

        } catch (error) {
            // Close any open loading dialog
            Swal.close();

            console.error('Connection test error:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Connection Test Failed',
                html: `
                    <div style="text-align: left;">
                        <p><i class="fas fa-times-circle text-danger"></i> ${error.message}</p>
                        <p class="text-muted small">Please verify your credentials and try again</p>
                    </div>
                `,
                showConfirmButton: true
            });
        } finally {
            // Restore button state
            button.innerHTML = originalButtonHtml;
            updateTestConnectionButtonState();
        }

    } catch (error) {
        console.error('Test connection setup error:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to setup connection test',
            showConfirmButton: true
        });
    }
}

async function saveLHDNConfig() {
    try {
        // Show loading state
        Swal.fire({
            title: 'Saving Configuration',
            text: 'Please wait while we save your configuration...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            allowEnterKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const config = {
            environment: document.getElementById('environment').value,
            middlewareUrl: document.getElementById('middlewareUrl').value,
            clientId: document.getElementById('clientId').value,
            clientSecret: document.getElementById('clientSecret').value,
            timeout: parseInt(document.getElementById('timeout').value) || 30,
            retryEnabled: document.getElementById('retryEnabled').checked
        };

        // Validate required fields
        if (!config.clientId || !config.clientSecret) {
            throw new Error('Client ID and Client Secret are required');
        }

        const response = await fetch('/api/config/lhdn/save-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to save configuration');
        }

        // Close loading dialog and show success
        await Swal.fire({
            icon: 'success',
            title: 'Configuration Saved',
            text: 'LHDN configuration has been saved successfully',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true,
            customClass: {
                popup: 'animated fadeInRight'
            }
        });

        // Reload the configuration to ensure UI is in sync
        await loadLHDNConfig();

    } catch (error) {
        console.error('Error saving LHDN config:', error);
        
        // Close loading dialog if open
        Swal.close();
        
        // Show error message
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to save LHDN configuration',
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

function updateLHDNUrl() {
    const environment = document.getElementById('environment').value;
    const urlInput = document.getElementById('middlewareUrl');
    
    // Update URL based on environment
    if (environment === 'default') {
        urlInput.value = 'https://preprod-api.myinvois.hasil.gov.my';
    } else if (environment === 'sandbox') {
        urlInput.value = 'https://preprod-api.myinvois.hasil.gov.my';
    } else if (environment === 'production') {
        urlInput.value = 'https://api.myinvois.hasil.gov.my';
    } else {
        urlInput.value = 'https://api.myinvois.hasil.gov.my';
    }

}

function copyUrl() {
    const urlInput = document.getElementById('middlewareUrl');
    
    // Use modern clipboard API
    navigator.clipboard.writeText(urlInput.value).then(async () => {
        const button = document.querySelector('button[onclick="copyUrl()"]');
        const icon = button.querySelector('i');
        
        // Prevent duplicate clicks while animation is running
        if (icon.classList.contains('fa-check')) {
            return;
        }
        
        // Show feedback
        icon.classList.remove('fa-copy');
        icon.classList.add('fa-check');
        setTimeout(() => {
            icon.classList.remove('fa-check');
            icon.classList.add('fa-copy');
        }, 1500);

        await Swal.fire({
            icon: 'success',
            title: 'URL Copied to Clipboard',
            text: 'The LHDN e-Invoice BaseURL has been copied successfully',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true,
            customClass: {
                popup: 'animated fadeInRight'
            }
        });

    }).catch(err => {
        console.error('Failed to copy text: ', err);
    });
}

// Network path validation functions
function validateAndFormatNetworkPath(path) {
    return new Promise((resolve) => {
        // Remove any trailing slashes
        path = path.replace(/\\+$/, '');
        
        // Ensure proper UNC format for network paths
        if (!path.startsWith('\\\\')) {
            if (path.startsWith('\\')) {
                path = '\\' + path;
            } else {
                path = '\\\\' + path;
            }
        }
        
        // Replace forward slashes with backslashes
        path = path.replace(/\//g, '\\');
        
        // Ensure no double backslashes in the middle of the path
        path = path.replace(/\\{2,}/g, '\\\\');
        
        resolve(path);
    });
}

async function testNetworkPathAccessibility(path, credentials) {
    try {
        // Send validation request to backend
        const response = await fetch('/api/config/sap/validate-path', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                networkPath: path,
                domain: credentials.domain,
                username: credentials.username,
                password: credentials.password
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Network path validation failed');
        }

        return {
            success: true,
            formattedPath: result.formattedPath || path
        };

    } catch (error) {
        return {
            success: false,
            error: error.message,
            formattedPath: path
        };
    }
}

function copyNetworkPath() {
    const networkPathInput = document.getElementById('networkPath');
    
    // Use modern clipboard API
    navigator.clipboard.writeText(networkPathInput.value).then(async () => {
        const button = document.querySelector('button[onclick="copyNetworkPath()"]');
        const icon = button.querySelector('i');
        
        // Prevent duplicate clicks while animation is running
        if (icon.classList.contains('fa-check')) {
            return;
        }
        
        // Show feedback
        icon.classList.remove('fa-copy');
        icon.classList.add('fa-check');
        setTimeout(() => {
            icon.classList.remove('fa-check');
            icon.classList.add('fa-copy');
        }, 1500);

        await Swal.fire({
            icon: 'success',
            title: 'Network Path Copied',
            text: 'The network path has been copied to clipboard',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true,
            customClass: {
                popup: 'animated fadeInRight'
            }
        });
    }).catch(err => {
        console.error('Failed to copy network path:', err);
        showError('Failed to copy network path');
    });
}

async function copyAccessToken() {
    const tokenInput = document.getElementById('accessToken');
    
    try {
        await navigator.clipboard.writeText(tokenInput.value);
        
        const button = document.querySelector('button[onclick="copyAccessToken()"]');
        const icon = button.querySelector('i');
        
        // Prevent duplicate clicks while animation is running
        if (icon.classList.contains('fa-check')) {
            return;
        }
        
        // Show feedback
        icon.classList.remove('fa-copy');
        icon.classList.add('fa-check');
        setTimeout(() => {
            icon.classList.remove('fa-check');
            icon.classList.add('fa-copy');
        }, 1500);

        await Swal.fire({
            icon: 'success',
            title: 'Access Token Copied',
            text: 'The access token has been copied to clipboard',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true,
            customClass: {
                popup: 'animated fadeInRight'
            }
        });
    } catch (error) {
        console.error('Failed to copy access token:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to copy access token',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    }
}

async function updateAccessToken(force = false) {
    try {
        // Get current token info
        const tokenInput = document.getElementById('accessToken');
        const expiryInfo = document.getElementById('tokenExpiryInfo');
        
        if (!force) {
            // Check if we need to refresh
            const expiryTime = tokenInput.dataset.expiryTime;
            if (expiryTime) {
                const timeLeft = new Date(expiryTime) - new Date();
                if (timeLeft > 5 * 60 * 1000) { // More than 5 minutes left
                    return; // Skip refresh
                }
            }
        }

        const response = await fetch('/api/config/lhdn/access-token');
        const data = await response.json();
        
        if (data.success) {
            // Update token value
            tokenInput.value = data.accessToken;
            tokenInput.dataset.expiryTime = data.expiryTime;
            
            // Calculate and display expiry time
            if (data.expiryTime) {
                const expiryDate = new Date(data.expiryTime);
                const now = new Date();
                const minutesLeft = Math.round((expiryDate - now) / 60000);
                
                expiryInfo.className = '';
                
                if (minutesLeft < 5) {
                    expiryInfo.className = 'status-error';
                    expiryInfo.textContent = `Token expires in ${minutesLeft} minutes! (Critical)`;
                } else if (minutesLeft < 15) {
                    expiryInfo.className = 'status-warning';
                    expiryInfo.textContent = `Token expires in ${minutesLeft} minutes (Warning)`;
                } else {
                    expiryInfo.className = 'status-active';
                    expiryInfo.textContent = `Token expires in ${minutesLeft} minutes`;
                }
            }
        }
    } catch (error) {
        console.error('Error updating access token:', error);
        // Don't show error toast for rate limit errors
        if (!error.message.includes('429')) {
            await Swal.fire({
                icon: 'error',
                title: 'Token Update Failed',
                text: error.message,
                timer: 3000,
                timerProgressBar: true,
                showConfirmButton: false,
                position: 'top-end',
                toast: true
            });
        }
    }
}

// // Add auto-refresh of access token
// setInterval(updateAccessToken, 5 * 60 * 1000); // Refresh every 5 minutes

// Template preview functionality
async function previewTemplate(templateName) {
    try {
        const modal = new bootstrap.Modal(document.getElementById('templatePreviewModal'));
        const previewFrame = document.getElementById('templatePreviewFrame');
        
        // Sample data following LHDN requirements
        const sampleData = {
            companyName: "Pixelcare Sdn Bhd",
            companyAddress: "Level 15, Menara LGB, 1, Jalan Wan Kadir, Taman Tun Dr Ismail, 60000 Kuala Lumpur, Malaysia",
            companyPhone: "+60 3-7728 7728",
            companyEmail: "finance@pixelcare.com.my",
            
            // Tax registration details
            supplierSSTID: "W10-1234567",  // SST Registration Number
            supplierTIN: "TIN82749174",    // Tax Identification Number
            supplierRegNo: "201901123456", // ROC Number
            supplierMSICCode: "62011",     // MSIC Code for Software Development
            
            // Invoice details
            invoiceNo: "INV-2024-0001",
            invoiceDate: new Date().toLocaleDateString('en-MY'),
            dueDate: new Date(Date.now() + 30*24*60*60*1000).toLocaleDateString('en-MY'), // 30 days from now
            paymentTerms: "Net 30",
            
            // Bank details
            bankName: "Maybank Berhad",
            accountNo: "514012345678",
            swiftCode: "MBBEMYKL",
            
            // Customer details
            buyerName: "Tech Solutions Enterprise Sdn Bhd",
            buyerAddress: "Unit 8-1, Level 8, Wisma UOA Damansara II, No. 6 Changkat Semantan, Damansara Heights, 50490 Kuala Lumpur",
            buyerTIN: "BT48291742",
            buyerPhone: "+60 3-2095 2095",
            
            // Line items with SST
            items: [
                {
                    description: "Enterprise Software License - Annual Subscription",
                    quantity: 1,
                    unitPrice: "12,000.00",
                    sst: "720.00",
                    amount: "12,720.00"
                },
                {
                    description: "Custom Software Development Services",
                    quantity: 80,
                    unitPrice: "150.00",
                    sst: "720.00",
                    amount: "12,720.00"
                },
                {
                    description: "Cloud Infrastructure Setup",
                    quantity: 1,
                    unitPrice: "5,000.00",
                    sst: "300.00",
                    amount: "5,300.00"
                }
            ],
            
            // Totals
            subtotal: "29,000.00",
            sstTotal: "1,740.00",
            totalAmount: "30,740.00",
            
            // Additional details
            digitalSignature: "DS-2024-0001-PC",
            qrCode: "/assets/img/sample-qr.png"
        };

        // Load the template with sample data
        previewFrame.src = `/reports/${templateName}.html`;
        
        previewFrame.onload = function() {
            try {
                // Get the template content
                const frameDoc = previewFrame.contentDocument || previewFrame.contentWindow.document;
                
                // Replace all placeholders with sample data
                let content = frameDoc.documentElement.outerHTML;
                for (const [key, value] of Object.entries(sampleData)) {
                    if (key === 'items') {
                        // Handle items array separately
                        const itemsTemplate = content.match(/{{#each items}}([\s\S]*?){{\/each}}/);
                        if (itemsTemplate && itemsTemplate[1]) {
                            let itemsHtml = '';
                            value.forEach(item => {
                                let itemHtml = itemsTemplate[1];
                                for (const [itemKey, itemValue] of Object.entries(item)) {
                                    itemHtml = itemHtml.replace(new RegExp(`{{${itemKey}}}`, 'g'), itemValue);
                                }
                                itemsHtml += itemHtml;
                            });
                            content = content.replace(/{{#each items}}[\s\S]*?{{\/each}}/, itemsHtml);
                        }
                    } else {
                        content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
                    }
                }
                
                // Write the populated content back to the iframe
                frameDoc.open();
                frameDoc.write(content);
                frameDoc.close();
                
                modal.show();
            } catch (error) {
                console.error('Error populating template:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Failed to populate template with sample data'
                });
            }
        };
    } catch (error) {
        console.error('Error loading template:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to load template preview'
        });
    }
}

// XML Configuration Functions
async function loadXMLConfig() {
    try {
        const response = await fetch('/api/config/xml/get-config');
        const data = await response.json();
        
        if (data.success && data.settings) {
            // Parse the settings if it's a string
            let settings;
            try {
                settings = typeof data.settings === 'string' ? JSON.parse(data.settings) : data.settings;
            } catch (e) {
                console.error('Settings parse error:', e);
                throw new Error('Invalid settings format');
            }
            
            // Populate form fields
            document.getElementById('xmlNetworkPath').value = settings.networkPath || '';
            document.getElementById('xmlServerName').value = settings.domain || '';
            document.getElementById('xmlUsername').value = settings.username || '';
            // Don't populate password for security reasons
            
            // Update last modified info if available
            const xmlLastModifiedInfo = document.getElementById('xmlLastModifiedInfo');
            const xmlLastModifiedBy = document.getElementById('xmlLastModifiedBy');
            const xmlLastModifiedTime = document.getElementById('xmlLastModifiedTime');

            if (settings.lastModifiedBy) {
                xmlLastModifiedBy.textContent = settings.lastModifiedBy.name || settings.lastModifiedBy.username;
                xmlLastModifiedTime.textContent = new Date(settings.lastModifiedBy.timestamp).toLocaleString();
                xmlLastModifiedInfo.style.display = 'block';
            } else {
                xmlLastModifiedInfo.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error loading XML config:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to load XML configuration: ' + error.message,
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    }
}

async function validateXmlPath() {
    try {
        // Show loading state
        Swal.fire({
            title: 'Validating Path',
            text: 'Please wait while we validate the network path...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            allowEnterKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const networkPath = document.getElementById('xmlNetworkPath').value;
        const domain = document.getElementById('xmlServerName').value;
        const username = document.getElementById('xmlUsername').value;
        const password = document.getElementById('xmlPassword').value;

        // Validate required fields
        if (!networkPath) {
            throw new Error('Network path is required');
        }

        if (!username || !password) {
            throw new Error('Username and password are required');
        }

        // Send validation request
        const response = await fetch('/api/config/xml/validate-path', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                networkPath,
                domain,
                username,
                password
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Network path validation failed');
        }

        // Show success message
        await Swal.fire({
            icon: 'success',
            title: 'Validation Successful',
            text: 'Network path is valid and accessible',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });

        // Update the network path with formatted version if provided
        if (result.formattedPath) {
            document.getElementById('xmlNetworkPath').value = result.formattedPath;
        }

    } catch (error) {
        console.error('Error validating XML path:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Validation Failed',
            text: error.message,
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

async function saveXmlConfig() {
    try {
        // Show loading state
        Swal.fire({
            title: 'Saving Configuration',
            text: 'Please wait while we save your configuration...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            allowEnterKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const networkPath = document.getElementById('xmlNetworkPath').value;
        const domain = document.getElementById('xmlServerName').value;
        const username = document.getElementById('xmlUsername').value;
        const password = document.getElementById('xmlPassword').value;

        // Validate required fields
        if (!networkPath) {
            throw new Error('Network path is required');
        }

        if (!username || !password) {
            throw new Error('Username and password are required');
        }

        // Save configuration
        const response = await fetch('/api/config/xml/save-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                networkPath,
                domain,
                username,
                password
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to save XML configuration');
        }

        // Show success message
        await Swal.fire({
            icon: 'success',
            title: 'Configuration Saved',
            text: 'XML configuration has been saved successfully',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });

        // Reload configuration to ensure UI is in sync
        await loadXMLConfig();

    } catch (error) {
        console.error('Error saving XML config:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to save XML configuration',
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

function copyXmlNetworkPath() {
    const networkPathInput = document.getElementById('xmlNetworkPath');
    
    navigator.clipboard.writeText(networkPathInput.value).then(async () => {
        const button = document.querySelector('button[onclick="copyXmlNetworkPath()"]');
        const icon = button.querySelector('i');
        
        if (icon.classList.contains('fa-check')) {
            return;
        }
        
        icon.classList.remove('fa-copy');
        icon.classList.add('fa-check');
        setTimeout(() => {
            icon.classList.remove('fa-check');
            icon.classList.add('fa-copy');
        }, 1500);

        await Swal.fire({
            icon: 'success',
            title: 'Network Path Copied',
            text: 'The XML network path has been copied to clipboard',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    }).catch(err => {
        console.error('Failed to copy XML network path:', err);
        showError('Failed to copy network path');
    });
}

// // Add XML config initialization to the DOMContentLoaded event
// document.addEventListener('DOMContentLoaded', () => {
//     // Initialize XML configuration
//     loadXMLConfig();
// });

// Digital Certificate Management Functions
let currentCertificate = null;

function triggerCertificateUpload() {
    document.getElementById('certificateFile').click();
}

document.addEventListener('DOMContentLoaded', function() {
    const certificateFile = document.getElementById('certificateFile');
    if (certificateFile) {
        certificateFile.addEventListener('change', handleCertificateSelection);
    }
    
    // Load existing certificate configuration
   // loadCertificateConfig();
});

async function handleCertificateSelection(event) {
    try {
        const file = event.target.files[0];
        if (!file) return;

        // Update filename display
        document.getElementById('certificateFileName').value = file.name;

        // Validate file type
        if (!file.name.toLowerCase().endsWith('.p12') && !file.name.toLowerCase().endsWith('.pfx')) {
            throw new Error('Invalid certificate format. Please upload a .p12 or .pfx file.');
        }

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            throw new Error('Certificate file is too large. Maximum size is 5MB.');
        }

        // Store the certificate for later use
        currentCertificate = file;

        // Clear password field
        document.getElementById('certificatePassword').value = '';

        // Hide certificate info until validated
        document.getElementById('certificateInfo').style.display = 'none';

    } catch (error) {
        console.error('Error handling certificate:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Certificate Error',
            text: error.message,
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });

        // Reset file input
        event.target.value = '';
        document.getElementById('certificateFileName').value = '';
        currentCertificate = null;
    }
}

// Update the validateLHDNCertificateRequirements function
function validateLHDNCertificateRequirements(cert) {
    if (!cert) return { valid: false, missingFields: ['Certificate is required'] };
    
    console.log('Validating LHDN requirements for certificate:', cert);
    
    // Extract subject components
    const subjectParts = {};
    if (cert.subject) {
        cert.subject.split(', ').forEach(part => {
            const [key, value] = part.split('=');
            if (key && value) {
                subjectParts[key] = value;
                
                // Check for OID in undefined attribute
                // Match both C58474705050 (with zero) and C5847470505O (with letter O)
                if (key === 'undefined' && (value.match(/^C[0-9]+O$/) || value.match(/^C[0-9]+0$/))) {
                    console.log('Found OID in undefined attribute during validation:', value);
                    subjectParts.OID = value;
                }
            }
        });
    }
    
    // Use extracted values if available
    const cn = cert.extractedCN || subjectParts.CN;
    const c = cert.extractedC || subjectParts.C;
    const o = cert.extractedO || subjectParts.O;
    let oid = cert.extractedOID || subjectParts.OID;
    const serialNumber = cert.extractedSERIALNUMBER || subjectParts.SERIALNUMBER || cert.serialNumber;
    
    // Special check for OID in the subject string
    if (!oid) {
        // Check for both patterns in the subject string
        const oidMatch = cert.subject?.match(/C[0-9]+O/) || cert.subject?.match(/C[0-9]+0/);
        if (oidMatch) {
            console.log('Found OID in subject string during validation:', oidMatch[0]);
            oid = oidMatch[0];
        }
    }
    
    // Check required fields
    const missingFields = [];
    if (!cn) missingFields.push('CN (Common Name)');
    if (!c) missingFields.push('C (Country)');
    if (!o) missingFields.push('O (Organization)');
    if (!oid) missingFields.push('OID (Organization Identifier)');
    if (!serialNumber) missingFields.push('SERIALNUMBER');
    
    // Check key usage
    const hasNonRepudiation = cert.keyUsage && (
        cert.keyUsage.includes('nonRepudiation') || 
        cert.keyUsage.includes('Non Repudiation') || 
        cert.keyUsage.includes('Digital Signature')
    );
    if (!hasNonRepudiation) {
        missingFields.push('Key Usage: Non-Repudiation');
    }
    
    // Check extended key usage
    const hasDocumentSigning = cert.extKeyUsage && (
        cert.extKeyUsage.includes('documentSigning') || 
        cert.extKeyUsage.includes('Document Signing') || 
        cert.extKeyUsage.includes('1.3.6.1.4.1.311.10.3.12') ||
        cert.extKeyUsage.includes('Email Protection')
    );
    if (!hasDocumentSigning) {
        missingFields.push('Extended Key Usage: Document Signing');
    }
    
    return {
        valid: missingFields.length === 0,
        missingFields
    };
}

// Update validateCertificate function to always enable save button
async function validateCertificate() {
    try {
        if (!currentCertificate) {
            throw new Error('Please select a certificate file first.');
        }

        const password = document.getElementById('certificatePassword').value;
        if (!password) {
            throw new Error('Please enter the certificate password.');
        }

        // Show loading state
        Swal.fire({
            title: 'Validating Certificate',
            text: 'Please wait while we validate your certificate...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            allowEnterKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        // Create form data
        const formData = new FormData();
        formData.append('certificate', currentCertificate, currentCertificate.name);
        formData.append('password', password);

        // Send to backend for validation
        const response = await fetch('/api/config/certificate/validate', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Certificate validation failed');
        }

        const result = await response.json();
        console.log('Validation result:', result);

        if (!result.success) {
            throw new Error(result.error || 'Certificate validation failed');
        }

        // Always enable save button if certificate is valid, regardless of LHDN requirements
        isValidated = true;
        document.getElementById('saveCertBtn').disabled = false;

        // Update UI with certificate info
        updateCertificateInfo(result.certInfo);

        // Show success message
        let message = 'Certificate is valid';
        let icon = 'success';
        
        // Check for missing requirements but don't block validation
        if (result.missingRequirements && result.missingRequirements.length > 0) {
            console.log('Missing requirements:', result.missingRequirements);
            
            // Check if OID is the only missing requirement
            const onlyMissingOID = result.missingRequirements.length === 1 && 
                                  result.missingRequirements[0].includes('OID');
            
            if (onlyMissingOID) {
                message = 'Certificate validated successfully. The OID field is detected in a non-standard format but will be used.';
                icon = 'success';
            } else {
                message = 'Certificate validated with warnings. Some LHDN requirements may be missing but the system will attempt to use the certificate.';
                icon = 'warning';
            }
        } else {
            message = 'Certificate meets all requirements';
        }

        await Swal.fire({
            icon: icon,
            title: 'Certificate Validated',
            text: message,
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });

    } catch (error) {
        console.error('Error validating certificate:', error);
        isValidated = false;
        document.getElementById('saveCertBtn').disabled = true;
        await Swal.fire({
            icon: 'error',
            title: 'Validation Failed',
            text: error.message,
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

// Update saveCertificateConfig function
async function saveCertificateConfig() {
    try {
        if (!currentCertificate) {
            throw new Error('Please select a certificate file first.');
        }

        if (!isValidated) {
            throw new Error('Please validate the certificate before saving.');
        }

        const password = document.getElementById('certificatePassword').value;
        if (!password) {
            throw new Error('Please enter the certificate password.');
        }

        // Show loading state
        Swal.fire({
            title: 'Saving Configuration',
            text: 'Please wait while we save your certificate configuration...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            allowEnterKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        // Create form data
        const formData = new FormData();
        formData.append('certificate', currentCertificate, currentCertificate.name);
        formData.append('password', password);

        // Send to backend for saving
        const response = await fetch('/api/config/certificate/save', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to save certificate configuration');
        }

        // Update last modified info
        if (result.lastModifiedBy) {
            document.getElementById('certLastModifiedBy').textContent = result.lastModifiedBy.name;
            document.getElementById('certLastModifiedTime').textContent = new Date(result.lastModifiedBy.timestamp).toLocaleString();
            document.getElementById('certLastModifiedInfo').style.display = 'block';
        }

        // Show success message and reload certificate info
        await Swal.fire({
            icon: 'success',
            title: 'Configuration Saved',
            text: 'Digital certificate configuration has been saved successfully',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });

        // Show remove certificate button
        document.getElementById('disableCertBtn').style.display = 'inline-block';
        
        // Reload certificate config to ensure everything is up to date
        await loadCertificateConfig();

    } catch (error) {
        console.error('Error saving certificate config:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message,
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

async function loadCertificateConfig() {
    try {
        console.log('Loading certificate configuration...');
        const response = await fetch('/api/config/certificate/get-config');
        const data = await response.json();
        console.log('Certificate config response:', data);
        
        // Get all the required DOM elements
        const certInfoElement = document.getElementById('certificateInfo');
        const disableBtn = document.getElementById('disableCertBtn');
        const lastModifiedInfo = document.getElementById('certLastModifiedInfo');
        const xadesElement = document.getElementById('xadesStructure');

        if (data.success && data.config) {
            // Show disable button since there's an active certificate
            if (disableBtn) {
                disableBtn.style.display = 'inline-block';
            }
            
            // Update certificate info if available
            if (data.config.certInfo) {
                console.log('Updating certificate info:', data.config.certInfo);
                if (certInfoElement) {
                    certInfoElement.style.display = 'block';
                    updateCertificateInfo(data.config.certInfo);
                }
            }

            // Update last modified info if available
            if (data.config.lastModifiedBy && lastModifiedInfo) {
                const lastModifiedBy = document.getElementById('certLastModifiedBy');
                const lastModifiedTime = document.getElementById('certLastModifiedTime');
                
                if (lastModifiedBy && lastModifiedTime) {
                    lastModifiedBy.textContent = data.config.lastModifiedBy.name;
                    lastModifiedTime.textContent = new Date(data.config.lastModifiedBy.timestamp).toLocaleString();
                    lastModifiedInfo.style.display = 'block';
                }
            }

            // Update XAdES structure if available
            if (data.config.xadesStructure && xadesElement) {
                xadesElement.style.display = 'block';
            }
        } else {
            // Hide elements if no active certificate
            if (certInfoElement) certInfoElement.style.display = 'none';
            if (disableBtn) disableBtn.style.display = 'none';
            if (lastModifiedInfo) lastModifiedInfo.style.display = 'none';
            if (xadesElement) xadesElement.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading certificate config:', error);
        // Don't throw the error, just log it and continue
        // This prevents the error from breaking the entire initialization process
    }
}

async function disableCertificate() {
    try {
        const result = await Swal.fire({
            title: 'Remove Certificate?',
            text: 'Are you sure you want to remove this certificate? This action cannot be undone.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'Yes, remove it',
            cancelButtonText: 'Cancel'
        });

        if (!result.isConfirmed) {
            return;
        }

        // Show loading state
        Swal.fire({
            title: 'Removing Certificate',
            text: 'Please wait...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            allowEnterKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const response = await fetch('/api/config/certificate/disable', {
            method: 'POST'
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to remove certificate');
        }

        // Reset the form and UI
        document.getElementById('certificateFile').value = '';
        document.getElementById('certificateFileName').value = 'No certificate selected';
        document.getElementById('certificatePassword').value = '';
        document.getElementById('certificateInfo').style.display = 'none';
        document.getElementById('certLastModifiedInfo').style.display = 'none';
        document.getElementById('disableCertBtn').style.display = 'none';
        currentCertificate = null;

        // Show success message
        await Swal.fire({
            icon: 'success',
            title: 'Certificate Removed',
            text: 'The certificate has been successfully removed',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });

    } catch (error) {
        console.error('Error disabling certificate:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message,
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

// Helper function to get certificate status class
function getCertStatusClass(status) {
    switch (status?.toLowerCase()) {
        case 'valid':
            return 'bg-success';
        case 'expired':
            return 'bg-danger';
        case 'pending':
        case 'future':
            return 'bg-warning';
        default:
            return 'bg-success';
    }
}

// Update certificate info display
function updateCertificateInfo(certInfo) {

    // Parse the raw subject attributes if available
    let subjectAttributes = [];
    try {
        if (typeof certInfo.rawSubjectAttributes === 'string') {
            subjectAttributes = JSON.parse(certInfo.rawSubjectAttributes);
        } else if (Array.isArray(certInfo.rawSubjectAttributes)) {
            subjectAttributes = certInfo.rawSubjectAttributes;
        }
    } catch (e) {
        console.error('Error parsing raw subject attributes:', e);
    }

    // Extract values from subject string
    const subjectParts = {};
    certInfo.subject.split(', ').forEach(part => {
        const [key, value] = part.split('=');
        subjectParts[key] = value;
        if (key === 'undefined' && (value.match(/^C[0-9]+O$/) || value.match(/^C[0-9]+0$/))) {
            console.log('Found OID in undefined attribute:', value);
            subjectParts.OID = value;
        }
    });
    console.log('Parsed subject parts:', subjectParts);

    // Extract OID and SERIALNUMBER
    const oid = certInfo.extractedOID || subjectParts.OID || 'Not specified';
    const serialNumber = certInfo.extractedSERIALNUMBER || subjectParts.serialNumber || 'Not specified';
    console.log('OID after extraction:', oid);
    console.log('SERIALNUMBER after extraction:', serialNumber);

    // Show certificate info section
    document.getElementById('certificateInfo').style.display = 'block';
    document.getElementById('disableCertBtn').style.display = 'block';

    // Get values from subject parts
    const cn = subjectParts.CN || certInfo.extractedCN || 'Not specified';
    const o = subjectParts.O || certInfo.extractedO || 'Not specified';
    const c = subjectParts.C || certInfo.extractedC || 'Not specified';

    // Update all certificate information
    const elements = {
        certStatus: { value: certInfo.status || 'valid', className: `badge ${getCertStatusClass(certInfo.status)}` },
        certCN: { value: cn },
        certO: { value: o },
        certC: { value: c },
        certOID: { value: oid },
        certSerial: { value: serialNumber },
        certValidFrom: { value: certInfo.validFrom ? new Date(certInfo.validFrom).toLocaleDateString('en-MY', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }) : 'Not specified' },
        certValidTo: { value: certInfo.validTo ? new Date(certInfo.validTo).toLocaleDateString('en-MY', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }) : 'Not specified' }
    };

    // Update all elements
    Object.entries(elements).forEach(([id, config]) => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = config.value;
            if (config.className) {
                element.className = config.className;
            }
        }
    });

    // Update LHDN requirements section
    const requirementsList = [
        { field: 'CN', value: cn, required: true },
        { field: 'C', value: c, required: true },
        { field: 'O', value: o, required: true },
        { field: 'OID', value: oid, required: true },
        { field: 'SERIALNUMBER', value: serialNumber, required: true },
        { field: 'KEYUSAGE', value: certInfo.keyUsage, required: true },
        { field: 'EXTKEYUSAGE', value: certInfo.extKeyUsage, required: true }
    ];

    document.getElementById('lhdnRequirements').innerHTML = requirementsList.map(req => `
        <div class="requirement-item ${req.value !== 'Not specified' ? 'success' : 'error'}">
            <i class="fas ${req.value !== 'Not specified' ? 'fa-check-circle text-success' : 'fa-times-circle text-danger'}"></i>
            <span>${req.field}</span>
            <span class="requirement-value">${req.value}</span>
        </div>
    `).join('');

    // Update key usage and extended key usage sections
    if (certInfo.keyUsage && Array.isArray(certInfo.keyUsage)) {
        document.getElementById('certKeyUsage').innerHTML = certInfo.keyUsage
            .map(usage => `<span class="badge bg-info me-2">${usage}</span>`)
            .join('') || '<span class="text-muted">No key usage specified</span>';
    }

    if (certInfo.extKeyUsage && Array.isArray(certInfo.extKeyUsage)) {
        document.getElementById('certExtKeyUsage').innerHTML = certInfo.extKeyUsage
            .map(usage => `<span class="badge bg-info me-2">${usage}</span>`)
            .join('') || '<span class="text-muted">No extended key usage specified</span>';
    }

    // Update issuer and subject details
    if (certInfo.issuer) {
        document.getElementById('certIssuer').innerHTML = certInfo.issuer
            .split(', ')
            .map(part => `<div>${part}</div>`)
            .join('');
    }

    if (certInfo.subject) {
        document.getElementById('certSubject').innerHTML = certInfo.subject
            .split(', ')
            .map(part => `<div>${part}</div>`)
            .join('');
    }
}

// Add function to extract and transform certificate
async function extractAndTransformCertificate(p12Buffer, password) {
    try {
        // Parse the PKCS#12 certificate
        const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12Buffer));
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

        // Extract certificate info
        const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
        const cert = certBags[0].cert;

        // Extract private key
        const pkeyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag];
        const pkey = pkeyBags[0];

        // Generate XAdES structure
        const xadesStructure = {
            signedInfo: {
                canonicalizationMethod: {
                    algorithm: "https://www.w3.org/TR/xml-c14n11/#"
                },
                signatureMethod: {
                    algorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"
                },
                reference: {
                    documentSignedData: {
                        transforms: [
                            {
                                algorithm: "http://www.w3.org/TR/1999/REC-xpath-19991116",
                                xpath: "not(//ancestor-or-self::ext:UBLExtensions)"
                            },
                            {
                                algorithm: "http://www.w3.org/TR/1999/REC-xpath-19991116",
                                xpath: "not(//ancestor-or-self::cac:Signature)"
                            },
                            {
                                algorithm: "http://www.w3.org/2006/12/xml-c14n11"
                            }
                        ],
                        digestMethod: {
                            algorithm: "http://www.w3.org/2001/04/xmlenc#sha256"
                        }
                    }
                }
            },
            signatureValue: null, // Will be populated when signing
            keyInfo: {
                x509Data: {
                    x509Certificate: forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes())
                }
            },
            object: {
                qualifyingProperties: {
                    target: "signature",
                    signedProperties: {
                        id: "id-xades-signed-props",
                        signedSignatureProperties: {
                            signingTime: new Date().toISOString(),
                            signingCertificate: {
                                cert: {
                                    certDigest: {
                                        digestMethod: {
                                            algorithm: "http://www.w3.org/2001/04/xmlenc#sha256"
                                        },
                                        digestValue: calculateCertificateDigest(cert)
                                    },
                                    issuerSerial: {
                                        x509IssuerName: cert.issuer.getField('CN').value,
                                        x509SerialNumber: cert.serialNumber
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };

        return {
            cert,
            pkey,
            xadesStructure
        };

    } catch (error) {
        throw new Error(`Failed to extract certificate: ${error.message}`);
    }
}

// Helper function to calculate certificate digest
function calculateCertificateDigest(cert) {
    const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const md = forge.md.sha256.create();
    md.update(certDer);
    return forge.util.encode64(md.digest().getBytes());
}

// Helper function to generate XAdES XML
function generateXadesXml(xadesStructure) {
    // Convert the xadesStructure object to XML format
    const xml = `
<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" 
              xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="DocSig">
    <ds:SignedInfo>
        <ds:CanonicalizationMethod Algorithm="${xadesStructure.signedInfo.canonicalizationMethod.algorithm}"/>
        <ds:SignatureMethod Algorithm="${xadesStructure.signedInfo.signatureMethod.algorithm}"/>
        <ds:Reference Id="id-doc-signed-data" URI="">
            <ds:Transforms>
                ${xadesStructure.signedInfo.reference.documentSignedData.transforms.map(transform => `
                <ds:Transform Algorithm="${transform.algorithm}">
                    ${transform.xpath ? `<ds:XPath>${transform.xpath}</ds:XPath>` : ''}
                </ds:Transform>`).join('')}
            </ds:Transforms>
            <ds:DigestMethod Algorithm="${xadesStructure.signedInfo.reference.documentSignedData.digestMethod.algorithm}"/>
            <ds:DigestValue>[Document Digest Value]</ds:DigestValue>
        </ds:Reference>
    </ds:SignedInfo>
    <ds:SignatureValue>[Signature Value]</ds:SignatureValue>
    <ds:KeyInfo>
        <ds:X509Data>
            <ds:X509Certificate>${xadesStructure.keyInfo.x509Data.x509Certificate}</ds:X509Certificate>
        </ds:X509Data>
    </ds:KeyInfo>
    <ds:Object>
        <xades:QualifyingProperties Target="#DocSig">
            <xades:SignedProperties Id="id-xades-signed-props">
                <xades:SignedSignatureProperties>
                    <xades:SigningTime>${xadesStructure.object.qualifyingProperties.signedProperties.signedSignatureProperties.signingTime}</xades:SigningTime>
                    <xades:SigningCertificate>
                        <xades:Cert>
                            <xades:CertDigest>
                                <ds:DigestMethod Algorithm="${xadesStructure.object.qualifyingProperties.signedProperties.signedSignatureProperties.signingCertificate.cert.certDigest.digestMethod.algorithm}"/>
                                <ds:DigestValue>${xadesStructure.object.qualifyingProperties.signedProperties.signedSignatureProperties.signingCertificate.cert.certDigest.digestValue}</ds:DigestValue>
                            </xades:CertDigest>
                            <xades:IssuerSerial>
                                <ds:X509IssuerName>${xadesStructure.object.qualifyingProperties.signedProperties.signedSignatureProperties.signingCertificate.cert.issuerSerial.x509IssuerName}</ds:X509IssuerName>
                                <ds:X509SerialNumber>${xadesStructure.object.qualifyingProperties.signedProperties.signedSignatureProperties.signingCertificate.cert.issuerSerial.x509SerialNumber}</ds:X509SerialNumber>
                            </xades:IssuerSerial>
                        </xades:Cert>
                    </xades:SigningCertificate>
                </xades:SignedSignatureProperties>
            </xades:SignedProperties>
        </xades:QualifyingProperties>
    </ds:Object>
</ds:Signature>`;

    return formatXml(xml);
}

// Helper function to format XML
function formatXml(xml) {
    let formatted = '';
    let indent = '';
    const tab = '    ';
    xml.split(/>\s*</).forEach(function(node) {
        if (node.match(/^\/\w/)) indent = indent.substring(tab.length);
        formatted += indent + '<' + node + '>\r\n';
        if (node.match(/^<?\w[^>]*[^\/]$/)) indent += tab;
    });
    return formatted.substring(1, formatted.length-3);
}

// Add event listeners for form changes
document.addEventListener('DOMContentLoaded', () => {
    const certificateFile = document.getElementById('certificateFile');
    const certificatePassword = document.getElementById('certificatePassword');
    const lhdnRequirementsCheck = document.getElementById('lhdnRequirementsCheck');

    // Reset validation state when form changes
    const resetValidation = () => {
        isValidated = false;
        document.getElementById('saveCertBtn').disabled = true;
    };

    if (certificateFile) certificateFile.addEventListener('change', resetValidation);
    if (certificatePassword) certificatePassword.addEventListener('input', resetValidation);
    if (lhdnRequirementsCheck) lhdnRequirementsCheck.addEventListener('change', resetValidation);
});

// Add these functions to handle outgoing path configuration
async function loadOutgoingConfig() {
    try {
        const response = await fetch('/api/config/outgoing/get-config');
        const data = await response.json();
        
        if (data.success && data.settings) {
            const outgoingPath = document.getElementById('outgoingPath');
            const serverName = document.getElementById('serverName'); // Note: Using shared server credentials
            const serverUsername = document.getElementById('serverUsername');
            
            if (outgoingPath) outgoingPath.value = data.settings.networkPath || '';
            if (serverName) serverName.value = data.settings.domain || '';
            if (serverUsername) serverUsername.value = data.settings.username || '';
            // Don't populate password for security reasons
        }
    } catch (error) {
        console.error('Error loading outgoing config:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to load outgoing path configuration',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    }
}

async function validateOutgoingPath() {
    try {
        const networkPath = document.getElementById('outgoingPath').value;
        const domain = document.getElementById('outgoingServerName').value;
        const username = document.getElementById('outgoingUsername').value;
        const password = document.getElementById('outgoingPassword').value;

        if (!networkPath || !username || !password) {
            throw new Error('Network path, username and password are required');
        }

        // Show loading state
        Swal.fire({
            title: 'Validating Path',
            text: 'Please wait while we validate the network path...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            allowEnterKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const response = await fetch('/api/config/outgoing/validate-path', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                networkPath,
                domain,
                username,
                password
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Network path validation failed');
        }

        await Swal.fire({
            icon: 'success',
            title: 'Validation Successful',
            text: 'Network path is valid and accessible',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });

    } catch (error) {
        console.error('Error validating outgoing path:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Validation Failed',
            text: error.message,
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

async function saveOutgoingConfig() {
    try {
        const networkPath = document.getElementById('outgoingPath').value;
        const domain = document.getElementById('outgoingServerName').value;
        const username = document.getElementById('outgoingUsername').value;
        const password = document.getElementById('outgoingPassword').value;

        if (!networkPath || !username || !password) {
            throw new Error('Network path, username and password are required');
        }

        // Show loading state
        Swal.fire({
            title: 'Saving Configuration',
            text: 'Please wait while we save your configuration...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            allowEnterKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const response = await fetch('/api/config/outgoing/save-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                networkPath,
                domain,
                username,
                password
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to save configuration');
        }

        await Swal.fire({
            icon: 'success',
            title: 'Configuration Saved',
            text: 'Outgoing path configuration has been saved successfully',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });

    } catch (error) {
        console.error('Error saving outgoing config:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to save outgoing path configuration',
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}
