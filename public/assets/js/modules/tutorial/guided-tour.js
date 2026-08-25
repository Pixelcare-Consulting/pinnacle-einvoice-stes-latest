/**
 * Guided Tour Manager
 * A modern, professional guided tour system that positions tooltips near highlighted elements
 */
class GuidedTourManager {
    constructor() {
        this.currentStep = 1;
        this.totalSteps = 6;
        this.tourSteps = [
            {
                title: "Welcome to Outbound Guided Tour",
                content: `
                    <h4>Welcome to the Outbound Page!</h4>
                    <p>This guided tour will show you how to manage and track your outbound document submissions.</p>
                    <p>Click <strong>Next</strong> to continue or <strong>Skip Tour</strong> to exit.</p>
                `,
                target: '.profile-welcome-card',
                position: 'bottom'
            },
            {
                title: "Dashboard Cards",
                content: `
                    <h4>Dashboard Cards</h4>
                    <p>These cards show document counts by status:</p>
                    <ul>
                        <li><strong>Invoices:</strong> Total documents</li>
                        <li><strong>Submitted:</strong> Successfully submitted</li>
                        <li><strong>Rejected:</strong> Rejected by LHDN</li>
                        <li><strong>Cancelled:</strong> Cancelled documents</li>
                        <li><strong>Pending:</strong> Documents waiting to be submitted</li>
                    </ul>
                `,
                target: '.cards-container',
                position: 'bottom'
            },
            {
                title: "Document Table",
                content: `
                    <h4>Document Table</h4>
                    <p>The main table displays all your documents with important information:</p>
                    <ul>
                        <li><strong>Checkbox:</strong> Select for bulk actions</li>
                        <li><strong>Invoice No.:</strong> Document identifier</li>
                        <li><strong>Company/Supplier/Receiver:</strong> Business entities</li>
                        <li><strong>Status:</strong> Current document status</li>
                    </ul>
                    <div class="tour-tip">
                        <i class="bi bi-lightbulb-fill me-2"></i>
                        <strong>Tip:</strong> Pending documents are shown at the top for easy access.
                    </div>
                `,
                target: '.table-container-wrapper',
                position: 'top'
            },
            {
                title: "Document Actions",
                content: `
                    <h4>Document Actions</h4>
                    <p>Each document has action buttons:</p>
                    <ul>
                        <li><strong>Submit:</strong> Send to LHDN</li>
                        <li><strong>Cancel:</strong> Cancel a submitted document</li>
                        <li><strong>Delete:</strong> Remove a pending document</li>
                    </ul>
                    <p>Available actions depend on the document's status.</p>
                `,
                target: 'th.outbound-action-column',
                position: 'left'
            },
            {
                title: "Bulk Submission",
                content: `
                    <h4>Bulk Submission</h4>
                    <p>Submit multiple documents at once:</p>
                    <ol>
                        <li>Select documents using checkboxes</li>
                        <li>Click "Submit Selected" button</li>
                        <li>Review selected documents</li>
                        <li>Choose LHDN version</li>
                        <li>Click "Submit Documents"</li>
                    </ol>
                    <div class="tour-note">
                        <i class="bi bi-exclamation-triangle-fill me-2"></i>
                        <strong>Note:</strong> All documents must meet LHDN requirements.
                    </div>
                `,
                target: '#submitConsolidated',
                position: 'left'
            },
            // {
            //     title: "Search and Filter",
            //     content: `
            //         <h4>Search and Filter</h4>
            //         <p>Use these tools to manage your documents:</p>
            //         <ul>
            //             <li>Search box: Find documents quickly</li>
            //             <li>Entries dropdown: Change items per page</li>
            //             <li>Column headers: Sort your data</li>
            //             <li>Export: Save selected documents as CSV</li>
            //         </ul>
            //         <div class="p-3 bg-success text-white rounded mt-3">
            //             <i class="bi bi-check-circle-fill me-2"></i>
            //             <strong>Congratulations!</strong> You're ready to use the Outbound page effectively.
            //         </div>
            //     `,
            //     target: '.dataTables_filter input, .dataTables_length select',
            //     position: 'center'
            // }
            {
                title: 'Done',
                content: `
                    <h4>Congratulations!</h4>
                    <p>You've completed the guided tour. Explore the Outbound page to manage your documents effectively.</p>
                `,
                target: '.outbound-controls',
                position: 'top'
            }
        ];
        
        this.overlay = null;
        this.tooltip = null;
        this.tooltipTitle = null;
        this.tooltipContent = null;
        this.progressBar = null;
        this.stepIndicators = null;
        this.prevButton = null;
        this.nextButton = null;
        this.skipButton = null;
        this.closeButton = null;
    }
    
