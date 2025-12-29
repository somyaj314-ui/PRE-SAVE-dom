# 🎤 TRAINING & INFERENCE: PRESENTATION SLIDES

## SLIDE 1: Training vs Inference (What's the Difference?)

```
┌─────────────────────────────────────────────────────────┐
│                   TRAINING                              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Learning Phase (Happens ONCE on Backend Server)       │
│  ────────────────────────────────────────────────────   │
│                                                         │
│  Input: 1000+ labeled examples                         │
│    ├─ "policy allow http port1 port2" → CREATED       │
│    ├─ "policy allow dns port3 port4" → MODIFIED       │
│    └─ ...                                              │
│                                                         │
│  Process: 25 iterations (epochs)                       │
│    ├─ Each time: see all 1000 samples                 │
│    ├─ Adjust 440K internal weights                    │
│    └─ Get slightly better at predictions              │
│                                                         │
│  Output: Trained model (weights saved)                │
│    └─ "Policy with empty 'before' = likely CREATED"   │
│    └─ "Few fields changed = likely MODIFIED"          │
│                                                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   INFERENCE                             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Prediction Phase (Happens MANY TIMES in Browser)      │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  Input: 1 new config change (no label yet)             │
│    ├─ User saves policy with 3 fields changed         │
│    └─ "policy allow https port1 port3 status" (?)     │
│                                                         │
│  Process: Use trained weights (read-only)              │
│    ├─ ~50ms of matrix multiplications                 │
│    ├─ No weight updates!                              │
│    └─ Just forward pass through network               │
│                                                         │
│  Output: Prediction + Confidence                      │
│    └─ "POLICY_MODIFIED with 78% confidence"           │
│                                                         │
└─────────────────────────────────────────────────────────┘

KEY DIFFERENCE:
  Training = LEARNING (weights change)
  Inference = USING (weights fixed)
```

---

## SLIDE 2: Training Loop Visualization

```
THE TRAINING PROCESS
═════════════════════════════════════════════════════════

EPOCH 1:     Loss: 47.32  ███████████████████
EPOCH 2:     Loss: 42.15  ████████████████
EPOCH 3:     Loss: 38.87  ███████████████
EPOCH 4:     Loss: 35.22  ██████████████
EPOCH 5:     Loss: 31.65  █████████████
...
EPOCH 20:    Loss: 8.45   ██
EPOCH 21:    Loss: 7.98   ██
EPOCH 22:    Loss: 7.65   █
EPOCH 23:    Loss: 7.43   █
EPOCH 24:    Loss: 7.28   █
EPOCH 25:    Loss: 7.15   █

Loss dropped 85% → Model learned!


INSIDE ONE EPOCH (25K samples = 250 batches)
─────────────────────────────────────────────

Initialize weights randomly

FOR BATCH 1-250:
  1️⃣  PREDICT: 4 samples through network → 4 predictions
  2️⃣  COMPARE: predictions vs true labels → loss
  3️⃣  ANALYZE: which weights caused errors → gradients
  4️⃣  UPDATE: adjust weights slightly → better next time

After epoch: All weights adjusted slightly
After 25 epochs: All weights perfectly tuned


THE "AHA" MOMENT
────────────────────────────────────────────────────────

After epoch 1:  Weights: Random
                Model: Guesses randomly (loss=47)

After epoch 10: Weights: Starting to see patterns
                Model: Getting decent (loss=18)

After epoch 25: Weights: Learned relationships
                Model: Very accurate (loss=7)

Now model "understands":
  "If 'before' is empty → probably CREATE"
  "If 1-2 fields changed → probably MODIFY"
  "If field names look like interface → probably INTERFACE_*"
```

---

## SLIDE 3: The Neural Network Brain

