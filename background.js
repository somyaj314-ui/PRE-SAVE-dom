// IndexedDB setup for persistent storage
//testing
let db = null;

// Initialize IndexedDB
function initDatabase() {
  const request = indexedDB.open('PortalCaptureDB', 1);

  request.onerror = () => console.error('Database failed to open');

  request.onsuccess = (event) => {
    db = event.target.result;
    console.log('Database initialized successfully');
  };

  request.onupgradeneeded = (event) => {
    db = event.target.result;

    // Store for API requests
    if (!db.objectStoreNames.contains('apiRequests')) {
      const apiStore = db.createObjectStore('apiRequests', {
        keyPath: 'id',
        autoIncrement: true
      });
      apiStore.createIndex('url', 'url', { unique: false });
      apiStore.createIndex('timestamp', 'timestamp', { unique: false });
    }

    // Store for UI metadata
    if (!db.objectStoreNames.contains('uiMetadata')) {
      const uiStore = db.createObjectStore('uiMetadata', {
        keyPath: 'id',
        autoIncrement: true
      });
      uiStore.createIndex('pageUrl', 'pageUrl', { unique: false });
    }
  };
}

// Initialize on extension load
initDatabase();

// RE-INJECTION LOGIC: Automatically re-inject content scripts into existing tabs
// This fixes the "Extension context invalidated" error without requiring a page refresh.
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('🚀 Extension installed/reloaded. Re-injecting content scripts...');

  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });

  for (const tab of tabs) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['content.js']
      });
      console.log(`✅ Re-injected into tab ${tab.id}: ${tab.url}`);
    } catch (err) {
      console.warn(`❌ Could not re-inject into tab ${tab.id}: ${err.message}`);
    }
  }
});

// Test connection on startup
setTimeout(() => {
  console.log('🧪 Testing tray app connection...');
  sendToTrayApp({
    type: 'EXTENSION_STARTUP',
    data: { message: 'Extension loaded and ready' },
    timestamp: new Date().toISOString()
  });
}, 2000);

// Domain filter patterns (customize for your needs)
const DOMAIN_FILTERS = [
  'fortinet.com',
  'fortigate',
  'fortiweb',
  // Add more domains as needed
];

// Check if URL matches filter
function matchesFilter(url) {
  // For testing, capture everything (disable domain filtering)
  //return true;

  // Original filtering logic (commented out for testing)
  if (DOMAIN_FILTERS.length === 0) return true;
  return DOMAIN_FILTERS.some(filter => url.toLowerCase().includes(filter.toLowerCase()));
}

// Save API request to IndexedDB
function saveApiRequest(data) {
  if (!db) return;

  const transaction = db.transaction(['apiRequests'], 'readwrite');
  const store = transaction.objectStore('apiRequests');

  store.add(data);

  transaction.oncomplete = () => {
    console.log('API request saved:', data.url);
  };

  transaction.onerror = () => {
    console.error('Error saving API request');
  };
}

// HTTP connection to tray app
function sendToTrayApp(data) {
  fetch('http://localhost:8080/data', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data)
  })
    .then(response => response.json())
    .then(result => {
      console.log('✅ Sent to tray app:', data.type, result);
    })
    .catch(error => {
      console.log('❌ Failed to send to tray app:', error);
    });
}

// Capture request metadata
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (matchesFilter(details.url)) {
      const requestData = {
        url: details.url,
        method: details.method,
        type: details.type,
        timestamp: new Date(details.timeStamp).toISOString(),
        requestBody: details.requestBody || null,
        tabId: details.tabId
      };

      console.log('Request captured:', requestData);
      saveApiRequest(requestData);

      // Send to tray app immediately
      sendToTrayApp({
        type: 'API_CALL',
        data: requestData,
        timestamp: new Date().toISOString()
      });
    }
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

