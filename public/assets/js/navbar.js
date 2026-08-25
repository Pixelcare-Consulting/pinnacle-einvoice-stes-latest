// Wrap everything in an IIFE to avoid global namespace pollution
(function() {
  // Reset DataTables request flags on page load to prevent conflicts
  window._dataTablesRequestInProgress = false;
  window._dataTablesRequestStartTime = null;

  // Initialize on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      // Reset DataTables request flags again on DOM content loaded
      window._dataTablesRequestInProgress = false;
      window._dataTablesRequestStartTime = null;
      initializeNavbar();
    });
  } else {
    initializeNavbar();
  }

  // Idle timer configuration - increased to 30 minutes
  const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
  const WARNING_TIMEOUT = 5 * 60 * 1000; // Show warning 5 minutes before timeout
  let idleTimer = null;
  let warningTimer = null;
  let lastActivity = Date.now();
  let isWarningShown = false;

  // Function to reset the idle timer
  function resetIdleTimer() {
    if (isWarningShown) {
      return; // Don't reset if warning is shown
    }

    lastActivity = Date.now();
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    if (warningTimer) {
      clearTimeout(warningTimer);
    }

    // Set warning timer
    warningTimer = setTimeout(showIdleWarning, IDLE_TIMEOUT - WARNING_TIMEOUT);
    // Set idle timer
    idleTimer = setTimeout(handleIdle, IDLE_TIMEOUT);
  }

  // Function to show idle warning
  function showIdleWarning() {
    isWarningShown = true;
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        title: '<i class="bi bi-exclamation-triangle text-warning"></i> Session Expiring Soon',
        html: `
          <div class="text-center">
            <p class="mb-3">Your session will expire in 5 minutes due to inactivity.</p>
            <div class="d-flex justify-content-center align-items-center mb-3">
              <i class="bi bi-clock me-2"></i>
              <span id="session-countdown">5:00</span>
            </div>
            <p class="small text-muted">Click 'Stay Logged In' to continue your session</p>
          </div>
        `,
        icon: false,
        showCancelButton: true,
        confirmButtonText: '<i class="bi bi-arrow-clockwise"></i> Stay Logged In',
        cancelButtonText: '<i class="bi bi-box-arrow-right"></i> Logout Now',
        confirmButtonColor: '#198754',
        cancelButtonColor: '#dc3545',
        allowOutsideClick: false,
        allowEscapeKey: false,
        allowEnterKey: false,
        focusConfirm: true,
        customClass: {
          container: 'session-warning-modal',
          popup: 'rounded-3 shadow-lg',
          header: 'border-bottom pb-3',
          title: 'fs-5',
          htmlContainer: 'py-3',
          actions: 'border-top pt-3'
        },
        didOpen: () => {
          // Start countdown timer
          let timeLeft = 300; // 5 minutes in seconds
          const countdownEl = document.getElementById('session-countdown');
          const countdownInterval = setInterval(() => {
            timeLeft--;
            const minutes = Math.floor(timeLeft / 60);
            const seconds = timeLeft % 60;
            countdownEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            if (timeLeft <= 60) { // Last minute
              countdownEl.classList.add('text-danger', 'fw-bold');
            }

            if (timeLeft <= 0) {
              clearInterval(countdownInterval);
              handleSessionExpiry();
            }
          }, 1000);

          // Store interval ID to clear it if user responds
          Swal.getPopup().setAttribute('data-interval-id', countdownInterval);
        },
        willClose: () => {
          // Clear countdown interval when modal closes
          const intervalId = Swal.getPopup().getAttribute('data-interval-id');
          if (intervalId) {
            clearInterval(intervalId);
          }
        }
      }).then((result) => {
        if (result.isConfirmed) {
          extendSession();
        } else {
          handleSessionExpiry();
        }
      });
    }
  }

  // Function to extend session - uses enhanced backend endpoint
  async function extendSession() {
    try {
      // Show loading state
      Swal.fire({
        title: 'Extending Session',
        html: '<i class="bi bi-arrow-repeat spin"></i> Please wait...',
        showConfirmButton: false,
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });

      const response = await fetch('/api/user/extend-session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to extend session');
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Failed to extend session');
      }

      // Reset warning state and timers
      isWarningShown = false;
      resetIdleTimer();

      // Update session data in storage
      sessionStorage.setItem('lastSessionCheck', Date.now().toString());

      // If we received session info, update the navbar data
      if (data.sessionInfo) {
        const navbarData = sessionStorage.getItem('navbarData');
        if (navbarData) {
          const parsedData = JSON.parse(navbarData);
          if (parsedData.user) {
            // Update relevant user data
            if (data.sessionInfo.username) {
              parsedData.user.username = data.sessionInfo.username;
            }
            if (data.sessionInfo.fullName) {
              parsedData.user.fullName = data.sessionInfo.fullName;
            }
            sessionStorage.setItem('navbarData', JSON.stringify(parsedData));
          }
        }
      }

      // Show success message with expiry time if available
      let successMessage = 'Your session has been successfully extended.';
      if (data.sessionInfo && data.sessionInfo.expiresAt) {
        const expiryTime = new Date(data.sessionInfo.expiresAt);
        const formattedTime = expiryTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        successMessage += `<br><span class="small text-muted">Valid until ${formattedTime}</span>`;
      }

      Swal.fire({
        title: '<i class="bi bi-check-circle text-success"></i> Session Extended',
        html: successMessage,
        icon: false,
        timer: 3000,
        timerProgressBar: true,
        showConfirmButton: false,
        customClass: {
          popup: 'rounded-3 shadow',
          title: 'fs-5',
          htmlContainer: 'py-2'
        }
      });
    } catch (error) {
      console.error('Error extending session:', error);

      // Show error message
      Swal.fire({
        title: '<i class="bi bi-exclamation-circle text-danger"></i> Session Error',
        html: `Unable to extend your session: ${error.message}`,
        icon: false,
        confirmButtonText: 'Login Again',
        confirmButtonColor: '#0d6efd',
        timer: 5000,
        timerProgressBar: true,
        customClass: {
          popup: 'rounded-3 shadow',
          title: 'fs-5',
          htmlContainer: 'py-2'
        }
      }).then((result) => {
        handleSessionExpiry();
      });
    }
  }

  // Function to handle idle timeout
  function handleIdle() {
    if (!isWarningShown) {
      handleSessionExpiry();
    }
  }

  // Function to setup idle detection
  function setupIdleDetection() {
    // Reset timer on various user activities
    const events = [
      'mousemove',
      'mousedown',
      'keypress',
      'scroll',
      'touchstart',
      'click'
    ];

    events.forEach(event => {
      document.addEventListener(event, () => {
        if (!isWarningShown) {
          resetIdleTimer();
        }
      });
    });

    // Initial setup of idle timer
    resetIdleTimer();
  }

  // Function to check session status - DISABLED, now relying on server middleware
  async function checkSession() {
    // Session checking is now handled by server middleware
    console.log('Frontend session checking disabled - using server middleware');
    return true; // Always return true as session is checked by middleware
  }

  // Improved session expiry handler - Auto redirect to login page
  function handleSessionExpiry() {
    // Clear all timers first
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (warningTimer) {
      clearTimeout(warningTimer);
      warningTimer = null;
    }

    // Clear session storage
    sessionStorage.clear();
    localStorage.removeItem('navbarData');

    // Only proceed with logout if not already on login page
    if (!window.location.pathname.includes('/auth/logout') && !window.location.pathname.includes('/auth/login')) {
      // Perform logout and redirect immediately
      fetch('/auth/logout', {
        method: 'POST',
        credentials: 'same-origin'
      }).finally(() => {
        // Redirect to login page immediately without showing modal
        window.location.href = '/auth/login?expired=true&reason=idle';
      });
    }
  }

  // Session check completely disabled - relying on server middleware
  function startSessionCheck() {
    if (window.sessionCheckInterval) {
      clearInterval(window.sessionCheckInterval);
    }

    console.log('Frontend session checking completely disabled - using server middleware');

    // No event listeners needed as session is checked by middleware
  }

  function updateUI(data) {
    const user = data.user || {};

    console.log('Updating UI with:', { user });

    try {
      // Hide loading placeholders
      document.querySelectorAll('.loading-placeholder').forEach(el => {
        el.style.display = 'none';
      });

      // Update username in header
      const usernameElement = document.querySelector('.profile-username');
      if (usernameElement) {
        const displayName = user.fullName || user.username || 'User';
        usernameElement.innerHTML = `<span>${displayName}</span>`;
      }

      // Update email in header
      const emailElement = document.querySelector('.profile-email');
      if (emailElement) {
        emailElement.innerHTML = `<i class="bi bi-envelope"></i> ${user.email || 'N/A'}`;
      }

      // Update admin badge
      const adminBadge = document.querySelector('.admin-badge');
      if (adminBadge) {
        adminBadge.style.display = user.admin ? 'inline-flex' : 'none';
      }

      // Update admin-only elements visibility
      const adminOnlyElements = document.querySelectorAll('.admin-only');
      adminOnlyElements.forEach(element => {
        if (element) {
          element.style.display = user.admin ? 'flex' : 'none';
        }
      });

      // Update normal-user-only elements visibility
      const normalUserElements = document.querySelectorAll('.normal-user-only');
      normalUserElements.forEach(element => {
        if (element) {
          element.style.display = user.admin ? 'none' : 'flex';
        }
      });

      // Update profile picture
      const logoElement = document.querySelector('.profile-logo');
      if (logoElement) {
        const defaultImage = '/assets/img/default-avatar.png';
        const profilePicUrl = user.profilePicture || defaultImage;

        // Add base URL if the path is relative
        const fullPicUrl = profilePicUrl?.startsWith('http') ?
          profilePicUrl :
          (profilePicUrl ? `${window.location.origin}${profilePicUrl}` : defaultImage);

        logoElement.src = fullPicUrl;
        logoElement.onerror = () => {
          console.log('Failed to load image:', fullPicUrl);
          logoElement.src = defaultImage;
        };
      }

      // Show all profile content
      document.querySelectorAll('.profile-content').forEach(el => {
        el.style.display = 'block';
      });

      // Setup dropdown functionality
      setupDropdown();

      // Load notification count
      //loadNotificationCount();

      console.log('UI update complete');
    } catch (error) {
      console.error('Error updating UI:', error);
    }
  }

  // Function to load notification count
  async function loadNotificationCount() {
    try {
      const response = await fetch('/api/notifications/unread-count', {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.count > 0) {
          const badge = document.getElementById('notificationBadge');
          if (badge) {
            badge.textContent = data.count > 99 ? '99+' : data.count;
            badge.style.display = 'flex';
          }
        } else {
          const badge = document.getElementById('notificationBadge');
          if (badge) {
            badge.style.display = 'none';
          }
        }
      }
    } catch (error) {
      console.error('Error loading notification count:', error);
    }
  }

  // Navbar notification dropdown functionality
  let navbarNotificationDropdownOpen = false;
  let navbarNotificationDropdownData = [];

  // Initialize navbar notification dropdown on hover
  function initializeNotificationDropdown() {
    const navbarNotificationContainer = document.querySelector('.notification-dropdown-container');
    const navbarNotificationDropdown = document.getElementById('notificationDropdown');

    if (navbarNotificationContainer && navbarNotificationDropdown) {
      let navbarHoverTimeout;
      let navbarIsHovering = false;

      // Mouse enter on container
      navbarNotificationContainer.addEventListener('mouseenter', () => {
        clearTimeout(navbarHoverTimeout);
        navbarIsHovering = true;
        navbarNotificationDropdown.classList.remove('hidden');
        navbarNotificationDropdown.style.display = 'block';
        navbarNotificationDropdown.style.opacity = '1';
        navbarNotificationDropdown.style.transform = 'scale(1) translateY(0)';
        navbarNotificationDropdown.style.pointerEvents = 'auto';
        navbarNotificationDropdown.style.zIndex = '99999';
        navbarNotificationDropdownOpen = true;
        loadNavbarNotificationDropdown();
      });

      // Mouse leave on container
      navbarNotificationContainer.addEventListener('mouseleave', () => {
        navbarIsHovering = false;
        navbarHoverTimeout = setTimeout(() => {
          if (!navbarIsHovering) {
            navbarNotificationDropdown.classList.add('hidden');
            navbarNotificationDropdown.style.display = 'none';
            navbarNotificationDropdown.style.opacity = '0';
            navbarNotificationDropdown.style.transform = 'scale(0.95) translateY(-10px)';
            navbarNotificationDropdown.style.pointerEvents = 'none';
            navbarNotificationDropdownOpen = false;
          }
        }, 300); // Increased delay to prevent flickering
      });

      // Mouse enter on dropdown itself
      navbarNotificationDropdown.addEventListener('mouseenter', () => {
        clearTimeout(navbarHoverTimeout);
        navbarIsHovering = true;
      });

      // Mouse leave on dropdown
      navbarNotificationDropdown.addEventListener('mouseleave', () => {
        navbarIsHovering = false;
        navbarHoverTimeout = setTimeout(() => {
          if (!navbarIsHovering) {
            navbarNotificationDropdown.classList.add('hidden');
            navbarNotificationDropdown.style.display = 'none';
            navbarNotificationDropdown.style.opacity = '0';
            navbarNotificationDropdown.style.transform = 'scale(0.95) translateY(-10px)';
            navbarNotificationDropdown.style.pointerEvents = 'none';
            navbarNotificationDropdownOpen = false;
          }
        }, 300);
      });
    }
  }

  // Call initialization when DOM is loaded
  document.addEventListener('DOMContentLoaded', initializeNotificationDropdown);

  // Disable right-click context menu
  document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    return false;
  });

  // Disable F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
  document.addEventListener('keydown', function(e) {
    // F12
    if (e.keyCode === 123) {
      e.preventDefault();
      return false;
    }
    // Ctrl+Shift+I (Developer Tools)
    if (e.ctrlKey && e.shiftKey && e.keyCode === 73) {
      e.preventDefault();
      return false;
    }
    // Ctrl+Shift+J (Console)
    if (e.ctrlKey && e.shiftKey && e.keyCode === 74) {
      e.preventDefault();
      return false;
    }
    // Ctrl+U (View Source)
    if (e.ctrlKey && e.keyCode === 85) {
      e.preventDefault();
      return false;
    }
  });

  // Load navbar notifications for dropdown
  async function loadNavbarNotificationDropdown() {
    console.log('Loading navbar notification dropdown...');
    const navbarLoadingEl = document.getElementById('notificationDropdownLoading');
    const navbarEmptyEl = document.getElementById('notificationDropdownEmpty');
    const navbarListEl = document.getElementById('notificationDropdownList');

    console.log('Elements found:', { navbarLoadingEl, navbarEmptyEl, navbarListEl });

    if (navbarLoadingEl) navbarLoadingEl.classList.remove('hidden');
    if (navbarEmptyEl) navbarEmptyEl.classList.add('hidden');

    try {
      // Fetch both notifications and announcements
      const [notificationsResponse, announcementsResponse] = await Promise.all([
        fetch('/api/notifications?limit=3', {
          method: 'GET',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json'
          }
        }),
        fetch('/api/announcements?status=published&limit=2', {
          method: 'GET',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json'
          }
        })
      ]);

      let navbarCombinedData = [];

      // Process notifications
      if (notificationsResponse.ok) {
        const notificationsData = await notificationsResponse.json();
        if (notificationsData.success && notificationsData.data) {
          navbarCombinedData = [...navbarCombinedData, ...notificationsData.data.map(item => ({
            ...item,
            source: 'notification'
          }))];
        }
      }

      // Process announcements
      if (announcementsResponse.ok) {
        const announcementsData = await announcementsResponse.json();
        if (announcementsData.success && announcementsData.data) {
          navbarCombinedData = [...navbarCombinedData, ...announcementsData.data.map(item => ({
            id: item.id,
            title: item.title,
            message: item.summary || item.content.substring(0, 100) + '...',
            type: 'announcement',
            priority: item.priority,
            created_at: item.created_at,
            is_read: false, // Announcements are always shown as new
            source: 'announcement'
          }))];
        }
      }

      // Sort by creation date (newest first)
      navbarCombinedData.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      navbarNotificationDropdownData = navbarCombinedData.slice(0, 5); // Limit to 5 items
      console.log('Navbar notification data:', navbarNotificationDropdownData);
      renderNavbarNotificationDropdown();

    } catch (error) {
      console.error('Error loading navbar notifications:', error);
      showEmptyNavbarNotificationDropdown();
    } finally {
      if (navbarLoadingEl) navbarLoadingEl.classList.add('hidden');
    }
  }

  // Show empty navbar notification dropdown
  function showEmptyNavbarNotificationDropdown() {
    const navbarEmptyEl = document.getElementById('notificationDropdownEmpty');
    const navbarListEl = document.getElementById('notificationDropdownList');

    if (navbarListEl) {
      const existingNavbarNotifications = navbarListEl.querySelectorAll('.navbar-notification-dropdown-item');
      existingNavbarNotifications.forEach(item => item.remove());
    }

    if (navbarEmptyEl) navbarEmptyEl.classList.remove('hidden');
    navbarNotificationDropdownData = [];
  }

  // Render navbar notifications in dropdown
  function renderNavbarNotificationDropdown() {
    console.log('Rendering navbar notification dropdown...');
    const navbarListEl = document.getElementById('notificationDropdownList');
    const navbarEmptyEl = document.getElementById('notificationDropdownEmpty');

    console.log('Render elements:', { navbarListEl, navbarEmptyEl });
    if (!navbarListEl) {
      console.error('navbarListEl not found!');
      return;
    }

    // Clear existing notifications (except loading and empty states)
    const existingNavbarNotifications = navbarListEl.querySelectorAll('.navbar-notification-dropdown-item');
    existingNavbarNotifications.forEach(item => item.remove());

    if (navbarNotificationDropdownData.length === 0) {
      if (navbarEmptyEl) navbarEmptyEl.classList.remove('hidden');
      return;
    }

    if (navbarEmptyEl) navbarEmptyEl.classList.add('hidden');

    // Render notifications
    console.log('Rendering', navbarNotificationDropdownData.length, 'notifications');
    navbarNotificationDropdownData.slice(0, 5).forEach((notification, index) => {
      console.log(`Creating notification ${index}:`, notification);
      const navbarNotificationEl = createNavbarNotificationDropdownItem(notification);
      console.log('Created element:', navbarNotificationEl);
      navbarListEl.appendChild(navbarNotificationEl);
    });
    console.log('Finished rendering notifications');
  }

  // Create navbar notification dropdown item
  function createNavbarNotificationDropdownItem(notification) {
    const navbarDiv = document.createElement('div');
    navbarDiv.className = `navbar-notification-dropdown-item ${!notification.is_read ? 'bg-blue-50' : ''}`;

    const timeAgo = formatTimeAgo(notification.created_at);
    const iconClass = getNavbarNotificationIcon(notification.type);
    const iconBgColor = getNavbarNotificationIconBg(notification.type);

    navbarDiv.innerHTML = `
      <div class="flex items-start gap-3 p-4">
        <div class="flex-shrink-0">
          <div class="w-8 h-8 rounded-full ${iconBgColor} flex items-center justify-center">
            <span class="material-symbols-outlined text-white text-sm">${iconClass}</span>
          </div>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <p class="text-sm font-medium text-gray-900 mb-1 line-clamp-1">${escapeHtml(notification.title)}</p>
              <p class="text-xs text-gray-600 leading-relaxed line-clamp-2 mb-2">${escapeHtml(notification.message)}</p>
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-500">${timeAgo}</span>
                ${getNavbarNotificationTypeBadge(notification.type)}
              </div>
            </div>
            ${!notification.is_read ? '<div class="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full ml-2 mt-1"></div>' : ''}
          </div>
        </div>
      </div>
    `;

    navbarDiv.addEventListener('click', () => {
      // Mark as read and navigate
      if (!notification.is_read && notification.source === 'notification') {
        markNavbarNotificationAsRead(notification.id);
      }
      // Close dropdown and navigate
      const navbarDropdown = document.getElementById('notificationDropdown');
      if (navbarDropdown) {
        navbarDropdown.classList.add('hidden');
        navbarDropdown.style.display = 'none';
      }
      navbarNotificationDropdownOpen = false;
      window.location.href = '/dashboard/notifications';
    });

    return navbarDiv;
  }

  // Get navbar notification icon
  function getNavbarNotificationIcon(type) {
    const navbarIcons = {
      system: 'settings',
      lhdn: 'public',
      announcement: 'campaign',
      alert: 'warning'
    };
    return navbarIcons[type] || 'notifications';
  }

  // Get navbar notification icon background color
  function getNavbarNotificationIconBg(type) {
    const navbarColors = {
      system: 'bg-blue-500',
      lhdn: 'bg-green-500',
      announcement: 'bg-orange-500',
      alert: 'bg-red-500'
    };
    return navbarColors[type] || 'bg-gray-500';
  }

  // Get navbar notification type badge
  function getNavbarNotificationTypeBadge(type) {
    const navbarBadges = {
      system: '<span class="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded font-medium">System</span>',
      lhdn: '<span class="px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded font-medium">LHDN</span>',
      announcement: '<span class="px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 rounded font-medium">News</span>',
      alert: '<span class="px-1.5 py-0.5 text-xs bg-red-100 text-red-700 rounded font-medium">Alert</span>'
    };
    return navbarBadges[type] || '<span class="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-700 rounded font-medium">Info</span>';
  }

  // Format time ago
  function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    return date.toLocaleDateString();
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Mark navbar notification as read
  async function markNavbarNotificationAsRead(notificationId) {
    try {
      const response = await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        // Update the notification in local data
        const navbarNotification = navbarNotificationDropdownData.find(n => n.id === notificationId);
        if (navbarNotification) {
          navbarNotification.is_read = true;
        }
        // Refresh notification count
       // loadNotificationCount();
       // renderNavbarNotificationDropdown();
      }
    } catch (error) {
      console.error('Error marking navbar notification as read:', error);
    }
  }

  // Mark all navbar notifications as read
  window.markAllNotificationsRead = async function() {
    try {
      const response = await fetch('/api/notifications/mark-all-read', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        // Update all notifications in local data
        navbarNotificationDropdownData.forEach(navbarNotification => {
          if (navbarNotification.source === 'notification') {
            navbarNotification.is_read = true;
          }
        });
        // Refresh notification count and dropdown
        // loadNotificationCount();
        // renderNavbarNotificationDropdown();
      }
    } catch (error) {
      console.error('Error marking all navbar notifications as read:', error);
    }
  };

  // Close navbar dropdown when clicking outside (keep for fallback)
  document.addEventListener('click', function(event) {
    const navbarContainer = document.querySelector('.notification-dropdown-container');
    const navbarDropdown = document.getElementById('notificationDropdown');

    if (navbarDropdown && navbarContainer && navbarNotificationDropdownOpen) {
      if (!navbarContainer.contains(event.target)) {
        navbarDropdown.classList.add('hidden');
        navbarDropdown.style.display = 'none';
        navbarNotificationDropdownOpen = false;
      }
    }
  });

  // Enhanced navbar refresh function - no session check
  async function refreshNavbar() {
    console.log('Refreshing navbar...');

    try {
      // No session check needed - middleware handles it

      // Clear cached data
      sessionStorage.removeItem('navbarData');

      // Reinitialize navbar
      await initializeNavbar();

      console.log('Navbar refresh complete');
    } catch (error) {
      console.error('Error refreshing navbar:', error);
      // If there's an error, let the middleware handle session issues
    }
  }

  async function initializeNavbar() {
    console.log('Initializing navbar...');

    // Check if we're on the login page
    if (window.location.pathname === '/auth/login' || window.location.pathname === '/login') {
      console.log('On login page, skipping navbar init...');
      return;
    }

    // Check if navbar elements exist
    if (!document.querySelector('.profile-username')) {
      console.log('Profile username element not found, skipping...');
      return;
    }

    try {
      // Check if we already have a session error
      const sessionError = sessionStorage.getItem('sessionError');
      if (sessionError) {
        console.log('Session error detected:', sessionError);
        setDefaultValues();
        return;
      }

      const response = await fetch('/api/user/profile', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
        credentials: 'same-origin'
      });

      if (!response.ok) {
        if (response.status === 401) {
          console.log('User not authenticated');
          // Instead of redirecting, just set default values
          setDefaultValues();
          return;
        }
        throw new Error(`Failed to fetch user details: ${response.status}`);
      }

      const data = await response.json();
      console.log('Raw Navbar data:', data);

      if (!data.success) {
        throw new Error(data.message || 'Failed to fetch user details');
      }

      // Structure the data into our expected format
      const sanitizedData = {
        user: {
          userId: data.user.ID || '',
          username: data.user.Username || '',
          fullName: data.user.FullName || '',
          email: data.user.Email || '',
          admin: data.user.Admin === 1 || data.user.Admin === true || data.user.Admin === '1',
          tin: data.user.TIN || '',
          idType: data.user.IDType || '',
          idValue: data.user.IDValue || '',
          profilePicture: data.user.ProfilePicture || '/assets/img/default-avatar.png',
          lastLoginTime: data.user.LastLoginTime || null,
          validStatus: data.user.ValidStatus === '1' || data.user.ValidStatus === 1 || data.user.ValidStatus === true || data.user.ValidStatus === 'true',
          phone: data.user.Phone || '',
          twoFactorEnabled: data.user.TwoFactorEnabled || false,
          notificationsEnabled: data.user.NotificationsEnabled || false
        },
        success: true
      };

      // Only cache if we have actual user data
      if (sanitizedData.user.username || sanitizedData.user.email) {
        sessionStorage.setItem('navbarData', JSON.stringify(sanitizedData));
      }

      updateUI(sanitizedData);
      setupNavHighlighting();
      startSessionCheck();
      setupIdleDetection(); // Initialize idle detection

    } catch (error) {
      console.error('Error initializing navbar:', error);
      sessionStorage.removeItem('navbarData');
      setDefaultValues();
    }
  }

  function setupDropdown() {
    const profileBtn = document.querySelector('.pinnacle-header__profile-btn');
    const dropdown = document.querySelector('.pinnacle-header__dropdown');
    const arrow = document.querySelector('.pinnacle-header__profile-arrow');

    if (!profileBtn || !dropdown) return;

    let isOpen = false;

    // Toggle dropdown on button click
    profileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isOpen = !isOpen;
      dropdown.classList.toggle('show');
      if (arrow) {
        arrow.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0)';
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && !profileBtn.contains(e.target)) {
        isOpen = false;
        dropdown.classList.remove('show');
        if (arrow) {
          arrow.style.transform = 'rotate(0)';
        }
      }
    });

    // Close dropdown when pressing escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        isOpen = false;
        dropdown.classList.remove('show');
        if (arrow) {
          arrow.style.transform = 'rotate(0)';
        }
      }
    });
  }

  function setDefaultValues() {
    updateUI({
      user: {
        username: 'User',
        email: 'N/A',
        admin: false,
        profilePicture: '/assets/img/default-avatar.png',
        validStatus: false,
        lastLoginTime: null
      }
    });
  }

  function setupNavHighlighting() {
    const currentPath = window.location.pathname;
    document.querySelectorAll('.nav-item-link').forEach(link => {
      if (link) {
        link.classList.toggle('active', link.getAttribute('href') === currentPath);
      }
    });
  }

  // Make refreshNavbar available globally without session check
  window.refreshNavbar = async function() {
    // No session check needed - middleware handles it
    return refreshNavbar();
  };
})();