export const RECENTS_APP_ID = "recents";
export const RECENTS_APP_LABEL = "Recent apps";

export const EMPTY_NODE_ID = "recents:empty";

export function appRowId(appId: string): string {
  return `recents:app:${appId}`;
}
