import {SpeechOutputDSP} from '../web/speech-output-dsp.js';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
const option=name=>process.argv[process.argv.indexOf(name)+1];
if(!process.argv.includes('--input')||!process.argv.includes('--output'))throw Error('Usage: node scripts/verify-speech-output.mjs --input original.wav --output canonical-candidate-directory [--quick]');
const root=path.resolve(option('--output'))+path.sep,source=path.resolve(option('--input'));
fs.mkdirSync(root,{recursive:true});
fs.writeFileSync(root+'source-provenance.json',JSON.stringify({source,sha256:crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),policy:'speech-output-v1',ffmpeg:execFileSync('ffmpeg',['-version'],{encoding:'utf8'}).split('\n')[0]},null,2));
execFileSync('ffmpeg',['-v','error','-y','-i',source,'-ar','24000','-ac','1','-f','f32le',root+'source.f32']);
const bytes=fs.readFileSync(root+'source.f32');const original=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
const scenarios=process.argv.includes('--quick')?[['speech',original.subarray(0,24000*10)]]:[['speech',original],['quiet',Float32Array.from(original.subarray(0,24000*12),x=>x*.1)],['loud',Float32Array.from(original.subarray(0,24000*12),x=>x*1.6)],['silence',new Float32Array(24000)],['noise',Float32Array.from({length:24000},(_,i)=>Math.sin(i*1.234)*.00001)],['intersample',Float32Array.from({length:24000},(_,i)=>Math.sin(i*Math.PI/2+Math.PI/4)*.98)],['impulse',Float32Array.from({length:24000},(_,i)=>i===12000?.99:0)]];
const results=[];
for(const [name,samples] of scenarios)for(const db of process.argv.includes('--quick')?[0,6,10,20]:[0,2,3,4,6,10,20]){
  const dsp=new SpeechOutputDSP(24000,db),out=new Float32Array(samples.length+dsp.latencyFrames);
  const start=performance.now();let peak=0;
  for(let i=0;i<out.length;i++){out[i]=dsp.process(samples[i]||0,samples[i]||0,db)[0];peak=Math.max(peak,Math.abs(out[i]));}
  const processingMs=performance.now()-start;
  const stem=`${name}-${db}`;fs.writeFileSync(root+stem+'.f32',Buffer.from(out.buffer));
  execFileSync('ffmpeg',['-v','error','-y','-f','f32le','-ar','24000','-ac','1','-i',root+stem+'.f32','-c:a','pcm_s24le',root+stem+'.wav']);
  const {spawnSync}=await import('node:child_process');const run=spawnSync('ffmpeg',['-hide_banner','-nostats','-i',root+stem+'.wav','-af','loudnorm=print_format=json','-f','null','-'],{encoding:'utf8'});
  const match=run.stderr.match(/\{[\s\S]*"input_i"[\s\S]*\}/);const analysis=JSON.parse(match[0]);
  const record={name,requestedDB:db,seconds:samples.length/24000,samplePeakDB:20*Math.log10(peak),lufs:Number(analysis.input_i),truePeakDB:Number(analysis.input_tp),maximumReductionDB:dsp.maximumReductionDB,limitedPercent:100*dsp.limitedFrames/out.length,processingMs,latencyMs:1000*dsp.latencyFrames/24000};
  results.push(record);console.log(JSON.stringify(record));
  fs.writeFileSync(root+'measurements.json',JSON.stringify(results,null,2));
}
