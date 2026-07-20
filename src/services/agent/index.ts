import { MockAgent } from './mockAgent';
import type { WorkerRequest, WorkerResponse } from './engine.worker';
import type { AgentConfig, AgentMove, CellmokuAgent } from './types';
import type { GameState } from '../../game/types';
import type { Difficulty } from '../../store/useGameStore';

/**
 * Main-thread handle on the agent worker (which owns ONNX + MCTS + VCF).
 * If the worker or the model fails to come up, we fall back to the heuristic
 * mock so the game stays playable instead of dead-ending.
 */
class WorkerAgent implements CellmokuAgent {
  ready: Promise<void>;

  private worker: Worker | null = null;
  private fallback: MockAgent;
  private usingFallback = false;
  private pending = new Map<
    number,
    { resolve: (m: AgentMove) => void; reject: (e: Error) => void }
  >();
  private nextId = 1;

  constructor(difficulty: Difficulty) {
    this.fallback = new MockAgent(difficulty);

    this.ready = new Promise<void>((resolve) => {
      const degrade = (reason: unknown) => {
        console.warn('[agent] ONNX engine unavailable — falling back to mock:', reason);
        this.usingFallback = true;
        resolve(); // the mock is ready by construction
      };

      let worker: Worker;
      try {
        worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
          type: 'module',
        });
      } catch (err) {
        degrade(err);
        return;
      }
      this.worker = worker;

      worker.onerror = (e) => degrade(e.message || e);
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        switch (msg.type) {
          case 'ready':
            resolve();
            break;
          case 'initError':
            degrade(msg.message);
            break;
          case 'move': {
            this.pending.get(msg.id)?.resolve(msg.move);
            this.pending.delete(msg.id);
            break;
          }
          case 'moveError': {
            this.pending.get(msg.id)?.reject(new Error(msg.message));
            this.pending.delete(msg.id);
            break;
          }
        }
      };

      this.send({ type: 'init' });
    });
  }

  private send(msg: WorkerRequest) {
    this.worker?.postMessage(msg);
  }

  async getMove(state: GameState, config: AgentConfig): Promise<AgentMove> {
    await this.ready;
    if (this.usingFallback || !this.worker) {
      return this.fallback.getMove(state, config);
    }
    const id = this.nextId++;
    return new Promise<AgentMove>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ type: 'move', id, state, config });
    });
  }
}

/**
 * The single switch point for the CPU engine. Starts the worker and the model
 * download immediately — call it as soon as a CPU game begins so loading
 * overlaps the human's first think.
 */
export function loadAgent(difficulty: Difficulty): CellmokuAgent {
  return new WorkerAgent(difficulty);
}

export type { CellmokuAgent, AgentMove, AgentConfig } from './types';
export { PRESETS, presetFor } from './types';
