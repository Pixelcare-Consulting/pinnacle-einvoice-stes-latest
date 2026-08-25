document.addEventListener('DOMContentLoaded', function() {
    // Get all nav items
    const navItems = document.querySelectorAll('.settings-nav-item');
    
    // Add click handler to each nav item
    navItems.forEach(item => {
        item.addEventListener('click', function(e) {
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
            }
        });
    });

    // Show initial section (if none is active, show first one)
    const activeNav = document.querySelector('.settings-nav-item.active');
    if (activeNav) {
        activeNav.click();
    } else {
        document.querySelector('.settings-nav-item').click();
    }

    // Set initial URL based on default environment selection
    updateLHDNUrl();
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
        const response = await fetch('/api/getProfileDetails');
        const data = await response.json();
        
        if (data.success && data.user) {
            // Populate personal information
            document.getElementById('fullName').value = data.user.fullName || '';
            document.getElementById('email').value = data.user.email || '';
            document.getElementById('phone').value = data.user.phone || '';
            
            // Load notification preferences if they exist
            if (data.user.preferences) {
                document.getElementById('emailNotifications').checked = data.user.preferences.emailNotifications || false;
                document.getElementById('smsNotifications').checked = data.user.preferences.smsNotifications || false;
            }
        }
    } catch (error) {
        console.error('Error loading user data:', error);
        showError('Failed to load user data');
    }
}

async function savePersonalInfo() {
    try {
        const data = {
            fullName: document.getElementById('fullName').value,
            email: document.getElementById('email').value,
            phone: document.getElementById('phone').value
        };

        const response = await fetch('/api/updateUserDetails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        
        if (result.success) {
            showSuccess('Personal information updated successfully');
        } else {
            throw new Error(result.message || 'Failed to update personal information');
        }
    } catch (error) {
        console.error('Error saving personal info:', error);
        showError(error.message || 'Failed to save personal information');
    }
}

async function changePassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!currentPassword || !newPassword || !confirmPassword) {
        showError('Please fill in all password fields');
        return;
    }

    if (newPassword !== confirmPassword) {
        showError('New passwords do not match');
        return;
    }

    try {
        const response = await fetch('/api/user/change-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                currentPassword,
                newPassword
            })
        });

        const result = await response.json();
        
        if (result.success) {
            showSuccess('Password changed successfully');
            // Clear password fields
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';
        } else {
            throw new Error(result.message || 'Failed to change password');
        }
    } catch (error) {
        console.error('Error changing password:', error);
        showError(error.message || 'Failed to change password');
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

async function testConnection() {
    try {
        const button = document.querySelector('button[onclick="testConnection()"]');
        const environment = document.getElementById('environment').value;
        const clientId = document.getElementById('clientId').value;
        const clientSecret = document.getElementById('clientSecret').value;
        const middlewareUrl = document.getElementById('middlewareUrl').value;
        
        if (!middlewareUrl || !clientId || !clientSecret) {
            throw new Error('Middleware URL, Client ID, and Client Secret are required');
        }

        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
        button.disabled = true;

        const response = await fetch('/api/lhdn/test-connection', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                environment,
                middlewareUrl,
                clientId,
                clientSecret
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Connection test failed');
        }

        const data = await response.json();
        
        if (data.success) {
            showSuccess(`Successfully connected to LHDN API. Token expires in ${data.expiresIn} minutes.`);
        } else {
            throw new Error(data.error || 'Connection test failed');
        }
    } catch (error) {
        showError('Connection test failed: ' + error.message);
    } finally {
        const button = document.querySelector('button[onclick="testConnection()"]');
        button.innerHTML = '<i class="fas fa-plug"></i> Test Connection';
        button.disabled = false;
    }
}

async function saveLHDNConfig() {
    try {
        const config = {
            environment: document.getElementById('environment').value,
            middlewareUrl: document.getElementById('middlewareUrl').value,
            apiKey: document.getElementById('apiKey').value,
            clientId: document.getElementById('clientId').value,
            clientSecret: document.getElementById('clientSecret').value,
            timeout: document.getElementById('timeout').value,
            retryEnabled: document.getElementById('retryEnabled').checked
        };

        // Validate required fields
        if (!config.middlewareUrl || !config.apiKey) {
            throw new Error('Middleware URL and API Key are required');
        }

        const response = await fetch('/api/middleware/save-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });

        if (!response.ok) {
            throw new Error('Failed to save configuration');
        }

        showSuccess('Middleware configuration saved successfully');
    } catch (error) {
        showError(error.message || 'Failed to save configuration');
    }
}

function updateLHDNUrl() {
    const environment = document.getElementById('environment').value;
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

        if (environment === 'default') {
            urlInput.value = 'preprod-api.myinvois.hasil.gov.my';
        } else if (environment === 'sandbox') {
            urlInput.value = 'preprod-api.myinvois.hasil.gov.my';
        } else if (environment === 'production') {
            urlInput.value = 'api.myinvois.hasil.gov.my';
        } else {
            urlInput.value = 'api.myinvois.hasil.gov.my';
        }

        await Swal.fire({
            icon: 'success',
            title: 'LHDN e-Invoice environment selected: '  + environment,
            text: 'BaseURL: ' + urlInput.value,
            timer: 5000,
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
