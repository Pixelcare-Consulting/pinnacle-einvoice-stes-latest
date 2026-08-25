/**
 * Settings Page JavaScript
 * Handles settings page functionality and interactions
 */

import SettingsUtil from '../utils/settings.util.js';
import CompanySettingsUtil from '../utils/company.settings.js';
import APISettingsUtil from '../utils/api.settings.js';
import LoggingSettingsUtil from '../utils/logging.settings.js';
import ValidationSettingsUtil from '../utils/validation.settings.js';
import InvoiceSettingsUtil from '../utils/invoice.settings.js';

// Initialize settings modules when the page loads
document.addEventListener('DOMContentLoaded', async () => {
    try {
        SettingsUtil.showLoading();

        // Initialize all settings modules
        await Promise.all([
            CompanySettingsUtil.initialize(),
            APISettingsUtil.initialize(),
            LoggingSettingsUtil.initialize(),
            ValidationSettingsUtil.initialize(),
            InvoiceSettingsUtil.initialize()
        ]);

        // Initialize tooltips
        SettingsUtil.initializeTooltips();

        // Setup navigation
        setupNavigation();

        // Setup form submission
        setupFormSubmission();

        SettingsUtil.hideLoading();
    } catch (error) {
        console.error('Failed to initialize settings:', error);
        SettingsUtil.showError('Failed to load settings. Please try again.');
        SettingsUtil.hideLoading();
    }
});

/**
 * Setup settings navigation
 */
function setupNavigation() {
    const navItems = document.querySelectorAll('.settings-nav-item:not(.disabled)');
    const sections = document.querySelectorAll('.settings-form');
    let currentSection = null;

    // Handle navigation click
    function handleNavClick(navItem, e) {
        if (e) {
            e.preventDefault();
        }

        // Store current scroll position
        const scrollPos = window.scrollY;

        // Update active nav item
        navItems.forEach(nav => nav.classList.remove('active'));
        navItem.classList.add('active');

        // Show selected section
        const targetSection = navItem.getAttribute('data-section');
        sections.forEach(section => {
            if (section.id === targetSection) {
                section.style.display = 'block';
                section.classList.add('active');
                currentSection = section;
            } else {
                section.style.display = 'none';
                section.classList.remove('active');
            }
        });

        // Update URL hash without scrolling
        history.replaceState(null, null, '#' + targetSection);

        // Restore scroll position
        window.scrollTo(0, scrollPos);
    }

    // Add click handlers
    navItems.forEach(item => {
        item.addEventListener('click', (e) => handleNavClick(item, e));
    });

    // Handle initial navigation
    if (window.location.hash) {
        // If URL has hash, try to navigate to that section
        const targetNav = Array.from(navItems).find(
            item => item.getAttribute('data-section') === window.location.hash.substring(1)
        );
        if (targetNav) {
            handleNavClick(targetNav);
            return;
        }
    }

    // Show first section by default
    if (navItems[0]) {
        handleNavClick(navItems[0]);
    }
}

/**
 * Setup form submission handling
 */
function setupFormSubmission() {
    const form = document.getElementById('settingsForm');
    if (!form) {
        console.warn('Settings form not found');
        return;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        SettingsUtil.showLoading();

        try {
            // Get settings from each module
            const settings = {
                company: CompanySettingsUtil.getFormSettings(),
                api: APISettingsUtil.getFormSettings(),
                logging: LoggingSettingsUtil.getFormSettings(),
                validation: ValidationSettingsUtil.getFormSettings(),
                invoice: InvoiceSettingsUtil.getFormSettings()
            };

            // Save settings for each module
            await Promise.all([
                CompanySettingsUtil.saveSettings(settings.company),
                APISettingsUtil.saveSettings(settings.api),
                LoggingSettingsUtil.saveSettings(settings.logging),
                ValidationSettingsUtil.saveSettings(settings.validation),
                InvoiceSettingsUtil.saveSettings(settings.invoice)
            ]);

            SettingsUtil.showSuccess('Settings saved successfully');
        } catch (error) {
            console.error('Failed to save settings:', error);
            SettingsUtil.showError(error.message || 'Failed to save settings. Please try again.');
        } finally {
            SettingsUtil.hideLoading();
        }
    });

    // Setup reset button
    const resetButton = document.getElementById('resetButton');
    if (resetButton) {
        resetButton.addEventListener('click', async (e) => {
            e.preventDefault();
            
            const result = await Swal.fire({
                title: 'Reset Settings?',
                text: 'This will reset all settings to their default values. This action cannot be undone.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Yes, reset settings',
                cancelButtonText: 'Cancel',
                reverseButtons: true
            });

            if (result.isConfirmed) {
                SettingsUtil.showLoading();

                try {
                    // Reset each module to defaults
                    await Promise.all([
                        CompanySettingsUtil.initialize(),
                        APISettingsUtil.initialize(),
                        LoggingSettingsUtil.initialize(),
                        ValidationSettingsUtil.initialize(),
                        InvoiceSettingsUtil.initialize()
                    ]);

                    SettingsUtil.showSuccess('Settings reset to defaults');
                } catch (error) {
                    console.error('Failed to reset settings:', error);
                    SettingsUtil.showError('Failed to reset settings. Please try again.');
                } finally {
                    SettingsUtil.hideLoading();
                }
            }
        });
    }
}

// Export settings modules for use in other files
export {
    CompanySettingsUtil,
    APISettingsUtil,
    LoggingSettingsUtil,
    ValidationSettingsUtil,
    InvoiceSettingsUtil
}; 