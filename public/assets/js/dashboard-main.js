// Dashboard Main JavaScript
class Dashboard {
    constructor() {
        this.initializeEventListeners();
        this.initializeDashboard();
    }

    initializeEventListeners() {
        document.addEventListener('DOMContentLoaded', () => {
            this.updateDateTime();
            this.initWeeklyChart();
            this.loadActivityLogs();
            this.loadSDKUpdates();
            this.initializeTooltips();
            this.setupChartPeriodButtons();
            this.applyAvatarGradients();
        });
    }

    initializeDashboard() {
        this.updateStatCards();
        this.loadTopCustomers();
        this.loadActivityLogs();
        this.refreshSystemStatus();
    }

    // DateTime Functions
    updateDateTime() {
        const timeElement = document.getElementById('currentTime');
        const dateElement = document.getElementById('currentDate');
        
        const update = () => {
            const now = new Date();
            
            if (timeElement && dateElement) {
                timeElement.textContent = now.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
                
                dateElement.textContent = now.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            }
        };
        
        update();
        setInterval(update, 1000);
    }

    // Chart Functions
    initWeeklyChart() {
        const ctx = document.getElementById('weeklyChart')?.getContext('2d');
        if (!ctx) return;

        const data = {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [
                {
                    label: 'Valid',
                    data: [4, 6, 3, 5, 2, 3, 4],
                    backgroundColor: '#10b981'
                },
                {
                    label: 'Invalid',
                    data: [1, 2, 1, 1, 0, 1, 1],
                    backgroundColor: '#ef4444'
                },
                {
                    label: 'Rejected',
                    data: [0, 1, 0, 1, 1, 0, 0],
                    backgroundColor: '#f59e0b'
                },
                {
                    label: 'Cancelled',
                    data: [0, 0, 1, 0, 0, 1, 0],
                    backgroundColor: '#6b7280'
                }
            ]
        };

        new Chart(ctx, {
            type: 'bar',
            data: data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        stacked: true,
                        grid: { display: false }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        ticks: { stepSize: 1 }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }

    setupChartPeriodButtons() {
        const periodButtons = document.querySelectorAll('[data-period]');
        
        periodButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                periodButtons.forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                this.updateChart(e.target.getAttribute('data-period'));
            });
        });
    }

    updateChart(period) {
        // Implement chart update logic based on period
        console.log('Updating chart for period:', period);
    }

    // Status Functions
    updateStatCards() {
        const elements = {
            outbound: document.getElementById('fileCount'),
            inbound: document.getElementById('inboundCount'),
            company: document.getElementById('companyCount')
        };

        if (!elements.outbound || !elements.inbound || !elements.company) return;

        const counts = {
            outbound: parseInt(elements.outbound.textContent) || 0,
            inbound: parseInt(elements.inbound.textContent) || 0,
            company: parseInt(elements.company.textContent) || 0
        };

        const percentages = {
            outbound: Math.min(counts.outbound * 2, 100),
            inbound: Math.min(counts.inbound * 0.8, 100),
            companies: Math.min(counts.company * 10, 100)
        };

        Object.entries(percentages).forEach(([key, value]) => {
            const progressBar = document.getElementById(`${key}Progress`);
            if (progressBar) {
                progressBar.style.width = `${value}%`;
            }
        });
    }

    updateInvoiceStatus() {
        const statusItems = [
            { id: 'submitted', range: [90, 95] },
            { id: 'valid', range: [85, 92] },
            { id: 'invalid', range: [4, 8] },
            { id: 'cancelled', range: [2, 5] }
        ];

        statusItems.forEach(({ id, range: [min, max] }) => {
            const element = document.querySelector(`.status-item.${id} .status-value`);
            if (element) {
                const value = Math.floor(Math.random() * (max - min + 1)) + min;
                element.textContent = `${value}%`;
            }
        });
    }

    refreshSystemStatus() {
        const now = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });

        // Update timestamps and status indicators
        const elements = {
            apiStatus: document.querySelector('.status-time'),
            syncTime: document.querySelector('.system-status-info .fw-semibold'),
            queueCount: document.querySelector('.system-status-content:last-child .system-status-info span:first-child')
        };

        if (elements.apiStatus) elements.apiStatus.textContent = `Last: ${now}`;
        if (elements.syncTime) elements.syncTime.textContent = `${Math.floor(Math.random() * 10) + 1} mins ago`;
        if (elements.queueCount) elements.queueCount.textContent = `${Math.floor(Math.random() * 3)} Total Queue`;
    }

    // Customer Functions
    loadTopCustomers() {
        const customerList = document.getElementById('customer-list');
        if (!customerList) return;

        customerList.innerHTML = '<div class="spinner-border spinner-border-sm text-primary mb-3" role="status"></div>';

        // Simulate API call (replace with actual API endpoint)
        setTimeout(() => {
            this.fetchCustomers()
                .then(this.renderCustomers.bind(this))
                .catch(this.handleCustomerError.bind(this));
        }, 500);
    }

    async fetchCustomers() {
        try {
            const response = await fetch('/api/dashboard/customers');
            const data = await response.json();
            if (!data.success) throw new Error('Failed to fetch customers');
            return data.customers;
        } catch (error) {
            throw new Error('Error loading customers');
        }
    }

    renderCustomers(customers) {
        const customerList = document.getElementById('customer-list');
        if (!customerList || !customers?.length) {
            customerList.innerHTML = '<div class="text-center text-muted my-3">No customer data available</div>';
            return;
        }

        customerList.innerHTML = customers.map(customer => this.createCustomerHTML(customer)).join('');
        this.applyAvatarGradients();
    }

    createCustomerHTML(customer) {
        const initials = this.getInitials(customer.name);
        return `
            <div class="customer-item d-flex align-items-center p-2 rounded hover-bg">
                <div class="customer-avatar me-3">
                    <div class="avatar-wrapper">
                        <div class="avatar-fallback" data-initial="${initials}">${initials}</div>
                    </div>
                </div>
                <div class="customer-info flex-grow-1">
                    <div class="d-flex justify-content-between align-items-center">
                        <h6 class="mb-0 customer-name">${customer.name}</h6>
                        <span class="badge bg-${customer.status === 'Active' ? 'success' : 'warning'}-subtle 
                               text-${customer.status === 'Active' ? 'success' : 'warning'}">${customer.status}</span>
                    </div>
                    <div class="d-flex justify-content-between align-items-center mt-1">
                        <small class="text-muted">
                            <i class="fas fa-file-invoice me-1"></i>${customer.invoiceCount} invoices
                        </small>
                        <span class="fw-semibold text-secondary">${customer.amount}</span>
                    </div>
                </div>
            </div>
        `;
    }

    handleCustomerError(error) {
        const customerList = document.getElementById('customer-list');
        if (customerList) {
            customerList.innerHTML = '<div class="text-center text-danger my-3">Failed to load customer data</div>';
        }
        console.error('Customer loading error:', error);
    }

    // Activity Log Functions
    loadActivityLogs() {
        const container = document.querySelector('.activity-log-container');
        if (!container) return;

        const activities = [
            {
                type: 'success',
                icon: 'check-circle',
                message: 'Invoice #INV-2023-001 validated successfully',
                time: '2 mins ago',
                user: 'System'
            },
            {
                type: 'info',
                icon: 'info-circle',
                message: 'New inbound invoice received',
                time: '5 mins ago',
                user: 'API'
            },
            {
                type: 'warning',
                icon: 'exclamation-circle',
                message: 'Sync delayed due to network latency',
                time: '10 mins ago',
                user: 'System'
            }
        ];

        container.innerHTML = activities.map(activity => this.createActivityHTML(activity)).join('');
    }

    createActivityHTML(activity) {
        return `
            <div class="activity-item ${activity.type}-log">
                <div class="d-flex">
                    <div class="activity-icon ${activity.type}-icon">
                        <i class="fas fa-${activity.icon}"></i>
                    </div>
                    <div class="flex-grow-1">
                        <div class="activity-time">${activity.time}</div>
                        <div class="activity-message">${activity.message}</div>
                        <div class="activity-user">
                            <span>${activity.user}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // SDK Updates Functions
    loadSDKUpdates() {
        const container = document.getElementById('sdk-updates-list');
        if (!container) return;

        const updates = [
            {
                version: '1.2.0',
                date: '2023-04-28',
                description: 'Added support for new invoice formats'
            },
            {
                version: '1.1.5',
                date: '2023-04-25',
                description: 'Performance improvements and bug fixes'
            }
        ];

        container.innerHTML = updates.map(update => `
            <div class="sdk-update-item p-2 mb-2 rounded hover-bg">
                <div class="d-flex justify-content-between align-items-center">
                    <span class="fw-semibold">Version ${update.version}</span>
                    <small class="text-muted">${update.date}</small>
                </div>
                <p class="mb-0 small text-muted">${update.description}</p>
            </div>
        `).join('');
    }

    // Utility Functions
    getInitials(name) {
        if (!name) return 'NA';
        return name.split(' ')
            .map(part => part.charAt(0))
            .join('')
            .substring(0, 2)
            .toUpperCase();
    }

    generateGradientFromString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        
        const hue1 = hash % 360;
        const hue2 = (hue1 + 40) % 360;
        
        return `linear-gradient(45deg, 
            hsl(${hue1}, 70%, 50%), 
            hsl(${hue2}, 70%, 45%)
        )`;
    }

    applyAvatarGradients() {
        const avatarFallbacks = document.querySelectorAll('.avatar-fallback');
        avatarFallbacks.forEach(fallback => {
            const initial = fallback.getAttribute('data-initial');
            if (initial) {
                fallback.style.background = this.generateGradientFromString(initial);
            }
        });
    }

    initializeTooltips() {
        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));
    }
}

// Initialize Dashboard
const dashboard = new Dashboard(); 