    initialize() {
        // Get DOM elements
        this.overlay = document.getElementById('guidedTourOverlay');
        this.tooltip = document.getElementById('guidedTourTooltip');
        this.tooltipTitle = document.getElementById('tooltipTitle');
        this.tooltipContent = document.getElementById('tooltipContent');
        this.progressBar = document.getElementById('tourProgressBar');
        this.stepIndicators = document.getElementById('stepIndicators');
        this.prevButton = document.getElementById('prevStepBtn');
        this.nextButton = document.getElementById('nextStepBtn');
        this.skipButton = document.getElementById('skipTourBtn');
        this.closeButton = document.getElementById('closeTourBtn');
        
        // Create step indicators
        this.createStepIndicators();
        
        // Add event listeners
        this.nextButton.addEventListener('click', () => this.nextStep());
        this.prevButton.addEventListener('click', () => this.prevStep());
        this.skipButton.addEventListener('click', () => this.endTour());
        this.closeButton.addEventListener('click', () => this.endTour());
        
        // Add click event to step dots for direct navigation
        const stepDots = this.stepIndicators.querySelectorAll('.step-dot');
        stepDots.forEach(dot => {
            dot.addEventListener('click', () => {
                const step = parseInt(dot.getAttribute('data-step'));
                this.goToStep(step);
            });
        });
        
        // Handle window resize and scroll
        window.addEventListener('resize', () => {
            if (this.overlay.style.display === 'block') {
                this.positionTooltip();
            }
        });
        
        // Add scroll event listener to reposition tooltip when scrolling
        window.addEventListener('scroll', () => {
            if (this.overlay.style.display === 'block') {
                this.positionTooltip();
            }
        }, { passive: true });
        
        // Add event listener for the tutorial button
        const openTutorialBtn = document.getElementById('openTutorialBtn');
        if (openTutorialBtn) {
            openTutorialBtn.addEventListener('click', () => this.startTour());
        }
        
        // Check if this is the user's first visit (using localStorage)
        const hasSeenTutorial = localStorage.getItem('outbound_tutorial_seen');
        if (!hasSeenTutorial) {
            // Show the tutorial on first visit
            setTimeout(() => {
                this.startTour();
                // Mark as seen
                localStorage.setItem('outbound_tutorial_seen', 'true');
            }, 1000); // Delay to ensure page is fully loaded
        }
        
    }
    
    createStepIndicators() {
        this.stepIndicators.innerHTML = '';
        for (let i = 1; i <= this.totalSteps; i++) {
            const dot = document.createElement('span');
            dot.className = i === 1 ? 'step-dot active' : 'step-dot';
            dot.setAttribute('data-step', i);
            this.stepIndicators.appendChild(dot);
        }
    }
    
    startTour() {
        this.currentStep = 1;
        this.showOverlay();
        document.body.classList.add('tour-active');
        
        // Initialize step indicators
        document.getElementById('currentStepIndicator').textContent = '1';
        document.getElementById('totalStepsIndicator').textContent = this.totalSteps.toString();
        
        this.goToStep(1);
    }
    
    endTour() {
        this.hideOverlay();
        this.hideTooltip();
        this.removeAllHighlights();
        document.body.classList.remove('tour-active');
    }
    
    showOverlay() {
        // Store current scroll position before locking
        this.scrollPosition = window.pageYOffset;
        this.overlay.style.display = 'block';
        // Apply negative top margin to maintain visual position
        document.body.style.marginTop = `-${this.scrollPosition}px`;
    }
    
    hideOverlay() {
        this.overlay.style.display = 'none';
        // Restore scroll position
        document.body.style.marginTop = '0';
        if (this.scrollPosition !== undefined) {
            window.scrollTo(0, this.scrollPosition);
        }
    }
    
    showTooltip() {
        this.tooltip.style.display = 'block';
    }
    
    hideTooltip() {
        this.tooltip.style.display = 'none';
    }
    
    nextStep() {
        if (this.currentStep < this.totalSteps) {
            this.goToStep(this.currentStep + 1);
        } else {
            this.endTour();
        }
    }
    
    prevStep() {
        if (this.currentStep > 1) {
            this.goToStep(this.currentStep - 1);
        }
    }
    
