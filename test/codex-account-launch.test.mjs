import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {selectedCodexLaunch,withCodexAccountLaunch} from '../lib/codex-account-launch.mjs';
import {AssistantCoordinator,assistantExecArguments} from '../lib/assistant-coordinator.mjs';
import {ResearchReviewRunner} from '../lib/research-evidence.mjs';

const profile=name=>({verified:true,operationId:'switch-'+name,accountId:name,accountKey:(name==='one'?'a':'b').repeat(64),
  method:'chatgpt',authorizationHome:'/private/profiles/'+name,sqliteHome:'/private/history',layoutVerified:true});
const launch=name=>selectedCodexLaunch(profile(name));

test('selected subscription launch omits inherited API routing and preserves unrelated environment',()=>{
  const env={PATH:'/bin',HOME:'/Users/fixture',SYNTHETIC:'keep',OPENAI_API_KEY:'fixture-only',CODEX_API_KEY:'fixture-only',
    OPENAI_BASE_URL:'https://fixture.invalid',CODEX_ACCESS_TOKEN:'fixture-only',CODEX_HOME:'/old',CODEX_SQLITE_HOME:'/old',CLAWDAD_CODEX_HOME:'/old'};
  const route=selectedCodexLaunch(profile('one'),{env});
  assert.equal(route.env.CODEX_HOME,'/private/profiles/one');assert.equal(route.env.SYNTHETIC,'keep');
  for(const key of ['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','OPENAI_BASE_URL','CODEX_SQLITE_HOME','CLAWDAD_CODEX_HOME'])assert.equal(route.env[key],undefined);
  assert.equal(env.CODEX_HOME,'/old');
  for(const change of [{verified:false},{layoutVerified:false},{method:'api_key'},{authorizationHome:'relative'},
    {authorizationHome:'/tmp/../wrong'},{sqliteHome:'/tmp\nwrong'},{accountKey:'unknown'}])assert.throws(()=>selectedCodexLaunch({...profile('one'),...change}));
});

test('account flags preserve image-only positional captions, stdin and exact resumed identity',()=>{
  const sessionId='01a0a848-cb86-7033-ae6f-ce006f5b51bb';
  for(const text of ['', '  \r\n', 'A normal message']){
    const original=assistantExecArguments({root:'/private/test',sessionId,images:['/private/test/image.png'],text});
    const routed=withCodexAccountLaunch(original,launch('one'));
    assert.deepEqual(routed.slice(4),original);assert.ok(routed.includes(sessionId));assert.equal(routed.at(-1),original.at(-1));
  }
});

test('actual coordinator children pin account per turn and preserve history and settings',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'account-launch-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const fixture=path.join(root,'fixture.mjs');await fs.writeFile(fixture,`
    for await(const ignored of process.stdin){}
    await new Promise(r=>setTimeout(r,70));
    console.log(JSON.stringify({type:'thread.started',thread_id:'01a0a848-cb86-7033-ae6f-ce006f5b51bb'}));
    console.log(JSON.stringify({type:'item.completed',item:{id:'answer',type:'agent_message',text:process.env.CODEX_HOME}}));
    console.log(JSON.stringify({type:'turn.completed'}));
  `);
  let selected='one';const children=[];
  const coordinator=new AssistantCoordinator({root,codexPath:process.execPath,resolveAccountLaunch:async()=>launch(selected),
    spawnImpl:(binary,args,options)=>{children.push({args,options});return spawn(binary,[fixture,...args],options);}});
  const modelConfig={model:'test-model',reasoningEffort:'high'},events=[];
  const callbacks={onSession:async()=>{},onMessage:async event=>events.push(event)};
  const first=coordinator.run({id:'first',text:'Synthetic',modelConfig,...callbacks});
  while(!children.length)await new Promise(r=>setTimeout(r,5));selected='two';await first;
  const second=await coordinator.run({id:'second',text:'Next',sessionId:'01a0a848-cb86-7033-ae6f-ce006f5b51bb',modelConfig,...callbacks});
  assert.equal(children[0].options.env.CODEX_HOME,'/private/profiles/one');assert.equal(children[1].options.env.CODEX_HOME,'/private/profiles/two');
  for(const child of children){assert.ok(child.args.includes('test-model'));assert.ok(child.args.includes('model_reasoning_effort="high"'));assert.equal(child.options.env.CLAWDAD_ASSISTANT_ROOT,path.dirname(root));}
  assert.ok(children[1].args.includes('01a0a848-cb86-7033-ae6f-ce006f5b51bb'));
  assert.equal(second.sessionId,'01a0a848-cb86-7033-ae6f-ce006f5b51bb');
});

test('independent research review child receives selected subscription without changing review restrictions',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'account-review-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const result={kind:'needs_user',summary:'Review needed',rationale:'Synthetic check',prompt:'',acceptanceCriteria:[],noProgress:false,milestone:false,findings:[],requirements:[]};
  const fixture=path.join(root,'fixture.mjs');await fs.writeFile(fixture,`for await(const ignored of process.stdin){};console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:${JSON.stringify(JSON.stringify(result))}}}));console.log(JSON.stringify({type:'turn.completed'}));`);
  let observed;
  const reviewer=new ResearchReviewRunner({root,binary:process.execPath,resolveAccountLaunch:async info=>{assert.equal(info.kind,'research_review');return launch('two');},
    launch:(binary,args,options)=>{observed={args,options};return spawn(binary,[fixture,...args],options);}});
  assert.deepEqual(await reviewer.run({id:'review',config:{requirements:[]},completion:{text:'Synthetic'},evidence:{documents:[],unavailable:[]},history:[],modelConfig:{model:'test-review',reasoningEffort:'low'}}),result);
  assert.equal(observed.options.env.CODEX_HOME,'/private/profiles/two');
  for(const argument of ['--ignore-user-config','--ephemeral','read-only','shell_tool','plugins','multi_agent','test-review','model_reasoning_effort="low"'])assert.ok(observed.args.includes(argument));
});
