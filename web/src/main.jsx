import React from 'react';
import { createRoot } from 'react-dom/client';
// Fonts and icons are bundled so the program works without internet access.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@phosphor-icons/web/regular';
import '@phosphor-icons/web/fill';
import './styles.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
