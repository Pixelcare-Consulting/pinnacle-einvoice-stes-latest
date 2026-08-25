// DOM Elements
const profileImg = document.getElementById('profileImg');
const imageUpload = document.getElementById('imageUpload');
const uploadImageBtn = document.getElementById('uploadImageBtn');
const removeImageBtn = document.getElementById('removeImageBtn');
const editButton = document.getElementById('editButton');
const viewMode = document.getElementById('viewMode');
const formActions = document.querySelector('.form-actions');

// State
let isEditMode = false;
let originalData = {};

// Make toggleEditMode globally accessible
window.toggleEditMode = function() {
  isEditMode = !isEditMode;
  const editMode = document.querySelectorAll('.edit-mode');
  const viewMode = document.querySelectorAll('.view-mode');
  const formActions = document.querySelector('.form-actions');

  editMode.forEach(el => el.style.display = isEditMode ? 'block' : 'none');
  viewMode.forEach(el => el.style.display = isEditMode ? 'none' : 'block');
  formActions.style.display = isEditMode ? 'flex' : 'none';
  editButton.innerHTML = isEditMode ? '<i class="fas fa-times"></i> Cancel' : '<i class="fas fa-edit"></i> Edit Details';

  if (!isEditMode) {
    // Reset form values to original data
    Object.keys(originalData).forEach(key => {
      const input = document.getElementById(key);
      if (input) {
        input.value = originalData[key] || '';
      }
    });
  }
};

// Load company data from server
async function loadCompanyData() {
  try {
    // Fetch company profile
    const response = await fetch('/api/company/profile');
    const data = await response.json();

    if (data.success) {
      originalData = data.company;

      // Update view mode spans
      document.querySelectorAll('[data-field]').forEach(span => {
        const field = span.getAttribute('data-field');
        if (field && data.company[field] !== undefined) {
          span.textContent = data.company[field] || '';
        }
      });

      // Update edit mode inputs
      Object.keys(data.company).forEach(key => {
        const input = document.getElementById(key);
        if (input) {
          input.value = data.company[key] || '';
        }
      });

      // Update company details in sidebar
      const companyTitle = document.querySelector('.company-title');
      const tinElement = document.querySelector('.tin');
      const brnElement = document.querySelector('.brn');
      const emailElement = document.querySelector('.email');
      const phoneElement = document.querySelector('.phone');

      if (companyTitle) companyTitle.textContent = data.company.companyName || '';
      if (tinElement) tinElement.textContent = data.company.tin || '';
      if (brnElement) brnElement.textContent = data.company.brn || '';
      if (emailElement) emailElement.textContent = data.company.email || '';
      if (phoneElement) phoneElement.textContent = data.company.phone || '';

      // Update profile image if exists
      if (data.company.profileImage) {
        profileImg.src = data.company.profileImage;
      }

      // Fetch LHDN configuration
      const lhdnResponse = await fetch('/api/config/lhdn/get-config');
      const lhdnData = await lhdnResponse.json();

      if (lhdnData.success && lhdnData.config) {
        // Update LHDN credentials in the form
        const clientIdInput = document.getElementById('clientId');
        const clientSecretInput = document.getElementById('clientSecret');
        const clientIdSpan = document.querySelector('[data-field="clientId"]');
        const clientSecretSpan = document.querySelector('[data-field="clientSecret"]');

        if (clientIdInput) {
          clientIdInput.value = lhdnData.config.clientId || '****************';
        }
        if (clientSecretInput) {
          clientSecretInput.value = '****************';
        }
        if (clientIdSpan) {
          clientIdSpan.textContent = lhdnData.config.clientId || '****************';
        }
        if (clientSecretSpan) {
          clientSecretSpan.textContent = '****************';
        }
      }
    }
  } catch (error) {
    console.error('Error loading company data:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'Failed to load company data. Please try again later.'
    });
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadCompanyData();
  setupImageHandlers();

  // Add click handlers for edit buttons
  document.querySelectorAll('[data-edit-field]').forEach(button => {
    button.addEventListener('click', (e) => {
      const field = e.currentTarget.getAttribute('data-edit-field');
      if (field === 'clientId' || field === 'clientSecret') {
        handleLHDNEdit(field);
      } else if (field === 'tin' || field === 'brn') {
        handleRegistrationEdit(field);
      }
    });
  });

  // Add form submit handlers
  const forms = document.querySelectorAll('form');
  forms.forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (form.id === 'companyForm') {
        saveChanges();
      }
    });
  });
});

