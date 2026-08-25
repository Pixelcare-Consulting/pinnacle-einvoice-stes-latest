// Initialize stacked bar chart
let dashboardChart = null;

function initStackedBarChart() {
    const options = {
        series: [{
            name: 'Valid',
            data: [0, 0, 0, 0, 0, 0]
        }, {
            name: 'Invalid',
            data: [0, 0, 0, 0, 0, 0]
        }, {
            name: 'Rejected',
            data: [0, 0, 0, 0, 0, 0]
        }, {
            name: 'Cancelled',
            data: [0, 0, 0, 0, 0, 0]
        }, {
            name: 'Pending',
            data: [0, 0, 0, 0, 0, 0]
        }, {
            name: 'Submitted',
            data: [0, 0, 0, 0, 0, 0]
        }],
        chart: {
            type: 'bar',
            height: 500,
            stacked: true,
            toolbar: {
                show: false
            },
            zoom: {
                enabled: false
            },
            background: '#fff',
            fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans"'
        },
        plotOptions: {
            bar: {
                horizontal: false,
                columnWidth: '40%',
                borderRadius: 2
            }
        },
        dataLabels: {
            enabled: false
        },
        stroke: {
            show: false
        },
        colors: [
            '#10B981', // Valid - Success Green
            '#EF4444', // Invalid - Red
            '#EF4444', // Rejected - Danger Red
            '#FACC15', // Cancelled - Yellow
            '#F97316', // Pending - Orange
            '#6B7280'  // Queue - Dark Gray
        ],
        xaxis: {
            categories: [],
            labels: {
                style: {
                    fontSize: '12px',
                    fontWeight: 500
                }
            },
            axisBorder: {
                show: false
            },
            axisTicks: {
                show: false
            },
            tooltip: {
                enabled: false
            }
        },
        yaxis: {
            labels: {
                style: {
                    fontSize: '12px',
                    fontWeight: 500
                }
            }
        },
        tooltip: {
            shared: true,
            intersect: false,
            y: {
                formatter: function (val) {
                    return val + " invoices"
                }
            }
        },
        legend: {
            position: 'top',
            horizontalAlign: 'left',
            offsetY: 10,
            itemMargin: {
                horizontal: 10
            }
        }
    };

    // If chart exists, destroy it first
    if (dashboardChart) {
        dashboardChart.destroy();
    }

    // Create new chart
    dashboardChart = new ApexCharts(document.querySelector("#stackedBarChart"), options);
    dashboardChart.render();
    
    return dashboardChart;
}

// Function to update chart data with debouncing
let updateTimeout = null;
function updateChartData(dates, data) {
    if (!dashboardChart) return;
    
    // Clear any pending updates
    if (updateTimeout) {
        clearTimeout(updateTimeout);
    }
    
    // Debounce the update
    updateTimeout = setTimeout(() => {
        // Format dates for display
        const formattedDates = dates.map(date => {
            const d = new Date(date);
            return d.toLocaleDateString('en-US', {
                weekday: 'short'
            });
        });
        
        // Batch update the chart
        dashboardChart.updateOptions({
            xaxis: {
                categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
            }
        }, false, false);
        
        dashboardChart.updateSeries([{
            name: 'Valid',
            data: data.valid
        }, {
            name: 'Invalid',
            data: data.invalid
        }, {
            name: 'Rejected',
            data: data.rejected
        }, {
            name: 'Cancelled',
            data: data.cancelled
        }, {
            name: 'Pending',
            data: data.pending
        }, {
            name: 'Submitted',
            data: data.submitted
        }], false);
    }, 100);
}