
import json

with open("vendor_field_map.json", "r") as f:
    v_map = json.load(f)

with open("extracted_keys.json", "r") as f:
    model_keys = set(json.load(f))

report = []
report.append(f"Model has {len(model_keys)} keys.")

for vendor, objects in v_map.items():
    for obj_type, config in objects.items():
        canonical = set(config.get("canonical_fields", []))
        
        # Check for fields in Map but NOT in Model
        extra = canonical - model_keys
        if extra:
            report.append(f"[{vendor}.{obj_type}] Extra fields (in map, not in model): {extra}")

with open("alignment_report.txt", "w") as f:
    f.write("\n".join(report))
    
print("Report written to alignment_report.txt")
