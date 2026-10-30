import assert from 'node:assert/strict';
import {observeCompletion} from '../../src/completion-evidence.js';
import {decideCompletion} from '../../src/completion-policy.js';

/** Exhaustive representative classes, not a proof of the parser/JS engine/provider.
 * Trust gap: the source's equality/type partitions must refine these classes.
 */
export function checkCompletionModel() {
  const accepted={gemini:['STOP'],openai:['stop','tool_calls','function_call'],ark:['stop','tool_calls','function_call'],anthropic:['end_turn','stop_sequence']};
  const protocols=[...Object.keys(accepted),'future-protocol'];
  const markers=[undefined,null,'',42,'future-marker','STOP','stop','tool_calls','function_call','end_turn','stop_sequence','length','content_filter','MAX_TOKENS','SAFETY','max_tokens','refusal'];
  let cases=0;
  for(const protocol of protocols)for(const reason of markers)for(const refusal of [false,true])for(const channel of ['json','sse'])for(const terminalObserved of [false,true]) {
    const evidence=observeCompletion({protocol,reason,refusal});
    const decision=decideCompletion(evidence,{channel,terminalObserved});
    const known=Object.hasOwn(accepted,protocol), missing=reason===undefined || reason===null || reason==='';
    const normal=known && accepted[protocol].includes(reason);
    const framing=channel!=='sse' || protocol==='gemini' || terminalObserved;
    const compatible=channel==='json' && known && protocol!=='anthropic' && missing;
    assert.equal(decision.admitted,!refusal && framing && (normal || compatible));
    assert.equal(evidence.goalSatisfied,'unknown');
    if(decision.admitted && !normal)assert.equal(evidence.status,'unknown');
    if(refusal)assert.equal(decision.code,'BLOCKED');
    if(reason==='future-marker' && !refusal)assert.equal(evidence.status,'unknown');
    cases++;
  }
  return {cases,properties:['refusal-not-admitted','missing-compatible-json-stays-unknown','framing-required','future-marker-not-called-incomplete','no-goal-promotion'],
    scope:'Finite representative input classes of production functions; abstraction correspondence and complete implementation proof remain open.'};
}
