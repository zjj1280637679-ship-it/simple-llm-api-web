// Legacy static policy/markup checks only. Behavior tests import actual modules.
import {readFile} from 'node:fs/promises';
export const uiSource=(await Promise.all(['workbench','canvas-geometry','view-position','request-lifecycle','view-markup','stream-painter','workspace-storage','clipboard-report'].map(name=>readFile(new URL(`../../src/${name}.js`,import.meta.url),'utf8')))).join('\n');
