import React from 'react';
import { createRoot } from 'react-dom/client';
import './errorProbe'; // inject runtime error probe first
import { App } from './ui/App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles/theme.css';

createRoot(document.getElementById('root')!).render(
	<ErrorBoundary>
		<App />
	</ErrorBoundary>
);
