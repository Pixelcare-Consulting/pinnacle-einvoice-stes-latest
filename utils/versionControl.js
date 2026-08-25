// utils/versionControl.js

/**
 * VersionControl - A utility for managing version information in JavaScript applications
 */
class VersionControl {
  /**
   * Create a new version controller
   * @param {Object} options - Configuration options
   * @param {string} options.major - Major version number (breaking changes)
   * @param {string} options.minor - Minor version number (new features, non-breaking)
   * @param {string} options.patch - Patch version number (bug fixes)
   * @param {string} options.build - Build identifier (optional)
   * @param {Date} options.buildDate - Build date (defaults to current date)
   */
  constructor(options = {}) {
    this.major = options.major || '1';
    this.minor = options.minor || '0';
    this.patch = options.patch || '0';
    this.build = options.build || '';
    this.buildDate = options.buildDate || new Date();
  }

  /**
   * Get semantic version string (e.g., "1.0.0")
   * @returns {string} Semantic version
   */
  getSemanticVersion() {
    return `${this.major}.${this.minor}.${this.patch}`;
  }

  /**
   * Get full version string with build info (e.g., "1.0.0 2025.0207.0513.004")
   * @returns {string} Full version with build info
   */
  getFullVersion() {
    const date = this.buildDate;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    let version = this.getSemanticVersion();
    
    // Add timestamp
    version += ` ${year}.${month}${day}.${hours}${minutes}`;
    
    // Add build number if available
    if (this.build) {
      version += `.${this.build}`;
    }
    
    return version;
  }

  /**
   * Increment major version (resets minor and patch to 0)
   * @returns {VersionControl} this (for chaining)
   */
  incrementMajor() {
    this.major = String(parseInt(this.major) + 1);
    this.minor = '0';
    this.patch = '0';
    this.buildDate = new Date();
    return this;
  }

  /**
   * Increment minor version (resets patch to 0)
   * @returns {VersionControl} this (for chaining)
   */
  incrementMinor() {
    this.minor = String(parseInt(this.minor) + 1);
    this.patch = '0';
    this.buildDate = new Date();
    return this;
  }

  /**
   * Increment patch version
   * @returns {VersionControl} this (for chaining)
   */
  incrementPatch() {
    this.patch = String(parseInt(this.patch) + 1);
    this.buildDate = new Date();
    return this;
  }

  /**
   * Set build identifier
   * @param {string} build - Build identifier
   * @returns {VersionControl} this (for chaining)
   */
  setBuild(build) {
    this.build = build;
    return this;
  }

  /**
   * Create HTML element with version information
   * @param {Object} options - Display options
   * @param {string} options.elementType - HTML element type (default: 'p')
   * @param {string} options.className - CSS class name (default: 'version-info')
   * @param {boolean} options.useFullVersion - Whether to use full version with timestamp (default: true)
   * @returns {HTMLElement} HTML element with version info
   */
  createVersionElement(options = {}) {
    const elementType = options.elementType || 'p';
    const className = options.className || 'version-info';
    const useFullVersion = options.useFullVersion !== false;
    
    const element = document.createElement(elementType);
    element.className = className;
    element.textContent = useFullVersion ? this.getFullVersion() : this.getSemanticVersion();
    
    return element;
  }

  /**
   * Parse a version string into a VersionControl object
   * @param {string} versionString - Version string to parse (e.g., "1.0.0" or "1.0.0 2025.0207.0513.004")
   * @returns {VersionControl} New VersionControl instance
   */
  static fromString(versionString) {
    const parts = versionString.trim().split(' ');
    const semanticVersion = parts[0].split('.');
    
    const options = {
      major: semanticVersion[0] || '1',
      minor: semanticVersion[1] || '0',
      patch: semanticVersion[2] || '0',
    };
    
    // Parse date and build if available
    if (parts[1]) {
      const dateAndBuild = parts[1].split('.');
      if (dateAndBuild.length >= 2) {
        const yearStr = dateAndBuild[0];
        const monthDayStr = dateAndBuild[1];
        
        const year = parseInt(yearStr);
        const month = parseInt(monthDayStr.substring(0, 2)) - 1; // JS months are 0-based
        const day = parseInt(monthDayStr.substring(2, 4));
        
        let hours = 0, minutes = 0;
        if (dateAndBuild[2]) {
          const timeStr = dateAndBuild[2];
          hours = parseInt(timeStr.substring(0, 2));
          minutes = parseInt(timeStr.substring(2, 4));
        }
        
        options.buildDate = new Date(year, month, day, hours, minutes);
        
        // If there's a build number
        if (dateAndBuild[3]) {
          options.build = dateAndBuild[3];
        }
      }
    }
    
    return new VersionControl(options);
  }
}

module.exports = VersionControl;