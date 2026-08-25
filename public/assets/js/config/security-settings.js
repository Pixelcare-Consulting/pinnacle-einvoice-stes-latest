// Initialize security settings
document.addEventListener('DOMContentLoaded', function() {
    // Load saved settings
    loadSecuritySettings();
    
    // Setup event listeners for toggles that show/hide additional options
    setupToggleListeners();
});

function setupToggleListeners() {
    // IP Restriction toggle
    const ipRestriction = document.getElementById('ipRestriction');
    const ipSettings = document.getElementById('ipRestrictionSettings');
    if (ipRestriction && ipSettings) {
        ipRestriction.addEventListener('change', function() {
            ipSettings.style.display = this.checked ? 'block' : 'none';
        });
    }

    // Password expiry toggle
    const passwordExpiry = document.getElementById('passwordExpiry');
    const expiryDays = document.getElementById('passwordExpiryDays');
    if (passwordExpiry && expiryDays) {
        passwordExpiry.addEventListener('change', function() {
            expiryDays.style.display = this.checked ? 'block' : 'none';
        });
    }

    // Recovery phone toggle
    const recoveryPhone = document.getElementById('recoveryPhone');
    const phoneNumber = document.getElementById('recoveryPhoneNumber');
    if (recoveryPhone && phoneNumber) {
        recoveryPhone.addEventListener('change', function() {
            phoneNumber.style.display = this.checked ? 'block' : 'none';
        });
    }
}

