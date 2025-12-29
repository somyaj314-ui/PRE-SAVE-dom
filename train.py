# train.py
# Updated with improved visualization and structured design

import pickle
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
import numpy as np

print("Loading preprocessed data...")
data = pickle.load(open("train.pkl", "rb"))

texts = data["texts"]
tfidf_vectors = torch.tensor(data["tfidf_vectors"], dtype=torch.float32)
structs = data["structs"]
diffs = data["diffs"]
labels = data["labels"]
label_to_idx = data["label_to_idx"]
vectorizer = data["vectorizer"]
struct_dim = data["struct_dim"]
diff_dim = data["diff_dim"]

print(f"Data shapes:")
print(f"  Texts: {len(texts)}")
print(f"  TF-IDF vectors: {tfidf_vectors.shape}")
print(f"  Structs: {len(structs)} samples x {struct_dim} dims")
print(f"  Diffs: {len(diffs)} samples x {diff_dim} dims")
print(f"  Labels: {len(labels)}")
print(f"\nLabel mapping: {label_to_idx}")

# Dataset class
class ConfigDataset(Dataset):
    def __init__(self, tfidf_vecs, struct_vecs, diff_vecs, labels_str, label_map):
        self.tfidf = tfidf_vecs
        self.structs = struct_vecs
        self.diffs = diff_vecs
        self.labels_str = labels_str
        self.label_map = label_map
        
    def __len__(self):
        return len(self.labels_str)
    
    def __getitem__(self, idx):
        # Convert label string to index
        label_idx = self.label_map[self.labels_str[idx]]
        
        return (
            self.tfidf[idx],                                    # [2000]
            torch.tensor(self.structs[idx], dtype=torch.float32),  # [struct_dim]
            torch.tensor(self.diffs[idx], dtype=torch.float32),    # [200]
            torch.tensor(label_idx, dtype=torch.long)              # scalar (class index)
        )

# Create dataset and dataloader
dataset = ConfigDataset(tfidf_vectors, structs, diffs, labels, label_to_idx)
dataloader = DataLoader(dataset, batch_size=4, shuffle=True)

print(f"DataLoader: {len(dataloader)} batches of size 4")

# Model architecture
class MLP(nn.Module):
    """Single MLP for feature processing"""
    def __init__(self, input_dim, hidden_dim=128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim)
        )
    
    def forward(self, x):
        return self.net(x)

class MultiheadModel(nn.Module):
    """Three-expert voting model"""
    def __init__(self, tfidf_dim, struct_dim, diff_dim, num_classes, hidden_dim=128):
        super().__init__()
        
        # Three parallel experts
        self.txt_mlp = MLP(tfidf_dim, hidden_dim)
        self.struct_mlp = MLP(struct_dim, hidden_dim)
        self.diff_mlp = MLP(diff_dim, hidden_dim)
        
        # Final classifier
        # Each MLP outputs hidden_dim, so total = 3 * hidden_dim
        combined_dim = 3 * hidden_dim
        self.classifier = nn.Linear(combined_dim, num_classes)
    
    def forward(self, tfidf_vec, struct_vec, diff_vec):
        # Process through experts
        txt_out = self.txt_mlp(tfidf_vec)        # [batch, hidden_dim]
        struct_out = self.struct_mlp(struct_vec) # [batch, hidden_dim]
        diff_out = self.diff_mlp(diff_vec)       # [batch, hidden_dim]
        
        # Concatenate
        combined = torch.cat([txt_out, struct_out, diff_out], dim=1)  # [batch, 3*hidden_dim]
        
        # Classify
        logits = self.classifier(combined)  # [batch, num_classes]
        return logits

# Initialize model
num_classes = len(label_to_idx)
model = MultiheadModel(
    tfidf_dim=tfidf_vectors.shape[1],
    struct_dim=struct_dim,
    diff_dim=diff_dim,
    num_classes=num_classes,
    hidden_dim=128
)

print(f"\n🧠 Model initialized")
print(f"   Text MLP: {tfidf_vectors.shape[1]} → 128 → 128")
print(f"   Struct MLP: {struct_dim} → 128 → 128")
print(f"   Diff MLP: {diff_dim} → 128 → 128")
print(f"   Fusion: 384 → {num_classes} classes")

# Count parameters
total_params = sum(p.numel() for p in model.parameters())
print(f"   Total parameters: {total_params:,}")

# Training setup
optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
loss_fn = nn.CrossEntropyLoss()

print(f"\n📚 Training setup")
print(f"   Optimizer: Adam (lr=1e-3)")
print(f"   Loss function: CrossEntropyLoss")
print(f"   Batch size: 4")
print(f"   Epochs: 25")

# Training loop
num_epochs = 25
print(f"\n{'='*60}")
print(f"Starting training for {num_epochs} epochs...")
print(f"{'='*60}\n")

training_losses = []

for epoch in range(num_epochs):
    total_loss = 0
    num_batches = 0
    
    for batch_idx, (tfidf_batch, struct_batch, diff_batch, labels_batch) in enumerate(dataloader):
        # Forward pass
        logits = model(tfidf_batch, struct_batch, diff_batch)
        
        # Calculate loss
        loss = loss_fn(logits, labels_batch)
        
        # Backward pass
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        
        # Accumulate loss
        total_loss += loss.item()
        num_batches += 1
    
    avg_loss = total_loss / num_batches if num_batches > 0 else 0
    training_losses.append(avg_loss)
    
    # Print progress
    bar_length = int(avg_loss / (training_losses[0] if training_losses[0] > 0 else 1) * 20)
    bar = '█' * min(max(bar_length, 0), 20)
    print(f"Epoch {epoch+1:2d}/{num_epochs} | Loss: {avg_loss:8.4f} | {bar}")

print(f"\n{'='*60}")
print(f"Training complete!")
print(f"{'='*60}")
print(f"\nFinal loss: {training_losses[-1]:.4f}")
print(f"Initial loss: {training_losses[0]:.4f}")
print(f"Improvement: {(training_losses[0] - training_losses[-1]) / (training_losses[0] if training_losses[0] > 0 else 1) * 100:.1f}%")

# Save model
print(f"\n💾 Saving model...")

model_artifacts = {
    "model_state_dict": model.state_dict(),
    "vectorizer": vectorizer,
    "label_map": label_to_idx, # Kept as label_map for compatibility with export_model.py
    "struct_dim": struct_dim,
    "diff_dim": diff_dim,
    "feature_keys": data.get("feature_keys", []) # Ensure feature_keys is preserved if present
}

with open("model_artifacts.pkl", "wb") as f:
    pickle.dump(model_artifacts, f)

print(f"✅ Model saved to model_artifacts.pkl")
print(f"\nNext step: Run 'python export_model.py' to convert to JavaScript")