    goToStep(step) {
        // Update current step
        this.currentStep = step;
        
        // Get step data
        const stepData = this.tourSteps[step - 1];
        
        // Update tooltip content
        this.tooltipTitle.textContent = stepData.title;
        this.tooltipContent.innerHTML = stepData.content;

        // Update step indicators in the header
        document.getElementById('currentStepIndicator').textContent = step;
        document.getElementById('totalStepsIndicator').textContent = this.totalSteps;
        
        // Update progress bar
        const progress = ((step - 1) / (this.totalSteps - 1)) * 100;
        this.progressBar.style.width = `${progress}%`;
        this.progressBar.setAttribute('aria-value-now', progress);
        
        // Update step dots
        const stepDots = this.stepIndicators.querySelectorAll('.step-dot');
        stepDots.forEach(dot => {
            const dotStep = parseInt(dot.getAttribute('data-step'));
            dot.className = dotStep === step ? 'step-dot active' : 'step-dot';
        });
        
        // Update button states
        this.prevButton.disabled = step === 1;
        if (step === this.totalSteps) {
            this.nextButton.innerHTML = 'Finish <i class="bi bi-check-circle ms-1"></i>';
        } else {
            this.nextButton.innerHTML = 'Next <i class="bi bi-arrow-right ms-1"></i>';
        }
        
        // Remove all highlights first
        this.removeAllHighlights();
        
        // Add highlight to target element
        this.highlightElement(stepData.target);
        
        // Position tooltip relative to highlighted element
        this.positionTooltip(stepData.position);
    }
    
    highlightElement(selector) {
        // Remove any existing highlights first
        this.removeAllHighlights();
        
        const elements = document.querySelectorAll(selector);
        if (!elements || elements.length === 0) {
            console.warn(`No elements found for selector: ${selector}`);
            return null;
        }
        
        let targetElement = null;
        
        // Add highlight class to all matching elements
        elements.forEach(el => {
            // Remove any existing arrows
            const existingArrows = document.querySelectorAll('.tour-arrow');
            existingArrows.forEach(arrow => arrow.remove());
            
            // Add highlight class
            el.classList.add('tour-highlight');
            
            // Get element position
            const rect = el.getBoundingClientRect();
            const scrollY = window.scrollY;
            
            // Determine arrow position based on element type
            let arrowDirection = 'right';
            let arrowPosition = {};
            
            if (el.matches('th.outbound-action-column')) {
                arrowDirection = 'left';
                arrowPosition = {
                    top: rect.top + scrollY + (rect.height / 2) - 12,
                    left: rect.left - 34
                };
            } else if (el.matches('#submitConsolidated')) {
                arrowDirection = 'left';
                arrowPosition = {
                    top: rect.top + scrollY + (rect.height / 2) - 12,
                    left: rect.left - 34
                };
            }
            
            // Create and position arrow
            const arrow = this.createArrow(arrowDirection);
            Object.assign(arrow.style, {
                top: `${arrowPosition.top}px`,
                left: `${arrowPosition.left}px`,
                position: 'absolute'
            });
            
            // Ensure element is visible
            this.scrollElementIntoView(el);
            
            // Store the first element as the target for positioning
            if (!targetElement) {
                targetElement = el;
            }
        });
        
        return targetElement;
    }
    
    scrollElementIntoView(element) {
        const rect = element.getBoundingClientRect();
        const scrollY = window.scrollY;
        const viewportHeight = window.innerHeight;
        
        if (rect.top < 0 || rect.bottom > viewportHeight) {
            const scrollToY = scrollY + rect.top - (viewportHeight / 2) + (rect.height / 2);
            window.scrollTo({
                top: scrollToY,
                behavior: 'smooth'
            });
        }
    }
    