// Capture response headers and status
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (matchesFilter(details.url)) {
      const responseData = {
        url: details.url,
        method: details.method,
        statusCode: details.statusCode,
        type: details.type,
        timestamp: new Date(details.timeStamp).toISOString(),
        responseHeaders: details.responseHeaders || [],
        tabId: details.tabId
      };

      console.log('Response captured:', responseData);
      saveApiRequest(responseData);

      // Send to tray app immediately
      sendToTrayApp({
        type: 'API_RESPONSE',
        data: responseData,
        timestamp: new Date().toISOString()
      });
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// ==========================================
// SESSION STATE MANAGEMENT (Source of Truth)
// ==========================================

const activeSessions = new Map(); // tabId -> { port, status, lastSeen }

// Handle persistent connections from content scripts
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'monitor-connection') return;

  const tabId = port.sender.tab.id;
  console.log(`🔌 Content script connected on tab ${tabId}`);

  // Update session state
  activeSessions.set(tabId, {
    port: port,
    status: 'active',
    lastSeen: Date.now()
  });

  // Handle disconnect (navigation or tab close)
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    console.log(`🔌 Content script disconnected on tab ${tabId} ${error ? `(${error.message})` : ''}`);

    // Mark as suspended but don't delete immediately (wait for reconnection)
    if (activeSessions.has(tabId)) {
      const session = activeSessions.get(tabId);
      session.status = 'suspended';
      session.port = null;
      session.lastSeen = Date.now();

      // Optional: Set a clearer timeout to cleanup if no reconnect happens
      setTimeout(() => {
        if (activeSessions.get(tabId)?.status === 'suspended') {
          console.log(`🧹 Cleaning up stale session for tab ${tabId}`);
          activeSessions.delete(tabId);
        }
      }, 30000); // 30s grace period
    }
  });

  // Listen for keep-alive or status messages
  port.onMessage.addListener((msg) => {
    if (msg.type === 'HEARTBEAT') {
      const session = activeSessions.get(tabId);
      if (session) {
        session.lastSeen = Date.now();
        session.status = 'active';
      }
    }
  });
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle password events
  if (message.type === 'PASSWORD_EVENT' || message.action === 'password_change') {
    console.log('🔐 Password event received:', message);

    // Send to tray app immediately (BEFORE save button)
    sendToTrayApp({
      type: 'PASSWORD_CHANGE',
      eventType: message.eventType || 'PASSWORD_FIELD_CHANGED',
      data: message.data || message,
      timestamp: new Date().toISOString()
    });

    sendResponse({ success: true });
    return true;
  }

  // Handle policy events (NEW)
  if (message.type === 'POLICY_EVENT') {
    console.log('🛡️ Policy event received:', message);

    // Send to tray app immediately
    sendToTrayApp({
      type: 'POLICY_CHANGE',
      eventType: message.eventType || 'POLICY_EDITED',
      data: message.data || message,
      timestamp: new Date().toISOString()
    });

    sendResponse({ success: true });
    return true;
  }

  // Handle admin user creation/edit events (NEW)
  if (message.type === 'ADMIN_USER_EVENT') {
    console.log('👤 Admin user event received:', message);

    // Send to tray app immediately
    sendToTrayApp({
      type: 'ADMIN_USER_CHANGE',
      eventType: message.eventType || 'ADMIN_USER_CREATED',
      data: message.data || message,
      timestamp: new Date().toISOString()
    });

    sendResponse({ success: true });
    return true;
  }

  // Handle policy live status events (NEW)
  if (message.type === 'POLICY_LIVE_STATUS') {
    console.log('⚡ Policy live status received:', message);

    // Send to tray app immediately
    sendToTrayApp({
      type: 'POLICY_LIVE_STATUS',
      eventType: message.eventType || 'POLICY_EDITING',
      data: message.data || message,
      timestamp: new Date().toISOString()
    });

    sendResponse({ success: true });
    return true;
  }

  // Handle network interface events (NEW)
  if (message.type === 'INTERFACE_EVENT') {
    console.log('🌐 Interface event received:', message);

    // Send to tray app immediately
    sendToTrayApp({
      type: 'INTERFACE_CHANGE',
      eventType: message.eventType || 'INTERFACE_EDITED',
      data: message.data || message,
      timestamp: new Date().toISOString()
    });

    sendResponse({ success: true });
    return true;
  }

  // Handle DoS Policy events (NEW)
  if (message.type === 'DOS_POLICY_EVENT') {
    console.log('🚫 DoS Policy event received:', message);

    // Send to tray app immediately
    sendToTrayApp({
      type: 'DOS_POLICY_CHANGE',
      eventType: message.eventType || 'DOS_POLICY_EDITED',
      data: message.data || message,
      timestamp: new Date().toISOString()
    });

    sendResponse({ success: true });
    return true;
  }

  // Handle Firewall Address events (NEW)
  if (message.type === 'ADDRESS_EVENT') {
    console.log('📍 Firewall Address event received:', message);

    // Send to tray app immediately
    sendToTrayApp({
      type: 'ADDRESS_CHANGE',
      eventType: message.eventType || 'ADDRESS_EDITED',
      data: message.data || message,
      timestamp: new Date().toISOString()
    });

    sendResponse({ success: true });
    return true;
  }
  // Handle Central SNAT Map events (NEW)
  if (message.type === 'CENTRAL_SNAT_EVENT') {
    console.log('🔄 Central SNAT Map event received:', message);

    // Send to tray app immediately
    sendToTrayApp({
      type: 'CENTRAL_SNAT_CHANGE',
      eventType: message.eventType || 'CENTRAL_SNAT_EDITED',
      data: message.data || message,
      timestamp: new Date().toISOString()
    });

    sendResponse({ success: true });
    return true;
  }

  // Handle Firewall Service events (NEW)
  if (message.type === 'FIREWALL_SERVICE_EVENT') {
    console.log('🔧 Firewall Service event received:', message);

    // Send to tray app immediately
    sendToTrayApp({
      type: 'FIREWALL_SERVICE_CHANGE',
      eventType: message.eventType || 'FIREWALL_SERVICE_EDITED',
      data: message.data || message,
      timestamp: new Date().toISOString()
    });

    sendResponse({ success: true });
    return true;
  }

  // Handle VPN events (NEW)
  if (message.type === 'VPN_EVENT') {
    console.log('🔐 VPN event received:', message);

    // Send to tray app immediately
    sendToTrayApp({
      type: 'VPN_CHANGE',
      eventType: message.eventType || 'VPN_EDITING',
      data: message.data || message,
      timestamp: new Date().toISOString()
    });

    sendResponse({ success: true });
    return true;
  }

  // Handle ML Prediction Result (NEW)
  if (message.type === 'ML_PREDICTION_RESULT') {
    console.log('🔮 ML Prediction Result received:', message);

    // Send to tray app immediately
    sendToTrayApp({
      type: 'ML_PREDICTION_RESULT',
      data: message.data,
      isStreaming: message.isStreaming,
      timestamp: new Date().toISOString()
    });

    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'UI_METADATA') {
    // Save UI metadata to IndexedDB
    if (!db) {
      sendResponse({ success: false, error: 'Database not ready' });
      return true;
    }

    const transaction = db.transaction(['uiMetadata'], 'readwrite');
    const store = transaction.objectStore('uiMetadata');

    const uiData = {
      ...message.data,
      capturedAt: new Date().toISOString()
    };

    store.add(uiData);

    // Send to tray app in real-time
    sendToTrayApp({
      type: 'UI_CHANGE',
      data: uiData,
      timestamp: new Date().toISOString()
    });

    transaction.oncomplete = () => {
      console.log('UI metadata saved for:', message.data.pageUrl);
      sendResponse({ success: true });
    };

    transaction.onerror = () => {
      sendResponse({ success: false, error: 'Failed to save' });
    };

    return true; // Keep channel open for async response
  }

  if (message.type === 'AJAX_CALL') {
    // Send AJAX calls to tray app immediately
    sendToTrayApp({
      type: 'API_CALL',
      data: message.data,
      timestamp: new Date().toISOString()
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'GET_CAPTURED_DATA') {
    // Retrieve data from IndexedDB
    getAllCapturedData((data) => {
      sendResponse({ success: true, data });
    });
    return true;
  }

  if (message.type === 'CLEAR_ALL_DATA') {
    // Clear all data from IndexedDB
    clearAllCapturedData((success) => {
      sendResponse({ success });
    });
    return true;
  }
});

