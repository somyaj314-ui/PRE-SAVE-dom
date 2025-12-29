# ML Data Collection Guide for FortiGate Change Detection

## Overview

This system collects **labeled training data** from FortiGate DOM interactions to build ML models that can predict changes **before they are saved**.

## Architecture

```
User Action → DOM Monitor → ML Data Collector → JSON Export → ML Training
```

### Components

1. **ml-data-collector.js** - Core feature extraction engine
2. **ml-admin-integration.js** - Integration with existing monitors
3. **user-admin-monitor.js** - Detects admin user changes
4. **content.js** - Injects all scripts

## Data Collection Process

### Step 1: User Performs Action
- User creates/edits admin user in FortiGate
- DOM monitor detects the action

### Step 2: Feature Extraction
The ML collector extracts:
- **DOM Features**: Form structure, field presence, field states
- **Text Features**: Labels, buttons, headings, placeholders
- **Field Features**: Detailed field attributes and values
- **Interaction Features**: User modifications, timing
- **Raw DOM**: Sanitized HTML snapshot

### Step 3: Labeling
Each sample is automatically labeled with:
- `change_type`: 'admin_create', 'admin_edit', 'admin_delete'
- `action_taken`: 'creating', 'editing', 'saved', 'cancelled'
- `is_before_save`: true/false
- `mode`: 'CREATE' or 'EDIT'

### Step 4: Export
Data is exported as JSON with metadata

## JSON Data Format

### Structure
```json
{
  "metadata": {
    "total_samples": 100,
    "collection_date": "2025-12-08T10:30:00.000Z",
    "version": "1.0",
    "feature_types": ["admin_user"],
    "description": "FortiGate Admin User Change Detection - ML Training Data"
  },
  "samples": [
    {
      "sample_id": "admin_1733655000000_0",
      "timestamp": "2025-12-08T10:30:00.000Z",
      "url": "https://fortigate.example.com/ng/admin/create",
      "page_type": "admin_user",
      "label": { ... },
      "dom_features": { ... },
      "text_features": { ... },
      "field_features": { ... },
      "interaction_features": { ... },
      "raw_dom": { ... }
    }
  ]
}
```

### Feature Categories

#### 1. DOM Features (Structural)
```json
"dom_features": {
  "page_title": "Create Administrator - FortiGate",
  "page_path": "/ng/admin/create",
  "total_inputs": 8,
  "total_selects": 2,
  "total_buttons": 3,
  "has_username_field": true,
  "has_password_field": true,
  "has_admin_profile_field": true,
  "username_filled": true,
  "password_filled": true,
  "admin_profile_selected": true,
  "is_modal": true
}
```

**Use for ML**: Binary classification features, structural patterns

#### 2. Text Features (NLP)
```json
"text_features": {
  "visible_labels": ["Username", "Password", "Administrator Profile"],
  "button_texts": ["OK", "Cancel", "Test"],
  "headings": ["Create New Administrator"],
  "placeholders": ["Enter username", "Enter password"],
  "help_texts": ["Username must be unique"]
}
```

**Use for ML**: Text embeddings (BERT, Word2Vec), keyword matching

#### 3. Field Features (Detailed)
```json
"field_features": {
  "username": {
    "present": true,
    "name_attr": "username",
    "id_attr": "f-input_username_123",
    "value_length": 8,
    "is_required": true,
    "is_disabled": false
  },
  "admin_profile": {
    "present": true,
    "selected_value": "super_admin",
    "available_options": ["super_admin", "prof_admin", "read_only"],
    "is_required": true
  }
}
```

**Use for ML**: Field-level predictions, validation rules

#### 4. Interaction Features (Behavioral)
```json
"interaction_features": {
  "fields_modified": ["username", "password", "admin_profile"],
  "modification_count": 4,
  "time_on_page_ms": 15000,
  "focus_events": 6,
  "blur_events": 4
}
```

**Use for ML**: User behavior patterns, anomaly detection

