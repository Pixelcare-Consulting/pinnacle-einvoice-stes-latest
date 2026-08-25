// document.addEventListener('DOMContentLoaded', async () => {
//   const activityLog = document.getElementById('activity-log');
//   if (!activityLog) return;

//   // Add helper function to determine log type and get corresponding icon and color
//   const getLogStyle = (description) => {
//     const desc = description.toLowerCase();
//     if (desc.includes('error') || desc.includes('failed') || desc.includes('invalid')) {
//       return {
//         icon: 'bi-exclamation-circle-fill',
//         color: '#dc3545',
//         iconColor: '#dc3545'
//       };
//     } else if (desc.includes('warning') || desc.includes('logout')) {
//       return {
//         icon: 'bi-exclamation-triangle-fill',
//         color: '#997404',
//         iconColor: '#ffc107'
//       };
//     } else if (desc.includes('success') || desc.includes('authorized') || desc.includes('confirmed') || desc.includes('submitted')) {
//       return {
//         icon: 'bi-check-circle-fill',
//         color: '',
//         iconColor: '#198754'
//       };
//     } else {
//       return {
//         icon: 'bi-info-circle-fill',
//         color: '#666',
//         iconColor: '#0d6efd'
//       };
//     }
//   };

//   const showNoLogs = () => {
//     activityLog.innerHTML = `
//       <div class="activity-item" style="padding: 12px 16px;">
//         <div class="activity-content" style="display: flex; align-items: center; gap: 12px;">
//           <div class="activity-icon" style="color: #666; min-width: 20px;">
//             <i class="bi bi-info-circle-fill"></i>
//           </div>
//           <div class="activity-details">
//             <div class="activity-message" style="color: #666; font-size: 0.9rem;">No activity logs found.</div>
//           </div>
//         </div>
//       </div>
//     `;
//   };

//   const showError = (message) => {
//     activityLog.innerHTML = `
//       <div class="activity-item" style="padding: 12px 16px;">
//         <div class="activity-content" style="display: flex; align-items: center; gap: 12px;">
//           <div class="activity-icon" style="color: #dc3545; min-width: 20px;">
//             <i class="bi bi-exclamation-circle-fill"></i>
//           </div>
//           <div class="activity-details">
//             <div class="activity-message" style="color: #dc3545; font-size: 0.9rem;">Error loading logs: ${message}</div>
//           </div>
//         </div>
//       </div>
//     `;
//   };

//   try {
//     const response = await fetch('/api/logs');
//     if (!response.ok) {
//       throw new Error(`HTTP error! status: ${response.status}`);
//     }
    
//     const data = await response.json();
//     if (!data.success) {
//       throw new Error(data.error || 'Failed to fetch logs');
//     }

//     const logs = data.logs || [];
//     activityLog.innerHTML = ''; // Clear existing content

//     if (logs.length === 0) {
//       showNoLogs();
//       return;
//     }

//     logs.sort((a, b) => new Date(b.CreateTS) - new Date(a.CreateTS));
//     const limitedLogs = logs.slice(0, 15);

//     limitedLogs.forEach(log => {
//       const date = new Date(Date.parse(log.CreateTS));
//       const timeString = date.toLocaleTimeString([], { 
//         hour: '2-digit', 
//         minute: '2-digit', 
//         second: '2-digit', 
//         hour12: true 
//       });
//       const logStyle = getLogStyle(log.Description);

//       const activityItem = document.createElement('div');
//       activityItem.className = 'activity-item';
//       activityItem.style.padding = '12px 16px';
//       activityItem.style.borderBottom = '1px solid #eee';

//       activityItem.innerHTML = `
//         <div class="activity-content" style="display: flex; align-items: start; gap: 12px;">
//           <div class="activity-icon" style="color: ${logStyle.iconColor}; padding-top: 2px; min-width: 20px;">
//             <i class="bi ${logStyle.icon}" style="font-size: 1rem;"></i>
//           </div>
//           <div class="activity-details" style="flex: 1;">
//             <div class="activity-time" style="color: #888; font-size: 0.8rem; margin-bottom: 4px;">${timeString}</div>
//             <div class="activity-message" style="color: ${logStyle.color}; font-size: 0.9rem; margin-bottom: 4px;">${log.Description}</div>
//             <div class="logged-user" style="font-size: 0.8rem; color: #888;">
//               Logged User: <span class="activity-user" style="color: ${logStyle.color};">${log.LoggedUser || 'System'}</span>
//             </div>
//           </div>
//         </div>
//       `;

//       activityLog.appendChild(activityItem);
//     });
//   } catch (error) {
//     console.error('Error fetching logs:', error);
//     showError(error.message);
//   }
// });