# 🤖 TRAINING & INFERENCE: DETAILED WALKTHROUGH

Complete explanation of how the model learns and makes predictions.

---

## 📚 PART 1: WHAT IS TRAINING?

### **Simple Definition**
Training is when the AI learns from 1000+ **labeled examples** and adjusts its internal weights to recognize patterns.

```
ANALOGY: Learning to Drive
═══════════════════════════════

Training Phase:
  1. You see 1000 driving situations (examples)
  2. Instructor tells you correct action (label)
  3. You practice, make mistakes, learn
  4. After 25 practice sessions, you know patterns
  
Our ML Model:
  1. Sees 1000 config changes (examples)
  2. Knows if it's CREATE or MODIFY (label)
  3. Adjusts weights through backpropagation
  4. After 25 epochs, recognizes patterns
```

---

## 🔧 PART 2: THE TRAINING PIPELINE

### **Step 1: Prepare Training Data**

**Input**: `train.pkl` (preprocessed data)

```python
# What's inside train.pkl
{
  "texts": [        # Text field content
    "policy Allow HTTP port1 port2",
    "policy Allow DNS port3 port4",
    ...  (1000 documents)
  ],
  
  "tfidf_vectors": [  # Already vectorized (2000 dims each)
    [0.12, 0.0, 0.45, ..., 0.02],
    [0.08, 0.03, 0.22, ..., 0.15],
    ...  (1000 vectors)
  ],
  
  "structs": [      # Binary field presence (847 dims each)
    [1, 0, 1, 1, 0, 1, ...],
    [1, 1, 1, 0, 1, 0, ...],
    ...  (1000 vectors)
  ],
  
  "diffs": [        # Which fields changed (200 dims each)
    [0, 1, 0, 1, 0, ...],
    [1, 0, 1, 0, 0, ...],
    ...  (1000 vectors)
  ],
  
  "labels": [       # Ground truth (what actually happened)
    "POLICY_CREATED",
    "POLICY_MODIFIED",
    "INTERFACE_CREATED",
    ...  (1000 labels)
  ]
}
```

### **Step 2: Create Batches**

```python
from torch.utils.data import DataLoader

# DataLoader batches the data
# batch_size = 4 means: process 4 samples at a time

DataLoader(dataset, batch_size=4, shuffle=True)

EPOCH 1, BATCH 1:
  ├─ Sample 0: text[0], struct[0], diff[0], label[0]
  ├─ Sample 1: text[1], struct[1], diff[1], label[1]
  ├─ Sample 2: text[2], struct[2], diff[2], label[2]
  └─ Sample 3: text[3], struct[3], diff[3], label[3]
              ↓
       Process together
              ↓
       Calculate loss
              ↓
       Update weights

EPOCH 1, BATCH 2:
  ├─ Sample 4: ...
  ├─ Sample 5: ...
  ├─ Sample 6: ...
  └─ Sample 7: ...
```

---

## 🧠 PART 3: THE NEURAL NETWORK ARCHITECTURE

### **Model Structure**

```
TRIPLE MLP FUSION ARCHITECTURE
═════════════════════════════════════════════════════

INPUT FEATURES (from 1 training sample):
  ├─ text_vector: [2000] TF-IDF
  ├─ struct_vector: [847] binary
  └─ diff_vector: [200] binary


PROCESSING (3 Parallel Paths):
═════════════════════════════════════════════════════

PATH 1: TEXT MLP
────────────────
text[2000]
   ↓
Linear(2000 → 128)  [Learn text patterns]
   ↓ (2000*128 = 256K weights)
Hidden[128]
   ↓
ReLU (Activate non-linear patterns)
   ↓
Linear(128 → 128)   [Refine patterns]
   ↓ (128*128 = 16K weights)
text_output[128]


PATH 2: STRUCT MLP
──────────────────
struct[847]
   ↓
Linear(847 → 128)   [Learn form complexity]
   ↓ (847*128 = 108K weights)
Hidden[128]
   ↓
ReLU
   ↓
Linear(128 → 128)   [Refine]
   ↓
struct_output[128]


PATH 3: DIFF MLP
────────────────
diff[200]
   ↓
Linear(200 → 128)   [Learn change patterns]
   ↓ (200*128 = 25K weights)
Hidden[128]
   ↓
ReLU
   ↓
Linear(128 → 128)   [Refine]
   ↓
diff_output[128]


FUSION:
═════════════════════════════════════════════════════
Concatenate: [128] + [128] + [128] = [384]
   ↓
Final Classifier
Linear(384 → num_classes)
   ↓ (384 * num_classes weights)
logits[5]   (example: 5 change types)
   ↓
Softmax (Convert to probabilities)
   ↓
probs[5]    [0.85, 0.10, 0.03, 0.01, 0.01]
             POLICY_CREATED is 85% likely
```

