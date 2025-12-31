// vendor-map-loader.js - Loads vendor field map from data attribute
(function () {
    'use strict';

    // Get the JSON from the script's data attribute
    const script = document.currentScript;
    const mapData = script?.getAttribute('data-vendor-map');

    if (mapData) {
        try {
            const vendorMap = JSON.parse(mapData);
            window.__VENDOR_MAP__ = vendorMap; // Global fallback for race resilience
            console.log('🗺️ Vendor field map loaded and globally registered');

            // Post to window so ml-unified-collector can receive it
            window.postMessage({
                type: 'VENDOR_MAP_LOADED',
                data: vendorMap
            }, '*');
        } catch (e) {
            console.error('❌ Failed to parse vendor map:', e);
        }
    }
})();
