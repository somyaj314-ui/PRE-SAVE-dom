// ml-unified-collector.js - Universal Vendor-Agnostic Collector
// Receives generic 'UNIVERSAL_EVENT_SAVED' from universal_field_extractor.js
// Applies vendor_field_map.json to create canonical training data.

(function () {
    'use strict';

    console.log('🤖 ML Unified Collector (Universal) Initialized');

    let allSamples = [];
    let vendorMap = null;
    let mlEngine = null;

    // Stats for the new universal system
    let collectionStats = {
        total: 0,
        by_type: {}
    };

    /**
     * Listen for Vendor Map from content.js
     */
    window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        if (event.data.type === 'VENDOR_MAP_LOADED') {
            vendorMap = event.data.data;
            console.log('🗺️ Unified Collector received Vendor Map:', Object.keys(vendorMap || {}));
        }
    });

    /**
     * Listen for Universal Events
     */
    window.addEventListener('message', function (event) {
        if (event.source !== window) return;

        const msg = event.data;

        if (msg.type === 'UNIVERSAL_MONITOR_START') {
            console.log('👁️ Monitoring Started:', msg.data.url);
        } else if (msg.type === 'UNIVERSAL_EVENT_SAVED') {
            console.log('📥 Unified Collector received SAVE event');
            processUniversalEvent(msg.data);
        } else if (msg.type === 'UNIVERSAL_STREAM_EVENT') {
            // High frequency updates from forms
            processStreamEvent(msg.data);
        }
    });

    /**
     * Create Canonical Sample from Raw Data
     */
    function createCanonicalSample(rawData) {
        if (!vendorMap) {
            console.warn('⚠️ Vendor map not loaded yet, processing with raw keys.');
        }

        const { before, after, changes, timestamp } = rawData;
        const url = window.location.href;

        // 1. Detect Vendor & Object Type
        const vendor = detectVendor(url);
        const objectType = detectObjectType(url);

        // Filter out unknown objects
        if (objectType === 'unknown_object') return null;

        // 2. Map fields to canonical names
        let canonicalBefore = mapFields(before, vendor, objectType);
        let canonicalAfter = mapFields(after, vendor, objectType);

        // 3. Map changes with STRICT canonical filtering
        const config = vendorMap?.[vendor]?.[objectType];
        const mapping = config?.mappings || {};
        const allowedFields = config?.canonical_fields || [];

        const canonicalChanges = [];
        changes.forEach(change => {
            let canonicalField = mapping[change.field] || change.field;
            if (allowedFields.includes(canonicalField) || canonicalField === 'port_lower' || canonicalField === 'port_upper') {
                canonicalChanges.push({
                    field: canonicalField,
                    old: normalizeValue(change.old_value),
                    new: normalizeValue(change.new_value),
                    op: change.op // Preserve operation (add/remove/set)
                });
            }
        });

        // 4. Object-Specific Post-Processing (Flattening)
        if (objectType === 'service') {
            const flattenPortRange = (obj) => {
                if (obj.port_lower !== undefined && obj.port_upper !== undefined) {
                    obj.port_range = `${obj.port_lower}-${obj.port_upper}`;
                    delete obj.port_lower; delete obj.port_upper;
                } else if (obj.port_lower !== undefined) {
                    obj.port_range = `${obj.port_lower}`;
                    delete obj.port_lower;
                } else if (obj.port_upper !== undefined) {
                    obj.port_range = `${obj.port_upper}`;
                    delete obj.port_upper;
                }
            };
            flattenPortRange(canonicalBefore);
            flattenPortRange(canonicalAfter);
        }

        // 5. Determine Operation Mode
        const identityField = config?.identity_field;
        let isCreate = true;

        if (identityField) {
            // Strongest signal: Does the identity field (e.g. policy_id, name) have a value in the BEFORE state?
            const identityValue = canonicalBefore[identityField];
            // Check for valid existing ID: not null, not undefined, not empty string, not 0 (if number)
            isCreate = !identityValue || identityValue === '' || identityValue === null || identityValue === undefined || identityValue === 0 || identityValue === '0';
        } else {
            // Fallback: If we have substantial before state, it's likely an edit.
            // A "Create New" form typically has very few populated fields compared to an "Edit" form on load.
            // However, relying solely on this is risky if defaults are extensive.
            // Better to assume CREATE unless proven otherwise by identity field.
            isCreate = Object.keys(canonicalBefore).length === 0;
        }

        // Logic check: If it's a "policy" object, and we have a policy_id, it's definitely an EDIT
        if (objectType === 'policy' && canonicalBefore['policy_id'] && canonicalBefore['policy_id'] !== '0') {
            isCreate = false;
        }

        const operation = isCreate ? 'CREATE' : 'EDIT';

        // 6. Construct Sample
        return {
            metadata: {
                timestamp: timestamp || Date.now(),
                vendor: vendor,
                object_type: objectType,
                operation: operation,
                data_source: 'universal_extractor'
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
        const sample = createCanonicalSample(rawData);
        if (!sample) return;

        console.log(`🔎 Detected (Save): ${sample.metadata.vendor} / ${sample.metadata.object_type}`);

        // Store & Stats
        allSamples.push(sample);
        collectionStats.total++;
        collectionStats.by_type[sample.metadata.object_type] = (collectionStats.by_type[sample.metadata.object_type] || 0) + 1;

        console.log('✅ Canonical Sample Collected:', sample);

        // Broadcast for Tray App
        dispatchLegacyEvent(sample.metadata.object_type, window.location.href, sample.metadata.operation);

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
        const sample = createCanonicalSample(rawData);
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
            // console.log(`🔮 Prediction (${isStreaming ? 'Live' : 'Final'}):`, prediction.label);

            // Broadcast prediction result
            window.postMessage({
                type: 'ML_PREDICTION_RESULT',
                data: prediction,
                isStreaming: isStreaming // CRITICAL: Tell the world if this is pre-save
            }, '*');
        }
    }

    /**
     * Normalize value to proper type (boolean, number, string)
     * Normalize value to proper type (boolean, number, string)
     */
    function normalizeValue(value) {
        // Null/undefined passthrough
        if (value === null || value === undefined) return value;

        // Array normalization (recursive)
        if (Array.isArray(value)) {
            return value.map(v => normalizeValue(v));
        }

        // Boolean normalization
        if (typeof value === 'string') {
            const lower = value.toLowerCase().trim();
            if (lower === 'on' || lower === 'checked' || lower === 'enabled' || lower === 'yes') return true;
            if (lower === 'off' || lower === 'unchecked' || lower === 'disabled' || lower === 'no') return false;
            if (lower === 'true') return true;
            if (lower === 'false') return false;

            // Number normalization
            if (!isNaN(value) && value.trim() !== '') {
                return Number(value);
            }
        }

        return value; // Keep as-is
    }

    /**
     * Dispatch Legacy Events for Tray App (Backward Compatibility)
     */
    function dispatchLegacyEvent(objectType, url, operation) {
        const isCreate = operation === 'CREATE';
        const mode = isCreate ? 'create' : 'edit';

        if (objectType === 'policy') {
            window.postMessage({
                type: 'POLICY_CHANGE',
                eventType: isCreate ? 'POLICY_CREATED' : 'POLICY_EDITED',
                data: {
                    mode: mode,
                    status: 'saved',
                    url: url,
                    title: document.title,
                    timestamp: Date.now()
                }
            }, '*');
            console.log('📨 Sent Legacy POLICY_CHANGE for Tray App');
        }
        else if (objectType === 'admin_user') {
            window.postMessage({
                type: 'ADMIN_USER_CHANGE',
                eventType: isCreate ? 'ADMIN_USER_CREATED' : 'ADMIN_USER_MODIFIED',
                data: {
                    username: 'Admin User', // Universal extractor might not extract specific name easily here without mapping check
                    userType: 'admin',
                    url: url,
                    timestamp: Date.now()
                }
            }, '*');
            console.log('📨 Sent Legacy ADMIN_USER_CHANGE for Tray App');
        }
        else if (objectType === 'dos_policy') {
            window.postMessage({
                type: 'DOS_POLICY_CHANGE',
                eventType: isCreate ? 'DOS_POLICY_CREATED' : 'DOS_POLICY_EDITED',
                data: {
                    mode: mode,
                    status: 'saved',
                    url: url,
                    timestamp: Date.now()
                }
            }, '*');
            console.log('📨 Sent Legacy DOS_POLICY_CHANGE for Tray App');
        }
        else if (objectType === 'vpn_ipsec_tunnel') {
            window.postMessage({
                type: 'VPN_CHANGE',
                eventType: isCreate ? 'VPN_CREATED' : 'VPN_MODIFIED',
                data: {
                    mode: mode,
                    url: url,
                    timestamp: Date.now()
                }
            }, '*');
            console.log('📨 Sent Legacy VPN_CHANGE for Tray App');
        }
        else if (objectType === 'network_interface') {
            window.postMessage({
                type: 'INTERFACE_CHANGE',
                eventType: isCreate ? 'INTERFACE_CREATED' : 'INTERFACE_MODIFIED',
                data: {
                    mode: mode,
                    url: url,
                    timestamp: Date.now()
                }
            }, '*');
            console.log('📨 Sent Legacy INTERFACE_CHANGE for Tray App');
        }
        else if (objectType === 'firewall_address') {
            window.postMessage({
                type: 'ADDRESS_CHANGE',
                eventType: isCreate ? 'ADDRESS_CREATED' : 'ADDRESS_MODIFIED',
                data: {
                    mode: mode,
                    url: url,
                    timestamp: Date.now()
                }
            }, '*');
            console.log('📨 Sent Legacy ADDRESS_CHANGE for Tray App');
        }
        else if (objectType === 'central_snat') {
            window.postMessage({
                type: 'SNAT_CHANGE',
                eventType: isCreate ? 'SNAT_CREATED' : 'SNAT_MODIFIED',
                data: {
                    mode: mode,
                    url: url,
                    timestamp: Date.now()
                }
            }, '*');
            console.log('📨 Sent Legacy SNAT_CHANGE for Tray App');
        }
        // Add other legacy types as needed
    }

    /**
     * Detect Vendor from URL
     */
    function detectVendor(url) {
        if (url.includes('paloaltonetworks') || url.includes('#objects') || url.includes('#device') || url.includes('#network') || url.includes('#monitor')) {
            return 'paloalto';
        }
        // Default to FortiGate as it's the primary vendor
        return 'fortigate';
    }

    /**
     * Detect Object Type from URL (Heuristic)
     * Expanded to support all object types in vendor_field_map.json
     */
    function detectObjectType(url) {
        const u = url.toLowerCase();

        // Palo Alto Detection
        if (u.includes('device/administrators')) return 'admin_user';
        if (u.includes('objects/addresses')) return 'firewall_address';
        if (u.includes('policies/pbf-rulebase')) return 'pbf_rule'; // New PBF Rule support

        // IMPORTANT: Check most specific patterns FIRST

        // NAT (Check before Policy because URLs can contain both 'policy' and 'snat')
        if (u.includes('snat') || u.includes('central-snat')) return 'central_snat';

        // DoS policy must be checked BEFORE regular policy
        if (u.includes('dos') && u.includes('policy')) return 'dos_policy';
        if (u.includes('dos-policy')) return 'dos_policy';

        // Policy types (check after DoS and NAT)
        if (u.includes('policy/policy') || u.includes('firewall/policy')) return 'policy';

        // Admin & Authentication
        if (u.includes('admin') && u.includes('user')) return 'admin_user';
        if (u.includes('admin') && u.includes('edit')) return 'admin_user';
        if (u.includes('/ng/admin')) return 'admin_user'; // FortiGate Angular UI

        // VPN
        if (u.includes('vpn') && (u.includes('ipsec') || u.includes('tunnel'))) return 'vpn_ipsec_tunnel';

        // Network
        if (u.includes('system/interface') || u.includes('network/interface') || u.includes('ng/interface')) return 'network_interface';

        // Firewall Objects
        if (u.includes('firewall/address')) return 'firewall_address';
        if (u.includes('firewall/service')) return 'service';

        return 'unknown_object';
    }

    /**
     * Check if a field key is DOM/UI noise that should be filtered out
     */
    function isDOMNoise(key) {
        const noisePatterns = [
            /^for_id_/,           // for_id_mj6po5w1 - session-specific DOM IDs
            /^radio_id/,          // radio_idmj6po5vu - UI radio button IDs
            /^__/,                // __internal - private variables
            /^_ng/,               // _ngcontent - Angular internal
            /^data-ng/,           // data-ng-* - Angular directives
            /^\$/,                // $scope, $ctrl - Angular scope (but NOT ng:$ctrl.field)
            /^aria-/,             // aria-* - UI accessibility attributes
            /^data-/              // data-* - generic data attributes
        ];

        return noisePatterns.some(pattern => pattern.test(key));
    }

    /**
     * Map a single key (legacy - now uses mapFields for strict filtering)
     */
    function mapKey(key, vendor, objectType) {
        if (!vendorMap) return key;
        try {
            const mapping = vendorMap[vendor]?.[objectType]?.mappings;
            if (mapping && mapping[key]) {
                return mapping[key];
            }
        } catch (e) {
            // ignore
        }
        return key; // Fallback to raw key
    }

    /**
     * Map entire object with STRICT CANONICAL FILTERING
     * Only fields in canonical_fields whitelist are kept
     */
    function mapFields(obj, vendor, objectType) {
        if (!obj) return {};

        const config = vendorMap?.[vendor]?.[objectType];
        const mapping = config?.mappings || {};
        const allowedFields = config?.canonical_fields || [];

        const mapped = {};
        const dropped = [];

        // If no vendor map, at least filter DOM noise and normalize
        if (!config) {
            Object.keys(obj).forEach(k => {
                if (!isDOMNoise(k)) {
                    mapped[k] = normalizeValue(obj[k]);
                } else {
                    dropped.push(k);
                }
            });

            if (dropped.length > 0) {
                console.log(`🗑️ Dropped DOM noise (no mapping for ${objectType}):`, dropped.slice(0, 10));
            }
            return mapped;
        }

        // STRICT MODE: Only keep fields in canonical whitelist
        Object.keys(obj).forEach(k => {
            // Skip obvious DOM noise first
            if (isDOMNoise(k)) {
                dropped.push(`${k} (DOM noise)`);
                return;
            }

            // Try to map the key
            const mappedKey = mapping[k];

            if (mappedKey) {
                // Key has a mapping - check if mapped key is in whitelist
                if (allowedFields.includes(mappedKey)) {
                    mapped[mappedKey] = normalizeValue(obj[k]);
                } else {
                    dropped.push(`${k} → ${mappedKey} (not in whitelist)`);
                }
            } else {
                // No mapping - check if original key is in whitelist
                if (allowedFields.includes(k)) {
                    mapped[k] = normalizeValue(obj[k]);
                } else {
                    dropped.push(`${k} (unmapped, not in whitelist)`);
                }
            }
        });

        // Log dropped fields for debugging
        if (dropped.length > 0) {
            console.log(`🗑️ Dropped non-canonical fields (${objectType}):`, dropped.slice(0, 15));
            if (dropped.length > 15) {
                console.log(`   ... and ${dropped.length - 15} more`);
            }
        }

        return mapped;
    }

    // --- Export / Download Utils (Preserved from old version) ---

    function downloadUnifiedSamples() {
        const exportData = {
            version: "2.0-universal",
            stats: collectionStats,
            samples: allSamples
        };
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

    // Initialize Shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'D') {
            e.preventDefault();
            downloadUnifiedSamples();
        }
        if (e.ctrlKey && e.shiftKey && e.key === 'C') {
            if (confirm('Clear all samples?')) clearAllSamples();
        }
    });

    // Expose Global API
    window.MLUnifiedCollector = {
        downloadUnifiedSamples,
        clearAllSamples,
        getAllSamples: () => allSamples
    };

})();