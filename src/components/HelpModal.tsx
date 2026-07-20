import styled from 'styled-components';
import { FaTimes } from "react-icons/fa";

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: 'ko' | 'en';
}

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh; /* old browser fallback */
  height: 100dvh;
  background: rgba(16, 24, 40, 0.55);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 200;
  backdrop-filter: blur(5px);
`;

const ModalContainer = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 16px;
  padding: 16px;
  max-width: 640px;
  width: 90%;
  max-height: 90%;
  box-shadow: 0 20px 50px rgba(16, 24, 40, 0.3);

  @media (max-width: 768px) {
    max-height: 82%;
  }
`;

const Title = styled.h2`
  color: ${({ theme }) => theme.colors.primary};
  margin-bottom: 16px;
  text-align: center;
`;

const Content = styled.div`
  color: ${({ theme }) => theme.colors.text};
  padding: 4px 10px 10px;
  line-height: 1.65;
  font-size: 0.95rem;
  overflow-y: auto;

  h3 {
    color: ${({ theme }) => theme.colors.secondary};
    margin: 16px 0 6px;
  }

  ul {
    padding-left: 20px;
  }

  li {
    margin-bottom: 6px;
  }

  strong {
    color: ${({ theme }) => theme.colors.primary};
  }
`;

const CloseButton = styled.button`
  position: absolute;
  display: flex;
  justify-content: center;
  align-items: center;
  top: 12px;
  right: 12px;
  width: 40px;
  height: 40px;
  background: ${({ theme }) => theme.colors.primary};
  color: white;
  border-radius: 8px;

  &:hover {
    background: ${({ theme }) => theme.colors.primaryHover};
  }
`;

export const HelpModal = ({ isOpen, onClose, language }: HelpModalProps) => {
  if (!isOpen) return null;

  return (
    <Overlay onClick={onClose}>
      <ModalContainer onClick={(e) => e.stopPropagation()}>
        <Title>{language === 'ko' ? '게임 규칙' : 'Game Rules'}</Title>
        <CloseButton onClick={onClose}>
          <FaTimes size={20} />
        </CloseButton>
        <Content>
          {language === 'ko' ? (
            <>
              <p>
                <strong>Cellmoku(개척 오목)</strong>는 보드가 점점 넓어지는 변형 오목입니다.
                말을 놓을 뿐 아니라, 획득한 칸으로 보드를 직접 확장하며 5목을 노립니다.
              </p>

              <h3>시작</h3>
              <ul>
                <li>가운데가 비어 있는 3×3 칸(총 8칸)에서 시작합니다.</li>
                <li>선공은 <strong>흑</strong>, 후공은 <strong>백</strong>입니다.</li>
              </ul>

              <h3>턴 진행</h3>
              <ul>
                <li><strong>말 배치:</strong> 비어 있는 칸 위에 자신의 말을 놓습니다.</li>
                <li><strong>칸 획득:</strong> 방금 둔 말에 인접한(대각선 포함 8방향) 자신의 말 수만큼 새 칸을 획득합니다.</li>
                <li><strong>칸 배치:</strong> 획득한 칸을 기존 칸에 변이 맞닿게 이어 붙입니다. 이번 턴에 놓은 칸에 이어서 놓을 수도 있습니다. 획득한 칸은 그 턴에 모두 배치합니다.</li>
              </ul>

              <h3>승리</h3>
              <ul>
                <li>가로·세로·대각선 중 한 방향으로 자신의 말 <strong>5개</strong>를 먼저 잇는 사람이 승리합니다. (6개 이상도 승리)</li>
                <li>승패는 말을 두는 즉시 판정합니다. 칸 배치는 승패에 직접 관여하지 않습니다.</li>
                <li>말을 놓을 빈 칸이 하나도 없어지면 무승부입니다.</li>
              </ul>

              <h3>조작</h3>
              <ul>
                <li><strong>마우스:</strong> 올린 위치로 커서가 이동하고, 클릭하면 배치됩니다.</li>
                <li><strong>터치:</strong> 한 번 누르면 커서 이동, 같은 곳을 다시 누르면 배치됩니다.</li>
                <li><strong>키보드:</strong> 방향키/WASD로 이동, Enter·Space로 배치, R 다시 시작, Z 되돌리기.</li>
              </ul>
            </>
          ) : (
            <>
              <p>
                <strong>Cellmoku</strong> is a gomoku variant on a board that keeps
                growing. You not only place stones but also expand the board with the
                cells you earn, racing to connect five.
              </p>

              <h3>Start</h3>
              <ul>
                <li>Begins with a 3×3 ring of cells (8 cells) around an empty center.</li>
                <li>The first player is <strong>Black</strong>, the second is <strong>White</strong>.</li>
              </ul>

              <h3>Each turn</h3>
              <ul>
                <li><strong>Place a stone</strong> on any empty cell.</li>
                <li><strong>Earn cells</strong> equal to the number of your own stones in the 8 neighbours of the stone just placed.</li>
                <li><strong>Place the cells</strong> edge-adjacent to existing cells (including cells placed this turn). All earned cells must be placed that turn.</li>
              </ul>

              <h3>Winning</h3>
              <ul>
                <li>Connect <strong>five</strong> of your stones in a row — horizontal, vertical, or diagonal (six or more also wins).</li>
                <li>The result is decided the moment a stone is placed; cell placement never triggers a win.</li>
                <li>If no empty cell remains to place a stone, the game is a draw.</li>
              </ul>

              <h3>Controls</h3>
              <ul>
                <li><strong>Mouse:</strong> hover to move the cursor, click to place.</li>
                <li><strong>Touch:</strong> tap once to move the cursor, tap again to place.</li>
                <li><strong>Keyboard:</strong> arrows/WASD to move, Enter/Space to place, R to restart, Z to undo.</li>
              </ul>
            </>
          )}
        </Content>
      </ModalContainer>
    </Overlay>
  );
};
