"""Export tank_model.pkl (RandomForestRegressor bundle) into files server.js can load.

tank_model.pkl is too big for GitHub (over 100 MB), so the trees are written as compact
binary arrays, gzipped and split into parts:

  model/meta.json             features, horizon_days, tanks, list of parts
  model/trees-<n>.bin.gz      a group of trees

Each tree in a part: uint32 node count, then per-node arrays
  left int32 | right int32 | feature int16 | missing_left uint8 | threshold float64 | value float64
(left == -1 marks a leaf). A random forest predicts the mean of its trees, so the parts
together give exactly the same prediction as the .pkl.

Needs scikit-learn 1.6.1 (the version the model was saved with):
  py -3.13 -m venv .venv
  .venv\\Scripts\\python -m pip install scikit-learn==1.6.1 joblib
  .venv\\Scripts\\python export-model.py
"""
import gzip
import json
import struct
from pathlib import Path

import joblib
import numpy as np

HERE = Path(__file__).parent
OUT = HERE / "model"
TREES_PER_PART = 50

bundle = joblib.load(HERE / "tank_model.pkl")
model = bundle["model"]
features = list(bundle["features"])
assert list(model.feature_names_in_) == features, "feature order in the bundle differs from the model"

OUT.mkdir(exist_ok=True)
for old in OUT.glob("trees-*.bin.gz"):
    old.unlink()


def tree_bytes(estimator):
    t = estimator.tree_
    n = t.node_count
    missing_left = getattr(t, "missing_go_to_left", np.zeros(n, dtype=np.uint8))
    return b"".join([
        struct.pack("<I", n),
        t.children_left.astype("<i4").tobytes(),
        t.children_right.astype("<i4").tobytes(),
        t.feature.astype("<i2").tobytes(),
        np.asarray(missing_left).astype("u1").tobytes(),
        t.threshold.astype("<f8").tobytes(),
        t.value[:, 0, 0].astype("<f8").tobytes(),
    ])


parts = []
trees = model.estimators_
for start in range(0, len(trees), TREES_PER_PART):
    group = trees[start:start + TREES_PER_PART]
    name = f"trees-{len(parts) + 1}.bin.gz"
    with gzip.open(OUT / name, "wb", compresslevel=9) as f:
        f.write(struct.pack("<I", len(group)))
        for est in group:
            f.write(tree_bytes(est))
    parts.append(name)
    print(f"{name}: {len(group)} trees, {(OUT / name).stat().st_size / 1e6:.1f} MB")

meta = {
    "model": type(model).__name__,
    "features": features,
    "horizon_days": int(bundle["horizon_days"]),
    "tanks": bundle["tanks"],
    "n_trees": len(trees),
    "parts": parts,
}
(OUT / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
print(f"Exported {len(trees)} trees and {len(meta['tanks'])} tanks to {OUT.name}/")
