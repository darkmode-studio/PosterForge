// PosterForge 2.3.2: redesigned layer list + batch carousel export. Loaded after v23/main.js.
import { render } from './layerPanel.js';
import './batchExport.js';
const PF = window.PF;
const start = () => { render(document.getElementById('layerList'), PF.canvas, { onChange: () => PF.scheduleAutosave && PF.scheduleAutosave() }); PF.refreshLayers(); };
if (document.getElementById('layerList')) start(); else addEventListener('DOMContentLoaded', start);
