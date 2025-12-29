// ml-config.js
(function () {
    // Get the script element that loaded this code
    const currentScript = document.currentScript || (function () {
        const scripts = document.getElementsByTagName('script');
        return scripts[scripts.length - 1];
    })();

    // Retrieve the model URL from the data attribute
    const modelUrl = currentScript.getAttribute('data-model-url');

    if (modelUrl) {
        window.__ML_MODEL_URL__ = modelUrl;
        console.log('✅ Global configuration set: window.__ML_MODEL_URL__ =', modelUrl);
    } else {
        console.warn('⚠️ ml-config.js loaded but data-model-url attribute was missing.');
    }
})();
