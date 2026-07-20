"""Generate golden fixtures for the TypeScript port.

Plays seeded random games with the reference env, captures positions (stone and
cell phases), and dumps for each:
  - the raw state (cells/stones/player/phase/K/lastStone/thisTurnCells)
  - the observation tensor (CHW-flattened, matching the ONNX input layout)
  - the legal mask (as index list)
  - the network policy (legal-masked softmax, as env/net.infer does) and value

The TS tests rebuild the state, recompute the observation, and must match the
obs exactly; policy/value document the expected network outputs (compared with
tolerance wherever JS-side inference is exercised).

Usage: .venv/Scripts/python scripts/make_golden.py
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import numpy as np
import torch

REPO = Path(__file__).resolve().parent.parent
PY_REF = REPO / "py_reference"
CKPT = PY_REF / "ckpt_s3_i0900.pt"
OUT = REPO / "src" / "services" / "agent" / "__fixtures__" / "golden.json"


def _alias_cellmoku_package() -> None:
    if "cellmoku" in sys.modules:
        return
    pkg = types.ModuleType("cellmoku")
    pkg.__path__ = [str(PY_REF)]
    sys.modules["cellmoku"] = pkg


def snapshot(env, net, name: str) -> dict:
    obs_hwc = env._obs()  # (N, N, 10)
    obs_chw = obs_hwc.transpose(2, 0, 1)  # ONNX input layout
    mask = env.legal_mask()
    probs, value = net.infer(obs_hwc, mask, int(env.phase), torch.device("cpu"))
    wdl = net.infer_wdl(obs_hwc, torch.device("cpu"))
    # raw phase-selected logits (pre-mask) — exercises the JS masked-softmax path
    with torch.no_grad():
        x = torch.from_numpy(obs_chw).float().unsqueeze(0)
        stone_l, cell_l, _ = net(x)
    logits = (stone_l if int(env.phase) == 0 else cell_l).squeeze(0).numpy()
    return {
        "logits": [round(float(v), 5) for v in logits],
        "name": name,
        "state": {
            "cells": env.cells.astype(int).flatten().tolist(),
            "stones": env.stones.astype(int).flatten().tolist(),
            "currentPlayer": int(env.current_player),
            "phase": int(env.phase),
            "remainingK": int(env.remaining_k),
            "lastStonePos": (
                None
                if env.last_stone_pos is None
                else int(env.last_stone_pos[0] * env.N + env.last_stone_pos[1])
            ),
            "thisTurnCells": [int(r * env.N + c) for r, c in env._this_turn_cells],
        },
        "obsChw": [round(float(v), 6) for v in obs_chw.flatten()],
        "legalIdx": np.where(mask)[0].astype(int).tolist(),
        "policy": [round(float(p), 6) for p in probs],
        "value": round(float(value), 6),
        "wdl": [round(float(x), 6) for x in wdl],
    }


def main() -> None:
    _alias_cellmoku_package()
    from cellmoku.env import CellmokuEnv, Phase, Result
    from cellmoku.network import CellmokuNet, load_state_dict_adapting

    ckpt = torch.load(CKPT, map_location="cpu", weights_only=False)
    net = CellmokuNet(
        in_channels=ckpt["in_channels"],
        channels=ckpt["channels"],
        num_blocks=ckpt["num_blocks"],
    )
    load_state_dict_adapting(net, ckpt["net"])
    net.eval()

    fixtures: list[dict] = []

    # position 0: fresh board
    env = CellmokuEnv()
    fixtures.append(snapshot(env, net, "initial"))

    # seeded random games, sampling stone- and cell-phase positions
    for seed in (11, 42):
        rng = np.random.default_rng(seed)
        env = CellmokuEnv()
        ply = 0
        cell_captured = 0
        while env.result == Result.ONGOING and ply < 120:
            if env.phase == Phase.CELL and cell_captured < 3 and ply > 4:
                fixtures.append(snapshot(env, net, f"s{seed}_ply{ply}_cell"))
                cell_captured += 1
            elif env.phase == Phase.STONE and ply in (6, 14, 26, 44):
                fixtures.append(snapshot(env, net, f"s{seed}_ply{ply}_stone"))
            idxs = np.where(env.legal_mask())[0]
            env.step(int(rng.choice(idxs)))
            ply += 1

    # crafted: black has an open four → completion planes must light up
    env = CellmokuEnv()
    for c in range(4, 8):
        env.cells[7, c] = True
        env.stones[7, c] = 1
    env.cells[7, 3] = True
    env.cells[7, 8] = True
    env.current_player = 2  # white to move, facing black's four
    fixtures.append(snapshot(env, net, "crafted_black_four"))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixtures))
    print(f"[golden] {len(fixtures)} fixtures -> {OUT} ({OUT.stat().st_size / 1e3:.0f} KB)")


if __name__ == "__main__":
    main()