### **Total Parameters**

```
Weights:
  Text MLP:      256K + 16K = 272K
  Struct MLP:    108K + 16K = 124K
  Diff MLP:      25K + 16K = 41K
  Final FC:      384 * num_classes ≈ 2K
  ─────────────────────────────────
  TOTAL:         ~440K parameters

For comparison:
  Large language models: 7B - 70B parameters
  Your model: Ultra-lightweight for browser
```

---

## 📊 PART 4: TRAINING LOOP (Epoch by Epoch)

### **What Happens in One Epoch**

```
EPOCH 1 (Processing all 1000 samples)
════════════════════════════════════════════════════

Initialize: Random weights for all MLPs

FOR EACH BATCH (250 batches total, 4 samples per batch):
  │
  ├─ BATCH 1 (Samples 0-3):
  │   │
  │   ├─ FORWARD PASS (Model makes predictions)
  │   │   ├─ text_mlp processes text[2000]
  │   │   ├─ struct_mlp processes struct[847]
  │   │   ├─ diff_mlp processes diff[200]
  │   │   ├─ Concatenate outputs [384]
  │   │   ├─ Final FC layer [num_classes]
  │   │   └─ Softmax → probabilities
  │   │
  │   │   Result: 4 predictions (one per sample)
  │   │   Example:
  │   │   ├─ Sample 0: [0.85, 0.10, 0.03, 0.01, 0.01]
  │   │   ├─ Sample 1: [0.02, 0.92, 0.03, 0.02, 0.01]
  │   │   ├─ Sample 2: [0.15, 0.10, 0.70, 0.03, 0.02]
  │   │   └─ Sample 3: [0.05, 0.05, 0.05, 0.80, 0.05]
  │   │
  │   ├─ CALCULATE LOSS (How wrong are we?)
  │   │   True labels: ["CREATED", "MODIFIED", "OTHER", "OTHER"]
  │   │   
  │   │   Cross-Entropy Loss:
  │   │   Sample 0: predicted 0.85 for CREATED ✓ (correct, low loss)
  │   │   Sample 1: predicted 0.92 for MODIFIED ✓ (correct, low loss)
  │   │   Sample 2: predicted 0.70 for OTHER ✓ (correct, low loss)
  │   │   Sample 3: predicted 0.80 for OTHER ✓ (correct, low loss)
  │   │   
  │   │   Batch Loss = average of all 4 losses = 0.15
  │   │
  │   ├─ BACKWARD PASS (Calculate gradients)
  │   │   For each weight w:
  │   │   gradient = ∂Loss / ∂w
  │   │   
  │   │   Shows: "This weight needs to increase/decrease
  │   │            to reduce loss next time"
  │   │
  │   └─ UPDATE WEIGHTS (Optimizer step)
  │       Adam optimizer updates all weights:
  │       w_new = w_old - learning_rate * gradient
  │       
  │       learning_rate = 0.001 (small steps to avoid overfitting)
  │
  ├─ BATCH 2 (Samples 4-7): Repeat...
  ├─ BATCH 3 (Samples 8-11): Repeat...
  ├─ ...
  └─ BATCH 250 (Samples 996-999): Repeat...

After EPOCH 1:
  Total Loss = sum of all batch losses = 47.32
  
  Console Output:
  "Epoch 1, Loss: 47.3200"
```

