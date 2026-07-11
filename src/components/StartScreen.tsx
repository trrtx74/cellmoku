import styled from 'styled-components';
import { useGameStore } from '../store/useGameStore';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  width: 100%;
  gap: 20px;
  position: relative;
  z-index: 10;
`;

const LogoTop = styled.div`
  font-size: 4rem;
  font-weight: bold;
  background-image: linear-gradient(to bottom right, #ff50d6, #f3bae6); /* 선형 그라데이션 */
  -webkit-background-clip: text; /* WebKit 브라우저용 */
  background-clip: text;
  color: transparent; /* 텍스트 색상을 투명하게 */
  display: inline-block; /* 그라데이션이 텍스트 너비에 맞게 적용되도록 */
  /* color: ${({ theme }) => theme.colors.primary}; */
  /* text-shadow: 0 0 20px ${({ theme }) => theme.colors.primary}; */
  text-align: center;
  line-height: 1.0;
`;

const LogoBottom = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  span {
    font-size: 2.5rem;
    font-weight: bold;
    color: #6b5700;
    text-shadow: 10px 5px 20px ${({ theme }) => theme.colors.jelly},
      10px -5px 20px ${({ theme }) => theme.colors.jelly},
      -10px -5px 20px ${({ theme }) => theme.colors.jelly},
      -10px 5px 20px ${({ theme }) => theme.colors.jelly};
    display: block;
  }
`;

const RulesCard = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;

  p {
    font-size: 0.9rem;
    color: ${({ theme }) => theme.colors.textSecondary};
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
  max-width: 300px;
`;

const MenuButton = styled.button`
  padding: 20px;
  font-size: 1.5rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.colors.text};
  border-radius: 16px;
  backdrop-filter: blur(5px);
  font-weight: bold;
  transition: ${({ theme }) => theme.transitions.fast};

  &:hover {
    background: ${({ theme }) => theme.colors.primary};
    transform: scale(1.05);
  }
`;

export const StartScreen = () => {
  const { startGame, language } = useGameStore();

  const rulesCard = <RulesCard>
    <p>
      {language === 'ko'
        ? '상자에서 젤리를 뽑으세요.'
        : 'Draw jellies from the box.'}
    </p>
    <p>
      {language === 'ko'
        ? '많이 뽑을수록 점수를 더 많이 획득합니다.'
        : 'The more you draw, the more points you get.'}
    </p>
    <p>
      {language === 'ko'
        ? '하지만 조심하세요! 총알이 뽑히면 점수를 잃습니다.'
        : 'But be careful! If bullets are drawn, you lose points.'}
    </p>
  </RulesCard>

  return (
    <Container>

      <div>
        <LogoTop>
          RUSSIAN
        </LogoTop>
        <LogoBottom>
          JELLY
        </LogoBottom>
      </div>

      {rulesCard}

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
