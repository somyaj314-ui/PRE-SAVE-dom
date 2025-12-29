# DATA COLLECTION PIPELINE: DETAILED TECHNICAL WALKTHROUGH

## 🎯 OVERVIEW: How Training Data Is Collected

```
┌──────────────────────────────────────────────────────────────────┐
│                        COMPLETE FLOW                             │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. USER FILLS FORM IN BROWSER                                  │
│       ↓                                                           │
│  2. CAPTURE: universal_field_extractor.js (Values Only)         │
│       ├─ Extract BEFORE state (page load)                       │
│       └─ Extract AFTER state (on save)                          │
│       ↓                                                           │
│  3. MAP: ml-unified-collector.js (Schema Normalization)         │
│       ├─ Detect vendor (FortiGate, Palo Alto)                   │
│       ├─ Detect object type (policy, interface, etc.)           │
│       ├─ Map to canonical schema (vendor_field_map.json)        │
│       └─ Validate & filter                                      │
│       ↓                                                           │
│  4. STORE: Training Data (JSON)                                  │
│       └─ Vendor-agnostic, clean, labeled                        │
│       ↓                                                           │
│  5. EXPORT: Download data.json (Ctrl+Shift+D)                   │
│       ↓                                                           │
│  6. BACKEND: preprocessing.py (Python)                          │
│       └─ Convert to train.pkl (PyTorch tensors)                 │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## STEP 1: FIELD EXTRACTION
### `universal_field_extractor.js` - Raw Value Capture

### Purpose
Extract **pure values only** from forms, no HTML structure, no DOM metadata.

### How It Works

#### Phase A: Page Load (BEFORE State)

```javascript
// USER NAVIGATES TO CONFIG EDIT PAGE
┌────────────────────────────────────┐
│  HTML Page Loads                   │
│  (e.g., /firewall/policy/1)        │
└─────────────┬──────────────────────┘
              │
              ▼
┌────────────────────────────────────┐
│  MutationObserver detects form     │
│  (looks for form, .ngdialog-content│
│   .modal-content, [role="dialog"]) │
└─────────────┬──────────────────────┘
              │
              ▼ (if has >3 input fields)
              
    startMonitoring() called
              │
              ├─► WAIT 500ms (let Angular/React populate)
              │
              └─► extractFormValues(form)
                  
                  ┌────────────────────────────────────┐
                  │ SCAN FOR ALL FORM ELEMENTS:        │
                  ├────────────────────────────────────┤
                  │ 1. <input> text/checkbox/radio     │
                  │ 2. <select> dropdown               │
                  │ 3. <textarea>                      │
                  │ 4. [ng-model] Angular              │
                  │ 5. [formControlName] Reactive      │
                  │ 6. [aria-checked] Toggle           │
                  │ 7. .tag/.chip Multi-value          │
                  │ 8. .active/.selected Toggles       │
                  └────────────────────────────────────┘
                  
                  ┌────────────────────────────────────┐
                  │ FOR EACH ELEMENT:                  │
                  ├────────────────────────────────────┤
                  │                                    │
                  │  1. GET FIELD KEY (Priority)       │
                  │     ├─ ng-model binding            │
                  │     ├─ formControlName             │
                  │     ├─ HTML name attribute         │
                  │     ├─ aria-label                  │
                  │     └─ HTML id                     │
                  │                                    │
                  │  2. EXTRACT VALUE                  │
                  │     ├─ checkbox: true/false        │
                  │     ├─ select: value or []         │
                  │     ├─ text input: .value          │
                  │     ├─ toggle: aria-checked       │
                  │     └─ tags: [items...]            │
                  │                                    │
                  │  3. DEDUPLICATE                    │
                  │     └─ Map() ensures unique keys   │
                  │                                    │
                  └────────────────────────────────────┘
                  
                  ▼ RESULT: Map of field_key → value
                  
    pageState.before = {
      "ng:$ctrl.policy.name": "Allow HTTP",
      "ng:$ctrl.policy.srcintf": "port1",
      "ng:$ctrl.policy.dstintf": "port2",
      "ng:$ctrl.policy.action": "accept",
      ...
    }
    
    ✅ Broadcasted: UNIVERSAL_EVENT_DETECTED
