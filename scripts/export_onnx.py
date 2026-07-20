"""Export the Cellmoku checkpoint (.pt) to ONNX for onnxruntime-web.

Usage (from repo root, venv with torch+onnx+onnxruntime):
    .venv/Scripts/python scripts/export_onnx.py [path/to/ckpt.pt]

- Reads network hyperparams from the checkpoint metadata (falls back to
  shape inference from the state_dict when absent).
- Exports fp32, then attempts int8 dynamic quantization; verifies both against
  the torch model on synthetic observations and ships the best passing variant
  to public/models/.
- Prints the checkpoint's env_config so rule parity can be eyeballed.
"""

from __future__ import annotations

import json
import re
import sys
import types
from pathlib import Path

import numpy as np
import torch

REPO = Path(__file__).resolve().parent.parent
PY_REF = REPO / "py_reference"
OUT_DIR = REPO / "public" / "models"
DEFAULT_CKPT = PY_REF / "ckpt_s3_i0900.pt"


def _alias_cellmoku_package() -> None:
    """Make `import cellmoku.network` resolve into py_reference/."""
    if "cellmoku" in sys.modules:
        return
    pkg = types.ModuleType("cellmoku")
    pkg.__path__ = [str(PY_REF)]  # namespace-style package pointing at py_reference
    sys.modules["cellmoku"] = pkg


def _infer_hparams(sd: dict) -> dict:
    """Fallback: derive channels/blocks/in_channels/value_hidden from shapes."""
    stem = sd["stem.0.weight"]  # (C, in, 3, 3)
    blocks = {int(m.group(1)) for k in sd if (m := re.match(r"tower\.(\d+)\.", k))}
    return {
        "channels": stem.shape[0],
        "in_channels": stem.shape[1],
        "num_blocks": len(blocks),
        "value_hidden": sd["value_mlp.1.weight"].shape[0],
    }


def load_model(ckpt_path: Path):
    _alias_cellmoku_package()
    from cellmoku.network import CellmokuNet, load_state_dict_adapting

    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    sd = ckpt["net"] if "net" in ckpt else ckpt
    hp = {
        "channels": ckpt.get("channels"),
        "in_channels": ckpt.get("in_channels"),
        "num_blocks": ckpt.get("num_blocks"),
        "value_hidden": None,
    }
    inferred = _infer_hparams(sd)
    for k, v in inferred.items():
        if hp.get(k) is None:
            hp[k] = v

    print(f"[ckpt] {ckpt_path.name}")
    print(f"  iteration={ckpt.get('iteration')} stage={ckpt.get('stage')}")
    print(f"  env_config={ckpt.get('env_config')}")
    print(f"  hparams={hp}")

    env_cfg = ckpt.get("env_config") or {}
    handicap = env_cfg.get("second_player_free_cells")
    if handicap:
        print(f"  !! WARNING: trained WITH P2 handicap {handicap} — web rules have none")

    net = CellmokuNet(
        in_channels=hp["in_channels"],
        channels=hp["channels"],
        num_blocks=hp["num_blocks"],
        value_hidden=hp["value_hidden"],
    )
    load_state_dict_adapting(net, sd)
    net.eval()
    n_params = sum(p.numel() for p in net.parameters())
    print(f"  params={n_params:,} (~{n_params * 4 / 1e6:.1f} MB fp32)")
    return net, ckpt, hp


def make_test_inputs(n: int, in_ch: int, N: int, seed: int = 7) -> np.ndarray:
    """Synthetic obs-like inputs: mostly binary planes + a scalar-ish plane."""
    rng = np.random.default_rng(seed)
    x = (rng.random((n, in_ch, N, N)) < 0.15).astype(np.float32)
    x[:, 7] = rng.integers(0, 9, (n, 1, 1)).astype(np.float32) / 8.0  # K plane
    x[:, 6] = rng.integers(0, 2, (n, 1, 1)).astype(np.float32)  # phase plane
    return x


def torch_forward(net, x: np.ndarray):
    with torch.no_grad():
        s, c, v = net(torch.from_numpy(x))
    return s.numpy(), c.numpy(), v.numpy()


