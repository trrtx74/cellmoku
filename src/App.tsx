import styled from 'styled-components';
import { useState } from 'react';
import { ThemeProvider } from 'styled-components';
import { GlobalStyle } from './styles/GlobalStyle';
import { theme } from './styles/theme';
import GameBoard from './components/GameBoard';
import { Navbar } from './components/Navbar';
import { StartScreen } from './components/StartScreen';
import { HelpModal } from './components/HelpModal';
import { useGameStore } from './store/useGameStore';

const Container = styled.div`
  width: 100vw;
  height: 100vh;
`;

const ContentsWrapper = styled.div`
  width: 100%;
  height: calc(100vh - 60px); /* old browser fallback */
  height: calc(100dvh - 60px);

  display: flex;
  flex-direction: column;
  align-items: center;

  @media (max-width: 768px) {
    height: calc(100vh - 48px);
    height: calc(100dvh - 48px);
  }
`;

function App() {
  const { status, language } = useGameStore();
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  return (
    <ThemeProvider theme={theme}>
      <GlobalStyle theme={theme} />
      <Container>
        <Navbar onOpenHelp={() => setIsHelpOpen(true)} />
        <ContentsWrapper>
          {status === 'IDLE' ? <StartScreen /> : <GameBoard />}
        </ContentsWrapper>
        <HelpModal
          isOpen={isHelpOpen}
          onClose={() => setIsHelpOpen(false)}
          language={language}
        />
      </Container>
    </ThemeProvider>
  );
}

export default App;