async function loadSecuritySettings() {
    try {
        const response = await fetch('/api/user/security-settings');
        const data = await response.json();

        if (data.success) {
            // Two-Factor Authentication
            const twoFactorAuth = document.getElementById('twoFactorAuth');
            if (twoFactorAuth) {
                twoFactorAuth.checked = data.settings.twoFactorEnabled || false;
            }
            
            // Login Notifications
            const loginNotifications = document.getElementById('loginNotifications');
            if (loginNotifications) {
                loginNotifications.checked = data.settings.loginNotificationsEnabled || false;
            }
            
            // IP Restriction
            const ipRestriction = document.getElementById('ipRestriction');
            const ipSettings = document.getElementById('ipRestrictionSettings');
            const allowedIPs = document.getElementById('allowedIPs');
            
            if (ipRestriction) {
                ipRestriction.checked = data.settings.ipRestrictionEnabled || false;
            }
            if (ipSettings && data.settings.ipRestrictionEnabled) {
                ipSettings.style.display = 'block';
            }
            if (allowedIPs) {
                allowedIPs.value = data.settings.allowedIPs || '';
            }

            // Session Settings
            const singleSession = document.getElementById('singleSession');
            const sessionTimeout = document.getElementById('sessionTimeout');
            
            if (singleSession) {
                singleSession.checked = data.settings.singleSessionOnly || false;
            }
            if (sessionTimeout) {
                sessionTimeout.value = data.settings.sessionTimeout || '30';
            }

            // Invoice Security
            const invoiceApproval = document.getElementById('invoiceApproval');
            const auditLog = document.getElementById('auditLog');
            const digitalSignature = document.getElementById('digitalSignature');
            
            if (invoiceApproval) {
                invoiceApproval.checked = data.settings.requireInvoiceApproval || false;
            }
            if (auditLog) {
                auditLog.checked = data.settings.auditLogEnabled || false;
            }
            if (digitalSignature) {
                digitalSignature.checked = data.settings.digitalSignatureEnabled || false;
            }

            // Password Security
            const passwordExpiry = document.getElementById('passwordExpiry');
            const expiryDays = document.getElementById('passwordExpiryDays');
            const passwordHistory = document.getElementById('passwordHistory');
            
            if (passwordExpiry) {
                passwordExpiry.checked = data.settings.passwordExpiryEnabled || false;
            }
            if (expiryDays) {
                if (data.settings.passwordExpiryEnabled) {
                    expiryDays.style.display = 'block';
                }
                expiryDays.value = data.settings.passwordExpiryDays || '30';
            }
            if (passwordHistory) {
                passwordHistory.value = data.settings.passwordHistoryCount || '3';
            }

            // Account Recovery
            const recoveryEmail = document.getElementById('recoveryEmail');
            const recoveryPhone = document.getElementById('recoveryPhone');
            const phoneNumber = document.getElementById('recoveryPhoneNumber');
            
            if (recoveryEmail) {
                recoveryEmail.checked = data.settings.emailRecoveryEnabled || false;
            }
            if (recoveryPhone) {
                recoveryPhone.checked = data.settings.phoneRecoveryEnabled || false;
            }
            if (phoneNumber) {
                if (data.settings.phoneRecoveryEnabled) {
                    phoneNumber.style.display = 'block';
                }
                phoneNumber.value = data.settings.recoveryPhoneNumber || '';
            }
        }
    } catch (error) {
        console.error('Error loading security settings:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to load security settings',
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    }
}

async function saveSecuritySettings() {
    try {
        // Show loading state
        Swal.fire({
            title: 'Saving Security Settings',
            text: 'Please wait while we update your security preferences...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            allowEnterKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const settings = {
            // Two-Factor Authentication
            twoFactorEnabled: document.getElementById('twoFactorAuth').checked,
            
            // Login Notifications
            loginNotificationsEnabled: document.getElementById('loginNotifications').checked,
            
            // IP Restriction
            ipRestrictionEnabled: document.getElementById('ipRestriction').checked,
            allowedIPs: document.getElementById('allowedIPs').value,
            
            // Session Settings
            singleSessionOnly: document.getElementById('singleSession').checked,
            sessionTimeout: document.getElementById('sessionTimeout').value,
            
            // Invoice Security
            requireInvoiceApproval: document.getElementById('invoiceApproval').checked,
            auditLogEnabled: document.getElementById('auditLog').checked,
            digitalSignatureEnabled: document.getElementById('digitalSignature').checked,
            
            // Password Security
            passwordExpiryEnabled: document.getElementById('passwordExpiry').checked,
            passwordExpiryDays: document.getElementById('passwordExpiryDays').value,
            passwordHistoryCount: document.getElementById('passwordHistory').value,
            
            // Account Recovery
            emailRecoveryEnabled: document.getElementById('recoveryEmail').checked,
            phoneRecoveryEnabled: document.getElementById('recoveryPhone').checked,
            recoveryPhoneNumber: document.getElementById('recoveryPhoneNumber').value
        };

        // Validate settings
        if (settings.ipRestrictionEnabled && !settings.allowedIPs) {
            throw new Error('Please enter allowed IP addresses when IP restriction is enabled');
        }

        if (settings.phoneRecoveryEnabled && !settings.recoveryPhoneNumber) {
            throw new Error('Please enter a recovery phone number when phone recovery is enabled');
        }

        const response = await fetch('/api/user/security-settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });

        const result = await response.json();
        
        if (result.success) {
            await Swal.fire({
                icon: 'success',
                title: 'Settings Saved',
                text: 'Your security settings have been updated successfully',
                timer: 3000,
                timerProgressBar: true,
                showConfirmButton: false,
                position: 'top-end',
                toast: true
            });

            // If 2FA was enabled, show setup instructions
            if (settings.twoFactorEnabled && !result.twoFactorAlreadySetup) {
                await show2FASetupInstructions(result.twoFactorSetupData);
            }
        } else {
            throw new Error(result.message || 'Failed to update security settings');
        }
    } catch (error) {
        console.error('Error saving security settings:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to save security settings',
            timer: 5000,
            timerProgressBar: true,
            showConfirmButton: true,
            position: 'top',
            toast: false
        });
    }
}

async function show2FASetupInstructions(setupData) {
    const { qrCode, secretKey } = setupData;
    
    await Swal.fire({
        title: 'Set Up Two-Factor Authentication',
        html: `
            <div class="two-factor-setup">
                <p>Scan this QR code with your authenticator app:</p>
                <div class="qr-code-container">
                    <img src="${qrCode}" alt="2FA QR Code">
                </div>
                <p>Or enter this code manually:</p>
                <div class="secret-key">
                    <code>${secretKey}</code>
                    <button class="btn btn-sm btn-outline-secondary" onclick="copyToClipboard('${secretKey}')">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>
                <div class="mt-3">
                    <input type="text" class="form-control" id="verificationCode" 
                           placeholder="Enter verification code">
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Verify',
        cancelButtonText: 'Do this later',
        showLoaderOnConfirm: true,
        preConfirm: async () => {
            const code = document.getElementById('verificationCode').value;
            if (!code) {
                Swal.showValidationMessage('Please enter the verification code');
                return false;
            }
            
            try {
                const response = await fetch('/api/user/verify-2fa', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ code })
                });
                
                const result = await response.json();
                if (!result.success) {
                    throw new Error(result.message || 'Invalid verification code');
                }
                
                return result;
            } catch (error) {
                Swal.showValidationMessage(error.message);
                return false;
            }
        }
    }).then((result) => {
        if (result.isConfirmed) {
            Swal.fire({
                icon: 'success',
                title: '2FA Enabled',
                text: 'Two-factor authentication has been successfully set up',
                timer: 3000,
                timerProgressBar: true,
                showConfirmButton: false,
                position: 'top-end',
                toast: true
            });
        } else if (result.dismiss === Swal.DismissReason.cancel) {
            Swal.fire({
                icon: 'warning',
                title: 'Setup Incomplete',
                text: 'Please complete 2FA setup in security settings later',
                timer: 3000,
                timerProgressBar: true,
                showConfirmButton: false,
                position: 'top-end',
                toast: true
            });
        }
    });
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        Swal.fire({
            icon: 'success',
            title: 'Copied!',
            text: 'Secret key copied to clipboard',
            timer: 1500,
            timerProgressBar: true,
            showConfirmButton: false,
            position: 'top-end',
            toast: true
        });
    }).catch(err => {
        console.error('Failed to copy text:', err);
    });
}

function validatePassword(password) {
    // Get all requirement items
    const requirements = {
        length: { element: document.getElementById('length-check'), regex: /.{8,}/ },
        uppercase: { element: document.getElementById('uppercase-check'), regex: /[A-Z]/ },
        lowercase: { element: document.getElementById('lowercase-check'), regex: /[a-z]/ },
        number: { element: document.getElementById('number-check'), regex: /[0-9]/ },
        special: { element: document.getElementById('special-check'), regex: /[!@#$%^&*]/ }
    };

    let isValid = true;

    // Check each requirement
    for (const [key, requirement] of Object.entries(requirements)) {
        const meetsRequirement = requirement.regex.test(password);
        
        // Update UI
        if (meetsRequirement) {
            requirement.element.classList.remove('invalid');
            requirement.element.classList.add('valid');
            requirement.element.querySelector('.requirement-icon i').className = 'fas fa-check-circle';
        } else {
            requirement.element.classList.remove('valid');
            requirement.element.classList.add('invalid');
            requirement.element.querySelector('.requirement-icon i').className = 'fas fa-circle';
            isValid = false;
        }
    }

    return isValid;
}

// Add input listener to password field
document.getElementById('newPassword').addEventListener('input', function(e) {
    validatePassword(e.target.value);
});

// Reset requirements on page load
document.addEventListener('DOMContentLoaded', function() {
    const requirementItems = document.querySelectorAll('.requirement-item');
    requirementItems.forEach(item => {
        item.classList.remove('valid', 'invalid');
        item.querySelector('.requirement-icon i').className = 'fas fa-circle';
    });
}); 