def ort_forward(path: Path, x: np.ndarray):
    import onnxruntime as ort

    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    outs = [sess.run(None, {"obs": x[i : i + 1]}) for i in range(x.shape[0])]
    s = np.concatenate([o[0] for o in outs])
    c = np.concatenate([o[1] for o in outs])
    v = np.concatenate([o[2] for o in outs])
    return s, c, v


def compare(ref, got, label: str) -> dict:
    """Compare (stone, cell, value) triples; return metrics."""
    m = {}
    for name, a, b in zip(("stone", "cell"), ref[:2], got[:2]):
        m[f"{name}_max_abs"] = float(np.max(np.abs(a - b)))
        m[f"{name}_argmax_agree"] = float(np.mean(a.argmax(1) == b.argmax(1)))
    m["value_max_abs"] = float(np.max(np.abs(ref[2] - got[2])))
    print(f"  [{label}] " + " ".join(f"{k}={v:.4g}" for k, v in m.items()))
    return m


def main() -> None:
    ckpt_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CKPT
    net, ckpt, hp = load_model(ckpt_path)
    N = (ckpt.get("env_config") or {}).get("board_size", 15)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    stem = ckpt_path.stem  # e.g. ckpt_s3_i0900
    fp32_path = OUT_DIR / f"{stem}.onnx"
    int8_path = OUT_DIR / f"{stem}.int8.onnx"

    dummy = torch.zeros(1, hp["in_channels"], N, N)
    torch.onnx.export(
        net,
        (dummy,),
        str(fp32_path),
        input_names=["obs"],
        output_names=["stone_logits", "cell_logits", "value"],
        opset_version=17,
        dynamo=False,
    )
    print(f"[export] fp32 -> {fp32_path} ({fp32_path.stat().st_size / 1e6:.1f} MB)")

    x = make_test_inputs(16, hp["in_channels"], N)
    ref = torch_forward(net, x)

    fp32_metrics = compare(ref, ort_forward(fp32_path, x), "fp32 vs torch")
    assert fp32_metrics["stone_max_abs"] < 1e-3 and fp32_metrics["value_max_abs"] < 1e-4, (
        "fp32 ONNX export diverges from torch — aborting"
    )

    # ── int8 dynamic quantization attempt ────────────────────────────────────
    chosen = fp32_path
    try:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        quantize_dynamic(
            str(fp32_path),
            str(int8_path),
            weight_type=QuantType.QInt8,
            op_types_to_quantize=["Conv", "MatMul", "Gemm"],
        )
        print(f"[export] int8 -> {int8_path} ({int8_path.stat().st_size / 1e6:.1f} MB)")
        q = compare(ref, ort_forward(int8_path, x), "int8 vs torch")
        # Accept int8 only if move choice is unaffected and value shift is small.
        ok = (
            q["stone_argmax_agree"] == 1.0
            and q["cell_argmax_agree"] == 1.0
            and q["value_max_abs"] < 0.03
        )
        if ok:
            chosen = int8_path
            print("[quant] int8 passes tolerance -> shipping int8")
        else:
            int8_path.unlink(missing_ok=True)
            print("[quant] int8 FAILED tolerance -> shipping fp32")
    except Exception as e:  # noqa: BLE001
        print(f"[quant] int8 quantization unavailable/failed ({e}) -> shipping fp32")

    # drop the loser so only one model is committed
    for p in (fp32_path, int8_path):
        if p.exists() and p != chosen:
            p.unlink()

    manifest = {
        "file": chosen.name,
        "checkpoint": ckpt_path.name,
        "iteration": ckpt.get("iteration"),
        "stage": ckpt.get("stage"),
        "board_size": N,
        "in_channels": hp["in_channels"],
        "quantized": chosen.name.endswith(".int8.onnx"),
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"[done] model={chosen.name} ({chosen.stat().st_size / 1e6:.1f} MB)")
    print(f"[done] manifest -> {OUT_DIR / 'manifest.json'}")


if __name__ == "__main__":
    main()