// Helper to get all captured data
function getAllCapturedData(callback) {
  if (!db) {
    callback({ apiRequests: [], uiMetadata: [] });
    return;
  }

  const result = { apiRequests: [], uiMetadata: [] };

  // Get API requests
  const apiTransaction = db.transaction(['apiRequests'], 'readonly');
  const apiStore = apiTransaction.objectStore('apiRequests');
  const apiRequest = apiStore.getAll();

  apiRequest.onsuccess = () => {
    result.apiRequests = apiRequest.result;

    // Get UI metadata
    const uiTransaction = db.transaction(['uiMetadata'], 'readonly');
    const uiStore = uiTransaction.objectStore('uiMetadata');
    const uiRequest = uiStore.getAll();

    uiRequest.onsuccess = () => {
      result.uiMetadata = uiRequest.result;
      callback(result);
    };
  };
}

// Helper to clear all captured data
function clearAllCapturedData(callback) {
  if (!db) {
    console.error('Database not initialized');
    callback(false);
    return;
  }

  try {
    // Clear API requests
    const apiTransaction = db.transaction(['apiRequests'], 'readwrite');
    const apiStore = apiTransaction.objectStore('apiRequests');
    const apiClearRequest = apiStore.clear();

    apiClearRequest.onsuccess = () => {
      console.log('✅ API requests cleared');

      // Clear UI metadata
      const uiTransaction = db.transaction(['uiMetadata'], 'readwrite');
      const uiStore = uiTransaction.objectStore('uiMetadata');
      const uiClearRequest = uiStore.clear();

      uiClearRequest.onsuccess = () => {
        console.log('✅ UI metadata cleared');
        callback(true);
      };

      uiClearRequest.onerror = () => {
        console.error('❌ Failed to clear UI metadata');
        callback(false);
      };
    };

    apiClearRequest.onerror = () => {
      console.error('❌ Failed to clear API requests');
      callback(false);
    };
  } catch (error) {
    console.error('❌ Error clearing data:', error);
    callback(false);
  }
}