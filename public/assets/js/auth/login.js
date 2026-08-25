document.addEventListener('DOMContentLoaded', function() {
    // Get DOM elements with null checks
    const loginForm = document.getElementById('loginForm');
    const loginButton = document.getElementById('loginButton');
    const spinner = loginButton?.querySelector('.spinner-border');
    const buttonText = loginButton?.querySelector('.btn-text');
    const togglePassword = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('password');
    const loginSuccess = document.getElementById('loginSuccess');
    const sessionReconnect = document.getElementById('sessionReconnect');
    const reconnectBtn = document.getElementById('reconnectBtn');
    const newSessionBtn = document.getElementById('newSessionBtn');
    const reconnectField = document.getElementById('reconnectField');

    // Only proceed with form setup if required elements exist
    if (!loginForm || !loginButton || !passwordInput) {
        console.error('Required login form elements not found');
        return;
    }

    let remainingAttempts = 5;

    // Password visibility toggle
    if (togglePassword) {
        togglePassword.addEventListener('click', function() {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            const icon = this.querySelector('i');
            if (icon) {
                icon.className = `bi bi-${type === 'password' ? 'eye' : 'eye-slash'}`;
            }
        });
    }

    // Check for active session on page load
    function checkForActiveSession() {
        const username = document.getElementById('username')?.value;
        if (!username) return;

        fetch('/api/user/check-session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ username })
        })
        .then(response => {
            if (!response.ok) {
                // If response is not OK, just log it but don't throw an error
                console.log('Session check returned status:', response.status);
                // Don't redirect on 401 from session check
                return { hasActiveSession: false };
            }
            return response.json();
        })
        .then(data => {
            if (data.hasActiveSession) {
                showSessionReconnect();
            }
        })
        .catch(error => {
            // Just log the error but don't disrupt the login flow
            console.error('Error checking for active session:', error);
        });
    }

    // Show session reconnection UI with enhanced animation
    function showSessionReconnect() {
        if (!sessionReconnect) return;

        // Reset any existing state
        sessionReconnect.classList.remove('show');

        // Force reflow to restart animations
        void sessionReconnect.offsetWidth;

        // Show notification with animation
        sessionReconnect.classList.add('show');

        // Add a subtle entrance animation
        sessionReconnect.style.animation = 'fadeInDown 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';

        // Add a pulsing effect to the reconnect button
        const reconnectBtn = document.getElementById('reconnectBtn');
        if (reconnectBtn) {
            reconnectBtn.classList.add('pulse-animation');
        }

        // Auto-hide after 30 seconds if no action taken
        const hideTimeout = setTimeout(() => {
            if (sessionReconnect.classList.contains('show')) {
                sessionReconnect.style.animation = 'fadeOutUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
                setTimeout(() => {
                    sessionReconnect.classList.remove('show');
                    if (reconnectBtn) {
                        reconnectBtn.classList.remove('pulse-animation');
                    }
                }, 500);
            }
        }, 30000);

        // Store the timeout ID so it can be cleared if needed
        sessionReconnect.dataset.hideTimeout = hideTimeout;
    }

    // Add the animations if they don't exist
    if (!document.getElementById('session-animations')) {
        const style = document.createElement('style');
        style.id = 'session-animations';
        style.textContent = `
            @keyframes fadeInDown {
                from { opacity: 0; transform: translateX(-50%) translateY(-50px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
            @keyframes fadeOutUp {
                from { opacity: 1; transform: translateX(-50%) translateY(0); }
                to { opacity: 0; transform: translateX(-50%) translateY(-50px); }
            }
            @keyframes pulse {
                0% { box-shadow: 0 0 0 0 rgba(13, 110, 253, 0.4); }
                70% { box-shadow: 0 0 0 10px rgba(13, 110, 253, 0); }
                100% { box-shadow: 0 0 0 0 rgba(13, 110, 253, 0); }
            }
            .pulse-animation {
                animation: pulse 1.5s infinite;
            }
        `;
        document.head.appendChild(style);
    }

    // Handle session reconnection with smooth animation
    if (reconnectBtn) {
        reconnectBtn.addEventListener('click', function() {
            if (reconnectField) {
                reconnectField.value = 'true';
            }

            // Clear any existing timeout
            if (sessionReconnect && sessionReconnect.dataset.hideTimeout) {
                clearTimeout(parseInt(sessionReconnect.dataset.hideTimeout));
            }

            // Add a success animation to the button
            this.classList.add('btn-success');
            this.classList.remove('pulse-animation');
            this.innerHTML = '<i class="bi bi-check-circle me-1"></i>Reconnecting...';

            // Hide the reconnect UI with animation
            if (sessionReconnect) {
                sessionReconnect.style.animation = 'fadeOutUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
                setTimeout(() => {
                    sessionReconnect.classList.remove('show');
                    // Submit the form after animation completes
                    loginForm.submit();
                }, 500);
            } else {
                // Submit the form immediately if animation not possible
                loginForm.submit();
            }
        });
    }

    // Handle new session button with smooth animation
    if (newSessionBtn) {
        newSessionBtn.addEventListener('click', function() {
            if (reconnectField) {
                reconnectField.value = 'false';
            }

            // Clear any existing timeout
            if (sessionReconnect && sessionReconnect.dataset.hideTimeout) {
                clearTimeout(parseInt(sessionReconnect.dataset.hideTimeout));
            }

            // Add a subtle animation to the button
            this.classList.add('active');

            // Hide the reconnect UI with animation
            if (sessionReconnect) {
                sessionReconnect.style.animation = 'fadeOutUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
                setTimeout(() => {
                    sessionReconnect.classList.remove('show');
                    this.classList.remove('active');

                    // Show the force logout modal after animation completes
                    showSessionModal();
                }, 500);
            } else {
                // Show modal immediately if animation not possible
                showSessionModal();
            }
        });
    }

    // Username input change listener to check for active sessions
    const usernameInput = document.getElementById('username');
    if (usernameInput) {
        usernameInput.addEventListener('blur', function() {
            if (this.value.trim()) {
                checkForActiveSession();
            }
        });
    }

    // Show login success notification with enhanced animation
    function showLoginSuccess() {
        if (!loginSuccess) return;

        // Reset any existing animations
        loginSuccess.classList.remove('show');

        // Force reflow to restart animations
        void loginSuccess.offsetWidth;

        // Show notification with animation
        loginSuccess.classList.add('show');

        // Add a subtle entrance animation
        loginSuccess.style.animation = 'fadeInDown 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';

        // Auto-hide after animation completes
        setTimeout(() => {
            loginSuccess.style.animation = 'fadeOutUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
            setTimeout(() => {
                loginSuccess.classList.remove('show');
            }, 500);
        }, 3000);
    }

    // Define the animations
    if (!document.getElementById('notification-animations')) {
        const style = document.createElement('style');
        style.id = 'notification-animations';
        style.textContent = `
            @keyframes fadeInDown {
                from { opacity: 0; transform: translateX(-50%) translateY(-50px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
            @keyframes fadeOutUp {
                from { opacity: 1; transform: translateX(-50%) translateY(0); }
                to { opacity: 0; transform: translateX(-50%) translateY(-50px); }
            }
        `;
        document.head.appendChild(style);
    }

    // Form validation and submission - using fetch for better UX
    loginForm.addEventListener('submit', function(event) {
        // Check form validity
        if (!this.checkValidity()) {
            event.preventDefault();
            event.stopPropagation();
            this.classList.add('was-validated');
            return;
        }

        // Show loading state
        if (spinner && buttonText) {
            loginButton.disabled = true;
            spinner.classList.remove('d-none');
            buttonText.textContent = 'Signing in...';
        }

        // Get form data
        const formData = new FormData(this);
        const formDataObj = Object.fromEntries(formData.entries());

        // Use fetch API for better UX
        event.preventDefault();

        fetch('/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(formDataObj),
            credentials: 'same-origin'
        })
        .then(response => {
            // If we get a 404 error, try the alternative login endpoint
            if (response.status === 404) {
                console.log('Login endpoint not found, trying alternative endpoint...');
                // Try the alternative endpoint
                return fetch('/api/v1/auth/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(formDataObj),
                    credentials: 'same-origin'
                });
            }

            // If we get a 500 error but the login actually worked
            if (response.status === 500) {
                // Check if we're actually logged in by trying to access the dashboard
                fetch('/dashboard', {
                    method: 'HEAD',
                    credentials: 'same-origin'
                }).then(dashboardResponse => {
                    if (dashboardResponse.ok) {
                        // We're actually logged in despite the 500 error
                        showLoginSuccess();
                        setTimeout(() => {
                            window.location.href = '/dashboard';
                        }, 1000);
                        return;
                    } else {
                        // It's a real error
                        throw response;
                    }
                }).catch(() => {
                    throw response;
                });
                return { success: false, handled: true };
            }

            if (!response.ok) {
                throw response;
            }
            return response.json();
        })
        .then(data => {
            // Skip further processing if we already handled it
            if (data.handled) return;

            if (data.success) {
                console.log('[Frontend] Login successful.');
                // Show success notification
                showLoginSuccess();

                // Log authentication data
                console.log('=== CLIENT-SIDE AUTH DATA ===');
                console.log('[Frontend] Login successful:', data.success);
                console.log('[Frontend] User data:', data.user || 'Not provided');
                console.log('[Frontend] Session ID:', data.sessionId || 'Not provided');
                console.log('[Frontend] Is Admin:', data.isAdmin || 'Not provided');
                console.log('[Frontend] Redirect URL:', data.redirectUrl || '/dashboard');
                console.log('=== END CLIENT-SIDE AUTH DATA ===');

                // Fetch and log user session data
                fetch('/api/user/session-info', {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    credentials: 'same-origin'
                })
                .then(response => response.json())
                .then(sessionData => {
                    console.log('=== USER SESSION DATA ===');
                    console.log('[Frontend] Session User:', sessionData.user || 'Not available');
                    console.log('[Frontend] Is Admin:', sessionData.isAdmin || 'Not available');
                    console.log('[Frontend] Auth Token:', sessionData.token || 'Not available');
                    console.log('[Frontend] Session ID:', sessionData.sessionId || 'Not available');
                    console.log('[Frontend] Complete Session Data:', sessionData);
                    console.log('=== END USER SESSION DATA ===');
                })
                .catch(error => {
                    console.error('[Frontend] Error fetching session data:', error);
                });

                // Redirect after a short delay
                setTimeout(() => {
                    // Force a hard redirect to dashboard to ensure session is recognized
                    window.location.replace(data.redirectUrl || '/dashboard');
                }, 1000);
            } else if (data.activeSession) {
                console.log('[Frontend] Active session detected.');
                // Show session reconnect UI
                showSessionReconnect();

                // Reset form state
                if (spinner && buttonText) {
                    loginButton.disabled = false;
                    spinner.classList.add('d-none');
                    buttonText.textContent = 'Sign In';
                }
            } else {
                // Show error message
                showLoginError(data.message || 'Invalid credentials');

                // Reset form state
                if (spinner && buttonText) {
                    loginButton.disabled = false;
                    spinner.classList.add('d-none');
                    buttonText.textContent = 'Sign In';
                }
            }
        })
        .catch(error => {
            console.error('Login error:', error);

            // Handle different error types
            if (error.status === 401) {
                // Try to parse the response to see if it contains a message
                error.json().then(data => {
                    if (data && data.message) {
                        showLoginError(data.message);
                    } else {
                        showLoginError('Invalid username or password');
                    }
                }).catch(() => {
                    showLoginError('Invalid username or password');
                });
            } else if (error.status === 404) {
                showLoginError('Login service not available. Please try again or contact support.');
                console.error('Login endpoint not found. Check server configuration.');
            } else if (error.status === 409) {
                // Handle 409 Conflict - User already logged in
                console.log('User already logged in (409 Conflict)');
                showAlreadyLoggedInModal();
            } else if (error.status === 429) {
                showLoginError('Too many login attempts. Please try again later.');
            } else if (error.status === 500) {
                // For 500 errors, check if we need to refresh
                setTimeout(() => {
                    fetch('/dashboard', {
                        method: 'HEAD',
                        credentials: 'same-origin'
                    }).then(response => {
                        if (response.ok) {
                            // We're actually logged in despite the error
                            showLoginSuccess();
                            setTimeout(() => {
                                window.location.href = '/dashboard';
                            }, 1000);
                        } else {
                            showLoginError('Server error. Please try again.');
                        }
                    }).catch(() => {
                        showLoginError('Server error. Please try again.');
                    });
                }, 1000);
            } else {
                showLoginError('An error occurred. Please try again.');
            }

            // Reset form state
            if (spinner && buttonText) {
                loginButton.disabled = false;
                spinner.classList.add('d-none');
                buttonText.textContent = 'Sign In';
            }
        });
    });

    // Show login error message
    function showLoginError(message) {
        // Create alert if it doesn't exist
        let alertElement = document.querySelector('.login-alert');

        if (!alertElement) {
            alertElement = document.createElement('div');
            alertElement.className = 'alert alert-danger alert-dismissible fade show login-alert mb-4';
            alertElement.setAttribute('role', 'alert');

            const closeButton = document.createElement('button');
            closeButton.className = 'btn-close';
            closeButton.setAttribute('type', 'button');
            closeButton.setAttribute('data-bs-dismiss', 'alert');
            closeButton.setAttribute('aria-label', 'Close');

            alertElement.appendChild(closeButton);

            // Insert at the top of the form
            loginForm.insertAdjacentElement('beforebegin', alertElement);
        }

        // Update message
        alertElement.innerHTML = `
            <div class="d-flex align-items-center">
                <i class="bi bi-exclamation-circle-fill me-2"></i>
                <div>${message}</div>
                <button type="button" class="btn-close ms-auto" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;

        // Ensure it's visible
        alertElement.classList.add('show');
    }

    // Function to show session modal dynamically
    function showSessionModal() {
        const modalHTML = `
            <div class="modal-overlay" id="sessionErrorModal">
                <div class="modal-container">
                    <div class="modal-header session-error">
                        <div class="warning-icon">
                            <i class="bi bi-exclamation-triangle"></i>
                        </div>
                        <h4 class="modal-title">Active Session Detected</h4>
                        <p>This user is already logged in from another session.</p>
                    </div>
                    <div class="modal-body session-error-body">
                        <p>Would you like to terminate all other sessions and start a new one?</p>
                        <p class="text-danger small">Note: This will log out all other devices where this account is currently active.</p>
                    </div>
                    <div class="session-error-footer">
                        <button class="btn btn-secondary w-100" data-action="cancel">Cancel</button>
                        <button class="btn btn-primary w-100" data-action="confirm">Continue with New Session</button>
                    </div>
                    <div class="modal-help">
                        <a href="/help/session-management">Need help with sessions?</a>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        const modal = document.getElementById('sessionErrorModal');

        // Prevent body scroll
        document.body.style.overflow = 'hidden';

        // Force reflow
        modal.offsetHeight;

        // Add visible class after a frame
        requestAnimationFrame(() => {
            modal.classList.add('visible');
        });

        // Add event listeners
        setupModalListeners(modal);
    }

    // Function to setup modal listeners
    function setupModalListeners(modal) {
        if (!modal) return;

        const confirmBtn = modal.querySelector('[data-action="confirm"]');
        const cancelBtn = modal.querySelector('[data-action="cancel"]');

        confirmBtn?.addEventListener('click', () => {
            closeModalWithAnimation(() => {
                // Set the reconnect field to 'force'
                if (reconnectField) {
                    reconnectField.value = 'force';
                }

                // Submit the form
                loginForm.submit();
            });
        });

        cancelBtn?.addEventListener('click', () => {
            closeModalWithAnimation();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModalWithAnimation();
            }
        });

        // Add keyboard listeners
        document.addEventListener('keydown', function modalKeyHandler(e) {
            if (!modal) {
                document.removeEventListener('keydown', modalKeyHandler);
                return;
            }

            if (e.key === 'Escape') {
                closeModalWithAnimation();
            } else if (e.key === 'Enter' && document.activeElement.tagName !== 'BUTTON') {
                confirmBtn?.click();
            }
        });
    }

    // Function to handle modal closing animation
    function closeModalWithAnimation(callback) {
        const modal = document.getElementById('sessionErrorModal');
        if (!modal) return;

        modal.classList.remove('visible');
        modal.classList.add('modal-closing');

        setTimeout(() => {
            if (callback) {
                callback();
            }
            modal.remove();
            document.body.style.overflow = '';
        }, 150); // Match the transition duration
    }

    // Initialize modal if it exists on page load
    const initialModal = document.getElementById('sessionErrorModal');
    if (initialModal) {
        // Force reflow
        initialModal.offsetHeight;

        // Add visible class after a frame
        requestAnimationFrame(() => {
            initialModal.classList.add('visible');
        });
        setupModalListeners(initialModal);
    }

    // Phase Info Modal Functionality
    const phaseInfoBtn = document.getElementById('phaseInfoBtn');
    const phaseInfoModal = document.getElementById('phaseInfoModal');

    if (phaseInfoBtn && phaseInfoModal) {
        phaseInfoBtn.addEventListener('click', () => {
            phaseInfoModal.style.display = 'flex';
            // Force reflow
            phaseInfoModal.offsetHeight;
            requestAnimationFrame(() => {
                phaseInfoModal.classList.add('visible');
            });
        });

        // Close modal when clicking outside or on close button
        phaseInfoModal.addEventListener('click', (e) => {
            if (e.target === phaseInfoModal || e.target.closest('[data-action="close"]')) {
                closePhaseModal();
            }
        });

        // Close on ESC key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && phaseInfoModal.classList.contains('visible')) {
                closePhaseModal();
            }
        });
    }

    function closePhaseModal() {
        const modal = document.getElementById('phaseInfoModal');
        if (!modal) return;

        modal.classList.remove('visible');
        modal.classList.add('modal-closing');

        setTimeout(() => {
            modal.classList.remove('modal-closing');
            modal.style.display = 'none';
        }, 150);
    }

    // Function to show "Already Logged In" modal for 409 Conflict errors
    function showAlreadyLoggedInModal() {
        const modalHTML = `
            <div class="modal-overlay" id="alreadyLoggedInModal">
                <div class="modal-container">
                    <div class="modal-header already-logged-in">
                        <div class="info-icon">
                            <i class="bi bi-person-check-fill"></i>
                        </div>
                        <h4 class="modal-title">Already Logged In</h4>
                        <p>You are already logged into your account.</p>
                    </div>
                    <div class="modal-body already-logged-in-body">
                        <p>It looks like you're already signed in to your account. You can:</p>
                        <ul class="options-list">
                            <li><strong>Continue to Dashboard</strong> - Access your account normally</li>
                            <li><strong>Force New Login</strong> - End all other sessions and start fresh</li>
                        </ul>
                        <p class="text-muted small">If you're having trouble accessing your account, try forcing a new login.</p>
                    </div>
                    <div class="already-logged-in-footer">
                        <button class="btn btn-outline-secondary" data-action="cancel">Cancel</button>
                        <button class="btn btn-success" data-action="dashboard">Go to Dashboard</button>
                        <button class="btn btn-primary" data-action="force-login">Force New Login</button>
                    </div>
                    <div class="modal-help">
                        <a href="/help/login-issues">Having login issues?</a>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        const modal = document.getElementById('alreadyLoggedInModal');

        // Prevent body scroll
        document.body.style.overflow = 'hidden';

        // Force reflow
        modal.offsetHeight;

        // Add visible class after a frame
        requestAnimationFrame(() => {
            modal.classList.add('visible');
        });

        // Add event listeners
        setupAlreadyLoggedInModalListeners(modal);
    }

    // Function to setup "Already Logged In" modal listeners
    function setupAlreadyLoggedInModalListeners(modal) {
        if (!modal) return;

        const dashboardBtn = modal.querySelector('[data-action="dashboard"]');
        const forceLoginBtn = modal.querySelector('[data-action="force-login"]');
        const cancelBtn = modal.querySelector('[data-action="cancel"]');

        dashboardBtn?.addEventListener('click', () => {
            closeAlreadyLoggedInModalWithAnimation(() => {
                // Show success message and redirect to dashboard
                showLoginSuccess();
                setTimeout(() => {
                    window.location.href = '/dashboard';
                }, 1000);
            });
        });

        forceLoginBtn?.addEventListener('click', () => {
            closeAlreadyLoggedInModalWithAnimation(() => {
                // Set the reconnect field to 'force' and submit the form
                if (reconnectField) {
                    reconnectField.value = 'force';
                }
                loginForm.submit();
            });
        });

        cancelBtn?.addEventListener('click', () => {
            closeAlreadyLoggedInModalWithAnimation();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeAlreadyLoggedInModalWithAnimation();
            }
        });

        // Add keyboard listeners
        document.addEventListener('keydown', function modalKeyHandler(e) {
            if (!modal) {
                document.removeEventListener('keydown', modalKeyHandler);
                return;
            }

            if (e.key === 'Escape') {
                closeAlreadyLoggedInModalWithAnimation();
            } else if (e.key === 'Enter' && document.activeElement.tagName !== 'BUTTON') {
                dashboardBtn?.click();
            }
        });
    }

    // Function to handle "Already Logged In" modal closing animation
    function closeAlreadyLoggedInModalWithAnimation(callback) {
        const modal = document.getElementById('alreadyLoggedInModal');
        if (!modal) return;

        modal.classList.remove('visible');
        modal.classList.add('modal-closing');

        setTimeout(() => {
            if (callback) {
                callback();
            }
            modal.remove();
            document.body.style.overflow = '';
        }, 150); // Match the transition duration
    }
});
