// ============================================
// URL ROUTER - Intelligent Page Detection
// ============================================
// This detects which FortiGate page is active and routes to appropriate monitor

console.log('🔀 URL Router Loaded');

const FortiGateRouter = {
    // Define all FortiGate pages with their URL patterns and metadata
    routes: {
        FIREWALL_POLICY: {
            patterns: ['/firewall/policy/policy', '/ng/firewall/policy'],
            name: 'Firewall Policy',
            icon: '🛡️',
            monitor: 'policy-monitor-v2.js'
        },
        DOS_POLICY: {
            patterns: [
                '/firewall/policy/DoS-policy',
                '/ng/firewall/policy/DoS-policy',
                '/firewall/DoS-policy',
                '/firewall/dos-policy'
            ],
            name: 'DoS Policy',
            icon: '🚫',
            monitor: 'dos-policy-monitor.js'
        },
        NETWORK_INTERFACE: {
            patterns: ['/ng/interface', '/network/interface'],
            name: 'Network Interface',
            icon: '🌐',
            monitor: 'network-interface-monitor.js'
        },
        ADMIN_USER: {
            patterns: ['/system/admin/admin', '/ng/system/admin'],
            name: 'Admin User',
            icon: '👤',
            monitor: 'user-admin-monitor.js'
        },
        VPN_IPSEC: {
            patterns: ['/vpn/ipsec', '/ng/vpn/ipsec'],
            name: 'IPSec VPN',
            icon: '🔐',
            monitor: 'vpn-monitor.js'
        },
        FIREWALL_ADDRESS: {
            patterns: ['/firewall/address', '/ng/firewall/address'],
            name: 'Firewall Address',
            icon: '📍',
            monitor: 'address-monitor.js'
        },
        STATIC_ROUTE: {
            patterns: ['/router/static', '/ng/router/static'],
            name: 'Static Route',
            icon: '🛣️',
            monitor: 'route-monitor.js'
        }
    },

    // Detect current page
    detectCurrentPage() {
        const currentPath = window.location.pathname;
        const currentUrl = window.location.href;

        console.log('🔍 Detecting page:', currentPath);

        for (const [key, route] of Object.entries(this.routes)) {
            for (const pattern of route.patterns) {
                if (currentPath.includes(pattern)) {
                    console.log(`✅ Matched: ${route.icon} ${route.name}`);
                    return {
                        type: key,
                        ...route,
                        path: currentPath,
                        url: currentUrl
                    };
                }
            }
        }

        console.log('❌ No specific page detected');
        return null;
    },

    // Check if page is in edit/create mode (DOM-based, not URL-based)
    isEditMode() {
        // Check DOM for edit/create indicators
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, .page-title, .heading, [class*="title"]'));
        
        for (const heading of headings) {
            const text = heading.textContent.toLowerCase();
            if (text.includes('create') || text.includes('edit') || text.includes('new') || text.includes('modify')) {
                return true;
            }
        }
        
        // Check for form presence
        const forms = document.querySelectorAll('form');
        return forms.length > 0;
    },

    // Extract action from DOM (not URL)
    getAction() {
        console.log('🔍 Detecting action from DOM...');
        
        // Check headings first (most reliable)
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, .page-title, .heading, [class*="title"]'));
        
        for (const heading of headings) {
            const text = heading.textContent.toLowerCase();
            console.log('   Checking heading:', text.substring(0, 50));
            
            if (text.includes('create new') || text.includes('add new')) {
                console.log('   ✅ Action: CREATE (from heading)');
                return 'CREATE';
            }
            if (text.includes('edit') || text.includes('modify')) {
                console.log('   ✅ Action: EDIT (from heading)');
                return 'EDIT';
            }
            if (text.includes('clone') || text.includes('copy')) {
                console.log('   ✅ Action: CLONE (from heading)');
                return 'CLONE';
            }
        }
        
        // Check buttons
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
        for (const button of buttons) {
            const text = button.textContent.toLowerCase();
            if (text.includes('create') && !text.includes('cancel')) {
                console.log('   ✅ Action: CREATE (from button)');
                return 'CREATE';
            }
            if (text.includes('update') || text.includes('save changes')) {
                console.log('   ✅ Action: EDIT (from button)');
                return 'EDIT';
            }
        }
        
        // Check if form has pre-filled values (indicates EDIT)
        const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="number"], textarea'));
        const hasValues = inputs.some(input => input.value && input.value.trim().length > 0);
        if (hasValues) {
            console.log('   ✅ Action: EDIT (form has values)');
            return 'EDIT';
        }
        
        console.log('   ⚠️ Action: VIEW (default)');
        return 'VIEW';
    },

    // Get page context (DOM-based detection)
    getPageContext() {
        const page = this.detectCurrentPage();
        if (!page) return null;

        const action = this.getAction(); // DOM-based, not URL-based
        const isEditMode = this.isEditMode(); // DOM-based, not URL-based

        return {
            ...page,
            action,
            isEditMode,
            timestamp: new Date().toISOString()
        };
    }
};

// Export for use in other scripts
window.FortiGateRouter = FortiGateRouter;

// Log current page on load
const currentPage = FortiGateRouter.getPageContext();
if (currentPage) {
    console.log(`📄 Current Page: ${currentPage.icon} ${currentPage.name} (${currentPage.action})`);
}
