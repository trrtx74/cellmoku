import { useEffect } from 'react';
import styled from 'styled-components';
import { useGameStore } from '../store/useGameStore';

// Layout Components
const BoardContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(600px, 100vw);
  height: 100%;
  padding: 20px;
  gap: 20px;
  position: relative;
`;

const PlayerSectionContainer = styled.div`
  display: flex;
  flex-direction: row;
  width: 100%;
  gap: 10px;
`;

// const PlayerSection = styled.div<{ $isCurrentTurn: boolean }>`
//   flex: 1;
//   display: flex;
//   flex-direction: column;
//   align-items: center;
//   justify-content: flex-start;
//   padding: 20px;
//   border-radius: ${({ theme }) => theme.borderRadius};
//   background: ${({ $isCurrentTurn }) =>
//     $isCurrentTurn ? 'rgba(255, 255, 255, 0.05)' : 'transparent'};
//   transition: ${({ theme }) => theme.transitions.default};
//   border: 2px solid ${({ theme, $isCurrentTurn }) => ($isCurrentTurn ? theme.colors.primary : 'transparent')};
// `;

// const ScoreDisplay = styled.h2`
//   font-size: 2rem;
//   color: ${({ theme }) => theme.colors.text};
// `;

const CounterContainer = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
`;

const ResultContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`;

const ResultButton = styled.button`
  margin-top: 20px;
  padding: 15px 30px;
  font-size: 1.5rem;
  background: #4caf50;
  color: white;
  border-radius: 12px;
  border: none;
`;

const GameBoard = () => {
  // const {
  //   language,
  //   status,
  //   startGame,
  //   mode,
  // } = useGameStore();

  return (
    <BoardContainer>
      THIS IS BOARD
    </BoardContainer>
  );
};

export default GameBoard;
