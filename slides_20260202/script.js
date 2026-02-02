/**
 * PDF Viewer Script - Refactored
 * Handles page navigation, search, modals, and viewer modes
 */

document.addEventListener("DOMContentLoaded", () => {
  // ============================================================================
  // CONSTANTS
  // ============================================================================

  const PORTRAIT_CLASS = "portrait-slide";
  const TRUE_PORTRAIT_CLASS = "portrait-actual";
  const FOUR_THIRDS_CLASS = "ratio-four-thirds";
  const FOUR_THIRDS_RATIO = 4 / 3;
  const RATIO_TOLERANCE = 0.08;

  const WHEEL_CONFIG = {
    BASE_MIN_DELTA: 0,
    BASE_COOLDOWN: 0,
    EXPANDED_MIN_DELTA: 600,
    EXPANDED_COOLDOWN: 5000,
  };

  const CHEVRON_CONFIG = {
    ICON_SIZE: 80 * 1.206,
    POSITION_OFFSET: 24,
  };

  // Timing constants for DOM settling and transitions
  const NAVIGATION_SETTLE_DELAY = 100; // Delay for navigation state settling and DOM operations
  const CHEVRON_ATTACH_DELAY = 200; // Delay for chevron attachment after mode changes
  const URL_UPDATE_DEBOUNCE_MS = 100; // Delay for URL update debounce

  const PAGES_PER_FILE = 10;
  const SEARCH_SNIPPET_LENGTH = 140;
  const SNIPPET_CONTEXT = { before: 40, after: 100 };

  // ============================================================================
  // DOM ELEMENT REFERENCES
  // ============================================================================

  const elements = {
    viewer: document.getElementById("viewer"),
    snapViewer: document.querySelector(".snap-viewer"),
    layout: document.querySelector(".layout"),
    bodyEl: document.body,

    // Sidebar
    sidebar: document.getElementById("sidebar"),
    toggleSidebar: document.getElementById("toggleSidebar"),
    collapsedBtn: document.getElementById("sidebarCollapsedBtn"),

    // Footer
    footer: document.querySelector(".footer"),
    displayQuickLink: document.querySelector(
      '.footer-toc-btn[data-footer-action="display"]',
    ),
    downloadBtn: document.querySelector(".footer-toc-btn.download"),
    helpBtn: document.querySelector(".footer-toc-btn.help"),

    // Modals
    searchModal: document.getElementById("searchResultsModal"),
    helpModal: document.getElementById("helpModal"),
    mobileSearchModal: document.getElementById("mobileSearchModal"),
    mobileShareModal: document.getElementById("mobileShareModal"),

    // Page controls
    pageInput: document.querySelector(".page-input"),
    pageSelect: document.querySelector(".page-select"),
    pageDropdown: document.querySelector(".page-dropdown"),
    pageMenu: document.querySelector(".page-menu"),
    currentPageSpan: document.querySelector(".current-page"),
    zoomWrapper: document.getElementById("zoomWrapper"),
    zoomRoot: document.getElementById("zoomRoot"),
    zoomContent: document.getElementById("zoomContent"),

    // Mobile
    mobileMenu: document.getElementById("mobileMenu"),
    mobileOverlay: document.getElementById("mobileMenuOverlay"),
    mobileToggle: document.querySelector(".mobile-menu-toggle"),
  };

  // Set default snapViewer if not found
  if (!elements.snapViewer) elements.snapViewer = elements.viewer;

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  /**
   * Check if user agent is mobile
   * @returns {boolean} True if mobile
   */
  const isMobileUserAgent = () => {
    if (
      navigator.userAgentData &&
      typeof navigator.userAgentData.mobile === "boolean"
    ) {
      return navigator.userAgentData.mobile;
    }
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Windows Phone|Opera Mini|Mobile|Mobi/i.test(
      navigator.userAgent,
    );
  };

  const state = {
    currentPage: 1,
    lastHighlightedPage: null,
    isNavigating: false,
    wheelLocked: false,
    isAtBottom: false,
    scrollTimeout: null,
    urlUpdateTimeout: null,
    pages: document.querySelectorAll(".page"),
    thumbnails: document.querySelectorAll(".thumbnail"),
    loadedFiles: new Set(),
    fileContentCache: new Map(),
    viewportWindow: {
      minFile: 1,
      maxFile: 1,
      bufferSize: isMobileUserAgent() ? 6 : 2,
    },
    isLoadingContent: false,
    lastScrollTop: 0,
  };

  // Shared callback references
  let initOCRHandlers = null;
  let updateMobileDisplayToggle = () => {};
  let adjustPageMargins = () => {};
  let closeAllOcrBoxes = () => {};

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  // Set scroll debounce delay based on device type
  // Mobile needs faster response to handle high-velocity touch scrolling
  const SCROLL_DEBOUNCE_MS = isMobileUserAgent() ? 80 : 150;

  /**
   * Clamp a page number to valid range
   * @param {number} pageNum - Page number to clamp
   * @returns {number} Clamped page number
   */
  const clampPageNumber = (pageNum) => {
    const total = state.pages.length || 1;
    const value = typeof pageNum === "number" ? pageNum : parseInt(pageNum, 10);
    if (Number.isNaN(value)) return 1;
    return Math.max(1, Math.min(value, total));
  };

  /**
   * Get total pages from thumbnails or page elements
   * @returns {number} Total number of pages
   */
  const getTotalPages = () => {
    const thumbnails = document.querySelectorAll(".thumbnail");
    if (thumbnails.length > 0) {
      const lastThumb = Array.from(thumbnails).pop();
      return parseInt(lastThumb?.dataset.page || "1", 10);
    }

    const allPages = document.querySelectorAll(".page");
    if (allPages.length > 0) {
      const lastPage = Array.from(allPages).pop();
      return parseInt(lastPage?.dataset.page || "1", 10);
    }

    return 1;
  };

  /**
   * Get current file information based on URL and current page state
   * @returns {Object} File info with fileNum, startPage, endPage
   */
  const getCurrentFileInfo = () => {
    // Extract file number from URL (primary source of truth)
    const currentFile = window.location.pathname.split("/").pop() || "index.html";

    // Handle index.html explicitly, otherwise parse number from filename
    const fileNumFromUrl = currentFile === "index.html" 
      ? 1 
      : (currentFile.match(/(\d+)\.html/) ? parseInt(currentFile.match(/(\d+)\.html/)[1], 10) : 1);

    let fileNum = fileNumFromUrl;

    // In continuous mode, use page-based detection for dynamic scroll updates
    const isContinuous = elements.viewer?.classList.contains("continuous");
    if (isContinuous) {
      const pageFromUrl = getCurrentPageFromUrl();

      // Only use state.currentPage if it has been initialized from URL
      // (not the default value of 1, unless URL param is actually 1)
      const isStateInitialized = state.currentPage !== 1 || pageFromUrl === 1;

      if (isStateInitialized) {
        const fileNumFromPage = getFileNumFromPage(state.currentPage);

        // Validate page-based file number is within reasonable range
        // (within ±3 files of URL-based file number to prevent invalid jumps)
        const isWithinBufferRange =
          Math.abs(fileNumFromPage - fileNumFromUrl) <= 3;

        if (isWithinBufferRange) {
          fileNum = fileNumFromPage;
        }
      }
    }

    // Calculate page range for this file
    const totalPages = getTotalPages();
    const startPage = (fileNum - 1) * PAGES_PER_FILE + 1;
    const endPage = Math.min(fileNum * PAGES_PER_FILE, totalPages);

    return { fileNum, startPage, endPage };
  };

  /**
   * Get file number from page number
   * @param {number} pageNum - Page number
   * @returns {number} File number
   */
  const getFileNumFromPage = (pageNum) => Math.ceil(pageNum / PAGES_PER_FILE);

  /**
   * Get current page number from URL parameters
   * @returns {number} Page number from URL
   */
  const getCurrentPageFromUrl = () => {
    const params = new URLSearchParams(location.search);
    return parseInt(params.get("page") || "1", 10);
  };

  /**
   * Normalize text by removing extra whitespace
   * @param {string} text - Text to normalize
   * @returns {string} Normalized text
   */
  const normalizeText = (text = "") => text.replace(/\s+/g, " ").trim();

  /**
   * Escape regex special characters
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  const escapeRegExp = (str = "") => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /**
   * Escape HTML special characters
   * @param {string} str - String to escape
   * @returns {string} Escaped HTML
   */
  const escapeHtml = (str = "") =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  /**
   * Check if element is an interactive form element
   * @param {HTMLElement} el - Element to check
   * @returns {boolean} True if interactive
   */
  const isInteractiveElement = (el) => {
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === "INPUT" ||
      tag === "SELECT" ||
      tag === "TEXTAREA" ||
      el.isContentEditable
    );
  };

  /**
   * Refresh DOM references after content change
   */
  const refreshDomRefs = () => {
    state.pages = document.querySelectorAll(".page");
    state.thumbnails = document.querySelectorAll(".thumbnail");
  };

  // ============================================================================
  // PAGE & SCROLL POSITIONING
  // ============================================================================

  /**
   * Calculate scroll position to center a page
   * @param {HTMLElement} pageEl - Page element
   * @returns {number} Scroll top position
   */
  const getScrollTopForPage = (pageEl) => {
    if (!elements.viewer || !pageEl) return 0;

    const viewerHeight =
      elements.viewer.clientHeight ||
      elements.viewer.getBoundingClientRect().height ||
      0;
    const viewerStyles = window.getComputedStyle(elements.viewer);
    const paddingTop = parseFloat(viewerStyles.paddingTop) || 0;
    const extraMargin = 30;
    const pageHeight = pageEl.offsetHeight;

    if (pageHeight > viewerHeight) {
      return Math.max(0, pageEl.offsetTop - paddingTop - extraMargin);
    }

    const pageCenter = pageEl.offsetTop + pageHeight / 2;
    return Math.max(0, pageCenter - viewerHeight / 2);
  };

  /**
   * Adjust page margins for centering
   */
  adjustPageMargins = () => {
    const pages = elements.viewer?.querySelectorAll(".page");
    if (!pages) return;

    // Skip adjustment if OCR is expanded
    if (document.querySelector(".ocr-container.open")) return;

    if (!elements.viewer.classList.contains("continuous")) {
      pages.forEach((page) => {
        page.style.marginTop = "";
        page.style.marginBottom = "";
      });
      return;
    }

    // Fixed margins for continuous mode
    pages.forEach((page, index) => {
      page.style.marginTop = "10px";
      page.style.marginBottom = index === pages.length - 1 ? "100px" : "10px";
    });
  };

  /**
   * Center viewport on a specific page
   * @param {number} pageNum - Page number to center
   */
  const centerOnPage = (pageNum) => {
    const fileInfo = getCurrentFileInfo();

    // Check if page is in current file range
    if (pageNum < fileInfo.startPage || pageNum > fileInfo.endPage) {
      goToPage(pageNum);
      return;
    }

    const target = clampPageNumber(pageNum);

    if (!elements.viewer.classList.contains("continuous")) {
      setActivePage(pageNum);
      syncPageControls(pageNum);
      updateThumbnailHighlight(pageNum, { smoothScroll: false });
      state.currentPage = target;
      updateShareCurrentPage(pageNum);
      updateSingleModeNavAvailability();
      return;
    }

    const el = elements.viewer.querySelector(`.page[data-page="${pageNum}"]`);
    if (!el) return;

    const top = getScrollTopForPage(el);
    elements.viewer.scrollTo({ top, behavior: "auto" });
  };

  // ============================================================================
  // PAGE MANAGEMENT
  // ============================================================================

  /**
   * Set active page in single-page mode
   * @param {number} pageNum - Page number to activate
   */
  const setActivePage = (pageNum) => {
    state.pages.forEach((page) => {
      const isActive = pageNum == page.dataset.page;
      const wasActive = page.classList.contains("active");
      page.classList.toggle("active", isActive);
      page.setAttribute("aria-hidden", isActive ? "false" : "true");
      if (isActive && !wasActive) {
        page.scrollTop = 0;
      }
    });
  };

  /**
   * Sync page number across all controls
   * @param {number} value - Page number
   */
  const syncPageControls = (value) => {
    const strValue = String(value);
    if (elements.pageSelect) elements.pageSelect.value = strValue;
    if (elements.pageInput) elements.pageInput.value = strValue;
  };

  /**
   * Update share current page displays
   * @param {number} pageNum - Current page number
   */
  const updateShareCurrentPage = (pageNum) => {
    const shareCurrentPageTextEls = document.querySelectorAll(
      "[data-share-current-page-text]",
    );

    // Update text content with appropriate label
    shareCurrentPageTextEls.forEach((el) => {
      if (pageNum !== undefined && pageNum !== null) {
        el.textContent = `ページ ${pageNum}`;
      }
    });

    // Show/hide the current page section based on context
    const shouldShow = pageNum !== undefined && pageNum !== null;
    toggleShareCurrentPageVisibility(shouldShow);
  };

  /**
   * Toggle share current page section visibility
   * @param {boolean} visible - Whether to show or hide the section
   */
  const toggleShareCurrentPageVisibility = (visible) => {
    const shareCurrentPageSections = document.querySelectorAll(
      ".share-current-page-section",
    );
    const shareCurrentPageSeparators = document.querySelectorAll(
      ".share-current-page-separator",
    );

    shareCurrentPageSections.forEach((section) => {
      section.style.display = visible ? "" : "none";
    });
    shareCurrentPageSeparators.forEach((separator) => {
      separator.style.display = visible ? "" : "none";
    });
  };

  /**
   * Mark portrait and aspect ratio slides
   */
  const markPortraitSlides = () => {
    const slideImages = document.querySelectorAll(".page-grid__slide img");

    slideImages.forEach((img) => {
      const pageEl = img.closest(".page");
      if (!pageEl) return;

      const applyClass = () => {
        if (!img.naturalWidth || !img.naturalHeight) return;

        const width = img.naturalWidth;
        const height = img.naturalHeight;
        const isPortrait = height > width;
        const isFourThirds =
          Math.abs(width / height - FOUR_THIRDS_RATIO) <= RATIO_TOLERANCE;
        const shouldApplyPortraitStyle = isPortrait || isFourThirds;

        pageEl.classList.toggle(PORTRAIT_CLASS, shouldApplyPortraitStyle);
        pageEl.classList.toggle(TRUE_PORTRAIT_CLASS, isPortrait);
        pageEl.classList.toggle(FOUR_THIRDS_CLASS, !isPortrait && isFourThirds);
      };

      if (img.complete && img.naturalWidth && img.naturalHeight) {
        applyClass();
      } else {
        img.addEventListener("load", applyClass, { once: true });
      }
    });
  };

  /**
   * Update thumbnail highlight and center in sidebar
   * @param {number} pageNum - Page number to highlight
   * @param {Object} options - Options including smoothScroll
   */
  const updateThumbnailHighlight = (pageNum, options = {}) => {
    if (!state.thumbnails.length) return;

    const { smoothScroll = state.lastHighlightedPage !== null } = options;
    if (pageNum === state.lastHighlightedPage) return;

    state.thumbnails.forEach((thumb) => {
      const thumbPageNum = parseInt(thumb.dataset.page || "0", 10);
      thumb.classList.toggle("active", thumbPageNum === pageNum);
    });

    state.lastHighlightedPage = pageNum;
    centerThumbnailInSidebar(pageNum, smoothScroll);
  };

  /**
   * Center thumbnail in sidebar view
   * @param {number} pageNum - Page number
   * @param {boolean} smoothScroll - Use smooth scrolling
   */
  const centerThumbnailInSidebar = (pageNum, smoothScroll = true) => {
    if (!elements.sidebar || elements.sidebar.classList.contains("collapsed"))
      return;

    const targetThumb = state.thumbnails[pageNum - 1];
    if (!targetThumb) return;

    const sidebarRect = elements.sidebar.getBoundingClientRect();
    const thumbRect = targetThumb.getBoundingClientRect();
    const sidebarCenter = sidebarRect.top + sidebarRect.height / 2;
    const thumbCenter = thumbRect.top + thumbRect.height / 2;
    const delta = thumbCenter - sidebarCenter;

    if (Math.abs(delta) < thumbRect.height / 2) return;

    elements.sidebar.scrollBy({
      top: delta,
      behavior: smoothScroll ? "smooth" : "auto",
    });
  };

  // ============================================================================
  // FILE PRELOADING
  // ============================================================================

  /**
   * Warm up an image by preloading
   * @param {string} src - Image source URL
   */
  const warmImage = (src) => {
    if (!src) return;
    const img = new Image();
    img.src = src;
  };

  /**
   * Preload file content (viewer only, no sidebar)
   * @param {number} fileNum - File number to preload
   * @returns {Promise} Promise resolving to file content data
   */
  const preloadFileContent = async (fileNum) => {
    if (state.fileContentCache.has(fileNum)) {
      return state.fileContentCache.get(fileNum);
    }

    const filename = fileNum === 1 ? "index.html" : `${fileNum}.html`;
    const promise = fetch(filename)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to preload ${filename}`);
        return res.text();
      })
      .then((htmlText) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, "text/html");
        const viewerEl = doc.getElementById("viewer");

        if (!viewerEl) throw new Error("No viewer found");

        // Extract pages with data attributes
        const pages = Array.from(viewerEl.querySelectorAll(".page"));
        const pagesData = pages.map((page) => ({
          html: page.outerHTML,
          pageNum: parseInt(page.dataset.page, 10),
          images: Array.from(page.querySelectorAll("img")).map((img) =>
            img.getAttribute("src"),
          ),
        }));

        // Warm up first 5 images of each page
        pagesData.forEach((p) => p.images.slice(0, 5).forEach(warmImage));

        // Extract metadata from head
        const headTitle = doc.title || "";
        const headMetas = Array.from(
          doc.head?.querySelectorAll("meta[name], meta[property]") || [],
        ).map((meta) => ({
          name: meta.getAttribute("name") || "",
          property: meta.getAttribute("property") || "",
          content: meta.getAttribute("content") || "",
        }));
        const slideTitleText =
          doc.querySelector(".slide-title")?.textContent?.trim() || "";

        return {
          fileNum,
          pages: pagesData,
          totalPages: pagesData.length,
          // Metadata
          headTitle,
          headMetas,
          slideTitleText,
        };
      })
      .catch((err) => {
        state.fileContentCache.delete(fileNum);
        throw err;
      });

    state.fileContentCache.set(fileNum, promise);
    return promise;
  };

  /**
   * Update document metadata (title, meta tags, slide title)
   * @param {Object} metadata - Metadata object with headTitle, headMetas, slideTitleText
   */
  const updateDocumentMetadata = (metadata) => {
    if (!metadata) return;

    // Update document title
    if (metadata.headTitle) {
      document.title = metadata.headTitle;
    }

    // Update meta tags
    if (metadata.headMetas?.length) {
      metadata.headMetas.forEach((meta) => {
        const key =
          (meta.name && ["name", meta.name]) ||
          (meta.property && ["property", meta.property]) ||
          null;
        if (!key || !meta.content) return;

        const selector = `meta[${key[0]}="${key[1]}"]`;
        let tag = document.head.querySelector(selector);
        if (!tag) {
          tag = document.createElement("meta");
          tag.setAttribute(key[0], key[1]);
          document.head.appendChild(tag);
        }
        tag.setAttribute("content", meta.content);
      });
    }

    // Update slide title in header
    if (metadata.slideTitleText) {
      const desktopTitle = document.querySelector(
        ".header-desktop .slide-title",
      );
      const mobileTitle = document.querySelector(
        ".header-mobile .mobile-slide-title",
      );
      if (desktopTitle) desktopTitle.textContent = metadata.slideTitleText;
      if (mobileTitle) mobileTitle.textContent = metadata.slideTitleText;
    }
  };

  /**
   * Prefetch adjacent files for smooth navigation
   */
  const prefetchAdjacentFiles = () => {
    const info = getCurrentFileInfo();
    const totalPages = getTotalPages();
    const totalFiles = Math.ceil(totalPages / PAGES_PER_FILE);
    const nextFile = info.fileNum + 1;
    const prevFile = info.fileNum - 1;

    if (nextFile <= totalFiles) {
      preloadFileContent(nextFile).catch(() => {});
    }
    if (prevFile >= 1) {
      preloadFileContent(prevFile).catch(() => {});
    }
  };

  /**
   * Append file content to end of viewer
   * @param {number} fileNum - File number to append
   */
  const appendFileContent = async (fileNum) => {
    if (state.loadedFiles.has(fileNum) || state.isLoadingContent) return;

    try {
      state.isLoadingContent = true;
      const content = await preloadFileContent(fileNum);

      // Create container for this file
      const fileContainer = document.createElement("div");
      fileContainer.className = "file-section";
      fileContainer.dataset.fileNum = fileNum;

      // Append pages
      content.pages.forEach((pageData) => {
        fileContainer.insertAdjacentHTML("beforeend", pageData.html);
      });

      // Append to viewer
      elements.viewer.appendChild(fileContainer);
      state.loadedFiles.add(fileNum);

      // Reinitialize handlers
      refreshDomRefs();
      bindNavZoneClicks();
      initOCRHandlers?.();
      markPortraitSlides();
      adjustPageMargins?.();
    } catch (err) {
      console.error(`Failed to append file ${fileNum}:`, err);
    } finally {
      state.isLoadingContent = false;
    }
  };

  /**
   * Prepend file content to beginning of viewer
   * @param {number} fileNum - File number to prepend
   */
  const prependFileContent = async (fileNum) => {
    if (state.loadedFiles.has(fileNum) || state.isLoadingContent) return;

    try {
      state.isLoadingContent = true;
      const content = await preloadFileContent(fileNum);

      // Save scroll position
      const oldScrollHeight = elements.viewer.scrollHeight;
      const oldScrollTop = elements.viewer.scrollTop;

      // Create container for this file
      const fileContainer = document.createElement("div");
      fileContainer.className = "file-section";
      fileContainer.dataset.fileNum = fileNum;

      // Append pages
      content.pages.forEach((pageData) => {
        fileContainer.insertAdjacentHTML("beforeend", pageData.html);
      });

      // Prepend to viewer
      elements.viewer.insertBefore(fileContainer, elements.viewer.firstChild);
      state.loadedFiles.add(fileNum);

      // Restore scroll position (critical for smooth UX!)
      requestAnimationFrame(() => {
        const newScrollHeight = elements.viewer.scrollHeight;
        elements.viewer.scrollTop =
          oldScrollTop + (newScrollHeight - oldScrollHeight);
      });

      // Reinitialize handlers
      refreshDomRefs();
      bindThumbnailClicks();
      bindNavZoneClicks();
      initOCRHandlers?.();
      markPortraitSlides();
      adjustPageMargins?.();
    } catch (err) {
      console.error(`Failed to prepend file ${fileNum}:`, err);
    } finally {
      state.isLoadingContent = false;
    }
  };

  /**
   * Unload file content from DOM
   * @param {number} fileNum - File number to unload
   */
  const unloadFileContent = (fileNum) => {
    const fileSection = elements.viewer?.querySelector(
      `.file-section[data-file-num="${fileNum}"]`,
    );

    if (fileSection) {
      fileSection.remove();
      state.loadedFiles.delete(fileNum);
      refreshDomRefs();
    }
  };

  /**
   * Maintain viewport window to manage memory
   */
  const maintainViewportWindow = () => {
    const currentFileNum = getCurrentFileInfo().fileNum;
    const { bufferSize } = state.viewportWindow;
    const totalPages = getTotalPages();
    const totalFiles = Math.ceil(totalPages / PAGES_PER_FILE);

    // Define window
    const minFile = Math.max(1, currentFileNum - bufferSize);
    const maxFile = Math.min(totalFiles, currentFileNum + bufferSize);

    // Mobile: Never unload files to prevent stuttering on scroll
    // PC: Unload files outside window to manage memory
    if (!isMobileUserAgent()) {
      state.loadedFiles.forEach((fileNum) => {
        if (fileNum < minFile || fileNum > maxFile) {
          unloadFileContent(fileNum);
        }
      });
    }

    state.viewportWindow = { minFile, maxFile, bufferSize };
  };

  /**
   * Smart preload strategy with priority queue
   */
  const smartPreload = async () => {
    const currentFileNum = getCurrentFileInfo().fileNum;
    const totalPages = getTotalPages();
    const totalFiles = Math.ceil(totalPages / PAGES_PER_FILE);
    const { bufferSize } = state.viewportWindow;

    // Priority queue
    const loadQueue = [];

    // Current file (highest priority)
    if (!state.loadedFiles.has(currentFileNum)) {
      loadQueue.push({ fileNum: currentFileNum, priority: 100 });
    }

    // Next files (high priority)
    for (let i = 1; i <= bufferSize; i++) {
      const nextFile = currentFileNum + i;
      if (nextFile <= totalFiles && !state.loadedFiles.has(nextFile)) {
        loadQueue.push({ fileNum: nextFile, priority: 100 - i * 10 });
      }
    }

    // Previous files (medium priority)
    for (let i = 1; i <= bufferSize; i++) {
      const prevFile = currentFileNum - i;
      if (prevFile >= 1 && !state.loadedFiles.has(prevFile)) {
        loadQueue.push({ fileNum: prevFile, priority: 50 - i * 10 });
      }
    }

    // Sort by priority
    loadQueue.sort((a, b) => b.priority - a.priority);

    // Preload content (cache only, don't append to DOM yet)
    for (const item of loadQueue) {
      preloadFileContent(item.fileNum).catch(() => {});
    }
  };

  /**
   * Evict oldest cache entries to maintain size limit
   */
  const MAX_CACHE_SIZE = 7;
  const evictOldestCache = () => {
    if (state.fileContentCache.size <= MAX_CACHE_SIZE) return;

    const currentFileNum = getCurrentFileInfo().fileNum;
    const entries = Array.from(state.fileContentCache.keys());

    // Remove files farthest from current
    entries
      .sort((a, b) => {
        const distA = Math.abs(a - currentFileNum);
        const distB = Math.abs(b - currentFileNum);
        return distB - distA;
      })
      .slice(MAX_CACHE_SIZE)
      .forEach((fileNum) => state.fileContentCache.delete(fileNum));
  };

  /**
   * Replace current file content with new file (for single mode navigation)
   * @param {number} targetFileNum - Target file number
   * @param {number} targetPage - Target page number
   */
  const replaceFileContent = async (targetFileNum, targetPage) => {
    try {
      // Load file content
      const content = await preloadFileContent(targetFileNum);

      // Clear viewer
      elements.viewer.innerHTML = "";

      // Create file section
      const fileContainer = document.createElement("div");
      fileContainer.className = "file-section";
      fileContainer.dataset.fileNum = targetFileNum;

      // Append pages
      content.pages.forEach((pageData) => {
        fileContainer.insertAdjacentHTML("beforeend", pageData.html);
      });

      elements.viewer.appendChild(fileContainer);

      // Update loaded files state
      state.loadedFiles.clear();
      state.loadedFiles.add(targetFileNum);

      // Update metadata
      updateDocumentMetadata({
        headTitle: content.headTitle,
        headMetas: content.headMetas,
        slideTitleText: content.slideTitleText,
      });

      // Update URL
      const targetFilename = targetFileNum === 1 ? "index.html" : `${targetFileNum}.html`;
      const newUrl = new URL(targetFilename, window.location.href);
      newUrl.searchParams.set("page", targetPage);
      window.history.replaceState({}, "", newUrl);

      // Reinitialize handlers
      refreshDomRefs();
      bindNavZoneClicks();
      initOCRHandlers?.();
      markPortraitSlides();
      adjustPageMargins?.();

      // Set active page and update UI
      setActivePage(targetPage);
      syncPageControls(targetPage);
      updateThumbnailHighlight(targetPage, { smoothScroll: false });
      state.currentPage = targetPage;
      updateShareCurrentPage(targetPage);

      if (elements.currentPageSpan) {
        elements.currentPageSpan.textContent = targetPage;
      }

      // Attach chevrons
      setTimeout(() => attachSlideChevrons(), NAVIGATION_SETTLE_DELAY);
      updateSingleModeNavAvailability();

      // Preload adjacent files
      smartPreload();

      return true;
    } catch (error) {
      console.error(`Failed to replace file content:`, error);
      return false;
    }
  };

  // ============================================================================
  // NAVIGATION
  // ============================================================================

  /**
   * Navigate to a specific page (with multi-file support)
   * @param {number} pageNum - Target page number
   */
  const goToPage = async (pageNum) => {
    if (pageNum === 0) return;

    let totalPages = getTotalPages();

    const allPages = document.querySelectorAll(".page[data-page]");
    if (allPages.length > 0) {
      const pageNumbers = Array.from(allPages).map((page) =>
        parseInt(page.dataset.page || "0", 10),
      );
      const maxPageNum = Math.max(...pageNumbers);
      if (maxPageNum > totalPages) {
        totalPages = maxPageNum;
      }
    }

    if (pageNum > totalPages) return;

    const target = Math.max(1, Math.min(pageNum, totalPages));
    const targetFileNum = getFileNumFromPage(target);
    const currentFileInfo = getCurrentFileInfo();

    // Navigate to different file if needed
    if (targetFileNum !== currentFileInfo.fileNum) {
      const isContinuous = elements.viewer?.classList.contains("continuous");

      if (isContinuous) {
        // Continuous mode: For far jumps, rebuild viewer like single mode
        state.isNavigating = true;

        try {
          // Check if target page element exists
          let targetEl = elements.viewer.querySelector(
            `.page[data-page="${target}"]`,
          );

          // If target not in DOM (far jump or unloaded), rebuild viewer
          if (!targetEl) {
            // Load target file content
            const content = await preloadFileContent(targetFileNum);

            // Clear viewer
            elements.viewer.innerHTML = "";

            // Create file section for target file
            const fileContainer = document.createElement("div");
            fileContainer.className = "file-section";
            fileContainer.dataset.fileNum = targetFileNum;

            // Append pages
            content.pages.forEach((pageData) => {
              fileContainer.insertAdjacentHTML("beforeend", pageData.html);
            });

            elements.viewer.appendChild(fileContainer);

            // Update loaded files state
            state.loadedFiles.clear();
            state.loadedFiles.add(targetFileNum);

            // Load adjacent files
            const totalFiles = Math.ceil(totalPages / PAGES_PER_FILE);
            const { bufferSize } = state.viewportWindow;
            const loadPromises = [];

            for (let i = 1; i <= bufferSize; i++) {
              const nextFile = targetFileNum + i;
              if (nextFile <= totalFiles) {
                loadPromises.push(appendFileContent(nextFile));
              }
            }

            for (let i = 1; i <= bufferSize; i++) {
              const prevFile = targetFileNum - i;
              if (prevFile >= 1) {
                loadPromises.push(prependFileContent(prevFile));
              }
            }

            if (loadPromises.length > 0) {
              await Promise.all(loadPromises);
            }

            // Update metadata
            updateDocumentMetadata({
              headTitle: content.headTitle,
              headMetas: content.headMetas,
              slideTitleText: content.slideTitleText,
            });

            // Reinitialize handlers
            refreshDomRefs();
            bindNavZoneClicks();
            initOCRHandlers?.();
            markPortraitSlides();
            adjustPageMargins?.();

            smartPreload();
          }

          // Update URL
          const targetFilename = targetFileNum === 1 ? "index.html" : `${targetFileNum}.html`;
          const newUrl = new URL(targetFilename, window.location.href);
          newUrl.searchParams.set("page", target);
          window.history.replaceState({}, "", newUrl);

          // Scroll to target page
          targetEl = elements.viewer.querySelector(
            `.page[data-page="${target}"]`,
          );
          if (targetEl) {
            const scrollTarget = getScrollTopForPage(targetEl);
            elements.viewer.scrollTo({ top: scrollTarget, behavior: "auto" });
          }

          state.currentPage = target;
          syncPageControls(target);
          updateThumbnailHighlight(target, { smoothScroll: false });
          updateShareCurrentPage(target);

          if (elements.currentPageSpan) {
            elements.currentPageSpan.textContent = target;
          }
        } finally {
          // Delay resetting isNavigating to prevent scroll handler from interfering
          setTimeout(() => {
            state.isNavigating = false;
          }, NAVIGATION_SETTLE_DELAY);
        }

        updateSingleModeNavAvailability();
        return;
      } else {
        // Single mode: Use replaceFileContent for smooth transition
        state.isNavigating = true;

        try {
          const success = await replaceFileContent(targetFileNum, target);

          if (!success) {
            // Fallback to redirect if replace failed
            const targetFile = targetFileNum === 1 ? "index.html" : `${targetFileNum}.html`;
            const url = new URL(targetFile, window.location.href);
            url.searchParams.set("page", target);
            window.location.href = url.toString();
          }
        } catch (error) {
          console.error(`Failed to navigate to page:`, error);
          const targetFile = targetFileNum === 1 ? "index.html" : `${targetFileNum}.html`;
          const url = new URL(targetFile, window.location.href);
          url.searchParams.set("page", target);
          window.location.href = url.toString();
        } finally {
          state.isNavigating = false;
        }

        return;
      }
    }

    // Same file navigation
    if (!elements.viewer.classList.contains("continuous")) {
      closeAllOcrBoxes();
      setActivePage(pageNum);
      syncPageControls(target);
      updateThumbnailHighlight(target, { smoothScroll: false });
      state.currentPage = target;
      updateShareCurrentPage(target);

      if (elements.currentPageSpan) {
        elements.currentPageSpan.textContent = pageNum;
      }

      const newUrl = new URL(window.location);
      newUrl.searchParams.set("page", target);
      window.history.replaceState({}, "", newUrl);
      updateSingleModeNavAvailability();
      prefetchAdjacentFiles();
      return;
    }

    // Continuous mode: scroll to page
    const targetEl = elements.viewer.querySelector(
      `.page[data-page="${pageNum}"]`,
    );
    if (!targetEl) return;

    const scrollTarget = getScrollTopForPage(targetEl);
    elements.viewer.scrollTo({ top: scrollTarget, behavior: "auto" });
    syncPageControls(target);
    updateThumbnailHighlight(target, { smoothScroll: false });
    state.currentPage = target;
    updateShareCurrentPage(target);

    if (elements.currentPageSpan) {
      elements.currentPageSpan.textContent = target;
    }

    const newUrl = new URL(window.location);
    newUrl.searchParams.set("page", target);
    window.history.replaceState({}, "", newUrl);
    updateSingleModeNavAvailability();
    prefetchAdjacentFiles();
  };

  /**
   * Navigate to file with preserved query params
   * @param {string} targetFile - Target filename
   */
  const navigateToFileWithParams = (targetFile) => {
    const url = new URL(targetFile, window.location.href);
    const currentParams = new URLSearchParams(window.location.search);
    currentParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
    window.location.href = url.toString();
  };

  /**
   * Update navigation button availability
   */
  function updateSingleModeNavAvailability() {
    if (!elements.viewer) return;

    let totalPages = getTotalPages();

    const allPages = document.querySelectorAll(".page[data-page]");
    if (allPages.length > 0) {
      const pageNumbers = Array.from(allPages).map((page) =>
        parseInt(page.dataset.page || "0", 10),
      );
      const maxPageNum = Math.max(...pageNumbers);
      if (maxPageNum > totalPages) {
        totalPages = maxPageNum;
      }
    }

    const inSingleMode = !elements.viewer.classList.contains("continuous");
    const currentPage = getCurrentPageFromUrl() || 1;
    const atFirstPage = currentPage <= 1;
    const atLastPage = currentPage >= totalPages;

    elements.viewer.classList.toggle("first-page", inSingleMode && atFirstPage);
    elements.viewer.classList.toggle("last-page", inSingleMode && atLastPage);
  }

  // ============================================================================
  // OCR TEXT HANDLERS
  // ============================================================================

  /**
   * Update page OCR state
   * @param {HTMLElement} container - OCR container element
   */
  const updatePageOcrState = (container) => {
    const pageEl = container.closest(".page");
    if (!pageEl) return;
    const hasOpen = !!pageEl.querySelector(".ocr-container.open");
    pageEl.classList.toggle("ocr-open", hasOpen);
  };

  /**
   * Initialize OCR expand/collapse handlers
   */
  initOCRHandlers = function () {
    const ocrContainers = document.querySelectorAll(".ocr-container");

    ocrContainers.forEach((container) => {
      const ocrBox = container.querySelector(".ocr-box");
      const ocrHeader = container.querySelector(".ocr-header");
      const chevron = container.querySelector(".ocr-chevron");
      const tooltipTrigger = container.querySelector(".ocr-tooltip-trigger");

      if (!ocrBox || !ocrHeader) return;

      // Remove existing listeners by cloning
      const newOcrHeader = ocrHeader.cloneNode(true);
      ocrHeader.parentNode.replaceChild(newOcrHeader, ocrHeader);

      newOcrHeader.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = container.classList.toggle("open");

        if (isOpen) {
          ocrBox.classList.remove("collapsed");
          if (chevron) chevron.style.transform = "rotate(90deg)";
        } else {
          ocrBox.classList.add("collapsed");
          if (chevron) chevron.style.transform = "rotate(0deg)";
        }
        updatePageOcrState(container);
      });

      tooltipTrigger?.addEventListener("click", (event) => {
        event.preventDefault();
        if (container.classList.contains("open")) return;
        newOcrHeader?.click();
      });
    });
  };

  /**
   * Close all expanded OCR boxes
   */
  closeAllOcrBoxes = () => {
    document.querySelectorAll(".ocr-container.open").forEach((container) => {
      container.classList.remove("open");
      const ocrBox = container.querySelector(".ocr-box");
      const chevron = container.querySelector(".ocr-chevron");
      if (ocrBox) ocrBox.classList.add("collapsed");
      if (chevron) chevron.style.transform = "rotate(0deg)";
      updatePageOcrState(container);
    });
  };

  // ============================================================================
  // SIDEBAR MANAGEMENT
  // ============================================================================

  /**
   * Bind sidebar resizer functionality
   */
  const bindSidebarResizer = () => {
    const resizer = elements.sidebar?.querySelector(".sidebar-resizer");
    if (!elements.sidebar || !resizer || resizer.dataset.bound === "true")
      return;

    resizer.dataset.bound = "true";

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener("mousedown", (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = elements.sidebar.offsetWidth;
      document.body.style.userSelect = "none";
    });

    const onMouseMove = (e) => {
      if (!isResizing) return;
      const delta = e.clientX - startX;
      let newWidth = startWidth + delta;
      newWidth = Math.max(110, Math.min(440, newWidth));
      elements.sidebar.style.width = `${newWidth}px`;

      if (elements.footer) {
        elements.footer.style.left = `${newWidth}px`;
      }
    };

    const onMouseUp = () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.userSelect = "";
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  /**
   * Collapse sidebar with animation
   */
  const collapseSidebarSoft = () => {
    if (!elements.sidebar || elements.sidebar.classList.contains("collapsed"))
      return;

    elements.sidebar.classList.add("collapsed");
    elements.footer?.classList.add("expanded");
    elements.sidebar.style.transition = "width 0.3s ease, transform 0.3s ease";
    elements.sidebar.style.transform = "translateX(-100%)";
    elements.sidebar.style.width = "0px";

    if (elements.snapViewer) {
      elements.snapViewer.style.transition = "margin-left 0.3s ease";
      elements.snapViewer.style.marginLeft = "0";
    }
  };

  // ============================================================================
  // MODAL MANAGEMENT
  // ============================================================================

  /**
   * Close all open modals
   * @param {boolean} skipRestoreShare - Skip restoring share visibility (used when opening another modal)
   */
  const closeAllModals = (skipRestoreShare = false) => {
    const hadActiveModal =
      document.querySelectorAll(".modal.active").length > 0;

    document.querySelectorAll(".modal.active").forEach((m) => {
      m.classList.remove("active");
    });
    elements.sidebar?.classList.remove("collapsed");
    elements.footer?.classList.remove("expanded");

    // Restore share current page visibility when closing modals
    if (hadActiveModal && !skipRestoreShare) {
      toggleShareCurrentPageVisibility(true);
    }
  };

  /**
   * Adjust modal size to fit viewer area
   * @param {HTMLElement} modal - Modal element
   * @param {boolean} fullWidth - Use full page width
   */
  const adjustModalSize = (modal, fullWidth = false) => {
    if (!elements.viewer || !modal) return;

    const rect = elements.viewer.getBoundingClientRect();

    if (fullWidth) {
      modal.style.position = "absolute";
      modal.style.top = `${rect.top + window.scrollY}px`;
      modal.style.left = `0px`;
      modal.style.width = `${window.innerWidth}px`;
      modal.style.height = `${rect.height}px`;
      return;
    }

    modal.style.position = "absolute";
    modal.style.top = `${rect.top + window.scrollY}px`;
    modal.style.left = `${rect.left + window.scrollX}px`;
    modal.style.width = `${rect.width}px`;
    modal.style.height = `${rect.height}px`;
  };

  /**
   * Open mobile modal
   * @param {HTMLElement} modal - Modal to open
   */
  const openMobileModal = (modal) => {
    if (!modal) return;
    closeAllModals();
    modal.classList.add("active");
    modal.scrollTop = 0;
  };

  /**
   * Set help view state
   * @param {boolean} isActive - Help view is active
   */
  const setHelpViewState = (isActive) => {
    document.body.classList.toggle("help-open", !!isActive);
    elements.layout?.classList.toggle("sidebar-hidden", !!isActive);
  };

  /**
   * Close help modal
   */
  const closeHelpModalView = () => {
    elements.helpModal?.classList.remove("active");
    setHelpViewState(false);
  };

  // ============================================================================
  // SEARCH FUNCTIONALITY
  // ============================================================================

  /**
   * Clear search highlights from DOM
   */
  const clearSearchHighlight = () => {
    document.querySelectorAll(".search-highlight").forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent), el);
        parent.normalize();
      }
    });
  };

  /**
   * Collect search pages from all files
   * @returns {Promise<Array>} Array of page data
   */
  const collectSearchPagesFromFiles = async () => {
    const totalPages = getTotalPages();
    const totalFiles = Math.ceil(totalPages / PAGES_PER_FILE);

    const filePromises = [];
    for (let fileNum = 1; fileNum <= totalFiles; fileNum++) {
      const filename = fileNum === 1 ? "index.html" : `${fileNum}.html`;
      const fileUrl = filename;
      filePromises.push(
        fetch(fileUrl)
          .then((response) => {
            if (!response.ok) return [];
            return response.text();
          })
          .then((htmlText) => {
            if (!htmlText) return [];
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, "text/html");
            const pages = doc.querySelectorAll(".page");
            const pageResults = [];

            pages.forEach((pageEl) => {
              const ocrBox = pageEl.querySelector(".ocr-box");
              const img = pageEl.querySelector("img");
              if (ocrBox && img) {
                pageResults.push({
                  number: pageEl.dataset.page,
                  img: img.getAttribute("src") || "",
                  text: ocrBox.textContent || "",
                });
              }
            });

            return pageResults;
          })
          .catch((error) => {
            console.warn(`Failed to fetch ${filename} for search:`, error);
            return [];
          }),
      );
    }

    const fileResultsArrays = await Promise.all(filePromises);
    return fileResultsArrays.flat().sort((a, b) => a.number - b.number);
  };

  /**
   * Build search snippet with context
   * @param {string} text - Full text
   * @param {Array} keywords - Search keywords
   * @returns {string} Snippet
   */
  const buildSnippet = (text, keywords) => {
    const normalized = normalizeText(text);
    if (!normalized) return "";

    if (!keywords.length) {
      return normalized.length > SEARCH_SNIPPET_LENGTH
        ? `${normalized.slice(0, SEARCH_SNIPPET_LENGTH)}…`
        : normalized;
    }

    const escaped = keywords.map((kw) => escapeRegExp(kw));
    const regex = new RegExp(escaped.join("|"), "i");
    const matchIndex = normalized.search(regex);

    if (matchIndex === -1) {
      return normalized.length > SEARCH_SNIPPET_LENGTH
        ? `${normalized.slice(0, SEARCH_SNIPPET_LENGTH)}…`
        : normalized;
    }

    const snippetStart = Math.max(0, matchIndex - SNIPPET_CONTEXT.before);
    const snippetEnd = Math.min(
      normalized.length,
      matchIndex + SNIPPET_CONTEXT.after,
    );
    let snippet = normalized.slice(snippetStart, snippetEnd);

    if (snippetStart > 0) snippet = `…${snippet}`;
    if (snippetEnd < normalized.length) snippet = `${snippet}…`;

    return snippet;
  };

  /**
   * Highlight keywords in snippet
   * @param {string} snippet - Snippet text
   * @param {Array} keywords - Keywords to highlight
   * @returns {string} HTML with highlights
   */
  const highlightSnippet = (snippet, keywords) => {
    if (!snippet) return "";

    const escaped = keywords.map((kw) => escapeRegExp(kw)).filter(Boolean);
    if (!escaped.length) {
      return escapeHtml(snippet);
    }

    const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
    const parts = snippet.split(pattern);

    return parts
      .map((part) => {
        if (!part) return "";
        if (pattern.test(part)) {
          pattern.lastIndex = 0;
          return `<mark class="search-highlight">${escapeHtml(part)}</mark>`;
        }
        pattern.lastIndex = 0;
        return escapeHtml(part);
      })
      .join("");
  };

  /**
   * Render search results in modal
   * @param {Array} results - Search results
   * @param {Array} keywords - Search keywords
   * @param {string} rawQuery - Original query
   */
  const renderSearchResults = (results, keywords, rawQuery) => {
    const searchResultsList = elements.searchModal?.querySelector(
      ".search-results-list",
    );
    const searchEmptyMessage = elements.searchModal?.querySelector(
      ".search-results-empty",
    );
    const searchSummary = elements.searchModal?.querySelector(
      ".search-modal-summary",
    );
    const defaultSearchSummaryText =
      searchSummary?.textContent ||
      "キーワードに一致したスライドを表示しています。";

    if (!searchResultsList || !elements.searchModal) return;

    searchResultsList.innerHTML = "";
    searchResultsList.scrollTop = 0;

    const hasQuery = rawQuery.trim().length > 0;

    if (!results.length) {
      if (searchSummary) {
        searchSummary.textContent = hasQuery
          ? `「${rawQuery}」の検索結果（0件）`
          : defaultSearchSummaryText;
      }
      if (searchEmptyMessage) {
        searchEmptyMessage.hidden = false;
        searchEmptyMessage.textContent = hasQuery
          ? `「${rawQuery}」に一致する結果が見つかりませんでした。`
          : "検索キーワードを入力してください。";
      }
      return;
    }

    if (searchEmptyMessage) {
      searchEmptyMessage.hidden = true;
    }
    if (searchSummary) {
      searchSummary.textContent = `「${rawQuery}」の検索結果（${results.length}件）`;
    }

    results.forEach((result) => {
      const card = document.createElement("div");
      card.className = "search-result-card";
      card.setAttribute("role", "button");
      card.tabIndex = 0;

      const head = document.createElement("div");
      head.className = "search-result-head";

      const pageLabel = document.createElement("span");
      pageLabel.className = "search-result-page";
      pageLabel.textContent = `${result.number} ページ`;

      const thumb = document.createElement("img");
      thumb.className = "search-result-thumb";
      thumb.src = result.img || "";
      thumb.alt = `page ${result.number}`;
      thumb.loading = "lazy";

      head.appendChild(pageLabel);
      head.appendChild(thumb);

      const textEl = document.createElement("p");
      textEl.className = "search-result-text";
      textEl.innerHTML = highlightSnippet(result.snippet, keywords);

      card.appendChild(head);
      card.appendChild(textEl);

      const navigateToPage = () => {
        elements.searchModal.classList.remove("active");
        goToPage(result.number);
      };

      card.addEventListener("click", navigateToPage);
      card.addEventListener("keypress", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigateToPage();
        }
      });

      searchResultsList.appendChild(card);
    });
  };

  /**
   * Open search results modal
   */
  const openSearchResultsModal = () => {
    if (!elements.searchModal) return;
    closeAllModals(true); // Pass true to prevent restoring share visibility
    collapseSidebarSoft();
    adjustModalSize(elements.searchModal);
    elements.searchModal.classList.add("active");
    toggleShareCurrentPageVisibility(false);
  };

  /**
   * Close header search menu
   */
  const closeHeaderSearchMenu = () => {
    const headerSearch = document.querySelector(
      '.header-item[data-menu="search"]',
    );
    headerSearch?.classList.remove("active");
    headerSearch?.querySelector(".header-menu")?.classList.remove("open");
  };

  /**
   * Run search across all pages
   * @param {string} rawQuery - Search query
   */
  const runSearch = async (rawQuery) => {
    const query = rawQuery.trim();
    const keywords = query ? query.split(/\s+/).filter(Boolean) : [];

    const searchSummary = elements.searchModal?.querySelector(
      ".search-modal-summary",
    );
    const searchEmptyMessage = elements.searchModal?.querySelector(
      ".search-results-empty",
    );
    const searchResultsList = elements.searchModal?.querySelector(
      ".search-results-list",
    );

    if (!keywords.length) {
      renderSearchResults([], [], "");
      openSearchResultsModal();
      return;
    }

    // Show loading message
    if (searchSummary) {
      searchSummary.textContent = "検索中...";
    }
    if (searchEmptyMessage) {
      searchEmptyMessage.hidden = true;
    }
    searchResultsList.innerHTML = "";

    try {
      const dataset = await collectSearchPagesFromFiles();
      const loweredKeywords = keywords.map((kw) => kw.toLowerCase());
      const results = dataset.reduce((acc, page) => {
        const text = normalizeText(page.text || "");
        if (!text) return acc;

        const lowerText = text.toLowerCase();
        const isMatch = loweredKeywords.every((kw) => lowerText.includes(kw));
        if (!isMatch) return acc;

        acc.push({
          number: page.number,
          img: page.img || "",
          snippet: buildSnippet(text, keywords),
        });
        return acc;
      }, []);

      renderSearchResults(results, keywords, query);
    } catch (error) {
      console.error("Search error:", error);
      if (searchSummary) {
        searchSummary.textContent = "検索中にエラーが発生しました。";
      }
      if (searchEmptyMessage) {
        searchEmptyMessage.hidden = false;
        searchEmptyMessage.textContent = "検索を実行できませんでした。";
      }
    }

    openSearchResultsModal();
  };

  // ============================================================================
  // SHARE FUNCTIONALITY
  // ============================================================================

  /**
   * Get slide title from DOM
   * @returns {string} Slide title
   */
  const getSlideTitle = () => {
    const slideTitleEl = document.querySelector(".slide-title");
    return slideTitleEl?.textContent?.trim() || "";
  };

  /**
   * Create share URL
   * @param {boolean} isFullSlide - Share full slide vs current page
   * @returns {string} Share URL
   */
  const createShareUrl = (isFullSlide) => {
    if (isFullSlide) {
      const url = new URL("index.html", window.location.href);
      url.searchParams.set("page", "1");
      return url.toString();
    } else {
      const currentPageNum = getCurrentPageFromUrl() || 1;
      const targetFileNum = getFileNumFromPage(currentPageNum);
      const targetFilename = targetFileNum === 1 ? "index.html" : `${targetFileNum}.html`;
      const url = new URL(targetFilename, window.location.href);
      url.searchParams.set("page", currentPageNum);
      return url.toString();
    }
  };

  /**
   * Create Twitter share text
   * @param {string} url - Share URL
   * @param {boolean} isFullSlide - Full slide or page
   * @param {string} slideTitle - Slide title
   * @param {number} currentPage - Current page number
   * @param {number} totalPages - Total pages
   * @returns {string} Twitter share URL
   */
  const createTwitterShareText = (
    url,
    isFullSlide,
    slideTitle,
    currentPage,
    totalPages,
  ) => {
    let shareText = "";

    if (isFullSlide) {
      shareText = `「${slideTitle}」のWEBスライド 全${totalPages}ページ`;
    } else {
      shareText = `${slideTitle} ${currentPage}ページ/${totalPages}`;
    }

    if (shareText.length > 280) {
      shareText = shareText.substring(0, 277) + "...";
    }

    const tweetUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(
      url,
    )}&text=${encodeURIComponent(shareText)}`;

    return tweetUrl;
  };

  /**
   * Show toast notification
   * @param {string} message - Toast message
   */
  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add("show"), 10);
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  /**
   * Fallback clipboard copy for older browsers
   * @param {string} text - Text to copy
   */
  function fallbackCopyToClipboard(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand("copy");
      showToast("リンクをコピーしました");
    } catch (err) {
      console.error("Fallback copy failed:", err);
      showToast("コピーに失敗しました");
    }
    document.body.removeChild(textArea);
  }

  // ============================================================================
  // DISPLAY MODE (CONTINUOUS/SINGLE)
  // ============================================================================

  /**
   * Remove chevron navigation elements
   */
  const removeChevrons = () => {
    document
      .querySelectorAll(".slide-chevron-next, .slide-chevron-prev")
      .forEach((el) => el.remove());
  };

  /**
   * Attach slide navigation chevrons
   */
  function attachSlideChevrons() {
    if (!elements.viewer || elements.viewer.classList.contains("continuous")) {
      return;
    }

    document.querySelectorAll(".page").forEach((page) => {
      const img = page.querySelector("img");
      const leftZone = page.querySelector(".nav-zone.left");
      const rightZone = page.querySelector(".nav-zone.right");
      if (!img) return;

      if (getComputedStyle(page).position === "static") {
        page.style.position = "relative";
      }

      let chevNext = page.querySelector(".slide-chevron-next");
      if (chevNext) {
        const newChevNext = chevNext.cloneNode(true);
        chevNext.replaceWith(newChevNext);
        chevNext = newChevNext;
      } else {
        chevNext = document.createElement("div");
        chevNext.className = "slide-chevron-next";
        page.appendChild(chevNext);
      }
      chevNext.dataset.chevronDirection = "next";

      let chevPrev = null;
      if (!page.classList.contains("footer-page")) {
        chevPrev = page.querySelector(".slide-chevron-prev");
        if (chevPrev) {
          const newChevPrev = chevPrev.cloneNode(true);
          chevPrev.replaceWith(newChevPrev);
          chevPrev = newChevPrev;
        } else {
          chevPrev = document.createElement("div");
          chevPrev.className = "slide-chevron-prev";
          page.appendChild(chevPrev);
        }
        chevPrev.dataset.chevronDirection = "prev";
      }

      const updateChevronPositions = () => {
        const imgOffsetLeft = img.offsetLeft;
        const imgOffsetTop = img.offsetTop;
        const imgWidth = img.offsetWidth;
        const imgHeight = img.offsetHeight;
        const centerY = imgOffsetTop + imgHeight / 2;
        const pageWidth = page.clientWidth;
        const desiredPrevX = imgOffsetLeft - CHEVRON_CONFIG.POSITION_OFFSET;
        const desiredNextX =
          imgOffsetLeft + imgWidth + CHEVRON_CONFIG.POSITION_OFFSET;
        const minX = CHEVRON_CONFIG.ICON_SIZE / 2;
        const maxX = pageWidth - CHEVRON_CONFIG.ICON_SIZE / 2;

        chevNext.style.top = `${centerY}px`;
        chevNext.style.left = `${Math.min(maxX, desiredNextX)}px`;
        chevNext.style.position = "absolute";
        chevNext.style.pointerEvents = "auto";
        chevNext.style.cursor = "pointer";

        if (chevPrev) {
          chevPrev.style.top = `${centerY}px`;
          chevPrev.style.left = `${Math.max(minX, desiredPrevX)}px`;
          chevPrev.style.position = "absolute";
          chevPrev.style.pointerEvents = "auto";
          chevPrev.style.cursor = "pointer";
        }

        if (leftZone) {
          leftZone.style.top = `${imgOffsetTop}px`;
          leftZone.style.left = `${Math.max(
            0,
            imgOffsetLeft - CHEVRON_CONFIG.POSITION_OFFSET,
          )}px`;
          leftZone.style.width = `${imgWidth / 2 + CHEVRON_CONFIG.POSITION_OFFSET}px`;
          leftZone.style.height = `${imgHeight}px`;
        }
        if (rightZone) {
          rightZone.style.top = `${imgOffsetTop}px`;
          rightZone.style.left = `${imgOffsetLeft + imgWidth / 2}px`;
          rightZone.style.width = `${imgWidth / 2 + CHEVRON_CONFIG.POSITION_OFFSET}px`;
          rightZone.style.height = `${imgHeight}px`;
        }
      };

      updateChevronPositions();

      const setChevronOpacity = (showPrev) => {
        if (showPrev === true) {
          if (chevPrev) chevPrev.style.opacity = "0.95";
          chevNext.style.opacity = "0";
        } else if (showPrev === false) {
          if (chevPrev) chevPrev.style.opacity = "0";
          chevNext.style.opacity = "0.95";
        } else {
          if (chevPrev) chevPrev.style.opacity = "0";
          chevNext.style.opacity = "0";
        }
      };

      page.addEventListener("mousemove", (e) => {
        if (chevPrev && chevPrev.contains(e.target)) {
          setChevronOpacity(true);
          return;
        }
        if (chevNext.contains(e.target)) {
          setChevronOpacity(false);
          return;
        }

        const imgRect = img.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        const withinY = y >= imgRect.top && y <= imgRect.bottom;
        const withinX = x >= imgRect.left && x <= imgRect.right;

        if (!withinY || !withinX) {
          setChevronOpacity(null);
          return;
        }

        const midX = imgRect.left + imgRect.width / 2;
        setChevronOpacity(x <= midX);
      });

      page.addEventListener("mouseleave", () => {
        setChevronOpacity(null);
      });

      if (chevPrev) {
        chevPrev.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!elements.viewer.classList.contains("continuous")) {
            const current = getCurrentPageFromUrl() || 1;
            goToPage(current - 1);
          }
        });
      }

      chevNext.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!elements.viewer.classList.contains("continuous")) {
          const current = getCurrentPageFromUrl() || 1;
          goToPage(current + 1);
        }
      });

      if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => updateChevronPositions());
        ro.observe(img);
      } else {
        window.addEventListener("resize", updateChevronPositions);
      }
    });
  }

  // ============================================================================
  // PAGE MENU & CONTROLS
  // ============================================================================

  /**
   * Update page menu options
   */
  const updatePageMenu = () => {
    if (!elements.pageMenu) return;

    const totalPages = getTotalPages();
    elements.pageMenu.innerHTML = "";

    for (let i = 1; i <= totalPages; i++) {
      const option = document.createElement("div");
      option.className = "page-option";
      option.dataset.page = i;
      option.textContent = i;
      option.addEventListener("click", (e) => {
        e.stopPropagation();
        const targetPage = parseInt(option.dataset.page, 10);
        goToPage(targetPage);
        elements.pageDropdown?.classList.remove("active");
      });
      elements.pageMenu.appendChild(option);
    }
  };

  /**
   * Bind thumbnail click handlers
   */
  const bindThumbnailClicks = () => {
    state.thumbnails.forEach((thumb) => {
      thumb.onclick = () => {
        const targetPage = parseInt(thumb.dataset.page, 10);
        goToPage(targetPage);
      };
    });
  };

  /**
   * Bind navigation zone click handlers
   */
  const bindNavZoneClicks = () => {
    const leftZones = document.querySelectorAll(".nav-zone.left");
    const rightZones = document.querySelectorAll(".nav-zone.right");

    leftZones.forEach((zone) => {
      zone.onclick = () => {
        if (!elements.viewer.classList.contains("continuous")) {
          const current = getCurrentPageFromUrl() || 1;
          goToPage(current - 1);
        }
      };
    });

    rightZones.forEach((zone) => {
      zone.onclick = () => {
        if (!elements.viewer.classList.contains("continuous")) {
          const current = getCurrentPageFromUrl() || 1;
          goToPage(current + 1);
        }
      };
    });
  };

  // ============================================================================
  // MOBILE SUPPORT
  // ============================================================================

  /**
   * Update mobile display toggle state
   */
  updateMobileDisplayToggle = () => {
    const mobileDisplayToggleBtn = document.querySelector(
      '[data-mobile-action="display-mode"]',
    );
    const mobileDisplayToggleLabel = mobileDisplayToggleBtn?.querySelector(
      ".mobile-display-toggle-label",
    );
    const mobileDisplayToggleIcon =
      mobileDisplayToggleBtn?.querySelector(".mobile-menu-icon");

    if (!mobileDisplayToggleBtn || !elements.viewer) return;

    const isContinuous = elements.viewer.classList.contains("continuous");
    const nextLabel = isContinuous ? "1枚ずつ表示" : "連続表示";
    const nextIcon = isContinuous
      ? "assets/pageview_icon.svg"
      : "assets/consec_icon.svg";

    if (mobileDisplayToggleLabel) {
      mobileDisplayToggleLabel.textContent = nextLabel;
    }
    if (mobileDisplayToggleIcon) {
      mobileDisplayToggleIcon.src = nextIcon;
      mobileDisplayToggleIcon.alt = nextLabel;
    }
  };

  /**
   * Set mobile menu state
   * @param {boolean} isOpen - Menu open state
   */
  const setMobileMenuState = (isOpen) => {
    if (!elements.mobileMenu || !elements.mobileToggle) return;

    elements.mobileMenu.classList.toggle("open", isOpen);
    elements.mobileMenu.setAttribute("aria-hidden", isOpen ? "false" : "true");
    elements.mobileOverlay?.classList.toggle("open", isOpen);
    elements.mobileToggle.classList.toggle("open", isOpen);
    elements.mobileToggle.setAttribute(
      "aria-expanded",
      isOpen ? "true" : "false",
    );
    document.body.classList.toggle("mobile-menu-open", !!isOpen);
  };

  /**
   * Close mobile menu
   */
  const closeMobileMenu = () => setMobileMenuState(false);

  /**
   * Apply menu toggle position based on screen size
   */
  const applyMenuTogglePosition = () => {
    if (!elements.mobileToggle) return;

    const shouldPlaceBottom = window.innerWidth < 768 && isMobileUserAgent();
    elements.mobileToggle.classList.toggle(
      "position-bottom-right",
      shouldPlaceBottom,
    );

    if (shouldPlaceBottom) {
      elements.mobileToggle.classList.remove("position-top-right");
    } else {
      elements.mobileToggle.classList.add("position-top-right");
      elements.mobileToggle.classList.remove("position-bottom-right");
    }
  };

  /**
   * Update page side gap based on viewport width
   */
  const updatePageSideGap = () => {
    const minWidth = 1200;
    const maxWidth = 1600;
    const minGapPercent = 4;
    const maxGapPercent = 38;
    const viewportWidth =
      window.innerWidth || document.documentElement.clientWidth || minWidth;

    let gapPercent = minGapPercent;
    if (viewportWidth >= maxWidth) {
      gapPercent = maxGapPercent;
    } else if (viewportWidth > minWidth) {
      const ratio = (viewportWidth - minWidth) / (maxWidth - minWidth);
      gapPercent = minGapPercent + (maxGapPercent - minGapPercent) * ratio;
    }

    const gapPixels = (gapPercent / 100) * viewportWidth;
    document.documentElement.style.setProperty(
      "--page-side-gap",
      `${gapPixels}px`,
    );
  };

  // ============================================================================
  // TOOLTIP MANAGEMENT
  // ============================================================================

  let footerTooltipEl = null;

  /**
   * Ensure footer tooltip exists
   * @returns {HTMLElement} Tooltip element
   */
  const ensureFooterTooltip = () => {
    if (footerTooltipEl) return footerTooltipEl;

    footerTooltipEl = document.createElement("div");
    footerTooltipEl.className = "footer-tooltip";
    footerTooltipEl.innerHTML = '<span class="footer-tooltip-text"></span>';
    document.body.appendChild(footerTooltipEl);
    return footerTooltipEl;
  };

  /**
   * Position footer tooltip
   * @param {HTMLElement} target - Target element
   * @returns {HTMLElement|null} Tooltip element
   */
  const positionFooterTooltip = (target) => {
    if (!target) return null;

    const tooltip = ensureFooterTooltip();
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + window.scrollX + rect.width / 2;
    const topY = rect.top + window.scrollY;
    tooltip.style.left = `${centerX}px`;
    tooltip.style.top = `${topY}px`;
    return tooltip;
  };

  /**
   * Show footer tooltip
   * @param {HTMLElement} target - Target element
   */
  const showFooterTooltip = (target) => {
    if (!target) return;

    const text = target.getAttribute("data-tooltip");
    if (!text) return;

    const tooltip = ensureFooterTooltip();
    const textEl = tooltip.querySelector(".footer-tooltip-text");
    if (textEl) textEl.textContent = text;
    positionFooterTooltip(target);
    tooltip.classList.add("visible");
  };

  /**
   * Hide footer tooltip
   */
  const hideFooterTooltip = () => {
    footerTooltipEl?.classList.remove("visible");
  };

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  if (elements.viewer) {
    // Disable scroll restoration
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }

    // Initialize OCR handlers
    initOCRHandlers();

    // Mark portrait slides
    markPortraitSlides();

    // Adjust page margins
    adjustPageMargins();
    window.addEventListener("resize", adjustPageMargins);

    // Initialize page on load
    window.addEventListener("load", async () => {
      const pageParam = getCurrentPageFromUrl() || 1;

      // Initialize state.currentPage from URL parameter FIRST
      state.currentPage = pageParam;

      const thumbInitiallyOpen = document
        .getElementById("thumbModal")
        ?.classList.contains("active");
      if (thumbInitiallyOpen) return;

      const slideImages = document.querySelectorAll(".page-grid__slide img");
      const hasPortraitSlides =
        document.querySelectorAll(`.page.${TRUE_PORTRAIT_CLASS}`).length > 0 ||
        Array.from(slideImages).some((img) => {
          const width = img.naturalWidth;
          const height = img.naturalHeight;
          return width > 0 && height > width;
        });
      if (hasPortraitSlides && elements.displayQuickLink && !elements.viewer.classList.contains("continuous")) {
        elements.displayQuickLink.click();
      }

      // Initialize virtual infinite scroll
      const currentFileNum = getCurrentFileInfo().fileNum;

      // Wrap existing pages in file-section if not already wrapped
      const existingPages = elements.viewer?.querySelectorAll(".page");
      if (
        existingPages &&
        existingPages.length > 0 &&
        !elements.viewer.querySelector(".file-section")
      ) {
        const fileContainer = document.createElement("div");
        fileContainer.className = "file-section";
        fileContainer.dataset.fileNum = currentFileNum;

        // Move all existing pages into the container
        Array.from(existingPages).forEach((page) => {
          fileContainer.appendChild(page);
        });

        elements.viewer.appendChild(fileContainer);
      }

      // Mark current file as loaded
      state.loadedFiles.add(currentFileNum);

      const isContinuous = elements.viewer?.classList.contains("continuous");

      // Load adjacent files immediately
      if (isContinuous) {
        // Continuous mode: Load into DOM
        const totalPages = getTotalPages();
        const totalFiles = Math.ceil(totalPages / PAGES_PER_FILE);
        const { bufferSize } = state.viewportWindow;

        const loadPromises = [];

        // Load next files
        for (let i = 1; i <= bufferSize; i++) {
          const nextFile = currentFileNum + i;
          if (nextFile <= totalFiles) {
            loadPromises.push(appendFileContent(nextFile));
          }
        }

        // Load previous files
        for (let i = 1; i <= bufferSize; i++) {
          const prevFile = currentFileNum - i;
          if (prevFile >= 1) {
            loadPromises.push(prependFileContent(prevFile));
          }
        }

        await Promise.all(loadPromises);
        smartPreload();
      } else {
        // Single mode: Preload into cache only (for smooth transitions)
        await smartPreload();
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          centerOnPage(pageParam);
        });
      });
    });
  }

  // ============================================================================
  // SIDEBAR INITIALIZATION
  // ============================================================================

  if (
    elements.sidebar &&
    elements.toggleSidebar &&
    elements.collapsedBtn &&
    elements.footer &&
    elements.snapViewer
  ) {
    // Close sidebar
    elements.toggleSidebar.addEventListener("click", () => {
      elements.sidebar.classList.add("collapsed");
      elements.footer.classList.add("expanded");

      elements.sidebar.style.transition =
        "width 0.3s ease, transform 0.3s ease";
      elements.sidebar.style.transform = "translateX(-100%)";
      elements.sidebar.style.width = "0px";

      elements.snapViewer.style.transition = "margin-left 0.3s ease";
      elements.snapViewer.style.marginLeft = "0";
    });

    // Open sidebar
    elements.collapsedBtn.addEventListener("click", () => {
      elements.sidebar.classList.remove("collapsed");
      elements.footer.classList.remove("expanded");

      elements.sidebar.style.visibility = "hidden";
      elements.sidebar.style.width = "0px";
      elements.sidebar.style.transform = "translateX(-100%)";

      elements.sidebar.offsetHeight; // Force reflow

      elements.sidebar.style.transition =
        "width 0.3s ease, transform 0.3s ease";
      elements.sidebar.style.visibility = "visible";
      elements.sidebar.style.width = "200px";
      elements.sidebar.style.transform = "translateX(0)";

      console.log("sidebar opened");
    });
  }

  bindSidebarResizer();

  // ============================================================================
  // PAGE CONTROLS INITIALIZATION
  // ============================================================================

  const initialPageFromUrl = getCurrentPageFromUrl();

  // Initialize state.currentPage from URL parameter immediately
  state.currentPage = initialPageFromUrl;

  const fileInfo = getCurrentFileInfo();

  if (state.pages.length) {
    setActivePage(initialPageFromUrl);
  }
  syncPageControls(initialPageFromUrl);
  prefetchAdjacentFiles();

  if (elements.currentPageSpan) {
    elements.currentPageSpan.textContent =
      getCurrentPageFromUrl() || state.currentPage;
  }

  if (elements.pageInput && elements.pageDropdown && elements.pageMenu) {
    updatePageMenu();

    // Dropdown toggle
    elements.pageDropdown.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".header-item").forEach((item) => {
        item.classList.remove("active");
        item.querySelector(".header-menu")?.classList.remove("open");
      });
      elements.pageDropdown.classList.toggle("active");
    });

    // Close on outside click
    document.addEventListener("click", (e) => {
      if (!elements.pageDropdown.contains(e.target)) {
        elements.pageDropdown.classList.remove("active");
      }
    });

    // Up button
    document.querySelector(".page-btn.up")?.addEventListener("click", () => {
      const current = getCurrentPageFromUrl() || fileInfo.startPage;
      goToPage(current - 1);
    });

    // Down button
    document.querySelector(".page-btn.down")?.addEventListener("click", () => {
      const current = getCurrentPageFromUrl() || fileInfo.startPage;
      goToPage(current + 1);
    });

    // Enter key navigation - load file if needed
    elements.pageInput?.addEventListener("keypress", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const target = parseInt(elements.pageInput.value, 10);
        const totalPages = getTotalPages();

        if (!isNaN(target) && target >= 1 && target <= totalPages) {
          const targetFileNum = getFileNumFromPage(target);
          const currentFileInfo = getCurrentFileInfo();

          if (targetFileNum !== currentFileInfo.fileNum) {
            // Need to switch file - use replaceFileContent
            await replaceFileContent(targetFileNum, target);
          } else {
            // Same file - just navigate to page
            goToPage(target);
          }
        }
      }
    });
  }

  bindThumbnailClicks();

  // ============================================================================
  // SCROLL & WHEEL HANDLERS
  // ============================================================================

  if (elements.viewer) {
    // Scroll handler for continuous mode
    elements.viewer.addEventListener("scroll", () => {
      if (state.isNavigating || state.isLoadingContent) return;

      // Calculate closest page immediately for responsive UI updates
      const fileInfo = getCurrentFileInfo();
      let closestPage = fileInfo.startPage;
      let closestDist = Infinity;

      state.pages.forEach((page) => {
        const pageNum = parseInt(page.dataset.page || "0", 10);
        if (pageNum === 0) return;

        const rect = page.getBoundingClientRect();
        const dist = Math.abs(
          rect.top +
            rect.height / 2 -
            elements.viewer.getBoundingClientRect().height / 2,
        );

        if (dist < closestDist) {
          closestDist = dist;
          closestPage = pageNum;
        }
      });

      // Update UI immediately without debounce
      updateThumbnailHighlight(closestPage);
      state.currentPage = closestPage;

      if (elements.currentPageSpan) {
        elements.currentPageSpan.textContent = closestPage;
      }

      syncPageControls(state.currentPage);
      updateShareCurrentPage(closestPage);

      // Debounce URL update to prevent throttling
      if (state.urlUpdateTimeout) clearTimeout(state.urlUpdateTimeout);

      state.urlUpdateTimeout = setTimeout(() => {
        const targetFileNum = getFileNumFromPage(state.currentPage);
        const currentUrlFile =
          window.location.pathname.split("/").pop() || "index.html";
        // Handle index.html explicitly, otherwise parse number from filename
        const currentUrlFileNum = currentUrlFile === "index.html" 
          ? 1 
          : parseInt(currentUrlFile.match(/(\d+)\.html/)?.[1] || "1", 10);

        // If page moved to different file, update URL file part and metadata
        if (targetFileNum !== currentUrlFileNum) {
          const targetFilename = targetFileNum === 1 ? "index.html" : `${targetFileNum}.html`;
          const newUrl = new URL(targetFilename, window.location.href);
          newUrl.searchParams.set("page", state.currentPage);
          window.history.replaceState({}, "", newUrl);

          // Update document metadata from cached file content
          const cachedContent = state.fileContentCache.get(targetFileNum);
          if (cachedContent) {
            cachedContent
              .then((content) => {
                updateDocumentMetadata({
                  headTitle: content.headTitle,
                  headMetas: content.headMetas,
                  slideTitleText: content.slideTitleText,
                });
              })
              .catch(() => {
                // Ignore errors, metadata update is not critical
              });
          }
        } else {
          // Same file, just update page param
          const newUrl = new URL(window.location);
          newUrl.searchParams.set("page", state.currentPage);
          window.history.replaceState({}, "", newUrl);
        }
      }, URL_UPDATE_DEBOUNCE_MS);

      // Debounce heavy operations
      if (state.scrollTimeout) clearTimeout(state.scrollTimeout);

      state.scrollTimeout = setTimeout(async () => {
        if (state.isNavigating || state.isLoadingContent) return;

        updateSingleModeNavAvailability();

        // Track scroll direction and position
        const scrollTop = elements.viewer.scrollTop;
        const scrollHeight = elements.viewer.scrollHeight;
        const clientHeight = elements.viewer.clientHeight;
        const scrollBottom = scrollHeight - scrollTop - clientHeight;

        state.isAtBottom =
          scrollBottom <= 5 && state.currentPage >= fileInfo.endPage;

        const currentFileNum = fileInfo.fileNum;
        const totalPages = getTotalPages();
        const totalFiles = Math.ceil(totalPages / PAGES_PER_FILE);

        // Continuous mode: Ensure adjacent files are loaded
        if (elements.viewer.classList.contains("continuous")) {
          const { bufferSize } = state.viewportWindow;

          // Check if we need to load adjacent files
          const loadPromises = [];

          // Load next files if not already loaded
          for (let i = 1; i <= bufferSize; i++) {
            const nextFile = currentFileNum + i;
            if (nextFile <= totalFiles && !state.loadedFiles.has(nextFile)) {
              loadPromises.push(appendFileContent(nextFile));
            }
          }

          // Load previous files if not already loaded
          for (let i = 1; i <= bufferSize; i++) {
            const prevFile = currentFileNum - i;
            if (prevFile >= 1 && !state.loadedFiles.has(prevFile)) {
              loadPromises.push(prependFileContent(prevFile));
            }
          }

          // Execute loads if any
          if (loadPromises.length > 0) {
            await Promise.all(loadPromises);
            smartPreload(); // Preload beyond buffer
            evictOldestCache(); // Clean up old cache
          }

          // Cleanup memory - maintain viewport window
          maintainViewportWindow();
        } else {
          // Legacy behavior for non-continuous mode
          if (scrollBottom < clientHeight * 1.5) {
            const nextFile = fileInfo.fileNum + 1;
            preloadFileContent(nextFile).catch(() => {});
          }
          if (scrollTop < clientHeight * 0.5 && fileInfo.fileNum > 1) {
            const prevFile = fileInfo.fileNum - 1;
            preloadFileContent(prevFile).catch(() => {});
          }
        }
      }, SCROLL_DEBOUNCE_MS); // Increased debounce for better performance
    });

    // Wheel handler for file navigation in continuous mode
    elements.viewer.addEventListener(
      "wheel",
      (event) => {
        if (!elements.viewer.classList.contains("continuous")) return;
        if (state.isNavigating) return;

        const fileInfo = getCurrentFileInfo();
        const totalPages = getTotalPages();
        const scrollTop = elements.viewer.scrollTop;

        // Scroll down at bottom
        if (
          event.deltaY > 0 &&
          state.isAtBottom &&
          state.currentPage >= fileInfo.endPage
        ) {
          const nextFileNum = fileInfo.fileNum + 1;
          const nextStartPage = (nextFileNum - 1) * PAGES_PER_FILE + 1;

          if (nextStartPage <= totalPages) {
            state.isNavigating = true;
            event.preventDefault();
            goToPage(nextStartPage).finally(() => {
              state.isNavigating = false;
            });
          }
          return;
        }

        // Scroll up at top
        if (
          event.deltaY < 0 &&
          scrollTop < 50 &&
          state.currentPage <= fileInfo.startPage
        ) {
          const prevFileNum = fileInfo.fileNum - 1;

          if (prevFileNum >= 1) {
            state.isNavigating = true;
            event.preventDefault();
            const prevEndPage = Math.min(
              prevFileNum * PAGES_PER_FILE,
              totalPages,
            );
            goToPage(prevEndPage).finally(() => {
              state.isNavigating = false;
            });
          }
        }
      },
      { passive: false },
    );

    // Wheel handler for single-page navigation
    const canScrollActivePage = (deltaY) => {
      const activePage = elements.viewer.querySelector(".page.active");
      if (!activePage) return false;

      if (deltaY > 0) {
        return (
          activePage.scrollTop + activePage.clientHeight <
          activePage.scrollHeight - 1
        );
      }
      return activePage.scrollTop > 0;
    };

    const handleViewerWheel = (event) => {
      if (elements.viewer.classList.contains("continuous")) return;
      if (canScrollActivePage(event.deltaY)) return;

      const hasExpandedOcr = !!document.querySelector(
        "#viewer:not(.continuous) .ocr-container.open",
      );
      const minDelta = hasExpandedOcr
        ? WHEEL_CONFIG.EXPANDED_MIN_DELTA
        : WHEEL_CONFIG.BASE_MIN_DELTA;
      const cooldown = hasExpandedOcr
        ? WHEEL_CONFIG.EXPANDED_COOLDOWN
        : WHEEL_CONFIG.BASE_COOLDOWN;

      if (Math.abs(event.deltaY) < minDelta) return;
      if (state.wheelLocked) return;

      event.preventDefault();

      let totalPages = getTotalPages();
      const allPages = document.querySelectorAll(".page[data-page]");
      if (allPages.length > 0) {
        const pageNumbers = Array.from(allPages).map((page) =>
          parseInt(page.dataset.page || "0", 10),
        );
        const maxPageNum = Math.max(...pageNumbers);
        if (maxPageNum > totalPages) {
          totalPages = maxPageNum;
        }
      }

      const direction = event.deltaY > 0 ? 1 : -1;
      const current = getCurrentPageFromUrl() || 1;
      const nextPage = current + direction;

      if (nextPage > totalPages) return;

      goToPage(nextPage);
      state.wheelLocked = true;
      setTimeout(() => {
        state.wheelLocked = false;
      }, cooldown);
    };

    elements.viewer.addEventListener("wheel", handleViewerWheel, {
      passive: false,
    });

    // Touch swipe handler for single-page navigation on mobile
    let touchStartY = 0;
    let touchStartX = 0;
    let touchStartTime = 0;
    const SWIPE_THRESHOLD = 50; // Minimum distance for swipe
    const SWIPE_TIME_LIMIT = 500; // Maximum time for swipe (ms)
    const SWIPE_VELOCITY_THRESHOLD = 0.3; // Minimum velocity (px/ms)

    const canSwipeActivePage = (deltaY) => {
      const activePage = elements.viewer.querySelector(".page.active");
      if (!activePage) return false;

      if (deltaY > 0) {
        // Swiping up (scrolling down)
        return (
          activePage.scrollTop + activePage.clientHeight <
          activePage.scrollHeight - 1
        );
      }
      // Swiping down (scrolling up)
      return activePage.scrollTop > 0;
    };

    elements.viewer.addEventListener(
      "touchstart",
      (event) => {
        if (elements.viewer.classList.contains("continuous")) return;

        touchStartY = event.touches[0].clientY;
        touchStartX = event.touches[0].clientX;
        touchStartTime = Date.now();
      },
      { passive: true },
    );

    elements.viewer.addEventListener(
      "touchmove",
      (event) => {
        if (elements.viewer.classList.contains("continuous")) return;

        const touchCurrentY = event.touches[0].clientY;
        const deltaY = touchStartY - touchCurrentY;

        // Check if active page can scroll in the swipe direction
        if (canSwipeActivePage(deltaY)) {
          return; // Let the page scroll naturally
        }
      },
      { passive: true },
    );

    elements.viewer.addEventListener(
      "touchend",
      (event) => {
        if (elements.viewer.classList.contains("continuous")) return;

        const touchEndY = event.changedTouches[0].clientY;
        const touchEndX = event.changedTouches[0].clientX;
        const touchEndTime = Date.now();

        const deltaY = touchStartY - touchEndY;
        const deltaX = touchStartX - touchEndX;
        const deltaTime = touchEndTime - touchStartTime;

        // Check if this is primarily a vertical swipe (not horizontal)
        if (Math.abs(deltaX) > Math.abs(deltaY)) return;

        // Check if active page can scroll in the swipe direction
        if (canSwipeActivePage(deltaY)) return;

        const velocity = Math.abs(deltaY) / deltaTime;

        // Validate swipe criteria
        if (
          Math.abs(deltaY) >= SWIPE_THRESHOLD &&
          deltaTime <= SWIPE_TIME_LIMIT &&
          velocity >= SWIPE_VELOCITY_THRESHOLD
        ) {
          if (state.wheelLocked) return;

          const direction = deltaY > 0 ? 1 : -1; // Swipe up = next, swipe down = prev
          const current = getCurrentPageFromUrl() || 1;
          const totalPages = getTotalPages();
          const nextPage = current + direction;

          if (nextPage < 1 || nextPage > totalPages) return;

          goToPage(nextPage);
          state.wheelLocked = true;
          setTimeout(() => {
            state.wheelLocked = false;
          }, WHEEL_CONFIG.BASE_COOLDOWN);
        }
      },
      { passive: true },
    );
  }

  // Keyboard navigation
  document.addEventListener("keydown", (event) => {
    if (elements.viewer.classList.contains("continuous")) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (isInteractiveElement(event.target)) return;

    event.preventDefault();

    const direction = event.key === "ArrowDown" ? 1 : -1;
    const current = getCurrentPageFromUrl() || 1;
    goToPage(current + direction);
  });

  // Popstate handler for browser back/forward
  window.addEventListener("popstate", async () => {
    const pageFromUrl = getCurrentPageFromUrl() || 1;
    const targetFileNum = getFileNumFromPage(pageFromUrl);
    const currentUrlFile =
      window.location.pathname.split("/").pop() || "index.html";
    // Handle index.html explicitly, otherwise parse number from filename
    const currentUrlFileNum = currentUrlFile === "index.html" 
      ? 1 
      : parseInt(currentUrlFile.match(/(\d+)\.html/)?.[1] || "1", 10);

    // If URL changed to different file, need to navigate
    if (targetFileNum !== currentUrlFileNum) {
      // Let browser handle the navigation (page will reload)
      return;
    }

    // Same file: just scroll to the page
    syncPageControls(pageFromUrl);

    if (elements.viewer?.classList.contains("continuous")) {
      // In continuous mode, ensure the file is loaded and scroll to it
      if (!state.loadedFiles.has(targetFileNum)) {
        // File not loaded yet, load it first
        await appendFileContent(targetFileNum);
      }
      centerOnPage(pageFromUrl);
    } else {
      // Single mode
      goToPage(pageFromUrl);
    }
  });

  updateSingleModeNavAvailability();

  // ============================================================================
  // DISPLAY MODE TOGGLE
  // ============================================================================

  if (elements.displayQuickLink && elements.viewer) {
    const savedMode = sessionStorage.getItem("viewerMode");
    const shouldBeContinuous = savedMode === "continuous";

    const modeIcon = elements.displayQuickLink?.querySelector("img");
    const label = elements.displayQuickLink
      .closest(".footer-mode")
      ?.querySelector(".footer-label");

    // Apply saved mode
    if (shouldBeContinuous) {
      elements.viewer.classList.add("continuous");
      if (label) label.textContent = "1枚ずつ表示";
      if (modeIcon) modeIcon.src = "assets/consec_icon.svg";

      const pages = elements.viewer.querySelectorAll(".page");
      pages.forEach((page, index) => {
        page.style.marginTop = "10px";
        page.style.marginBottom = index === pages.length - 1 ? "100px" : "10px";
      });

      removeChevrons();
    } else {
      elements.viewer.classList.remove("continuous");
      if (label) label.textContent = "連続表示";
      if (modeIcon) modeIcon.src = "assets/pageview_icon.svg";

      const pages = elements.viewer.querySelectorAll(".page");
      pages.forEach((page) => {
        page.style.marginTop = "";
        page.style.marginBottom = "";
      });

      setTimeout(() => attachSlideChevrons(), CHEVRON_ATTACH_DELAY);
    }

    // Sync header display options checkmarks with applied mode
    const headerDisplayOptions = document.querySelectorAll(".display-option");
    if (headerDisplayOptions.length) {
      headerDisplayOptions.forEach((opt) => {
        const mode = opt.dataset.mode;
        const shouldCheck =
          (shouldBeContinuous && mode === "continuous") ||
          (!shouldBeContinuous && mode === "single");
        opt.querySelector(".checkmark").textContent = shouldCheck ? "✔︎" : "";
      });
    }

    const MODE_TOGGLE_TOOLTIP_TEXT = "スライドを 連続表示 ⇔ 1枚ずつ表示";
    elements.displayQuickLink.setAttribute(
      "data-tooltip",
      MODE_TOGGLE_TOOLTIP_TEXT,
    );

    // Tooltip event listeners
    elements.displayQuickLink.addEventListener("mouseenter", () =>
      showFooterTooltip(elements.displayQuickLink),
    );
    elements.displayQuickLink.addEventListener("mousemove", () =>
      positionFooterTooltip(elements.displayQuickLink),
    );
    elements.displayQuickLink.addEventListener("focus", () =>
      showFooterTooltip(elements.displayQuickLink),
    );
    elements.displayQuickLink.addEventListener("mouseleave", hideFooterTooltip);
    elements.displayQuickLink.addEventListener("blur", hideFooterTooltip);
    window.addEventListener("scroll", hideFooterTooltip, { passive: true });

    updateMobileDisplayToggle();
    updateSingleModeNavAvailability();

    // Click to toggle mode
    elements.displayQuickLink.addEventListener("click", async () => {
      const isContinuous = elements.viewer.classList.toggle("continuous");
      const pages = elements.viewer.querySelectorAll(".page");

      if (isContinuous) {
        removeChevrons();
        if (modeIcon) modeIcon.src = "assets/consec_icon.svg";
        if (label) label.textContent = "1枚ずつ表示";

        pages.forEach((page, index) => {
          page.style.marginTop = "10px";
          page.style.marginBottom =
            index === pages.length - 1 ? "100px" : "10px";
        });

        const targetEl = elements.viewer.querySelector(
          `.page[data-page="${state.currentPage}"]`,
        );
        if (targetEl) {
          const offset = Math.max(
            0,
            targetEl.offsetTop - targetEl.offsetHeight * 0.1,
          );
          elements.viewer.scrollTo({ top: offset, behavior: "auto" });
        }

        // Load adjacent files immediately when switching to continuous mode
        const currentFileNum = getCurrentFileInfo().fileNum;
        const totalPages = getTotalPages();
        const totalFiles = Math.ceil(totalPages / PAGES_PER_FILE);
        const { bufferSize } = state.viewportWindow;

        const loadPromises = [];

        // Load next files
        for (let i = 1; i <= bufferSize; i++) {
          const nextFile = currentFileNum + i;
          if (nextFile <= totalFiles && !state.loadedFiles.has(nextFile)) {
            loadPromises.push(appendFileContent(nextFile));
          }
        }

        // Load previous files
        for (let i = 1; i <= bufferSize; i++) {
          const prevFile = currentFileNum - i;
          if (prevFile >= 1 && !state.loadedFiles.has(prevFile)) {
            loadPromises.push(prependFileContent(prevFile));
          }
        }

        // Wait for all loads
        if (loadPromises.length > 0) {
          await Promise.all(loadPromises);
          smartPreload();
        }
      } else {
        // Switching to single mode: cleanup extra file sections
        const currentFileNum = getCurrentFileInfo().fileNum;
        const allFileSections =
          elements.viewer.querySelectorAll(".file-section");

        // Keep only current file, remove others
        allFileSections.forEach((section) => {
          const sectionFileNum = parseInt(section.dataset.fileNum, 10);
          if (sectionFileNum !== currentFileNum) {
            unloadFileContent(sectionFileNum);
          }
        });

        setTimeout(() => attachSlideChevrons(), CHEVRON_ATTACH_DELAY);
        if (modeIcon) modeIcon.src = "assets/pageview_icon.svg";
        if (label) label.textContent = "連続表示";

        pages.forEach((page) => {
          page.style.marginTop = "";
          page.style.marginBottom = "";
        });

        goToPage(state.currentPage);

        setTimeout(() => adjustPageMargins?.(), NAVIGATION_SETTLE_DELAY);
        elements.viewer.style.width = "100%";
      }

      sessionStorage.setItem(
        "viewerMode",
        isContinuous ? "continuous" : "single",
      );

      elements.displayQuickLink.setAttribute(
        "data-tooltip",
        MODE_TOGGLE_TOOLTIP_TEXT,
      );
      updateMobileDisplayToggle();
      updateSingleModeNavAvailability();
    });
  }

  // ============================================================================
  // SLIDE TITLE CLICK HANDLER
  // ============================================================================

  document.querySelectorAll(".slide-title").forEach((title) => {
    title.addEventListener("click", () => {
      closeAllModals();
      const url = new URL("index.html", window.location.href);
      url.searchParams.set("page", "1");
      window.location.replace(url.toString());
    });
  });

  // ============================================================================
  // MOBILE MENU INITIALIZATION
  // ============================================================================

  const desktopSlideTitle = document.querySelector(
    ".header-desktop .slide-title",
  );
  const mobileSlideTitle = document.querySelector(
    ".header-mobile .mobile-slide-title",
  );

  if (desktopSlideTitle && mobileSlideTitle) {
    mobileSlideTitle.textContent = desktopSlideTitle.textContent;
  }

  const userAgentIsMobile = isMobileUserAgent();
  if (elements.bodyEl) {
    elements.bodyEl.classList.add(
      userAgentIsMobile ? "ua-mobile" : "ua-desktop",
    );
  }

  const MIN_SCALE = 0.9;
  const MAX_SCALE = 3.8;
  let currentScale = 1;

  const clampScale = (value) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
  const applyZoomScale = (value) => {
    if (!elements.zoomWrapper || !elements.zoomRoot || !elements.zoomContent) return;
    const nextScale = clampScale(value);
    currentScale = nextScale;
    elements.zoomRoot.style.width = `${nextScale * 100}%`;
    elements.zoomRoot.style.height = `${nextScale * 100}%`;
    elements.zoomContent.style.width = `${100 / nextScale}%`;
    elements.zoomContent.style.height = `${100 / nextScale}%`;
    elements.zoomContent.style.transform = `scale(${nextScale})`;
  };

  if (elements.zoomWrapper && elements.zoomRoot && elements.zoomContent) {
    applyZoomScale(1);

    let pinchActive = false;
    let pinchStartDistance = 0;
    let pinchStartScale = 1;

    const getTouchDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    elements.zoomWrapper.addEventListener(
      "touchstart",
      (event) => {
        if (event.touches.length !== 2) return;
        pinchActive = true;
        pinchStartDistance = getTouchDistance(event.touches);
        pinchStartScale = currentScale;
        event.preventDefault();
      },
      { passive: false }
    );

    elements.zoomWrapper.addEventListener(
      "touchmove",
      (event) => {
        if (!pinchActive || event.touches.length !== 2) return;
        if (!pinchStartDistance) return;
        const distance = getTouchDistance(event.touches);
        const nextScale = pinchStartScale * (distance / pinchStartDistance);
        applyZoomScale(nextScale);
        event.preventDefault();
      },
      { passive: false }
    );

    const endPinch = (event) => {
      if (event.touches.length >= 2) return;
      pinchActive = false;
      pinchStartDistance = 0;
      pinchStartScale = currentScale;
    };

    elements.zoomWrapper.addEventListener("touchend", endPinch, { passive: true });
    elements.zoomWrapper.addEventListener("touchcancel", endPinch, { passive: true });
  }

  // Orientation handling
  const orientationMedia = window.matchMedia("(orientation: landscape)");
  const applyOrientationClass = () => {
    if (!elements.bodyEl) return;
    elements.bodyEl.classList.toggle("ua-landscape", orientationMedia.matches);
  };
  applyOrientationClass();

  if (typeof orientationMedia.addEventListener === "function") {
    orientationMedia.addEventListener("change", applyOrientationClass);
  } else if (typeof orientationMedia.addListener === "function") {
    orientationMedia.addListener(applyOrientationClass);
  }

  updatePageSideGap();
  window.addEventListener("resize", updatePageSideGap);

  applyMenuTogglePosition();

  elements.mobileToggle?.addEventListener("click", () => {
    const nextState = !elements.mobileMenu?.classList.contains("open");
    setMobileMenuState(nextState);
  });

  elements.mobileOverlay?.addEventListener("click", closeMobileMenu);

  document.querySelectorAll(".mobile-submenu-toggle").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const parent = toggle.closest(".mobile-submenu");
      if (!parent) return;
      const isOpen = parent.classList.toggle("open");
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
  });

  // Mobile actions
  const mobileActions = {
    home: () => {
      goToPage(1);
    },
    thumbnail: () => {
      navigateToFileWithParams("thumbnail.html");
    },
    search: () => openMobileModal(elements.mobileSearchModal),
    download: () => elements.downloadBtn?.click(),
    share: () => openMobileModal(elements.mobileShareModal),
    toc: () => {
      navigateToFileWithParams("contents.html");
    },
    "display-mode": () => elements.displayQuickLink?.click(),
    help: () => elements.helpBtn?.click(),
  };

  document.querySelectorAll("[data-mobile-action]").forEach((el) => {
    el.addEventListener("click", (event) => {
      const action = el.dataset.mobileAction;
      if (!action) return;
      event.preventDefault();
      closeMobileMenu();
      mobileActions[action]?.();
    });
  });

  elements.mobileSearchModal
    ?.querySelector(".modal-close")
    ?.addEventListener("click", () => {
      elements.mobileSearchModal.classList.remove("active");
      clearSearchHighlight();
    });

  elements.mobileShareModal
    ?.querySelector(".modal-close")
    ?.addEventListener("click", () => {
      elements.mobileShareModal.classList.remove("active");
    });

  [elements.mobileSearchModal, elements.mobileShareModal].forEach((modal) => {
    modal?.addEventListener("click", (event) => {
      if (event.target === modal) {
        modal.classList.remove("active");
        if (modal === elements.mobileSearchModal) clearSearchHighlight();
      }
    });
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) {
      closeMobileMenu();
    }
    applyMenuTogglePosition();

    // Resize active modals
    if (elements.helpModal?.classList.contains("active")) {
      adjustModalSize(elements.helpModal);
    }
    if (elements.searchModal?.classList.contains("active")) {
      adjustModalSize(elements.searchModal);
    }
  });

  // ============================================================================
  // HELP MODAL
  // ============================================================================

  const helpClose = elements.helpModal?.querySelector(".modal-close");

  elements.helpBtn?.addEventListener("click", () => {
    closeAllModals(true); // Pass true to prevent restoring share visibility
    if (!elements.helpModal) return;
    adjustModalSize(elements.helpModal);
    elements.helpModal.classList.add("active");
    toggleShareCurrentPageVisibility(false);
    setHelpViewState(true);
  });

  helpClose?.addEventListener("click", closeHelpModalView);

  elements.helpModal?.addEventListener("click", (event) => {
    if (event.target === elements.helpModal) {
      closeHelpModalView();
    }
  });

  // ============================================================================
  // NAV ZONES
  // ============================================================================

  bindNavZoneClicks();

  // ============================================================================
  // HEADER MENU
  // ============================================================================

  const headerItems = document.querySelectorAll(".header-item");
  const searchHeaderItem = document.querySelector(
    '.header-item[data-menu="search"]',
  );
  const searchHeaderMenu = searchHeaderItem?.querySelector(".header-menu");
  const defaultSearchMenuOffset = 10;

  const clampSearchMenuWithinViewport = () => {
    if (!searchHeaderItem || !searchHeaderMenu) return;

    if (
      !searchHeaderItem.classList.contains("active") ||
      !searchHeaderMenu.classList.contains("open")
    ) {
      searchHeaderMenu.style.removeProperty("--header-menu-offset");
      return;
    }

    const viewportPadding = 12;
    let offset = defaultSearchMenuOffset;

    searchHeaderMenu.style.setProperty(
      "--header-menu-offset",
      `${defaultSearchMenuOffset}px`,
    );

    const rect = searchHeaderMenu.getBoundingClientRect();
    const overflowRight = rect.right - (window.innerWidth - viewportPadding);
    const overflowLeft = viewportPadding - rect.left;

    if (overflowRight > 0) {
      offset -= overflowRight;
    }

    if (overflowLeft > 0) {
      offset += overflowLeft;
    }

    searchHeaderMenu.style.setProperty("--header-menu-offset", `${offset}px`);
  };

  window.addEventListener("resize", clampSearchMenuWithinViewport);

  ["click", "mousedown"].forEach((eventName) => {
    searchHeaderMenu?.addEventListener(eventName, (event) => {
      event.stopPropagation();
    });
  });

  if (headerItems.length) {
    headerItems.forEach((item) => {
      const menu = item.querySelector(".header-menu");

      item.addEventListener("click", (e) => {
        e.stopPropagation();

        // Close other menus
        headerItems.forEach((other) => {
          if (other !== item) {
            other.classList.remove("active");
            other.querySelector(".header-menu")?.classList.remove("open");
          }
        });

        // Toggle current menu
        item.classList.toggle("active");
        menu?.classList.toggle("open");
      });
    });

    // Close on outside click
    document.addEventListener("click", (e) => {
      if (e.target.closest(".header-menu")) {
        return;
      }
      headerItems.forEach((item) => {
        item.classList.remove("active");
        item.querySelector(".header-menu")?.classList.remove("open");
      });
    });
  }

  // ============================================================================
  // HEADER DISPLAY OPTIONS
  // ============================================================================

  const headerDisplayOptions = document.querySelectorAll(".display-option");
  const displayHeaderItem = document.querySelector(
    '.header-item[data-menu="display"]',
  );

  const closeDisplayMenu = () => {
    displayHeaderItem?.classList.remove("active");
    displayHeaderItem?.querySelector(".header-menu")?.classList.remove("open");
  };

  if (
    headerDisplayOptions.length &&
    elements.viewer &&
    elements.displayQuickLink
  ) {
    headerDisplayOptions.forEach((opt) => {
      opt.addEventListener("click", (event) => {
        event.stopPropagation();
        const mode = opt.dataset.mode;
        const isThumbOpen = elements.bodyEl?.classList.contains("thumb-open");

        if (isThumbOpen && (mode === "continuous" || mode === "single")) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        // Reset checkmarks
        headerDisplayOptions.forEach(
          (o) => (o.querySelector(".checkmark").textContent = ""),
        );
        opt.querySelector(".checkmark").textContent = "✔︎";

        if (mode === "continuous") {
          if (!elements.viewer.classList.contains("continuous")) {
            elements.displayQuickLink.click();
          }
        }

        if (mode === "single") {
          if (elements.viewer.classList.contains("continuous")) {
            elements.displayQuickLink.click();
          }

          setTimeout(() => adjustPageMargins?.(), NAVIGATION_SETTLE_DELAY);

          const thumbModal = document.getElementById("thumbModal");
          const sidebarEl = document.getElementById("sidebar");
          const footerEl = document.querySelector(".footer");
          if (thumbModal?.classList.contains("active")) {
            thumbModal.classList.remove("active");
            sidebarEl?.classList.remove("collapsed");
            footerEl?.classList.remove("expanded");
          }
        }

        closeDisplayMenu();
      });
    });

    // Sync header checkmarks when footer toggle is clicked
    elements.displayQuickLink.addEventListener("click", () => {
      const isContinuous = elements.viewer.classList.contains("continuous");
      headerDisplayOptions.forEach((opt) => {
        const mode = opt.dataset.mode;
        opt.querySelector(".checkmark").textContent =
          (isContinuous && mode === "continuous") ||
          (!isContinuous && mode === "single")
            ? "✔︎"
            : "";
      });
    });
  }

  // ============================================================================
  // SEARCH EVENT HANDLERS
  // ============================================================================

  document.querySelectorAll(".search-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const container =
        btn.closest(".header-menu") ||
        btn.closest(".mobile-search-group") ||
        document;
      const input = container.querySelector(".search-input");
      const value = input?.value || "";
      closeHeaderSearchMenu();
      runSearch(value);
    });
  });

  document.querySelectorAll(".search-input").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        closeHeaderSearchMenu();
        runSearch(input.value || "");
      }
    });
  });

  elements.searchModal
    ?.querySelector(".modal-close")
    ?.addEventListener("click", () => {
      elements.searchModal.classList.remove("active");
      clearSearchHighlight();
    });

  elements.searchModal?.addEventListener("click", (event) => {
    if (event.target === elements.searchModal) {
      elements.searchModal.classList.remove("active");
      clearSearchHighlight();
    }
  });

  // ============================================================================
  // ESC KEY HANDLER
  // ============================================================================

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    if (document.getElementById("mobileMenu")?.classList.contains("open")) {
      closeMobileMenu();
      return;
    }

    const mobileSearchModalEl = document.getElementById("mobileSearchModal");
    if (mobileSearchModalEl?.classList.contains("active")) {
      mobileSearchModalEl.classList.remove("active");
      clearSearchHighlight();
      return;
    }

    const mobileShareModalEl = document.getElementById("mobileShareModal");
    if (mobileShareModalEl?.classList.contains("active")) {
      mobileShareModalEl.classList.remove("active");
      return;
    }

    const searchResultsModalEl = document.getElementById("searchResultsModal");
    if (searchResultsModalEl?.classList.contains("active")) {
      searchResultsModalEl.classList.remove("active");
      clearSearchHighlight();
      return;
    }

    if (document.getElementById("thumbModal")?.classList.contains("active")) {
      const thumbModalInstance = document.getElementById("thumbModal");
      thumbModalInstance?.classList.remove("active");
      const sidebarEl = document.getElementById("sidebar");
      sidebarEl?.classList.remove("collapsed");
      const footer = document.querySelector(".footer");
      footer?.classList.remove("expanded");
      const url = new URL(window.location);
      url.searchParams.delete("thumb");
      window.history.replaceState({}, "", url);
      setTimeout(() => {
        const fileInfo = getCurrentFileInfo();
        const current =
          parseInt(elements.pageInput?.value, 10) || fileInfo.startPage;

        if (current < fileInfo.startPage || current > fileInfo.endPage) {
          goToPage(current);
          return;
        }

        if (!elements.viewer.classList.contains("continuous")) {
          goToPage(current);
          return;
        }

        const el = elements.viewer.querySelector(
          `.page[data-page="${current}"]`,
        );
        if (!el) return;
        const top = getScrollTopForPage(el);
        elements.viewer.scrollTo({ top, behavior: "auto" });
      }, 0);
      return;
    }
  });

  // ============================================================================
  // PDF DOWNLOAD
  // ============================================================================

  if (elements.downloadBtn) {
    const pdfUrl = document.body.dataset.pdfUrl;

    if (!pdfUrl) {
      elements.downloadBtn.style.display = "none";
      const mobileDownloadBtn = document.querySelector(
        '[data-mobile-action="download"]',
      );
      if (mobileDownloadBtn) {
        mobileDownloadBtn.closest("li").style.display = "none";
      }
    } else {
      elements.downloadBtn.addEventListener("click", async () => {
        try {
          const response = await fetch(pdfUrl);
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);

          const link = document.createElement("a");
          link.href = blobUrl;
          link.download = pdfUrl.split("/").pop() || "document.pdf";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          URL.revokeObjectURL(blobUrl);
        } catch (error) {
          console.error("Download failed:", error);
          window.open(pdfUrl, "_blank");
        }
      });
    }
  }

  // ============================================================================
  // SHARE FUNCTIONALITY
  // ============================================================================

  const copyLinkButtons = document.querySelectorAll(".share-link");

  copyLinkButtons.forEach((button) => {
    button.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const shareSection = button.closest(".share-section");
      const isFullSlide = shareSection
        ?.querySelector("h4")
        ?.textContent.includes("全体");

      let urlToCopy;
      if (isFullSlide) {
        const url = new URL("index.html", window.location.href);
        url.searchParams.set("page", "1");
        urlToCopy = url.toString();
      } else {
        const currentPageNum = getCurrentPageFromUrl() || 1;
        const targetFileNum = getFileNumFromPage(currentPageNum);
        const targetFilename = targetFileNum === 1 ? "index.html" : `${targetFileNum}.html`;
        const url = new URL(targetFilename, window.location.href);
        url.searchParams.set("page", currentPageNum);
        urlToCopy = url.toString();
      }

      try {
        await navigator.clipboard.writeText(urlToCopy);
        showToast("リンクをコピーしました");
      } catch (err) {
        console.error("Failed to copy link:", err);
        fallbackCopyToClipboard(urlToCopy);
      }
    });
  });

  // Facebook & X share icons (capture phase)
  document.addEventListener(
    "click",
    (e) => {
      let shareText = "";

      const fbIcon = e.target.closest(
        'img[src*="fb_icon"], img[alt="Facebook"]',
      );

      if (
        fbIcon &&
        (fbIcon.closest(".header-menu") || fbIcon.closest(".modal"))
      ) {
        e.preventDefault();
        e.stopPropagation();

        const shareSection = fbIcon.closest(".share-section");
        const isFullSlide = shareSection
          ?.querySelector("h4")
          ?.textContent.includes("全体");

        const shareUrl = createShareUrl(isFullSlide);

        const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
          shareUrl,
        )}`;
        shareText = facebookUrl;
      }

      const xIcon = e.target.closest('img[src*="x_icon"], img[alt="X"]');
      if (xIcon && (xIcon.closest(".header-menu") || xIcon.closest(".modal"))) {
        e.preventDefault();
        e.stopPropagation();

        const shareSection = xIcon.closest(".share-section");
        const isFullSlide = shareSection
          ?.querySelector("h4")
          ?.textContent.includes("全体");

        const shareUrl = createShareUrl(isFullSlide);
        const slideTitle = getSlideTitle();
        const currentPage = getCurrentPageFromUrl() || 1;
        const totalPages = getTotalPages();

        shareText = createTwitterShareText(
          shareUrl,
          isFullSlide,
          slideTitle,
          currentPage,
          totalPages,
        );
      }

      if (!shareText) return;

      window.open(shareText, "_blank", "noopener,noreferrer");
    },
    true,
  );

  // ============================================================================
  // HTML LINK HANDLER (preserve query params)
  // ============================================================================

  document.addEventListener("click", (e) => {
    const link = e.target.closest("a[href]");
    if (!link) return;

    const href = link.getAttribute("href");
    if (href && href.endsWith(".html") && !href.includes("?")) {
      e.preventDefault();
      navigateToFileWithParams(href);
    }
  });

  // ============================================================================
  // CHEVRONS ON LOAD
  // ============================================================================

  window.addEventListener("load", () => {
    setTimeout(attachSlideChevrons, CHEVRON_ATTACH_DELAY);
  });
});
