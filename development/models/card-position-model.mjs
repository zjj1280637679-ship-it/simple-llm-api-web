import assert from 'node:assert/strict';
import {isLiveCard,createCardRegistry} from '../../src/interaction-cards.js';

/** Exhaust the declared six-symbol history abstraction at lengths 0..4.
 * This checks production functions against an index oracle, not arbitrary DOM,
 * all JS objects, unlimited lengths, or the truth of external effects.
 */
export function checkCardPositionModel() {
  const alphabet=['api','model','user','chatResult','status','error'];
  let histories=0,queries=0,admissions=0;
  const registry=createCardRegistry(['api','model'].map(kind=>({kind,version:1,actions:{touch:{validate:args=>!Object.keys(args).length,run:()=>({ok:true})}}})));
  function visit(symbols) {
    histories++;
    const messages=symbols.map((symbol,index)=>({id:index+1,type:['api','model'].includes(symbol)?'card':symbol,kind:symbol,values:{}}));
    let liveCount=0;
    for(let index=0;index<=messages.length;index++) {
      const id=index+1,expected=index===messages.length-1&&['api','model'].includes(symbols[index]);queries++;
      assert.equal(isLiveCard(messages,id),expected);
      assert.equal(registry.execute({id,action:'touch',args:{}},{workspace:{messages}}).ok,expected);
      if(expected){liveCount++;admissions++;}
    }
    assert.ok(liveCount<=1);
    if(symbols.length<4)for(const symbol of alphabet)visit([...symbols,symbol]);
  }
  visit([]);
  return {status:'PASS',histories,queries,admissions,alphabet,maxLength:4,
    scope:'Finite representative histories; tail/index equivalence and registry admission. No proof of arbitrary histories, DOM or asynchronous external effects.'};
}