### **What Happens Across 25 Epochs**

```
EPOCH 1: Loss = 47.32  (Model is very confused)
EPOCH 2: Loss = 42.15  (Getting better)
EPOCH 3: Loss = 38.87  (Patterns emerging)
EPOCH 4: Loss = 35.22  (Weights adjusting)
EPOCH 5: Loss = 31.65  (Starting to converge)
...
EPOCH 20: Loss = 8.45   (Much better!)
EPOCH 21: Loss = 7.98   (Learning rate decreasing)
EPOCH 22: Loss = 7.65
EPOCH 23: Loss = 7.43
EPOCH 24: Loss = 7.28
EPOCH 25: Loss = 7.15   (Final loss)

The model has learned! Loss dropped 85% (47 → 7)
This means: weights now correctly predict labels
```

### **The Math Behind It (Simple)**

```
Loss Function = CrossEntropyLoss
═════════════════════════════════

For each prediction:
  True label:       POLICY_CREATED (index 0)
  Predicted probs:  [0.85, 0.10, 0.03, 0.01, 0.01]
  
  Loss = -log(0.85) = 0.163
  (If prediction was [0.5, ...], loss = -log(0.5) = 0.693)
  (If prediction was [0.1, ...], loss = -log(0.1) = 2.303)
  
  Lower probability for correct class = HIGHER loss

Backpropagation = Computing gradients
════════════════════════════════════════

For weight w in text_mlp.l1:
  ∂Loss/∂w tells us:
  - If positive: increase w slightly (loss will decrease)
  - If negative: decrease w slightly (loss will decrease)
  - If zero: weight doesn't affect loss (no change needed)

Adam Optimizer = Smart weight updater
═════════════════════════════════════════

Keeps track of:
  1. Current gradient (how to adjust now)
  2. Momentum (how we adjusted before)
  3. Adaptive learning rate (speeds up important weights)

Updates weights more intelligently than simple SGD
```

---

## ⚡ PART 5: SAVING THE TRAINED MODEL

### **What Gets Saved**

```python
# After 25 epochs, save to disk

model_artifacts = {
  "model_state_dict": {
    # All the LEARNED weights
    "txt_mlp.m.0.weight": [[...]...],  # 2000x128
    "txt_mlp.m.0.bias": [...],         # 128
    "txt_mlp.m.2.weight": [[...]...],  # 128x128
    "txt_mlp.m.2.bias": [...],         # 128
    
    "struct_mlp.m.0.weight": [...],    # 847x128
    "struct_mlp.m.0.bias": [...],      # 128
    "struct_mlp.m.2.weight": [...],    # 128x128
    "struct_mlp.m.2.bias": [...],      # 128
    
    "diff_mlp.m.0.weight": [...],      # 200x128
    "diff_mlp.m.0.bias": [...],        # 128
    "diff_mlp.m.2.weight": [...],      # 128x128
    "diff_mlp.m.2.bias": [...],        # 128
    
    "fc.weight": [...],                # num_classes x 384
    "fc.bias": [...]                   # num_classes
  },
  
  "vectorizer": <TfidfVectorizer>,  # Learned vocabulary
  "label_map": {                     # String to index mapping
    "POLICY_CREATED": 0,
    "POLICY_MODIFIED": 1,
    "INTERFACE_CREATED": 2,
    ...
  },
  "struct_dim": 847,
  "diff_dim": 200
}

pickle.dump(model_artifacts, open("model_artifacts.pkl", "wb"))
```

---

## 🔄 PART 6: CONVERTING TO JAVASCRIPT

### **Why Convert to JSON?**