```

#### Key Extraction Methods:

**Method 1: Angular Binding Priority**
```javascript
function getFieldKey(el) {
    // Priority 1: Direct attributes
    if (el.getAttribute('formcontrolname')) 
        return 'ng:' + value;
    
    if (el.getAttribute('ng-model')) 
        return 'ng:' + value;
    
    // Priority 2: Check parent (for radio groups)
    let parent = el.parentElement;
    for (let i = 0; i < 4; i++) {
        if (parent?.getAttribute('ng-model')) 
            return 'ng:' + value;
        parent = parent.parentElement;
    }
    
    // Priority 3: aria-label (FortiGate-specific)
    // Example: aria-label="'comments' | translate"
    const match = el.getAttribute('aria-label')?.match(/'([^']+)'/);
    if (match) return 'ng:' + match[1];
    
    // Priority 4: Associated label
    if (el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`);
        if (label?.getAttribute('ng-model'))
            return 'ng:' + value;
    }
    
    // Priority 5: Standard identifiers
    return el.name || el.id;
}
```

**Method 2: Value Extraction Logic**
```javascript
function extractValue(element) {
    // Checkboxes/Radio buttons
    if (element.type === 'checkbox' || element.type === 'radio') {
        return element.checked ? element.value : 'false';
    }
    
    // Dropdowns (single or multi-select)
    if (element.tagName === 'SELECT') {
        if (element.multiple) {
            return Array.from(element.selectedOptions)
                       .map(opt => opt.value);
        }
        return element.value;
    }
    
    // Text inputs
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        return element.value;
    }
    
    // Custom components (divs with .chip/.tag)
    if (element.classList.contains('tag')) {
        return element.textContent.trim();  // "192.168.1.0/24"
    }
    
    // Active toggle buttons
    if (element.classList.contains('active')) {
        return element.textContent.trim();  // "ACCEPT"
    }
    
    return element.value || element.textContent.trim();
}
```

**Method 3: Multi-Value Tags Deduplication**
```javascript
// Problem: Form has multi-select with chips
// <div class="tags-container">
//   <span class="chip">192.168.1.0/24</span>
//   <span class="chip">10.0.0.0/8</span>
// </div>

fieldMap = new Map();  // Prevents duplicate keys

// First element with key "source_ips" wins
if (!fieldMap.has("source_ips")) {
    fieldMap.set("source_ips", ["192.168.1.0/24", "10.0.0.0/8"]);
}

// If another element has same key, it's IGNORED
// (First value wins strategy)
```

---

#### Phase B: Form Submission (AFTER State)

```javascript
// USER CLICKS "SAVE" / "OK" / "APPLY"
┌────────────────────────────────────┐
│  handleGlobalClick() listens for:  │
│  • button text = "Save"             │
│  • button text = "OK"               │
│  • button text = "Apply"            │
│  • button text = "Create"           │
└─────────────┬──────────────────────┘
              │
              ▼ (mousedown event)
              
    Allow 10ms for final blur events
              │
              ▼
    
    CAPTURE AFTER STATE
    after = extractFormValues(form)
    
    after = {
      "ng:$ctrl.policy.name": "Allow HTTP",
      "ng:$ctrl.policy.srcintf": "port1",
      "ng:$ctrl.policy.dstintf": "port3",  ← CHANGED
      "ng:$ctrl.policy.action": "accept",
      "ng:$ctrl.policy.status": "enable",  ← NEW
    }
    
    ▼
    
    COMPUTE DIFF
    changes = computeDiff(before, after)
    
    changes = [
      {
        field: "ng:$ctrl.policy.dstintf",
        old_value: "port2",
        new_value: "port3"
      },
      {
        field: "ng:$ctrl.policy.status",
        old_value: undefined,
        new_value: "enable"
      }
    ]
    
    ▼
    
    BROADCAST EVENT
    window.postMessage({
        type: 'UNIVERSAL_EVENT_SAVED',
        data: {
            before: {...},
            after: {...},
            changes: [...],
            timestamp: 1702894830
        }
    })
```

---

## STEP 2: FIELD MAPPING & NORMALIZATION
### `ml-unified-collector.js` + `vendor_field_map.json`

### Purpose
Convert **vendor-specific field names** → **canonical schema** (universal format)

### The Mapping Problem

**Problem**: Different vendors use different names for same concept

```
CONCEPT: "Allow Access"

FortiGate names:
  ├─ allowaccess
  ├─ ng:$ctrl.interface.allowaccessGetterSetter(option.name)
  └─ interface_allowaccess

Palo Alto names:
  ├─ allow-access
  ├─ permit-access
  └─ access-control
```

**Solution**: vendor_field_map.json

### The Mapping File Structure

```json
{
  "VENDOR_NAME": {
    "OBJECT_TYPE": {
      "mappings": {
        "VENDOR_FIELD": "CANONICAL_FIELD",
        ...
      },
      "canonical_fields": [
        "CANONICAL_FIELD_1",
        "CANONICAL_FIELD_2",
        ...
      ]
    }
  }
}
```

### Example: FortiGate Policy Mapping

```json
{
  "fortigate": {
    "policy": {
      "mappings": {
        "policyid": "policy_id",
        "name": "name",
        "srcintf": "source_interface",
        "dstintf": "destination_interface",
        "srcaddr": "source_address",
        "dstaddr": "destination_address",
        "action": "action",
        "status": "status",
        "service": "service",
        "comments": "comments",
        
        // Angular bindings
        "ng:$ctrl.policy.srcintf": "source_interface",
        "ng:$ctrl.policy.dstintf": "destination_interface",
        "ng:policyDialog.policy['orig-addr']": "source_address",
        "ng:policyDialog.policy['dst-addr']": "destination_address",
        
        // Can map multiple vendor names to same canonical
        "ng:source": "source_address",
        "ng:destination": "destination_address"
      },
      
      // WHITELIST: Only these are allowed in training data
      "canonical_fields": [
        "policy_id",
        "name",
        "source_interface",
        "destination_interface",
        "source_address",
        "destination_address",
        "action",
        "status",
        "service",
        "comments",
        "log_traffic",
        "nat_enabled"
      ]
    }
  }
}
```

### The Mapping Process (Step-by-Step)

```javascript
// INPUT: Raw extracted data from UI
before = {
  "ng:$ctrl.policy.srcintf": "port1",
  "ng:policyDialog.policy['orig-addr']": "192.168.1.0/24",
  "ng:$ctrl.policy.dstintf": "port2",
  "for_id_12345abc": "some_value",      // DOM ID - should be filtered
  "ng:$ctrl.policy.name": "Allow HTTP"
}

// STEP 1: Get configuration for this vendor/object type
vendor = "fortigate"
objectType = "policy"
config = vendorMap[vendor][objectType]

mappings = config.mappings        // name→canonical mapping
allowedFields = config.canonical_fields  // whitelist

// STEP 2: Map each field
const mapped = {};
const dropped = [];

Object.keys(before).forEach(rawKey => {
  
  // A. Check for DOM noise first
  if (isDOMNoise(rawKey)) {      // "for_id_12345abc"
    dropped.push(rawKey);
    return;
  }
  
  // B. Try to map the key
  let canonicalKey = mappings[rawKey];
  
  if (canonicalKey) {
    // Mapping exists - check if result is whitelisted
    if (allowedFields.includes(canonicalKey)) {
      mapped[canonicalKey] = normalizeValue(before[rawKey]);
    } else {
      dropped.push(`${rawKey} → ${canonicalKey} (not whitelisted)`);
    }
  } else {
    // No mapping - check if raw key is whitelisted
    if (allowedFields.includes(rawKey)) {
      mapped[rawKey] = normalizeValue(before[rawKey]);
    } else {
      dropped.push(`${rawKey} (no mapping, not whitelisted)`);
    }
  }
});

// OUTPUT: Canonical, clean data
canonicalBefore = {
  "source_interface": "port1",
  "source_address": "192.168.1.0/24",
  "destination_interface": "port2",
  "name": "Allow HTTP"
}

// Dropped: "for_id_12345abc" (DOM noise)
```

### What Is "DOM Noise"?

```javascript
function isDOMNoise(key) {
  const noisePatterns = [
    /^for_id_/,           // for_id_mj6po5w1 - session-specific DOM IDs
    /^radio_id/,          // radio_idmj6po5vu - radio button IDs
    /^__/,                // __internal - private variables
    /^_ng/,               // _ngcontent - Angular internals
    /^data-ng/,           // data-ng-* - Angular directives
    /^\$(?!ctrl)/,        // $scope (but NOT ng:$ctrl which is binding)
    /^aria-/,             // aria-* attributes
    /^data-/              // data-* generic attributes
  ];
  
  return noisePatterns.some(p => p.test(key));
}

// Examples that ARE filtered (noise):
❌ "for_id_mj6po5w1"       // DOM ID (session-specific)
❌ "radio_idmj6po5vu"       // Radio ID (session-specific)
❌ "_ngcontent_mc12"        // Angular internal
❌ "__initialized"          // Private variable

// Examples that ARE kept (semantic):
✅ "ng:$ctrl.policy.name"   // Angular binding (data)
✅ "policy_name"            // Field name
✅ "source_address"         // Business data
```

### Value Normalization

```javascript
function normalizeValue(value) {
  // Null/undefined passthrough
  if (value === null || value === undefined) return value;
  
  // Array handling (multi-select)
  if (Array.isArray(value)) {
    return value.map(v => normalizeValue(v));
  }
  
  // Boolean normalization
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    
    // Strings that MEAN true
    if (['on', 'checked', 'enabled', 'yes', 'true'].includes(lower))
      return true;
    
    // Strings that MEAN false
    if (['off', 'unchecked', 'disabled', 'no', 'false'].includes(lower))
      return false;
    
    // Number normalization
    if (!isNaN(value) && value.trim() !== '')
      return Number(value);
  }
  
  return value;  // Keep as-is
}

// Examples:
normalizeValue("yes")           → true
normalizeValue("on")            → true
normalizeValue("false")         → false
normalizeValue("192.168.1.0")   → "192.168.1.0" (not IP, string)
normalizeValue("8080")          → 8080 (number)
normalizeValue(["host1", "host2"]) → ["host1", "host2"]
```

---

## STEP 3: OBJECT TYPE DETECTION

```javascript
function detectObjectType(url) {
  const u = url.toLowerCase();
  
  // Order matters: Most specific FIRST
  
  // 1. Admin users (specific)
  if (u.includes('admin') && u.includes('user')) return 'admin_user';
  
  // 2. DoS policy (check before generic policy)
  if ((u.includes('dos') && u.includes('policy')) || u.includes('dos-policy'))
    return 'dos_policy';
  
  // 3. Generic policy (after DoS, NAT)
  if (u.includes('policy/policy') || u.includes('firewall/policy'))
    return 'policy';
  
  // 4. VPN
  if (u.includes('vpn') && (u.includes('ipsec') || u.includes('tunnel')))
    return 'vpn_ipsec_tunnel';
  
  // 5. Network
  if (u.includes('system/interface') || u.includes('ng/interface'))
    return 'network_interface';
  
  // 6. Addresses
  if (u.includes('firewall/address'))
    return 'firewall_address';
  
  // 7. NAT (after policy)
  if (u.includes('snat') || u.includes('central-snat'))
    return 'central_snat';
  
  return 'unknown_object';  // Reject unknown
}

// Examples:
detectObjectType('http://10.10.10.1/firewall/policy/1')
  → 'policy'

detectObjectType('http://10.10.10.1/firewall/address/create')
  → 'firewall_address'

detectObjectType('http://10.10.10.1/admin/user/edit/2')
  → 'admin_user'

detectObjectType('http://10.10.10.1/vpn/ipsec/edit/1')
  → 'vpn_ipsec_tunnel'
```

---

## STEP 4: CONSTRUCT CANONICAL SAMPLE

```javascript
// After mapping, we have canonical data
// Now construct the sample for training

const sample = {
  // METADATA
  metadata: {
    timestamp: 1702894830,
    vendor: "fortigate",
    object_type: "policy",
    data_source: "universal_extractor"
  },
  
  // DATA (canonical form)
  data: {
    before: {
      "policy_id": "1",
      "name": "Allow HTTP",
      "source_interface": "port1",
      "destination_interface": "port2",
      "source_address": "192.168.1.0/24",
      "destination_address": "0.0.0.0/0",
      "service": "HTTP",
      "action": "accept",
      "status": "enable"
    },
    after: {
      "policy_id": "1",
      "name": "Allow HTTP",
      "source_interface": "port1",
      "destination_interface": "port3",  // CHANGED
      "source_address": "192.168.1.0/24",
      "destination_address": "0.0.0.0/0",
      "service": "HTTP",
      "action": "accept",
      "status": "enable"
    }
  },
  
  // CHANGES (which fields were modified)
  changes: [
    {
      field: "destination_interface",
      old: "port2",
      new: "port3"
    }
  ]
}
```

### Quality Validation

```javascript
// Check if sample is valid

// 1. Are there ANY fields?
if (Object.keys(canonicalBefore).length === 0 && 
    Object.keys(canonicalAfter).length === 0) {
  
  // Check if raw data existed but was FILTERED OUT
  if (Object.keys(rawBefore).length > 0) {
    console.error("❌ All fields filtered out - mapping may be wrong");
    return;  // Reject sample
  }
}

// 2. Is there DOM noise?
allFields = [
  ...Object.keys(canonicalBefore),
  ...Object.keys(canonicalAfter)
];
if (allFields.some(f => isDOMNoise(f))) {
  console.error("❌ DOM noise leaked through!");
  return;
}

// ✅ Sample is valid
console.log("✅ Sample accepted");
```

---

## STEP 5: TRAINING DATA EXPORT

### How Data Is Downloaded

```javascript
// User presses: Ctrl+Shift+D

function downloadUnifiedSamples() {
  const exportData = {
    version: "2.0-universal",
    stats: {
      total: 1523,
      by_type: {
        "policy": 450,
        "interface": 380,
        "admin_user": 250,
        "firewall_address": 220,
        "vpn_ipsec_tunnel": 180,
        "central_snat": 43
      }
    },
    samples: [
      // ... 1523 samples ...
      {
        metadata: {...},
        data: {...},
        changes: [...]
      }
    ]
  };
  
  const blob = new Blob([JSON.stringify(exportData, null, 2)], 
                        {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `universal_training_data_${Date.now()}.json`;
  a.click();
}
```

### Downloaded File Structure

```json
{
  "version": "2.0-universal",
  "stats": {
    "total": 1523,
    "by_type": {
      "policy": 450,
      "admin_user": 380,
      "network_interface": 250,
      "firewall_address": 220,
      "vpn_ipsec_tunnel": 180
    }
  },
  "samples": [
    {
      "metadata": {
        "timestamp": 1702894830,
        "vendor": "fortigate",
        "object_type": "policy",
        "data_source": "universal_extractor"
      },
      "data": {
        "before": {
          "policy_id": "1",
          "name": "Policy 1",
          ...
        },
        "after": {
          "policy_id": "1",
          "name": "Policy 1 Updated",
          ...
        }
      },
      "changes": [
        {
          "field": "name",
          "old": "Policy 1",
          "new": "Policy 1 Updated"
        }
      ]
    },
    // ... 1522 more samples ...
  ]
}
```

### File Size Estimate

- **Per sample**: ~500 bytes - 2 KB (depending on fields)
- **1000 samples**: 500 KB - 2 MB
- **5000 samples**: 2.5 MB - 10 MB
- **10000 samples**: 5 MB - 20 MB

---

## STEP 6: BACKEND PREPROCESSING

### `preprocessing.py` - Convert to ML Format

```python
import json
import pickle
from sklearn.feature_extraction.text import TfidfVectorizer
import numpy as np

# LOAD raw training data
with open('data.json', 'r') as f:
    raw_data = json.load(f)

samples = raw_data['samples']

texts = []        # Text content of fields
structs = []      # Structure of form (fields present/absent)
diffs = []        # Which fields changed
labels = []       # Type of change (CREATED, MODIFIED)

# PROCESS each sample
for sample in samples:
    # 1. TEXT PROCESSING
    # ==================
    text_features = []
    
    # Extract all field names and values from 'after' state
    after_data = sample['data']['after']
    for key, value in after_data.items():
        text_features.append(key)  # Field name
        if isinstance(value, str):
            text_features.append(value)  # Field value (if string)
    
    # Join all text into one document
    text_doc = " ".join(text_features)
    texts.append(text_doc)
    
    # 2. STRUCTURAL PROCESSING
    # ========================
    # Flatten nested objects to binary vector
    # presence[i] = 1 if field i exists, 0 otherwise
    
    struct_vec = []
    
    def flatten(obj, out_list):
        for key, value in obj.items():
            if isinstance(value, dict):
                flatten(value, out_list)  # Nested dict
            else:
                # Binary: 1 if value is not empty/null, else 0
                if value in (None, False, [], ''):
                    out_list.append(0)
                else:
                    out_list.append(1)
    
    # Flatten both before and after states
    flatten(sample['data']['before'], struct_vec)
    flatten(sample['data']['after'], struct_vec)
    
    structs.append(struct_vec)
    
    # 3. DIFF PROCESSING
    # ==================
    # Which fields were modified? Create bit vector.
    
    diff_vec = [0] * 200  # 200-dimensional bit vector
    
    for change in sample['changes']:
        field_name = change['field']
        
        # Hash the field name to an index
        hash_value = hash(field_name)
        idx = abs(hash_value) % 200  # Map to 0-199
        
        diff_vec[idx] = 1  # Mark this bit as "this field changed"
    
    diffs.append(diff_vec)
    
    # 4. LABEL
    # ========
    # Determine type of change
    
    # Method 1: Heuristic
    # If 'before' is empty → CREATE
    # If 'before' has data → MODIFY
    if not sample['data']['before'] or len(sample['data']['before']) == 0:
        label = "CREATED"
    else:
        label = "MODIFIED"
    
    labels.append(label)

# 5. VECTORIZE TEXT
# =================
# Convert text documents to TF-IDF vectors

vectorizer = TfidfVectorizer(max_features=2000)
tfidf_vectors = vectorizer.fit_transform(texts).toarray()

print(f"TF-IDF vocabulary size: {len(vectorizer.vocabulary_)}")
print(f"Samples: {len(texts)}")
print(f"Text vector shape: {tfidf_vectors.shape}")  # (N, 2000)

# 6. NORMALIZE STRUCT VECTORS
# ============================
# All samples should have same struct vector length

max_struct_len = max(len(s) for s in structs)
for i in range(len(structs)):
    # Pad with zeros to max length
    structs[i] = structs[i] + [0] * (max_struct_len - len(structs[i]))

print(f"Struct vector length: {max_struct_len}")

# 7. SAVE AS PICKLE
# =================
# PyTorch-compatible format

output = {
    "texts": texts,           # Raw text docs
    "tfidf_vectors": tfidf_vectors,  # [N, 2000] TF-IDF
    "structs": structs,       # [N, max_len] binary
    "diffs": diffs,           # [N, 200] bit vectors
    "labels": labels,         # [N] class labels
}

with open('train.pkl', 'wb') as f:
    pickle.dump(output, f)

print("✅ Saved to train.pkl")
print(f"Output shapes:")
print(f"  texts: {len(texts)}")
print(f"  tfidf_vectors: {tfidf_vectors.shape}")
print(f"  structs: {len(structs)} x {max_struct_len}")
print(f"  diffs: {len(diffs)} x 200")
print(f"  labels: {len(labels)}")
```

### Data Shape After Preprocessing

```
Input: data.json (1000 samples)
   ↓
Processing:
   ├─ texts: 1000 text documents
   ├─ TF-IDF: [1000, 2000] float matrix
   ├─ structs: [1000, 847] binary matrix (padded)
   ├─ diffs: [1000, 200] binary matrix
   └─ labels: [1000] strings (CREATED/MODIFIED)
   ↓
Output: train.pkl (PyTorch tensors)
```

---

## STEP 7: WHAT THE MODEL RECEIVES

### Sample Training Record

```python
Sample index 0:
  ├─ text_vector: [0.12, 0.0, 0.45, ... 0.02] (2000 dims)
  ├─ struct_vector: [1, 0, 1, 1, 0, ..., 0] (847 dims)
  ├─ diff_vector: [0, 1, 0, 0, 0, ..., 1] (200 dims)
  ├─ label: "POLICY_CREATED"  → tensor([0])  (encoded as class 0)
  └─ confidence: model learns this is HIGH-confidence CREATION

Sample index 1:
  ├─ text_vector: [0.08, 0.03, 0.22, ... 0.15] (2000 dims)
  ├─ struct_vector: [1, 1, 1, 0, 1, ..., 1] (847 dims)
  ├─ diff_vector: [0, 0, 1, 0, 1, ..., 0] (200 dims)
  ├─ label: "POLICY_MODIFIED"  → tensor([1])  (encoded as class 1)
  └─ confidence: this is a MODIFICATION (fewer changes)
```

---

## 📊 COMPLETE FLOW DIAGRAM: Data to Model

```
┌────────────────────────────────────────────────────────────┐
│  BROWSER EXTENSION (On page load)                          │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  extractFormValues()                                       │
│  ├─ Scan all input/select/textarea elements              │
│  ├─ Extract field keys (ng-model priority)               │
│  ├─ Get values (checkbox=true/false, etc.)               │
│  ├─ Filter DOM noise                                      │
│  └─ Return: {key1: value1, key2: value2, ...}            │
│                                                            │
│  pageState.before = {...}                                 │
│                                                            │
└────────────────────────────────────────────────────────────┘
                         │
                    (User fills form)
                         │
┌────────────────────────────────────────────────────────────┐
│  BROWSER EXTENSION (On save click)                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  handleGlobalClick() detects "Save" button                │
│  └─ extractFormValues() again                             │
│     └─ pageState.after = {...}                           │
│                                                            │
│  computeDiff(before, after)                               │
│  └─ changes = [{field, old_value, new_value}, ...]       │
│                                                            │
│  postMessage(UNIVERSAL_EVENT_SAVED)                       │
│                                                            │
└────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────────────────────────────────────────┐
│  MAPPING & COLLECTION (Background Script)                 │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  processUniversalEvent()                                  │
│  ├─ detectVendor(url) → "fortigate"                       │
│  ├─ detectObjectType(url) → "policy"                      │
│  ├─ mapFields(before, vendor, objectType)                │
│  │  ├─ Look up mappings in vendor_field_map.json        │
│  │  ├─ Apply whitelist filter                            │
│  │  └─ Return canonical_before                           │
│  ├─ mapFields(after, vendor, objectType)                 │
│  │  └─ Return canonical_after                            │
│  ├─ Filter changes to canonical fields                    │
│  │  └─ Return canonical_changes                          │
│  └─ Validate & store sample                              │
│                                                            │
│  allSamples.push(sample)                                  │
│                                                            │
└────────────────────────────────────────────────────────────┘
                         │
              (User presses Ctrl+Shift+D)
                         │
┌────────────────────────────────────────────────────────────┐
│  EXPORT TO JSON                                            │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  downloadUnifiedSamples()                                 │
│  └─ JSON download: universal_training_data_*.json         │
│                                                            │
│  Example: 1523 canonical samples                          │
│                                                            │
└────────────────────────────────────────────────────────────┘
                         │
              (Upload to backend)
                         │
┌────────────────────────────────────────────────────────────┐
│  PYTHON PREPROCESSING                                      │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  preprocessing.py                                         │
│  ├─ Extract text from field names/values                 │
│  ├─ Flatten structs to binary vectors                     │
│  ├─ Hash diffs to bit vectors                             │
│  ├─ Vectorize text with TF-IDF                            │
│  ├─ Pad all to same length                                │
│  └─ Save as train.pkl                                     │
│                                                            │
│  Output shapes:                                           │
│  ├─ tfidf: [1523, 2000]                                   │
│  ├─ structs: [1523, 847]                                  │
│  ├─ diffs: [1523, 200]                                    │
│  └─ labels: [1523]                                        │
│                                                            │
└────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────────────────────────────────────────┐
│  PYTORCH MODEL TRAINING                                    │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  train.py loads train.pkl                                │
│  ├─ Create dataset + dataloader (batch_size=4)           │
│  ├─ Define model with 3 MLPs                             │
│  ├─ Run 25 epochs:                                        │
│  │  ├─ For each batch:                                   │
│  │  │  ├─ text_mlp(tfidf[2000]) → [128]                │
│  │  │  ├─ struct_mlp(struct[847]) → [128]              │
│  │  │  ├─ diff_mlp(diff[200]) → [128]                  │
│  │  │  ├─ cat([128,128,128]) → [384]                   │
│  │  │  ├─ fc([384]) → logits                           │
│  │  │  ├─ softmax → probabilities                       │
│  │  │  ├─ CrossEntropy loss                            │
│  │  │  └─ backprop + update                            │
│  │  └─ Print epoch loss                                │
│  └─ Save: model_artifacts.pkl                            │
│     ├─ model weights                                     │
│     ├─ vectorizer (TF-IDF)                              │
│     ├─ label_map                                         │
│     └─ metadata (dims)                                   │
│                                                            │
└────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────────────────────────────────────────┐
│  MODEL EXPORT                                              │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  export_model.py                                          │
│  ├─ Extract model weights (PyTorch → lists)             │
│  ├─ Extract TF-IDF vocab & IDF weights                  │
│  ├─ Create JSON structure                                │
│  └─ Save: model_data.json (2-5 MB)                      │
│                                                            │
│  Can now load in JavaScript!                             │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 🎓 REAL-WORLD EXAMPLE: Policy Creation

### Raw Capture

```
URL: http://10.10.10.1/firewall/policy/create

BEFORE state (on page load):
{
  "ng:policyid": "",
  "ng:name": "",
  "ng:srcintf": "",
  "ng:dstintf": "",
  "ng:action": "accept",  (default)
  "ng:status": "enable"    (default)
}

USER FILLS:
- Name: "Allow HTTPS"
- Source Interface: "port1"
- Destination Interface: "port2"
- Source Address: "192.168.1.0/24"

AFTER state (on save):
{
  "ng:policyid": "1",
  "ng:name": "Allow HTTPS",
  "ng:srcintf": "port1",
  "ng:dstintf": "port2",
  "ng:srcaddr": "192.168.1.0/24",
  "ng:dstaddr": "any",
  "ng:action": "accept",
  "ng:status": "enable"
}

CHANGES:
[
  {field: "ng:policyid", old: "", new: "1"},
  {field: "ng:name", old: "", new: "Allow HTTPS"},
  {field: "ng:srcintf", old: "", new: "port1"},
  {field: "ng:dstintf", old: "", new: "port2"},
  {field: "ng:srcaddr", old: "", new: "192.168.1.0/24"},
  {field: "ng:dstaddr", old: "", new: "any"}
]
```

### After Mapping

```
vendor_field_map.json says:
- "ng:policyid" → "policy_id"
- "ng:name" → "name"
- "ng:srcintf" → "source_interface"
- "ng:dstintf" → "destination_interface"
- "ng:srcaddr" → "source_address"
- "ng:dstaddr" → "destination_address"

CANONICAL BEFORE:
{
  "policy_id": "",
  "name": "",
  "source_interface": "",
  "destination_interface": "",
  "source_address": "",
  "destination_address": "any",
  "action": "accept",
  "status": "enable"
}

Wait... but most fields are EMPTY!
This means: IF before is {all empty} → CREATION event

MODEL LEARNS:
"Empty before state + changes → POLICY_CREATED"
```

### In Training Data

```json
{
  "metadata": {
    "timestamp": 1702894830,
    "vendor": "fortigate",
    "object_type": "policy",
    "data_source": "universal_extractor"
  },
  "data": {
    "before": {
      "policy_id": "",
      "name": "",
      "source_interface": "",
      "destination_interface": "",
      "source_address": "",
      "destination_address": "any",
      "action": "accept",
      "status": "enable"
    },
    "after": {
      "policy_id": "1",
      "name": "Allow HTTPS",
      "source_interface": "port1",
      "destination_interface": "port2",
      "source_address": "192.168.1.0/24",
      "destination_address": "any",
      "action": "accept",
      "status": "enable"
    }
  },
  "changes": [
    {"field": "policy_id", "old": "", "new": "1"},
    {"field": "name", "old": "", "new": "Allow HTTPS"},
    {"field": "source_interface", "old": "", "new": "port1"},
    {"field": "destination_interface", "old": "", "new": "port2"},
    {"field": "source_address", "old": "", "new": "192.168.1.0/24"}
  ]
}
```

### In ML Training

```python
# After preprocessing.py

text_vector = TF-IDF(['policy', 'id', '1', 'name', 'Allow', 'HTTPS', 
                      'source_interface', 'port1', ...])
              → [0.12, 0.0, 0.45, ..., 0.02]  (2000 dims)

struct_vector = [1, 0, 1, 1, 0, 1, 1, 0, 1, ..., 1]  (847 dims)
                (1 = field has value, 0 = empty)

diff_vector = [0, 1, 0, 1, 0, 0, 1, ..., 0]  (200 dims)
              (1 = this field changed)

label = "POLICY_CREATED"
```

---

## 📋 SUMMARY TABLE

| Stage | Component | Input | Output | Format |
|-------|-----------|-------|--------|--------|
| 1. Capture | universal_field_extractor.js | HTML form | Raw key-value pairs | JavaScript objects |
| 2. Map | ml-unified-collector.js | Raw + vendor_field_map.json | Canonical sample | JSON |
| 3. Export | Browser UI | All samples (Ctrl+Shift+D) | data.json | JSON file |
| 4. Preprocess | preprocessing.py | data.json | train.pkl | PyTorch tensors |
| 5. Train | train.py | train.pkl | model_artifacts.pkl | PyTorch model |
| 6. Export Model | export_model.py | model_artifacts.pkl | model_data.json | JSON (JS-compatible) |

---

