import test from 'node:test';
import assert from 'node:assert/strict';
import {createCardRegistry,isLiveCard,liveCard} from '../src/interaction-cards.js';
import {CARD_TYPES,persistCard,validCard} from '../src/card-types.js';
import {cardShell,chartCardMarkup,unknownCardMarkup} from '../src/card-markup.js';
import {createCardConfirmations} from '../src/card-confirmations.js';
import {dispatchCommand} from '../src/core.js';

test('card position is independent of kind and every later history category freezes it',()=>{
  for(const kind of Object.keys(CARD_TYPES))for(const suffix of ['user','chatResult','imageResult','status','error','card']) {
    const card={id:1,type:'card',kind,version:1,values:{}},messages=[card];
    assert.equal(isLiveCard(messages,1),true);
    messages.push({id:2,type:suffix,kind:'model'});
    assert.equal(isLiveCard(messages,1),false);
    assert.equal(liveCard(messages)?.id,suffix==='card'?2:undefined);
    assert.deepEqual(Object.keys(card),['id','type','kind','version','values']);
  }
});
test('new registered type uses the existing dispatcher; unsupported, stale and malformed commands produce no effects',async()=>{
  let effects=0;
  const registry=createCardRegistry([{kind:'counter',version:1,capture:value=>({...value}),initial:()=>({count:0}),actions:{increment:{validate:args=>Object.keys(args).length===0,run:({card})=>{effects++;card.values.count++;return {ok:true};}}}}]);
  const workspace={messages:[registry.create('counter',1,{})]},context={cardRuntime:{execute:args=>registry.execute(args,{workspace})}};
  await dispatchCommand({command:'card.action',args:{id:1,action:'increment'}},context);
  assert.equal(effects,1);
  for(const args of [{id:1,action:'increment',args:{extra:1}},{id:1,action:'constructor'},{id:1,action:'increment',handler:'execute'},{id:2,action:'increment'}])assert.equal((await dispatchCommand({command:'card.action',args},context)).ok,false);
  workspace.messages.push({id:2,type:'user',text:'later'});
  assert.equal((await dispatchCommand({command:'card.action',args:{id:1,action:'increment'}},context)).reason,'historical-card');
  await assert.rejects(()=>dispatchCommand({command:'card.action',args:{id:1,action:'increment'}}),{code:'CARD_CONTEXT'});
  assert.equal(effects,1);
});
test('asynchronous commit checks identity, position and host lifetime again',async()=>{
  let resume,commits=0,active=true;
  const registry=createCardRegistry([{kind:'async',version:1,actions:{load:{validate:()=>true,run:async({commit})=>{await new Promise(resolve=>resume=resolve);return commit(()=>commits++);}}}}]);
  const card={id:1,type:'card',kind:'async',values:{}},workspace={messages:[card]};
  for(const change of [()=>workspace.messages.push({id:2,type:'status'}),()=>workspace.messages[0]={...card},()=>active=false]) {
    active=true;workspace.messages=[card];const pending=registry.execute({id:1,action:'load'},{workspace,isActive:()=>active});change();resume();assert.equal(await pending,false);
  }
  assert.equal(commits,0);
});
test('confirmation continuations resolve once, cancel on displacement/disposal and cannot be restored from data',async()=>{
  let id=0;const workspace={messages:[]};
  const confirmations=createCardConfirmations({append:(d,values)=>{const card={id:++id,type:'card',kind:'confirmation',version:1,values};d.messages.push(card);return card;},record:(d,approved)=>d.messages.push({id:++id,type:'status',text:String(approved)})});
  const first=confirmations.request(workspace,{text:'once'});assert.equal(confirmations.available(workspace,1),true);
  assert.equal(confirmations.settle(workspace,1,true).ok,true);assert.equal(confirmations.settle(workspace,1,true).ok,false);assert.equal(await first,true);
  const second=confirmations.request(workspace,{text:'displaced'});confirmations.interrupt(workspace);assert.equal(await second,false);
  const third=confirmations.request(workspace,{text:'dispose'});confirmations.dispose();assert.equal(await third,false);
  assert.equal(await confirmations.request(workspace,{text:'after dispose'}),false);
});
test('card projection separates parameters from runtime state and preserves future data without executing it',()=>{
  const api={id:1,type:'card',kind:'api',values:{url:'https://example.com/v1',key:'do-not-save'},active:true,models:[{id:'transient'}]};
  const projected=persistCard(api);assert.equal(projected.version,1);assert.equal(Object.hasOwn(projected.values,'key'),false);assert.equal(Object.hasOwn(projected,'active'),false);assert.equal(Object.hasOwn(projected,'models'),false);
  const future={id:2,type:'card',kind:'future',version:9,values:JSON.parse('{"constructor":"business","apiKey":"ordinary label","text":"<script>alert(1)</script>"}')};
  assert.equal(validCard(future),true);assert.deepEqual(persistCard(future),future);assert.match(unknownCardMarkup(future),/&lt;script&gt;/);
  assert.match(cardShell(future,'data',{live:false}),/fieldset disabled/);
  const chart=chartCardMarkup({id:3,values:{rows:[{label:'unknown',value:null},{label:'zero',value:0}]}});assert.match(chart,/>未知</);assert.match(chart,/>0</);
});