```
Python Model (PyTorch):            JavaScript Model (JSON):
═════════════════════════════════  ═════════════════════════════════
Can't run in browser                Runs directly in browser
Binary format (not portable)         Text format (universal)
Dependencies (pytorch, sklearn)      No dependencies needed
500 MB file size                     2-5 MB file size
```

### **The Export Process**

```python
# export_model.py

# Step 1: Extract TF-IDF
vocab = vectorizer.vocabulary_  # {word: index, ...}
idf = vectorizer.idf_          # [1.2, 0.8, ...]

# Step 2: Extract weights (convert to lists)
model_data = {
  "tfidf": {
    "vocab": ["policy", "allow", "port1", ...],  # 2000 words
    "idf": [1.2, 0.8, 0.95, ...]                 # 2000 weights
  },
  
  "model": {
    "txt_mlp": {
      "l1_weight": [[...], [...], ...],     # 128 rows × 2000 cols
      "l1_bias": [...],                     # 128 values
      "l2_weight": [[...], [...], ...],     # 128 rows × 128 cols
      "l2_bias": [...]                      # 128 values
    },
    "struct_mlp": {...},
    "diff_mlp": {...},
    "fc": {
      "weight": [[...], [...], ...],        # num_classes rows × 384 cols
      "bias": [...]                         # num_classes values
    }
  },
  
  "metadata": {
    "labels": {0: "POLICY_CREATED", 1: "MODIFIED", ...},
    "struct_dim": 847,
    "diff_dim": 200
  }
}

# Step 3: Save as JSON
json.dump(model_data, open("model_data.json", "w"))
# File size: 2-5 MB
```

---

## 🎯 PART 7: LIVE PREDICTION (INFERENCE)

### **How Predictions Work in Browser**

