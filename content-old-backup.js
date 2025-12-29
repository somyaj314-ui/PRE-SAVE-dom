// Enhanced DOM metadata extraction for Single Page Applications (SPAs)
(function () {
  'use strict';

  console.log('🔍 Content script loaded');

  // List of scripts to inject in order
  const scriptsToInject = [
    'inject.js',
    'fortigate-password-monitor.js',
    'policy-monitor-v2.js',
    'user-admin-monitor.js',
    'network-interface-monitor.js',
    'url-router.js',
    'dos-policy-monitor.js',
    'firewall-address-monitor.js',
    'central-snat-monitor.js',
    'firewall-service-monitor.js',
    'ml-data-collector.js',
    'ml-password-collector.js',
    'ml-interface-collector.js',
    'ml-dos-collector.js',
    'ml-address-collector.js',
    'ml-admin-integration.js',
    'ml-snat-collector.js',
    'ml-service-collector.js',
    'ml-policy-collector.js',
    'ml-vpn-collector.js',
    'ml-inference.js',
    'ml-unified-collector.js'
  ];

  // Inject script with Promise support
  function injectScript(scriptName) {
    return new Promise((resolve, reject) => {
      try {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL(scriptName);
        script.type = 'text/javascript';
        script.onload = () => {
          console.log(`✅ ${scriptName} loaded`);
          script.remove();
          resolve();
        };
        script.onerror = (e) => {
          console.error(`❌ Failed to load ${scriptName}:`, e);
          reject(e);
        };
        (document.head || document.documentElement).appendChild(script);
      } catch (e) {
        reject(e);
      }
    });
  }

  // Inject all scripts sequentially
  async function injectPasswordMonitor() {
    if (window !== window.top) {
      console.log('⏭️ Skipping injection in iframe');
      return;
    }

    console.log('📄 Starting script injection sequence...');
    
    for (const scriptName of scriptsToInject) {
      try {
        await injectScript(scriptName);
      } catch (e) {
        console.error(`⚠️ Continuing despite error with ${scriptName}`);
      }
    }

    console.log('✅ All scripts injected successfully');
  }

  // Inject ONLY ONCE - prevent duplicates
  if (!window.__MONITORS_INJECTED__) {
    window.__MONITORS_INJECTED__ = true;
    injectPasswordMonitor();
  }

      // Inject ml-vpn-collector.js twenty-first
      const s21 = document.createElement('script');
      s21.src = chrome.runtime.getURL('ml-vpn-collector.js');
      s21.onload = () => {
        console.log('✅ ml-vpn-collector.js loaded');
        s21.remove();
      };
      s21.onerror = (e) => {
        console.error('❌ Failed to load ml-vpn-collector.js:', e);
      };
      (document.head || document.documentElement).appendChild(s21);



      // Inject ml-inference.js twenty-second
      const s_inference = document.createElement('script');
      s_inference.src = chrome.runtime.getURL('ml-inference.js') + '?t=' + Date.now();
      s_inference.onload = () => {
        console.log('✅ ml-inference.js loaded');
        s_inference.remove();
      };
      s_inference.onerror = (e) => {
        console.error('❌ Failed to load ml-inference.js:', e);
      };
      (document.head || document.documentElement).appendChild(s_inference);

      // Inject ml-unified-collector.js twenty-third (MUST BE LAST)
      const s22 = document.createElement('script');
      s22.src = chrome.runtime.getURL('ml-unified-collector.js') + '?t=' + Date.now();
      s22.setAttribute('data-model-url', chrome.runtime.getURL('model_data.json'));
      s22.onload = () => {
        console.log('✅ ml-unified-collector.js loaded');
        s22.remove();
      };
      s22.onerror = (e) => {
        console.error('❌ Failed to load ml-unified-collector.js:', e);
      };
      (document.head || document.documentElement).appendChild(s22);
    } catch (e) {
      console.error('❌ Failed to inject monitors:', e);
    }
  }

  // Inject ONLY ONCE - prevent duplicates
  if (!window.__MONITORS_INJECTED__) {
    window.__MONITORS_INJECTED__ = true;
    injectPasswordMonitor();
  }

  let captureTimeout = null;
  let lastCapturedUrl = '';

  // Listen for password change events and policy events from inject.js
  window.addEventListener('message', function (event) {
    // Only accept messages from same window
    if (event.source !== window) return;

    const data = event.data;

    // Debug: Log all messages
    if (data && (data.type === 'POLICY_CHANGE' || data.source === 'password-monitor')) {
      console.log('📨 Message received in content.js:', data);
    }

    // Handle password monitoring events
    if (data && data.source === 'password-monitor') {
      console.log('🔐 Password event:', data.type);

      // Send to background script immediately
      try {
        chrome.runtime.sendMessage({
          type: 'PASSWORD_EVENT',
          eventType: data.type,
          data: data.data
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('⚠️ Extension context invalidated. Please refresh the page.');
            return;
          }
          console.log('✅ Password event sent to background');
        });
      } catch (e) {
        console.warn('⚠️ Extension context invalidated. Please refresh the page.');
      }
    }

    // Handle policy change events
    if (data && data.type === 'POLICY_CHANGE') {
      console.log('🛡️ Policy event received in content.js:', data.eventType);

      // Send to background script immediately
      try {
        chrome.runtime.sendMessage({
          type: 'POLICY_EVENT',
          eventType: data.eventType,
          data: data.data
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('⚠️ Extension context invalidated. Please refresh the page.');
            return;
          }
          console.log('✅ Policy event sent to background:', response);
        });
      } catch (e) {
        console.warn('⚠️ Extension context invalidated. Please refresh the page.');
      }
    }

    // Handle admin user creation/edit events (NEW)
    if (data && data.type === 'ADMIN_USER_CHANGE') {
      console.log('👤 Admin user event received in content.js:', data.eventType);

      // Send to background script immediately
      try {
        chrome.runtime.sendMessage({
          type: 'ADMIN_USER_EVENT',
          eventType: data.eventType,
          data: data.data
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('⚠️ Extension context invalidated. Please refresh the page.');
            return;
          }
          console.log('✅ Admin user event sent to background:', response);
        });
      } catch (e) {
        console.warn('⚠️ Extension context invalidated. Please refresh the page.');
      }
    }

    // Handle policy live status events (NEW)
    if (data && data.type === 'POLICY_LIVE_STATUS') {
      console.log('⚡ Policy live status received in content.js:', data.eventType);

      // Send to background script immediately
      chrome.runtime.sendMessage({
        type: 'POLICY_LIVE_STATUS',
        eventType: data.eventType,
        data: data.data
      }, (response) => {
        console.log('✅ Policy live status sent to background:', response);
      });
    }

    // Handle network interface change events (NEW)
    if (data && data.type === 'INTERFACE_CHANGE') {
      console.log('🌐 Interface event received in content.js:', data.eventType);

      // Send to background script immediately
      try {
        chrome.runtime.sendMessage({
          type: 'INTERFACE_EVENT',
          eventType: data.eventType,
          data: data.data
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('⚠️ Extension context invalidated. Please refresh the page.');
            return;
          }
          console.log('✅ Interface event sent to background:', response);
        });
      } catch (e) {
        console.warn('⚠️ Extension context invalidated. Please refresh the page.');
      }
    }

    // Handle DoS Policy change events (NEW)
    if (data && data.type === 'DOS_POLICY_CHANGE') {
      console.log('🚫 DoS Policy event received in content.js:', data.eventType);

      // Send to background script immediately
      try {
        chrome.runtime.sendMessage({
          type: 'DOS_POLICY_EVENT',
          eventType: data.eventType,
          data: data.data
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('⚠️ Extension context invalidated. Please refresh the page.');
            return;
          }
          console.log('✅ DoS Policy event sent to background:', response);
        });
      } catch (e) {
        console.warn('⚠️ Extension context invalidated. Please refresh the page.');
      }
    }

    // Handle Firewall Address change events (NEW)
    if (data && data.type === 'ADDRESS_CHANGE') {
      console.log('📍 Firewall Address event received in content.js:', data.eventType);

      // Send to background script immediately
      try {
        chrome.runtime.sendMessage({
          type: 'ADDRESS_EVENT',
          eventType: data.eventType,
          data: data.data
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('⚠️ Extension context invalidated. Please refresh the page.');
            return;
          }
          console.log('✅ Firewall Address event sent to background:', response);
        });
      } catch (e) {
        console.warn('⚠️ Extension context invalidated. Please refresh the page.');
      }
    }
    // Handle Central SNAT Map change events (NEW)
    if (data && data.type === 'CENTRAL_SNAT_CHANGE') {
      console.log('🔄 Central SNAT Map event received in content.js:', data.eventType);

      // Send to background script immediately
      try {
        chrome.runtime.sendMessage({
          type: 'CENTRAL_SNAT_EVENT',
          eventType: data.eventType,
          data: data.data
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('⚠️ Extension context invalidated. Please refresh the page.');
            return;
          }
          console.log('✅ Central SNAT Map event sent to background:', response);
        });
      } catch (e) {
        console.warn('⚠️ Extension context invalidated. Please refresh the page.');
      }
    }

    // Handle Firewall Service change events (NEW)
    if (data && data.type === 'FIREWALL_SERVICE_CHANGE') {
      console.log('🔧 Firewall Service event received in content.js:', data.eventType);

      // Send to background script immediately
      try {
        chrome.runtime.sendMessage({
          type: 'FIREWALL_SERVICE_EVENT',
          eventType: data.eventType,
          data: data.data
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('⚠️ Extension context invalidated. Please refresh the page.');
            return;
          }
          console.log('✅ Firewall Service event sent to background:', response);

        })

        // Inject vpn-ipsec-monitor.js eleventh
        const s11 = document.createElement('script');
        s11.src = chrome.runtime.getURL('vpn-ipsec-monitor.js');
        s11.onload = () => {
          console.log('✅ vpn-ipsec-monitor.js loaded');
          s11.remove();
        };
        s11.onerror = (e) => {
          console.error('❌ Failed to load vpn-ipsec-monitor.js:', e);
        };
        (document.head || document.documentElement).appendChild(s11);
      } catch (e) {
        console.error('❌ Failed to inject monitors:', e);
      }
    }
    // Handle VPN IPSec change events (NEW)
    if (data && data.type === 'VPN_CHANGE') {
      console.log('🔐 VPN IPSec event received in content.js:', data.eventType);

      // Send to background script immediately
      try {
        chrome.runtime.sendMessage({
          type: 'VPN_EVENT',
          eventType: data.eventType,
          data: data.data
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('⚠️ Extension context invalidated. Please refresh the page.');
            return;
          }
          console.log('✅ VPN IPSec event sent to background:', response);
        });
      } catch (e) {
        console.warn('⚠️ Extension context invalidated. Please refresh the page.');
      }
    }

    // Handle ML Unified Sample events
    if (data && data.type === 'ML_UNIFIED_SAMPLE') {
      console.log('🤖 ML Unified Sample received in content.js:', data.sampleType);

      try {
        chrome.runtime.sendMessage({
          type: 'ML_UNIFIED_SAMPLE',
          sampleType: data.sampleType,
          data: data.data
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('⚠️ Extension context invalidated. Please refresh the page.');
            return;
          }
          console.log('✅ ML Unified Sample event sent to background:', response);
        });
      } catch (e) {
        console.warn('⚠️ Extension context invalidated. Please refresh the page.');
      }
    }

    // Handle ML Unified Sample events
    if (data && data.type === 'ML_UNIFIED_SAMPLE') {
      console.log('🤖 ML Unified Sample received in content.js:', data.sampleType);

      try {
        chrome.runtime.sendMessage({
          type: 'ML_UNIFIED_SAMPLE',
          sampleType: data.sampleType,
          data: data.data
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('⚠️ Extension context invalidated. Please refresh the page.');
            return;
          }
          console.log('✅ ML Unified Sample event sent to background:', response);
        });
      } catch (e) {
        console.warn('⚠️ Extension context invalidated. Please refresh the page.');
      }
    }

    // Handle ML Training Sample events
    if (data && data.type === 'ML_TRAINING_SAMPLE') {
      console.log('🤖 ML Training Sample received in content.js');

      try {
        chrome.runtime.sendMessage({
          type: 'ML_TRAINING_SAMPLE',
          data: data.data
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('⚠️ Extension context invalidated. Please refresh the page.');
            return;
          }
          console.log('✅ ML Training Sample event sent to background:', response);
        });
      } catch (e) {
        console.warn('⚠️ Extension context invalidated. Please refresh the page.');
      }
    }
  });

  // Intercept XMLHttpRequest and Fetch API for AJAX monitoring
  monitorAjaxCalls();

  // Wait for page to be fully loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCapture);
  } else {
    initCapture();
  }

  function initCapture() {
    // Initial capture
    scheduledCapture();

    // Monitor for DOM changes (for SPAs)
    observeDOMChanges();

    // Monitor for URL changes (for SPAs using routing)
    monitorUrlChanges();

    // Monitor user interactions
    monitorUserActions();
  }

  function scheduledCapture() {
    // Debounce: wait 2 seconds after last DOM change before capturing
    clearTimeout(captureTimeout);
    captureTimeout = setTimeout(() => {
      captureMetadata();
    }, 2000);
  }

  function captureMetadata() {
    const currentUrl = window.location.href;

    // Only capture if URL changed or significant time passed
    if (currentUrl === lastCapturedUrl) {
      return;
    }

    lastCapturedUrl = currentUrl;
    const metadata = extractPageMetadata();

    // Send to background script for storage
    chrome.runtime.sendMessage({
      type: 'UI_METADATA',
      data: metadata
    }, (response) => {
      if (response && response.success) {
        console.log('✅ Metadata captured for:', currentUrl);
      }
    });
  }

  function extractPageMetadata() {
    // Extract comprehensive UI metadata INCLUDING DYNAMIC CONTENT
    const metadata = {
      pageUrl: window.location.href,
      pageTitle: document.title,
      captureTimestamp: new Date().toISOString(),

      // Meta tags
      metaTags: extractMetaTags(),

      // DOM structure
      domStructure: analyzeDOMStructure(),

      // **NEW: Visible text content**
      textContent: extractVisibleText(),

      // **NEW: Tables with actual data**
      tablesData: extractTablesWithData(),

      // Forms on the page
      forms: extractFormData(),

      // **NEW: Buttons and clickable elements**
      buttons: extractButtons(),

      // Inputs and interactive elements
      inputs: extractInputElements(),

      // Links
      links: extractLinks(),

      // Scripts and resources
      resources: extractResources(),

      // Viewport and display info
      viewport: getViewportInfo(),

      // **NEW: Navigation menu**
      navigation: extractNavigation(),

      // **NEW: Headings structure**
      headings: extractHeadings(),

      // Custom data attributes
      customAttributes: extractCustomDataAttributes()
    };

    return metadata;
  }

  // ============ ENHANCED EXTRACTION FUNCTIONS ============

  function extractVisibleText() {
    // Extract all visible text from major UI elements
    const textElements = [];

    // Get all text-containing elements
    const selectors = [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'span', 'div', 'label', 'td', 'th',
      'button', 'a', 'li'
    ];

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        const text = el.textContent.trim();
        // Only capture if element is visible and has meaningful text
        if (text &&
          text.length > 0 &&
          text.length < 500 &&
          isElementVisible(el)) {
          textElements.push({
            tag: el.tagName.toLowerCase(),
            text: text.substring(0, 200),
            className: el.className,
            id: el.id
          });
        }
      });
    });

    return textElements.slice(0, 100); // Limit to first 100 elements
  }

  function extractTablesWithData() {
    const tables = [];

    document.querySelectorAll('table').forEach((table, index) => {
      if (!isElementVisible(table)) return;

      const headers = [];
      const rows = [];

      // Extract headers
      table.querySelectorAll('thead th, thead td').forEach(th => {
        headers.push(th.textContent.trim());
      });

      // If no thead, try first row
      if (headers.length === 0) {
        const firstRow = table.querySelector('tr');
        if (firstRow) {
          firstRow.querySelectorAll('th, td').forEach(cell => {
            headers.push(cell.textContent.trim());
          });
        }
      }

      // Extract row data (limit to 20 rows)
      table.querySelectorAll('tbody tr, tr').forEach((tr, rowIndex) => {
        if (rowIndex >= 20) return;

        const rowData = [];
        tr.querySelectorAll('td, th').forEach(cell => {
          rowData.push(cell.textContent.trim().substring(0, 100));
        });

        if (rowData.length > 0) {
          rows.push(rowData);
        }
      });

      tables.push({
        id: table.id,
        className: table.className,
        headers: headers,
        rows: rows,
        totalRows: table.querySelectorAll('tr').length
      });
    });

    return tables;
  }

  function extractButtons() {
    const buttons = [];

    document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]')
      .forEach(btn => {
        if (!isElementVisible(btn)) return;

        buttons.push({
          type: btn.tagName.toLowerCase(),
          text: btn.textContent.trim() || btn.value || '',
          id: btn.id,
          className: btn.className,
          name: btn.name,
          disabled: btn.disabled
        });
      });

    return buttons.slice(0, 50);
  }

  function extractNavigation() {
    const navItems = [];

    // Look for nav elements
    document.querySelectorAll('nav a, [role="navigation"] a, .nav a, .menu a, .sidebar a')
      .forEach(link => {
        navItems.push({
          text: link.textContent.trim(),
          href: link.href,
          active: link.classList.contains('active') || link.classList.contains('selected')
        });
      });

    return navItems.slice(0, 50);
  }

  function extractHeadings() {
    const headings = [];

    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
      if (!isElementVisible(h)) return;

      headings.push({
        level: h.tagName.toLowerCase(),
        text: h.textContent.trim(),
        id: h.id,
        className: h.className
      });
    });

    return headings;
  }

  function isElementVisible(el) {
    // Check if element is actually visible on screen
    if (!el) return false;

    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      el.offsetParent !== null;
  }

  // ============ AJAX/API MONITORING ============

  function monitorAjaxCalls() {
    // Intercept XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this._method = method;
      this._url = url;
      return originalXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
      this.addEventListener('load', function () {
        console.log('🌐 AJAX Request:', {
          method: this._method,
          url: this._url,
          status: this.status,
          response: this.responseText ? this.responseText.substring(0, 500) : ''
        });

        // Send AJAX data to background
        chrome.runtime.sendMessage({
          type: 'AJAX_CALL',
          data: {
            method: this._method,
            url: this._url,
            status: this.status,
            responsePreview: this.responseText ? this.responseText.substring(0, 1000) : '',
            timestamp: new Date().toISOString()
          }
        });
      });

      return originalXHRSend.apply(this, arguments);
    };

    // Intercept Fetch API
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const url = args;
      const options = args || {};

      console.log('🌐 Fetch Request:', {
        url: url,
        method: options.method || 'GET'
      });

      return originalFetch.apply(this, args).then(response => {
        // Clone response to read it
        const clonedResponse = response.clone();

        clonedResponse.text().then(text => {
          chrome.runtime.sendMessage({
            type: 'AJAX_CALL',
            data: {
              method: options.method || 'GET',
              url: url,
              status: response.status,
              responsePreview: text.substring(0, 1000),
              timestamp: new Date().toISOString()
            }
          });
        });

        return response;
      });
    };
  }

  // ============ DOM CHANGE OBSERVER ============

  function observeDOMChanges() {
    const observer = new MutationObserver((mutations) => {
      // DOM changed, schedule a new capture
      scheduledCapture();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });
  }

  // ============ URL CHANGE MONITORING (for SPAs) ============

  function monitorUrlChanges() {
    let lastUrl = location.href;

    new MutationObserver(() => {
      const currentUrl = location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log('📍 URL Changed:', currentUrl);
        scheduledCapture();
      }
    }).observe(document, { subtree: true, childList: true });

    // Also monitor popstate for back/forward navigation
    window.addEventListener('popstate', () => {
      scheduledCapture();
    });
  }

  // ============ USER ACTION MONITORING ============

  function monitorUserActions() {
    // Track clicks
    document.addEventListener('click', (e) => {
      const target = e.target;
      console.log('👆 Click on:', {
        tag: target.tagName,
        text: target.textContent.trim().substring(0, 50),
        id: target.id,
        className: target.className
      });

      // Trigger capture after click (content might change)
      scheduledCapture();
    }, true);

    // Track scroll (optional, might trigger capture on pages with infinite scroll)
    let scrollTimeout;
    window.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        scheduledCapture();
      }, 3000);
    });
  }

  // ============ EXISTING HELPER FUNCTIONS ============

  function extractMetaTags() {
    return Array.from(document.getElementsByTagName('meta')).map(meta => ({
      name: meta.name || meta.property || meta.httpEquiv,
      content: meta.content
    })).filter(m => m.name);
  }

  function analyzeDOMStructure() {
    return {
      totalElements: document.getElementsByTagName('*').length,
      divCount: document.getElementsByTagName('div').length,
      spanCount: document.getElementsByTagName('span').length,
      buttonCount: document.getElementsByTagName('button').length,
      inputCount: document.getElementsByTagName('input').length,
      formCount: document.getElementsByTagName('form').length,
      tableCount: document.getElementsByTagName('table').length,
      iframeCount: document.getElementsByTagName('iframe').length
    };
  }

  function extractFormData() {
    return Array.from(document.forms).slice(0, 10).map(form => ({
      id: form.id,
      name: form.name,
      action: form.action,
      method: form.method,
      fieldCount: form.elements.length,
      fields: Array.from(form.elements).slice(0, 20).map(field => ({
        name: field.name,
        type: field.type,
        id: field.id,
        required: field.required
      }))
    }));
  }

  function extractInputElements() {
    return Array.from(document.querySelectorAll('input, textarea, select'))
      .slice(0, 30)
      .map(input => ({
        type: input.type || input.tagName.toLowerCase(),
        name: input.name,
        id: input.id,
        placeholder: input.placeholder,
        required: input.required,
        className: input.className
      }));
  }

  function extractLinks() {
    const links = Array.from(document.links).slice(0, 50);
    return {
      totalCount: document.links.length,
      sample: links.map(link => ({
        href: link.href,
        text: link.textContent.trim().substring(0, 100),
        rel: link.rel
      }))
    };
  }

  function extractResources() {
    return {
      scripts: Array.from(document.scripts).slice(0, 20).map(s => s.src).filter(Boolean),
      stylesheets: Array.from(document.styleSheets).slice(0, 10).map(s => s.href).filter(Boolean),
      images: Array.from(document.images).slice(0, 20).map(img => img.src)
    };
  }

  function getViewportInfo() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      devicePixelRatio: window.devicePixelRatio
    };
  }

  function extractCustomDataAttributes() {
    const elements = document.querySelectorAll('*');
    const attributes = new Set();

    elements.forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        if (attr.name.startsWith('data-')) {
          attributes.add(attr.name);
        }
      });
    });

    return Array.from(attributes).slice(0, 50);
  }

})();
