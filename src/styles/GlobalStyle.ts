import { createGlobalStyle } from 'styled-components';
import type { Theme } from './theme';

export const GlobalStyle = createGlobalStyle<{ theme: Theme }>`
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: 'Roboto', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    background-color: ${({ theme }) => theme.colors.background};
    color: ${({ theme }) => theme.colors.text};
    overflow: hidden; /* Prevent scrolling for game app feel */
    width: 100vw;
    height: 100vh;
  }

  button {
    font-family: inherit;
    cursor: pointer;
    border: none;
    outline: none;
  }

  #root {
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
  }
`;
