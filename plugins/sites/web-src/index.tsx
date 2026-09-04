import type { ComponentType } from 'react';
import { registerSitesUi } from './runtime.js';
import { SitesPage } from './SitesPage.js';
import { EnterPage } from './EnterPage.js';
import { SitesProjectPanel } from './SitesProjectPanel.js';
import { EnvironmentsSetup } from './EnvironmentsSetup.js';

registerSitesUi(
  {
    '': SitesPage as ComponentType<never>,
    enter: EnterPage as ComponentType<never>,
  },
  { sites: SitesProjectPanel as ComponentType<never> },
  { 'environment-setup': EnvironmentsSetup },
);
