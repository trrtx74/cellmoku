import styled from 'styled-components';
import { useGameStore, type Difficulty } from '../store/useGameStore';
import { FaHome, FaGlobe, FaQuestion, FaTrophy } from "react-icons/fa";
import { useState } from 'react';

interface NavbarProps {
  onOpenHelp: () => void;
}

const NavContainer = styled.nav`
  width: 100%;
  height: 60px;
  background-color: ${({ theme }) => theme.colors.background};
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 20px;
  top: 0;
  left: 0;
  z-index: 100;
  box-shadow: 0 2px 6px ${({ theme }) => theme.colors.border};

  @media (max-width: 768px) {
    height: 48px;
    padding: 5px 10px;
  }
`;

const Title = styled.h1`
  font-size: 2rem;
  background-image: ${({ theme }) => theme.gradients.logo};
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  margin: 0;
  letter-spacing: 0.02em;

  @media (max-width: 768px) {
    font-size: 1.2rem;
  }
`;

const NavActions = styled.div`
  position: relative;
  display: flex;
  gap: 10px;

  @media (max-width: 768px) {
    gap: 5px;
  }
`;

const NavButton = styled.button`
  height: 32px;
  background: transparent;
  color: ${({ theme }) => theme.colors.text};

  display: flex;
  justify-content: center;
  align-items: center;
  border: 1px solid ${({ theme }) => theme.colors.border};
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 0.8rem;
  transition: ${({ theme }) => theme.transitions.fast};

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.primaryLight};
    border-color: ${({ theme }) => theme.colors.primary};
  }

  &:active:not(:disabled) {
    transform: translateY(2px);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }

  @media (max-width: 768px) {
    height: 36px;
  }
`;

const ResetButton = styled(NavButton)`
  margin-top: 5px;
  margin-left: auto;
`;

const StatsContainer = styled.div`
  position: absolute;
  top: 100%;
  right: 36px;

  padding: 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 16px;

  z-index: 100;

  background-color: ${({ theme }) => theme.colors.surface};
  box-shadow: 0 6px 20px rgba(22, 33, 58, 0.12);

  h4 {
    margin-bottom: 8px;
  }
  p {
    margin: 6px 0;
    color: ${({ theme }) => theme.colors.textSecondary};
  }
`

const StatsTable = styled.table`
  border-collapse: collapse;
  font-size: 0.8rem;
  white-space: nowrap;

  th, td {
    padding: 4px 10px;
    text-align: center;
  }
  th {
    color: ${({ theme }) => theme.colors.textSecondary};
    font-weight: 600;
    font-size: 0.72rem;
  }
  td:first-child, th:first-child {
    text-align: left;
    font-weight: 600;
  }
  tbody tr:not(:last-child) td {
    border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  }
`

const DIFFS: Difficulty[] = ['easy', 'medium', 'hard'];
const DIFF_LABEL: Record<Difficulty, { ko: string; en: string }> = {
  easy: { ko: '하수', en: 'Easy' },
  medium: { ko: '중수', en: 'Medium' },
  hard: { ko: '고수', en: 'Hard' },
};

export const Navbar = ({ onOpenHelp }: NavbarProps) => {
  const {
    language, setLanguage, status, quitGame, vsCpuStats, resetStats, mode,
    cpuDifficulty, humanColor,
  } = useGameStore();
  const [isStatsOpen, setIsStatsOpen] = useState(false);

  const toggleLanguage = () => setLanguage(language === 'ko' ? 'en' : 'ko');

  const handleBackToMenu = () => {
    if (status === 'PLAYING') {
      const message = language === 'ko'
        ? '정말 나가시겠습니까?' + (mode === 'VS_CPU' ? ' 패배로 기록됩니다.' : '')
        : 'Are you sure you want to quit?' + (mode === 'VS_CPU' ? ' It will be recorded as a loss.' : '');
      if (window.confirm(message)) quitGame();
    } else {
      quitGame();
    }
  };

  const handleResetStats = () => {
    if (window.confirm(language === 'ko' ? '전적을 초기화하시겠습니까?' : 'Reset all stats?')) {
      resetStats();
    }
  };

  // W/L/D for a difficulty+side, discounting the in-progress game (pre-counted as a loss).
  const sideWLD = (d: Difficulty, key: 'asFirst' | 'asSecond') => {
    const s = vsCpuStats[d][key];
    const inProgress =
      status === 'PLAYING' && mode === 'VS_CPU' && cpuDifficulty === d &&
      (humanColor === 'BLACK' ? 'asFirst' : 'asSecond') === key;
    const played = s.played - (inProgress ? 1 : 0);
    return { w: s.wins, l: Math.max(0, played - s.wins - s.draws), d: s.draws };
  };

  return (
    <NavContainer>
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        <Title>CELLMOKU</Title>
      </div>

      <NavActions>
        <NavButton onClick={handleBackToMenu} disabled={status === 'IDLE'}>
          <FaHome size={16} />
        </NavButton>
        <NavButton onClick={onOpenHelp}>
          <FaQuestion size={16} />
        </NavButton>
        <NavButton onClick={() => setIsStatsOpen(!isStatsOpen)} onBlur={() => setIsStatsOpen(false)}>
          <FaTrophy size={16} />
        </NavButton>
        {isStatsOpen && (
          <StatsContainer onMouseDown={(e) => e.preventDefault()}>
            <h4>{language === 'ko' ? 'CPU 전적' : 'VS CPU'}</h4>
            <StatsTable>
              <thead>
                <tr>
                  <th />
                  <th>{language === 'ko' ? '선공(흑)' : 'First (B)'}</th>
                  <th>{language === 'ko' ? '후공(백)' : 'Second (W)'}</th>
                </tr>
              </thead>
              <tbody>
                {DIFFS.map((d) => {
                  const f = sideWLD(d, 'asFirst');
                  const s = sideWLD(d, 'asSecond');
                  return (
                    <tr key={d}>
                      <td>{DIFF_LABEL[d][language]}</td>
                      <td>{`${f.w}/${f.l}/${f.d}`}</td>
                      <td>{`${s.w}/${s.l}/${s.d}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </StatsTable>
            <p style={{ fontStyle: 'italic', fontSize: '0.75rem' }}>
              {language === 'ko' ? '승 / 패 / 무' : 'Win / Loss / Draw'}
            </p>
            <ResetButton onClick={handleResetStats}>
              {language === 'ko' ? '초기화' : 'Reset'}
            </ResetButton>
          </StatsContainer>
        )}
        <NavButton onClick={toggleLanguage}>
          <FaGlobe size={16} />
        </NavButton>
      </NavActions>
    </NavContainer>
  );
};
