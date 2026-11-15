import test from 'node:test';
import assert from 'node:assert/strict';
import {searchDeepSeek,validateSearchQuery,DEEPSEEK_SEARCH_URL,WEB_SEARCH_TOOL} from '../src/web-search.js';
const fakeKey='synthetic-deepseek-search-key';
test('web search function schema requires a bounded query',()=>{
  assert.equal(WEB_SEARCH_TOOL.name,'web_search');
  assert.equal(validateSearchQuery('  二〇二六 新闻  '),'二〇二六 新闻');
  for(const query of ['', ' ', 'x'.repeat(129), '\nsecret'])
    assert.throws(()=>validateSearchQuery(query),{code:'SEARCH_QUERY'});
});
test('DeepSeek Search uses fixed origin, bearer auth and bounded results, no retries',async()=>{
  let calls=0;const result=await searchDeepSeek({key:fakeKey,query:'model release',fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,DEEPSEEK_SEARCH_URL);
    assert.equal(options.headers.Authorization,'Bearer '+fakeKey);
    assert.equal(options.method,'POST');
    assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
    assert.deepEqual(JSON.parse(options.body),{query:'model release',count:5,need_content:false});
    return Response.json({results:[{title:'Official docs',url:'https://example.org/docs',summary:'Supported',snippet:'Docs',site_name:'Example',date:'2026-11-13T12:00:00Z'}, {title:'Unsafe',url:'javascript:alert(1)',snippet:'bad'}]});
  }});
  assert.equal(calls,1);assert.equal(result.results.length,1);
  assert.equal(result.results[0].url,'https://example.org/docs');
  assert.equal(result.provider,'deepseek');assert.equal(result.untrusted,true);
});
test('Search API failures never leak secrets or retry',async()=>{
  let n=0;await assert.rejects(searchDeepSeek({key:fakeKey,query:'test',fetchImpl:async()=>{n++;return new Response('private '+fakeKey,{status:401});}}),e=>e.code==='SEARCH_HTTP'&&!e.message.includes(fakeKey));
  assert.equal(n,1);
  await assert.rejects(searchDeepSeek({key:fakeKey,query:'test',fetchImpl:()=>Promise.reject(new Error(fakeKey))}),e=>e.code==='SEARCH_NETWORK'&&!e.message.includes(fakeKey));
});
test('aborted operation never transmits search key',async()=>{
  const c=new AbortController();c.abort();await assert.rejects(searchDeepSeek({query:'text',key:fakeKey,signal:c.signal,fetchImpl:()=>assert.fail('search sent')}),{code:'CANCELLED'});
});
