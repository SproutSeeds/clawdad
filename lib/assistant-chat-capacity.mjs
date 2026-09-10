// Main conversation text only. Native Terminal composer limits are independent.
// UTF-8 bytes are a transport/storage budget, never an estimate of model tokens.
export const assistantChatTextBytes = 128 * 1024;
export const assistantChatCapacity = Object.freeze({textBytes:assistantChatTextBytes,unit:'utf8_bytes'});

export function validateAssistantChatText(text,{images=false}={}) {
  if(typeof text!=='string' || (!images && !text.trim()))throw Error('Write a message or attach an image. Your draft is kept.');
  if(text.includes('\0') || !text.isWellFormed())throw Error('This message contains invalid text characters. Your draft is kept; remove those characters before sending.');
  const size=Buffer.byteLength(text,'utf8');
  if(size>assistantChatTextBytes)throw Error(`This message is ${size.toLocaleString('en-US')} UTF-8 bytes. Assistant supports up to 131,072 bytes (128 KiB) per message. Your text and images are kept; shorten the message before sending.`);
  return text;
}

export function assistantGenerationError(error) {
  const text=String(error?.message||error);
  if(/context.{0,40}(?:exceed|limit|length|full)|(?:exceed|too many).{0,40}(?:context|tokens)|input.{0,30}too (?:long|large)/i.test(text))
    return 'This message could not fit in the selected model’s remaining context, which also includes earlier conversation. Its complete text and images are saved. Recover it from Unprocessed messages and shorten it before sending. No automatic resend was attempted.';
  return text;
}
