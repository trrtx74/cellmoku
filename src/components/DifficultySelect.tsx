import styled from 'styled-components';
import { useGameStore, type Difficulty } from '../store/useGameStore';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
  gap: 28px;
  padding: 20px;
`;

const Heading = styled.h2`
  color: ${({ theme }) => theme.colors.secondary};
  font-size: 1.6rem;
`;

const ButtonGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 300px;
`;

const DiffButton = styled.button`
  padding: 18px;
  font-size: 1.3rem;
  font-weight: 700;
  background: ${({ theme }) => theme.colors.surface};
  border: 1.5px solid ${({ theme }) => theme.colors.primary};
  color: ${({ theme }) => theme.colors.primary};
  border-radius: 16px;
  transition: ${({ theme }) => theme.transitions.fast};
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.1);

  &:hover {
    background: ${({ theme }) => theme.colors.primary};
    color: #fff;
    transform: translateY(-2px);
  }
`;

const BackButton = styled.button`
  color: ${({ theme }) => theme.colors.textSecondary};
  background: transparent;
  font-size: 0.95rem;
  text-decoration: underline;
`;

const LABELS: Record<Difficulty, { ko: string; en: string }> = {
  easy: { ko: '하수', en: 'Easy' },
  medium: { ko: '중수', en: 'Medium' },
  hard: { ko: '고수', en: 'Hard' },
};

export const DifficultySelect = () => {
  const { language, chooseDifficulty, quitGame } = useGameStore();

  return (
    <Container>
      <Heading>{language === 'ko' ? '난이도 선택' : 'Select Difficulty'}</Heading>
      <ButtonGroup>
        {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
          <DiffButton key={d} onClick={() => chooseDifficulty(d)}>
            {LABELS[d][language]}
          </DiffButton>
        ))}
      </ButtonGroup>
      <BackButton onClick={quitGame}>
        {language === 'ko' ? '← 메뉴로' : '← Back to menu'}
      </BackButton>
    </Container>
  );
};
