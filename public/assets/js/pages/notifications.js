// Notifications Page JavaScript
class NotificationsManager {
    constructor() {
        this.currentFilter = 'all';
        this.currentLimit = 50;
        this.currentOffset = 0;
        this.notifications = [];
        this.isLoading = false;
        
        this.initializeEventListeners();
        this.loadNotifications();
        this.loadNotificationStats();
    }

    initializeEventListeners() {
        // Filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.setActiveFilter(e.target.dataset.filter);
            });
        });

        // Limit selector
        document.getElementById('notificationLimit').addEventListener('change', (e) => {
            this.currentLimit = parseInt(e.target.value);
            this.currentOffset = 0;
            this.loadNotifications();
        });

        // Action buttons
        document.getElementById('syncLHDNBtn').addEventListener('click', () => {
            this.syncLHDNNotifications();
        });

        document.getElementById('markAllReadBtn').addEventListener('click', () => {
            this.markAllAsRead();
        });

        document.getElementById('loadMoreBtn').addEventListener('click', () => {
            this.loadMoreNotifications();
        });

        // Modal mark as read button
        document.getElementById('markAsReadBtn').addEventListener('click', () => {
            this.markNotificationAsRead();
        });
    }

    setActiveFilter(filter) {
        // Update active filter button
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-filter="${filter}"]`).classList.add('active');

        this.currentFilter = filter;
        this.currentOffset = 0;
        this.loadNotifications();
    }

    async loadNotifications() {
        if (this.isLoading) return;
        
        this.isLoading = true;
        this.showLoadingState();

        try {
            let endpoint = '/api/notifications';
            const params = new URLSearchParams({
                limit: this.currentLimit,
                offset: this.currentOffset
            });

            // Add filter-specific parameters
            if (this.currentFilter === 'unread') {
                params.append('unreadOnly', 'true');
            } else if (this.currentFilter !== 'all') {
                params.append('type', this.currentFilter);
            }

            const response = await fetch(`${endpoint}?${params}`);
            const data = await response.json();

            if (data.success) {
                if (this.currentOffset === 0) {
                    this.notifications = data.data;
                } else {
                    this.notifications = [...this.notifications, ...data.data];
                }
                this.renderNotifications();
                this.updateNotificationCount();
            } else {
                this.showErrorState();
            }
        } catch (error) {
            console.error('Error loading notifications:', error);
            this.showErrorState();
        } finally {
            this.isLoading = false;
        }
    }

    async loadMoreNotifications() {
        this.currentOffset += this.currentLimit;
        await this.loadNotifications();
    }

    async loadNotificationStats() {
        try {
            const response = await fetch('/api/notifications/unread-count');
            const data = await response.json();

            if (data.success) {
                document.getElementById('unreadNotifications').textContent = data.count;
            }

            // Load combined stats
            const combinedResponse = await fetch('/api/notifications/combined?limit=1000');
            const combinedData = await combinedResponse.json();

            if (combinedData.success) {
                const stats = this.calculateStats(combinedData.data);
                this.updateStatsDisplay(stats);
            }
        } catch (error) {
            console.error('Error loading notification stats:', error);
        }
    }

    calculateStats(data) {
        return {
            total: data.combined.length,
            unread: data.combined.filter(n => !n.is_read).length,
            lhdn: data.lhdn.length,
            system: data.internal.filter(n => n.type === 'system').length + data.logs.length
        };
    }

    updateStatsDisplay(stats) {
        document.getElementById('totalNotifications').textContent = stats.total;
        document.getElementById('unreadNotifications').textContent = stats.unread;
        document.getElementById('lhdnNotifications').textContent = stats.lhdn;
        document.getElementById('systemNotifications').textContent = stats.system;
    }

    renderNotifications() {
        const container = document.getElementById('notificationsContainer');
        
        if (this.notifications.length === 0) {
            this.showEmptyState();
            return;
        }

        container.innerHTML = '';
        
        this.notifications.forEach(notification => {
            const notificationElement = this.createNotificationElement(notification);
            container.appendChild(notificationElement);
        });

        this.showNotificationsContainer();
        this.updateLoadMoreButton();
    }

    createNotificationElement(notification) {
        const div = document.createElement('div');
        div.className = `notification-item ${!notification.is_read ? 'unread' : ''}`;
        div.dataset.notificationId = notification.id;

        const iconClass = this.getNotificationIcon(notification.type);
        const priorityClass = notification.priority || 'normal';
        const timeAgo = this.formatTimeAgo(notification.created_at);

        div.innerHTML = `
            ${!notification.is_read ? '<div class="unread-indicator"></div>' : ''}
            <div class="notification-content">
                <div class="notification-icon ${notification.type}">
                    <i class="${iconClass}"></i>
                </div>
                <div class="notification-body">
                    <div class="notification-title">${this.escapeHtml(notification.title)}</div>
                    <div class="notification-message">${this.escapeHtml(notification.message)}</div>
                    <div class="notification-meta">
                        <div class="notification-time">
                            <i class="fas fa-clock"></i>
                            ${timeAgo}
                        </div>
                        <div class="notification-type">
                            <i class="fas fa-tag"></i>
                            ${notification.type}
                        </div>
                        <div class="notification-priority ${priorityClass}">
                            ${priorityClass}
                        </div>
                    </div>
                </div>
                <div class="notification-actions">
                    ${!notification.is_read ? `
                        <button class="notification-action-btn" onclick="notificationsManager.markAsRead(${notification.id})" title="Mark as read">
                            <i class="fas fa-check"></i>
                        </button>
                    ` : ''}
                    <button class="notification-action-btn" onclick="notificationsManager.showNotificationDetails(${notification.id})" title="View details">
                        <i class="fas fa-eye"></i>
                    </button>
                </div>
            </div>
        `;

        div.addEventListener('click', () => {
            this.showNotificationDetails(notification.id);
        });

        return div;
    }

    getNotificationIcon(type) {
        const icons = {
            system: 'fas fa-cogs',
            lhdn: 'fas fa-globe',
            announcement: 'fas fa-bullhorn',
            alert: 'fas fa-exclamation-triangle'
        };
        return icons[type] || 'fas fa-bell';
    }

    formatTimeAgo(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffInSeconds = Math.floor((now - date) / 1000);

        if (diffInSeconds < 60) return 'Just now';
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
        if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
        if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
        
        return date.toLocaleDateString();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async markAsRead(notificationId) {
        try {
            const response = await fetch(`/api/notifications/${notificationId}/read`, {
                method: 'PUT'
            });
            
            if (response.ok) {
                // Update UI
                const notificationElement = document.querySelector(`[data-notification-id="${notificationId}"]`);
                if (notificationElement) {
                    notificationElement.classList.remove('unread');
                    const indicator = notificationElement.querySelector('.unread-indicator');
                    if (indicator) indicator.remove();
                    
                    const actions = notificationElement.querySelector('.notification-actions');
                    if (actions) {
                        const markReadBtn = actions.querySelector('.notification-action-btn');
                        if (markReadBtn && markReadBtn.title === 'Mark as read') {
                            markReadBtn.remove();
                        }
                    }
                }
                
                this.loadNotificationStats();
            }
        } catch (error) {
            console.error('Error marking notification as read:', error);
        }
    }

    async markAllAsRead() {
        try {
            const response = await fetch('/api/notifications/mark-all-read', {
                method: 'PUT'
            });
            
            if (response.ok) {
                // Refresh notifications
                this.currentOffset = 0;
                this.loadNotifications();
                this.loadNotificationStats();
                
                this.showSuccessMessage('All notifications marked as read');
            }
        } catch (error) {
            console.error('Error marking all notifications as read:', error);
            this.showErrorMessage('Failed to mark all notifications as read');
        }
    }

    async syncLHDNNotifications() {
        const btn = document.getElementById('syncLHDNBtn');
        const originalText = btn.innerHTML;
        
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
        btn.disabled = true;

        try {
            const response = await fetch('/api/notifications/sync-lhdn', {
                method: 'POST'
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showSuccessMessage(`Synced ${data.data.synced} LHDN notifications`);
                this.currentOffset = 0;
                this.loadNotifications();
                this.loadNotificationStats();
            } else {
                this.showErrorMessage(data.message || 'Failed to sync LHDN notifications');
            }
        } catch (error) {
            console.error('Error syncing LHDN notifications:', error);
            this.showErrorMessage('Failed to sync LHDN notifications');
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }

    showNotificationDetails(notificationId) {
        const notification = this.notifications.find(n => n.id == notificationId);
        if (!notification) return;

        const modal = document.getElementById('notificationModal');
        const title = document.getElementById('notificationModalTitle');
        const body = document.getElementById('notificationModalBody');
        const markReadBtn = document.getElementById('markAsReadBtn');

        title.textContent = notification.title;
        
        body.innerHTML = `
            <div class="notification-modal-content">
                <div class="notification-modal-header">
                    <div class="notification-icon ${notification.type}">
                        <i class="${this.getNotificationIcon(notification.type)}"></i>
                    </div>
                    <div>
                        <h6 class="mb-1">${this.escapeHtml(notification.title)}</h6>
                        <small class="text-muted">${notification.type} • ${this.formatTimeAgo(notification.created_at)}</small>
                    </div>
                </div>
                <div class="notification-modal-body">
                    ${this.escapeHtml(notification.message)}
                </div>
                <div class="notification-modal-meta">
                    <div class="row">
                        <div class="col-sm-3">Priority:</div>
                        <div class="col-sm-9">
                            <span class="notification-priority ${notification.priority || 'normal'}">
                                ${notification.priority || 'normal'}
                            </span>
                        </div>
                    </div>
                    <div class="row">
                        <div class="col-sm-3">Source:</div>
                        <div class="col-sm-9">${notification.source_type || 'Internal'}</div>
                    </div>
                    <div class="row">
                        <div class="col-sm-3">Created:</div>
                        <div class="col-sm-9">${new Date(notification.created_at).toLocaleString()}</div>
                    </div>
                </div>
            </div>
        `;

        // Show/hide mark as read button
        if (!notification.is_read) {
            markReadBtn.style.display = 'inline-block';
            markReadBtn.onclick = () => {
                this.markAsRead(notification.id);
                bootstrap.Modal.getInstance(modal).hide();
            };
        } else {
            markReadBtn.style.display = 'none';
        }

        new bootstrap.Modal(modal).show();
    }

    showLoadingState() {
        document.getElementById('notificationsLoading').style.display = 'block';
        document.getElementById('notificationsContainer').style.display = 'none';
        document.getElementById('notificationsEmpty').style.display = 'none';
        document.getElementById('notificationsError').style.display = 'none';
    }

    showNotificationsContainer() {
        document.getElementById('notificationsLoading').style.display = 'none';
        document.getElementById('notificationsContainer').style.display = 'block';
        document.getElementById('notificationsEmpty').style.display = 'none';
        document.getElementById('notificationsError').style.display = 'none';
    }

    showEmptyState() {
        document.getElementById('notificationsLoading').style.display = 'none';
        document.getElementById('notificationsContainer').style.display = 'none';
        document.getElementById('notificationsEmpty').style.display = 'block';
        document.getElementById('notificationsError').style.display = 'none';
    }

    showErrorState() {
        document.getElementById('notificationsLoading').style.display = 'none';
        document.getElementById('notificationsContainer').style.display = 'none';
        document.getElementById('notificationsEmpty').style.display = 'none';
        document.getElementById('notificationsError').style.display = 'block';
    }

    updateNotificationCount() {
        document.getElementById('notificationCount').textContent = this.notifications.length;
    }

    updateLoadMoreButton() {
        const container = document.getElementById('loadMoreContainer');
        if (this.notifications.length >= this.currentLimit) {
            container.style.display = 'block';
        } else {
            container.style.display = 'none';
        }
    }

    showSuccessMessage(message) {
        // You can implement a toast notification system here
        alert(message); // Temporary implementation
    }

    showErrorMessage(message) {
        // You can implement a toast notification system here
        alert(message); // Temporary implementation
    }
}

// Initialize notifications manager when page loads
let notificationsManager;
document.addEventListener('DOMContentLoaded', () => {
    notificationsManager = new NotificationsManager();
});

// Global function for external calls
function loadNotifications() {
    if (notificationsManager) {
        notificationsManager.currentOffset = 0;
        notificationsManager.loadNotifications();
    }
}