// Make saveChanges globally accessible
window.saveChanges = async function() {
  try {
    const formData = {
      companyName: document.getElementById('companyName')?.value || '',
      industry: document.getElementById('industry')?.value || '',
      country: document.getElementById('country')?.value || '',
      email: document.getElementById('email')?.value || '',
      phone: document.getElementById('phone')?.value || '',
      address: document.getElementById('address')?.value || ''
    };

    const response = await fetch('/api/company/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });

    const data = await response.json();

    if (data.success) {
      await Swal.fire({
        icon: 'success',
        title: 'Success',
        text: 'Company profile updated successfully!'
      });
      toggleEditMode();
      loadCompanyData();
    } else {
      throw new Error(data.message || 'Failed to update company profile');
    }
  } catch (error) {
    console.error('Error saving company data:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: error.message || 'Failed to update company profile. Please try again later.'
    });
  }
};

// Handle LHDN credential edits
async function handleLHDNEdit(field) {
  try {
    const result = await Swal.fire({
      title: `Edit LHDN ${field === 'clientId' ? 'Client ID' : 'Client Secret'}`,
      html: `
        <div class="mb-3">
          <label class="form-label">New ${field === 'clientId' ? 'Client ID' : 'Client Secret'}</label>
          <input type="password" id="credentialInput" class="swal2-input" placeholder="Enter new ${field === 'clientId' ? 'Client ID' : 'Client Secret'}">
        </div>
        <div class="mb-3">
          <label class="form-label">Confirm Password</label>
          <input type="password" id="passwordInput" class="swal2-input" placeholder="Enter your password">
        </div>
      `,
      customClass: {
        container: 'custom-swal-container',
        popup: 'custom-swal-popup',
        input: 'custom-swal-input'
      },
      showCancelButton: true,
      confirmButtonText: 'Update',
      showLoaderOnConfirm: true,
      didOpen: () => {
        // Add custom styles for better UI
        const style = document.createElement('style');
        style.textContent = `
          .custom-swal-popup {
            width: 32em !important;
            padding: 2em;
          }
          .custom-swal-input {
            width: 100% !important;
            margin: 0.5em 0 !important;
            padding: 0.5em !important;
          }
          .form-label {
            display: block;
            text-align: left;
            margin-bottom: 0.5em;
            font-weight: 500;
          }
          .mb-3 {
            margin-bottom: 1rem;
          }
        `;
        document.head.appendChild(style);
      },
      preConfirm: () => {
        const newValue = document.getElementById('credentialInput').value;
        const password = document.getElementById('passwordInput').value;

        if (!newValue || !password) {
          Swal.showValidationMessage('Please fill in all fields');
          return false;
        }

        return { newValue, password };
      }
    });

    if (result.isConfirmed) {
      // Save to LHDN config
      const response = await fetch('/api/config/lhdn/save-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          [field]: result.value.newValue,
          password: result.value.password
        })
      });

      const data = await response.json();

      if (data.success) {
        await Swal.fire({
          icon: 'success',
          title: 'Success',
          text: `LHDN ${field === 'clientId' ? 'Client ID' : 'Client Secret'} updated successfully!`
        });
        // Reload company data to refresh the display
        loadCompanyData();
      } else {
        throw new Error(data.message || 'Failed to update LHDN credentials');
      }
    }
  } catch (error) {
    console.error('Error updating LHDN credentials:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: error.message || 'Failed to update LHDN credentials. Please try again later.'
    });
  }
}