## How to Collect Data

### Method 1: Automatic Collection (Recommended)

1. **Load Extension**
   - Install the Chrome extension
   - Navigate to FortiGate admin panel

2. **Perform Actions**
   - Create new admin users
   - Edit existing admin users
   - Delete admin users
   - Data is collected automatically

3. **Download Data**
   - Press `Ctrl+Shift+D` on FortiGate page
   - OR open browser console and run:
     ```javascript
     window.MLDataCollector.downloadSamples()
     ```

### Method 2: Programmatic Export

```javascript
// Get sample count
const count = window.MLDataCollector.getSampleCount();
console.log(`Collected ${count} samples`);

// Export as JSON string
const jsonData = window.MLDataCollector.exportSamples();
console.log(jsonData);

// Download file
window.MLDataCollector.downloadSamples();

// Clear samples
window.MLDataCollector.clearSamples();
```

## Data Collection Best Practices

### 1. Collect Diverse Scenarios

**Create Operations:**
- Different admin profiles (super_admin, prof_admin, read_only)
- With/without trusted hosts
- With/without email
- Different username lengths

**Edit Operations:**
- Change admin profile only
- Change password only
- Change multiple fields
- No changes (cancel)

**Delete Operations:**
- Delete confirmation
- Delete cancellation

### 2. Collect Both States

For each action, collect:
- **BEFORE save** (is_before_save: true) - User is filling form
- **AFTER save** (is_before_save: false) - User clicked OK

This creates paired samples for training.

### 3. Label Quality

Ensure labels are accurate:
- `creating` - User is actively filling form
- `editing` - User is modifying existing admin
- `saved` - User clicked OK/Save
- `cancelled` - User clicked Cancel

### 4. Sample Size

Recommended minimum samples:
- **Admin Create**: 100 samples (50 before save, 50 after save)
- **Admin Edit**: 100 samples
- **Admin Delete**: 50 samples

Total: **250+ samples** for robust model

## ML Model Training

### Recommended Approach

#### 1. Feature Engineering

```python
import pandas as pd
import json

# Load data
with open('fortigate_ml_training_admin.json', 'r') as f:
    data = json.load(f)

samples = data['samples']

# Extract features
features = []
labels = []

for sample in samples:
    # Flatten features
    feature_vector = {
        # DOM features
        'has_username_field': sample['dom_features']['has_username_field'],
        'has_password_field': sample['dom_features']['has_password_field'],
        'username_filled': sample['dom_features']['username_filled'],
        'password_filled': sample['dom_features']['password_filled'],
        'admin_profile_selected': sample['dom_features']['admin_profile_selected'],
        'is_modal': sample['dom_features']['is_modal'],
        'total_inputs': sample['dom_features']['total_inputs'],
        
        # Field features
        'username_length': sample['field_features']['username']['value_length'],
        'password_length': sample['field_features']['password']['value_length'],
        'username_disabled': sample['field_features']['username']['is_disabled'],
        
        # Interaction features
        'modification_count': sample['interaction_features']['modification_count'],
        'time_on_page_ms': sample['interaction_features']['time_on_page_ms'],
        
        # Text features (count)
        'label_count': len(sample['text_features']['visible_labels']),
        'button_count': len(sample['text_features']['button_texts'])
    }
    
    features.append(feature_vector)
    labels.append(sample['label']['change_type'])

df = pd.DataFrame(features)
```

#### 2. Model Selection

**Option A: Random Forest (Simple, Fast)**
```python
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split

X_train, X_test, y_train, y_test = train_test_split(df, labels, test_size=0.2)

model = RandomForestClassifier(n_estimators=100)
model.fit(X_train, y_train)

accuracy = model.score(X_test, y_test)
print(f'Accuracy: {accuracy}')
```

**Option B: XGBoost (Better Performance)**
```python
import xgboost as xgb

model = xgb.XGBClassifier(n_estimators=100, max_depth=5)
model.fit(X_train, y_train)
```

