import assert from 'node:assert/strict';
import test from 'node:test';
import {parseInput,cleanReplies,generateReplies,MODEL} from '../public/generate.mjs';

const body={title:'Eddie Woo',situation:'學生選了 Eddie Woo',intentions:['知悉','讚許'],channels:['chat group','formal text'],perCombo:1};

test('parseInput validates and caps the request',()=>{
  assert.equal(parseInput({...body,situation:' '}).error,'請填寫情境說明。');
  assert.match(parseInput({...body,channels:[]}).error,/溝通形式/);
  assert.match(parseInput({...body,intentions:[]}).error,/回應目的/);
  assert.match(parseInput({...body,intentions:['a','b','c','d','e','f'],channels:['x','y','z'],perCombo:3}).error,/最多/);
  const {input}=parseInput({...body,perCombo:9});
  assert.equal(input.perCombo,3);
});

test('cleanReplies drops unknown combinations and chunks not in the reply',()=>{
  const out=cleanReplies({replies:[
    {intention:'讚許',channel:'chat group',reply:'Great pick! He explains things so clearly.',chunks:['great pick','explains things so clearly','made up phrase']},
    {intention:'責備',channel:'chat group',reply:'Not requested.',chunks:[]},
    {intention:'知悉',channel:'formal text',reply:'Thank you for letting me know.',chunks:['thank you for ... me know']}
  ]},parseInput(body).input);
  assert.equal(out.length,2);
  assert.deepEqual(out[0].chunks,['great pick','explains things so clearly']);
  assert.deepEqual(out[1].chunks,['thank you for ... me know']);
});

test('generateReplies sends model, fallbacks and schema; handles refusal',async()=>{
  let sent;
  const reply={replies:[{intention:'知悉',channel:'chat group',reply:'Got it, thanks!',chunks:['got it']}]};
  const client=stop=>({beta:{messages:{create:async params=>{sent=params;return{stop_reason:stop,content:[{type:'text',text:JSON.stringify(reply)}]};}}}});
  const out=await generateReplies(client('end_turn'),parseInput(body).input);
  assert.equal(sent.model,MODEL);
  assert.equal(sent.fallbacks,'default');
  assert.equal(sent.output_config.format.type,'json_schema');
  assert.equal(out[0].reply,'Got it, thanks!');
  await assert.rejects(generateReplies(client('refusal'),parseInput(body).input),/拒絕/);
});
