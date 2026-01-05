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

        if (msg.type === 'UNIVERSAL_EVENT_SAVED') {
            console.log('📥 Unified Collector received SAVE event');
            processUniversalEvent(msg.data, false);
        }
        // LIVE STREAMING: Listen for real-time changes during editing
        else if (msg.type === 'UNIVERSAL_STREAM_EVENT') {
            console.log('🌊 Unified Collector received STREAM event');
            processStreamEvent(msg.data);
        }
    });

    /**
     * Process & Normalize Data
     */
    function processUniversalEvent(rawData, isStreaming = false) {
        if (!vendorMap) {
            console.warn('⚠️ Vendor map not loaded yet, processing with raw keys.');
        }

        const { before, after, changes, timestamp } = rawData;
        const url = window.location.href;

        // 1. Detect Vendor & Object Type
        const vendor = detectVendor(url);
        const objectType = detectObjectType(url);

        console.log(`🔎 Detected: ${vendor} / ${objectType}`);

        // CRITICAL: Filter out unknown objects
        if (objectType === 'unknown_object') {
            console.warn('⚠️ Unknown object type detected - sample will NOT be stored for training');
            console.warn('   URL:', url);
            return;
        }

        // 2. Map fields to canonical names
        let canonicalBefore = mapFields(before, vendor, objectType);
        let canonicalAfter = mapFields(after, vendor, objectType);

        // 3. Map changes
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
                    new: normalizeValue(change.new_value)
                });
            }
        });

        // Object-Specific Post-Processing (Port Flattening for services)
        if (objectType === 'service') {
            const flattenPortRange = (obj) => {
                if (obj.port_lower !== undefined && obj.port_upper !== undefined) {
                    obj.port_range = `${obj.port_lower}-${obj.port_upper}`;
                    delete obj.port_lower;
                    delete obj.port_upper;
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

            const lowerChange = canonicalChanges.find(c => c.field === 'port_lower');
            const upperChange = canonicalChanges.find(c => c.field === 'port_upper');

            if (lowerChange || upperChange) {
                const oldRange = `${lowerChange ? lowerChange.old : (canonicalBefore.port_lower || '')}-${upperChange ? upperChange.old : (canonicalBefore.port_upper || '')}`.replace(/^-|-$/, '');
                const newRange = `${lowerChange ? lowerChange.new : (canonicalAfter.port_lower || '')}-${upperChange ? upperChange.new : (canonicalAfter.port_upper || '')}`.replace(/^-|-$/, '');

                for (let i = canonicalChanges.length - 1; i >= 0; i--) {
                    if (canonicalChanges[i].field === 'port_lower' || canonicalChanges[i].field === 'port_upper') {
                        canonicalChanges.splice(i, 1);
                    }
                }

                canonicalChanges.push({
                    field: 'port_range',
                    old: oldRange,
                    new: newRange
                });
            }
        }

        // Determine Operation Mode (Deterministic Labeling)
        const identityField = config?.identity_field;
        let isCreate = true;

        if (identityField) {
            const identityValue = canonicalBefore[identityField];
            isCreate = !identityValue || identityValue === '' || identityValue === null || identityValue === undefined;
            console.log(`🏷️  Deterministic Labeling: Identity Field [${identityField}] = "${identityValue || 'EMPTY'}" -> ${isCreate ? 'CREATE' : 'EDIT'}`);
        } else {
            isCreate = Object.keys(canonicalBefore).length === 0;
            console.log(`🏷️  Heuristic Labeling (Fallback): before state empty -> ${isCreate ? 'CREATE' : 'EDIT'}`);
        }

        const operation = isCreate ? 'CREATE' : 'EDIT';

        // Construct Canonical Sample
        const sample = {
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

        // Log sample quality metrics
        const beforeFieldCount = Object.keys(canonicalBefore).length;
        const afterFieldCount = Object.keys(canonicalAfter).length;
        const changeCount = canonicalChanges.length;

        console.log(`📊 Sample quality: before=${beforeFieldCount} fields, after=${afterFieldCount} fields, changes=${changeCount}`);

        if (beforeFieldCount === 0 && afterFieldCount === 0) {
            const rawBeforeCount = Object.keys(before).length;
            const rawAfterCount = Object.keys(after).length;

            if (rawBeforeCount > 0 || rawAfterCount > 0) {
                console.error('❌ MAPPING ERROR: Raw fields existed but were ALL filtered out by strict whitelist.');
                console.error(`   Raw Before: ${rawBeforeCount}, Raw After: ${rawAfterCount}`);
                console.error('   Please update vendor_field_map.json with correct mappings.');
                return;
            }
        }

        // FOR SAVE EVENTS: Store & Broadcast (not for streaming)
        if (!isStreaming) {
            allSamples.push(sample);
            collectionStats.total++;
            collectionStats.by_type[objectType] = (collectionStats.by_type[objectType] || 0) + 1;

            console.log('✅ Canonical Sample Collected:', sample);

            // Send new ML Sample
            window.postMessage({
                type: 'ML_UNIFIED_SAMPLE',
                sampleType: objectType,
                data: sample
            }, '*');

            // Send Legacy Event (for Tray App notification)
            dispatchLegacyEvent(sample);
        }

        // RUN INFERENCE (for both streaming and save events)
        if (!mlEngine && window.MLInference && window.__ML_MODEL_URL__) {
            console.log('🧠 Initializing ML Inference Engine...');
            window.MLInference.loadModel(window.__ML_MODEL_URL__).then(data => {
                mlEngine = new window.MLInference(data);
                console.log('✅ ML Inference Engine Ready');
                runPrediction(sample, isStreaming);
            }).catch(err => {
                console.error('❌ Failed to load ML model:', err);
            });
        } else if (mlEngine) {
            runPrediction(sample, isStreaming);
        }
    }

    /**
     * Stream event processing with change detection (LIVE PREDICTIONS)
     */
    function processStreamEvent(rawData) {
        // Reuse the same logic but mark as streaming
        processUniversalEvent(rawData, true);
    }

    /**
     * Map raw fields to canonical names
                canonicalChanges.push({
                    field: canonicalField,
                    old: normalizeValue(change.old_value),
                    new: normalizeValue(change.new_value)
                });
            } else {
                console.log(`🗑️ Dropped change for non-canonical field: ${change.field}`);
            }
        });

        // --- NEW: Object-Specific Post-Processing (Flattening) ---
        if (objectType === 'service') {
            const flattenPortRange = (obj) => {
                if (obj.port_lower !== undefined && obj.port_upper !== undefined) {
                    obj.port_range = `${obj.port_lower}-${obj.port_upper}`;
                    delete obj.port_lower;
                    delete obj.port_upper;
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

            // Flatten changes too
            const lowerChange = canonicalChanges.find(c => c.field === 'port_lower');
            const upperChange = canonicalChanges.find(c => c.field === 'port_upper');

            if (lowerChange || upperChange) {
                const oldRange = `${lowerChange ? lowerChange.old : (canonicalBefore.port_lower || '')}-${upperChange ? upperChange.old : (canonicalBefore.port_upper || '')}`.replace(/^-|-$/, '');
                const newRange = `${lowerChange ? lowerChange.new : (canonicalAfter.port_lower || '')}-${upperChange ? upperChange.new : (canonicalAfter.port_upper || '')}`.replace(/^-|-$/, '');

                // Remove the raw changes
                for (let i = canonicalChanges.length - 1; i >= 0; i--) {
                    if (canonicalChanges[i].field === 'port_lower' || canonicalChanges[i].field === 'port_upper') {
                        canonicalChanges.splice(i, 1);
                    }
                }

                canonicalChanges.push({
                    field: 'port_range',
                    old: oldRange,
                    new: newRange
                });
            }
        }

        // 4. Validate sample quality - ensure no DOM noise leaked through
        const allFields = [
            ...Object.keys(canonicalBefore),
            ...Object.keys(canonicalAfter),
            ...canonicalChanges.map(c => c.field)
        ];

        const domNoiseDetected = allFields.some(field => isDOMNoise(field));
        if (domNoiseDetected) {
            console.error('❌ CRITICAL: DOM noise detected in canonical sample!');
            console.error('   Fields:', allFields.filter(f => isDOMNoise(f)));
            console.error('   This sample will be stored but should be investigated.');
        }

        // 5. Determine Operation Mode (Deterministic Labeling)
        const identityField = config?.identity_field;
        let isCreate = true;

        if (identityField) {
            const identityValue = canonicalBefore[identityField];
            // If identity field is missing/empty/null in 'before' state, it's a CREATE
            isCreate = !identityValue || identityValue === '' || identityValue === null || identityValue === undefined;
            console.log(`🏷️ Deterministic Labeling: Identity Field [${identityField}] = "${identityValue || 'EMPTY'}" -> ${isCreate ? 'CREATE' : 'EDIT'}`);
        } else {
            // Fallback for objects without fixed identity fields
            isCreate = Object.keys(canonicalBefore).length === 0;
            console.log(`🏷️ Heuristic Labeling (Fallback): before state empty -> ${isCreate ? 'CREATE' : 'EDIT'}`);
        }

        const operation = isCreate ? 'CREATE' : 'EDIT';

        // 6. Construct Canonical Sample
        const sample = {
            metadata: {
                timestamp: timestamp || Date.now(),
                vendor: vendor,
                object_type: objectType,
                operation: operation, // Deterministic Label
                data_source: 'universal_extractor'
            },
            data: {
                before: canonicalBefore,
                after: canonicalAfter
            },
            changes: canonicalChanges
        };

        // 7. Log sample quality metrics
        const beforeFieldCount = Object.keys(canonicalBefore).length;
        const afterFieldCount = Object.keys(canonicalAfter).length;
        const changeCount = canonicalChanges.length;

        console.log(`📊 Sample quality: before=${beforeFieldCount} fields, after=${afterFieldCount} fields, changes=${changeCount}`);

        if (beforeFieldCount === 0 && afterFieldCount === 0) {
            // Check if we HAD raw fields but they were ALL filtered out
            const rawBeforeCount = Object.keys(before).length;
            const rawAfterCount = Object.keys(after).length;

            if (rawBeforeCount > 0 || rawAfterCount > 0) {
                console.error('❌ MAPPING ERROR: Raw fields existed but were ALL filtered out by strict whitelist.');
                console.error(`   Raw Before: ${rawBeforeCount}, Raw After: ${rawAfterCount}`);
                console.error('   Please update vendor_field_map.json with correct mappings.');
                return; // Do NOT store this invalid sample
            } else {
                console.warn('⚠️ WARNING: Both before and after are empty - this is likely a CREATE event');
                console.warn('   Consider capturing initial form state for better training data');
            }
        }

        // 7. Store & Broadcast
        allSamples.push(sample);

        // Update stats
        collectionStats.total++;
        collectionStats.by_type[objectType] = (collectionStats.by_type[objectType] || 0) + 1;

        console.log('✅ Canonical Sample Collected:', sample);

        // a) Send new ML Sample
        window.postMessage({
            type: 'ML_UNIFIED_SAMPLE',
            sampleType: objectType, // 'policy', 'admin_user', etc.
            data: sample
        }, '*');

        // b) Send Legacy Event (for Tray App notification)
        dispatchLegacyEvent(objectType, url, operation);

        // Run Inference
        if (!mlEngine && window.MLInference && window.__ML_MODEL_URL__) {
            console.log('🧠 Initializing ML Inference Engine...');
            window.MLInference.loadModel(window.__ML_MODEL_URL__).then(data => {
                mlEngine = new window.MLInference(data);
                console.log('✅ ML Inference Engine Ready');
                runPrediction(sample);
            }).catch(err => {
                console.error('❌ Failed to load ML model:', err);
            });
        } else if (mlEngine) {
            runPrediction(sample);
        }
    }

    /**
     * Run prediction and log results
     */
    function runPrediction(sample, isStreaming = false) {
        if (!mlEngine) return;

        try {
            const prediction = mlEngine.predict(sample);
            if (prediction) {
                const source = isStreaming ? '🌊 LIVE' : '💾 SAVED';
                console.log(`${source} ML Prediction:`, prediction.label || prediction.predicted_class);
                console.log(`   - Confidence: ${(prediction.confidence * 100).toFixed(2)}%`);

                // Send to UI
                window.postMessage({
                    type: 'ML_PREDICTION_RESULT',
                    data: prediction,
                    isStreaming: isStreaming,
                    confidence: prediction.confidence || 'N/A'
                }, '*');
            }
        } catch (err) {
            console.error('ML prediction error:', err);
        }
    }

    /**
     * Show prediction notification to user
     */
    function showPredictionNotification(prediction, sample) {
        // Create a notification element
        const notification = document.createElement('div');
        notification.id = 'ml-prediction-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            font-weight: 500;
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
            max-width: 350px;
            word-wrap: break-word;
        `;

        const confidence = (prediction.confidence * 100).toFixed(1);
        const objectType = sample.metadata.object_type || 'Object';
        const changeCount = sample.changes.length;

        notification.innerHTML = `
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <div style="font-size: 20px; margin-top: 2px;">🤖</div>
                <div>
                    <div style="font-weight: 600; margin-bottom: 4px;">ML Analysis</div>
                    <div style="font-size: 13px; opacity: 0.95;">
                        <strong>${objectType}</strong> - ${changeCount} field(s) changed<br>
                        Confidence: <strong>${confidence}%</strong>
                    </div>
                </div>
            </div>
        `;

        // Add CSS animation
        if (!document.getElementById('ml-notification-styles')) {
            const style = document.createElement('style');
            style.id = 'ml-notification-styles';
            style.textContent = `
                @keyframes slideIn {
                    from {
                        transform: translateX(400px);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
                
                @keyframes slideOut {
                    from {
                        transform: translateX(0);
                        opacity: 1;
                    }
                    to {
                        transform: translateX(400px);
                        opacity: 0;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        // Remove old notification if exists
        const oldNotif = document.getElementById('ml-prediction-notification');
        if (oldNotif) {
            oldNotif.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => oldNotif.remove(), 300);
        }

        document.body.appendChild(notification);

        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            if (notification && notification.parentElement) {
                notification.style.animation = 'slideOut 0.3s ease-out';
                setTimeout(() => notification.remove(), 300);
            }
        }, 5000);
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