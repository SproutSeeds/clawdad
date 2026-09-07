class AssistantCapture extends AudioWorkletProcessor {
  constructor(){super();this.chunks=[];this.roll=[];this.size=0;this.onset=0;this.silence=0;this.voiced=0;this.speaking=false;this.segmented=false;this.muted=false;this.port.onmessage=e=>{if(e.data.muted&&(this.voiced>=.25||this.segmented))this.emit(true);this.muted=Boolean(e.data.muted);this.reset();};}
  reset(){this.chunks=[];this.roll=[];this.size=0;this.onset=0;this.silence=0;this.voiced=0;this.speaking=false;this.segmented=false;}
  emit(final){
    const data=new Float32Array(this.size);let offset=0;
    for(const chunk of this.chunks){data.set(chunk,offset);offset+=chunk.length;}
    this.port.postMessage({type:'utterance',samples:data,sampleRate,final},[data.buffer]);
    this.chunks=[];this.size=0;
  }
  process(inputs){
    const source=inputs[0]?.[0];if(!source||this.muted)return true;
    const duration=source.length/sampleRate;let sum=0;for(const sample of source)sum+=sample*sample;
    const loud=Math.sqrt(sum/source.length)>0.012;const samples=new Float32Array(source);
    if(!this.speaking){
      this.roll.push(samples);if(this.roll.length*source.length>sampleRate*.3)this.roll.shift();
      this.onset=loud?this.onset+duration:0;
      if(this.onset>=.12){this.speaking=true;this.chunks=this.roll;this.roll=[];this.size=this.chunks.reduce((n,c)=>n+c.length,0);this.voiced=this.onset;this.port.postMessage({type:'started'});}
    }else{
      this.chunks.push(samples);this.size+=samples.length;
      if(loud){this.voiced+=duration;this.silence=0;}else this.silence+=duration;
      if(this.silence>=.8){if(this.voiced>=.25||this.segmented)this.emit(true);this.reset();}
      else if(this.size>=sampleRate*18){this.emit(false);this.segmented=true;this.voiced=0;}
    }
    return true;
  }
}
registerProcessor('clawdad-assistant-capture',AssistantCapture);
