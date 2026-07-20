import styled from 'styled-components';
import { useGameStore } from '../store/useGameStore';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  width: 100%;
  gap: 28px;
  position: relative;
  z-index: 10;
  padding: 20px;
`;

const Logo = styled.div`
  font-size: 4.5rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  background-image: ${({ theme }) => theme.gradients.logo};
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-align: center;
  line-height: 1;

  @media (max-width: 768px) {
    font-size: 3rem;
  }
`;

const Tagline = styled.div`
  font-size: 1rem;
  color: ${({ theme }) => theme.colors.secondary};
  font-weight: 600;
  letter-spacing: 0.02em;
`;

const RulesCard = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  gap: 2px;

  p {
    font-size: 0.9rem;
    color: ${({ theme }) => theme.colors.textSecondary};
    text-align: center;
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 300px;
`;

const MenuButton = styled.button`
  padding: 18px;
  font-size: 1.4rem;
  background: ${({ theme }) => theme.colors.surface};
  border: 1.5px solid ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.colors.primary};
  border-radius: 16px;
  font-weight: 700;
  transition: ${({ theme }) => theme.transitions.fast};
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.12);

  &:hover {
    background: ${({ theme }) => theme.colors.primary};
    color: #fff;
    transform: translateY(-2px);
  }

  &:active {
    transform: translateY(0);
  }
`;

export const StartScreen = () => {
  const { startGame, language } = useGameStore();

  return (
    <Container>
      <div>
        <Logo>CELLMOKU</Logo>
        <Tagline>{language === 'ko' ? '개척 오목' : 'Frontier Gomoku'}</Tagline>
      </div>

      <RulesCard>
        <p>
          {language === 'ko'
            ? '말을 놓고, 획득한 칸으로 보드를 넓혀 나가세요.'
            : 'Place stones and expand the board with the cells you earn.'}
        </p>
        <p>
          {language === 'ko'
            ? '먼저 5개를 나란히 잇는 사람이 승리합니다.'
            : 'The first to connect five in a row wins.'}
        </p>
      </RulesCard>

      <ButtonGroup>
        <MenuButton onClick={() => startGame('VS_CPU')}>
          {language === 'ko' ? 'CPU와 대결' : 'VS CPU'}
        </MenuButton>
        <MenuButton onClick={() => startGame('VS_HUMAN')}>
          {language === 'ko' ? '2인 대결' : '2 Players'}
        </MenuButton>
      </ButtonGroup>
    </Container>
  );
};