**Option C: Neural Network (Complex Patterns)**
```python
from tensorflow import keras

model = keras.Sequential([
    keras.layers.Dense(64, activation='relu', input_shape=(len(features[0]),)),
    keras.layers.Dropout(0.3),
    keras.layers.Dense(32, activation='relu'),
    keras.layers.Dense(3, activation='softmax')  # 3 classes: create, edit, delete
])

model.compile(optimizer='adam', loss='sparse_categorical_crossentropy', metrics=['accuracy'])
model.fit(X_train, y_train, epochs=50, validation_split=0.2)
```

#### 3. Text Feature Processing (Advanced)

```python
from sklearn.feature_extraction.text import TfidfVectorizer

# Combine all text features
def extract_text(sample):
    texts = []
    texts.extend(sample['text_features']['visible_labels'])
    texts.extend(sample['text_features']['button_texts'])
    texts.extend(sample['text_features']['headings'])
    return ' '.join(texts)

text_data = [extract_text(s) for s in samples]

# TF-IDF vectorization
vectorizer = TfidfVectorizer(max_features=100)
text_features = vectorizer.fit_transform(text_data)

# Combine with other features
import numpy as np
combined_features = np.hstack([df.values, text_features.toarray()])
```

## Deployment

### Real-Time Prediction

Once trained, deploy model to predict changes in real-time:

```javascript
// In browser extension
async function predictChange(domFeatures) {
    // Send features to ML API
    const response = await fetch('http://localhost:5000/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(domFeatures)
    });
    
    const prediction = await response.json();
    
    if (prediction.change_type === 'admin_create' && prediction.confidence > 0.8) {
        // Alert user BEFORE save
        alert('⚠️ Admin user creation detected!');
    }
}
```

### Python API Server

```python
from flask import Flask, request, jsonify
import joblib

app = Flask(__name__)
model = joblib.load('admin_change_model.pkl')

@app.route('/predict', methods=['POST'])
def predict():
    features = request.json
    
    # Extract feature vector
    feature_vector = [
        features['dom_features']['has_username_field'],
        features['dom_features']['username_filled'],
        # ... more features
    ]
    
    prediction = model.predict([feature_vector])[0]
    confidence = model.predict_proba([feature_vector]).max()
    
    return jsonify({
        'change_type': prediction,
        'confidence': float(confidence)
    })

if __name__ == '__main__':
    app.run(port=5000)
```

## Next Steps

### For Password Changes
Create `ml-password-collector.js` with similar structure

### For Interface Changes
Create `ml-interface-collector.js` with network-specific features

### For DoS Policy Changes
Create `ml-dos-collector.js` with policy-specific features

## Troubleshooting

### No samples collected
- Check browser console for errors
- Verify extension is loaded
- Ensure you're on FortiGate admin page

### Download not working
- Try manual export: `window.MLDataCollector.exportSamples()`
- Copy JSON from console

### Missing features
- Check if form structure matches expected selectors
- Update selectors in `ml-data-collector.js`

## Complete ML Data Collection System

You now have a **unified ML data collection pipeline** for ALL FortiGate changes:

### 📦 System Components

**Core Collectors:**
- `ml-data-collector.js` - Admin user changes
- `ml-password-collector.js` - Password changes  
- `ml-interface-collector.js` - Network interface changes
- `ml-dos-collector.js` - DoS policy changes
- `ml-address-collector.js` - Firewall address changes
- `ml-snat-collector.js` - Central SNAT map changes
- `ml-service-collector.js` - Firewall service changes
- `ml-policy-collector.js` - Firewall policy changes

**Integration Layer:**
- `ml-admin-integration.js` - Admin-specific integration
- `ml-unified-collector.js` - **Unified collection system**

**Sample Data:**
- `sample-ml-training-data.json` - Example output with all change types

### 🎯 Unified Data Collection

The system automatically collects labeled data for:

