class DateTimeManager {
    static updateDateTime() {
        const timeElement = document.getElementById('currentTime');
        const dateElement = document.getElementById('currentDate');
        
        function update() {
            const now = new Date();
            
            if (timeElement) {
                timeElement.textContent = now.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            }
            
            if (dateElement) {
                dateElement.textContent = now.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            }
        }
        
        update();
        setInterval(update, 1000);
    }
}

class LogTableManager {
    static instance = null;

    static getInstance() {
        if (!LogTableManager.instance) {
            LogTableManager.instance = new LogTableManager();
        }
        return LogTableManager.instance;
    }

    constructor() {
        if (LogTableManager.instance) return LogTableManager.instance;
        this.initializeTable();
        LogTableManager.instance = this;
    }

    initializeTable() {
        if ($.fn.DataTable.isDataTable('#logTable')) {
            this.table.destroy();
        }

        this.table = $('#logTable').DataTable({
            processing: true,
            serverSide: true,
            ajax: {
                url: '/api/audit-logs',
                method: 'GET',
                data: (d) => {
                    return {
                        page: (d.start / d.length) + 1,
                        length: d.length,
                        startDate: $('#startDate').val(),
                        endDate: $('#endDate').val(),
                        actionType: $('#actionType').val()
                    };
                },
                dataSrc: (json) => {
                    if (!json.success) {
                        console.error('Error:', json.error);
                        return [];
                    }
                    
                    // Update stats
                    this.updateStats(json.stats);
                    
                    // Set the recordsTotal and recordsFiltered properties
                    json.recordsTotal = json.totalCount || 0;
                    json.recordsFiltered = json.totalCount || 0;
                    
                    // Return logs for DataTable
                    return json.logs.map(log => ({
                        Timestamp: log.Timestamp,
                        User: log.Username,
                        Module: log.Module || '-',
                        Action: this.renderAction(log.ActionType),
                        Description: log.Description,
                        Status: this.renderStatus(log.Status),
                        IPAddress: this.renderIPAddress(log.IPAddress)
                    })) || [];
                }
            },
            columns: [
                { data: 'Timestamp', title: 'TIMESTAMP' },
                { data: 'User', title: 'USER' },
                { data: 'Module', title: 'MODULE' },
                { data: 'Action', title: 'ACTION' },
                { data: 'Description', title: 'DESCRIPTION' },
                { data: 'Status', title: 'STATUS' },
                { data: 'IPAddress', title: 'IP ADDRESS' }
            ],
            paging: true,
            pageLength: 10,
            lengthMenu: [10, 25, 50, 100],
            info: true,
            drawCallback: function(settings) {
                const api = this.api();
                const json = api.ajax.json();
                if (json && json.totalCount) {
                    const totalPages = Math.ceil(json.totalCount / api.page.len());
                    console.log('Total Pages:', totalPages);
                }
            }
        });

        this.initializeFilters();
    }


    getActionType(description) {
        const description_lower = description.toLowerCase();
        if (description_lower.includes('logged in')) return 'Login';
        if (description_lower.includes('logged out')) return 'Logout';
        if (description_lower.includes('created')) return 'Create';
        if (description_lower.includes('updated')) return 'Update';
        if (description_lower.includes('deleted')) return 'Delete';
        return 'Other';
    }

    initializeFilters() {
        $('#startDate, #endDate, #actionType, #moduleType').on('change', () => {
            this.refresh();
        });
    }

    renderUser(data) {
        if (!data) return '<span class="text-muted">System</span>';
        return `
            <div class="d-flex align-items-center">
                <i class="bi bi-person me-2"></i>
                ${data}
            </div>`;
    }

    renderAction(action) {
        const badgeClass = this.getActionBadgeClass(action);
        return `
            <span class="badge ${badgeClass}">
                ${action || 'Unknown'}
            </span>`;
    }

    renderStatus(status) {
        const badgeClass = this.getStatusBadgeClass(status);
        return `
            <span class="badge ${badgeClass}">
                ${status || 'Unknown'}
            </span>`;
    }

    renderIPAddress(data) {
        return `
            <div class="d-flex align-items-center">
                <i class="bi bi-globe me-2"></i>
                ${data || '-'}
            </div>`;
    }

    getActionBadgeClass(action) {
        const classes = {
            'LOGIN': 'bg-success',
            'LOGOUT': 'bg-secondary',
            'CREATE': 'bg-primary',
            'UPDATE': 'bg-info',
            'DELETE': 'bg-danger',
            'VIEW': 'bg-warning'
        };
        return classes[action?.toUpperCase()] || 'bg-secondary';
    }

    getStatusBadgeClass(status) {
        const classes = {
            'SUCCESS': 'bg-success',
            'FAILED': 'bg-danger',
            'WARNING': 'bg-warning',
            'INFO': 'bg-info'
        };
        return classes[status?.toUpperCase()] || 'bg-secondary';
    }

    formatDate(date) {
        if (!date) return '-';
        return new Date(date).toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
    }

    updateStats(stats) {
        $('#totalActivities').text(stats.totalActivities?.toLocaleString() || '0');
        $('#todayActivities').text(stats.todayActivities?.toLocaleString() || '0');
        $('#activeUsers').text(stats.activeUsers?.toLocaleString() || '0');
    }

    styleTable() {
        $('.dataTables_filter input')
            .addClass('form-control form-control-sm')
            .attr('placeholder', 'Search logs...');

        $('.dataTables_length select')
            .addClass('form-select form-select-sm');

        $('.dataTables_paginate')
            .addClass('pagination-container')
            .find('.paginate_button')
            .addClass('page-item')
            .find('a')
            .addClass('page-link');

        $('.dataTables_paginate .active .page-link')
            .addClass('bg-primary text-white border-primary');
    }

    initializeTooltips() {
        $('[data-bs-toggle="tooltip"]').tooltip();
    }

    refresh() {
        this.table.ajax.reload(null, false);
    }

    cleanup() {
        if (this.table) {
            this.table.destroy();
            this.table = null;
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const logManager = LogTableManager.getInstance();
    DateTimeManager.updateDateTime();
});