```
NEW FORM SUBMISSION (User saves a config)
         │
         ▼
   ml-inference.js
   ├─ Preprocess features (same as training)
   ├─ Run through model
   └─ Return prediction + confidence


STEP-BY-STEP PREDICTION
═════════════════════════════════════════════════════

INPUT: New config change
{
  "metadata": {
    "vendor": "fortigate",
    "object_type": "policy"
  },
  "data": {
    "before": {},  (empty = CREATE)
    "after": {
      "name": "Allow HTTPS",
      "source_interface": "port1",
      "destination_interface": "port3",
      ...
    }
  },
  "changes": [
    {"field": "name", "old": "", "new": "Allow HTTPS"},
    {"field": "source_interface", "old": "", "new": "port1"},
    ...
  ]
}

STEP 1: TEXT FEATURE VECTORIZATION
───────────────────────────────────

Extract text:
  "name Allow HTTPS source_interface port1 destination_interface port3 ..."

Tokenize:
  ["name", "allow", "https", "source_interface", "port1", ...]

Look up in vocab (from TF-IDF):
  "name" → index 5
  "allow" → index 12
  "https" → index 203
  "source_interface" → index 45
  ...

Count occurrences & apply IDF:
  tf[5] = 1 × idf[5] = 1.2
  tf[12] = 1 × idf[12] = 0.8
  tf[203] = 1 × idf[203] = 1.1
  tf[45] = 1 × idf[45] = 0.95
  ...rest = 0

Normalize (L2):
  All values / sqrt(sum of squares)
  
  Result: [0.05, 0.0, ..., 0.08, ..., 0.04, ...]  (2000 dims)


STEP 2: STRUCTURAL FEATURE VECTORIZATION
──────────────────────────────────────────

Get feature keys:
  ["name", "source_interface", "destination_interface", ..., 847 total]

For each key, check if it has a value in "after":
  "name": "Allow HTTPS" → 1 (has value)
  "source_interface": "port1" → 1
  "destination_interface": "port3" → 1
  "log_traffic": undefined → 0 (missing)
  ...
  
  Result: [1, 1, 1, 0, 1, ..., 0]  (847 dims)


STEP 3: DIFF FEATURE VECTORIZATION
────────────────────────────────────

Get changed field names:
  ["name", "source_interface", "destination_interface"]

Hash each field:
  hash("name") = 12345 % 200 = 45
  hash("source_interface") = 67890 % 200 = 78
  hash("destination_interface") = 54321 % 200 = 21
  
  Set bits at those positions:
  diff_vec = [0, 0, ..., 1 (at 21), ..., 1 (at 45), ..., 1 (at 78), ...]
  
  Result: [0, 1, 0, ..., 1, ..., 1, 0, ...]  (200 dims)


STEP 4: FORWARD PASS (Neural Network)
──────────────────────────────────────

PATH 1: Text through txt_mlp
  input: [0.05, 0.0, ..., 0.08] (2000)
  ├─ Linear layer: multiply by weights + add bias
  │  result: [2.3, -0.5, 1.2, ..., 0.8]  (128)
  ├─ ReLU: max(0, x) for each value
  │  result: [2.3, 0.0, 1.2, ..., 0.8]   (128)
  └─ Linear layer again
     output: [1.5, 0.3, ..., -0.2]        (128)

PATH 2: Struct through struct_mlp
  input: [1, 1, 1, 0, 1, ...] (847)
  └─ Same process
     output: [0.8, 1.1, 0.2, ..., 0.5]   (128)

PATH 3: Diff through diff_mlp
  input: [0, 1, 0, ..., 1] (200)
  └─ Same process
     output: [2.1, -0.3, 0.9, ..., 0.1]  (128)

Concatenate all three:
  [1.5, 0.3, ..., -0.2, 0.8, 1.1, 0.2, ..., 0.5, 2.1, -0.3, 0.9, ..., 0.1]
  = [384 values]

Final classification:
  Multiply by FC weight matrix + add bias:
  logits = [2.3, -1.5, 0.8, 0.2, -0.3]  (5 classes)


STEP 5: SOFTMAX (Convert to Probabilities)
───────────────────────────────────────────

logits = [2.3, -1.5, 0.8, 0.2, -0.3]

exp each value:
  exp(2.3) = 9.97
  exp(-1.5) = 0.22
  exp(0.8) = 2.23
  exp(0.2) = 1.22
  exp(-0.3) = 0.74

Normalize (divide by sum):
  sum = 9.97 + 0.22 + 2.23 + 1.22 + 0.74 = 14.38
  
  probs = [
    9.97/14.38 = 0.693  (69.3%)
    0.22/14.38 = 0.015  (1.5%)
    2.23/14.38 = 0.155  (15.5%)
    1.22/14.38 = 0.085  (8.5%)
    0.74/14.38 = 0.051  (5.1%)
  ]
  
  Sum = 1.0 (probabilities)


STEP 6: FINAL PREDICTION
─────────────────────────

Find highest probability:
  Max = 0.693 at index 0
  
  label_map = {
    0: "POLICY_CREATED",
    1: "POLICY_MODIFIED",
    2: "INTERFACE_CREATED",
    3: "ADMIN_USER_CREATED",
    4: "OTHER"
  }
  
  PREDICTION = label_map[0] = "POLICY_CREATED"
  CONFIDENCE = 0.693 = 69.3%
  
  
RETURN to Browser Extension
────────────────────────────
{
  "label": "POLICY_CREATED",
  "confidence": 0.693,
  "probabilities": [0.693, 0.015, 0.155, 0.085, 0.051]
}

⏱️ Time: ~50ms (on modern browser)
```

---

## 📈 COMPLETE FLOW: Training → Prediction

