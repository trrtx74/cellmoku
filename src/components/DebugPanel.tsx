import { useState } from 'react';
import styled from 'styled-components';
import { useGameStore } from '../store/useGameStore';
import type { AgentConfig } from '../services/agent/types';

const Panel = styled.div<{ $open: boolean }>`
  position: fixed;
  bottom: 12px;
  right: 12px;
  z-index: 500;
  width: ${({ $open }) => ($open ? '260px' : 'auto')};
  background: rgba(16, 24, 40, 0.92);
  color: #e6eefc;
  border: 1px solid #2b4468;
  border-radius: 12px;
  font-size: 0.78rem;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  overflow: hidden;
`;

const Header = styled.button`
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: transparent;
  color: #9dc0ff;
  font-weight: 700;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
`;

const Body = styled.div`
  padding: 6px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Field = styled.label`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  span {
    color: #a9bcd8;
  }
  input[type='number'] {
    width: 72px;
    background: #0e1830;
    border: 1px solid #2b4468;
    color: #e6eefc;
    border-radius: 6px;
    padding: 3px 6px;
    font-size: 0.78rem;
  }
  input[type='range'] {
    width: 110px;
  }
`;

const Row = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 4px;
`;

const SmallButton = styled.button`
  flex: 1;
  padding: 6px;
  background: #1b2c4c;
  color: #cfe0ff;
  border: 1px solid #2b4468;
  border-radius: 6px;
  font-size: 0.75rem;
  &:hover { background: #24457a; }
`;

const Meta = styled.div`
  color: #7f97ba;
  font-size: 0.72rem;
  display: flex;
  justify-content: space-between;
`;

const numField = (
  key: keyof AgentConfig,
  label: string,
  cfg: AgentConfig,
  set: (patch: Partial<AgentConfig>) => void,
  step = 1,
) => (
  <Field key={key}>
    <span>{label}</span>
    <input
      type="number"
      step={step}
      value={cfg[key] as number}
      onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<AgentConfig>)}
    />
  </Field>
);

export const DebugPanel = () => {
  const { agentConfig, setAgentConfig, resetAgentConfig, cpuDifficulty, lastCpuMs, mode } =
    useGameStore();
  const [open, setOpen] = useState(true);

  return (
    <Panel $open={open}>
      <Header onClick={() => setOpen((o) => !o)}>
        <span>⚙ AGENT DEBUG</span>
        <span>{open ? '▾' : '▸'}</span>
      </Header>
      {open && (
        <Body>
          <Meta>
            <span>difficulty: {cpuDifficulty}</span>
            <span>{mode === 'VS_CPU' ? 'vs cpu' : 'vs human'}</span>
          </Meta>

          {numField('sims', 'sims', agentConfig, setAgentConfig)}
          {numField('cellSims', 'cellSims', agentConfig, setAgentConfig)}
          <Field>
            <span>temp {agentConfig.temperature.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={agentConfig.temperature}
              onChange={(e) => setAgentConfig({ temperature: Number(e.target.value) })}
            />
          </Field>
          {numField('tempMoves', 'tempMoves', agentConfig, setAgentConfig)}
          {numField('vcfMaxPly', 'vcfMaxPly', agentConfig, setAgentConfig)}
          <Field>
            <span>useVcf</span>
            <input
              type="checkbox"
              checked={agentConfig.useVcf}
              onChange={(e) => setAgentConfig({ useVcf: e.target.checked })}
            />
          </Field>

          <Meta>
            <span>last move</span>
            <span>{lastCpuMs != null ? `${lastCpuMs} ms` : '—'}</span>
          </Meta>

          <Row>
            <SmallButton onClick={resetAgentConfig}>
              reset → {cpuDifficulty} preset
            </SmallButton>
          </Row>
          <Meta>
            <span style={{ fontStyle: 'italic' }}>onnx engine · mock fallback uses temp only</span>
          </Meta>
        </Body>
      )}
    </Panel>
  );
};
