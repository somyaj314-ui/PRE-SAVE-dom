# 🤖 CODEBASE ARCHITECTURE & ML PRE-DETECTION FLOW

## 📋 TABLE OF CONTENTS
1. [High-Level Architecture](#high-level-architecture)
2. [Complete Data Flow](#complete-data-flow)
3. [How ML Pre-Detection Works](#how-ml-pre-detection-works)
4. [Module Descriptions](#module-descriptions)
5. [Model Architecture](#model-architecture)
6. [Code Architecture Diagram](#code-architecture-diagram)

---

## 🏗️ HIGH-LEVEL ARCHITECTURE

This is a **Chrome Extension** that captures configuration changes from web portals (FortiGate, Palo Alto) and uses Machine Learning to **predict the operation type** (CREATE, MODIFY, DELETE, etc.) before manual submission.

```
┌─────────────────────────────────────────────────────────────────┐
│                    CHROME EXTENSION ARCHITECTURE                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  🌐 WEB PORTAL (Fortinet, Palo Alto, etc.)                     │
│  ├─ User fills form (policy, interface, route, etc.)           │
│  └─ Clicks "Save" or "Create"                                 │
│       │                                                         │
│       ▼                                                         │
│  ┌────────────────────────────────────────────────────┐        │
│  │  CONTENT SCRIPT (content.js)                       │        │
│  │  ├─ Runs in webpage context                        │        │
│  │  └─ Injects additional scripts                     │        │
│  └────────────┬─────────────────────────────────────┘        │
│               │ window.postMessage()                           │
│       ┌───────▼──────────┬─────────────────┬──────────────┐   │
│       │                  │                 │              │   │
│       ▼                  ▼                 ▼              ▼   │
│  ┌────────────┐  ┌────────────────┐  ┌──────────┐  ┌────┐   │
│  │ Universal  │  │ ML Unified     │  │ ML       │  │URL │   │
│  │ Field      │  │ Collector      │  │ Inference│  │Router    │
│  │ Extractor  │  │                │  │          │  │    │   │
│  │ (Raw data) │  │ (Normalization)│  │(Predict) │  │    │   │
│  └────────────┘  └────────────────┘  └──────────┘  └────┘   │
│       │                  │                 │                  │
│       └──────────────────┼─────────────────┘                  │
│                          ▼                                     │
│              Training Data Collection                         │
│              (JSON in memory + IndexedDB)                     │
│                          │                                     │
│                          ▼                                     │
│         ┌─────────────────────────────────┐                  │
│         │  🔄 EXPORT (Ctrl+Shift+D)       │                  │
│         │  ├─ data.json (raw samples)     │                  │
│         │  └─ model_data.json (trained)   │                  │
│         └──────────────┬──────────────────┘                  │
│                        │                                      │
└────────────────────────┼──────────────────────────────────────┘
                         │
                         ▼
    ┌──────────────────────────────────────────────────┐
    │         PYTHON BACKEND (Training)                │
    ├──────────────────────────────────────────────────┤
    │                                                  │
    │  preprocessing.py                              │
    │  ├─ Tokenization (TF-IDF)                       │
    │  ├─ Struct vector (field presence)              │
    │  ├─ Diff vector (changes hashed)                │
    │  └─ Output: train.pkl (PyTorch tensors)         │
    │                                                  │
    │  train.py                                       │
    │  ├─ Load train.pkl                              │
    │  ├─ Build 3-expert MLP model                    │
    │  ├─ Train for 25 epochs                         │
    │  └─ Output: model_artifacts.pkl                 │
    │                                                  │
    │  export_model.py                                │
    │  ├─ Extract weights, vocab, IDF                 │
    │  └─ Output: model_data.json (JS-compatible)     │
    │                                                  │
    └──────────────────────────────────────────────────┘
                         │
                         ▼
    ┌──────────────────────────────────────────────────┐
    │  model_data.json → Back to Extension            │
    │  └─ ML Inference runs in JS on next page load   │
    └──────────────────────────────────────────────────┘
```

---

## 🔄 COMPLETE DATA FLOW

### PHASE 1: DATA COLLECTION (Runtime)

```
┌─────────────────────────────────────────────────────────────────┐
│                   PHASE 1: DATA COLLECTION                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  STEP 1: PAGE LOAD                                              │
│  ──────────────────                                              │
│  User navigates to: /firewall/policy/create or /firewall/policy/1
│                                                                 │
│           ┌─────────────────────────────────┐                  │
│           │ HTML Loads                      │                  │
│           │ (form, inputs, selects detected)│                  │
│           └────────────┬────────────────────┘                  │
│                        │                                        │
│              ▼         ▼         ▼                              │
│  universal_field_extractor.js FIRES                            │
│  ├─ MutationObserver detects form element                      │
│  ├─ Waits 500ms for Angular/React to populate                 │
│  └─ Extracts BEFORE state (page load)                         │
│                                                                 │
│  Example BEFORE state:                                          │
│  ──────────────────────                                         │
│  {                                                              │
│    "name": null,                   ← Empty field               │
│    "srcintf": "port1",             ← Pre-filled               │
│    "dstintf": "port2",             ← Pre-filled               │
│    "action": null,                 ← Empty                     │
│    "enabled": true                 ← Has default              │
│  }                                                              │
│                                                                 │
│  Broadcasts: UNIVERSAL_MONITOR_START                           │
│               ↓                                                  │
│  ─────────────────────────────────────────────────────────     │
│                                                                 │
│  STEP 2: USER INTERACTS                                        │
│  ──────────────────────                                         │
│  User fills form:                                               │
│    - Sets name = "Allow HTTP"                                  │
│    - Selects action = "accept"                                 │
│    - Leaves dstintf as is                                      │
│                                                                 │
│  Detector tracks changes in real-time                          │
│  (listens to input events, change events, etc.)                │
│                                                                 │
│  ─────────────────────────────────────────────────────────     │
│                                                                 │
│  STEP 3: SAVE CLICKED                                          │
│  ──────────────────                                             │
│  User clicks "Save" or "Create"                                │
│                                                                 │
│           ┌──────────────────────────────┐                     │
│           │ extractFormValues() fires     │                     │
│           │ (on click or API intercept)   │                     │
│           └────────┬─────────────────────┘                     │
│                    │                                             │
│         ▼          ▼          ▼                                 │
│  universal_field_extractor.js captures AFTER state             │
│                                                                 │
│  Example AFTER state:                                           │
│  ─────────────────────                                          │
│  {                                                              │
│    "name": "Allow HTTP",           ← Changed                   │
│    "srcintf": "port1",             ← Same as before            │
│    "dstintf": "port2",             ← Same as before            │
│    "action": "accept",             ← Changed                   │
│    "enabled": true                 ← Same                      │
│  }                                                              │
│                                                                 │
│  ─────────────────────────────────────────────────────────     │
│                                                                 │
│  STEP 4: CANONICAL MAPPING                                     │
│  ────────────────────────                                       │
│  Broadcasts: UNIVERSAL_EVENT_SAVED                             │
│               ↓                                                  │
│  ml-unified-collector.js receives event                        │
│                                                                 │
│  Step 4A: Detect Vendor & Object Type                          │
│  ├─ URL parsing: /firewall/policy/ → vendor="fortigate"       │
│  ├─ Load vendor_field_map.json                                │
│  └─ Identify: object_type="policy"                            │
│                                                                 │
│  Step 4B: Map to Canonical Fields                              │
│  ├─ Original field: "ng:$ctrl.policy.srcintf"                 │
│  ├─ Lookup in mapping: srcintf → "source_interface"          │
│  └─ Canonical field: "source_interface"                       │
│                                                                 │
│  Step 4C: Calculate Differences                                │
│  ├─ Before: {name: null, action: null}                        │
│  ├─ After: {name: "Allow HTTP", action: "accept"}            │
│  └─ Changes: ["name", "action"]                               │
│                                                                 │
│  Step 4D: Infer Operation Type                                 │
│  ├─ Check identity field (e.g., "name")                       │
│  ├─ Before.name = null, After.name = "Allow HTTP"            │
│  └─ Operation = "CREATE"                                       │
│                                                                 │
│  ─────────────────────────────────────────────────────────     │
│                                                                 │
│  STEP 5: CREATE SAMPLE & STORE                                 │
│  ──────────────────────────                                     │
│  Canonical Sample (normalized):                                │
│  ─────────────────────────────                                 │
│  {                                                              │
│    metadata: {                                                  │
│      vendor: "fortigate",                                      │
│      object_type: "policy",                                    │
│      operation: "CREATE",                                      │
│      timestamp: 1766051559664                                  │
│    },                                                           │
│    data: {                                                      │
│      before: {                                                  │
│        name: null,                                              │
│        source_interface: "port1",                              │
│        dest_interface: "port2",                               │
│        action: null,                                            │
│        enabled: true                                           │
│      },                                                         │
│      after: {                                                   │
│        name: "Allow HTTP",                                     │
│        source_interface: "port1",                              │
│        dest_interface: "port2",                               │
│        action: "accept",                                       │
│        enabled: true                                           │
│      }                                                          │
│    },                                                           │
│    changes: [                                                   │
│      { field: "name", before: null, after: "Allow HTTP" },    │
│      { field: "action", before: null, after: "accept" }       │
│    ]                                                            │
│  }                                                              │
│                                                                 │
│  Store in:                                                      │
│  ├─ Memory: allSamples[]                                       │
│  ├─ IndexedDB: persistent storage                              │
│  └─ Model: for ML training                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### PHASE 2: ML PRE-DETECTION (Runtime)

```
┌─────────────────────────────────────────────────────────────────┐
│                PHASE 2: ML PRE-DETECTION                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  STEP 1: MODEL LOADED                                           │
│  ────────────────────                                            │
│  On page load:                                                  │
│  ├─ model_data.json fetched (contains trained weights)         │
│  ├─ MLInference class instantiated                             │
│  └─ console: "🧠 ML Inference Engine Loaded"                   │
│                                                                 │
│  ─────────────────────────────────────────────────────────     │
│                                                                 │
│  STEP 2: CAPTURE CURRENT FORM STATE                            │
│  ─────────────────────────────                                  │
│  When user fills form, ml-unified-collector captures:          │
│  ├─ data.after = {name: "Allow HTTP", action: "accept", ...}  │
│  ├─ changes = ["name", "action"]                               │
│  └─ metadata.object_type = "policy"                            │
│                                                                 │
│  ─────────────────────────────────────────────────────────     │
│                                                                 │
│  STEP 3: FEATURE EXTRACTION (2 passes)                         │
│  ──────────────────────────────────────                         │
│                                                                 │
│  Pass A: TEXT FEATURES (TF-IDF Vectorization)                  │
│  ──────────────────────────────────────────                    │
│                                                                 │
│  Input: Field names + values                                   │
│  ┌─────────────────────────────────────┐                      │
│  │ name: "Allow HTTP"                  │                      │
│  │ action: "accept"                    │                      │
│  │ source_interface: "port1"           │                      │
│  │ dest_interface: "port2"             │                      │
│  └─────────────────────────────────────┘                      │
│                                                                 │
│  Process:                                                       │
│  1. Combine into text:                                          │
│     "name Allow HTTP action accept source_interface port1 ..."│
│                                                                 │
│  2. Tokenize (lowercase, word boundary):                        │
│     ["name", "allow", "http", "action", "accept", ...]        │
│                                                                 │
│  3. Look up in vocabulary (model.tfidf.vocab):                │
│     {                                                           │
│       "allow": 0,                                               │
│       "accept": 15,                                             │
│       "http": 234,                                              │
│       ...                                                       │
│     }                                                           │
│                                                                 │
│  4. Calculate TF (Term Frequency):                              │
│     - Count occurrences of each token                          │
│     - For our text: "allow" appears 1x, "accept" 1x, etc.     │
│                                                                 │
│  5. Apply IDF (Inverse Document Frequency):                    │
│     - Tokens like "the", "policy" get low weights              │
│     - Rare tokens get high weights                             │
│     - tf_final = tf * idf                                      │
│                                                                 │
│  6. L2 Normalize:                                               │
│     - Ensure vector magnitude = 1                               │
│     - Makes comparison scale-invariant                         │
│                                                                 │
│  Output: textVec [2000 dimensions]                             │
│  Example (truncated): [0.12, 0.0, 0.45, ..., 0.02, 0.0, ...]  │
│                                                                 │
│  ─────────────────────────────────────────────────────────     │
│                                                                 │
│  Pass B: STRUCT FEATURES (Field Presence Binary)              │
│  ─────────────────────────────────────────────                │
│                                                                 │
│  Input: data.after values                                      │
│  ┌──────────────────────────────────┐                         │
│  │ name: "Allow HTTP"       ← has value                        │
│  │ action: "accept"         ← has value                        │
│  │ comments: null           ← NO value                         │
│  │ schedule: undefined      ← NO value                         │
│  │ enabled: true            ← has value                        │
│  │ port_lower: []           ← EMPTY array → NO value           │
│  └──────────────────────────────────┘                         │
│                                                                 │
│  Process:                                                       │
│  For each canonical field (sorted order):                      │
│  ├─ 1 if field has value (not null/false/empty)               │
│  └─ 0 if field is null/false/empty                            │
│                                                                 │
│  Output: structVec [847 dimensions]                            │
│  Example: [1, 1, 0, 1, 0, 1, 1, 0, ..., 1]                    │
│           │ │ │ │ │ │ │ │    │                                │
│           └─ For each of 847 canonical fields                  │
│                                                                 │
│  ─────────────────────────────────────────────────────────     │
│                                                                 │
│  Pass C: DIFF FEATURES (Changes Hashed)                        │
│  ────────────────────────────────────                          │
│                                                                 │
│  Input: changes = [                                             │
│    { field: "name", ... },                                     │
│    { field: "action", ... }                                    │
│  ]                                                              │
│                                                                 │
│  Process:                                                       │
│  1. Extract field names: ["name", "action"]                    │
│                                                                 │
│  2. Hash each field name to [0, 199]:                          │
│     ├─ hash("name") = 12345 → idx = 12345 % 200 = 45          │
│     ├─ hash("action") = 98765 → idx = 98765 % 200 = 165       │
│     └─ Similar to JS String.prototype implementation          │
│                                                                 │
│  3. Create 200-dim binary vector:                              │
│     diffVec[45] = 1        ← "name" changed                    │
│     diffVec[165] = 1       ← "action" changed                  │
│     All others = 0                                              │
│                                                                 │
│  Output: diffVec [200 dimensions]                              │
│  Example: [0, 0, ..., 1, ..., 0, ..., 1, ..., 0]              │
│                         45       165                            │
│                                                                 │
│  ─────────────────────────────────────────────────────────     │
│                                                                 │
│  STEP 4: FORWARD PASS (Neural Network Inference)              │
│  ───────────────────────────────────────────────              │
│                                                                 │
│  Architecture:                                                  │
│                                                                 │
│  TEXT EXPERT (Text MLP)                                        │
│  ├─ Input: textVec [2000]                                     │
│  ├─ Layer 1: [2000] → [128] with ReLU                         │
│  ├─ Layer 2: [128] → [128]                                    │
│  └─ Output: txtOut [128]                                      │
│                                                                 │
│  STRUCT EXPERT (Struct MLP)                                    │
│  ├─ Input: structVec [847]                                    │
│  ├─ Layer 1: [847] → [128] with ReLU                          │
│  ├─ Layer 2: [128] → [128]                                    │
│  └─ Output: structOut [128]                                   │
│                                                                 │
│  DIFF EXPERT (Diff MLP)                                        │
│  ├─ Input: diffVec [200]                                      │
│  ├─ Layer 1: [200] → [128] with ReLU                          │
│  ├─ Layer 2: [128] → [128]                                    │
│  └─ Output: diffOut [128]                                     │
│                                                                 │
│  FUSION LAYER                                                   │
│  ├─ Concatenate: [128] + [128] + [128] = [384]               │
│  ├─ Final linear: [384] → [num_classes]                       │
│  └─ Output: logits = raw predictions for each class           │
│                                                                 │
│  SOFTMAX → Probabilities                                        │
│  └─ Convert logits to probabilities [0, 1]                    │
│     (sum to 1)                                                 │
│                                                                 │
│  Example Output Probabilities:                                 │
│  ────────────────────────────                                  │
│  {                                                              │
│    "POLICY_CREATED": 0.85,      ← PREDICTED (highest)         │
│    "POLICY_MODIFIED": 0.10,                                    │
│    "POLICY_DELETED": 0.03,                                     │
│    "INTERFACE_CREATED": 0.02                                   │
│  }                                                              │
│                                                                 │
│  ─────────────────────────────────────────────────────────     │
│                                                                 │
│  STEP 5: RETURN PREDICTION                                     │
│  ──────────────────────                                         │
│  {                                                              │
│    label: "POLICY_CREATED",    ← Most likely operation        │
│    confidence: 0.85,            ← How confident (0.85 = 85%)   │
│    probabilities: [0.85, ...],  ← All class probabilities      │
│    debug: {                                                     │
│      dims: {                                                    │
│        text: 2000,                                             │
│        struct: 847,                                            │
│        diff: 200                                               │
│      }                                                          │
│    }                                                            │
│  }                                                              │
│                                                                 │
│  This is logged to console & UI immediately!                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### PHASE 3: MODEL TRAINING (Python Backend)

```
┌─────────────────────────────────────────────────────────────────┐
│              PHASE 3: MODEL TRAINING (Python)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  STEP 1: DATA EXPORT                                            │
│  ────────────────────                                            │
│  User exports collected data: Ctrl+Shift+D                     │
│  ├─ data.json: ~1000 samples (raw canonical format)            │
│  └─ model_data.json: previous trained model (if exists)        │
│                                                                 │
│  data.json structure:                                           │
│  ─────────────────────                                          │
│  {                                                              │
│    "samples": [                                                 │
│      {                                                          │
│        "metadata": {                                            │
│          "vendor": "fortigate",                                 │
│          "object_type": "policy",                              │
│          "operation": "CREATE",                                │
│          "timestamp": 1766051559664                            │
│        },                                                       │
│        "data": {                                                │
│          "before": {...},                                      │
│          "after": {...}                                        │
│        },                                                       │
│        "changes": [...]                                        │
│      },                                                         │
│      ... (1000 total)                                           │
│    ]                                                            │
│  }                                                              │
│                                                                 │
│  ─────────────────────────────────────────────────────────     │
│                                                                 │
│  STEP 2: PREPROCESSING (preprocessing.py)                      │
│  ──────────────────────────────────────────                    │
│                                                                 │
│  Input: data.json (1000 samples)                               │
│                                                                 │
│  Process:                                                       │
│  ├─ Load sklearn TfidfVectorizer (not fitted yet)              │
│  └─ For each sample, extract 4 features:                       │
│                                                                 │
│  Feature 1: TEXT (TFIDF)                                       │
│  ─────────────────────                                         │
│  1. Combine field names + values from data.after               │
│     "name Allow HTTP action accept source_interface port1 ..." │
│                                                                 │
│  2. Fit TfidfVectorizer on all texts                           │
│     ├─ Learn vocabulary (2000 most common tokens)              │
│     ├─ Calculate IDF weights                                   │
│     └─ Create vocab map & idf array                            │
│                                                                 │
│  3. Transform each text to 2000-dim TF-IDF vector              │
│     Output: tfidf_vectors [1000 × 2000]                        │
│                                                                 │
│  Feature 2: STRUCT (Binary Field Presence)                     │
│  ────────────────────────────────────────                      │
│  1. Collect all canonical fields from all samples              │
│     all_keys = {"name", "action", "srcintf", ...}              │
│     sorted_keys = sorted list (for consistency)                │
│                                                                 │
│  2. For each sample, create binary vector                      │
│     ├─ For each field in sorted_keys:                          │
│     │  ├─ 1 if field exists and has value                     │
│     │  └─ 0 if field is null/false/empty                      │
│     └─ Result: [1, 0, 1, 1, 0, ...] (847 dims)               │
│                                                                 │
│  3. Stack all vectors                                          │
│     Output: structs [1000 × 847]                               │
│                                                                 │
│  Feature 3: DIFF (Hashed Field Changes)                        │
│  ──────────────────────────────────────                        │
│  1. For each sample, get list of changed fields                │
│     changes = ["name", "action"]                               │
│                                                                 │
│  2. Hash each field name (mirror JS hash in Python)            │
│     ├─ Implement same hash function as ml-inference.js         │
│     ├─ Hash("name") % 200 = 45                                 │
│     └─ Hash("action") % 200 = 165                              │
│                                                                 │
│  3. Create 200-dim binary vector                               │
│     diffVec[45] = 1, diffVec[165] = 1, rest = 0               │
│                                                                 │
│  4. Stack all vectors                                          │
│     Output: diffs [1000 × 200]                                 │
│                                                                 │
│  Feature 4: LABELS (Ground Truth)                              │
│  ────────────────────────────────                              │
│  Extract label from metadata.operation                         │
│  Example: "POLICY_CREATED"                                     │
│                                                                 │
│  Create label mapping:                                         │
│  {                                                              │
│    "POLICY_CREATED": 0,                                        │
│    "POLICY_MODIFIED": 1,                                       │
│    "POLICY_DELETED": 2,                                        │
│    "INTERFACE_CREATED": 3,                                     │
│    ...                                                         │
│  }                                                              │
│                                                                 │
│  Output: labels [1000] with class indices                      │
│                                                                 │
│  ─────────────────────────────────────────────────────────     │
│                                                                 │
│  Output: train.pkl (pickled dict)                              │
│  ──────────────────────────────────                            │
│  {                                                              │
│    "texts": ["text1", "text2", ...],              [1000]       │
│    "tfidf_vectors": [[0.12, ...], [...]],        [1000×2000]   │
│    "structs": [[1, 0, 1, ...], [...]],           [1000×847]    │
│    "diffs": [[0, ..., 1, ...], [...]],           [1000×200]    │
│    "labels": ["POLICY_CREATED", ...],             [1000]       │
│    "label_to_idx": {...},                         (mapping)    │
│    "vectorizer": TfidfVectorizer(...),            (sklearn obj)│
│    "struct_dim": 847,                             (feature dim)│
│    "diff_dim": 200                                (feature dim)│
│  }                                                              │
│                                                                 │
│  ─────────────────────────────────────────────────────────     │
│                                                                 │
│  STEP 3: MODEL TRAINING (train.py)                             │
│  ──────────────────────────────────                            │
│                                                                 │
│  Input: train.pkl                                              │
│                                                                 │
│  1. Load preprocessed data                                     │
│     ├─ Extract tensors: texts, tfidf_vectors, structs, etc.   │
│     └─ Create PyTorch DataLoader (batch_size=4)               │
│                                                                 │
│  2. Initialize 3-Expert Model                                  │
│                                                                 │
│     class MultiheadModel:                                      │
│     ├─ TEXT EXPERT (MLP):                                      │
│     │  └─ 2000 → 128 (ReLU) → 128                            │
│     ├─ STRUCT EXPERT (MLP):                                    │
│     │  └─ 847 → 128 (ReLU) → 128                             │
│     ├─ DIFF EXPERT (MLP):                                      │
│     │  └─ 200 → 128 (ReLU) → 128                             │
│     └─ CLASSIFIER:                                             │
│        └─ 384 (concat) → num_classes                          │
│                                                                 │
│     Total Parameters: ~200K                                    │
│                                                                 │
│  3. Training Loop (25 epochs)                                  │
│                                                                 │
│     For epoch 1 to 25:                                         │
│       For batch in DataLoader:
│         1. Forward pass: y_pred = model(text, struct, diff)   │
│         2. Calculate loss: loss = CrossEntropyLoss(y_true)    │
│         3. Backward pass: loss.backward()                      │
│         4. Update weights: optimizer.step() (Adam, lr=1e-3)   │
│         5. Log loss                                             │
│                                                                 │
│     Example Training Progress:                                 │
│     ─────────────────────────                                  │
│     Epoch  1/25 | Loss: 2.1234 | █████░░░░░░░░░░░░░░ (50%)     │
│     Epoch  2/25 | Loss: 1.8900 | ███████░░░░░░░░░░░░ (63%)     │
│     Epoch  3/25 | Loss: 1.6234 | ██████████░░░░░░░░░ (72%)     │
│     ...                                                         │
│     Epoch 25/25 | Loss: 0.3245 | ██████████████████░ (95%)     │
│                                                                 │
│  4. Save Model Artifacts                                       │
│     ├─ model.state_dict() (all weights & biases)               │
│     ├─ vectorizer (sklearn TfidfVectorizer)                    │
│     ├─ label_to_idx mapping                                    │
│     ├─ struct_dim (847)                                        │
│     └─ diff_dim (200)                                          │
│                                                                 │
│     Output: model_artifacts.pkl                                │
│                                                                 │
│  ─────────────────────────────────────────────────────────     │
│                                                                 │
│  STEP 4: EXPORT TO JAVASCRIPT (export_model.py)               │
│  ──────────────────────────────────────────────              │
│                                                                 │
│  Input: model_artifacts.pkl                                    │
│                                                                 │
│  Process:                                                       │
│  1. Extract TF-IDF data                                        │
│     ├─ vocab: list of tokens in order (2000 tokens)            │
│     └─ idf: IDF weights (2000 values)                          │
│                                                                 │
│  2. Extract Model Weights                                      │
│     For each expert MLP (text, struct, diff):                  │
│     ├─ Layer 1 weight: [128 × input_dim]                       │
│     ├─ Layer 1 bias: [128]                                     │
│     ├─ Layer 2 weight: [128 × 128]                             │
│     └─ Layer 2 bias: [128]                                     │
│                                                                 │
│     For classifier:                                             │
│     ├─ weight: [num_classes × 384]                             │
│     └─ bias: [num_classes]                                     │
│                                                                 │
│  3. Convert to JSON (JavaScript-compatible)                    │
│     model_data.json = {                                        │
│       "tfidf": {                                               │
│         "vocab": ["allow", "accept", ...],                     │
│         "idf": [0.3, 0.5, ...]                                 │
│       },                                                        │
│       "model": {                                               │
│         "txt_mlp": {                                           │
│           "l1_weight": [[...], [...]],                        │
│           "l1_bias": [...],                                    │
│           "l2_weight": [[...], [...]],                        │
│           "l2_bias": [...]                                     │
│         },                                                      │
│         "struct_mlp": {...},                                   │
│         "diff_mlp": {...},                                     │
│         "fc": {                                                │
│           "weight": [[...], [...]],                           │
│           "bias": [...]                                        │
│         }                                                       │
│       },                                                        │
│       "metadata": {                                            │
│         "labels": {0: "POLICY_CREATED", ...},                  │
│         "struct_dim": 847,                                     │
│         "diff_dim": 200,                                       │
│         "feature_keys": ["name", "action", ...]               │
│       }                                                        │
│     }                                                           │
│                                                                 │
│  Output: model_data.json (typically ~10 MB)                    │
│  ────────────────────────────────────────                      │
│  Ready to load into ML Inference engine!                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🤖 HOW ML PRE-DETECTION OCCURS

### **The Core Prediction Process**

```
REAL-TIME PREDICTION FLOW:
════════════════════════════════════════════════════════════════

User fills form      →  Extract 3 feature types  →  Feed to MLP  →  Get prediction
───────────────────      ─────────────────────────      ──────────      ──────────────

┌────────────────────┐  ┌──────────────────────┐     ┌─────────┐     ┌────────────┐
│ User enters:       │  │ TEXT:                │     │ 3-Expert│     │ Prediction:│
│ name="Allow HTTP"  │  │ ├─ TFIDF encode       │─┐   │ MLP     │────│            │
│ action="accept"    │  │ └─ 2000-dim vector   │ │   │ Model   │    │ label:     │
│                    │  │                       │ │   │         │    │ "CREATE"   │
│ srcintf="port1"    │  │ STRUCT:              │ │   │ 3 paths:│    │            │
│ changes:[name,     │  │ ├─ Binary presence    │─┼─→│ ├─ TXT  │    │ confidence:│
│   action]          │  │ └─ 847-dim vector    │ │   │ ├─ STR  │    │ 0.92       │
└────────────────────┘  │                       │ │   │ └─ DIFF │    │            │
                        │ DIFF:                │ │   └─────────┘    │ timing:    │
                        │ ├─ Hash changes       │ │                  │ 23ms       │
                        │ └─ 200-dim vector    │─┘                  └────────────┘
                        └──────────────────────┘
```

### **Why This Architecture?**

| Feature | Why Used | Benefit |
|---------|----------|---------|
| **TEXT (TF-IDF)** | Captures semantic meaning of field values | Understands what data is being configured |
| **STRUCT (Binary)** | Shows which fields are populated | Identifies data structure completeness |
| **DIFF (Hash)** | Records which fields changed | Distinguishes CREATE (many changes) from MODIFY (few changes) |
| **3-Expert MLPs** | Separate processing paths | Each expert specializes in one feature type |
| **Fusion Layer** | Concatenates expert outputs | Combines insights from all 3 perspectives |

### **Example Prediction Scenarios**

```
SCENARIO 1: NEW POLICY CREATION
─────────────────────────────────
State:
  After: {name: "Allow HTTP", action: "accept", ...}
  Changes: [name, action, srcintf, dstintf]  ← many changes

Model Decision:
  Text MLP sees: "allow", "http", "accept" (policy-like words)
  Struct MLP sees: [1, 1, 1, 1, ...] (many fields populated)
  Diff MLP sees: bits 45, 165, 89, 200 (4 fields changed)
  
Prediction: "POLICY_CREATED" (conf: 0.92)

─────────────────────────────────────────────────────────────

SCENARIO 2: POLICY MODIFICATION
─────────────────────────────────
State:
  Before: {name: "Allow HTTP", action: "accept", ...}
  After:  {name: "Allow HTTP", action: "drop", ...}  ← different
  Changes: [action]  ← ONE field changed

Model Decision:
  Text MLP sees: same semantic content (policy structure)
  Struct MLP sees: same fields populated (structure unchanged)
  Diff MLP sees: only 1 bit set (one field changed)
  
Prediction: "POLICY_MODIFIED" (conf: 0.88)

─────────────────────────────────────────────────────────────

SCENARIO 3: POLICY DELETION
─────────────────────────────
State:
  After: {name: "Allow HTTP"}  ← minimal data
  Changes: [all fields cleared]  ← many changes to empty

Model Decision:
  Text MLP sees: minimal semantic content
  Struct MLP sees: [0, 0, 0, ...] (few fields populated)
  Diff MLP sees: many bits set (many fields changed)
  
Prediction: "POLICY_DELETED" (conf: 0.85)
```

---

## 📦 MODULE DESCRIPTIONS

### **1. universal_field_extractor.js**
**Purpose**: Extract raw form values without HTML structure

**Key Functions**:
- `startMonitoring()`: Detects form elements on page load
- `extractFormValues(form)`: Gets all input values
- `getFieldKey(element)`: Maps form field to canonical name
- `detectVendor(url)`: Identifies which vendor (FortiGate, Palo Alto, etc.)

**Output**: Raw data with field names and values

---

### **2. ml-unified-collector.js**
**Purpose**: Normalize vendor-specific data to canonical format

**Key Functions**:
- `processUniversalEvent(data)`: Receive extracted data
- `createCanonicalSample(rawData)`: Map to standard schema
- `mapFields(data, vendor, objectType)`: Apply vendor_field_map.json
- `detectVendor(url)`: Parse URL to get vendor name
- `detectObjectType(url)`: Parse URL to get object type (policy, interface, etc.)

**Output**: Canonical samples ready for training or inference

---

### **3. ml-inference.js**
**Purpose**: Run ML predictions in JavaScript

**Key Methods**:
- `constructor(modelData)`: Load trained model
- `tfidfTransform(text)`: Convert text to TF-IDF vector
- `flatten(obj)`: Extract struct features
- `getDiffVector(mods)`: Hash changed field names
- `mlpForward(x, weights)`: Pass data through MLP layer
- `predict(sample)`: Main inference function

**Output**: Prediction with confidence score

---

### **4. preprocessing.py**
**Purpose**: Convert raw JSON samples to PyTorch tensors

**Process**:
1. Read data.json (1000 canonical samples)
2. Extract 4 feature types for each sample
3. Fit TfidfVectorizer on text
4. Create binary struct vectors
5. Hash field changes into binary vectors
6. Map labels to indices
7. Save as train.pkl (PyTorch-compatible)

**Output**: train.pkl (1000 × [2000 + 847 + 200] features)

---

### **5. train.py**
**Purpose**: Train the neural network model

**Architecture**:
- 3-Expert MLPs (Text, Struct, Diff)
- Each expert: 2-layer MLP with ReLU
- Fusion: Concatenate + Linear classifier
- Loss: CrossEntropyLoss
- Optimizer: Adam (lr=1e-3)
- Epochs: 25

**Output**: model_artifacts.pkl (trained weights + metadata)

---

### **6. export_model.py**
**Purpose**: Convert PyTorch model to JavaScript-compatible JSON

**Process**:
1. Load model_artifacts.pkl
2. Extract vocabulary & IDF weights
3. Extract all layer weights & biases
4. Convert to JSON arrays
5. Map class indices to labels

**Output**: model_data.json (~10 MB, ready for ml-inference.js)

---

### **7. vendor_field_map.json**
**Purpose**: Schema mapping for vendor-specific→canonical fields

**Structure**:
```json
{
  "fortigate": {
    "policy": {
      "mappings": {
        "ng:$ctrl.policy.name": "name",
        "ng:$ctrl.policy.srcintf": "source_interface",
        ...
      },
      "canonical_fields": ["name", "source_interface", ...],
      "identity_field": "name"
    }
  }
}
```

---

## 🧠 MODEL ARCHITECTURE

### **3-Expert Voting Architecture**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    3-EXPERT VOTING MODEL                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│                                                                     │
│    INPUT: Sample                                                    │
│    ┌──────────────────────────────────┐                            │
│    │ data.after: {...}                │                            │
│    │ changes: ["name", "action"]      │                            │
│    └──────────────────────────────────┘                            │
│                          │                                          │
│          ┌───────────────┼───────────────┐                         │
│          │               │               │                         │
│          ▼               ▼               ▼                         │
│    ┌──────────┐  ┌──────────┐  ┌──────────┐                       │
│    │TEXT FEAT │  │STRUCT    │  │DIFF FEAT │                       │
│    │(TFIDF)   │  │FEAT(BIN) │  │(HASH)    │                       │
│    │2000-dim  │  │847-dim   │  │200-dim   │                       │
│    └────┬─────┘  └────┬─────┘  └────┬─────┘                       │
│         │             │             │                             │
│         │             │             │ EXPERT 1:                  │
│         │             │             └─→ Input: 200               │
│         │             │                │ L1: 200→128 (ReLU)      │
│         │             │                │ L2: 128→128             │
│         │             │                └→ Output: 128-dim        │
│         │             │                                           │
│         │             │ EXPERT 2:                                 │
│         │             └─→ Input: 847                             │
│         │                │ L1: 847→128 (ReLU)                    │
│         │                │ L2: 128→128                           │
│         │                └→ Output: 128-dim                      │
│         │                                                         │
│         │ EXPERT 3:                                               │
│         └─→ Input: 2000                                          │
│            │ L1: 2000→128 (ReLU)                                 │
│            │ L2: 128→128                                         │
│            └→ Output: 128-dim                                    │
│                                                                   │
│                    ┌─────────────────────┐                       │
│                    │  CONCATENATE 3×128  │                       │
│                    │  ─────────────────── │                       │
│                    │  384-dim vector     │                       │
│                    └──────────┬──────────┘                        │
│                               │                                   │
│                               ▼                                   │
│                    ┌──────────────────────┐                       │
│                    │  CLASSIFIER LAYER    │                       │
│                    │  ─────────────────── │                       │
│                    │  384 → num_classes   │                       │
│                    │  (Fully Connected)   │                       │
│                    └──────────┬───────────┘                       │
│                               │                                   │
│                               ▼                                   │
│                    ┌──────────────────────┐                       │
│                    │  SOFTMAX             │                       │
│                    │  ─────────────────── │                       │
│                    │  Logits → Probs [0,1]                       │
│                    └──────────┬───────────┘                       │
│                               │                                   │
│                               ▼                                   │
│                    ┌──────────────────────┐                       │
│                    │  PREDICTION          │                       │
│                    │  ─────────────────── │                       │
│                    │  label: "CREATED"    │                       │
│                    │  confidence: 0.92    │                       │
│                    └──────────────────────┘                       │
│                                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### **Why 3 Experts?**

1. **TEXT Expert**: Understands what data is being configured
   - Learns vocabulary patterns (e.g., "allow", "http" → policy)
   - Captures semantic relationships

2. **STRUCT Expert**: Understands data structure completeness
   - Binary presence shows "is this field populated?"
   - Distinguishes complete configs from partial ones

3. **DIFF Expert**: Understands change patterns
   - Records which fields changed
   - CREATE: many changes; MODIFY: few changes

---

## 🔗 CODE ARCHITECTURE DIAGRAM

```
CHROME EXTENSION ARCHITECTURE
════════════════════════════════════════════════════════════════

┌────────────────────────────────────────────────────────────────┐
│                      MANIFEST.json                             │
│  ├─ content_scripts: content.js (runs on all pages)           │
│  ├─ background: background.js (service worker)                │
│  └─ web_accessible_resources:                                 │
│     ├─ universal_field_extractor.js                           │
│     ├─ ml-unified-collector.js                                │
│     ├─ ml-inference.js                                        │
│     ├─ vendor_field_map.json                                  │
│     └─ model_data.json                                        │
└────────────────────────────────────────────────────────────────┘

                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼

┌──────────────────┐  ┌──────────────┐  ┌──────────────┐
│  content.js      │  │ background.js│  │  popup.html  │
│                  │  │              │  │              │
│  Injects scripts │  │ Storage mgmt │  │  UI/Download │
│  into page       │  │ Analytics    │  │  Controls    │
└──────────────────┘  └──────────────┘  └──────────────┘

                          │
           ┌──────────────┼──────────────┐
           │              │              │
           ▼              ▼              ▼

    ┌────────────────┐  ┌──────────────┐  ┌──────────────┐
    │ INJECTED       │  │ ML            │  │ ML           │
    │ SCRIPTS        │  │ INFERENCE     │  │ COLLECTOR    │
    │                │  │                │  │              │
    │ ┌────────────┐ │  │ ┌───────────┐ │  │ ┌──────────┐ │
    │ │ Universal  │ │  │ │ MLInference│ │  │ │ Unified  │ │
    │ │ Field      │ │  │ │ Class      │ │  │ │ Collector│ │
    │ │ Extractor  │ │  │ │            │ │  │ │          │ │
    │ │            │ │  │ │ predict()  │ │  │ │ Process  │ │
    │ │ Extracts:  │ │  │ │ methods()  │ │  │ │ Event()  │ │
    │ │ - Before   │ │  │ │            │ │  │ │          │ │
    │ │ - After    │ │  │ │ Uses:      │ │  │ │ Maps to: │ │
    │ │ - Changes  │ │  │ │ - TFIDF    │ │  │ │ - Vendor │ │
    │ │            │ │  │ │ - Struct   │ │  │ │ - Object │ │
    │ │ Broadcasts:│ │  │ │ - Diff     │ │  │ │   Type   │ │
    │ │ UNIVERSAL_ │ │  │ │            │ │  │ │ - Fields │ │
    │ │ EVENT_     │ │  │ │ Loads:     │ │  │ │          │ │
    │ │ SAVED      │ │  │ │ model_data │ │  │ │ Stores:  │ │
    │ │            │ │  │ │ .json      │ │  │ │ - Memory │ │
    │ │            │ │  │ │            │ │  │ │ - IndexDB│ │
    │ └────────────┘ │  │ └───────────┘ │  │ └──────────┘ │
    └────────────────┘  └──────────────┘  └──────────────┘

           │                   │                  │
           │ window.post       │ Prediction      │ Training
           │ Message()         │ Result          │ Data
           │                   │                 │
           └───────────────────┼─────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  USER/POPUP          │
                    │                      │
                    │ Shows prediction     │
                    │ Displays confidence  │
                    │ Export button        │
                    └──────────────────────┘

PYTHON DATA PIPELINE
════════════════════════════════════════════════════════════════

┌────────────────────────────────┐
│  Browser Export: data.json      │  ← 1000 canonical samples
│  (1000 samples × 5 fields)      │
└──────────────┬─────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │  preprocessing.py     │  ← Feature engineering
    │                      │
    │  Extract:            │
    │  ├─ Text (TFIDF)     │
    │  ├─ Struct (Binary)   │
    │  ├─ Diff (Hashed)     │
    │  └─ Labels (Strings)  │
    │                      │
    │  Output: train.pkl   │
    │  1000 × 3047 tensor  │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │  train.py            │  ← Model training
    │                      │
    │  Load: train.pkl     │
    │  Model:              │
    │  ├─ 3 Expert MLPs    │
    │  ├─ Fusion Layer     │
    │  ├─ Classifier       │
    │                      │
    │  Training:           │
    │  ├─ 25 epochs        │
    │  ├─ Batch size: 4    │
    │  ├─ Adam optimizer    │
    │  └─ CrossEntropy loss │
    │                      │
    │  Output:             │
    │  model_artifacts.pkl │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │  export_model.py     │  ← JS export
    │                      │
    │  Load: model_artifacts.pkl
    │  Extract:            │
    │  ├─ Weights/Biases   │
    │  ├─ Vocab & IDF      │
    │  └─ Labels           │
    │                      │
    │  Convert to JSON     │
    │                      │
    │  Output:             │
    │  model_data.json     │
    │  (~10 MB)            │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │  Back to Extension   │  ← ml-inference.js loads
    │  model_data.json     │
    └──────────────────────┘
```

---

## 🎯 KEY INSIGHTS

### **Why This Design Works**

1. **Vendor-Agnostic**: Uses vendor_field_map.json to support multiple vendors
2. **Multi-Modal Features**: 3 independent feature extractors improve robustness
3. **Real-Time Inference**: JavaScript execution in browser = instant predictions
4. **Flexible Training**: Python backend enables model updates without code changes
5. **Transparent**: Can inspect predicted confidence and feature values

### **Data Flow Summary**

```
Extension          Extract Data           Normalize          Predict
Runtime      →     (Raw Values)     →     (Canonical)   →    (ML Model)
             
  user fills         Values only            Field mapping       3-Expert
  form         extracted from DOM          using vendor_map     MLP predicts
                                           creates training     operation
                                           samples              type
```

### **Model's Decision Process**

```
When predicting an operation, the model considers:

1. What data was entered? (TEXT MLP)
   → "allow", "http" words indicate a policy

2. Which fields were populated? (STRUCT MLP)
   → Full structure indicates complete config

3. Which fields changed? (DIFF MLP)
   → Many changes = CREATE, Few changes = MODIFY

FUSION: Combine all 3 perspectives
RESULT: High-confidence prediction of operation
```

This architecture enables intelligent pre-detection of configuration operations before user submission!
