export const theme = {
  colors: {
    background: '#FAF9F5', // Deep dark blue/black
    primary: '#f559d0', // Hot Pink
    primaryHover: 'rgba(247, 120, 183, 1)',
    secondary: '#4F451A', // Cyan/Sky blue for contrast
    text: '#141413',
    textSecondary: '#282826',
    jelly: '#FFFFAA', // Gold/Yellow for Jelly
    bullet: '#000000', // Black for Bullet
    success: '#27df2dff',
    error: '#e9554bff',
  },
  borderRadius: '16px',
  transitions: {
    default: '0.3s ease',
    fast: '0.1s ease',
  },
};

export type Theme = typeof theme;
