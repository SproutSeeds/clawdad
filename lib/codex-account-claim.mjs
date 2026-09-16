import {acquireCodexDeliveryClaim} from './codex-delivery-claim.mjs';

// Account state must remain operable after service exit during initialization.
// Keep the shared delivery-lock API and receipt checks, with complete metadata
// published atomically. Ordinary Terminal delivery locks retain their adapter.
export const acquireCodexAccountClaim=(root,options)=>acquireCodexDeliveryClaim(root,{...options,atomicPublication:true});