```
HOW THE MODEL WORKS
═════════════════════════════════════════════════════════

Think of it as a 3-expert voting system:

   TEXT EXPERT              STRUCT EXPERT        DIFF EXPERT
   (reads labels)           (sees form shape)    (watches changes)
        │                          │                    │
        │                          │                    │
        ▼                          ▼                    ▼
   "This mentions             "The form has        "3 fields
    'allow' and               9 fields, looks      changed,
    'https', so               like policy"         that's typical
    probably                                       for create"
    a policy
    policy"
        │                          │                    │
        │                          │                    │
        └──────────────┬───────────┴────────────────────┘
                       │
                       ▼
                 COMBINE VOTES
                 (Weighted Average)
                       │
                       ▼
                   DECISION
           "This is POLICY_CREATED"
               (with 87% confidence)


THE TECHNICAL VIEW:

Input: 3 types of features
  ├─ Text: TF-IDF vectors [2000 dims]
  │         (word importance)
  ├─ Struct: Form shape [847 dims]
  │         (which fields present)
  └─ Diff: Change pattern [200 dims]
           (which fields modified)

Each goes through its own "expert" (MLP):
  ├─ Text Expert: 2000 → 128 dims
  ├─ Struct Expert: 847 → 128 dims
  └─ Diff Expert: 200 → 128 dims

Combined knowledge: 128+128+128 = 384 dims

Final judge: 384 → 5 classes (CREATED, MODIFIED, etc)

Softmax: Converts to probabilities (sum to 100%)
```

---

## SLIDE 4: One Prediction Step-by-Step

```
LIVE PREDICTION (What happens when user saves a policy)
═════════════════════════════════════════════════════════

USER SAVES CONFIG
│
├─ Form data captured:
│  ├─ Before: {} (empty)
│  └─ After: {name, srcintf, dstintf, action, ...}
│
└─ Changes: [{field: "name", old: "", new: "Allow DNS"}, ...]


STEP 1: TEXT FEATURE
──────────────────────
Words in form: "policy", "allow", "dns", "port1", "port2"

TF-IDF vector: Count how important each word is
  "policy" appears in 50% of samples → weight=0.8
  "allow" appears in 90% of samples → weight=0.3
  "dns" appears in 20% of samples → weight=1.2
  ...
  
Result: [0.12, 0.0, 0.45, ..., 0.02] (2000 dimensions)
         ▲
         └─ Only 10-50 non-zero values


STEP 2: STRUCT FEATURE
───────────────────────
Which fields exist?
  name: YES → 1
  srcintf: YES → 1
  dstintf: YES → 1
  action: YES → 1
  logging: NO → 0
  rate_limit: NO → 0
  ...

Result: [1, 1, 1, 1, 0, 0, ..., 1] (847 dimensions)
        ▲
        └─ All either 0 or 1


STEP 3: DIFF FEATURE
─────────────────────
What fields changed?
  name: changed
  srcintf: changed
  dstintf: changed
  action: NOT changed
  ...

Hash changed field names:
  hash("name") % 200 = 45
  hash("srcintf") % 200 = 78
  hash("dstintf") % 200 = 21
  
Result: [0, 0, ..., 1(pos 21), ..., 1(pos 45), ..., 1(pos 78), ..., 0]
        ▲
        └─ Sparse: only 3 out of 200 are 1


STEP 4: NEURAL NETWORK FORWARD PASS
─────────────────────────────────────

Input Features:
  text[2000] → txt_mlp → [128]
  struct[847] → struct_mlp → [128]
  diff[200] → diff_mlp → [128]

Combine:
  [128 + 128 + 128] = [384]
  
Classify:
  [384] → linear layer → [5] logits
  
  logits = [2.3, -1.5, 0.8, 0.2, -0.3]
           ▲
           └─ Raw scores (not probabilities yet)


STEP 5: SOFTMAX CONVERSION
────────────────────────────

logits [2.3, -1.5, 0.8, 0.2, -0.3]
  │
  ├─ Exponentiate: e^2.3=9.97, e^-1.5=0.22, ...
  │
  └─ Normalize: divide by sum
  
Result probabilities:
  [0.693, 0.015, 0.155, 0.085, 0.051]
   69.3%   1.5%   15.5%   8.5%   5.1%   ← Sum = 100%


STEP 6: FINAL ANSWER
──────────────────────

Highest probability: 0.693 (69.3%) at position 0

Label mapping:
  0 → "POLICY_CREATED"
  1 → "POLICY_MODIFIED"
  2 → "INTERFACE_CREATED"
  3 → "ADMIN_USER_CREATED"
  4 → "OTHER"

PREDICTION:
{
  "label": "POLICY_CREATED",
  "confidence": 0.693,
  "reason": "Empty 'before' state + multiple fields changed"
}

⏱️ Time: 45-50 milliseconds


SEND TO BROWSER EXTENSION
──────────────────────────

Extension shows:
  ✅ POLICY_CREATED (69% confident)
  
  [More details...]
  - 3 fields modified
  - Form was empty before
  - Similar to 150+ CREATE events in training
```

