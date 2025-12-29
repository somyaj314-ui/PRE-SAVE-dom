// Load and display captured data stats
document.addEventListener('DOMContentLoaded', () => {
  loadStats();

  document.getElementById('viewData').addEventListener('click', viewData);
  document.getElementById('exportData').addEventListener('click', exportData);
  document.getElementById('clearData').addEventListener('click', clearData);
});

function loadStats() {
  chrome.runtime.sendMessage({ type: 'GET_CAPTURED_DATA' }, (response) => {
    if (response && response.success) {
      document.getElementById('apiCount').textContent = response.data.apiRequests.length;
      document.getElementById('uiCount').textContent = response.data.uiMetadata.length;
    }
  });
}

function viewData() {
  chrome.runtime.sendMessage({ type: 'GET_CAPTURED_DATA' }, (response) => {
    if (response && response.success) {
      console.log('Captured Data:', response.data);
      alert('Data logged to console. Press F12 to view.');
    }
  });
}

function exportData() {
  chrome.runtime.sendMessage({ type: 'GET_CAPTURED_DATA' }, (response) => {
    if (response && response.success) {
      const dataStr = JSON.stringify(response.data, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `portal-capture-${Date.now()}.json`;
      a.click();

      URL.revokeObjectURL(url);
    }
  });
}

function clearData() {
  if (confirm('Are you sure you want to clear all captured data? This action cannot be undone.')) {
    chrome.runtime.sendMessage({ type: 'CLEAR_ALL_DATA' }, (response) => {
      if (response && response.success) {
        alert('✅ All data cleared successfully!');
        // Reload stats to show 0 counts
        loadStats();
      } else {
        alert('❌ Failed to clear data. Please try again.');
      }
    });
  }
}
