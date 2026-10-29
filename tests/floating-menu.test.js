import {uiSource} from './support/ui-sources.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasGeometry} from '../src/canvas-geometry.js';
import {readFile} from 'node:fs/promises';
const source=uiSource;
const context=createCanvasGeometry({});
for(const [name,anchor,height,viewport] of [
 ['above normal input',{top:650,bottom:688},120,{top:0,height:800}],
 ['long matrix on short screen',{top:260,bottom:298},2000,{top:0,height:400}],
 ['anchor near top',{top:20,bottom:58},300,{top:0,height:400}],
 ['scrolled offscreen anchor',{top:1800,bottom:1840},2000,{top:0,height:400}],
 ['visual viewport offset',{top:260,bottom:298},600,{top:100,height:300}]
])test(`menu geometry stays inside viewport: ${name}`,()=>{
 const b=context.floatingMenuBounds(anchor,height,viewport,viewport.top+8);
 assert.ok(b.top>=viewport.top+8);assert.ok(b.top+Math.min(height,b.maxHeight)<=viewport.top+viewport.height-8);
 assert.ok(b.maxHeight>0);
});
test('menus leave measured composer and support native top layer with portal fallback',()=>{
 assert.match(source,/app\.append\(menu\)/);
 assert.match(source,/typeof menu\.showPopover === 'function'/);
 assert.match(source,/menu\.setAttribute\('popover', 'manual'\)/);
 assert.match(source,/dismissFloatingMenu\(true\)/);
 assert.match(source,/floatingMenuObserver\?\.disconnect\(\)/);
 const render=source.slice(source.indexOf('function render(scrollEnd'));
 assert.ok(render.indexOf('mountFloatingMenu();')<render.indexOf('syncFloatingNavigation();'));
});

test('settings menus prefer below the complete input row and use bounded fallback',()=>{
 const below=context.settingsMenuBounds({top:100,bottom:160},300,{top:0,height:800},80);
 assert.equal(below.top,168);assert.ok(below.maxHeight>=300);
 const above=context.settingsMenuBounds({top:700,bottom:760},300,{top:0,height:800},80);
 assert.ok(above.top+300<700);
 assert.match(source,/anchor.closest\('\.fieldrow'\)/);
 assert.match(source,/settings \? rect.width/);
 assert.match(source,/data-floating-menu="supplier" data-menu-card/);
 assert.match(source,/data-floating-menu="pull-models" data-menu-card/);
});

test('supplier format field uses the same full-row popup with explicit accessible keyboard contract',()=>{
 assert.match(source,/data-floating-menu="supplier" data-menu-card/);
 assert.match(source,/aria-haspopup="listbox"/);
 assert.match(source,/\['ArrowDown','ArrowUp','Home','End'\]/);
 assert.match(source,/choices\[next\]\?\.focus/);
 assert.match(source,/dismissFloatingMenu\(true\)/);
 assert.doesNotMatch(source,/protocol-reading/);
});