1. **Admin User Changes** (create/edit/delete users)
2. **Password Changes** (admin password updates)
3. **Network Interface Changes** (IP, gateway, VLAN configs)
4. **DoS Policy Changes** (attack protection rules)
5. **Firewall Address Changes** (IP addresses, subnets, ranges)
6. **Central SNAT Changes** (NAT rules, port forwarding)
7. **Firewall Service Changes** (TCP/UDP services, ports)
8. **Firewall Policy Changes** (security rules, UTM profiles)

### ⌨️ Enhanced Keyboard Shortcuts

- **Ctrl+Shift+D** - Download unified training data (all types)
- **Ctrl+Shift+S** - Show collection statistics
- **Ctrl+Shift+C** - Clear all samples

### 📊 Unified JSON Format

```json
{
  "metadata": {
    "total_samples": 250,
    "feature_types": ["admin_user", "password_change", "network_interface", "dos_policy", "firewall_address", "central_snat", "firewall_service", "firewall_policy"],
    "collection_stats": {
      "admin": 50,
      "password": 40, 
      "interface": 60,
      "dos": 50,
      "address": 50,
      "snat": 40,
      "service": 30,
      "policy": 70,
      "total": 350
    }
  },
  "samples": [
    // All change types in single dataset
  ]
}
```

### 🚀 How to Collect Complete Dataset

1. **Load Extension** with all ML collectors
2. **Perform Various Actions:**
   - Create/edit admin users
   - Change passwords
   - Configure network interfaces
   - Create DoS policies
   - Add firewall addresses
   - Configure SNAT rules
   - Create firewall services
   - Set up security policies
3. **Download Unified Data:** Press `Ctrl+Shift+D`
4. **Train Multi-Class Model** on all change types

### 🎯 ML Training Strategy

**Multi-Class Classification:**
- Predict change type: `admin_create`, `password_change`, `interface_edit`, `dos_create`, `address_create`, `snat_create`, `service_create`, `policy_create`
- Binary classification: `is_before_save` (true/false)
- Action prediction: `creating`, `editing`, `saved`, `cancelled`

**Recommended Sample Distribution:**
- **Admin User**: 100 samples
- **Password**: 80 samples  
- **Interface**: 120 samples
- **DoS Policy**: 100 samples
- **Address**: 100 samples
- **SNAT**: 80 samples
- **Service**: 60 samples
- **Policy**: 140 samples
- **Total**: 780+ samples for robust training

### 🔥 Advanced Features

**Real-Time Statistics:**
```javascript
// Get collection stats
const stats = window.MLUnifiedCollector.getCollectionStats();
console.log('Total samples:', stats.total);
console.log('By type:', stats.samples_by_type);
console.log('By action:', stats.samples_by_action);

// Generate recommendations
const summary = window.MLUnifiedCollector.generateSummary();
console.log('Recommendations:', summary.recommendations);
```

**Programmatic Export:**
```javascript
// Export all data
const jsonData = window.MLUnifiedCollector.exportUnifiedSamples();

// Get specific type
const adminSamples = window.MLUnifiedCollector.getSamplesByType('admin_user');
const passwordSamples = window.MLUnifiedCollector.getSamplesByType('password_change');
const snatSamples = window.MLUnifiedCollector.getSamplesByType('central_snat');
const serviceSamples = window.MLUnifiedCollector.getSamplesByType('firewall_service');
const policySamples = window.MLUnifiedCollector.getSamplesByType('firewall_policy');
```

## Summary

You now have a **complete, unified ML data collection system** for ALL FortiGate changes. The system:

✅ **Automatically collects** labeled data from 8 change types  
✅ **Unified JSON format** ready for ML training  
✅ **Real-time statistics** and collection guidance  
✅ **Keyboard shortcuts** for easy data export  
✅ **780+ sample capacity** for robust model training  

**Next Steps:**
1. Collect 780+ samples across all change types
2. Train multi-class ML model
3. Deploy real-time change prediction
4. Achieve **before-save detection** for all FortiGate changes! 🚀
