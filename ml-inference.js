// ml-inference.js
class MLInference {
    constructor(modelData) {
        this.modelData = modelData;
        this.vocab = new Map(modelData.tfidf.vocab.map((w, i) => [w, i]));
        this.idf = modelData.tfidf.idf;
        console.log("🧠 ML Inference Engine Loaded");
        console.log(`   Vocab size: ${this.vocab.size}`);
    }

    // --- Preprocessing ---

    flatten(obj, out = []) {
        for (const key in obj) {
            if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
                this.flatten(obj[key], out);
            } else {
                out.push((obj[key] === null || obj[key] === false || (Array.isArray(obj[key]) && obj[key].length === 0)) ? 0 : 1);
            }
        }
        return out;
    }

    tokenize(text) {
        // Simple regex tokenizer to match sklearn's default
        return text.toLowerCase().match(/\b\w\w+\b/g) || [];
    }

    tfidfTransform(texts) {
        // Term Frequency
        const tf = new Array(this.vocab.size).fill(0);
        const tokens = this.tokenize(texts);

        for (const token of tokens) {
            if (this.vocab.has(token)) {
                tf[this.vocab.get(token)]++;
            }
        }

        // Apply PDF and normalization
        let norm = 0;
        for (let i = 0; i < tf.length; i++) {
            if (tf[i] > 0) {
                tf[i] = tf[i] * this.idf[i];
                norm += tf[i] * tf[i];
            }
        }

        // L2 Normalization
        norm = Math.sqrt(norm);
        if (norm > 0) {
            for (let i = 0; i < tf.length; i++) {
                tf[i] /= norm;
            }
        }

        return tf;
    }

    getDiffVector(mods) {
        const diffLen = 200;
        const vec = new Array(diffLen).fill(0);

        for (const m of mods) {
            // Simple hash function replication
            let hash = 0;
            for (let i = 0; i < m.length; i++) {
                const char = m.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            const idx = Math.abs(hash) % diffLen;
            vec[idx] = 1;
        }
        return vec;
    }

    // --- Model Logic ---

    linear(x, w, b) {
        // x: [in_dim], w: [out_dim, in_dim], b: [out_dim]
        const out = new Array(b.length).fill(0);
        for (let i = 0; i < b.length; i++) {
            let sum = 0;
            for (let j = 0; j < x.length; j++) {
                sum += x[j] * w[i][j];
            }
            out[i] = sum + b[i];
        }
        return out;
    }

    relu(x) {
        return x.map(v => Math.max(0, v));
    }

    softmax(x) {
        const max = Math.max(...x);
        const exps = x.map(v => Math.exp(v - max));
        const sum = exps.reduce((a, b) => a + b, 0);
        return exps.map(v => v / sum);
    }

    mlpForward(x, weights) {
        let h = this.linear(x, weights.l1_weight, weights.l1_bias);
        h = this.relu(h);
        return this.linear(h, weights.l2_weight, weights.l2_bias);
    }

    padVector(vec, targetLen) {
        if (vec.length >= targetLen) return vec.slice(0, targetLen);
        const padded = [...vec];
        while (padded.length < targetLen) padded.push(0);
        return padded;
    }

    // --- Prediction ---

    predict(sample) {
        try {
            console.time("Inference");

            let textVec, structVec, diffVec;

            // Handle Universal Format (v2.0)
            if (sample.metadata && sample.data) {
                const dataAfter = sample.data.after || {};
                const changes = sample.changes || [];
                const featureKeys = this.modelData.metadata.feature_keys || [];

                // 1. Text Features (Key + Values)
                let t = [];
                for (const k of featureKeys) {
                    if (dataAfter.hasOwnProperty(k)) {
                        const v = dataAfter[k];
                        t.push(String(k));
                        if (Array.isArray(v)) {
                            t.push(...v.map(String));
                        } else {
                            t.push(String(v));
                        }
                    }
                }
                const textStr = t.join(" ");
                textVec = this.tfidfTransform(textStr);

                // 2. Struct Features (Position-stable binary vector)
                structVec = [];
                for (const k of featureKeys) {
                    const val = dataAfter[k];
                    structVec.push((val === null || val === undefined || val === false || (Array.isArray(val) && val.length === 0) || val === "") ? 0 : 1);
                }

                // 3. Diff Features (Hashed names of modified fields)
                const mods = changes.map(c => c.field).filter(Boolean);
                diffVec = this.getDiffVector(mods);

                console.log(`🧠 Prediction Input: Text(${textStr.length} chars), Struct(${structVec.length} fields), Diff(${mods.length} changes)`);

            } else {
                // FALLBACK: Old format (v1.0)
                // 1. Text Features
                let t = [];
                if (sample.text_features) {
                    t.push(...(sample.text_features.visible_labels || []));
                    t.push(...(sample.text_features.button_texts || []));
                }
                textVec = this.tfidfTransform(t.join(" "));

                // 2. Struct Features
                structVec = [];
                if (sample.dom_features) this.flatten(sample.dom_features, structVec);
                if (sample.field_features) this.flatten(sample.field_features, structVec);
                if (sample.network_features) this.flatten(sample.network_features, structVec);

                // Pad struct vector
                const expectedStructDim = this.modelData.metadata.struct_dim;
                structVec = this.padVector(structVec, expectedStructDim);

                // 3. Diff Features
                const mods = (sample.interaction_features && sample.interaction_features.fields_modified) ? sample.interaction_features.fields_modified : [];
                diffVec = this.getDiffVector(mods);
            }

            // 4. Forward Pass
            const txtOut = this.mlpForward(textVec, this.modelData.model.txt_mlp);
            const structOut = this.mlpForward(structVec, this.modelData.model.struct_mlp);
            const diffOut = this.mlpForward(diffVec, this.modelData.model.diff_mlp);

            // Concatenate
            const combined = [...txtOut, ...structOut, ...diffOut];

            // Final Classification
            const logits = this.linear(combined, this.modelData.model.fc.weight, this.modelData.model.fc.bias);
            const probs = this.softmax(logits);

            // Get Prediction
            let maxIdx = 0;
            for (let i = 1; i < probs.length; i++) {
                if (probs[i] > probs[maxIdx]) maxIdx = i;
            }

            console.timeEnd("Inference");

            const label = this.modelData.metadata.labels[maxIdx];
            return {
                label: label,
                confidence: probs[maxIdx],
                probabilities: probs,
                debug: {
                    dims: {
                        text: textVec.length,
                        struct: structVec.length,
                        diff: diffVec.length
                    }
                }
            };
        } catch (e) {
            console.error("Prediction failed:", e);
            return null;
        }
    }
    // --- Static Helper ---

    static loadModel(modelUrl) {
        return fetch(modelUrl).then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        });
    }
}

// Helper to load model data (if running in node environment for test)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MLInference;
} else {
    // Browser environment
    window.MLInference = MLInference;
}
