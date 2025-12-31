// universal_field_extractor.js - Vendor-Agnostic "Values Only" Extractor
// Captures BEFORE state (on load) and AFTER state (on save)
// No DOM structure, no HTML, just value extraction.

(function () {
    'use strict';

    // RE-INJECTION CLEANUP
    if (typeof window.__STOP_UNIVERSAL_EXTRACTOR__ === 'function') {
        try {
            console.log('♻️ Re-injection: Cleaning up old Universal Extractor...');
            window.__STOP_UNIVERSAL_EXTRACTOR__();
        } catch (e) {
            console.error('Cleanup failed:', e);
        }
    }

    console.log('🌌 Universal Field Extractor Initialized (Streaming Mode)');

    // State storage
    const pageState = {
        authoritativeBefore: {}, // Module A: Pure authoritative state (IMMUTABLE once frozen)
        authoritativeFrozen: false,
        inferenceBaseline: {},     // Module B: UI-derived state for real-time inference (MUTABLE)
        currentForm: null,
        isMonitoring: false,
        saveInProgress: false,      // LOCK: Prevents resets during save
        modifiedFields: new Set(),
        stabilityCount: 0,          // Refinement: Stability tracking
        lastCandidateState: null,
        debounceTimers: new Map(), // For debouncing stream events per field
        pollingInterval: null      // For aggressive SPA entry polling
    };

    const MIN_BASELINE_FIELDS = 1;
    const STABILITY_THRESHOLD = 2; // Must be identical for 2 consecutive polls

    /**
     * Refinement: Check if state contains any vendor-defined identity fields.
     */
    function hasIdentityField(state) {
        if (!state) return null;

        // 1. Check if we have an explicit identity from VENDOR_MAP
        const vendorMap = window.__VENDOR_MAP__;
        if (vendorMap) {
            const url = window.location.href;
            const vendor = url.includes('paloaltonetworks') ? 'paloalto' : 'fortigate';

            for (const typeCfg of Object.values(vendorMap[vendor] || {})) {
                const identityField = typeCfg.identity_field;
                if (identityField && state[identityField]) {
                    const val = state[identityField];
                    if (val && val !== '0' && val !== 0 && val !== '') return val;
                }
            }
        }

        // 2. Fallback: Heuristics for common identity keys (e.g. mkey for FortiGate, id for PaloAlto)
        const commonIdKeys = ['mkey', 'id', 'name', 'username', 'serial', 'tunnel_name', 'tunnelname'];
        for (const key of commonIdKeys) {
            const val = state[key] || state[`ng:${key}`];
            if (val && val !== '0' && val !== 0 && val !== '') return val;
        }

        return null;
    }

    /**
     * Refinement: Structural Wizard Detection.
     * Identifies multi-step containers based on common enterprise UI patterns.
     */
    function isWizardFlow(container) {
        if (!container) return false;

        // 1. Explicit classes/IDs
        const wizardClasses = ['.wizard', '.vpn-wizard', '.f-wizard', '.stepper', '.multi-step', '.vpn-wizard-container'];
        if (wizardClasses.some(cls => container.querySelector(cls) || container.classList.contains(cls.replace('.', '')))) return true;

        // 2. Control Indicators (Next/Back buttons)
        const controls = container.querySelectorAll('button, a, .btn');
        const hasNext = Array.from(controls).some(b => /next|forward|continue|step/i.test(b.textContent));
        const hasBack = Array.from(controls).some(b => /back|previous|prev/i.test(b.textContent));

        // 3. Progress Indicators
        const progress = container.querySelectorAll('.progress, .step-indicator, .nav-tabs, .nav-pills, .stepper-header, .f-stepper');

        // Structural heuristic: A form with both Next/Back or a visible stepper is a wizard
        return (hasNext && hasBack) || progress.length > 0;
    }

    /**
     * Refinement: Check if state contains meaningful non-default data.
     * Rejects states that are just boolean/empty scaffolds.
     */
    function hasNonDefaultValue(state) {
        if (!state) return false;
        const values = Object.values(state);
        return values.some(val => {
            // Ignore booleans (explicit or stringified) as they are the source of most baseline noise.
            if (typeof val === 'boolean') return false;
            if (val === 'true' || val === 'false') return false;
            if (val === null || val === undefined || val === '') return false;
            if (val === '0' || val === 0) return false;
            if (Array.isArray(val) && val.length === 0) return false;
            return true; // Found a "real" value
        });
    }

    /**
     * Module A integrity: Freeze the authoritative baseline only after Stability + Identity detection.
     */
    function tryFreezeAuthoritativeBaseline(currentState) {
        if (pageState.authoritativeFrozen) return;

        const idValue = hasIdentityField(currentState);

        // RULE: We only freeze the authoritative baseline if we have a persistent identity. (Hydrated EDIT)
        // If no identity exists, it remains unfrozen (implicitly CREATE).
        if (!idValue) return;

        const currentJson = JSON.stringify(currentState || {});

        // 1. Stability Tracking
        if (pageState.lastCandidateState === currentJson) {
            pageState.stabilityCount++;
        } else {
            pageState.stabilityCount = 0;
            pageState.lastCandidateState = currentJson;
            return; // State changed, reset and wait
        }

        // 2. Freeze Logic
        // Threshold: 2 polls (approx 2s or 2 discovery cycles)
        if (pageState.stabilityCount >= 2) {
            pageState.authoritativeBefore = JSON.parse(currentJson);
            pageState.authoritativeFrozen = true;
            console.log(`🔒 Authoritative (EDIT) baseline frozen by identity: ${idValue}`);
        }
    }

    // Alias for getFieldKey used in extraction loops
    const getFieldKey = getFieldKeyShared;

    /**
     * SHARED Helper: Get field identifier with priority
     */
    function getFieldKeyShared(el) {
        if (!el) return null;

        // Priority 1: Direct Angular attributes
        const formControlName = el.getAttribute('formcontrolname') || el.getAttribute('formControlName');
        if (formControlName) return `ng:${formControlName}`;

        const ngModel = el.getAttribute('ng-model') || el.getAttribute('data-ng-model');
        if (ngModel) return `ng:${ngModel}`;

        const ngBind = el.getAttribute('ng-bind') || el.getAttribute('ng-value');
        if (ngBind) return `ng:${ngBind}`;

        // Priority 2: Traverse parents for Angular bindings (e.g. Radio Groups)
        let parent = el.parentElement;
        let depth = 0;
        while (parent && depth < 4) {
            const pNav = parent.getAttribute('formcontrolname') || parent.getAttribute('formControlName');
            if (pNav) return `ng:${pNav}`;
            const pMod = parent.getAttribute('ng-model') || parent.getAttribute('data-ng-model');
            if (pMod) return `ng:${pMod}`;
            parent = parent.parentElement;
            depth++;
        }

        // Priority 3: Aria-Label
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) {
            const match = ariaLabel.match(/'([^']+)'/);
            if (match) return `ng:${match[1]}`;
            if (/^[a-z0-9_]+$/.test(ariaLabel)) return `ng:${ariaLabel}`;
        }

        // Priority 4: Associated Label
        if (el.id) {
            const label = document.querySelector(`label[for="${el.id}"]`);
            if (label) {
                const labelText = label.textContent?.trim();
                if (labelText) return `ng:${labelText.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
            }
        }

        return el.name || el.id || null;
    }

    /**
     * Helper to extract value from a single element
     */
    function extractSingleValue(el) {
        if (!el) return "";
        if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
            // Boolean Absence Rule: Always skip unchecked in baselines
            return el.checked ? (el.value || 'true') : null;
        }
        return el.value !== undefined ? String(el.value) : el.textContent?.trim() || "";
    }

    /**
     * EXTRACTOR: Get all input/select/textarea values from a container
     * This is the CORE logic - purely values, no DOM metadata.
     */
    function extractFormValues(container) {
        if (!container) return {};

        const fieldMap = new Map(); // Use Map for deduplication
        const processedElements = new WeakSet(); // Track processed elements

        // MOVED to shared level as getFieldKeyShared

        /**
         * Helper: Set field value with deduplication
         */
        function setFieldValue(key, value) {
            if (!key) return;

            // Only set if not already present (first value wins)
            if (!fieldMap.has(key)) {
                fieldMap.set(key, value);
            }
        }

        // 1. STANDARD INPUTS & ANGULAR CONTROLS
        // We now include any element that claims to be a form control, including read-only bindings
        const elements = container.querySelectorAll('input, select, textarea, [formcontrolname], [formControlName], [ng-model], [data-ng-model], [ng-bind], .ng-binding');
        elements.forEach(el => {
            try {
                if (processedElements.has(el)) return;

                const key = getFieldKeyShared(el);
                if (!key) return;

                let value = null;

                if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
                    // Boolean Absence Rule: Unchecked = Absent from baseline
                    if (el.checked) {
                        value = el.value || 'true';
                    } else {
                        return; // Skip synthetic 'false'
                    }
                } else if (el.tagName === 'SELECT') {
                    if (el.multiple) {
                        value = Array.from(el.selectedOptions).map(opt => opt.value);
                    } else {
                        value = el.value;
                    }
                } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                    // CRITICAL FIX: Try .value first, then getAttribute('value') for pre-filled forms
                    value = el.value;
                    // If value is empty but has a 'value' attribute, use that (pre-filled but not yet bound)
                    if (!value && el.hasAttribute('value')) {
                        value = el.getAttribute('value');
                    }
                } else {
                    // Handle Custom/Angular Components (div, span, etc.)

                    // 1. Try to find chips/tags
                    const chips = el.querySelectorAll('.tag, .chip, .selected-item, .badge, .value-item');

                    // 2. Try to find ACTIVE/SELECTED toggle buttons/labels (Fix for "ACCEPTDENYIPsec")
                    const activeItems = el.querySelectorAll('.active, .selected, .checked, [aria-checked="true"], .ng-not-empty.active');

                    if (chips.length > 0) {
                        value = Array.from(chips).map(c => c.textContent.trim().replace(/[×x]$/, '').trim());
                    } else if (activeItems.length > 0) {
                        // Only grab text from the selected item(s) to avoid concatenated "ACCEPTDENY" noise
                        value = Array.from(activeItems)
                            .map(item => item.textContent.trim())
                            .filter(text => text.length > 0)
                            .join(','); // Join with comma if multiple active
                    } else {
                        // Fallback to text content or value property
                        value = el.value !== undefined ? el.value : el.textContent.trim();
                    }
                }

                if (value !== null && value !== undefined && value !== '') {
                    setFieldValue(key, value);
                    processedElements.add(el);
                }
            } catch (err) {
                // Individual element failure shouldn't crash extractor
            }
        });

        // 2. CUSTOM TOGGLE SWITCHES
        // Look for elements with aria-checked, data-toggle, etc.
        const toggles = container.querySelectorAll(
            '[aria-checked], [data-toggle], [data-checked], .toggle-switch, .switch-input, [ng-checked]'
        );

        toggles.forEach(el => {
            try {
                if (processedElements.has(el)) return;

                const key = getFieldKey(el) || el.getAttribute('data-field') || el.getAttribute('aria-label');
                if (!key) return;

                // Try multiple ways to get toggle state
                let isChecked = false;

                if (el.hasAttribute('aria-checked')) {
                    isChecked = el.getAttribute('aria-checked') === 'true';
                } else if (el.hasAttribute('data-checked')) {
                    isChecked = el.getAttribute('data-checked') === 'true' || el.getAttribute('data-checked') === '1';
                } else if (el.classList.contains('active') || el.classList.contains('checked')) {
                    isChecked = true;
                } else if (el.hasAttribute('ng-checked')) {
                    // For Angular, check if the element appears checked visually
                    isChecked = el.classList.contains('ng-not-empty') || el.getAttribute('ng-checked') === 'true';
                }

                if (isChecked) {
                    setFieldValue(key, 'true');
                    processedElements.add(el);
                }
            } catch (e) {
                console.warn("Toggle extraction skipped due to error", e);
            }
        });

        // 3. MULTI-VALUE TAG INPUTS
        // Look for containers with multiple "tag" or "chip" elements
        const tagContainers = container.querySelectorAll(
            '.tags-container, .chips-container, .tag-list, [class*="multi-value"], [class*="tag-input"]'
        );

        tagContainers.forEach(tagContainer => {
            try {
                if (processedElements.has(tagContainer)) return;

                // Find the associated field (usually has a name or ng-model on parent/sibling)
                let key = getFieldKey(tagContainer);

                // If container doesn't have key, look for nearby input/label
                if (!key) {
                    const nearbyInput = tagContainer.querySelector('input[ng-model], input[name], input[id]');
                    if (nearbyInput) {
                        key = getFieldKey(nearbyInput);
                    }
                }

                // Look for sibling/parent input that might hold the model
                if (!key) {
                    const parentGroup = tagContainer.closest('.form-group, .field-group, [class*="input"]');
                    if (parentGroup) {
                        const input = parentGroup.querySelector('input[ng-model], input[name]');
                        if (input) {
                            key = getFieldKey(input);
                        }
                    }
                }

                // Look for label association
                if (!key) {
                    const label = tagContainer.closest('label') ||
                        tagContainer.parentElement?.querySelector('label') ||
                        (tagContainer.previousElementSibling?.tagName === 'LABEL' ? tagContainer.previousElementSibling : null);
                    if (label) {
                        key = label.textContent?.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                    }
                }

                if (key) {
                    // Extract all tag values - try multiple selector patterns
                    const tags = tagContainer.querySelectorAll(
                        '.tag, .chip, .badge, ' +
                        '[class*="tag-item"], [class*="chip-item"], ' +
                        'span.label, span.ng-scope:not(:empty), ' +
                        '.selected-item, .multiselect-item'
                    );

                    const tagValues = Array.from(tags)
                        .map(tag => {
                            // Remove the 'x' or close button text
                            let text = tag.textContent?.trim() || '';

                            // Remove common close button patterns
                            text = text.replace(/[×x✕]$/, '').trim();
                            text = text.replace(/\s*×\s*$/, '').trim();

                            // If tag has a child button/icon, try to exclude it
                            const closeBtn = tag.querySelector('button, .close, [class*="remove"], [class*="delete"]');
                            if (closeBtn) {
                                const closeBtnText = closeBtn.textContent?.trim() || '';
                                text = text.replace(closeBtnText, '').trim();
                            }

                            return text;
                        })
                        .filter(text => text.length > 0 && text !== '×' && text !== 'x' && text !== '+');

                    if (tagValues.length > 0) {
                        setFieldValue(key, tagValues);
                        processedElements.add(tagContainer);
                    }
                }
            } catch (e) {
                console.warn("Tag container extraction skipped due to error", e);
            }
        });

        // 3b. ALTERNATIVE PATTERN: Look for individual items with delete buttons (FortiGate chips)
        const itemGroups = container.querySelectorAll('.form-control, .input-wrapper, [class*="field"], .m-multi-select, .f-multi-select');
        itemGroups.forEach(group => {
            try {
                if (processedElements.has(group)) return;

                // Look for multiple elements that have remove/delete indicators (x, close, trash)
                const items = group.querySelectorAll(
                    '.tag, .chip, .item, li, span.badge, ' +
                    '[class*="-item"]:not(:empty), ' +
                    '.selected-item'
                );

                // Filter for items that actually look like selected values (have a label and an 'x')
                const selectedItems = Array.from(items).filter(item => {
                    const hasClose = item.querySelector('.close, .remove, .delete, [class*="icon-close"], [class*="icon-remove"], [class*="x-mark"]');
                    const hasText = item.textContent.trim().length > 0;
                    return hasText && (hasClose || item.classList.contains('tag') || item.classList.contains('chip'));
                });

                if (selectedItems.length > 0) {
                    const key = getFieldKey(group) ||
                        getFieldKey(group.querySelector('input')) ||
                        group.getAttribute('data-field');

                    if (key && !fieldMap.has(key)) {
                        const values = selectedItems
                            .map(item => {
                                let text = item.textContent.trim();
                                // Strip common close icon characters/texts
                                text = text.replace(/[×x✕]$/, '').trim();

                                // If it has a specific text child for the label, use that
                                const labelEl = item.querySelector('.label-text, .text, span:first-child');
                                if (labelEl && labelEl !== item) {
                                    text = labelEl.textContent.trim();
                                }

                                return text;
                            })
                            .filter(text => text.length > 0 && text !== '×' && text !== 'x' && text !== '+');

                        if (values.length > 0) {
                            setFieldValue(key, values);
                            processedElements.add(group);
                        }
                    }
                }
            } catch (e) {
                console.warn("Item group extraction skipped due to error", e);
            }
        });

        // 4. ANGULAR SPECIFIC - Check for ng-model elements not yet captured
        const ngModelElements = container.querySelectorAll('[ng-model]');
        ngModelElements.forEach(el => {
            try {
                if (processedElements.has(el)) return;

                const key = `ng:${el.getAttribute('ng-model')}`;
                let value = null;

                // CRITICAL FIX: Check multiple sources for pre-filled values
                const isBinding = el.classList.contains('ng-binding') || el.hasAttribute('ng-bind');

                if (isBinding) {
                    // Readonly/display field - use text content first
                    value = el.textContent?.trim() || el.getAttribute('value') || "";
                } else {
                    // Input field - try .value, then text content
                    value = el.value || el.textContent?.trim() || el.getAttribute('value') || "";
                }

                if (value !== null && value !== undefined && value !== '') {
                    setFieldValue(key, value);
                    processedElements.add(el);
                }
            } catch (e) {
                console.warn("ng-model extraction skipped due to error", e);
            }
        });

        // Convert Map to plain object
        return Object.fromEntries(fieldMap);
    }

    /**
     * Start Monitoring a detected form
     */
    function startMonitoring(form) {
        // If it's the same form node AND we already have a baseline, we can skip.
        // BUT if baseline is empty, we MUST recapture.
        if (pageState.currentForm === form && pageState.authoritativeBefore && Object.keys(pageState.authoritativeBefore).length > 0) return;

        console.log('👁️ Universal Extractor: Monitoring form at', window.location.pathname);

        // Reset monitoring state for the NEW form node (if different or empty baseline)
        const isNewForm = pageState.currentForm !== form;
        if (isNewForm || !pageState.authoritativeBefore) {
            pageState.currentForm = form; // Update ref after check
            pageState.authoritativeBefore = {}; // Initialize as empty for CREATE fallback
            pageState.authoritativeFrozen = false;
            pageState.stabilityCount = 0;          // Reset stability
            pageState.lastCandidateState = null;
            pageState.inferenceBaseline = {};
            pageState.modifiedFields = new Set();
            pageState.lastBaselineCount = 0;
        } else {
            pageState.currentForm = form;
        }

        // NEW: MULTI-STAGE BASELINE CAPTURE (Hard Fix)
        // 1. Immediate Synchronous Capture (on route entry)
        captureInitialBaseline();

        // 2. Secondary Idle-Load Capture (post-rendering stability)
        const runIdleCapture = () => {
            if (window.requestIdleCallback) {
                window.requestIdleCallback(() => captureInitialBaseline(), { timeout: 1000 });
            } else {
                setTimeout(() => captureInitialBaseline(), 500);
            }
        };
        runIdleCapture();

        // Start periodic baseline sync (to catch lazy-loaded fields/tabs)
        if (pageState.baselineSyncInterval) clearInterval(pageState.baselineSyncInterval);
        pageState.baselineSyncInterval = setInterval(updateBaselineIncremental, 1000);

        // Setup streaming listeners immediately - they will now handle logic to lock baseline
        setupStreamListeners(pageState.currentForm);
    }

    function captureInitialBaseline() {
        if (!pageState.currentForm) return;

        // 1. Authoritative Capture (Module A)
        // Strictly from the form state at the moment of discovery. No heuristics.
        const authoritative = extractFormValues(pageState.currentForm);
        tryFreezeAuthoritativeBaseline(authoritative);

        // Inference also starts with this
        pageState.inferenceBaseline = { ...authoritative };

        const authoritativeCount = pageState.authoritativeBefore ? Object.keys(pageState.authoritativeBefore).length : 0;
        console.log(`📸 Initial Baseline Discovery: ${authoritativeCount} fields captured`);

        // 2. Inference Enrichment (Module B)
        // Delayed capture (+200ms) to allow Angular bindings to settle and data to load
        setTimeout(() => {
            if (!pageState.currentForm) return;
            const delayed = extractFormValues(pageState.currentForm);

            // Merge: Add any NEW fields found in delayed capture to Inference baseline ONLY
            let addedCount = 0;
            for (const [key, value] of Object.entries(delayed)) {
                if (!(key in pageState.inferenceBaseline) && !pageState.modifiedFields.has(key)) {
                    pageState.inferenceBaseline[key] = value;
                    addedCount++;
                }
            }

            // Attempt to freeze authoritative baseline if discovery was sparse but delayed is better
            tryFreezeAuthoritativeBaseline(delayed);

            // ENRICHMENT HEURISTICS (Inference only - Module B)
            // If the baseline is extremely sparse, attempt a deeper search for initial values
            // to help labels, regardless of URL hints.
            if (Object.keys(pageState.inferenceBaseline).length < 2) {
                console.log('🔍 Inference: Enrichment via sparse baseline heuristics...');
                const candidates = pageState.currentForm.querySelectorAll('input, select, textarea, [ng-model], [formcontrolname], .ng-binding, [ng-bind]');
                candidates.forEach(el => {
                    const key = getFieldKeyShared(el);
                    if (!key || pageState.inferenceBaseline[key]) return;

                    // Try to find a pre-filled value even if not normally extracted
                    const val = el.getAttribute('value') || el.textContent?.trim();
                    if (val && val.length > 0) {
                        pageState.inferenceBaseline[key] = val;
                        addedCount++;
                    }
                });
            }

            if (addedCount > 0) {
                console.log(`📸 Inference Baseline (Enriched): +${addedCount} fields, total ${Object.keys(pageState.inferenceBaseline).length}`);
            }

            pageState.lastBaselineCount = Object.keys(pageState.inferenceBaseline).length;

            // Notify collector of the initial baseline (Inference mode)
            if (Object.keys(pageState.inferenceBaseline).length > 0) {
                window.postMessage({
                    type: 'UNIVERSAL_MONITOR_START',
                    data: {
                        baseline: pageState.inferenceBaseline, // Broadcast inference baseline
                        timestamp: Date.now(),
                        url: window.location.href
                    }
                }, '*');
            }
        }, 200);

        // 3. Late capture (+1s) for slow lazy-loaded sections (Inference only)
        setTimeout(() => {
            if (pageState.currentForm) updateBaselineIncremental();
        }, 1000);
    }

    /**
     * Incremental Baseline Update
     * Adds newly discovered fields to the baseline if they haven't been modified by the user.
     */
    function updateBaselineIncremental() {
        if (!pageState.currentForm) return;

        const current = extractFormValues(pageState.currentForm);
        let addedCount = 0;

        for (const [key, value] of Object.entries(current)) {
            // Only add to INFERENCE baseline
            if (!(key in pageState.inferenceBaseline) && !pageState.modifiedFields.has(key)) {
                pageState.inferenceBaseline[key] = value;
                addedCount++;
            }
        }

        // Attempt to freeze authoritative baseline if not already frozen
        tryFreezeAuthoritativeBaseline(current);

        if (addedCount > 0) {
            const totalCount = Object.keys(pageState.inferenceBaseline).length;
            console.log(`📸 Inference Baseline Sync: +${addedCount} fields, total ${totalCount}`);
            pageState.lastBaselineCount = totalCount;

            // Notify collector of the updated baseline
            window.postMessage({
                type: 'UNIVERSAL_MONITOR_START',
                data: {
                    baseline: pageState.inferenceBaseline,
                    timestamp: Date.now(),
                    url: window.location.href
                }
            }, '*');
        }
    }

    /**
     * Setup Event Listeners for Streaming
     */
    function setupStreamListeners(form) {
        // Remove old listeners if any (though node is usually new here)
        form.removeEventListener('input', handleStreamEvent, true);
        form.removeEventListener('change', handleStreamEvent, true);

        form.addEventListener('input', handleStreamEvent, true);
        form.addEventListener('change', handleStreamEvent, true);

        // Clicks for custom components
        form.addEventListener('click', (e) => {
            setTimeout(handleStreamEvent, 100);
        }, true);

        // MutationObserver for structural changes
        if (window.MutationObserver) {
            if (form.__monitorObserver) form.__monitorObserver.disconnect();
            const formObserver = new MutationObserver(() => {
                // Fix: Capture new fields as baseline IMMEDIATELY upon insertion.
                // This prevents race condition where lazy-loaded fields are seen as "new changes"
                updateBaselineIncremental();
                handleStreamEvent();
            });
            formObserver.observe(form, { childList: true, subtree: true });
            form.__monitorObserver = formObserver;
        }
    }

    function handleStreamEvent(e) {
        // If we have an event, identify the field and LOCK its baseline
        if (e && e.target) {
            const fieldKey = getFieldKeyShared(e.target);
            if (fieldKey && !pageState.modifiedFields.has(fieldKey)) {

                // CRITICAL FIX: If field wasn't in baseline yet, try harder to get its original value
                if (!(fieldKey in pageState.inferenceBaseline)) {
                    let originalValue = null;

                    // 1. Try to get the value from attributes
                    if (e.target.hasAttribute('value')) {
                        originalValue = e.target.getAttribute('value');
                    } else if (e.target.tagName === 'SELECT') {
                        const selectedOption = e.target.querySelector('option[selected]');
                        if (selectedOption) originalValue = selectedOption.value;
                    } else if (e.target.type === 'checkbox' || e.target.type === 'radio') {
                        // Boolean Absence Rule: Skip unchecked in baseline
                        if (e.target.checked) {
                            originalValue = e.target.value || 'true';
                        } else {
                            // Unchecked? Baseline is absent. Mark as modified anyway to lock it.
                            pageState.modifiedFields.add(fieldKey);
                            return;
                        }
                    }

                    // 2. Fallback: use current value if not already set by attributes
                    if (originalValue === null) {
                        originalValue = extractSingleValue(e.target);
                        // If extractSingleValue returns null (unchecked boolean), we skip
                        if (originalValue === null) {
                            pageState.modifiedFields.add(fieldKey);
                            return;
                        }
                    }

                    pageState.inferenceBaseline[fieldKey] = originalValue;
                    console.log(`🔒 Baseline locked for field: ${fieldKey} = ${JSON.stringify(originalValue)}`);
                } else {
                    console.log(`🔒 Field modified: ${fieldKey} (baseline already set)`);
                }

                pageState.modifiedFields.add(fieldKey);
            }
        }

        requestDebouncedEmission();
    }

    let emitTimeout = null;
    function requestDebouncedEmission() {
        if (emitTimeout) clearTimeout(emitTimeout);
        emitTimeout = setTimeout(() => {
            emitStreamEvent();
        }, 400);
    }

    /**
     * Aggressive SPA Entry Polling (Hard Fix)
     * Polls the DOM for a valid form container after a route change.
     */
    function startAggressivePolling() {
        if (pageState.pollingInterval) clearInterval(pageState.pollingInterval);

        const currentUrl = window.location.href;
        console.log(`🔍 Starting aggressive SPA form polling on: ${currentUrl}`);
        let pollCount = 0;
        const maxPolls = 25; // 5 seconds (25 * 200ms)

        pageState.pollingInterval = setInterval(() => {
            pollCount++;
            console.log(`   Poll #${pollCount}: Searching for forms...`);

            // Attempt to detect and start monitoring immediately
            const found = detectForms();

            if (found || pollCount >= maxPolls) {
                if (found) {
                    console.log(`✅ Form found and baseline captured on poll #${pollCount}`);
                    console.log(`   Baseline has ${Object.keys(pageState.inferenceBaseline).length} fields`);
                } else {
                    console.log('🛑 Polling timed out. No form found on this route.');
                }

                clearInterval(pageState.pollingInterval);
                pageState.pollingInterval = null;
            }
        }, 200);
    }

    function emitStreamEvent() {
        if (!pageState.currentForm) return;

        const current = extractFormValues(pageState.currentForm);
        const changes = computeDiff(pageState.inferenceBaseline, current);

        // Broadcast streaming prediction data
        window.postMessage({
            type: 'UNIVERSAL_STREAM_EVENT',
            data: {
                before: pageState.inferenceBaseline, // Streaming uses inference baseline
                after: current,
                changes: changes,
                timestamp: Date.now()
            }
        }, '*');

        if (changes.length > 0) {
            console.log(`🌊 Incremental Diffs (${changes.length}): ${changes.map(c => c.field).slice(0, 3).join(', ')}...`);
        }
    }


    /**
     * Form Detection Logic
     * Simple heuristic: A significantly large container with inputs appears.
     */
    function detectForms() {
        if (pageState.currentForm && pageState.currentForm.isConnected) return true;

        // Priority 1: Main Angular View Containers + Specific object-type containers (e.g. VPN Wizard)
        const containers = document.querySelectorAll('.ng-view, [ng-view], .ngx-container, .main-content, .page-content, form, .vpn-wizard, .vpn-wizard-container, .f-vpn-wizard, .f-wizard, .wizard');

        let bestForm = null;
        let maxInputs = -1;

        containers.forEach(container => {
            if (!isElementVisible(container)) return;
            const inputCount = container.querySelectorAll('input, select, textarea, [ng-model]').length;
            if (inputCount > maxInputs) {
                maxInputs = inputCount;
                bestForm = container;
            }
        });

        if (bestForm && maxInputs > 2) {
            console.log(`🎯 Form detected (${maxInputs} fields). Starting monitoring...`);
            startMonitoring(bestForm);
            return true;
        }
        return false;
    }

    /**
     * Compute Diff function
     */
    function computeDiff(before, after) {
        const changes = [];
        const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

        allKeys.forEach(key => {
            const oldVal = before[key];
            const newVal = after[key];

            // Simple equality check (works for strings/numbers)
            // For arrays (multi-select), we need JSON comparison
            const oldStr = JSON.stringify(oldVal);
            const newStr = JSON.stringify(newVal);

            if (oldStr !== newStr) {
                changes.push({
                    field: key,
                    old_value: oldVal,
                    new_value: newVal,
                    op: (oldVal === undefined || oldVal === '') ? 'add' : (newVal === undefined || newVal === '') ? 'remove' : 'set'
                });
            }
        });

        return changes;
    }

    /**
     * Handle Save Actions (Legacy/Commit Signal)
     */
    /**
     * Check for Validation Errors
     * Returns true if there are visible error indicators in the form
     */
    function hasErrors(container) {
        if (!container) return false;

        // Common error indicators in generic web apps and FortiGate/PaloAlto
        const errorSelectors = [
            '.parsley-error',          // Generic Parsley.js
            '.ng-invalid',             // Angular (only if touched/dirty usually context matters, but stricter here)
            '.error',                  // Generic
            '.invalid-feedback',       // Bootstrap
            '.has-error',              // Bootstrap 3
            '.is-invalid',             // Bootstrap 4+
            '.validation-error',       // Custom
            '[aria-invalid="true"]',   // Accessibility standard
            '.f-form-error',           // FortiGate specific (heuristic)
            '.msg-error'               // Generic message
        ];

        // We need to be careful not to catch "ng-invalid" on untouched fields if the form allows it.
        // But the user request is "if the firewall show error... don't show popup".
        // Usually, clicking "OK" triggers validation which marks fields as dirty/touched and shows the error.

        let foundError = false;

        // 1. Check for specific error classes that imply a VISIBLE error message
        const allPotentialErrors = container.querySelectorAll(errorSelectors.join(', '));

        for (const el of allPotentialErrors) {
            // Filter out ng-invalid if it's not accompanied by a visual error state
            // (Angular fields start as ng-invalid if required but empty)
            if (el.classList.contains('ng-invalid') &&
                !el.classList.contains('ng-touched') &&
                !el.classList.contains('ng-dirty') &&
                !el.closest('.has-error')) {
                continue;
            }

            // Check if element is visible
            if (isElementVisible(el)) {
                // If it's a field, check if it has a parent reporting error
                foundError = true;
                // console.log('I found an error on:', el);
                break;
            }
        }

        // 2. Check for visible error text containers
        if (!foundError) {
            const errorTextContainers = container.querySelectorAll('.help-block.error, .error-msg, .err-msg');
            for (const el of errorTextContainers) {
                if (isElementVisible(el) && el.textContent.trim().length > 0) {
                    foundError = true;
                    break;
                }
            }
        }

        return foundError;
    }

    /**
     * Helper: Check visibility
     */
    function isElementVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            el.offsetParent !== null;
    }

    /**
     * Handle Save Actions (Legacy/Commit Signal)
     */
    function handleGlobalClick(e) {
        const target = e.target;
        // Check closest button if click target is detailed (e.g. span inside button)
        const btn = target.closest('button, input[type="button"], input[type="submit"], a.btn');
        const el = btn || target;

        const text = (el.textContent || el.value || '').toLowerCase().trim();

        // Heuristic for Save buttons
        if (['ok', 'save', 'apply', 'create', 'update'].includes(text)) {
            // It's a save action. Capture AFTER state IMMEDIATELY (Candidate State)
            if (pageState.currentForm) {
                // NEW: Only lock if there is actual data in the form to save.
                // This prevents "Create new" navigation buttons from locking the state.
                const currentData = extractFormValues(pageState.currentForm);
                if (Object.keys(currentData).length === 0 && !(['save', 'apply'].includes(text))) {
                    return; // Likely a navigation button, not a commit.
                }

                pageState.saveInProgress = true; // LOCK: Prevent resets

                // 1. Synchronous Snapshot
                // No polling, no delayed merge, no reconstruction.
                const finalAfter = extractFormValues(pageState.currentForm);

                let eventSent = false;

                // Define the check/send logic
                const attemptSend = (isUnloading = false) => {
                    if (eventSent) return;
                    eventSent = true;

                    try {
                        // 1. Check if form is still present for Validation Check
                        // (Skip errors if unloading)
                        const isFormPresent = document.body.contains(pageState.currentForm) &&
                            isElementVisible(pageState.currentForm);

                        if (!isUnloading && isFormPresent && hasErrors(pageState.currentForm)) {
                            console.warn('❌ Validation errors detected. Popup suppressed.');
                            return; // ABORT
                        }

                        // 2. HARD INTEGRITY CHECK: Training data must have Authoritative Before
                        // Rule: If frozen, it MUST be an EDIT and MUST have fields.
                        // If not frozen, it MUST be a CREATE.
                        const operation = pageState.authoritativeFrozen ? 'EDIT' : 'CREATE';
                        const before = pageState.authoritativeBefore || {};
                        const beforeCount = Object.keys(before).length;

                        if (operation === 'EDIT' && beforeCount === 0) {
                            console.error('❌ HARD DROP: Missing authoritative before state for EDIT flow (Frozen but empty)');
                            return;
                        }

                        console.log(`✅ Finalizing Save Event (${operation})...`);
                        const finalBefore = (operation === 'EDIT') ? pageState.authoritativeBefore : {};
                        const changes = computeDiff(finalBefore, finalAfter);

                        if (changes.length > 0) {
                            console.log('📤 Sending UNIVERSAL_EVENT_SAVED');
                            window.postMessage({
                                type: 'UNIVERSAL_EVENT_SAVED',
                                data: {
                                    before: pageState.authoritativeBefore,
                                    after: finalAfter,
                                    timestamp: Date.now(),
                                    url: window.location.href
                                }
                            }, '*');
                        } else {
                            console.log('ℹ️ No changes detected. Training sample suppressed.');
                        }
                    } finally {
                        pageState.saveInProgress = false; // RELEASE LOCK
                    }
                };

                // Safety: If page unloads (reload/nav), force send immediately
                const unloadHandler = () => attemptSend(true);
                window.addEventListener('beforeunload', unloadHandler);

                // Normal: Wait a short delay for validation errors to appear
                setTimeout(() => {
                    window.removeEventListener('beforeunload', unloadHandler);
                    attemptSend(false);
                }, 300);
            }
        }
    }

    // Initialize Observers
    function init() {
        // Observer to detect forms appearing (SPA navigation)
        const observer = new MutationObserver((mutations) => {
            // Check if current form got detached
            if (pageState.currentForm && !pageState.currentForm.isConnected) {
                if (pageState.saveInProgress) {
                    console.log('⏸️ Form detached during save, preserving state...');
                    // If detached for a long time (e.g. 5s), force release the lock
                    if (!pageState.forceReleaseTimer) {
                        pageState.forceReleaseTimer = setTimeout(() => {
                            if (pageState.saveInProgress) {
                                console.warn('🚨 Emergency release of saveInProgress lock');
                                pageState.saveInProgress = false;
                                pageState.forceReleaseTimer = null;
                            }
                        }, 5000);
                    }
                } else {
                    console.log('♻️ Current form detached, resetting inference state...');
                    pageState.currentForm = null;
                    pageState.inferenceBaseline = {};
                    // authoritativeBefore survives until next route/reset
                }
            }

            // Throttle detection
            detectForms();
        });

        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        } else {
            // Fallback for frames or early init
            observer.observe(document.documentElement, { childList: true, subtree: true });
        }

        // Initial check
        detectForms();

        // Global listener for Save (Legacy)
        document.addEventListener('mousedown', handleGlobalClick, true);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleGlobalClick(e);
        }, true);

        const messageHandler = (event) => {
            if (event.source !== window) return;
            if (event.data.type === 'UNIVERSAL_RESET') {
                if (pageState.saveInProgress) {
                    console.warn('⏸️ Reset requested during save. Protecting Authoritative Before, resetting inference only.');
                    // Fix A: Preserve authoritativeBefore during save
                    pageState.inferenceBaseline = {};
                    pageState.currentForm = null;
                    return;
                }
                console.log('🔄 Universal Extractor Reset Signal Received');
                pageState.currentForm = null;
                pageState.authoritativeBefore = {};
                pageState.authoritativeFrozen = false;
                pageState.stabilityCount = 0;          // Reset stability
                pageState.lastCandidateState = null;
                pageState.inferenceBaseline = {};
                startAggressivePolling(); // Switch to aggressive polling on route entry
            }
        };
        window.addEventListener('message', messageHandler);

        const keydownHandler = (e) => {
            if (e.key === 'Enter') handleGlobalClick(e);
        };
        document.addEventListener('keydown', keydownHandler, true);

        // CLEANUP REGISTRY
        window.__STOP_UNIVERSAL_EXTRACTOR__ = () => {
            console.log('🧹 Stopping old Universal Extractor instances...');
            if (pageState.baselineSyncInterval) clearInterval(pageState.baselineSyncInterval);
            if (observer) observer.disconnect();
            document.removeEventListener('mousedown', handleGlobalClick, true);
            document.removeEventListener('keydown', keydownHandler, true);
            window.removeEventListener('message', messageHandler);
        };
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            init();
            startAggressivePolling(); // Start polling on initial load too
        });
    } else {
        init();
        startAggressivePolling();
    }

})();
