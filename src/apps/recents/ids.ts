export const RECENTS_APP_ID = "recents";
export const RECENTS_APP_LABEL = "Recent apps";

export const EMPTY_NODE_ID = "recents:empty";

/** Prev from the first listed row (or empty). Enter opens Home. */
export const HOME_NODE_ID = "recents:home";

export function appRowId(appId: string): string {
  return `recents:app:${appId}`;
}