---

## SLIDE 5: Simple Analogy

```
TRAINING IS LIKE LEARNING TO RECOGNIZE ANIMALS

Teacher shows you 1000 images:
  • Image 1: Photo of dog → "This is DOG"
  • Image 2: Photo of cat → "This is CAT"
  • Image 3: Photo of dog → "This is DOG"
  ...

You notice patterns:
  "Dogs have: 4 legs, floppy ears, tail, barks"
  "Cats have: 4 legs, pointed ears, whiskers, meows"
  "Birds have: 2 legs, wings, beak, flies"

After seeing 1000 images 25 times each:
  You become expert at recognizing animals!


INFERENCE IS LIKE IDENTIFYING NEW ANIMALS

You see a NEW animal:
  "It has 4 legs, pointed ears, whiskers..."
  
You remember your training:
  "That matches CAT pattern!"
  
You say: "This is probably a CAT (90% sure)"

You're not learning anymore, just using learned patterns!


THE SAME CONCEPT IN ML:

TRAINING:
  Teacher: [1000 labeled config changes]
  Model: "I see patterns..."
  After 25 epochs: "I learned! CREATE = empty before"

INFERENCE:
  New config: "Empty before, 3 fields changed"
  Model: "I remember that pattern!"
  Output: "POLICY_CREATED (87% sure)"
```

---

## SLIDE 6: Key Metrics to Remember

```
TRAINING METRICS (How good is the model?)
═══════════════════════════════════════════════════════

Initial Loss:     47.32  (very bad, random)
Final Loss:       7.15   (very good, learned)
Improvement:      85% drop

Epochs:           25     (iterations)
Batches/epoch:    250    (samples grouped by 4)
Total updates:    6250   (25 × 250)

Training time:    ~30 seconds on CPU
                  ~5 seconds on GPU


INFERENCE METRICS (How fast is prediction?)
═══════════════════════════════════════════════════════

Latency:          45-50 ms per prediction
  • Vectorization: 10ms
  • Network forward pass: 30ms
  • Softmax: 5ms

Accuracy:         85-92% (depends on data quality)
                  Improves with each retraining

Confidence:       Predictions have probability score
                  0.50 = uncertain (don't trust)
                  0.90 = confident (trust)
                  0.99 = very confident


MODEL SIZE
═══════════════════════════════════════════════════════

PyTorch weights:    1-3 MB (binary, heavy)
JSON export:        2-5 MB (text, larger)
Loaded in browser:  Uses ~5MB RAM

Parameters:         440,000 total
                    Tiny compared to GPT (7B+)

Why so small?
  • No deep layers (only 2 layers per MLP)
  • Limited feature dimensions (2000+847+200)
  • Simple architecture (MLPs, not Transformers)
```

---

## SLIDE 7: The Complete Journey

```
START HERE:
┌─────────────────────┐
│  User uses system   │
│  Makes config       │
│  changes            │
└────────┬────────────┘
         │
         ▼ (1000+ changes collected)
┌─────────────────────────────────────┐
│  DATA COLLECTION PHASE              │
│  ├─ Browser extension captures      │
│  ├─ Maps to canonical schema        │
│  └─ Exports as JSON                 │
└────────┬────────────────────────────┘
         │
         ▼ (Upload to backend)
┌─────────────────────────────────────┐
│  PREPROCESSING PHASE                │
│  ├─ Convert to tensors              │
│  ├─ Vectorize text (TF-IDF)         │
│  ├─ Flatten structures              │
│  └─ Create batches                  │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  TRAINING PHASE (25 epochs)         │
│  ├─ Initialize random weights       │
│  ├─ Forward pass                    │
│  ├─ Calculate loss                  │
│  ├─ Backpropagation                 │
│  ├─ Update weights                  │
│  └─ Loss: 47 → 42 → ... → 7        │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  EXPORT PHASE                       │
│  ├─ Extract learned weights         │
│  ├─ Convert PyTorch → JSON          │
│  └─ Compress (2-5 MB)               │
└────────┬────────────────────────────┘
         │
         ▼ (Deploy to browser)
┌─────────────────────────────────────┐
│  INFERENCE PHASE (Daily)            │
│  ├─ User saves new config (trigger) │
│  ├─ Preprocess features             │
│  ├─ Forward pass (~50ms)            │
│  └─ Return: Label + Confidence      │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  REPEAT MONTHLY                     │
│  ├─ Collect new examples            │
│  ├─ Retrain with larger dataset     │
│  └─ Deploy improved model           │
└─────────────────────────────────────┘
```

