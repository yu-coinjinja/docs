/**
 * Contents Page Script - Refactored
 * Handles table of contents functionality, navigation, search, and sharing
 */

document.addEventListener("DOMContentLoaded", () => {
  // ============================================================================
  // CONSTANTS
  // ============================================================================

  const PAGES_PER_FILE = 10;
  const SEARCH_SNIPPET_LENGTH = 140;
  const SNIPPET_CONTEXT = { before: 40, after: 100 };
  const DEFAULT_SIDEBAR_WIDTH = 200;
  const MIN_SIDEBAR_WIDTH = 150;
  const MAX_SIDEBAR_WIDTH = 600;
  const TWEET_MAX_LENGTH = 280;
  const MOBILE_BREAKPOINT = 768;

  // ============================================================================
  // DOM ELEMENT REFERENCES
  // ============================================================================

  const elements = {
    // Sidebar
    sidebar: document.getElementById("sidebar"),
    sidebarToggleBtn: document.getElementById("toggleSidebar"),
    sidebarCollapsedBtn: document.getElementById("sidebarCollapsedBtn"),
    sidebarResizer: document.querySelector(".sidebar-resizer"),

    // Layout
    snapViewer: document.querySelector(".snap-viewer"),
    footer: document.querySelector(".footer"),

    // Modals
    searchModal: document.getElementById("searchResultsModal"),
    helpModal: document.getElementById("helpModal"),
    mobileSearchModal: document.getElementById("mobileSearchModal"),
    mobileShareModal: document.getElementById("mobileShareModal"),

    // Search
    searchResultsList: null, // Will be queried from searchModal
    searchEmptyMessage: null,
    searchSummary: null,

    // Page controls
    pageInput: document.querySelector(".page-input"),
    pageSelect: document.querySelector(".page-select"),
    pageDropdown: document.querySelector(".page-dropdown"),
    pageMenu: document.querySelector(".page-menu"),
    currentPageSpan: document.querySelector(".current-page"),

    // Mobile menu
    mobileMenu: document.getElementById("mobileMenu"),
    mobileOverlay: document.getElementById("mobileMenuOverlay"),
    mobileToggle: document.querySelector(".mobile-menu-toggle"),

    // Header
    headerItems: document.querySelectorAll(".header-item"),
    searchHeaderItem: document.querySelector(
      '.header-item[data-menu="search"]',
    ),
    searchHeaderMenu: null, // Will be queried from searchHeaderItem

    // Footer buttons
    downloadBtn: document.querySelector(".footer-toc-btn.download"),
    helpBtn: document.querySelector(".footer-toc-btn.help"),
    tocBtn: document.querySelector('.footer-toc-btn[data-footer-action="toc"]'),
  };

  // Initialize nested element references
  if (elements.searchModal) {
    elements.searchResultsList = elements.searchModal.querySelector(
      ".search-results-list",
    );
    elements.searchEmptyMessage = elements.searchModal.querySelector(
      ".search-results-empty",
    );
    elements.searchSummary = elements.searchModal.querySelector(
      ".search-modal-summary",
    );
  }

  if (elements.searchHeaderItem) {
    elements.searchHeaderMenu =
      elements.searchHeaderItem.querySelector(".header-menu");
  }

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  const state = {
    thumbnails: document.querySelectorAll(".thumbnail"),
    defaultSearchSummaryText:
      elements.searchSummary?.textContent ||
      "キーワードに一致したスライドを表示しています。",
    defaultSearchMenuOffset: 10,
  };

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  /**
   * Get current page number from URL parameters
   * @returns {number} Page number from URL
   */
  const getCurrentPageFromUrl = () => {
    const params = new URLSearchParams(location.search);
    return parseInt(params.get("page") || "1", 10);
  };

  /**
   * Get file number from page number
   * @param {number} pageNum - Page number
   * @returns {number} File number
   */
  const getFileNumFromPage = (pageNum) => Math.ceil(pageNum / PAGES_PER_FILE);

  /**
   * Get total pages from thumbnails or TOC
   * @returns {number} Total number of pages
   */
  const getTotalPages = () => {
    const thumbnails = document.querySelectorAll(".thumbnail");
    if (thumbnails.length > 0) {
      const lastThumb = Array.from(thumbnails).pop();
      return parseInt(lastThumb?.dataset.page || "1", 10);
    }

    const tocItems = document.querySelectorAll(".contents-list p.index-h");
    if (tocItems.length > 0) {
      return tocItems.length;
    }

    return 1;
  };

  /**
   * Navigate to a specific page
   * @param {number} pageNum - Target page number
   */
  const navigateToPage = (pageNum) => {
    const fileNum = getFileNumFromPage(pageNum);
    const filename = fileNum === 1 ? "index.html" : `${fileNum}.html`;
    window.location.href = `${filename}?page=${pageNum}`;
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

  /**
   * Get slide title from DOM
   * @returns {string} Slide title
   */
  const getSlideTitle = () => {
    const slideTitleEl = document.querySelector(".slide-title");
    return slideTitleEl?.textContent?.trim() || "";
  };

  // ============================================================================
  // PAGE CONTROLS
  // ============================================================================

  /**
   * Sync page number across all controls
   * @param {number} value - Page number
   */
  const syncPageControls = (value) => {
    const strValue = String(value);
    if (elements.pageSelect) {
      elements.pageSelect.value = strValue;
    }
    if (elements.pageInput) {
      elements.pageInput.value = strValue;
    }
    if (elements.currentPageSpan) {
      elements.currentPageSpan.textContent = strValue;
    }
  };

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
        navigateToPage(targetPage);
        elements.pageDropdown?.classList.remove("active");
      });
      elements.pageMenu.appendChild(option);
    }
  };

  // ============================================================================
  // SIDEBAR MANAGEMENT
  // ============================================================================

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

  /**
   * Update thumbnail highlight and center in sidebar
   * @param {number} pageNum - Page number to highlight
   * @param {boolean} smoothScroll - Use smooth scrolling
   */
  const updateThumbnailHighlight = (pageNum, smoothScroll = true) => {
    if (!state.thumbnails.length) return;

    state.thumbnails.forEach((thumb) => {
      const thumbPageNum = parseInt(thumb.dataset.page || "0", 10);
      thumb.classList.toggle("active", thumbPageNum === pageNum);
    });

    centerThumbnailInSidebar(pageNum, smoothScroll);
  };

  /**
   * Collapse sidebar with animation
   */
  const collapseSidebar = () => {
    if (!elements.sidebar) return;

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

  /**
   * Expand sidebar with animation
   */
  const expandSidebar = () => {
    if (!elements.sidebar) return;

    elements.sidebar.classList.remove("collapsed");
    elements.footer?.classList.remove("expanded");

    elements.sidebar.style.visibility = "hidden";
    elements.sidebar.style.width = "0px";
    elements.sidebar.style.transform = "translateX(-100%)";

    // Force reflow
    elements.sidebar.offsetHeight;

    elements.sidebar.style.transition = "width 0.3s ease, transform 0.3s ease";
    elements.sidebar.style.visibility = "visible";
    elements.sidebar.style.width = `${DEFAULT_SIDEBAR_WIDTH}px`;
    elements.sidebar.style.transform = "translateX(0)";
  };

  /**
   * Initialize sidebar resizer functionality
   */
  const initSidebarResizer = () => {
    if (!elements.sidebarResizer || !elements.sidebar) return;

    let isResizing = false;

    elements.sidebarResizer.addEventListener("mousedown", (e) => {
      isResizing = true;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isResizing) return;
      const newWidth = e.clientX;
      if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth <= MAX_SIDEBAR_WIDTH) {
        elements.sidebar.style.width = `${newWidth}px`;
      }
    });

    document.addEventListener("mouseup", () => {
      isResizing = false;
    });
  };

  // ============================================================================
  // MODAL MANAGEMENT
  // ============================================================================

  /**
   * Close all open modals
   */
  const closeAllModals = () => {
    const hadActiveModal =
      document.querySelectorAll(".modal.active").length > 0;

    document.querySelectorAll(".modal.active").forEach((m) => {
      m.classList.remove("active");
    });

    // Restore share current page visibility when closing modals
    if (hadActiveModal) {
      toggleShareCurrentPageVisibility(true);
    }
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
      section.style.display = visible ? "block" : "none";
    });
    shareCurrentPageSeparators.forEach((separator) => {
      separator.style.display = visible ? "block" : "none";
    });
  };

  /**
   * Adjust modal size to fit main area
   * @param {HTMLElement} modal - Modal element
   */
  const adjustModalSize = (modal) => {
    if (!modal) return;

    const mainEl =
      document.querySelector("main.contents-page") ||
      document.querySelector("main");
    if (!mainEl) return;

    const rect = mainEl.getBoundingClientRect();
    const maxHeight = window.innerHeight - 56; // 56px is header height

    modal.style.position = "fixed";
    modal.style.top = "56px";
    modal.style.left = "0px";
    modal.style.width = `${rect.width}px`;
    modal.style.height = `${Math.min(rect.height, maxHeight)}px`;
    modal.style.overflowY = "auto";
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
   * Close help modal
   */
  const closeHelpModal = () => {
    elements.helpModal?.classList.remove("active");
    document.body.classList.add("toc-open");
    elements.footer?.classList.remove("expanded");
  };

  // ============================================================================
  // MOBILE MENU
  // ============================================================================

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

    const shouldPlaceBottom =
      window.innerWidth < MOBILE_BREAKPOINT && isMobileUserAgent();
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
                  number: parseInt(pageEl.dataset.page || "0", 10),
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
   * Render search results in modal
   * @param {Array} results - Search results
   * @param {Array} keywords - Search keywords
   * @param {string} rawQuery - Original query
   */
  const renderSearchResults = (results, keywords, rawQuery) => {
    if (!elements.searchResultsList || !elements.searchModal) return;

    elements.searchResultsList.innerHTML = "";
    elements.searchResultsList.scrollTop = 0;

    const hasQuery = rawQuery.trim().length > 0;

    if (!results.length) {
      if (elements.searchSummary) {
        elements.searchSummary.textContent = hasQuery
          ? `「${rawQuery}」の検索結果（0件）`
          : state.defaultSearchSummaryText;
      }
      if (elements.searchEmptyMessage) {
        elements.searchEmptyMessage.hidden = false;
        elements.searchEmptyMessage.textContent = hasQuery
          ? `「${rawQuery}」に一致する結果が見つかりませんでした。`
          : "検索キーワードを入力してください。";
      }
      return;
    }

    if (elements.searchEmptyMessage) {
      elements.searchEmptyMessage.hidden = true;
    }
    if (elements.searchSummary) {
      elements.searchSummary.textContent = `「${rawQuery}」の検索結果（${results.length}件）`;
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

      const navigateToResultPage = () => {
        elements.searchModal.classList.remove("active");
        navigateToPage(result.number);
      };

      card.addEventListener("click", navigateToResultPage);
      card.addEventListener("keypress", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigateToResultPage();
        }
      });

      elements.searchResultsList.appendChild(card);
    });
  };

  /**
   * Open search results modal
   */
  const openSearchResultsModal = () => {
    if (!elements.searchModal) return;
    closeAllModals();
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

    if (!keywords.length) {
      renderSearchResults([], [], "");
      openSearchResultsModal();
      return;
    }

    // Show loading message
    if (elements.searchSummary) {
      elements.searchSummary.textContent = "検索中...";
    }
    if (elements.searchEmptyMessage) {
      elements.searchEmptyMessage.hidden = true;
    }
    elements.searchResultsList.innerHTML = "";

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
      if (elements.searchSummary) {
        elements.searchSummary.textContent = "検索中にエラーが発生しました。";
      }
      if (elements.searchEmptyMessage) {
        elements.searchEmptyMessage.hidden = false;
        elements.searchEmptyMessage.textContent =
          "検索を実行できませんでした。";
      }
    }

    openSearchResultsModal();
  };

  // ============================================================================
  // SHARE FUNCTIONALITY
  // ============================================================================

  /**
   * Create share URL
   * @param {boolean} isFullSlide - Share full slide vs contents page
   * @returns {string} Share URL
   */
  const createShareUrl = (isFullSlide) => {
    if (isFullSlide) {
      // Share full slide
      const url = new URL("index.html", window.location.href);
      url.searchParams.set("page", "1");
      return url.toString();
    }

    // Share contents page
    const url = new URL("contents.html", window.location.href);
    return url.toString();
  };

  /**
   * Create Twitter share text
   * @param {string} url - Share URL
   * @param {boolean} isFullSlide - Full slide or page
   * @param {string} slideTitle - Slide title
   * @param {number} totalPages - Total pages
   * @returns {string} Twitter share URL
   */
  const createTwitterShareText = (url, isFullSlide, slideTitle, totalPages) => {
    let shareText = "";

    if (isFullSlide) {
      shareText = `「${slideTitle}」のWEBスライド 全${totalPages}ページ`;
    } else {
      shareText = `「${slideTitle}」の目次 全${totalPages}ページ`;
    }

    if (shareText.length > TWEET_MAX_LENGTH) {
      shareText = shareText.substring(0, TWEET_MAX_LENGTH - 3) + "...";
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
  // HEADER MENU
  // ============================================================================

  /**
   * Clamp search menu within viewport bounds
   */
  const clampSearchMenuWithinViewport = () => {
    if (!elements.searchHeaderItem || !elements.searchHeaderMenu) return;

    if (
      !elements.searchHeaderItem.classList.contains("active") ||
      !elements.searchHeaderMenu.classList.contains("open")
    ) {
      elements.searchHeaderMenu.style.removeProperty("--header-menu-offset");
      return;
    }

    const viewportPadding = 12;
    let offset = state.defaultSearchMenuOffset;

    elements.searchHeaderMenu.style.setProperty(
      "--header-menu-offset",
      `${state.defaultSearchMenuOffset}px`,
    );

    const rect = elements.searchHeaderMenu.getBoundingClientRect();
    const overflowRight = rect.right - (window.innerWidth - viewportPadding);
    const overflowLeft = viewportPadding - rect.left;

    if (overflowRight > 0) {
      offset -= overflowRight;
    }

    if (overflowLeft > 0) {
      offset += overflowLeft;
    }

    elements.searchHeaderMenu.style.setProperty(
      "--header-menu-offset",
      `${offset}px`,
    );
  };

  /**
   * Initialize header menu functionality
   */
  const initHeaderMenu = () => {
    // Prevent search menu from closing on internal clicks
    ["click", "mousedown"].forEach((eventName) => {
      elements.searchHeaderMenu?.addEventListener(eventName, (event) => {
        event.stopPropagation();
      });
    });

    if (!elements.headerItems.length) return;

    elements.headerItems.forEach((item) => {
      const menu = item.querySelector(".header-menu");

      item.addEventListener("click", (e) => {
        e.stopPropagation();

        // Close other menus
        elements.headerItems.forEach((other) => {
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

    // Close all menus on outside click
    document.addEventListener("click", () => {
      elements.headerItems.forEach((item) => {
        item.classList.remove("active");
        item.querySelector(".header-menu")?.classList.remove("open");
      });
    });
  };

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  // Initialize sidebar
  if (
    elements.sidebar &&
    elements.sidebarToggleBtn &&
    elements.sidebarCollapsedBtn
  ) {
    elements.sidebarToggleBtn.addEventListener("click", collapseSidebar);
    elements.sidebarCollapsedBtn.addEventListener("click", expandSidebar);
  }

  initSidebarResizer();

  // Initialize page controls
  const initialPageFromUrl = getCurrentPageFromUrl();
  syncPageControls(initialPageFromUrl);

  // Initialize thumbnail highlight on load
  if (initialPageFromUrl && state.thumbnails.length > 0) {
    window.addEventListener("load", () => {
      updateThumbnailHighlight(initialPageFromUrl, false);
    });
  }

  // Initialize page menu
  if (elements.pageInput && elements.pageDropdown && elements.pageMenu) {
    updatePageMenu();

    // Dropdown toggle
    elements.pageDropdown.addEventListener("click", (e) => {
      e.stopPropagation();
      elements.headerItems.forEach((item) => {
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

    // Enter key navigation
    elements.pageInput?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        const target = parseInt(elements.pageInput.value, 10);
        if (!isNaN(target)) navigateToPage(target);
      }
    });
  }

  // Browser back/forward button support
  window.addEventListener("popstate", () => {
    const pageFromUrl = getCurrentPageFromUrl();
    syncPageControls(pageFromUrl);
  });

  // Thumbnail click handlers
  state.thumbnails.forEach((thumb) => {
    thumb.addEventListener("click", () => {
      const pageNum = parseInt(thumb.dataset.page, 10);
      if (!isNaN(pageNum)) {
        updateThumbnailHighlight(pageNum, true);
        navigateToPage(pageNum);
      }
    });
  });

  // Initialize mobile menu
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
      const url = new URL("index.html", window.location.href);
      url.searchParams.set("page", "1");
      window.location.href = url.toString();
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

  // Initialize header menu
  initHeaderMenu();

  // Initialize help modal
  const helpClose = elements.helpModal?.querySelector(".modal-close");

  elements.helpBtn?.addEventListener("click", () => {
    closeAllModals();
    if (!elements.helpModal) return;
    adjustModalSize(elements.helpModal);
    elements.helpModal.classList.add("active");
    toggleShareCurrentPageVisibility(false);
    document.body.classList.remove("toc-open");
    elements.footer?.classList.add("expanded");
  });

  helpClose?.addEventListener("click", closeHelpModal);

  elements.helpModal?.addEventListener("click", (event) => {
    if (event.target === elements.helpModal) {
      closeHelpModal();
    }
  });

  elements.tocBtn?.addEventListener("click", () => {
    if (elements.helpModal?.classList.contains("active")) {
      closeHelpModal();
    }
  });

  // Search button handlers
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

  // Search input Enter key handlers
  document.querySelectorAll(".search-input").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        closeHeaderSearchMenu();
        runSearch(input.value || "");
      }
    });
  });

  // Search modal close handlers
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

  // Mobile search modal handlers
  elements.mobileSearchModal
    ?.querySelector(".modal-close")
    ?.addEventListener("click", () => {
      elements.mobileSearchModal.classList.remove("active");
    });

  elements.mobileSearchModal?.addEventListener("click", (event) => {
    if (event.target === elements.mobileSearchModal) {
      elements.mobileSearchModal.classList.remove("active");
    }
  });

  // Mobile share modal handlers
  elements.mobileShareModal
    ?.querySelector(".modal-close")
    ?.addEventListener("click", () => {
      elements.mobileShareModal.classList.remove("active");
    });

  elements.mobileShareModal?.addEventListener("click", (event) => {
    if (event.target === elements.mobileShareModal) {
      elements.mobileShareModal.classList.remove("active");
    }
  });

  // PDF download button
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

  // Share link copy handlers
  const copyLinkButtons = document.querySelectorAll(".share-link");

  copyLinkButtons.forEach((button) => {
    button.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const shareSection = button.closest(".share-section");
      const sectionHeader =
        shareSection?.querySelector("h4")?.textContent || "";
      const isFullSlide = sectionHeader.includes("全体");

      const urlToCopy = createShareUrl(isFullSlide);

      try {
        await navigator.clipboard.writeText(urlToCopy);
        showToast("リンクをコピーしました");
      } catch (err) {
        console.error("Failed to copy link:", err);
        fallbackCopyToClipboard(urlToCopy);
      }
    });
  });

  // Social media share handlers (capture phase)
  document.addEventListener(
    "click",
    (e) => {
      let shareText = "";

      // Facebook icon click
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
        const sectionHeader =
          shareSection?.querySelector("h4")?.textContent || "";
        const isFullSlide = sectionHeader.includes("全体");

        const shareUrl = createShareUrl(isFullSlide);

        const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
          shareUrl,
        )}`;
        shareText = facebookUrl;
      }

      // X (Twitter) icon click
      const xIcon = e.target.closest('img[src*="x_icon"], img[alt="X"]');
      if (xIcon && (xIcon.closest(".header-menu") || xIcon.closest(".modal"))) {
        e.preventDefault();
        e.stopPropagation();

        const shareSection = xIcon.closest(".share-section");
        const sectionHeader =
          shareSection?.querySelector("h4")?.textContent || "";
        const isFullSlide = sectionHeader.includes("全体");

        const shareUrl = createShareUrl(isFullSlide);
        const slideTitle = getSlideTitle();
        const totalPages = getTotalPages();

        shareText = createTwitterShareText(
          shareUrl,
          isFullSlide,
          slideTitle,
          totalPages,
        );
      }

      if (!shareText) return;

      window.open(shareText, "_blank", "noopener,noreferrer");
    },
    true,
  ); // Capture phase

  // Preserve query params on HTML link clicks
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a[href]");
    if (!link) return;

    const href = link.getAttribute("href");
    if (href && href.endsWith(".html") && !href.includes("?")) {
      e.preventDefault();
      navigateToFileWithParams(href);
    }
  });

  // Window resize handlers
  window.addEventListener("resize", () => {
    if (window.innerWidth > MOBILE_BREAKPOINT) {
      closeMobileMenu();
    }
    applyMenuTogglePosition();
    clampSearchMenuWithinViewport();

    // Resize active modals
    if (elements.helpModal?.classList.contains("active")) {
      adjustModalSize(elements.helpModal);
    }
    if (elements.searchModal?.classList.contains("active")) {
      adjustModalSize(elements.searchModal);
    }
  });

  // ESC key handler
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    if (document.getElementById("mobileMenu")?.classList.contains("open")) {
      closeMobileMenu();
      return;
    }

    const mobileSearchModalEl = document.getElementById("mobileSearchModal");
    if (mobileSearchModalEl?.classList.contains("active")) {
      mobileSearchModalEl.classList.remove("active");
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

    if (elements.helpModal?.classList.contains("active")) {
      elements.helpModal.classList.remove("active");
    }
  });

  // ============================================================================
  // UPDATE SHARE CURRENT PAGE SECTION FOR CONTENTS PAGE
  // ============================================================================

  const updateShareCurrentPageForContents = () => {
    const shareCurrentPageTextEls = document.querySelectorAll(
      "[data-share-current-page-text]",
    );

    shareCurrentPageTextEls.forEach((el) => {
      el.textContent = "目次ページ";
    });
  };

  updateShareCurrentPageForContents();
});