```
┌────────────────────────────────────────────────────────┐
│  TRAINING PHASE (Backend, One-Time)                   │
├────────────────────────────────────────────────────────┤
│                                                        │
│  1. Collect 1000+ config changes (data collection)    │
│  2. Preprocess to tensors (preprocessing.py)          │
│  3. Train neural network (train.py)                   │
│     ├─ 25 epochs                                      │
│     ├─ 250 batches per epoch                          │
│     └─ Update 440K weights                            │
│  4. Save model (model_artifacts.pkl)                  │
│  5. Export to JavaScript (export_model.py)            │
│     └─ model_data.json (2-5 MB)                       │
│  6. Deploy to browser extension                       │
│                                                        │
└────────────────────────────────────────────────────────┘
                         │
                    REPEAT MONTHLY
                         │
┌────────────────────────────────────────────────────────┐
│  INFERENCE PHASE (Browser, Real-Time)                 │
├────────────────────────────────────────────────────────┤
│                                                        │
│  When user saves a config:                            │
│  1. Capture features (same as training)               │
│     ├─ Text vectorization (TF-IDF)                    │
│     ├─ Struct vectorization (binary)                  │
│     └─ Diff vectorization (hashed)                    │
│  2. Load model_data.json (cached)                     │
│  3. Forward pass through MLPs                         │
│  4. Softmax → probabilities                           │
│  5. Return prediction + confidence                    │
│                                                        │
│  Latency: ~50ms                                       │
│  Accuracy: Improves with each retraining              │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 🎓 KEY CONCEPTS SUMMARY

### **Training Concepts**

| Term | Meaning | Example |
|------|---------|---------|
| **Epoch** | One pass through all data | 25 epochs = see all 1000 samples 25 times |
| **Batch** | Small subset of data | batch_size=4 = 4 samples at a time |
| **Loss** | How wrong the model is | Loss=47 (bad), Loss=7 (good) |
| **Backprop** | Computing gradients | Shows which weights to adjust |
| **Gradient** | Direction to adjust weight | Positive = increase weight |
| **Learning Rate** | Step size for updates | 0.001 = small careful steps |

### **Inference Concepts**

| Term | Meaning | Example |
|------|---------|---------|
| **Forward Pass** | Data → Predictions | Input [2000+847+200] → Output [5] |
| **Vectorization** | Convert text to numbers | "policy" → [0.12, 0.0, ...] |
| **Softmax** | Convert scores to probabilities | logits → sum to 1.0 |
| **Confidence** | Probability of prediction | 69.3% = fairly sure |
| **Latency** | Time to predict | ~50ms per prediction |

---

## 💾 FILES AT EACH STAGE

```
Training:
  universal_training_data_*.json     (1000+ samples, 2-10 MB)
  └─ preprocessing.py
     train.pkl                       (tensors, 10-50 MB)
     └─ train.py
        model_artifacts.pkl          (trained weights, 1-3 MB)
        └─ export_model.py
           model_data.json           (JavaScript model, 2-5 MB)

Inference:
  model_data.json                    (loaded in browser cache)
  └─ ml-inference.js
     └─ Real-time predictions
```

---

## 🔍 MONITORING TRAINING

### **What to Watch For**

```
✅ GOOD SIGNS:
   • Loss decreases each epoch (47 → 42 → 38 → ...)
   • Loss curve smooth, not bouncy
   • No NaN (Not a Number) errors
   • Training completes in <1 minute

❌ BAD SIGNS:
   • Loss increases or stays flat
   • Loss jumps around wildly
   • NaN or Inf values
   • Memory error / out of VRAM
   
↔️ NORMAL SIGNS:
   • Loss decreases slower after epoch 10
   • Loss plateaus around epoch 20
   • Learning rate needs tuning (adjust from 1e-3)
```

---

## 🚀 IMPROVING MODEL ACCURACY

### **If predictions are inaccurate:**

```
Problem: Model always predicts POLICY_CREATED

Solutions:
1. Imbalanced data?
   • Count samples per class
   • Should be ~200-300 per class
   
2. Not enough data?
   • Collect 1000+ samples minimum
   • Each class needs 200+ samples
   
3. Bad features?
   • Check if features are meaningful
   • Visualize which features matter
   
4. Wrong labels?
   • Verify training data labels are correct
   • Relabel if needed
   
5. Model too simple?
   • Increase hidden layer size (128 → 256)
   • Add more MLP layers
   
6. Training too few epochs?
   • Run 50 epochs instead of 25
   • Monitor when loss plateaus
```

---

