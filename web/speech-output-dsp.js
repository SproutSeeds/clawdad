// Speech output policy v1; numeric twin of SpeechOutputDSP.swift.
export class SpeechOutputDSP {
  constructor(rate, boostDB=0) {
    this.rate=rate;this.lookahead=Math.max(1,Math.ceil(rate*.005));this.latencyFrames=this.lookahead+16;
    this.size=this.latencyFrames+32;this.left=new Float64Array(this.size);this.right=new Float64Array(this.size);this.peaks=new Float64Array(this.size);
    this.minimumValues=new Float64Array(this.size);this.minimumIndices=new Float64Array(this.size);this.minimumHead=0;this.minimumCount=0;
    this.frame=0;this.gainDB=Number.isFinite(boostDB)?Math.min(20,Math.max(0,boostDB)):0;this.envelope=0;this.limiting=1;
    this.maximumReductionDB=0;this.limitedFrames=0;this.ceiling=10**(-3/20);
    this.smooth=1-Math.exp(-1/(rate*.05));this.release=1-Math.exp(-1/(rate*.15));
    this.activityAttack=1-Math.exp(-1/(rate*.005));this.activityRelease=1-Math.exp(-1/(rate*.1));
    this.coefficients=[1,2,3].map(phase=>{
      const raw=Array.from({length:16},(_,tap)=>{const x=phase/4-(tap-7);return (Math.abs(x)<1e-10?1:Math.sin(Math.PI*x)/(Math.PI*x))*(Math.abs(x)<8?.5+.5*Math.cos(Math.PI*x/8):0);});
      const sum=raw.reduce((a,b)=>a+b,0);return raw.map(x=>x/sum);
    });
    this.output=[0,0];
  }
  index(n){return (n%this.size+this.size)%this.size;}
  process(l,r,boostDB){
    const target=Number.isFinite(boostDB)?Math.min(20,Math.max(0,boostDB)):0;
    this.gainDB+=(target-this.gainDB)*this.smooth;
    const a=Number.isFinite(l)?l:0,b=Number.isFinite(r)?r:0,power=Math.max(a*a,b*b);
    this.envelope+=(power-this.envelope)*(power>this.envelope?this.activityAttack:this.activityRelease);
    const activity=Math.min(1,Math.max(0,(10*Math.log10(Math.max(this.envelope,1e-20))+60)/20));
    const gain=10**(this.gainDB*activity*activity*(3-2*activity)/20);
    this.left[this.index(this.frame)]=a*gain;this.right[this.index(this.frame)]=b*gain;
    const center=this.frame-8;
    let peak=Math.max(Math.abs(this.left[this.index(center)]),Math.abs(this.right[this.index(center)]));
    for(const taps of this.coefficients){let x=0,y=0;for(let tap=0;tap<16;tap++){const at=this.index(center+tap-7);x+=this.left[at]*taps[tap];y+=this.right[at]*taps[tap];}peak=Math.max(peak,Math.abs(x),Math.abs(y));}
    this.peaks[this.index(center)]=peak;
    const output=this.frame-this.latencyFrames,latest=this.frame-16;
    const p=Math.max(this.peaks[this.index(latest)],this.peaks[this.index(latest-1)]);
    const value=Math.min(1,this.ceiling/Math.max(p,1e-20))+latest/this.lookahead;
    while(this.minimumCount>0){const tail=(this.minimumHead+this.minimumCount-1)%this.size;if(this.minimumValues[tail]<value)break;this.minimumCount--;}
    const tail=(this.minimumHead+this.minimumCount)%this.size;
    this.minimumValues[tail]=value;this.minimumIndices[tail]=latest;this.minimumCount++;
    while(this.minimumCount>1&&this.minimumIndices[this.minimumHead]<output){this.minimumHead=(this.minimumHead+1)%this.size;this.minimumCount--;}
    const rawAllowed=this.minimumValues[this.minimumHead]-output/this.lookahead;
    const allowed=rawAllowed>=1-1e-10?1:Math.max(0,rawAllowed);
    this.limiting=Math.min(allowed,this.limiting+(1-this.limiting)*this.release);
    if(this.limiting<.999){this.limitedFrames++;this.maximumReductionDB=Math.max(this.maximumReductionDB,-20*Math.log10(Math.max(this.limiting,1e-20)));}
    this.output[0]=output>=0?this.left[this.index(output)]*this.limiting:0;
    this.output[1]=output>=0?this.right[this.index(output)]*this.limiting:0;
    this.frame++;return this.output;
  }
}
