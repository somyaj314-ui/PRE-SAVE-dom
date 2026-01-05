// universal_field_extractor.js - Vendor-Agnostic "Values Only" Extractor
// Captures BEFORE state (on load) and AFTER state (on save)
// No DOM structure, no HTML, just value extraction.

(function () {
    'use strict';

    console.log('🌌 Universal Field Extractor Initialized');

    // State storage
    const pageState = {
        before: {},
        currentForm: null,
        isMonitoring: false
    };

    /**
     * EXTRACTOR: Get all input/select/textarea values from a container
     * This is the CORE logic - purely values, no DOM metadata.
     * 
     * Enhanced to support:
     * - Standard inputs (text, checkbox, radio, select, textarea)
     * - Custom toggle switches (aria-checked, data attributes)
     * - Multi-value tag inputs (tag containers)
     * - Angular components (ng-model)
     * - Deduplication to prevent counting same field multiple times
     */
    function extractFormValues(container) {
        if (!container) return {};

        const fieldMap = new Map(); // Use Map for deduplication
        const processedElements = new WeakSet(); // Track processed elements

        /**
         * Helper: Get field identifier with priority
         * Priority: ng-model > name > id > generated key
         */
        function getFieldKey(el) {
            // Priority 1: Direct Angular attributes
            const formControlName = el.getAttribute('formcontrolname') || el.getAttribute('formControlName');
            if (formControlName) return `ng:${formControlName}`;

            const ngModel = el.getAttribute('ng-model') || el.getAttribute('data-ng-model');
            if (ngModel) return `ng:${ngModel}`;

            const ngBind = el.getAttribute('ng-bind') || el.getAttribute('ng-value');
            if (ngBind) return `ng:${ngBind}`;

            // Priority 2: Traverse parents for Angular bindings (e.g. Radio Groups)
            // Go up to 4 levels to find a container with a binding
            let parent = el.parentElement;
            let depth = 0;
            while (parent && depth < 4) {
                const parentNav = parent.getAttribute('formcontrolname') || parent.getAttribute('formControlName');
                if (parentNav) return `ng:${parentNav}`;

                const parentModel = parent.getAttribute('ng-model') || parent.getAttribute('data-ng-model');
                if (parentModel) return `ng:${parentModel}`;

                parent = parent.parentElement;
                depth++;
            }

            // Priority 3: Extract from aria-label (heuristic for FortiGate)
            // Example: aria-label="'comments' | translate" -> comments
            const ariaLabel = el.getAttribute('aria-label');
            if (ariaLabel) {
                // Match content inside single quotes
                const match = ariaLabel.match(/'([^']+)'/);
                if (match) return `ng:${match[1]}`; // Treat as ng key for mapping consistency

                // Or use the label directly if it looks like a key
                if (/^[a-z0-9_]+$/.test(ariaLabel)) return `ng:${ariaLabel}`;
            }

            // Priority 4: Associated Label
            if (el.id) {
                const label = document.querySelector(`label[for="${el.id}"]`);
                if (label) {
                    const labelNgModel = label.getAttribute('ng-model') || label.getAttribute('data-ng-model');
                    if (labelNgModel) return `ng:${labelNgModel}`;

                    // Text content of label?
                    const labelText = label.textContent?.trim();
                    if (labelText) {
                        return `ng:${labelText.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
                    }
                }
            }

            // Priority 5: Fallback to standard identifiers
            const key = el.name || el.id;
            if (key && !key.startsWith('__')) return key;

            return null;
        }

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
        // We now include any element that claims to be a form control
        const elements = container.querySelectorAll('input, select, textarea, [formcontrolname], [formControlName], [ng-model], [data-ng-model]');
        elements.forEach(el => {
            if (processedElements.has(el)) return;

            const key = getFieldKey(el);
            if (!key) return;

            // DEBUG: Log elements that only have DOM IDs
            if (key.startsWith('for_id_') || key.startsWith('radio_id')) {
                console.warn('🔍 DEBUG: Element with DOM ID key:', key);
                console.warn('   Attributes:', Array.from(el.attributes).map(attr => `${attr.name}="${attr.value}"`));
            }

            let value = null;

            if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
                value = el.checked ? (el.value || 'true') : 'false';
            } else if (el.tagName === 'SELECT') {
                if (el.multiple) {
                    value = Array.from(el.selectedOptions).map(opt => opt.value);
                } else {
                    value = el.value;
                }
            } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                value = el.value;
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

            if (value !== null && value !== undefined) {
                setFieldValue(key, value);
                processedElements.add(el);
            }
        });

        // 2. CUSTOM TOGGLE SWITCHES
        // Look for elements with aria-checked, data-toggle, etc.
        const toggles = container.querySelectorAll(
            '[aria-checked], [data-toggle], [data-checked], .toggle-switch, .switch-input, [ng-checked]'
        );

        toggles.forEach(el => {
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

            setFieldValue(key, isChecked ? 'true' : 'false');
            processedElements.add(el);
        });

        // 3. MULTI-VALUE TAG INPUTS
        // Look for containers with multiple "tag" or "chip" elements
        const tagContainers = container.querySelectorAll(
            '.tags-container, .chips-container, .tag-list, [class*="multi-value"], [class*="tag-input"]'
        );

        tagContainers.forEach(tagContainer => {
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
        });

        // 3b. ALTERNATIVE PATTERN: Look for individual items with delete buttons
        const itemGroups = container.querySelectorAll('.form-control, .input-wrapper, [class*="field"]');
        itemGroups.forEach(group => {
            if (processedElements.has(group)) return;

            // Look for multiple elements that have remove/delete buttons
            const items = group.querySelectorAll('[class*="item"]:has(button), span:has(.close), li:has([class*="remove"])');

            if (items.length > 1) { // Multiple items suggest a multi-value field
                const key = getFieldKey(group) ||
                    getFieldKey(group.querySelector('input')) ||
                    group.getAttribute('data-field');

                if (key && !fieldMap.has(key)) {
                    const values = Array.from(items)
                        .map(item => {
                            const closeBtn = item.querySelector('button, .close, [class*="remove"]');
                            let text = item.textContent?.trim() || '';
                            if (closeBtn) {
                                text = text.replace(closeBtn.textContent?.trim() || '', '').trim();
                            }
                            return text.replace(/[×x✕]/, '').trim();
                        })
                        .filter(text => text.length > 0);

                    if (values.length > 0) {
                        setFieldValue(key, values);
                        processedElements.add(group);
                    }
                }
            }
        });

        // 4. ANGULAR SPECIFIC - Check for ng-model elements not yet captured
        const ngModelElements = container.querySelectorAll('[ng-model]');
        ngModelElements.forEach(el => {
            if (processedElements.has(el)) return;

            const key = `ng:${el.getAttribute('ng-model')}`;

            // Try to extract value from various Angular patterns
            let value = null;

            // Check if it's a displayed value (like in a readonly/display field)
            if (el.classList.contains('ng-binding')) {
                value = el.textContent?.trim() || el.value || el.getAttribute('value');
            } else {
                value = el.value || el.textContent?.trim();
            }

            if (value !== null && value !== undefined && value !== '') {
                setFieldValue(key, value);
                processedElements.add(el);
            }
        });

        // Convert Map to plain object
        return Object.fromEntries(fieldMap);
    }

    /**
     * Start Monitoring a detected form
     */
    function startMonitoring(form) {
        if (pageState.currentForm === form) return; // Prevent re-initialization if already monitoring

        console.log('👁️ Universal Extractor: New Form Detected');
        pageState.currentForm = form;
        pageState.isMonitoring = true;

        // 1. Capture BEFORE state immediately
        // We wait a tick to ensure frameworks like Angular/React have populated values
        setTimeout(() => {
            pageState.before = extractFormValues(form);
            console.log('📸 Captured BEFORE state:', Object.keys(pageState.before).length, 'fields');

            // Note: Empty before state is CORRECT for CREATE operations
            // The model learns: {} → {filled fields} = creation pattern

            // Broadcast "Detected" event (optional, for debugging or UI feedback)
            window.postMessage({
                type: 'UNIVERSAL_EVENT_DETECTED',
                data: {
                    fieldCount: Object.keys(pageState.before).length,
                    timestamp: Date.now()
                }
            }, '*');
        }, 500);

        // 2. Set up STREAMING LISTENERS for live ML predictions BEFORE save
        // Listen for user input changes
        setupStreamListeners(form);

        // 3. Attach Save Listener
        // We listen globally to catch any save button, then check if it relates to our form
        // Or we can attach to the form's submit event (but SPAs often don't use real submit)
    }

    /**
     * Setup streaming listeners to detect changes during editing
     * Sends real-time predictions to ML engine
     */
    function setupStreamListeners(form) {
        const streamHandler = debounce(() => {
            if (!pageState.currentForm || !pageState.isMonitoring) return;

            const currentState = extractFormValues(form);
            const changes = computeDiff(pageState.before, currentState);

            if (changes.length > 0) {
                // Send STREAMING event for live ML predictions
                window.postMessage({
                    type: 'UNIVERSAL_STREAM_EVENT',
                    data: {
                        before: pageState.before,
                        after: currentState,
                        changes: changes,
                        timestamp: Date.now()
                    }
                }, '*');

                console.log('🌊 Stream event:', changes.length, 'changes detected');
            }
        }, 800); // Debounce to 800ms to avoid too many predictions

        // Listen to input/change/blur events on form
        const inputElements = form.querySelectorAll('input, select, textarea, [contenteditable]');
        
        inputElements.forEach(el => {
            el.addEventListener('input', streamHandler, false);
            el.addEventListener('change', streamHandler, false);
            el.addEventListener('blur', streamHandler, false);
        });

        // Also monitor for dynamically added elements
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    // Check if new inputs were added
                    const newInputs = form.querySelectorAll('input:not([data-stream-listener]), select:not([data-stream-listener])');
                    newInputs.forEach(el => {
                        el.addEventListener('input', streamHandler, false);
                        el.addEventListener('change', streamHandler, false);
                        el.addEventListener('blur', streamHandler, false);
                        el.setAttribute('data-stream-listener', 'true');
                    });
                }
            });
        });

        observer.observe(form, { childList: true, subtree: true });
    }

    /**
     * Debounce utility function
     */
    function debounce(fn, delay) {
        let timeoutId;
        return function (...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    /**
     * Form Detection Logic
     * Simple heuristic: A significantly large container with inputs appears.
     */
    function detectForms() {
        const potentialForms = document.querySelectorAll('form, .ngdialog-content, .modal-content, [role="dialog"]');

        potentialForms.forEach(form => {
            // Simple check: does it have enough fields to be a "config" form?
            const inputCount = form.querySelectorAll('input, select').length;
            if (inputCount > 3) { // Threshold to ignore search bars, login, etc.
                startMonitoring(form);
            }
        });
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
                    new_value: newVal
                });
            }
        });

        return changes;
    }

    /**
     * Handle Save Actions
     */
    function handleGlobalClick(e) {
        const target = e.target;
        const text = (target.textContent || target.value || '').toLowerCase().trim();

        // Heuristic for Save buttons
        if (['ok', 'save', 'apply', 'create', 'update'].includes(text)) {
            // It's a save action. Capture AFTER state.
            if (pageState.currentForm) {
                console.log('💾 Save detected. Capturing AFTER state...');

                // Allow a tiny delay for any final blur events or validation
                setTimeout(() => {
                    const after = extractFormValues(pageState.currentForm);
                    const changes = computeDiff(pageState.before, after);

                    if (changes.length > 0) {
                        console.log('✨ Changes detected:', changes);

                        // Broadcast the FINAL EVENT
                        window.postMessage({
                            type: 'UNIVERSAL_EVENT_SAVED',
                            data: {
                                before: pageState.before,
                                after: after,
                                changes: changes,
                                timestamp: Date.now()
                            }
                        }, '*');
                    } else {
                        console.log('🤷 No field changes detected.');
                    }
                }, 10); // Reduced delay to 10ms for mousedown capture
            }
        }
    }

    // Initialize Observers
    function init() {
        // Observer to detect forms appearing (SPA navigation)
        const observer = new MutationObserver((mutations) => {
            // Check if current form got detached
            if (pageState.currentForm && !pageState.currentForm.isConnected) {
                console.log('♻️ Current form detached, resetting state...');
                pageState.currentForm = null;
                pageState.before = {};
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

        // Global listener for Save
        // Use 'mousedown' to capture state BEFORE the button click creates side effects (like closing modal)
        document.addEventListener('mousedown', handleGlobalClick, true);
        // Also listen for Enter key?
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleGlobalClick(e);
        }, true);

        // Listen for Reset signal from content script
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            if (event.data.type === 'UNIVERSAL_RESET') {
                console.log('🔄 Universal Extractor Reset Signal Received');
                pageState.currentForm = null;
                pageState.before = {};
                detectForms(); // Immediate re-scan
            }
        });

    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
