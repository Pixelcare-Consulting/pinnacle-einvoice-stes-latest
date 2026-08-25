// User Management Functions
document.addEventListener('DOMContentLoaded', function() {
    // Load users list on page load
    loadUsersList();

    // Initialize event listeners
    initializeEventListeners();

    // Initialize tooltips globally
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
});

// Global variables for user management
let currentUserId = null;
let usersTable = null;
let currentPage = 1;
let itemsPerPage = 10;
let totalUsers = 0;

function initializeEventListeners() {
    // Add user form submission
    document.getElementById('addUserForm')?.addEventListener('submit', handleAddUser);

    // Edit user form submission
    document.getElementById('editUserForm')?.addEventListener('submit', handleEditUser);

    // Initialize pagination
    document.querySelectorAll('.pagination .page-link').forEach(link => {
        link.addEventListener('click', handlePaginationClick);
    });

    // Load company TINs when modal opens
    document.getElementById('addUserModal')?.addEventListener('show.bs.modal', function() {
        // Use the loadCompanyTINs helper function
        loadCompanyTINs('newUserTIN');
    });

    // Handle TIN selection change
    document.getElementById('newUserTIN')?.addEventListener('change', function(e) {
        const selectedOption = this.options[this.selectedIndex];
        if (selectedOption.dataset.companyData) {
            const companyData = JSON.parse(selectedOption.dataset.companyData);
            // Auto-fill company related fields if needed
            document.getElementById('newUserIDType').value = 'BRN';
            document.getElementById('newUserIDValue').value = companyData.BRN || '';
            // You can add more auto-fill fields here
        }
    });

    // Username generation from full name with suggestions
    document.getElementById('newUserName')?.addEventListener('input', function(e) {
        const fullName = e.target.value;
        const email = document.getElementById('newUserEmail').value;
        const suggestions = generateUsernameSuggestions(fullName, email);

        // Update dropdown suggestions
        const dropdown = document.getElementById('usernameSuggestions');
        dropdown.innerHTML = '';
        suggestions.forEach(suggestion => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.className = 'dropdown-item';
            a.href = '#';
            a.textContent = suggestion;
            a.onclick = (e) => {
                e.preventDefault();
                document.getElementById('newUserUsername').value = suggestion;
            };
            li.appendChild(a);
            dropdown.appendChild(li);
        });

        // Set first suggestion as default if username field is empty
        const usernameField = document.getElementById('newUserUsername');
        if (!usernameField.value && suggestions.length > 0) {
            usernameField.value = suggestions[0];
        }
    });

    // Username generation from email (as backup)
    document.getElementById('newUserEmail')?.addEventListener('input', function(e) {
        const email = e.target.value;
        const usernameField = document.getElementById('newUserUsername');
        const nameField = document.getElementById('newUserName');
        // Only update username if name field is empty
        if (usernameField && email && !nameField.value.trim()) {
            const username = email.split('@')[0].toLowerCase()
                .replace(/[^a-z0-9]/g, '') // Remove special characters
                .substring(0, 15); // Limit length to 15 characters
            usernameField.value = username;
        }
    });

    // Navigation between sections
    document.querySelectorAll('.settings-nav-item').forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const targetSection = this.getAttribute('data-section');
            showSection(targetSection);
        });
    });

    // Search functionality
    const searchInput = document.querySelector('.search-box input');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(function(e) {
            filterUsers(e.target.value);
        }, 300));
    }
}

// Handle pagination click
function handlePaginationClick(e) {
    e.preventDefault();

    const clickedLink = e.currentTarget;
    const pageText = clickedLink.textContent.trim();

    // Calculate the target page
    if (pageText === 'Previous') {
        if (currentPage > 1) currentPage--;
    } else if (pageText === 'Next') {
        if ((currentPage * itemsPerPage) < totalUsers) currentPage++;
    } else {
        // Clicked a specific page number
        currentPage = parseInt(pageText);
    }

    // Reload users with the new page
    loadUsersList();
}

