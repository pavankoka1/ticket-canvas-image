import { createRoot } from 'react-dom/client';

import { Catalog } from './catalog/Catalog';
import './index.css';

// No StrictMode — double-mount was stacking SnapDOM sheet captures during atlas warm.
createRoot(document.getElementById('root')!).render(<Catalog />);
