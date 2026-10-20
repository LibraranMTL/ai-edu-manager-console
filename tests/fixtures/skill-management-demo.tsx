import React from 'react';
import { createRoot } from 'react-dom/client';
import SkillManagementDemo from '../../src/SkillManagementDemo';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SkillManagementDemo />
  </React.StrictMode>,
);
