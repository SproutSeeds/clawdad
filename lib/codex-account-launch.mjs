import path from 'node:path';

const id=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&path.normalize(value)===value&&!/[\x00-\x1f\x7f]/.test(value);
const forbidden=['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','OPENAI_BASE_URL','CODEX_HOME','CODEX_SQLITE_HOME','CLAWDAD_CODEX_HOME'];

// Internal launch projection. The transition controller supplies a verified
// retained profile; public message arguments cannot supply credential paths.
// Each caller captures this once for its subsequent process. An in-flight
// child keeps its original environment and permission/model arguments.
export function selectedCodexLaunch(profile,{env=process.env}={}) {
  if(!profile||profile.verified!==true||!id(profile.operationId)||!id(profile.accountId)
    ||!/^[a-f0-9]{64}$/.test(profile.accountKey||'')||!absolute(profile.authorizationHome)||!absolute(profile.sqliteHome)
    ||profile.layoutVerified!==true||profile.method!=='chatgpt')throw Error('Verify the selected subscription profile and shared history before launching work.');
  const output={...env};for(const key of forbidden)delete output[key];
  output.CODEX_HOME=profile.authorizationHome;
  output.CLAWDAD_ACCOUNT_TRANSITION_ID=profile.operationId;
  return {env:output,configArgs:['-c','cli_auth_credentials_store="keyring"','-c',`sqlite_home=${JSON.stringify(profile.sqliteHome)}`,
    '-c','forced_login_method="chatgpt"','-c','model_provider="openai"'],
    account:{id:profile.accountId,key:profile.accountKey,operationId:profile.operationId}};
}

// Clap replaces root overrides when a subcommand has its own -c values. Put
// account overrides at the same level, before positionals (including resume
// and blank image captions). Never put credentials on this command line.
export function withCodexAccountLaunch(args,launch) {
  if(!launch)return [...args];
  if(!Array.isArray(launch.configArgs)||!launch.env||!launch.account)throw Error('The selected subscription launch is incomplete.');
  const subcommand=args.findIndex(value=>['exec','app-server','login','logout','mcp','features'].includes(value));
  const at=subcommand<0?0:subcommand+1;
  return [...args.slice(0,at),...launch.configArgs,...args.slice(at)];
}