// Load users list
async function loadUsersList() {
    try {
        // Show loading indicator
        const tbody = document.getElementById('usersTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center"><i class="fas fa-spinner fa-spin"></i> Loading users...</td></tr>';
        }

        // Fetch users with pagination params
        const response = await fetch(`/api/user/users-list?page=${currentPage}&limit=${itemsPerPage}`);
        if (!response.ok) throw new Error('Failed to fetch users');

        const result = await response.json();

        // Ensure we have valid data
        if (!result || typeof result !== 'object') {
            throw new Error('Invalid response format');
        }

        // Use empty array if users is null or undefined
        const users = Array.isArray(result.users) ? result.users : [];
        totalUsers = result.totalCount || users.length;

        displayUsers(users);
        updatePagination();
    } catch (error) {
        console.error('Error loading users:', error);

        // Show error in the table
        const tbody = document.getElementById('usersTableBody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">
                <i class="fas fa-exclamation-circle me-2"></i>
                Error loading users: ${error.message || 'Unknown error'}
                <br>
                <button class="btn btn-sm btn-outline-primary mt-2" onclick="loadUsersList()">
                    <i class="fas fa-sync"></i> Try Again
                </button>
            </td></tr>`;
        }

        showToast('error', 'Failed to load users list');
    }
}

// Display users in table
function displayUsers(users) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    users.forEach(user => {
        // Ensure user object has all required properties
        if (!user) return;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div class="d-flex align-items-center">
                    <div class="user-avatar me-3">
                        <i class="fas fa-user text-muted"></i>
                    </div>
                    <div>
                        <div class="fw-bold text-dark">${escapeHtml(user.FullName)}</div>
                        <small class="text-muted">@${escapeHtml(user.Username || '')}</small>
                    </div>
                </div>
            </td>
            <td>
                <div class="text-dark">${escapeHtml(user.Email)}</div>
                ${user.Phone ? `<small class="text-muted d-block">${escapeHtml(user.Phone)}</small>` : ''}
            </td>
            <td>
                <span class="role-badge ${user.Admin ? 'admin' : 'regular'}">
                    <i class="fas ${user.Admin ? 'fa-crown' : 'fa-user'} me-1"></i>
                    ${user.Admin ? 'Administrator' : 'Regular User'}
                </span>
            </td>
            <td>
                <span class="status-badge ${user.ValidStatus === '1' || user.ValidStatus === 'Active' ? 'active' : 'inactive'}">
                    <i class="fas ${user.ValidStatus === '1' || user.ValidStatus === 'Active' ? 'fa-check-circle' : 'fa-times-circle'} me-1"></i>
                    ${user.ValidStatus === '1' || user.ValidStatus === 'Active' ? 'Active' : 'Inactive'}
                </span>
            </td>
            <td>
                <div class="text-dark">${user.LastLoginTime ? new Date(user.LastLoginTime).toLocaleDateString() : 'Never'}</div>
                ${user.LastLoginTime ? `<small class="text-muted">${new Date(user.LastLoginTime).toLocaleTimeString()}</small>` : ''}
            </td>
            <td>
                <div class="user-actions">
                    <button type="button" class="action-btn view" onclick="viewDetails(${user.ID || 0})" title="View Details" data-bs-toggle="tooltip">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button type="button" class="action-btn edit" onclick="editUser(${user.ID || 0})" title="Edit User" data-bs-toggle="tooltip">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button type="button" class="action-btn delete" onclick="deleteUser(${user.ID || 0})" title="Delete User" data-bs-toggle="tooltip">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Initialize tooltips for action buttons
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
}

// Update pagination UI
function updatePagination() {
    const paginationElement = document.querySelector('.pagination');
    if (!paginationElement) return;

    // Calculate total pages
    const totalPages = Math.max(1, Math.ceil(totalUsers / itemsPerPage));

    // Create pagination HTML
    let paginationHTML = '';

    // Previous button
    paginationHTML += `
        <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" tabindex="-1">Previous</a>
        </li>
    `;

    // Page numbers
    const maxVisiblePages = 5;
    const startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    for (let i = startPage; i <= endPage; i++) {
        paginationHTML += `
            <li class="page-item ${i === currentPage ? 'active' : ''}">
                <a class="page-link" href="#">${i}</a>
            </li>
        `;
    }

    // Next button
    paginationHTML += `
        <li class="page-item ${currentPage >= totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#">Next</a>
        </li>
    `;

    paginationElement.innerHTML = paginationHTML;

    // Add event listeners to new pagination elements
    document.querySelectorAll('.pagination .page-link').forEach(link => {
        link.addEventListener('click', handlePaginationClick);
    });
}

// Add new user
async function handleAddUser(e) {
    e.preventDefault();

    // Get the button that was clicked
    const submitButton = e.target.querySelector('button[type="submit"]') ||
                        document.querySelector('#addUserModal .modal-footer button.btn-primary');
    const originalText = submitButton ? submitButton.innerHTML : '<i class="fas fa-plus"></i> Create User';

    try {
        if (submitButton) {
            submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
            submitButton.disabled = true;
        }

        // Get form data
        const formData = {
            fullName: document.getElementById('newUserName').value.trim(),
            email: document.getElementById('newUserEmail').value.trim(),
            username: document.getElementById('newUserUsername').value.trim(),
            password: generateTemporaryPassword(), // Generate a temporary password
            userType: document.getElementById('newUserRole').value,
            // TIN handling - this can be null
            TIN: document.getElementById('newUserTIN')?.value ||
                 document.getElementById('newUserCustomTIN')?.value || null,
            IDType: document.getElementById('newUserIDType')?.value || null,
            IDValue: document.getElementById('newUserIDValue')?.value || null,
            phone: document.getElementById('newUserPhone')?.value || null,
            // Admin will be based on role selection
            admin: document.getElementById('newUserRole').value === 'admin' ? 1 : 0,
            validStatus: '1', // Default to active user
            // Security settings
            twoFactorEnabled: document.getElementById('newUserTwoFactor')?.checked || false,
            notificationsEnabled: document.getElementById('newUserNotifications')?.checked || true,
            // Let the server handle dates
        };

        // Additional validation for TIN and ID fields
        if (formData.TIN) {
            formData.TIN = formData.TIN.trim().toUpperCase(); // Ensure TIN is uppercase
        }

        if (formData.IDType && !formData.IDValue) {
            showToast('error', 'Please provide an ID Value when ID Type is selected');
            return;
        }

        if (!formData.IDType && formData.IDValue) {
            showToast('error', 'Please select an ID Type when providing an ID Value');
            return;
        }

        // Validate required fields
        const requiredFields = ['fullName', 'email', 'username'];
        const missingFields = requiredFields.filter(field => !formData[field]);

        if (missingFields.length > 0) {
            showToast('error', `Please fill in all required fields: ${missingFields.join(', ')}`);
            // Reset button state
            if (submitButton) {
                submitButton.innerHTML = originalText;
                submitButton.disabled = false;
            }
            return;
        }

        // Validate email format
        if (!isValidEmail(formData.email)) {
            showToast('error', 'Please enter a valid email address');
            // Reset button state
            if (submitButton) {
                submitButton.innerHTML = originalText;
                submitButton.disabled = false;
            }
            return;
        }

        const response = await fetch('/api/user/users-add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (data.success) {
            // Hide the add user modal
            const addUserModal = bootstrap.Modal.getInstance(document.getElementById('addUserModal'));
            addUserModal.hide();

            // Show success message
            showToast('success', `<strong>User "${formData.username}"</strong> added successfully!`);

            // Show the temporary password
            showPasswordModal(formData.email, formData.password, formData.username);

            // Reset form
            document.getElementById('addUserForm').reset();

            // Reload users list
            loadUsersList();
        } else {
            showToast('error', data.message || 'Failed to add user');
        }
    } catch (error) {
        console.error('Error adding user:', error);
        showToast('error', 'Failed to add user: ' + (error.message || 'Unknown error'));
    } finally {
        // Always reset button state, regardless of success or failure
        if (submitButton) {
            submitButton.innerHTML = originalText;
            submitButton.disabled = false;
        }
    }
}

// Add email validation helper function
function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;

    // Check for any whitespace characters
    if (/\s/.test(email)) return false;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Format date for SQL Server
function formatDateForSQL(date) {
    // Format as YYYY-MM-DD HH:MM:SS
    return date.getFullYear() + '-' +
           String(date.getMonth() + 1).padStart(2, '0') + '-' +
           String(date.getDate()).padStart(2, '0') + ' ' +
           String(date.getHours()).padStart(2, '0') + ':' +
           String(date.getMinutes()).padStart(2, '0') + ':' +
           String(date.getSeconds()).padStart(2, '0');
}

// Add this function to load company TINs
async function loadCompanyTINs(selectId, selectedTIN = '') {
    try {
        // Show loading state in the select element
        const tinSelect = document.getElementById(selectId);
        if (!tinSelect) {
            console.error(`Select element with ID "${selectId}" not found`);
            return;
        }

        tinSelect.innerHTML = '<option value="">Loading companies...</option>';
        tinSelect.disabled = true;

        // Fetch companies with error handling
        const response = await fetch('/api/user/company/list');

        // Handle HTTP errors
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const statusCode = response.status;
            let errorMessage = 'Failed to fetch companies';

            // Provide more specific error messages based on status code
            if (statusCode === 401) {
                errorMessage = 'Your session has expired. Please log in again.';
                // Show session expiry alert and redirect
                Swal.fire({
                    icon: 'warning',
                    title: 'Session Expired',
                    text: 'Your session has expired. You will be redirected to the login page.',
                    timer: 3000,
                    timerProgressBar: true,
                    showConfirmButton: false
                }).then(() => {
                    window.location.href = '/auth/login?expired=true';
                });
                return; // Exit early to prevent further processing
            } else if (statusCode === 403) {
                errorMessage = 'You do not have permission to view company information.';
            } else if (statusCode === 500) {
                errorMessage = 'Server error while fetching companies. Please try again later.';
            }

            // Add any additional error details from the response
            if (errorData.message) {
                errorMessage += `: ${errorData.message}`;
            }

            throw new Error(errorMessage);
        }

        // Parse the JSON response
        const companies = await response.json();

        // Check if companies is an array
        if (!Array.isArray(companies)) {
            throw new Error('Invalid response format: expected an array of companies');
        }

        // Reset the select element
        tinSelect.innerHTML = '<option value="">Select Company TIN</option>';

        // Populate the select element with company options
        if (companies.length === 0) {
            // Handle case when no companies are available
            const noCompaniesOption = document.createElement('option');
            noCompaniesOption.value = "";
            noCompaniesOption.textContent = "No companies available";
            noCompaniesOption.disabled = true;
            tinSelect.appendChild(noCompaniesOption);
        } else {
            // Add company options
            companies.forEach(company => {
                const option = document.createElement('option');
                option.value = company.TIN || company.BRN;
                option.textContent = `${company.CompanyName} (${company.TIN || company.BRN})`;
                option.selected = (company.TIN === selectedTIN || company.BRN === selectedTIN);

                // Store company data as a data attribute for auto-filling
                option.dataset.companyData = JSON.stringify({
                    ID: company.ID,
                    CompanyName: company.CompanyName,
                    TIN: company.TIN,
                    BRN: company.BRN,
                    Email: company.Email,
                    Phone: company.Phone,
                    Address: company.Address
                });

                tinSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading company data:', error);

        // Update the select element to show the error
        const tinSelect = document.getElementById(selectId);
        if (tinSelect) {
            tinSelect.innerHTML = '<option value="">Error loading companies</option>';
            // Add a retry option
            const retryOption = document.createElement('option');
            retryOption.value = "retry";
            retryOption.textContent = "Click here to retry";
            tinSelect.appendChild(retryOption);

            // Add event listener for retry
            tinSelect.addEventListener('change', function(e) {
                if (e.target.value === 'retry') {
                    loadCompanyTINs(selectId, selectedTIN);
                }
            }, { once: true });
        }

        // Show toast notification with the error message
        showToast('error', error.message || 'Failed to load company information');
    } finally {
        // Always re-enable the select element
        const tinSelect = document.getElementById(selectId);
        if (tinSelect) {
            tinSelect.disabled = false;
        }
    }
}

// Edit user
async function editUser(userId) {
    try {
        const response = await fetch(`/api/user/users-list/${userId}`);
        const apiResponse = await response.json();

        if (!apiResponse || !apiResponse.success || !apiResponse.user) {
            throw new Error('Failed to fetch user data');
        }

        const userData = apiResponse.user;

        const modalHtml = `
            <div class="modal fade" id="editUserModal" tabindex="-1" aria-labelledby="editUserModalLabel" aria-hidden="true">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="editUserModalLabel">
                                <i class="fas fa-user-edit"></i>
                                Edit User
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <form id="editUserForm" class="modal-form-container">
                                <input type="hidden" id="editUserId" value="${userId}">

                                <!-- User Information -->
                                <div class="form-group">
                                    <label for="editUserFullName" class="form-label required">Full Name</label>
                                    <input type="text" class="form-control" id="editUserFullName" value="${escapeHtml(userData.FullName)}" required minlength="2" maxlength="100">
                                </div>

                                <div class="form-group">
                                    <label for="editUserUsername" class="form-label">Username</label>
                                    <input type="text" class="form-control" id="editUserUsername" value="${escapeHtml(userData.Username || '')}" readonly>
                                </div>

                                <!-- Editable Fields -->
                                <div class="form-group">
                                    <label for="editUserEmail" class="form-label required">Email Address</label>
                                    <input type="email" class="form-control" id="editUserEmail" value="${escapeHtml(userData.Email)}" required pattern="[^@\\s]+@[^@\\s]+\\.[^@\\s]+" maxlength="255">
                                </div>

                                <!-- Password Change Section -->
                                <div class="form-group">
                                    <label for="editUserPassword" class="form-label d-flex justify-content-between align-items-center">
                                        <span>Change Password</span>
                                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="generateNewPassword('editUserPassword')">
                                            Generate New Password
                                        </button>
                                    </label>
                                    <div class="input-group">
                                        <input type="password"
                                               class="form-control"
                                               id="editUserPassword"
                                               placeholder="Leave blank to keep current password"
                                               autocomplete="new-password">
                                        <button type="button" class="btn btn-outline-secondary" onclick="togglePasswordVisibility('editUserPassword')">
                                            <i class="fas fa-eye"></i>
                                        </button>
                                    </div>
                                    <small class="text-muted">Minimum 8 characters, must include uppercase, lowercase, number, and special character</small>
                                </div>
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" onclick="handleEditUser(event)">
                                <i class="fas fa-save"></i> Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;

        // Remove existing modal if it exists
        const existingModal = document.getElementById('editUserModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Add new modal to body
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Initialize and show the modal
        const modal = new bootstrap.Modal(document.getElementById('editUserModal'));
        modal.show();
    } catch (error) {
        console.error('Error fetching user details:', error);
        showToast('error', 'Failed to load user details');
    }
}

// Handle edit user form submission
async function handleEditUser(e) {
    e.preventDefault();

    const userId = document.getElementById('editUserId').value;
    const password = document.getElementById('editUserPassword').value;
    const email = document.getElementById('editUserEmail').value.trim();

    // Get the original full name for passing to backend
    const fullName = document.getElementById('editUserFullName').value.trim();

    const formData = {
        email: email,
        fullName: fullName // Add fullName to the form data
    };

    // Only include password if it was changed
    if (password) {
        formData.password = password;
    }

    // Clear any existing validation messages
    clearValidationMessages();

    // Validate required fields
    let hasErrors = false;
    if (!email) {
        showValidationError('editUserEmail', 'Email address is required');
        hasErrors = true;
    }

    if (!fullName) {
        showValidationError('editUserFullName', 'Full Name is required');
        hasErrors = true;
    }

    if (hasErrors) {
        return;
    }

    // Validate email format
    if (!isValidEmail(email)) {
        showValidationError('editUserEmail', 'Please enter a valid email address');
        return;
    }

    try {
        const response = await fetch(`/api/user/users-update/${userId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (data.success) {
            // Hide the edit user modal
            const editUserModal = bootstrap.Modal.getInstance(document.getElementById('editUserModal'));
            editUserModal.hide();

            // Show success message
            showToast('success', 'User updated successfully');

            // If password was changed, show it in a modal
            if (password) {
                showPasswordModal(email, password);
            }

            // Reload users list
            loadUsersList();
        } else {
            // Display error message in modal
            showModalError(data.message || 'Failed to update user');
        }
    } catch (error) {
        console.error('Error updating user:', error);
        showModalError('Failed to update user');
    }
}

// Display validation error under the field
function showValidationError(fieldId, message) {
    const field = document.getElementById(fieldId);
    if (!field) return;

    // Remove any existing error for this field
    clearValidationError(fieldId);

    // Create error message element
    const errorDiv = document.createElement('div');
    errorDiv.className = 'invalid-feedback d-block';
    errorDiv.textContent = message;
    errorDiv.id = `${fieldId}-error`;

    // Add error class to input
    field.classList.add('is-invalid');

    // Insert error after the field
    field.parentNode.appendChild(errorDiv);
}

// Clear validation error for a field
function clearValidationError(fieldId) {
    const field = document.getElementById(fieldId);
    if (!field) return;

    field.classList.remove('is-invalid');

    const errorEl = document.getElementById(`${fieldId}-error`);
    if (errorEl) {
        errorEl.remove();
    }
}

// Clear all validation messages in the form
function clearValidationMessages() {
    const form = document.getElementById('editUserForm');
    if (!form) return;

    // Remove is-invalid class from all fields
    form.querySelectorAll('.is-invalid').forEach(field => {
        field.classList.remove('is-invalid');
    });

    // Remove all error messages
    form.querySelectorAll('.invalid-feedback').forEach(msg => {
        msg.remove();
    });

    // Remove any modal error alert
    const modalError = document.getElementById('modal-error-alert');
    if (modalError) {
        modalError.remove();
    }
}

// Show error message in modal
function showModalError(message) {
    // Clear any existing error
    const existingError = document.getElementById('modal-error-alert');
    if (existingError) {
        existingError.remove();
    }

    // Create error alert
    const errorAlert = document.createElement('div');
    errorAlert.className = 'alert alert-danger text-center mt-3';
    errorAlert.id = 'modal-error-alert';
    errorAlert.innerHTML = `<i class="fas fa-exclamation-circle me-2"></i>${message}`;

    // Add to modal body
    const modalBody = document.querySelector('#editUserModal .modal-body');
    if (modalBody) {
        modalBody.appendChild(errorAlert);
    } else {
        // Fallback to toast if modal body not found
        showToast('error', message);
    }
}

// Toggle password visibility
function togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    const icon = input.nextElementSibling.querySelector('i');

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

// Generate new password
function generateNewPassword(inputId) {
    const input = document.getElementById(inputId);
    const password = generateTemporaryPassword();
    input.type = 'text';
    input.value = password;

    // Update the eye icon
    const icon = input.nextElementSibling.querySelector('i');
    icon.classList.remove('fa-eye');
    icon.classList.add('fa-eye-slash');
}

// Delete user with enhanced confirmation modal
async function deleteUser(userId) {
    try {
        console.log('Deleting user with ID:', userId);

        // First, get user details for the confirmation modal
        const userResponse = await fetch(`/api/user/users-list/${userId}`);
        if (!userResponse.ok) {
            throw new Error(`Failed to fetch user details: ${userResponse.status}`);
        }

        const response = await userResponse.json();
        console.log('User data response for deletion:', response);

        // Check if the response has the expected structure
        if (!response || !response.success || !response.user) {
            throw new Error('Invalid user data received');
        }

        const userData = response.user;
        console.log('Extracted user data:', userData);

        // Populate the delete confirmation modal
        const nameElement = document.getElementById('deleteUserName');
        const emailElement = document.getElementById('deleteUserEmail');
        const roleElement = document.getElementById('deleteUserRole');

        if (nameElement) nameElement.textContent = userData.FullName || 'Unknown User';
        if (emailElement) emailElement.textContent = userData.Email || 'No email';
        if (roleElement) roleElement.textContent = userData.Admin ? 'Administrator' : 'Regular User';

        // Show the delete confirmation modal
        const deleteModal = new bootstrap.Modal(document.getElementById('deleteUserModal'));
        deleteModal.show();

        // Handle the confirmation button click
        const confirmBtn = document.getElementById('confirmDeleteBtn');
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

        newConfirmBtn.addEventListener('click', async () => {
            // Show loading state
            newConfirmBtn.disabled = true;
            newConfirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Deleting...';

            try {
                const deleteResponse = await fetch(`/api/user/users-delete/${userId}`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });

                if (!deleteResponse.ok) {
                    throw new Error(`HTTP error! status: ${deleteResponse.status}`);
                }

                const deleteData = await deleteResponse.json();

                if (deleteData.success) {
                    deleteModal.hide();
                    showToast('success', deleteData.message || 'User deleted successfully');
                    loadUsersList();
                } else {
                    throw new Error(deleteData.message || 'Failed to delete user');
                }
            } catch (error) {
                console.error('Error deleting user:', error);
                showToast('error', error.message || 'Failed to delete user. Please try again.');
            } finally {
                // Reset button state
                newConfirmBtn.disabled = false;
                newConfirmBtn.innerHTML = '<i class="fas fa-trash me-1"></i> Delete User';
            }
        });

    } catch (error) {
        console.error('Error preparing delete confirmation:', error);
        showToast('error', 'Failed to load user details for deletion');
    }
}

// Utility functions
function showSection(sectionId) {
    document.querySelectorAll('.settings-form').forEach(form => {
        form.classList.remove('active');
    });
    document.querySelectorAll('.settings-nav-item').forEach(item => {
        item.classList.remove('active');
    });

    document.getElementById(sectionId).classList.add('active');
    document.querySelector(`[data-section="${sectionId}"]`).classList.add('active');
}

function generateUsername(fullName) {
    return fullName.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 8) + Math.floor(Math.random() * 1000);
}

// Generate temporary password
function generateTemporaryPassword() {
    const length = 12;
    const uppercaseChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lowercaseChars = "abcdefghijklmnopqrstuvwxyz";
    const numericChars = "0123456789";
    const specialChars = "!@#$%^&*";
    const allChars = uppercaseChars + lowercaseChars + numericChars + specialChars;

    // Ensure at least one of each character type
    let password =
        uppercaseChars.charAt(Math.floor(Math.random() * uppercaseChars.length)) +
        lowercaseChars.charAt(Math.floor(Math.random() * lowercaseChars.length)) +
        numericChars.charAt(Math.floor(Math.random() * numericChars.length)) +
        specialChars.charAt(Math.floor(Math.random() * specialChars.length));

    // Fill the rest with random characters
    for (let i = 4; i < length; i++) {
        password += allChars.charAt(Math.floor(Math.random() * allChars.length));
    }

    // Shuffle the password
    return password.split('').sort(() => 0.5 - Math.random()).join('');
}

// Helper utility to escape HTML special characters
function escapeHtml(unsafe) {
    // Handle null, undefined, or other non-string values
    if (unsafe === null || unsafe === undefined) {
        return '';
    }

    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function showToast(type, message) {
    // Use SweetAlert2 for better user experience and consistency
    const icon = type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'error';

    Swal.fire({
        icon: icon,
        title: type === 'success' ? 'Success' : type === 'warning' ? 'Warning' : 'Error',
        html: message,
        timer: type === 'success' ? 3000 : 5000,
        timerProgressBar: true,
        showConfirmButton: false,
        position: 'top-end',
        toast: true,
        customClass: {
            popup: 'animated fadeInRight'
        }
    });
}

// Filter users based on search input
function filterUsers(searchTerm) {
    const rows = document.querySelectorAll('#usersTableBody tr');
    searchTerm = searchTerm.toLowerCase();

    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchTerm) ? '' : 'none';
    });
}

// View user details
async function viewDetails(userId) {
    try {
        console.log('Fetching user details for ID:', userId);
        const response = await fetch(`/api/user/users-list/${userId}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const apiResponse = await response.json();
        console.log('User data response received:', apiResponse);

        // Check if the response has the expected structure
        if (!apiResponse || !apiResponse.success || !apiResponse.user) {
            throw new Error('Invalid user data received');
        }

        const userData = apiResponse.user;
        console.log('Extracted user data:', userData);

        const modal = new bootstrap.Modal(document.getElementById('userDetailsModal'));
        const modalBody = document.querySelector('#userDetailsModal .modal-body');

        // Fix profile picture URL by ensuring it has the correct path
        const profilePicUrl = userData.ProfilePicture ?
            (userData.ProfilePicture.startsWith('http') ?
                userData.ProfilePicture :
                `${window.location.origin}${userData.ProfilePicture}`) :
            `${window.location.origin}/assets/img/default-avatar.png`;

        modalBody.innerHTML = `
            <div class="user-details-container">
                <div class="user-profile-section">
                    <img src="${profilePicUrl}" alt="Profile Picture" class="profile-picture">
                    <h4 class="mb-0">${escapeHtml(userData.FullName || 'N/A')}</h4>
                    <p class="text-muted mb-0">${escapeHtml(userData.Username || 'N/A')}</p>
                </div>

                <div class="details-grid">
                    <div class="detail-item">
                        <label>Email</label>
                        <span>${escapeHtml(userData.Email || 'N/A')}</span>
                    </div>
                    <div class="detail-item">
                        <label>Phone</label>
                        <span>${escapeHtml(userData.Phone || '-')}</span>
                    </div>
                    <div class="detail-item">
                        <label>TIN</label>
                        <span>${escapeHtml(userData.TIN || '-')}</span>
                    </div>
                    <div class="detail-item">
                        <label>ID Type</label>
                        <span>${escapeHtml(userData.IDType || '-')}</span>
                    </div>
                    <div class="detail-item">
                        <label>ID Value</label>
                        <span>${escapeHtml(userData.IDValue || '-')}</span>
                    </div>
                    <div class="detail-item">
                        <label>User Type</label>
                        <span>${escapeHtml(userData.UserType || 'Standard')}</span>
                    </div>
                    <div class="detail-item">
                        <label>Role</label>
                        <span>
                            <span class="badge ${userData.Admin ? 'bg-primary' : 'bg-secondary'}">
                                <i class="fas ${userData.Admin ? 'fa-user-shield' : 'fa-user'} me-1"></i>
                                ${userData.Admin ? 'Administrator' : 'Regular User'}
                            </span>
                        </span>
                    </div>
                    <div class="detail-item">
                        <label>Status</label>
                        <span>
                            <span class="badge ${userData.ValidStatus === '1' || userData.ValidStatus === 'Active' ? 'bg-success' : 'bg-danger'}">
                                <i class="fas ${userData.ValidStatus === '1' || userData.ValidStatus === 'Active' ? 'fa-check-circle' : 'fa-times-circle'} me-1"></i>
                                ${userData.ValidStatus === '1' || userData.ValidStatus === 'Active' ? 'Active' : 'Inactive'}
                            </span>
                            ${userData.TwoFactorEnabled ? '<span class="badge bg-warning ms-1"><i class="fas fa-shield-alt me-1"></i>2FA</span>' : ''}
                        </span>
                    </div>
                    <div class="detail-item">
                        <label>Created</label>
                        <span>${userData.CreateTS ? new Date(userData.CreateTS).toLocaleString() : 'N/A'}</span>
                    </div>
                    <div class="detail-item">
                        <label>Last Login</label>
                        <span>${userData.LastLoginTime ? new Date(userData.LastLoginTime).toLocaleString() : 'Never'}</span>
                    </div>
                </div>

                <div class="user-settings-section mt-4">
                    <h5>Security Settings</h5>
                    <div class="settings-grid">
                        <div class="setting-item">
                            <i class="fas ${userData.TwoFactorEnabled ? 'fa-check-circle text-success' : 'fa-times-circle text-danger'} me-2"></i>
                            Two-Factor Authentication
                        </div>
                        <div class="setting-item">
                            <i class="fas ${userData.NotificationsEnabled ? 'fa-check-circle text-success' : 'fa-times-circle text-danger'} me-2"></i>
                            Notifications
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Update the modal footer edit button to have the correct user ID
        const editButton = document.querySelector('#userDetailsModal .modal-footer .btn-primary');
        if (editButton) {
            editButton.onclick = () => editUser(userData.ID);
        }

        modal.show();
    } catch (error) {
        console.error('Error fetching user details:', error);
        showToast('error', `Failed to load user details: ${error.message}`);
    }
}

// Show temporary password modal
function showPasswordModal(email, password, username = null) {
    // First check if there's already a modal instance and dispose it
    const existingModal = bootstrap.Modal.getInstance(document.getElementById('tempPasswordModal'));
    if (existingModal) {
        existingModal.dispose();
    }

    // Initialize a new modal
    const modal = new bootstrap.Modal(document.getElementById('tempPasswordModal'));
    const modalBody = document.querySelector('#tempPasswordModal .modal-body');

    // Extract username from email if not provided
    const usernameDisplay = username || email.split('@')[0];

    modalBody.innerHTML = `
        <div class="alert alert-warning mb-4">
            <strong><i class="fas fa-exclamation-triangle me-2"></i>Important!</strong>
            Please save or send these credentials securely.
        </div>

        <div class="card credential-card mb-3 shadow-sm">
            <div class="card-body p-4">
                <div class="mb-3">
                    <label class="fw-bold mb-2">Username:</label>
                    <div class="p-3 bg-light rounded border fw-bold">${escapeHtml(usernameDisplay)}</div>
                </div>

                <div class="mb-4">
                    <label class="fw-bold mb-2">Email:</label>
                    <div class="p-3 bg-light rounded border">${escapeHtml(email)}</div>
                </div>

                <div>
                    <label class="fw-bold  mb-2">Temporary Password:</label>
                    <div class="d-flex align-items-center password-display p-3 bg-light rounded border">
                        <code id="passwordText" class="flex-grow-1 fs-5">${escapeHtml(password)}</code>

                    </div>
                </div>
            </div>
        </div>

        <div class="text-center">
            <p class="text-muted fst-italic">The user can change this password after logging in</p>
        </div>
    `;

    // Show the modal
    modal.show();

    // Add event listener to ensure the modal is fully removed from DOM when hidden
    const tempPasswordModal = document.getElementById('tempPasswordModal');
    tempPasswordModal.addEventListener('hidden.bs.modal', function() {
        // Clean up any potential issues
        document.body.classList.remove('modal-open');
        const backdrops = document.querySelectorAll('.modal-backdrop');
        backdrops.forEach(backdrop => backdrop.remove());

        // Re-enable any disabled functionality
        setTimeout(() => {
            // Force a reflow after a short delay
            window.dispatchEvent(new Event('resize'));
        }, 100);
    }, {once: true});
}

// Add this helper function
function generateUsernameSuggestions(fullName, email) {
    const suggestions = [];

    // Handle empty input case
    if (!fullName.trim()) {
        if (email && email.includes('@')) {
            // Just use email username if name is not provided
            const emailUsername = email.split('@')[0].toLowerCase();
            suggestions.push(emailUsername);
            return [...new Set(suggestions.map(s => s.replace(/[^a-z0-9_-]/g, '')))];
        }
        return []; // Return empty array if no valid input
    }

    // Split and clean name parts
    const nameParts = fullName.toLowerCase().trim().split(/\s+/).filter(part => part.length > 0);

    if (nameParts.length > 0) {
        // First name
        const firstName = nameParts[0];

        // Last name (if exists)
        const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';

        // Add various combinations
        suggestions.push(firstName); // Just first name

        if (lastName) {
            suggestions.push(firstName + lastName); // First + last concatenated
            suggestions.push(firstName + '.' + lastName); // First.Last
            suggestions.push(firstName[0] + lastName); // Initial + last
            suggestions.push(firstName + lastName[0]); // First + last initial

            // First name + last name + random number (for uniqueness)
            suggestions.push(firstName + lastName + Math.floor(Math.random() * 100));
        } else {
            // Add random number to first name if it's the only name part
            suggestions.push(firstName + Math.floor(Math.random() * 100));
            suggestions.push(firstName + Math.floor(Math.random() * 1000));
        }

        // Add middle initial if available
        if (nameParts.length > 2) {
            const middleInitial = nameParts[1][0];
            suggestions.push(firstName + middleInitial + lastName);
        }
    }

    // Add email-based suggestion if available
    if (email && email.includes('@')) {
        const emailUsername = email.split('@')[0].toLowerCase();
        suggestions.push(emailUsername);

        // Try email + random number if email is provided
        if (suggestions.length < 5) {
            suggestions.push(emailUsername + Math.floor(Math.random() * 100));
        }
    }

    // Clean up suggestions: remove special chars, limit length, ensure uniqueness
    return [...new Set(suggestions.map(s => {
        // Replace non-alphanumeric chars (except underscore and hyphen)
        return s.replace(/[^a-z0-9_-]/g, '')
                .substring(0, 15); // Limit length to 15 chars
    }))].filter(s => s.length >= 3); // Ensure minimum length
}

// Make the function globally available
window.generateUsernameSuggestions = generateUsernameSuggestions;

// Update the toggleTINInput function to handle both add and edit forms
function toggleTINInput(mode = 'add') {
    const prefix = mode === 'edit' ? 'edit' : 'new';
    const select = document.getElementById(`${prefix}UserTIN`);
    const input = document.getElementById(`${prefix}UserCustomTIN`);

    if (select.style.display !== 'none') {
        select.style.display = 'none';
        input.style.display = 'block';
        input.value = select.value; // Transfer the selected value if any
    } else {
        select.style.display = 'block';
        input.style.display = 'none';
        select.value = ''; // Clear the dropdown selection
    }
}