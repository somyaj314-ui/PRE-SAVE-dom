// vendor-map-loader.js - Loads vendor field map from data attribute
(function () {
    'use strict';

    // Get the JSON from the script's data attribute
    const script = document.currentScript;
    const mapData = script?.getAttribute('data-vendor-map');

    if (mapData) {
        try {
            const vendorMap = JSON.parse(mapData);
            console.log('🗺️ Vendor field map loaded');

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
