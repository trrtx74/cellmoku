import styled from 'styled-components';
import { FaUndo, FaRedo } from 'react-icons/fa';
import { useGameStore, canUndoNow } from '../store/useGameStore';

const Row = styled.div`
  display: flex;
  gap: 12px;
`;

const ControlButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  font-size: 0.95rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  transition: ${({ theme }) => theme.transitions.fast};

  &:hover:not(:disabled) {
    border-color: ${({ theme }) => theme.colors.primary};
    color: ${({ theme }) => theme.colors.primary};
  }
  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
`;

export const GameControls = () => {
  const { language, undo, restart, status } = useGameStore();
  const undoEnabled = useGameStore(canUndoNow);

  if (status !== 'PLAYING') return null;

  const handleRestart = () => {
    const msg = language === 'ko' ? '다시 시작하시겠습니까?' : 'Restart the game?';
    if (window.confirm(msg)) restart();
  };

  return (
    <Row>
      <ControlButton onClick={undo} disabled={!undoEnabled} title="Z">
        <FaUndo size={13} />
        {language === 'ko' ? '되돌리기' : 'Undo'}
      </ControlButton>
      <ControlButton onClick={handleRestart} title="R">
        <FaRedo size={13} />
        {language === 'ko' ? '다시 시작' : 'Restart'}
      </ControlButton>
    </Row>
  );
};
