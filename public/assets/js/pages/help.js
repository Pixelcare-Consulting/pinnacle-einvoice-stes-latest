class HelpManager {
  constructor() {
    this.currentSection = null;
    this.init();
  }

  init() {
    this.attachEventListeners();
    this.handleInitialSection();
  }

  attachEventListeners() {
    const navItems = document.querySelectorAll('.settings-nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', (e) => this.handleNavClick(e, item));
    });
  }

  handleNavClick(e, item) {
    e.preventDefault();
    const sectionId = item.getAttribute('data-section');
    
    // Store current scroll position
    const scrollPosition = window.scrollY;
    
    // Update active states
    this.updateActiveStates(item, sectionId);
    
    // Update URL without scrolling
    this.updateUrlHash(sectionId);
    
    // Restore scroll position
    window.scrollTo(0, scrollPosition);
  }

  updateActiveStates(clickedItem, sectionId) {
    // Remove active class from all items
    document.querySelectorAll('.settings-nav-item').forEach(item => {
      item.classList.remove('active');
    });
    document.querySelectorAll('.settings-form').forEach(section => {
      section.classList.remove('active');
    });

    // Add active class to clicked item and its section
    clickedItem.classList.add('active');
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
      targetSection.classList.add('active');
      this.currentSection = sectionId;
    }
  }

  updateUrlHash(sectionId) {
    // Update URL without causing scroll
    history.replaceState(null, null, `#${sectionId}`);
  }

  handleInitialSection() {
    // Check for hash in URL
    const hash = window.location.hash.replace('#', '');
    const defaultSection = 'getting-started';
    
    const targetId = hash || defaultSection;
    const targetNav = document.querySelector(`[data-section="${targetId}"]`);
    
    if (targetNav) {
      targetNav.classList.add('active');
      const targetSection = document.getElementById(targetId);
      if (targetSection) {
        targetSection.classList.add('active');
        this.currentSection = targetId;
      }
    } else {
      // Fallback to default section if hash is invalid
      const defaultNav = document.querySelector(`[data-section="${defaultSection}"]`);
      const defaultSectionElement = document.getElementById(defaultSection);
      if (defaultNav && defaultSectionElement) {
        defaultNav.classList.add('active');
        defaultSectionElement.classList.add('active');
        this.currentSection = defaultSection;
      }
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.helpManager = new HelpManager();
}); 