// Developer Settings Page JavaScript
class DeveloperSettingsManager {
    constructor() {
        this.currentSection = 'announcements';
        this.announcements = [];
        this.news = [];
        this.currentFilter = 'all';
        this.currentNewsFilter = 'all';
        this.tinymceEditor = null;
        this.newsEditor = null;

        this.initializeEventListeners();
        this.initializeTinyMCE();
        this.loadAnnouncementData();
    }

    initializeEventListeners() {
        // Navigation items
        document.querySelectorAll('.settings-nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const section = item.dataset.section;
                this.switchSection(section);
            });
        });

        // Create announcement button
        document.getElementById('createAnnouncementBtn').addEventListener('click', () => {
            this.showCreateAnnouncementModal();
        });

        // Create news button
        const createNewsBtn = document.getElementById('createNewsBtn');
        if (createNewsBtn) {
            createNewsBtn.addEventListener('click', () => {
                this.showCreateNewsModal();
            });
        }

        // Filter buttons for announcements
        document.querySelectorAll('.announcements-filter .filter-buttons .btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.setAnnouncementFilter(e.target.dataset.filter);
            });
        });

        // Filter buttons for news
        document.querySelectorAll('.news-filter .filter-buttons .btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.setNewsFilter(e.target.dataset.filter);
            });
        });

        // Modal buttons for announcements
        document.getElementById('saveAsDraftBtn').addEventListener('click', () => {
            this.saveAnnouncement('draft');
        });

        document.getElementById('publishAnnouncementBtn').addEventListener('click', () => {
            this.saveAnnouncement('published');
        });

        // Modal buttons for news
        const saveNewsAsDraftBtn = document.getElementById('saveNewsAsDraftBtn');
        if (saveNewsAsDraftBtn) {
            saveNewsAsDraftBtn.addEventListener('click', () => {
                this.saveNews('draft');
            });
        }

        const publishNewsBtn = document.getElementById('publishNewsBtn');
        if (publishNewsBtn) {
            publishNewsBtn.addEventListener('click', () => {
                this.saveNews('published');
            });
        }

        // Search functionality
        document.getElementById('announcementSearch').addEventListener('input', (e) => {
            this.searchAnnouncements(e.target.value);
        });

        const newsSearch = document.getElementById('newsSearch');
        if (newsSearch) {
            newsSearch.addEventListener('input', (e) => {
                this.searchNews(e.target.value);
            });
        }
    }

    initializeTinyMCE() {
        if (typeof tinymce !== 'undefined') {
            // Initialize announcement editor
            tinymce.init({
                selector: '#announcementContent',
                height: 300,
                menubar: false,
                plugins: [
                    'advlist', 'autolink', 'lists', 'link', 'image', 'charmap',
                    'anchor', 'searchreplace', 'visualblocks', 'code', 'fullscreen',
                    'insertdatetime', 'media', 'table', 'help', 'wordcount'
                ],
                toolbar: 'undo redo | blocks | bold italic forecolor | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | removeformat | help',
                content_style: 'body { font-family:Helvetica,Arial,sans-serif; font-size:14px }',
                setup: (editor) => {
                    this.tinymceEditor = editor;
                }
            });

            // Initialize news editor
            tinymce.init({
                selector: '#newsContent',
                height: 300,
                menubar: false,
                plugins: [
                    'advlist', 'autolink', 'lists', 'link', 'image', 'charmap',
                    'anchor', 'searchreplace', 'visualblocks', 'code', 'fullscreen',
                    'insertdatetime', 'media', 'table', 'help', 'wordcount'
                ],
                toolbar: 'undo redo | blocks | bold italic forecolor | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | removeformat | help',
                content_style: 'body { font-family:Helvetica,Arial,sans-serif; font-size:14px }',
                setup: (editor) => {
                    this.newsEditor = editor;
                }
            });
        }
    }

    switchSection(section) {
        // Update navigation
        document.querySelectorAll('.settings-nav-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-section="${section}"]`).classList.add('active');

        // Update content
        document.querySelectorAll('.settings-section').forEach(sec => {
            sec.classList.remove('active');
            sec.style.display = 'none';
        });

        const targetSection = document.getElementById(section);
        if (targetSection) {
            targetSection.classList.add('active');
            targetSection.style.display = 'block';
        }

        this.currentSection = section;

        // Load section-specific data
        if (section === 'announcements') {
            this.loadAnnouncementData();
        } else if (section === 'news') {
            this.loadNewsData();
        } else if (section === 'system-monitoring') {
            this.loadSystemMonitoring();
        }
    }

    async loadAnnouncementData() {
        try {
            // Load announcements
            const response = await fetch('/api/announcements/admin');
            const data = await response.json();

            if (data.success) {
                this.announcements = data.data;
                this.renderAnnouncementsTable();
            }

            // Load stats
            const statsResponse = await fetch('/api/announcements/admin/stats');
            const statsData = await statsResponse.json();

            if (statsData.success) {
                this.updateAnnouncementStats(statsData.data);
            }
        } catch (error) {
            console.error('Error loading announcement data:', error);
            this.showErrorMessage('Failed to load announcement data');
        }
    }

    updateAnnouncementStats(stats) {
        document.getElementById('totalAnnouncements').textContent = stats.total;
        document.getElementById('activeAnnouncements').textContent = stats.active;

        // Calculate drafts and pinned from breakdown
        const drafts = stats.breakdown.find(b => b.status === 'draft')?._count?.id || 0;
        document.getElementById('draftAnnouncements').textContent = drafts;

        // For pinned, we'd need to modify the API to include this info
        document.getElementById('pinnedAnnouncements').textContent = '0'; // Placeholder
    }

    renderAnnouncementsTable() {
        const tbody = document.getElementById('announcementsTableBody');
        const loading = document.getElementById('announcementsLoading');
        const empty = document.getElementById('announcementsEmpty');

        loading.style.display = 'none';

        if (this.announcements.length === 0) {
            empty.style.display = 'block';
            tbody.innerHTML = '';
            return;
        }

        empty.style.display = 'none';

        let filteredAnnouncements = this.announcements;
        if (this.currentFilter !== 'all') {
            filteredAnnouncements = this.announcements.filter(a => a.status === this.currentFilter);
        }

        tbody.innerHTML = filteredAnnouncements.map(announcement => `
            <tr>
                <td>
                    <div class="d-flex align-items-center">
                        ${announcement.is_pinned ? '<i class="fas fa-thumbtack text-warning me-2"></i>' : ''}
                        <div>
                            <div class="fw-semibold">${this.escapeHtml(announcement.title)}</div>
                            ${announcement.summary ? `<small class="text-muted">${this.escapeHtml(announcement.summary)}</small>` : ''}
                        </div>
                    </div>
                </td>
                <td>
                    <span class="type-badge ${announcement.type}">${announcement.type}</span>
                </td>
                <td>
                    <span class="status-badge ${announcement.status}">${announcement.status}</span>
                </td>
                <td>
                    <span class="target-badge">${announcement.target_audience}</span>
                </td>
                <td>
                    <small>${this.formatDate(announcement.created_at)}</small>
                </td>
                <td>
                    <div class="d-flex gap-1">
                        <button class="action-btn edit" onclick="developerSettings.editAnnouncement(${announcement.id})" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        ${announcement.status === 'draft' ? `
                            <button class="action-btn publish" onclick="developerSettings.publishAnnouncement(${announcement.id})" title="Publish">
                                <i class="fas fa-paper-plane"></i>
                            </button>
                        ` : ''}
                        <button class="action-btn delete" onclick="developerSettings.deleteAnnouncement(${announcement.id})" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    setAnnouncementFilter(filter) {
        // Update filter buttons
        document.querySelectorAll('.filter-buttons .btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-filter="${filter}"]`).classList.add('active');

        this.currentFilter = filter;
        this.renderAnnouncementsTable();
    }

    showCreateAnnouncementModal() {
        this.resetAnnouncementForm();
        document.getElementById('announcementModalTitle').textContent = 'Create Announcement';
        new bootstrap.Modal(document.getElementById('announcementModal')).show();
    }

    editAnnouncement(id) {
        const announcement = this.announcements.find(a => a.id === id);
        if (!announcement) return;

        this.populateAnnouncementForm(announcement);
        document.getElementById('announcementModalTitle').textContent = 'Edit Announcement';
        new bootstrap.Modal(document.getElementById('announcementModal')).show();
    }

    resetAnnouncementForm() {
        document.getElementById('announcementForm').reset();
        document.getElementById('announcementId').value = '';
        if (this.tinymceEditor) {
            this.tinymceEditor.setContent('');
        }
    }

    populateAnnouncementForm(announcement) {
        document.getElementById('announcementId').value = announcement.id;
        document.getElementById('announcementTitle').value = announcement.title;
        document.getElementById('announcementSummary').value = announcement.summary || '';
        document.getElementById('announcementType').value = announcement.type;
        document.getElementById('announcementPriority').value = announcement.priority;
        document.getElementById('announcementAudience').value = announcement.target_audience;
        document.getElementById('announcementPinned').checked = announcement.is_pinned;
        document.getElementById('announcementPopup').checked = announcement.is_popup;

        if (announcement.publish_at) {
            const publishDate = new Date(announcement.publish_at);
            document.getElementById('announcementPublishDate').value = publishDate.toISOString().slice(0, 16);
        }

        if (announcement.expires_at) {
            const expiryDate = new Date(announcement.expires_at);
            document.getElementById('announcementExpiryDate').value = expiryDate.toISOString().slice(0, 16);
        }

        if (this.tinymceEditor) {
            this.tinymceEditor.setContent(announcement.content);
        }
    }

    async saveAnnouncement(status) {
        const formData = this.getAnnouncementFormData();
        formData.status = status;

        const id = document.getElementById('announcementId').value;
        const isEdit = id !== '';

        try {
            const url = isEdit ? `/api/announcements/${id}` : '/api/announcements';
            const method = isEdit ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (data.success) {
                this.showSuccessMessage(`Announcement ${isEdit ? 'updated' : 'created'} successfully`);
                bootstrap.Modal.getInstance(document.getElementById('announcementModal')).hide();
                this.loadAnnouncementData();
            } else {
                this.showErrorMessage(data.message || 'Failed to save announcement');
            }
        } catch (error) {
            console.error('Error saving announcement:', error);
            this.showErrorMessage('Failed to save announcement');
        }
    }

    getAnnouncementFormData() {
        const content = this.tinymceEditor ? this.tinymceEditor.getContent() : document.getElementById('announcementContent').value;

        return {
            title: document.getElementById('announcementTitle').value,
            summary: document.getElementById('announcementSummary').value,
            content: content,
            type: document.getElementById('announcementType').value,
            priority: document.getElementById('announcementPriority').value,
            targetAudience: document.getElementById('announcementAudience').value,
            isPinned: document.getElementById('announcementPinned').checked,
            isPopup: document.getElementById('announcementPopup').checked,
            publishAt: document.getElementById('announcementPublishDate').value || null,
            expiresAt: document.getElementById('announcementExpiryDate').value || null
        };
    }

    async publishAnnouncement(id) {
        if (!confirm('Are you sure you want to publish this announcement?')) return;

        try {
            const response = await fetch(`/api/announcements/${id}/publish`, {
                method: 'PUT'
            });

            const data = await response.json();

            if (data.success) {
                this.showSuccessMessage('Announcement published successfully');
                this.loadAnnouncementData();
            } else {
                this.showErrorMessage(data.message || 'Failed to publish announcement');
            }
        } catch (error) {
            console.error('Error publishing announcement:', error);
            this.showErrorMessage('Failed to publish announcement');
        }
    }

    async deleteAnnouncement(id) {
        if (!confirm('Are you sure you want to delete this announcement? This action cannot be undone.')) return;

        try {
            const response = await fetch(`/api/announcements/${id}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (data.success) {
                this.showSuccessMessage('Announcement deleted successfully');
                this.loadAnnouncementData();
            } else {
                this.showErrorMessage(data.message || 'Failed to delete announcement');
            }
        } catch (error) {
            console.error('Error deleting announcement:', error);
            this.showErrorMessage('Failed to delete announcement');
        }
    }

    searchAnnouncements(query) {
        // Simple client-side search
        const rows = document.querySelectorAll('#announcementsTableBody tr');

        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            const matches = text.includes(query.toLowerCase());
            row.style.display = matches ? '' : 'none';
        });
    }

    // News Management Methods
    async loadNewsData() {
        try {
            // For now, we'll use placeholder data since we don't have a news API yet
            this.news = [
                {
                    id: 1,
                    title: 'New Dashboard Features Released',
                    category: 'feature',
                    status: 'published',
                    views: 245,
                    created_at: new Date().toISOString(),
                    summary: 'Enhanced dashboard with new analytics and reporting features.',
                    content: 'We are excited to announce new dashboard features...'
                },
                {
                    id: 2,
                    title: 'System Maintenance Scheduled',
                    category: 'maintenance',
                    status: 'draft',
                    views: 0,
                    created_at: new Date().toISOString(),
                    summary: 'Scheduled maintenance for system upgrades.',
                    content: 'We will be performing scheduled maintenance...'
                }
            ];

            this.renderNewsTable();
            this.updateNewsStats();
        } catch (error) {
            console.error('Error loading news data:', error);
            this.showErrorMessage('Failed to load news data');
        }
    }

    updateNewsStats() {
        const total = this.news.length;
        const published = this.news.filter(n => n.status === 'published').length;
        const drafts = this.news.filter(n => n.status === 'draft').length;
        const featured = this.news.filter(n => n.featured).length;

        document.getElementById('totalNews').textContent = total;
        document.getElementById('publishedNews').textContent = published;
        document.getElementById('draftNews').textContent = drafts;
        document.getElementById('featuredNews').textContent = featured;
    }

    renderNewsTable() {
        const tbody = document.getElementById('newsTableBody');
        const loading = document.getElementById('newsLoading');
        const empty = document.getElementById('newsEmpty');

        if (loading) loading.style.display = 'none';

        if (this.news.length === 0) {
            if (empty) empty.style.display = 'block';
            if (tbody) tbody.innerHTML = '';
            return;
        }

        if (empty) empty.style.display = 'none';

        let filteredNews = this.news;
        if (this.currentNewsFilter !== 'all') {
            filteredNews = this.news.filter(n => n.status === this.currentNewsFilter);
        }

        if (tbody) {
            tbody.innerHTML = filteredNews.map(article => `
                <tr>
                    <td>
                        <div class="d-flex align-items-center">
                            ${article.featured ? '<i class="fas fa-star text-warning me-2"></i>' : ''}
                            <div>
                                <div class="fw-semibold">${this.escapeHtml(article.title)}</div>
                                ${article.summary ? `<small class="text-muted">${this.escapeHtml(article.summary)}</small>` : ''}
                            </div>
                        </div>
                    </td>
                    <td>
                        <span class="category-badge ${article.category}">${article.category}</span>
                    </td>
                    <td>
                        <span class="status-badge ${article.status}">${article.status}</span>
                    </td>
                    <td>
                        <span class="text-muted">${article.views || 0}</span>
                    </td>
                    <td>
                        <small>${this.formatDate(article.created_at)}</small>
                    </td>
                    <td>
                        <div class="d-flex gap-1">
                            <button class="action-btn edit" onclick="developerSettings.editNews(${article.id})" title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                            ${article.status === 'draft' ? `
                                <button class="action-btn publish" onclick="developerSettings.publishNews(${article.id})" title="Publish">
                                    <i class="fas fa-paper-plane"></i>
                                </button>
                            ` : ''}
                            <button class="action-btn delete" onclick="developerSettings.deleteNews(${article.id})" title="Delete">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');
        }
    }

    setNewsFilter(filter) {
        // Update filter buttons
        document.querySelectorAll('.news-filter .filter-buttons .btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`.news-filter [data-filter="${filter}"]`).classList.add('active');

        this.currentNewsFilter = filter;
        this.renderNewsTable();
    }

    showCreateNewsModal() {
        this.resetNewsForm();
        document.getElementById('newsModalTitle').textContent = 'Create News Article';
        new bootstrap.Modal(document.getElementById('newsModal')).show();
    }

    editNews(id) {
        const article = this.news.find(n => n.id === id);
        if (!article) return;

        this.populateNewsForm(article);
        document.getElementById('newsModalTitle').textContent = 'Edit News Article';
        new bootstrap.Modal(document.getElementById('newsModal')).show();
    }

    resetNewsForm() {
        document.getElementById('newsForm').reset();
        document.getElementById('newsId').value = '';
        if (this.newsEditor) {
            this.newsEditor.setContent('');
        }
    }

    populateNewsForm(article) {
        document.getElementById('newsId').value = article.id;
        document.getElementById('newsTitle').value = article.title;
        document.getElementById('newsSummary').value = article.summary || '';
        document.getElementById('newsCategory').value = article.category;
        document.getElementById('newsPriority').value = article.priority || 'normal';
        document.getElementById('newsVisibility').value = article.visibility || 'public';
        document.getElementById('newsFeatured').checked = article.featured || false;
        document.getElementById('newsNotify').checked = article.notify || false;
        document.getElementById('newsTags').value = article.tags || '';

        if (article.publish_at) {
            const publishDate = new Date(article.publish_at);
            document.getElementById('newsPublishDate').value = publishDate.toISOString().slice(0, 16);
        }

        if (this.newsEditor) {
            this.newsEditor.setContent(article.content);
        }
    }

    async saveNews(status) {
        const formData = this.getNewsFormData();
        formData.status = status;

        const id = document.getElementById('newsId').value;
        const isEdit = id !== '';

        try {
            // For now, just simulate saving since we don't have a news API yet
            console.log('Saving news:', formData);

            if (isEdit) {
                const index = this.news.findIndex(n => n.id == id);
                if (index !== -1) {
                    this.news[index] = { ...this.news[index], ...formData, id: parseInt(id) };
                }
            } else {
                const newId = Math.max(...this.news.map(n => n.id), 0) + 1;
                this.news.push({ ...formData, id: newId, created_at: new Date().toISOString(), views: 0 });
            }

            this.showSuccessMessage(`News article ${isEdit ? 'updated' : 'created'} successfully`);
            bootstrap.Modal.getInstance(document.getElementById('newsModal')).hide();
            this.renderNewsTable();
            this.updateNewsStats();
        } catch (error) {
            console.error('Error saving news:', error);
            this.showErrorMessage('Failed to save news article');
        }
    }

    getNewsFormData() {
        const content = this.newsEditor ? this.newsEditor.getContent() : document.getElementById('newsContent').value;

        return {
            title: document.getElementById('newsTitle').value,
            summary: document.getElementById('newsSummary').value,
            content: content,
            category: document.getElementById('newsCategory').value,
            priority: document.getElementById('newsPriority').value,
            visibility: document.getElementById('newsVisibility').value,
            featured: document.getElementById('newsFeatured').checked,
            notify: document.getElementById('newsNotify').checked,
            tags: document.getElementById('newsTags').value,
            publishAt: document.getElementById('newsPublishDate').value || null
        };
    }

    async publishNews(id) {
        if (!confirm('Are you sure you want to publish this news article?')) return;

        try {
            const index = this.news.findIndex(n => n.id == id);
            if (index !== -1) {
                this.news[index].status = 'published';
                this.showSuccessMessage('News article published successfully');
                this.renderNewsTable();
                this.updateNewsStats();
            }
        } catch (error) {
            console.error('Error publishing news:', error);
            this.showErrorMessage('Failed to publish news article');
        }
    }

    async deleteNews(id) {
        if (!confirm('Are you sure you want to delete this news article? This action cannot be undone.')) return;

        try {
            const index = this.news.findIndex(n => n.id == id);
            if (index !== -1) {
                this.news.splice(index, 1);
                this.showSuccessMessage('News article deleted successfully');
                this.renderNewsTable();
                this.updateNewsStats();
            }
        } catch (error) {
            console.error('Error deleting news:', error);
            this.showErrorMessage('Failed to delete news article');
        }
    }

    searchNews(query) {
        // Simple client-side search
        const rows = document.querySelectorAll('#newsTableBody tr');

        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            const matches = text.includes(query.toLowerCase());
            row.style.display = matches ? '' : 'none';
        });
    }

    loadSystemMonitoring() {
        // Placeholder for system monitoring functionality
        console.log('Loading system monitoring data...');
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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

// Global functions for external calls
function showCreateAnnouncementModal() {
    if (window.developerSettings) {
        window.developerSettings.showCreateAnnouncementModal();
    }
}

function showCreateNewsModal() {
    if (window.developerSettings) {
        window.developerSettings.showCreateNewsModal();
    }
}

function updateHelpUrl() {
    const url = document.getElementById('helpUrl').value;
    // Implement help URL update functionality
    alert('Help URL updated: ' + url);
}

function openHelpEditor() {
    // Implement help editor functionality
    window.open('/help', '_blank');
}

function previewHelp() {
    // Implement help preview functionality
    window.open('/help', '_blank');
}

function savePortalSettings() {
    const settings = {
        api: {
            rateLimit: document.getElementById('apiRateLimit').value,
            timeout: document.getElementById('apiTimeout').value,
            retryAttempts: document.getElementById('retryAttempts').value
        },
        security: {
            sessionTimeout: document.getElementById('sessionTimeout').value,
            maxLoginAttempts: document.getElementById('maxLoginAttempts').value,
            lockoutDuration: document.getElementById('lockoutDuration').value,
            enforceHttps: document.getElementById('enforceHttps').checked,
            enableTwoFactor: document.getElementById('enableTwoFactor').checked
        },
        dataManagement: {
            logRetention: document.getElementById('logRetention').value,
            notificationRetention: document.getElementById('notificationRetention').value,
            fileCleanup: document.getElementById('fileCleanup').value,
            autoBackup: document.getElementById('autoBackup').checked,
            compressLogs: document.getElementById('compressLogs').checked
        },
        email: {
            smtpServer: document.getElementById('smtpServer').value,
            smtpPort: document.getElementById('smtpPort').value,
            smtpEncryption: document.getElementById('smtpEncryption').value,
            fromEmail: document.getElementById('fromEmail').value,
            adminEmail: document.getElementById('adminEmail').value
        },
        maintenance: {
            mode: document.getElementById('maintenanceMode').value,
            start: document.getElementById('maintenanceStart').value,
            end: document.getElementById('maintenanceEnd').value,
            message: document.getElementById('maintenanceMessage').value
        }
    };

    // Here you would typically send this to your API
    console.log('Saving portal settings:', settings);
    alert('Portal settings saved successfully!');
}

function resetPortalSettings() {
    if (!confirm('Are you sure you want to reset all settings to defaults?')) return;

    // Reset to default values
    document.getElementById('apiRateLimit').value = '300';
    document.getElementById('apiTimeout').value = '30';
    document.getElementById('retryAttempts').value = '3';
    document.getElementById('sessionTimeout').value = '30';
    document.getElementById('maxLoginAttempts').value = '5';
    document.getElementById('lockoutDuration').value = '15';
    document.getElementById('enforceHttps').checked = true;
    document.getElementById('enableTwoFactor').checked = false;
    document.getElementById('logRetention').value = '90';
    document.getElementById('notificationRetention').value = '30';
    document.getElementById('fileCleanup').value = '90';
    document.getElementById('autoBackup').checked = true;
    document.getElementById('compressLogs').checked = false;
    document.getElementById('smtpServer').value = '';
    document.getElementById('smtpPort').value = '587';
    document.getElementById('smtpEncryption').value = 'tls';
    document.getElementById('fromEmail').value = '';
    document.getElementById('adminEmail').value = '';
    document.getElementById('maintenanceMode').value = 'off';
    document.getElementById('maintenanceStart').value = '';
    document.getElementById('maintenanceEnd').value = '';
    document.getElementById('maintenanceMessage').value = '';

    alert('Settings reset to defaults');
}

// Initialize developer settings manager when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.developerSettings = new DeveloperSettingsManager();
});
