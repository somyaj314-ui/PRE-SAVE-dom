// universal_field_extractor.js - Vendor-Agnostic "Values Only" Extractor
// Captures BEFORE state (on load) and AFTER state (on save)
// No DOM structure, no HTML, just value extraction.

(function () {
    'use strict';

    console.log('🌌 Universal Field Extractor Initialized (Streaming Mode)');

    // State storage
    const pageState = {
        before: {},       // Baseline state (at load)
        currentForm: null,
        isMonitoring: false,
        debounceTimers: new Map() // For debouncing stream events per field
    };

    /**
     * EXTRACTOR: Get all input/select/textarea values from a container
     * This is the CORE logic - purely values, no DOM metadata.
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
                // console.warn('🔍 DEBUG: Element with DOM ID key:', key);
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

        // 3b. ALTERNATIVE PATTERN: Look for individual items with delete buttons (FortiGate chips)
        const itemGroups = container.querySelectorAll('.form-control, .input-wrapper, [class*="field"], .m-multi-select, .f-multi-select');
        itemGroups.forEach(group => {
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
        if (pageState.currentForm === form) return;

        console.log('👁️ Universal Extractor: New Form detected at', window.location.pathname);
        pageState.currentForm = form;

        // 1. Capture BASELINE state (Ground Truth)
        // We wait for framework hydration to complete
        setTimeout(() => {
            if (!pageState.currentForm) return;

            pageState.before = extractFormValues(pageState.currentForm);
            console.log('📸 Baseline captured:', Object.keys(pageState.before).length, 'fields');

            // Notify collector that monitoring has started on a specific object
            window.postMessage({
                type: 'UNIVERSAL_MONITOR_START',
                data: {
                    baseline: pageState.before,
                    timestamp: Date.now(),
                    url: window.location.href
                }
            }, '*');

            // 2. Setup Streaming Listeners
            setupStreamListeners(pageState.currentForm);

        }, 800);
    }

    /**
     * Setup Event Listeners for Streaming
     */
    function setupStreamListeners(form) {
        // Remove old listeners if any
        form.removeEventListener('input', handleStreamInput);
        form.removeEventListener('change', handleStreamInput);

        form.addEventListener('input', handleStreamInput);
        form.addEventListener('change', handleStreamInput);

        // Clicks: Many modern components (chips, custom dropdowns) only respond to clicks
        // We listen for any click in the form and trigger a debounced emission
        form.addEventListener('click', (e) => {
            // Delay slightly to let the UI update its internal state
            setTimeout(handleStreamInput, 100);
        });

        // MutationObserver: Catch structural changes (e.g. adding/removing tags/chips)
        if (window.MutationObserver) {
            const formObserver = new MutationObserver(() => {
                handleStreamInput();
            });
            formObserver.observe(form, { childList: true, subtree: true });

            // Store observer on form element for cleanup
            form.__monitorObserver = formObserver;
        }
    }

    function handleStreamInput() {
        requestDebouncedEmission();
    }

    let emitTimeout = null;
    function requestDebouncedEmission() {
        if (emitTimeout) clearTimeout(emitTimeout);
        emitTimeout = setTimeout(() => {
            emitStreamEvent();
        }, 400); // 400ms debounce
    }

    function emitStreamEvent() {
        if (!pageState.currentForm) return;

        // 1. Extract Current State
        const current = extractFormValues(pageState.currentForm);

        // 2. Compute Diff from Baseline
        const changes = computeDiff(pageState.before, current);

        // Always emit during stream so the collector can maintain temporal state
        window.postMessage({
            type: 'UNIVERSAL_STREAM_EVENT',
            data: {
                before: pageState.before,
                after: current,
                changes: changes,
                timestamp: Date.now()
            }
        }, '*');

        if (changes.length > 0) {
            console.log(`🌊 Field Diffs: ${changes.map(c => c.field).join(', ')}`);
        }
    }


    /**
     * Form Detection Logic
     * Simple heuristic: A significantly large container with inputs appears.
     */
    function detectForms() {
        const potentialForms = document.querySelectorAll('form, .ngdialog-content, .modal-content, [role="dialog"]');

        potentialForms.forEach(form => {
            // Simple check: does it have enough fields to be a "config" form?
            // Reduced threshold to 2 to catch smaller popups
            const inputCount = form.querySelectorAll('input, select, textarea').length;
            if (inputCount >= 1) {
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
            // This protects against the form being cleared/reset during the validation delay
            if (pageState.currentForm) {
                console.log('💾 Save detected. Capturing candidate state immediately...');

                // 1. Immediate Snapshot
                const candidateAfter = extractFormValues(pageState.currentForm);
                const candidateFieldCount = Object.keys(candidateAfter).length;

                let eventSent = false;

                // Define the check/send logic
                const attemptSend = (isUnloading = false) => {
                    if (eventSent) return;
                    eventSent = true;

                    // 1. Check if form is still present
                    const isFormPresent = document.body.contains(pageState.currentForm) &&
                        isElementVisible(pageState.currentForm);

                    // 2. Check for Errors (Skip if unloading)
                    if (!isUnloading && isFormPresent && hasErrors(pageState.currentForm)) {
                        console.warn('❌ Validation errors detected. Popup suppressed.');
                        return; // ABORT: Don't send "Saved" event
                    }

                    // 3. Determine Final State
                    // If form is gone or largely emptied (cleared), use the candidate snapshot
                    let finalAfter = candidateAfter;

                    if (isFormPresent && !isUnloading) {
                        const currentAfter = extractFormValues(pageState.currentForm);
                        const currentFieldCount = Object.keys(currentAfter).length;

                        // If current form has significantly fewer fields than candidate, it likely cleared/reset.
                        // Use candidate. Otherwise, use current (it might have post-click computed values).
                        if (currentFieldCount < (candidateFieldCount * 0.5)) {
                            console.warn(`⚠️ Form field count dropped (${candidateFieldCount} -> ${currentFieldCount}). Using immediate snapshot.`);
                            finalAfter = candidateAfter;
                        } else {
                            finalAfter = currentAfter;
                        }
                    } else {
                        console.log('🚀 Page unloading or form gone, using immediate snapshot...');
                        finalAfter = candidateAfter;
                    }

                    console.log('✅ Capturing FINAL state...');
                    const changes = computeDiff(pageState.before, finalAfter);

                    if (changes.length > 0) {
                        // Broadcast the FINAL EVENT
                        window.postMessage({
                            type: 'UNIVERSAL_EVENT_SAVED',
                            data: {
                                before: pageState.before,
                                after: finalAfter,
                                changes: changes,
                                timestamp: Date.now()
                            }
                        }, '*');
                    } else {
                        console.log('ℹ️ No changes detected. Popup suppressed.');
                        // Debugging: why no differences?
                        // console.log('Before keys:', Object.keys(pageState.before));
                        // console.log('After keys:', Object.keys(finalAfter));
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

        // Global listener for Save (Legacy)
        document.addEventListener('mousedown', handleGlobalClick, true);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleGlobalClick(e);
        }, true);

        // Listen for Reset signal
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
