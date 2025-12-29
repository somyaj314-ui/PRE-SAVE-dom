# export_model.py
import pickle
import json
import torch
import numpy as np

print("Loading model artifacts...")
artifacts = pickle.load(open("model_artifacts.pkl", "rb"))
model_state = artifacts["model_state_dict"]
vectorizer = artifacts["vectorizer"]
label_map = artifacts["label_map"]
struct_dim = artifacts["struct_dim"]
diff_dim = artifacts["diff_dim"]

print("Extracting TF-IDF data...")
# Extract TF-IDF vocabulary and IDF weights
vocab = vectorizer.vocabulary_
idf = vectorizer.idf_
# Sort by index to ensure correct order
sorted_vocab = sorted(vocab.items(), key=lambda x: x[1])
vocab_list = [word for word, idx in sorted_vocab]
idf_list = idf.tolist()

print("Extracting model weights...")
def get_weights(layer_name):
    w = model_state[f"{layer_name}.0.weight"].tolist()
    b = model_state[f"{layer_name}.0.bias"].tolist()
    w2 = model_state[f"{layer_name}.2.weight"].tolist()
    b2 = model_state[f"{layer_name}.2.bias"].tolist()
    return {
        "l1_weight": w,
        "l1_bias": b,
        "l2_weight": w2,
        "l2_bias": b2
    }

model_data = {
    "tfidf": {
        "vocab": vocab_list,
        "idf": idf_list
    },
    "model": {
        "txt_mlp": get_weights("txt_mlp.net"),
        "struct_mlp": get_weights("struct_mlp.net"),
        "diff_mlp": get_weights("diff_mlp.net"),
        "fc": {
            "weight": model_state["classifier.weight"].tolist(),
            "bias": model_state["classifier.bias"].tolist()
        }
    },
    "metadata": {
        "labels": {v: k for k, v in label_map.items()}, # Invert label map for lookup
        "struct_dim": struct_dim,
        "diff_dim": diff_dim,
        "feature_keys": artifacts.get("feature_keys", [])
    }
}

print("Saving to model_data.json...")
with open("model_data.json", "w") as f:
    json.dump(model_data, f)

print(f"✅ Export complete! JSON size: {len(json.dumps(model_data))/1024:.2f} KB")
print("You can now load 'model_data.json' in your JS inference engine.")