---

## SLIDE 8: Quick Comparison

```
RULE-BASED (Old Way)          ML-BASED (New Way)
═════════════════════════════════════════════════════════

How it works:
└─ IF/ELSE hardcoded           └─ Learned from 1000 examples

Accuracy:
└─ ~60-70% (misses edge cases) └─ 85-92% (learns patterns)

Scaling:
└─ 500 lines per vendor        └─ 1 model for all vendors

Updates:
└─ Manual code changes          └─ Retrain with new data

Speed:
└─ Instant (simple regex)       └─ 50ms (matrix math)

Learning:
└─ Never improves               └─ Better each month

Maintenance:
└─ High (always fixing bugs)    └─ Low (let data fix it)

Cost:
└─ Dev-heavy (lots of coding)  └─ Data-heavy (need examples)


WHEN TO USE WHICH?

Rule-Based GOOD FOR:
  ✓ Simple patterns (hello = greeting)
  ✓ 100% accuracy needed
  ✓ Few vendors

ML GOOD FOR:
  ✓ Complex patterns (config type detection)
  ✓ Many vendors
  ✓ Patterns that change over time
  ✓ Scale to new vendors easily
```

---

## SLIDE 9: Troubleshooting

```
PROBLEM: Model always predicts "CREATED"

CAUSES & SOLUTIONS:
1️⃣  Imbalanced data?
    Check: Count samples per class
    Fix: Collect more MODIFIED examples
    
2️⃣  Wrong labels in training?
    Check: Manually verify 50 samples
    Fix: Relabel if needed
    
3️⃣  Not enough training data?
    Check: Do you have 200+ samples per class?
    Fix: Collect 1000+ total samples
    
4️⃣  Features not helpful?
    Check: Look at feature importance
    Fix: Add new features or improve collection
    
5️⃣  Model underfitting (loss too high)?
    Check: Does loss drop each epoch?
    Fix: Train more epochs, bigger hidden layers


PROBLEM: Training is slow

CAUSES & SOLUTIONS:
1️⃣  Large dataset?
    Check: How many samples? (>5000?)
    Fix: Sample randomly, use subset to test
    
2️⃣  No GPU?
    Check: Is pytorch using CPU?
    Fix: Use GPU (RTX 2060+, ~$150)
    
3️⃣  Inefficient code?
    Check: Use profiler
    Fix: Batch processing, vectorization


PROBLEM: Inference is slow (>200ms)

CAUSES & SOLUTIONS:
1️⃣  Large model?
    Check: model_data.json size
    Fix: Reduce vocab size (2000 → 1000)
    
2️⃣  Complex vectorization?
    Check: Text preprocessing takes long
    Fix: Cache vectorizer, use simpler tokenizer
    
3️⃣  Slow browser?
    Check: Mobile vs desktop
    Fix: Optimize for target device
```

---

## SLIDE 10: Future Improvements

```
ROADMAP FOR BETTER PREDICTIONS
═════════════════════════════════════════════════════════

PHASE 1 (Current):
  ✅ Text + Struct + Diff features
  ✅ 3-expert voting
  ✅ Single model for all vendors

PHASE 2 (Next Quarter):
  🔜 Add confidence thresholding
  🔜 Reject predictions <70% confidence
  🔜 Collect and store uncertain cases
  🔜 Monthly retraining pipeline

PHASE 3 (6 Months):
  🔜 Per-vendor fine-tuning
  🔜 Transfer learning (faster retraining)
  🔜 Multi-label classification (multiple tags)
  🔜 Uncertainty quantification

PHASE 4 (1 Year):
  🔜 Anomaly detection (unusual changes)
  🔜 Risk scoring (is this risky?)
  🔜 Sequence modeling (time-series)
  🔜 Ensemble multiple models


WHAT WOULD IMPROVE ACCURACY MOST?

1. More data (highest impact)
   └─ 1000 → 5000 samples = +15% accuracy
   
2. Better labeling (high impact)
   └─ Clean labels = +10% accuracy
   
3. Feature engineering (medium impact)
   └─ Add new features = +5% accuracy
   
4. Bigger model (low impact)
   └─ 128 → 256 hidden = +2% accuracy
```

---

