
import pickle
import json

try:
    with open("train.pkl", "rb") as f:
        data = pickle.load(f)
        keys = data.get("feature_keys", [])
        
        # Write to a file for safe reading
        with open("extracted_keys.json", "w") as out:
            json.dump(keys, out, indent=2)
            
        print(f"Extracted {len(keys)} keys to extracted_keys.json")
except Exception as e:
    print(f"Error: {e}")
