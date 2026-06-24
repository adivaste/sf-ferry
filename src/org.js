import core from '@salesforce/core';

const { AuthInfo, Org } = core;

/** List every org the `sf` CLI is already authenticated to (alias + username). */
export async function listOrgs() {
  const auths = await AuthInfo.listAllAuthorizations();
  return auths
    .map((a) => ({
      username: a.username,
      aliases: a.aliases || [],
      instanceUrl: a.instanceUrl,
      isExpired: a.isExpired === true,
    }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

/**
 * Open a Connection to an org by alias or username, reusing the credentials
 * already stored by the `sf` CLI (no new login). Returns a jsforce-style
 * Connection with `.metadata.describe()` / `.metadata.list()`.
 */
export async function connect(aliasOrUsername) {
  const org = await Org.create({ aliasOrUsername });
  const conn = org.getConnection();
  return conn;
}

/** Human label for an org record. */
export function orgLabel(o) {
  return o.aliases?.length ? `${o.aliases[0]} (${o.username})` : o.username;
}
