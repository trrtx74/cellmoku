export const theme = {
  colors: {
    background: '#F5F8FC', // cool near-white
    surface: '#FFFFFF', // cards / panels / modal
    primary: '#2563EB', // AlphaGo blue
    primaryHover: '#1D4ED8',
    primaryLight: '#DBEAFE', // light blue tint (highlights, hover fills)
    secondary: '#1E3A5F', // deep navy accent
    text: '#16213A',
    textSecondary: '#5A6678',
    border: '#CBD8E8', // blue-grey borders / grid lines

    boardGrid: '#f2f5fa', // faint 15x15 lattice
    cell: '#E7EEF7', // existing cell fill
    cellInitial: '#DCE6F2', // initial (pre-placed) cell fill
    stoneBlack: '#1B2333', // first player (black)
    stoneWhite: '#FBFCFE', // second player (white)
    stoneWhiteBorder: '#9DB0C8',

    success: '#16A34A',
    error: '#DC2626',
  },
  gradients: {
    logo: 'linear-gradient(135deg, #1D4ED8 0%, #3B82F6 55%, #60A5FA 100%)',
  },
  borderRadius: '16px',
  transitions: {
    default: '0.3s ease',
    fast: '0.1s ease',
  },
};

export type Theme = typeof theme;
