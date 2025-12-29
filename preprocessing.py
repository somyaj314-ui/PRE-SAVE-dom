# preprocess.py
import json
import pickle
from pathlib import Path
from collections import Counter
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

# Use the specific training data file mentioned by the user
p = Path("universal_training_data_1766051559664.json")
if not p.exists():
    # Fallback to generic data.json if specific one not found
    p = Path("data.json")

if not p.exists():
    print(f"❌ Error: {p} not found")
    exit(1)

print(f"📂 Loading data from {p}")
raw = json.loads(p.read_text())
samples = raw["samples"]

# Load vendor map once for identity field lookups
v_map_path = Path("vendor_field_map.json")
v_map = {}
if v_map_path.exists():
    v_map = json.loads(v_map_path.read_text())

texts = []
structs = []
diffs = []
labels = []

# To maintain consistent feature ordering across samples, 
# we'll collect all unique canonical keys from the 'after' state.
all_keys = set()
for s in samples:
    if "data" in s and "after" in s["data"]:
        all_keys.update(s["data"]["after"].keys())
sorted_keys = sorted(list(all_keys))
print(f"📝 Identified {len(sorted_keys)} canonical fields for struct vector")

def stable_hash(s):
    """Mirror JS string hash implementation for consistency with ml-inference.js"""
    h = 0
    for char in s:
        h = ((h << 5) - h) + ord(char)
        h &= 0xFFFFFFFF
    if h > 0x7FFFFFFF:
        h -= 0x100000000
    return h

for s in samples:
    metadata = s.get("metadata", {})
    data_after = s.get("data", {}).get("after", {})
    changes = s.get("changes", [])
    
    # 1. Text Features (Combining canonical field names and values)
    t = []
    for k in sorted_keys:
        if k in data_after:
            v = data_after[k]
            t.append(str(k))
            if isinstance(v, list):
                t.extend(map(str, v))
            else:
                t.append(str(v))
    texts.append(" ".join(t))
    
    # 2. Struct Features (Binary vector of field presence)
    struct_vec = []
    for k in sorted_keys:
        val = data_after.get(k)
        # 0 if null, false, empty list or empty string
        struct_vec.append(0 if val in (None, False, [], "") else 1)
    structs.append(struct_vec)
    
    # 3. Diff Features (Hashed names of modified fields)
    diff_len = 200
    bit = [0] * diff_len
    for c in changes:
        field_name = c.get("field", "")
        if field_name:
            h = abs(stable_hash(field_name)) % diff_len
            bit[idx := (h % diff_len)] = 1
    diffs.append(bit)
    
    # 4. Labels (Object type + Operation)
    obj_type = metadata.get("object_type", "unknown").upper()
    operation = metadata.get("operation")
    
    # Infer operation if missing (for backward compatibility)
    if not operation:
        vendor = metadata.get("vendor", "fortigate")
        config = v_map.get(vendor, {}).get(metadata.get("object_type", ""), {})
        identity_field = config.get("identity_field")
        before = s.get("data", {}).get("before", {})
        
        if identity_field and identity_field in before:
            val = before[identity_field]
            is_create = not val or val == "" or val is False
        else:
            is_create = not before or len(before) == 0 or all(v in (None, False, "", []) for v in before.values())
            
        operation = "CREATE" if is_create else "EDIT"
    
    labels.append(f"{obj_type} {operation.upper()}")

# Final consistency check for struct dimensions
max_len = 0
if structs:
    max_len = max(len(s) for s in structs)
    for i in range(len(structs)):
        if len(structs[i]) < max_len:
            structs[i] = structs[i] + [0] * (max_len - len(structs[i]))

# 5. VECTORIZE TEXT
print("\nVectorizing text with TF-IDF...")
vectorizer = TfidfVectorizer(max_features=2000, min_df=1)
tfidf_vectors = vectorizer.fit_transform(texts).toarray()

# 6. Label Encoding
unique_labels = sorted(set(labels))
label_to_idx = {label: i for i, label in enumerate(unique_labels)}

out = {
    "texts": texts,
    "tfidf_vectors": tfidf_vectors.astype(np.float32),
    "structs": [np.array(s, dtype=np.float32) for s in structs],
    "diffs": [np.array(d, dtype=np.float32) for d in diffs],
    "labels": labels,
    "label_to_idx": label_to_idx,
    "vectorizer": vectorizer,
    "struct_dim": max_len,
    "diff_dim": 200,
    "feature_keys": sorted_keys
}

pickle.dump(out, open("train.pkl", "wb"))
print(f"✅ Processed {len(samples)} samples to train.pkl")
print("📊 Label distribution:")
dist = Counter(labels)
for lbl, count in dist.items():
    print(f"   {lbl}: {count}")
