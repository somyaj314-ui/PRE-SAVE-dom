// inject.js - Real-time password field monitoring
// This script runs in the page context to detect password changes BEFORE save

(function () {
    'use strict';

    console.log('🔐 Password Monitor Injected');

    // Track password field changes
    let passwordFieldsMonitored = new Set();
    let passwordChangeDetected = false;
    let originalPasswordValues = new Map();

    /**
     * Detect if a field is a password-related field
     */
    function isPasswordField(element) {
        if (!element) return false;

        const type = (element.type || '').toLowerCase();
        const name = (element.name || '').toLowerCase();
        const id = (element.id || '').toLowerCase();
        const placeholder = (element.placeholder || '').toLowerCase();

        // Check if it's a password field
        if (type === 'password') return true;

        // Check for password-related names/ids
        const passwordKeywords = [
            'password', 'passwd', 'pwd', 'pass',
            'new-password', 'old-password', 'current-password',
            'confirm-password', 'password-confirm',
            'min-length', 'complexity', 'expiry'
        ];

        return passwordKeywords.some(keyword =>
            name.includes(keyword) ||
            id.includes(keyword) ||
            placeholder.includes(keyword)
        );
    }

    /**
     * Detect if we're on a password CHANGE page (not policy settings or admin creation)
     */
    function isPasswordChangePage() {
        const url = window.location.href.toLowerCase();
        const title = document.title.toLowerCase();

        const passwordChangePatterns = [
            'change-password',
            'reset-password',
            'admin/password/change',
            'user/password/change'
        ];

        // Exclude policy pages and admin creation pages
        const excludePatterns = [
            'password-policy',
            'password/policy',
            'policy/password',
            'admin/edit',           // Admin creation/edit
            'user/local/edit',      // User creation/edit
            'administrator/edit'    // Administrator creation/edit
        ];

        const isChangeUrl = passwordChangePatterns.some(pattern =>
            url.includes(pattern) || title.includes(pattern)
        );

        const isExcludedUrl = excludePatterns.some(pattern =>
            url.includes(pattern) || title.includes(pattern)
        );

        return isChangeUrl && !isExcludedUrl;
    }

    /**
     * Monitor a password field for changes (WITH SMART VALIDATION)
     */
    function monitorPasswordField(field) {
        if (passwordFieldsMonitored.has(field)) return;

        passwordFieldsMonitored.add(field);

        // Store original value
        originalPasswordValues.set(field, field.value);

        console.log('🔐 Monitoring password field:', field.name || field.id);

        // Track field changes and validate when appropriate
        field.addEventListener('input', function (e) {
            const currentValue = e.target.value;
            const originalValue = originalPasswordValues.get(field);

            if (currentValue !== originalValue && currentValue.length > 0) {
                passwordChangeDetected = true;
                console.log('🔐 Password field changed:', field.name || field.id);

                // Check password completion on EVERY field change
                // (not just confirm field, since FortiGate uses generic IDs)
                setTimeout(() => {
                    checkPasswordChangeComplete();
                }, 500); // Wait 500ms to allow user to fill other fields
            }
        });

        // Also check when user leaves the field (more reliable)
        field.addEventListener('blur', function (e) {
            if (e.target.value.length > 0) {
                console.log('🔐 Password field completed:', field.name || field.id);
                setTimeout(() => {
                    checkPasswordChangeComplete();
                }, 200);
            }
        });
    }

    /**
     * Check if password change is complete and valid
     */
    function checkPasswordChangeComplete() {
        // Find ALL password fields (including hidden ones - FortiGate hides them)
        const allPwdFields = Array.from(document.querySelectorAll('input[type="password"]'))
            .filter(field => {
                // Include fields that have values (even if hidden)
                return field.value && field.value.length > 0;
            });

        console.log('🔍 Checking password completion:', allPwdFields.length, 'fields with values');

        if (allPwdFields.length < 2) return; // Need at least new + confirm

        // Try to identify fields
        let currentField = null, newField = null, confirmField = null;

        allPwdFields.forEach(field => {
            const name = (field.name || field.id || field.placeholder || '').toLowerCase();
            if (name.includes('current') || name.includes('old')) {
                currentField = field;
            } else if (name.includes('confirm') || name.includes('repeat')) {
                confirmField = field;
            } else if (name.includes('new') || name.includes('password')) {
                if (!newField) newField = field;
            }
        });

        console.log('   Field identification attempt:', {
            current: currentField?.id,
            new: newField?.id,
            confirm: confirmField?.id
        });

        // Fallback: use order if we don't have both new AND confirm
        if ((!newField || !confirmField) && allPwdFields.length >= 2) {
            console.log('   Using field order fallback...');
            if (allPwdFields.length === 2) {
                newField = allPwdFields[0];
                confirmField = allPwdFields[1];
            } else if (allPwdFields.length >= 3) {
                currentField = allPwdFields[0];
                newField = allPwdFields[1];
                confirmField = allPwdFields[2];
            }
            console.log('   Assigned by order:', {
                current: currentField?.id,
                new: newField?.id,
                confirm: confirmField?.id
            });
        }

        if (!newField || !confirmField) {
            console.log('   ❌ Cannot identify new/confirm fields');
            return;
        }

        // Check if all required fields are filled
        const currentFilled = !currentField || currentField.value.length > 0;
        const newFilled = newField.value.length > 0;
        const confirmFilled = confirmField.value.length > 0;

        if (!currentFilled || !newFilled || !confirmFilled) return;

        // Check if passwords match
        if (newField.value !== confirmField.value) {
            console.log('⚠️  Passwords do not match:', newField.value.length, 'vs', confirmField.value.length);
            return;
        }

        console.log('✅ Passwords match!');

        // Validate password policy
        const pwd = newField.value;
        if (pwd.length < 8) {
            console.log('⚠️  Password too short (min 8 characters):', pwd.length);
            return;
        }

        console.log('✅ Password length OK:', pwd.length);

        const hasUpper = /[A-Z]/.test(pwd);
        const hasLower = /[a-z]/.test(pwd);
        const hasNumber = /[0-9]/.test(pwd);
        const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(pwd);
        const complexity = [hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;

        console.log('✅ Password complexity:', complexity, '/4 types', { hasUpper, hasLower, hasNumber, hasSpecial });

        if (complexity < 3) {
            console.log('⚠️  Password not complex enough (need 3/4 types)');
            return;
        }

        // All conditions met!
        console.log('🎉Password change ready: All fields filled, passwords match, policy met');
        showPasswordReadyNotification(pwd.length);
    }

    /**
     * Show password ready notification
     */
    function showPasswordReadyNotification(passwordLength) {
        // Remove existing notification
        const existing = document.getElementById('pwd-ready-notif');
        if (existing) return; // Already shown

        const notif = document.createElement('div');
        notif.id = 'pwd-ready-notif';
        notif.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #d4edda;
            border: 2px solid #28a745;
            border-radius: 8px;
            padding: 16px;
            max-width: 400px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 999999;
            font-family: Arial, sans-serif;
            font-size: 14px;
            color: #155724;
        `;

        notif.innerHTML = `
            <strong>✅ Password Change Ready</strong><br>
            All fields filled correctly<br>
            Password length: ${passwordLength} characters<br>
            Password meets policy requirements<br>
            <small>Click Save to apply changes</small>
            <button onclick="this.parentElement.remove()" style="
                position: absolute;
                top: 8px;
                right: 8px;
                background: none;
                border: none;
                font-size: 20px;
                cursor: pointer;
                color: #666;
            ">×</button>
        `;

        document.body.appendChild(notif);

        // Auto-dismiss after 8 seconds
        setTimeout(() => {
            if (notif.parentElement) notif.remove();
        }, 8000);

        // Send to tray app
        window.postMessage({
            type: 'PASSWORD_FIELD_MODIFIED',
            source: 'password-monitor',
            data: {
                fieldName: 'confirm-password',
                url: window.location.href,
                title: document.title,
                timestamp: Date.now(),
                changeType: 'password_change',
                passwordLength: passwordLength,
                passwordsMatch: true,
                policyMet: true
            }
        }, '*');
    }

    /**
     * Detect what type of password change this is
     */
    function detectPasswordChangeType(field) {
        const name = (field.name || field.id || '').toLowerCase();

        if (name.includes('policy') || name.includes('requirement')) {
            return 'password_policy_change';
        } else if (name.includes('new') || name.includes('change')) {
            return 'password_change';
        } else if (name.includes('reset')) {
            return 'password_reset';
        } else if (name.includes('min') || name.includes('length')) {
            return 'password_length_change';
        } else if (name.includes('complexity') || name.includes('strength')) {
            return 'password_complexity_change';
        } else if (name.includes('expiry') || name.includes('expire')) {
            return 'password_expiry_change';
        } else {
            return 'password_field_change';
        }
    }

    /**
     * Monitor all password fields on the page
     */
    function monitorAllPasswordFields() {
        // Find all input fields
        const allInputs = document.querySelectorAll('input, select, textarea');

        allInputs.forEach(input => {
            if (isPasswordField(input)) {
                monitorPasswordField(input);
            }
        });

        console.log(`🔐 Monitoring ${passwordFieldsMonitored.size} password fields`);
    }

    /**
     * Monitor for dynamically added password fields
     */
    function observePasswordFields() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // Element node
                        // Check if the node itself is a password field
                        if (node.tagName === 'INPUT' && isPasswordField(node)) {
                            monitorPasswordField(node);
                        }

                        // Check for password fields within the node
                        if (node.querySelectorAll) {
                            const inputs = node.querySelectorAll('input, select, textarea');
                            inputs.forEach(input => {
                                if (isPasswordField(input)) {
                                    monitorPasswordField(input);
                                }
                            });
                        }
                    }
                });
            });
        });

        // Only observe if document.body exists
        if (document.body) {
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            console.log('🔐 Password field observer started');
        } else {
            // Wait for body to be available
            document.addEventListener('DOMContentLoaded', () => {
                if (document.body) {
                    observer.observe(document.body, {
                        childList: true,
                        subtree: true
                    });
                    console.log('🔐 Password field observer started (after DOMContentLoaded)');
                }
            });
        }
    }

    /**
     * Monitor Save/Apply button clicks (REDUCED - let fortigate-password-monitor handle it)
     */
    function monitorSaveButtons() {
        document.addEventListener('click', function (e) {
            const target = e.target;
            const text = (target.textContent || target.value || '').toLowerCase();
            const isButton = target.tagName === 'BUTTON' ||
                target.tagName === 'INPUT' && target.type === 'submit';

            if (isButton && (text.includes('save') || text.includes('apply') || text.includes('ok'))) {
                if (passwordChangeDetected) {
                    console.log('🚨 SAVE BUTTON CLICKED WITH PASSWORD CHANGES!');
                    // Don't send notification here - fortigate-password-monitor.js handles it
                }
            }
        }, true);
    }

    /**
     * Monitor for modal/popup dialogs
     */
    function monitorModals() {
        // Watch for new dialogs/modals being added
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        // Check if it's a modal/dialog
                        const isModal = node.classList && (
                            node.classList.contains('modal') ||
                            node.classList.contains('dialog') ||
                            node.classList.contains('popup') ||
                            node.getAttribute('role') === 'dialog'
                        );

                        if (isModal) {
                            console.log('🔐 Modal/Dialog detected, scanning for password fields...');

                            // Scan modal for password fields
                            setTimeout(() => {
                                const inputs = node.querySelectorAll('input, select, textarea');
                                inputs.forEach(input => {
                                    if (isPasswordField(input)) {
                                        console.log('🔐 Found password field in modal:', input.name || input.id);
                                        monitorPasswordField(input);
                                    }
                                });
                            }, 100);
                        }
                    }
                });
            });
        });

        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true
        });

        console.log('🔐 Modal observer started');
    }

    /**
     * Initialize password monitoring (REDUCED MODE)
     */
    function init() {
        console.log('🔐 Password Monitor Starting (Reduced Notification Mode)...');

        // Only monitor password CHANGE pages, not policy pages
        if (isPasswordChangePage()) {
            console.log('🔐 Password change page detected');
        }

        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                console.log('🔐 DOM Ready, starting monitors...');
                monitorAllPasswordFields();
                observePasswordFields();
                monitorSaveButtons();
                monitorModals();
            });
        } else {
            console.log('🔐 DOM Already Ready, starting monitors...');
            monitorAllPasswordFields();
            observePasswordFields();
            monitorSaveButtons();
            monitorModals();
        }
    }

    // Start monitoring
    init();

    // Re-scan periodically for dynamically loaded fields (including modals)
    setInterval(function () {
        const fieldCount = passwordFieldsMonitored.size;
        monitorAllPasswordFields();
        const newFieldCount = passwordFieldsMonitored.size;

        if (newFieldCount > fieldCount) {
            console.log(`🔐 Found ${newFieldCount - fieldCount} new password fields (total: ${newFieldCount})`);
        }
    }, 1000);  // Check every second for modals

})();
