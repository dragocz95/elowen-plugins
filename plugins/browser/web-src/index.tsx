import './browser.css';
import { BrowserAccount } from './BrowserAccount';
import { BrowserArtifact } from './BrowserArtifact';
import { BrowserSettings } from './BrowserSettings';
import { registerBrowserUi } from './runtime';

registerBrowserUi(BrowserArtifact, BrowserSettings, BrowserAccount);
