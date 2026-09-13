import {SpeechOutputDSP} from './speech-output-dsp.js';
class SpeechOutputProcessor extends AudioWorkletProcessor {
  constructor(){super();this.boostDB=0;this.active=false;this.fade=0;this.dsp=new SpeechOutputDSP(sampleRate);this.port.onmessage=({data})=>{if(data.type==='boost'&&Number.isFinite(data.db))this.boostDB=Math.min(20,Math.max(0,data.db));if(data.type==='active')this.active=!!data.value;};}
  process(inputs,outputs){
    const input=inputs[0],output=outputs[0];
    for(let i=0;i<output[0].length;i++){
      const pair=this.dsp.process(input?.[0]?.[i]||0,input?.[1]?.[i]??input?.[0]?.[i]??0,this.boostDB);
      this.fade=this.active?Math.min(1,this.fade+1/(sampleRate*.005)):Math.max(0,this.fade-1/(sampleRate*.005));
      output[0][i]=pair[0]*this.fade;if(output[1])output[1][i]=pair[1]*this.fade;
    }
    return true;
  }
}
registerProcessor('clawdad-speech-output',SpeechOutputProcessor);