    positionTooltip(position = 'bottom') {
        const stepData = this.tourSteps[this.currentStep - 1];
        const targetElement = document.querySelector(stepData.target);
        
        if (!targetElement) {
            console.warn('Target element not found for positioning tooltip');
            return;
        }
        
        // Get element position relative to viewport
        const rect = targetElement.getBoundingClientRect();
        const tooltipWidth = 360;
        const tooltipHeight = this.tooltip.offsetHeight;
        const margin = 20;
        
        // Get viewport dimensions
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Calculate scroll position
        const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
        const scrollY = window.pageYOffset || document.documentElement.scrollTop;
        
        // Calculate available space in each direction
        const spaceAbove = rect.top;
        const spaceBelow = viewportHeight - rect.bottom;
        const spaceLeft = rect.left;
        const spaceRight = viewportWidth - rect.right;
        
        // Determine best position based on available space
        let bestPosition = position;
        if (position === 'auto') {
            const spaces = {
                top: spaceAbove,
                bottom: spaceBelow,
                left: spaceLeft,
                right: spaceRight
            };
            bestPosition = Object.entries(spaces).reduce((a, b) => spaces[a] > spaces[b] ? a : b)[0];
        }
        
        // Calculate position
        let top, left;
        
        switch (bestPosition) {
            case 'top':
                top = rect.top + scrollY - tooltipHeight - margin;
                left = rect.left + scrollX + (rect.width / 2) - (tooltipWidth / 2);
                this.tooltip.classList.add('arrow-bottom');
                break;
            case 'bottom':
                top = rect.bottom + scrollY + margin;
                left = rect.left + scrollX + (rect.width / 2) - (tooltipWidth / 2);
                this.tooltip.classList.add('arrow-top');
                break;
            case 'left':
                top = rect.top + scrollY + (rect.height / 2) - (tooltipHeight / 2);
                left = rect.left + scrollX - tooltipWidth - margin;
                this.tooltip.classList.add('arrow-right');
                break;
            case 'right':
                top = rect.top + scrollY + (rect.height / 2) - (tooltipHeight / 2);
                left = rect.right + scrollX + margin;
                this.tooltip.classList.add('arrow-left');
                break;
        }
        
        // Ensure tooltip stays within viewport bounds
        if (left < margin) {
            const offset = margin - left;
            left = margin;
            this.tooltip.style.setProperty('--arrow-position', `calc(50% - ${offset}px)`);
        } else if (left + tooltipWidth > viewportWidth - margin) {
            const offset = (left + tooltipWidth) - (viewportWidth - margin);
            left = viewportWidth - tooltipWidth - margin;
            this.tooltip.style.setProperty('--arrow-position', `calc(50% + ${offset}px)`);
        } else {
            this.tooltip.style.setProperty('--arrow-position', '50%');
        }
        
        // Ensure tooltip stays within vertical bounds
        const minTop = scrollY + margin;
        const maxTop = scrollY + viewportHeight - tooltipHeight - margin;
        top = Math.max(minTop, Math.min(maxTop, top));
        
        // Apply final position
        this.tooltip.style.top = `${top}px`;
        this.tooltip.style.left = `${left}px`;
        
        // Show tooltip
        this.showTooltip();
        
        // Ensure target element is visible
        this.scrollElementIntoView(targetElement);
    }
    
    removeAllHighlights() {
        // Remove highlight classes
        document.querySelectorAll('.tour-highlight').forEach(el => {
            el.classList.remove('tour-highlight');
            el.style.position = '';
            el.style.zIndex = '';
        });
        
        document.querySelectorAll('.tour-highlight-row').forEach(el => {
            el.classList.remove('tour-highlight-row');
        });
        
        // Remove all arrows
        document.querySelectorAll('.tour-arrow').forEach(arrow => {
            arrow.remove();
        });
    }
    
    addHelpButton() {
        const tableControls = document.querySelector('.outbound-controls');
        if (tableControls) {
            // Create a help dropdown
            const helpDropdown = document.createElement('div');
            helpDropdown.className = 'dropdown d-inline-block ms-2';
            helpDropdown.innerHTML = `
                <button class="btn btn-sm btn-outline-primary dropdown-toggle" type="button" id="helpDropdownButton" data-bs-toggle="dropdown" aria-expanded="false">
                    <i class="bi bi-question-circle me-1"></i> Help
                </button>
                <ul class="dropdown-menu" aria-labelledby="helpDropdownButton">
                    <li><a class="dropdown-item" href="#" id="takeTutorialBtn"><i class="bi bi-info-circle me-2"></i>Take the Tour</a></li>
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item" href="#" id="showTipsBtn"><i class="bi bi-lightbulb me-2"></i>Show Tips</a></li>
                </ul>
            `;
            
            tableControls.appendChild(helpDropdown);
            
            // Add event listener for the tutorial button
            document.getElementById('takeTutorialBtn').addEventListener('click', () => {
                this.startTour();
            });
            
            // Add event listener for the tips button
            document.getElementById('showTipsBtn').addEventListener('click', () => {
                // Toggle the info banner visibility
                const infoBanner = document.querySelector('.alert-info');
                if (infoBanner) {
                    infoBanner.classList.toggle('d-none');
                }
            });
        }
    }
    
    // Add new method to create and position arrows
    createArrow(direction) {
        const arrow = document.createElement('div');
        arrow.className = `tour-arrow ${direction}`;
        document.body.appendChild(arrow);
        return arrow;
    }
}

// Initialize the guided tour when the document is ready
document.addEventListener('DOMContentLoaded', function() {
    const tourManager = new GuidedTourManager();
    tourManager.initialize();
    
    // Make the tour manager globally accessible
    window.tourManager = tourManager;
}); 