// Handle Registration Details edit (TIN/BRN)
async function handleRegistrationEdit(field) {
  try {
    const result = await Swal.fire({
      title: `Edit ${field === 'tin' ? 'Tax Identification Number' : 'Business Registration Number'}`,
      html: `
        <div class="mb-3">
          <label class="form-label">New ${field === 'tin' ? 'TIN' : 'BRN'}</label>
          <input type="text" id="registrationInput" class="swal2-input" placeholder="Enter new ${field === 'tin' ? 'TIN' : 'BRN'}">
        </div>
        <div class="mb-3">
          <label class="form-label">Confirm Password</label>
          <input type="password" id="passwordInput" class="swal2-input" placeholder="Enter your password">
        </div>
      `,
      customClass: {
        container: 'custom-swal-container',
        popup: 'custom-swal-popup',
        input: 'custom-swal-input'
      },
      showCancelButton: true,
      confirmButtonText: 'Update',
      showLoaderOnConfirm: true,
      didOpen: () => {
        // Add custom styles for better UI
        const style = document.createElement('style');
        style.textContent = `
          .custom-swal-popup {
            width: 32em !important;
            padding: 2em;
          }
          .custom-swal-input {
            width: 100% !important;
            margin: 0.5em 0 !important;
            padding: 0.5em !important;
          }
          .form-label {
            display: block;
            text-align: left;
            margin-bottom: 0.5em;
            font-weight: 500;
          }
          .mb-3 {
            margin-bottom: 1rem;
          }
        `;
        document.head.appendChild(style);
      },
      preConfirm: () => {
        const newValue = document.getElementById('registrationInput').value;
        const password = document.getElementById('passwordInput').value;

        if (!newValue || !password) {
          Swal.showValidationMessage('Please fill in all fields');
          return false;
        }

        return { newValue, password };
      }
    });

    if (result.isConfirmed) {
      // Prepare the request body based on which field is being updated
      const requestBody = {
        password: result.value.password
      };

      // Add only the field being updated
      if (field === 'tin') {
        requestBody.tin = result.value.newValue;
      } else {
        requestBody.brn = result.value.newValue;
      }

      const response = await fetch(`/api/company/registration-details/${field}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      if (data.success) {
        await Swal.fire({
          icon: 'success',
          title: 'Success',
          text: `${field === 'tin' ? 'Tax Identification Number' : 'Business Registration Number'} updated successfully!`
        });
        // Reload company data to refresh the display
        loadCompanyData();
      } else {
        throw new Error(data.message || `Failed to update ${field.toUpperCase()}`);
      }
    }
  } catch (error) {
    console.error('Error updating registration details:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: error.message || 'Failed to update registration details. Please try again later.'
    });
  }
}

// Setup image upload handlers
function setupImageHandlers() {
  uploadImageBtn.addEventListener('click', () => {
    imageUpload.click();
  });

  imageUpload.addEventListener('change', async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const maxSize = 5 * 1024 * 1024; // 5MB

      if (file.size > maxSize) {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'Image size should not exceed 5MB'
        });
        return;
      }

      try {
        // Show loading indicator
        Swal.fire({
          title: 'Uploading...',
          text: 'Please wait while we upload your image',
          allowOutsideClick: false,
          didOpen: () => {
            Swal.showLoading();
          }
        });

        const formData = new FormData();
        formData.append('profileImage', file);

        const response = await fetch('/api/company/profile-image', {
          method: 'POST',
          body: formData,
          credentials: 'same-origin' // Include cookies for authentication
        });

        // Parse response data
        let data;
        try {
          data = await response.json();
        } catch (parseError) {
          console.error('Error parsing response:', parseError);
          throw new Error('Invalid server response. Please try again.');
        }

        if (data.success) {
          // Update image with cache-busting parameter
          const cacheBuster = new Date().getTime();
          profileImg.src = data.imageUrl + '?t=' + cacheBuster;

          Swal.fire({
            icon: 'success',
            title: 'Success',
            text: 'Profile image updated successfully!'
          });
        } else {
          throw new Error(data.message || 'Failed to upload image');
        }
      } catch (error) {
        console.error('Error uploading image:', error);

        // Close any open loading dialog
        Swal.close();

        // Show detailed error message
        Swal.fire({
          icon: 'error',
          title: 'Error Uploading Image',
          html: `
            <p>${error.message || 'Failed to upload image. Please try again later.'}</p>
            <p class="small text-muted mt-2">If this problem persists, please contact support.</p>
          `,
          confirmButtonText: 'Try Again'
        }).then((result) => {
          if (result.isConfirmed) {
            // Reset the file input to allow trying again
            fileInput.value = '';
          }
        });
      }
    }
  });

  removeImageBtn.addEventListener('click', async () => {
    try {
      const result = await Swal.fire({
        title: 'Remove Profile Image',
        text: 'Are you sure you want to remove the profile image?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, remove it!',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6'
      });

      if (result.isConfirmed) {
        // Show loading indicator
        Swal.fire({
          title: 'Removing...',
          text: 'Please wait while we remove your image',
          allowOutsideClick: false,
          didOpen: () => {
            Swal.showLoading();
          }
        });

        const response = await fetch('/api/company/profile-image', {
          method: 'DELETE',
          credentials: 'same-origin' // Include cookies for authentication
        });

        // Parse response data
        let data;
        try {
          data = await response.json();
        } catch (parseError) {
          console.error('Error parsing response:', parseError);
          throw new Error('Invalid server response. Please try again.');
        }

        if (data.success) {
          // Update image with cache-busting parameter
          const cacheBuster = new Date().getTime();
          profileImg.src = '/assets/img/noimage.png' + '?t=' + cacheBuster;

          Swal.fire({
            icon: 'success',
            title: 'Success',
            text: 'Profile image removed successfully!'
          });
        } else {
          throw new Error(data.message || 'Failed to remove image');
        }
      }
    } catch (error) {
      console.error('Error removing image:', error);

      // Close any open loading dialog
      Swal.close();

      // Show detailed error message
      Swal.fire({
        icon: 'error',
        title: 'Error Removing Image',
        html: `
          <p>${error.message || 'Failed to remove image. Please try again later.'}</p>
          <p class="small text-muted mt-2">If this problem persists, please contact support.</p>
        `,
        confirmButtonText: 'OK'
      });
    }
  });
}
