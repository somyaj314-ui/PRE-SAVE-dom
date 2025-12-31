// ml-unified-collector.js - Universal Vendor-Agnostic Collector
// Receives generic 'UNIVERSAL_EVENT_SAVED' from universal_field_extractor.js
// Applies vendor_field_map.json to create canonical training data.

(function () {
    'use strict';

    // RE-INJECTION CLEANUP
    if (typeof window.__STOP_ML_COLLECTOR__ === 'function') {
        try {
            console.log('♻️ Re-injection: Cleaning up old ML Collector...');
            window.__STOP_ML_COLLECTOR__();
        } catch (e) { }
    }

    console.log('🤖 ML Unified Collector (Universal) Initialized');

    let allSamples = [];
    let vendorMap = null;
    let mlEngine = null;

    // Stats for the new universal system
    let collectionStats = {
        total: 0,
        by_type: {}
    };

    // Initialize Shortcuts
    const shortcutHandler = (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'D') {
            e.preventDefault();
            downloadUnifiedSamples();
        }
        if (e.ctrlKey && e.shiftKey && e.key === 'C') {
            if (confirm('Clear all samples?')) clearAllSamples();
        }
    };

    const messageHandler = (event) => {
        if (event.source !== window || !event.data || !event.data.type) return;

        // Handle VENDOR_MAP_LOADED
        if (event.data.type === 'VENDOR_MAP_LOADED') {
            vendorMap = event.data.data;
            window.__VENDOR_MAP__ = vendorMap; // Set global for other scripts to see
            console.log('🗺️ Unified Collector received Vendor Map:', Object.keys(vendorMap || {}));
        }
        // Handle UNIVERSAL_MONITOR_START
        else if (event.data.type === 'UNIVERSAL_MONITOR_START') {
            console.log('🏁 Universal Monitor Update received:', event.data.data.url);
        }
        // Handle UNIVERSAL_EVENT_SAVED
        else if (event.data.type === 'UNIVERSAL_EVENT_SAVED') {
            console.log('📥 Unified Collector received SAVE event');
            processUniversalEvent(event.data.data);
        }
        // Handle UNIVERSAL_STREAM_EVENT or UNIVERSAL_STREAM_CHANGE
        else if (event.data.type === 'UNIVERSAL_STREAM_EVENT' || event.data.type === 'UNIVERSAL_STREAM_CHANGE') {
            processStreamEvent(event.data.data);
        }
    };

    window.addEventListener('message', messageHandler);
    document.addEventListener('keydown', shortcutHandler);

    // CLEANUP REGISTRY
    window.__STOP_ML_COLLECTOR__ = () => {
        console.log('🧹 Stopping old ML Collector instances...');
        document.removeEventListener('keydown', shortcutHandler);
        window.removeEventListener('message', messageHandler);
    };

    /**
     * Create Canonical Sample from Raw Data
     */
    function createCanonicalSample(rawData, isStreaming = false) {
        const { before, after, timestamp, url: eventUrl } = rawData;
        const url = eventUrl || window.location.href;

        const vendor = detectVendor(url);
        const objectType = detectObjectType(url);

        // Ensure map is loaded (Fallback to global if message was missed)
        if (!vendorMap && window.__VENDOR_MAP__) {
            vendorMap = window.__VENDOR_MAP__;
        }

        const canonicalBefore = mapFields(before, vendor, objectType);
        const canonicalAfter = mapFields(after, vendor, objectType);
        const canonicalChanges = computeDiff(canonicalBefore, canonicalAfter);

        const config = vendorMap?.[vendor]?.[objectType];
        const identityField = config?.identity_field;
        let isCreate = true;

        if (identityField) {
            const identityValue = canonicalBefore[identityField];
            isCreate = !identityValue || identityValue === '' || identityValue === null || identityValue === undefined || identityValue === 0 || identityValue === '0';
        } else {
            isCreate = Object.keys(canonicalBefore).length === 0;
        }

        // Classification is derived strictly from identity fields above.
        // URL/Title heuristics (Signals 1-4) have been removed to ensure data-derived integrity.

        // Classification is derived strictly from identity fields above.
        // Rule: {} => CREATE.
        // Training: DROP (if before is empty).
        // Inference: No forced labels, rely on provided evidence.

        const operation = isCreate ? 'CREATE' : 'EDIT';

        return {
            metadata: {
                timestamp: timestamp || Date.now(),
                vendor: vendor,
                object_type: objectType,
                operation: operation,
                data_source: 'universal_collector'
            },
            data: {
                before: canonicalBefore,
                after: canonicalAfter
            },
            changes: canonicalChanges
        };
    }

    /**
     * Process Save Event (Post-Save)
     */
    function processUniversalEvent(rawData) {
        // NOISE FILTER: Ignore known noisy/failing endpoints that don't represent real config changes
        const url = window.location.href;
        if (url.includes('security-rating') || url.includes('/monitor/')) {
            console.log('🔇 Noise Filter: Skipping event from monitor endpoint.');
            return;
        }

        const sample = createCanonicalSample(rawData, false);
        if (!sample) return;

        // RULE 2: Binary Save Logic - Authoritative Before must be present (Except for CREATE)
        const beforeCount = Object.keys(sample.data.before).length;
        const isCreate = sample.metadata.operation === 'CREATE';

        if (beforeCount === 0 && !isCreate) {
            console.warn('❌ Dropping training sample: missing authoritative BEFORE state for EDIT');
            return;
        }

        console.log(`🔎 Detected (Save): ${sample.metadata.vendor} / ${sample.metadata.object_type}`);

        // Store & Stats
        allSamples.push(sample);
        collectionStats.total++;
        collectionStats.by_type[sample.metadata.object_type] = (collectionStats.by_type[sample.metadata.object_type] || 0) + 1;

        console.log('✅ Canonical Sample Collected:', sample);

        // Broadcast for Tray App
        if (sample.metadata.operation === 'CREATE' || sample.changes.length > 0) {
            dispatchLegacyEvent(sample);
        } else {
            console.log('ℹ️ No canonical changes detected. Legacy event suppressed.');
        }

        // Run Inference (Final confirmation)
        if (mlEngine) {
            runPrediction(sample, false); // isStreaming = false
        } else if (window.MLInference && window.__ML_MODEL_URL__) {
            window.MLInference.loadModel(window.__ML_MODEL_URL__).then(data => {
                mlEngine = new window.MLInference(data);
                runPrediction(sample, false);
            });
        }
    }

    /**
     * Process Stream Event (Pre-Save)
     */
    function processStreamEvent(rawData) {
        const sample = createCanonicalSample(rawData, true); // isStreaming = true
        if (!sample) return;

        // Run Inference immediately for real-time intent detection
        if (mlEngine) {
            runPrediction(sample, true); // isStreaming = true
        } else if (window.MLInference && window.__ML_MODEL_URL__) {
            window.MLInference.loadModel(window.__ML_MODEL_URL__).then(data => {
                mlEngine = new window.MLInference(data);
                runPrediction(sample, true);
            });
        }
    }

    /**
     * Run prediction and log results
     */
    function runPrediction(sample, isStreaming = false) {
        if (!mlEngine) return;

        const prediction = mlEngine.predict(sample);
        if (prediction) {
            // BROADCAST FILTER: Only raise popup for streaming IF there are actual changes
            // This prevents "Automatic" popups on page land.
            if (isStreaming && sample.changes.length === 0) {
                // Silently log for debug but don't broadast to tray app
                // console.log('🔮 ML Prediction (Idle): Prediction exists but no changes, suppressing popup.');
                return;
            }

            // BROADCAST: Only for streaming (Pre-Save)
            // Post-save inference is silent (logging only)
            if (isStreaming) {
                window.postMessage({
                    type: 'ML_PREDICTION_RESULT',
                    data: prediction,
                    isStreaming: true
                }, '*');
            } else {
                console.log('🔮 ML Post-Save Verification (Silent):', prediction);
            }
        }
    }

    /**
     * Compute Difference between states (Canonical)
     */
    function computeDiff(before, after) {
        const changes = [];
        const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

        allKeys.forEach(key => {
            const b = before[key];
            const a = after[key];

            if (JSON.stringify(b) !== JSON.stringify(a)) {
                changes.push({
                    field: key,
                    old: b,
                    new: a
                });
            }
        });

        return changes;
    }

    /**
     * Normalize value to proper type (boolean, number, string)
     */
    function normalizeValue(value) {
        if (value === null || value === undefined) return value;
        if (Array.isArray(value)) return value.map(v => normalizeValue(v));

        if (typeof value === 'string') {
            const lower = value.toLowerCase().trim();
            if (lower === 'on' || lower === 'checked' || lower === 'enabled' || lower === 'yes') return true;
            if (lower === 'off' || lower === 'unchecked' || lower === 'disabled' || lower === 'no') return false;
            if (lower === 'true') return true;
            if (lower === 'false') return false;

            if (!isNaN(value) && value.trim() !== '') return Number(value);
        }

        return value;
    }

    /**
     * Dispatch Legacy Events for Tray App (Backward Compatibility)
     */
    function dispatchLegacyEvent(sample) {
        const { metadata, data } = sample;
        const objectType = metadata.object_type;
        const operation = metadata.operation;
        const url = window.location.href;

        const isCreate = operation === 'CREATE';
        const mode = isCreate ? 'create' : 'edit';
        const after = data.after || {};

        const types = {
            'policy': 'POLICY_CHANGE',
            'admin_user': 'ADMIN_USER_CHANGE',
            'dos_policy': 'DOS_POLICY_CHANGE',
            'vpn_ipsec_tunnel': 'VPN_CHANGE',
            'network_interface': 'INTERFACE_CHANGE',
            'firewall_address': 'ADDRESS_CHANGE',
            'central_snat': 'CENTRAL_SNAT_CHANGE',
            'service': 'FIREWALL_SERVICE_CHANGE'
        };

        const eventTypeEnum = {
            'policy': isCreate ? 'POLICY_CREATED' : 'POLICY_EDITED',
            'admin_user': isCreate ? 'ADMIN_USER_CREATED' : 'ADMIN_USER_UPDATED',
            'dos_policy': isCreate ? 'DOS_POLICY_CREATED' : 'DOS_POLICY_UPDATED',
            'vpn_ipsec_tunnel': isCreate ? 'VPN_CREATED' : 'VPN_EDITED',
            'network_interface': isCreate ? 'INTERFACE_CREATED' : 'INTERFACE_EDITED',
            'firewall_address': isCreate ? 'ADDRESS_CREATED' : 'ADDRESS_UPDATED',
            'central_snat': isCreate ? 'CENTRAL_SNAT_CREATED' : 'CENTRAL_SNAT_UPDATED',
            'service': isCreate ? 'FIREWALL_SERVICE_CREATED' : 'FIREWALL_SERVICE_UPDATED'
        };

        const type = types[objectType];
        if (type) {
            window.postMessage({
                type: type,
                eventType: eventTypeEnum[objectType],
                data: {
                    mode: mode,
                    username: after.username || after.user_name || after.name || 'Admin User',
                    userType: after.type || 'admin',
                    url: url,
                    title: document.title,
                    timestamp: Date.now()
                }
            }, '*');
            console.log(`📨 Sent Legacy ${type} for Tray App (${operation})`);
        }
    }

    function detectVendor(url) {
        if (url.includes('paloaltonetworks')) return 'paloalto';
        return 'fortigate';
    }

    function detectObjectType(url) {
        const u = url.toLowerCase();
        if (u.includes('device/administrators')) return 'admin_user';
        if (u.includes('objects/addresses')) return 'firewall_address';
        if (u.includes('snat') || u.includes('central-snat')) return 'central_snat';
        if (u.includes('dos') && u.includes('policy')) return 'dos_policy';
        if (u.includes('policy/policy') || u.includes('firewall/policy')) return 'policy';
        if (u.includes('admin') && (u.includes('user') || u.includes('edit')) || u.includes('/ng/admin')) return 'admin_user';
        if (u.includes('vpn') && (u.includes('ipsec') || u.includes('tunnel') || u.includes('wizard') || u.includes('vpnipsec'))) return 'vpn_ipsec_tunnel';
        if (u.includes('interface')) return 'network_interface';
        if (u.includes('firewall/address')) return 'firewall_address';
        if (u.includes('firewall/service')) return 'service';
        return 'unknown_object';
    }

    function isDOMNoise(key) {
        const noisePatterns = [/^for_id_/, /^radio_id/, /^__/, /^_ng/, /^data-ng/, /^\$/, /^aria-/, /^data-/];
        return noisePatterns.some(pattern => pattern.test(key));
    }

    function mapFields(obj, vendor, objectType) {
        if (!obj) return {};
        const config = vendorMap?.[vendor]?.[objectType];
        const mapping = config?.mappings || {};
        const allowedFields = config?.canonical_fields || [];
        const mapped = {};

        Object.keys(obj).forEach(k => {
            if (isDOMNoise(k)) return;
            const mappedKey = mapping[k] || k;
            if (!config || allowedFields.includes(mappedKey)) {
                mapped[mappedKey] = normalizeValue(obj[k]);
            }
        });
        return mapped;
    }

    function downloadUnifiedSamples() {
        const exportData = { version: "2.0-universal", stats: collectionStats, samples: allSamples };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `universal_training_data_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function clearAllSamples() {
        allSamples = [];
        collectionStats = { total: 0, by_type: {} };
        console.log('🗑️ Samples cleared.');
    }

    window.MLUnifiedCollector = { downloadUnifiedSamples, clearAllSamples, getAllSamples: () => allSamples };
})();